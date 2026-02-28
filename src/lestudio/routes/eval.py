"""Evaluation, checkpoint scanning, and gym environment type routes."""
from __future__ import annotations

import datetime
import importlib.util
import json
from pathlib import Path

from fastapi import APIRouter

from lestudio.command_builders import build_eval_args
from lestudio._train_helpers import (
    _check_cuda_runtime_compat,
    _check_torchcodec_compat,
    _check_train_python_deps,
)
from lestudio.routes._state import AppState
from lestudio.routes.process import _guard_process_start
from lestudio.routes.training import _ensure_train_installer

# Known lerobot gym environment types
KNOWN_ENV_TYPES = [
    {"type": "gym_manipulator", "label": "Manipulator (SO-101, real robot)", "module": "lerobot.rl.gym_manipulator"},
    {"type": "aloha", "label": "Aloha (sim)"},
    {"type": "pusht", "label": "PushT (sim)"},
    {"type": "xarm", "label": "xArm (sim)"},
    {"type": "dora_aloha_real", "label": "Dora Aloha (real)"},
]


def create_router(state: AppState) -> APIRouter:
    router = APIRouter()

    # ─── Checkpoints ──────────────────────────────────────────────────────────
    @router.get("/api/checkpoints")
    def api_checkpoints():
        """Scan outputs/train/ for available checkpoints (flat & timestamped runs)."""
        results: list[dict] = []
        seen_paths: set[str] = set()

        def _scan_checkpoints_dir(ckpts_dir: Path, run_name: str = ""):
            if not ckpts_dir.is_dir():
                return
            for entry in ckpts_dir.iterdir():
                if not entry.is_dir():
                    continue
                # Resolve symlinks (e.g. 'last' -> '005000')
                resolved = entry.resolve() if entry.is_symlink() else entry
                pretrained = resolved / "pretrained_model"
                if not pretrained.is_dir():
                    continue
                real_path = str(pretrained)
                if real_path in seen_paths:
                    continue
                seen_paths.add(real_path)
                name = entry.name
                display = f"{run_name}/{name}" if run_name else name
                ckpt: dict = {
                    "name": name,
                    "display": display,
                    "path": str(entry / "pretrained_model"),
                    "step": None,
                    "policy": None,
                    "env_type": None,
                    "env_task": None,
                    "image_keys": [],
                    "size_mb": 0,
                    "has_config": (pretrained / "config.json").exists(),
                    "has_model": any(pretrained.glob("*.safetensors")) or any(pretrained.glob("*.bin")),
                    "is_symlink": entry.is_symlink(),
                    "modified": None,
                }

                # Parse step from directory name (e.g. '010000')
                try:
                    ckpt["step"] = int(name)
                except ValueError:
                    pass

                # Read exact step from training_state/training_step.json
                step_file = resolved / "training_state" / "training_step.json"
                if step_file.exists():
                    try:
                        step_data = json.loads(step_file.read_text())
                        if isinstance(step_data.get("step"), (int, float)):
                            ckpt["step"] = int(step_data["step"])
                    except Exception:
                        pass

                # Read policy type and env metadata from pretrained_model/train_config.json
                tc: dict | None = None
                train_cfg = pretrained / "train_config.json"
                if train_cfg.exists():
                    try:
                        tc = json.loads(train_cfg.read_text())
                        ckpt["policy"] = tc.get("policy", {}).get("type") or tc.get("policy_type")
                        env_cfg = tc.get("env") if isinstance(tc, dict) else None
                        if isinstance(env_cfg, dict):
                            raw_type = (env_cfg.get("type") or "").strip()
                            ckpt["env_type"] = raw_type or None
                            ckpt["env_task"] = (env_cfg.get("task") or env_cfg.get("name") or "").strip() or None
                    except Exception:
                        pass

                # Extract image feature keys from policy.input_features
                if isinstance(tc, dict):
                    input_feats = (tc.get("policy") or {}).get("input_features", {})
                    if isinstance(input_feats, dict):
                        img_keys = [k.replace("observation.images.", "") for k in input_feats if k.startswith("observation.images.")]
                        if img_keys:
                            ckpt["image_keys"] = img_keys

                # Calculate size and modification time
                total_bytes = 0
                latest_mtime = 0.0
                for f in pretrained.rglob("*"):
                    if f.is_file():
                        st = f.stat()
                        total_bytes += st.st_size
                        if st.st_mtime > latest_mtime:
                            latest_mtime = st.st_mtime
                ckpt["size_mb"] = round(total_bytes / (1024 * 1024), 1)
                if latest_mtime > 0:
                    ckpt["modified"] = datetime.datetime.fromtimestamp(
                        latest_mtime, tz=datetime.timezone.utc
                    ).isoformat()

                results.append(ckpt)

        train_root = Path("outputs/train")
        flat_checkpoints_dir = train_root / "checkpoints"

        # Pattern 1: outputs/train/checkpoints/ (flat)
        _scan_checkpoints_dir(flat_checkpoints_dir)

        if train_root.is_dir():
            nested_checkpoints_dirs = sorted(
                p for p in train_root.rglob("checkpoints") if p.is_dir() and p != flat_checkpoints_dir
            )
            for ckpts_dir in nested_checkpoints_dirs:
                rel_parent = ckpts_dir.parent.relative_to(train_root)
                run_name = rel_parent.as_posix()
                _scan_checkpoints_dir(ckpts_dir, run_name)

        # Sort: 'last' first, then by step descending, then by modified
        def sort_key(c: dict):
            if c["name"] == "last":
                return (0, 0, "")
            if c["name"] == "best":
                return (1, 0, "")
            return (2, -(c["step"] or 0), c["modified"] or "")
        results.sort(key=sort_key)

        return {"ok": True, "checkpoints": results}

    # ─── Eval Start ───────────────────────────────────────────────────────────
    @router.post("/api/eval/start")
    async def api_eval_start(data: dict):
        guard = _guard_process_start(state, "eval")
        if guard:
            return guard

        deps = _check_train_python_deps(state.python_exe)
        if not deps.get("ok"):
            command = str(deps.get("command", "")).strip()
            reason = str(deps.get("reason", "Missing required Python package for evaluation.")).strip()
            ok_install, already_running = _ensure_train_installer(state, command)
            if ok_install:
                status = "already running" if already_running else "started"
                return {
                    "ok": False,
                    "error": f"{reason} Auto-install {status} in background. Retry evaluation after installer finishes.",
                    "auto_install_started": True,
                }
            return {
                "ok": False,
                "error": f"{reason} Auto-install could not be started. Open Eval tab and retry install once.",
            }

        tc = _check_torchcodec_compat(state.python_exe)
        if not tc.get("ok"):
            command = str(tc.get("command", "")).strip()
            reason = str(tc.get("reason", "torchcodec check failed.")).strip()
            ok_install, already_running = _ensure_train_installer(state, command)
            if ok_install:
                status = "already running" if already_running else "started"
                return {
                    "ok": False,
                    "error": f"{reason} Auto-install {status} in background. Retry evaluation after installer finishes.",
                    "auto_install_started": True,
                }
            return {
                "ok": False,
                "error": f"{reason} Auto-install could not be started. Open Eval tab and retry install once.",
            }

        eval_device = str(data.get("eval_device", "cuda")).lower()
        if eval_device == "cuda":
            ok, reason = _check_cuda_runtime_compat(state.python_exe)
            if not ok:
                return {
                    "ok": False,
                    "error": f"{reason} Switch Compute Device to CPU/MPS or install a CUDA-compatible PyTorch build.",
                }

        try:
            args = build_eval_args(state.python_exe, data)
        except ValueError as e:
            return {"ok": False, "error": str(e)}

        env_type = ""
        for arg in args:
            if arg.startswith("--env.type="):
                env_type = arg.split("=", 1)[1].strip()
                break
        if env_type:
            # Look up the correct module name from KNOWN_ENV_TYPES (handles
            # built-in modules like lerobot.rl.gym_manipulator that aren't pip packages)
            module_name = f"gym_{env_type}"
            for entry in KNOWN_ENV_TYPES:
                if entry["type"] == env_type and "module" in entry:
                    module_name = entry["module"]
                    break
            if importlib.util.find_spec(module_name) is None:
                install_cmd = f"{state.python_exe} -m pip install {module_name}"
                return {
                    "ok": False,
                    "error": (
                        f"Environment plugin '{module_name}' is not installed. "
                        f"Install it to run evaluation with this checkpoint."
                    ),
                    "action": "install_gym_plugin",
                    "command": install_cmd,
                    "module_name": module_name,
                }

        ok = state.proc_mgr.start("eval", args)
        if ok:
            state.append_history("eval_start", {
                "policy_path": data.get("eval_policy_path", ""),
                "device": data.get("eval_device", ""),
            })
        return {"ok": ok}

    # ─── Env Types ────────────────────────────────────────────────────────────
    @router.get("/api/eval/env-types")
    def api_eval_env_types():
        results = []
        for entry in KNOWN_ENV_TYPES:
            module_name = entry.get("module") or f"gym_{entry['type']}"
            installed = importlib.util.find_spec(module_name) is not None
            results.append({
                "type": entry["type"],
                "label": entry["label"],
                "module": module_name,
                "installed": installed,
            })
        return {"ok": True, "env_types": results}

    return router
