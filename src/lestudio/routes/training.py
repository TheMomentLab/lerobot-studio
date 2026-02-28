"""Training, deps, and installer routes."""
from __future__ import annotations

import datetime
import logging
import json
import json
import os
import shutil
import subprocess
import time
from pathlib import Path
from urllib.parse import quote, urlparse

from fastapi import APIRouter

from lestudio.command_builders import build_train_args
from lestudio._train_helpers import (
    _build_torch_install_args,
    _check_cuda_runtime_compat,
    _check_torchcodec_compat,
    _check_train_python_deps,
    _format_cmd,
    _parse_install_args,
)
from lestudio.routes._state import AppState
from lestudio.routes.process import _guard_process_start

logger = logging.getLogger(__name__)

# ─── Preflight 서버 캐시 ─────────────────────────────────────────────────────────
_TTL_PREFLIGHT_OK = 120.0    # ok: True  → 2분 (CUDA 호환성은 설치 전후로만 바넨)
_TTL_PREFLIGHT_FAIL = 20.0   # ok: False + action 있음 → 20초 (유저 조치 후 쳤캐리 재확인 가능)
# ok: False + action 없음(서브프로세스 타임아웃 등 일시적 오류) → 캐싱 안 함
_preflight_cache: dict[str, tuple[dict, float]] = {}
DEFAULT_COLAB_NOTEBOOK_URL = "https://colab.research.google.com/github/TheMomentLab/lerobot-studio/blob/dev/notebooks/lerobot_train.ipynb"


def _preflight_cache_get(key: str) -> dict | None:
    entry = _preflight_cache.get(key)
    if entry and time.monotonic() < entry[1]:
        return entry[0]
    return None


def _preflight_cache_set(key: str, result: dict) -> None:
    if result.get("ok"):
        ttl = _TTL_PREFLIGHT_OK
    elif result.get("action"):  # 실제 실패: 유저가 조치해야 하는 아이템
        ttl = _TTL_PREFLIGHT_FAIL
    else:
        return  # subprocess 타임아웃/파싱 오류 등 일시적 문제 → 캐싱 안 함
    _preflight_cache[key] = (result, time.monotonic() + ttl)


def _preflight_cache_invalidate() -> None:
    _preflight_cache.clear()


def _ensure_train_installer(state: AppState, command: str) -> tuple[bool, bool]:
    """Start the train_install process if not already running. Returns (ok, already_running)."""
    if state.proc_mgr.is_running("train_install"):
        return True, True
    args = _parse_install_args(command, state.python_exe)
    if not args:
        return False, False
    return state.proc_mgr.start("train_install", args), False


def _safe_positive_int(value: object, default: int) -> int:
    if isinstance(value, str):
        candidate: str | int | float = value
    elif isinstance(value, (int, float)):
        candidate = value
    else:
        return default
    try:
        parsed = int(float(candidate))
    except (TypeError, ValueError):
        return default
    return parsed if parsed > 0 else default


def _normalize_colab_device(value: object) -> str:
    if isinstance(value, str) and value.strip().lower() == "cpu":
        return "cpu"
    return "cuda"


def _build_colab_link(base_url: str, repo_id: str, config_path: str) -> str:
    source = (base_url or "").strip()
    if not source:
        return ""

    has_placeholders = "{repo_id}" in source or "{config_path}" in source
    if has_placeholders:
        source = source.replace("{repo_id}", quote(repo_id, safe=""))
        source = source.replace("{config_path}", quote(config_path, safe="/"))

    parsed = urlparse(source)
    if parsed.scheme not in {"http", "https"}:
        return ""
    return source

def create_router(state: AppState) -> APIRouter:
    router = APIRouter()
    token_file = state.config_dir / "hf_token"

    def _resolve_hf_token() -> tuple[str, str]:
        token_env = (os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_HUB_TOKEN") or "").strip()
        if token_env:
            return token_env, "env"

        if token_file.exists():
            try:
                token_saved = token_file.read_text().strip()
            except OSError:
                token_saved = ""
            if token_saved:
                os.environ["HF_TOKEN"] = token_saved
                os.environ["HUGGINGFACE_HUB_TOKEN"] = token_saved
                return token_saved, "file"

        return "", "none"

    @router.get("/api/train/preflight")
    def api_train_preflight(device: str = "cuda"):
        dev = (device or "cuda").lower()
        cache_key = f"preflight:{dev}"

        cached = _preflight_cache_get(cache_key)
        if cached is not None:
            return cached

        deps = _check_train_python_deps(state.python_exe)
        if not deps.get("ok"):
            result = {
                "ok": False,
                "reason": deps.get("reason", "Training dependency check failed."),
                "action": deps.get("action", "install_python_dep"),
                "command": deps.get("command", ""),
            }
            _preflight_cache_set(cache_key, result)
            return result

        if dev != "cuda":
            # non-CUDA: CUDA 체크 스킵, torchcodec만 확인
            tc = _check_torchcodec_compat(state.python_exe)
            if tc.get("ok"):
                result = {"ok": True, "reason": f"{dev.upper()} selected. {tc['reason']}"}
                _preflight_cache_set(cache_key, result)
                return result
            cause = tc.get("cause", "unknown")
            action_map = {"missing_cuda_toolkit": "install_cuda_toolkit", "missing_ffmpeg": "install_ffmpeg", "version_mismatch": "install_torchcodec"}
            result = {
                "ok": False,
                "reason": tc.get("reason", "torchcodec check failed."),
                "action": action_map.get(cause, "install_torchcodec"),
                "command": tc.get("command", ""),
            }
            _preflight_cache_set(cache_key, result)
            return result

        ok, reason = _check_cuda_runtime_compat(state.python_exe)
        if not ok:
            install_args = _build_torch_install_args(state.python_exe, cuda_tag="cu128", nightly=True)
            result = {
                "ok": False,
                "reason": f"{reason} Switch Compute Device to CPU/MPS or install a CUDA-compatible PyTorch build.",
                "action": "install_torch_cuda",
                "command": _format_cmd(install_args),
            }
            _preflight_cache_set(cache_key, result)
            return result

        # CUDA OK → torchcodec 체크
        tc = _check_torchcodec_compat(state.python_exe)
        if tc.get("ok"):
            result = {"ok": True, "reason": f"{reason} | {tc['reason']}"}
            _preflight_cache_set(cache_key, result)
            return result
        cause = tc.get("cause", "unknown")
        action_map = {"missing_cuda_toolkit": "install_cuda_toolkit", "missing_ffmpeg": "install_ffmpeg", "version_mismatch": "install_torchcodec"}
        result = {
            "ok": False,
            "reason": tc.get("reason", "torchcodec check failed."),
            "action": action_map.get(cause, "install_torchcodec"),
            "command": tc.get("command", ""),
        }
        _preflight_cache_set(cache_key, result)
        return result
    @router.get("/api/deps/status")
    def api_deps_status():
        return {
            "ok": True,
            "huggingface_cli": bool(shutil.which("huggingface-cli")),
        }

    @router.post("/api/train/install_pytorch")
    async def api_train_install_pytorch(data: dict | None = None):
        if state.proc_mgr.is_running("train"):
            return {"ok": False, "error": "Stop training before installing PyTorch."}
        if state.proc_mgr.is_running("train_install"):
            return {"ok": False, "error": "PyTorch installer is already running."}

        payload = data or {}
        cuda_tag = str(payload.get("cuda_tag", "cu128")).strip() or "cu128"
        nightly = bool(payload.get("nightly", True))
        args = _build_torch_install_args(state.python_exe, cuda_tag=cuda_tag, nightly=nightly)

        ok = state.proc_mgr.start("train_install", args)
        if ok:
            _preflight_cache_invalidate()  # 설치 시작 시 preflight 캐시 무효화
        return {
            "ok": ok,
            "command": _format_cmd(args),
            "error": None if ok else "Failed to launch installer process.",
        }

    @router.post("/api/train/install_torchcodec_fix")
    async def api_train_install_torchcodec_fix(data: dict | None = None):
        if state.proc_mgr.is_running("train"):
            return {"ok": False, "error": "Stop training before installing."}
        if state.proc_mgr.is_running("train_install"):
            return {"ok": False, "error": "Another installer is already running."}
        payload = data or {}
        command = str(payload.get("command", "")).strip()
        if not command:
            return {"ok": False, "error": "No install command provided."}
        args = _parse_install_args(command, state.python_exe)
        if not args:
            return {"ok": False, "error": "Invalid install command."}
        ok = state.proc_mgr.start("train_install", args)
        if ok:
            _preflight_cache_invalidate()  # 설치 시작 시 preflight 캐시 무효화
        return {
            "ok": ok,
            "command": " ".join(args),
            "error": None if ok else "Failed to launch installer process.",
        }

    @router.post("/api/train/start")
    async def api_train_start(data: dict):
        guard = _guard_process_start(state, "train")
        if guard:
            return guard

        deps = _check_train_python_deps(state.python_exe)
        if not deps.get("ok"):
            command = str(deps.get("command", "")).strip()
            reason = str(deps.get("reason", "Missing required Python package for training.")).strip()
            ok_install, already_running = _ensure_train_installer(state, command)
            if ok_install:
                status = "already running" if already_running else "started"
                return {
                    "ok": False,
                    "error": f"{reason} Auto-install {status} in background. Retry training after installer finishes.",
                    "auto_install_started": True,
                }
            return {
                "ok": False,
                "error": f"{reason} Auto-install could not be started. Open Train tab and retry install once.",
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
                    "error": f"{reason} Auto-install {status} in background. Retry training after installer finishes.",
                    "auto_install_started": True,
                }
            return {
                "ok": False,
                "error": f"{reason} Auto-install could not be started. Open Train tab and retry install once.",
            }

        train_device = str(data.get("train_device", "cuda")).lower()
        if train_device == "cuda":
            ok, reason = _check_cuda_runtime_compat(state.python_exe)
            if not ok:
                return {
                    "ok": False,
                    "error": f"{reason} Switch Compute Device to CPU/MPS or install a CUDA-compatible PyTorch build.",
                }

        args = build_train_args(state.python_exe, data)
        ok = state.proc_mgr.start("train", args)
        if ok:
            state.append_history("train_start", {
                "policy": data.get("train_policy", ""),
                "repo_id": data.get("train_repo_id", ""),
                "steps": data.get("train_steps", ""),
                "device": data.get("train_device", ""),
            })
        return {"ok": ok}

    @router.post("/api/train/colab/config")
    async def api_train_colab_config(data: dict | None = None):
        payload = data or {}
        repo_id = str(payload.get("train_repo_id") or payload.get("dataset_repo") or payload.get("repo_id") or "").strip()
        if not repo_id or "/" not in repo_id:
            return {"ok": False, "error": "train_repo_id (user/repo) is required for Colab config upload."}

        config_path = str(payload.get("config_path", "lestudio_train_config.json") or "").strip().lstrip("/")
        if not config_path:
            config_path = "lestudio_train_config.json"
        if ".." in Path(config_path).parts:
            return {"ok": False, "error": "config_path cannot contain '..' segments."}

        token, _ = _resolve_hf_token()
        if not token:
            return {"ok": False, "error": "HF_TOKEN (or HUGGINGFACE_HUB_TOKEN) is not set."}

        cli = shutil.which("huggingface-cli")
        if not cli:
            return {"ok": False, "error": "huggingface-cli is not installed in this environment."}

        train_config = {
            "version": 1,
            "dataset_repo": repo_id,
            "policy": str(payload.get("train_policy", "act") or "act"),
            "steps": _safe_positive_int(payload.get("train_steps"), 50000),
            "batch_size": _safe_positive_int(payload.get("train_batch_size"), 8),
            "lr": str(payload.get("train_lr", "") or "") or None,
            "train_device": _normalize_colab_device(payload.get("train_device")),
            "output_repo": str(payload.get("train_output_repo") or payload.get("output_repo") or "").strip() or None,
            "extra_overrides": payload.get("extra_overrides", []) if isinstance(payload.get("extra_overrides"), list) else [],
            "generated_by": "LeStudio",
            "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        }

        temp_dir = state.config_dir / "tmp"
        temp_dir.mkdir(parents=True, exist_ok=True)
        tmp_path = temp_dir / f"colab_train_config_{int(time.time() * 1000)}.json"
        tmp_path.write_text(json.dumps(train_config, indent=2))

        cmd = [cli, "upload", repo_id, str(tmp_path), config_path, "--repo-type", "dataset"]
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                env={**os.environ, "HF_TOKEN": token, "HUGGINGFACE_HUB_TOKEN": token},
                timeout=120,
            )
        except (OSError, subprocess.SubprocessError) as e:
            return {"ok": False, "error": f"Failed to upload Colab config: {e}"}
        finally:
            try:
                tmp_path.unlink(missing_ok=True)
            except OSError:
                pass

        output = "\n".join(p for p in (proc.stdout.strip(), proc.stderr.strip()) if p).strip()
        if proc.returncode != 0:
            tail = "\n".join(output.splitlines()[-8:]).strip() if output else ""
            return {
                "ok": False,
                "error": tail or f"huggingface-cli upload failed with exit code {proc.returncode}.",
            }

        notebook_url = str(payload.get("colab_notebook_url", "") or "").strip() or DEFAULT_COLAB_NOTEBOOK_URL

        colab_link = _build_colab_link(notebook_url, repo_id, config_path)
        return {
            "ok": True,
            "repo_id": repo_id,
            "config_path": config_path,
            "colab_link": colab_link,
            "manual_run_required": True,
            "session_limit_note": "Colab free runtime can disconnect when idle and has finite session duration.",
        }

    @router.get("/api/train/colab/link")
    def api_train_colab_link(
        repo_id: str = "",
        config_path: str = "lestudio_train_config.json",
        notebook_url: str = DEFAULT_COLAB_NOTEBOOK_URL,
    ):
        rid = (repo_id or "").strip()
        if not rid or "/" not in rid:
            return {"ok": False, "error": "repo_id must be in user/repo format."}

        cpath = (config_path or "lestudio_train_config.json").strip().lstrip("/") or "lestudio_train_config.json"
        if ".." in Path(cpath).parts:
            return {"ok": False, "error": "config_path cannot contain '..' segments."}

        nurl = (notebook_url or "").strip() or DEFAULT_COLAB_NOTEBOOK_URL

        link = _build_colab_link(nurl, rid, cpath)
        if not link:
            return {
                "ok": False,
                "error": "Colab notebook URL is invalid.",
            }

        return {
            "ok": True,
            "url": link,
            "repo_id": rid,
            "config_path": cpath,
            "manual_run_required": True,
            "session_limit_note": "Colab may disconnect idle sessions and has runtime limits.",
        }

    return router
