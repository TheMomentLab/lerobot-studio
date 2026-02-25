#!/usr/bin/env python3
"""LeStudio — Web GUI server (packaged version)."""

import asyncio
import datetime
import json
import os
import queue
import re
import shlex
import shutil
import psutil
import subprocess
import sys
import textwrap
import threading
import time
import uuid
from pathlib import Path
from typing import Optional, cast

import cv2
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from lestudio.command_builders import (
    build_calibrate_args,
    build_eval_args,
    build_motor_setup_args,
    build_record_args,
    build_teleop_args,
    build_train_args,
    resolve_record_resume,
)
from lestudio.process_manager import ProcessManager, PROCESS_NAMES
from lestudio import device_registry
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

# ─── nvidia pip 패키지의 .so를 LD_LIBRARY_PATH에 자동 추가 ─────────────────
def _patch_nvidia_lib_path():
    import importlib.util

    existing = os.environ.get("LD_LIBRARY_PATH", "")
    existing_parts = [p for p in existing.split(":") if p]
    seen = set(existing_parts)
    added: list[str] = []

    def add_lib_dir(path: str):
        if not path:
            return
        if not os.path.isdir(path):
            return
        if path in seen:
            return
        seen.add(path)
        added.append(path)

    for pkg in ["nvidia.npp", "nvidia.cudnn", "nvidia.cublas", "nvidia.cusparse", "nvidia.cufft", "nvidia.cusolver", "nvidia.nvjitlink"]:
        try:
            spec = importlib.util.find_spec(pkg)
        except ModuleNotFoundError:
            continue
        if spec and spec.submodule_search_locations:
            for loc in spec.submodule_search_locations:
                add_lib_dir(os.path.join(loc, "lib"))

    conda_prefix_candidates: list[Path] = []
    env_prefix = os.environ.get("CONDA_PREFIX", "").strip()
    if env_prefix:
        conda_prefix_candidates.append(Path(env_prefix))

    conda_exe = (os.environ.get("CONDA_EXE", "").strip() or shutil.which("conda") or "").strip()
    if conda_exe:
        conda_path = Path(conda_exe).resolve()
        if conda_path.parent.name in {"condabin", "bin"}:
            conda_prefix_candidates.append(conda_path.parent.parent)

    dedup_prefixes: list[Path] = []
    seen_prefixes: set[str] = set()
    for prefix in conda_prefix_candidates:
        key = str(prefix)
        if not key or key in seen_prefixes:
            continue
        seen_prefixes.add(key)
        dedup_prefixes.append(prefix)

    for prefix in dedup_prefixes:
        add_lib_dir(str(prefix / "lib"))

    if added:
        os.environ["LD_LIBRARY_PATH"] = ":".join(added + existing_parts)

_patch_nvidia_lib_path()

CAMERA_ROLES = [
    "(none)", "top_cam_1", "top_cam_2", "top_cam_3",
    "wrist_cam_1", "wrist_cam_2",
]
# ROBOT_TYPES는 device_registry에서 동적으로 탐색합니다 (Phase 0 마이그레이션).
# 하드코딩 폴백은 device_registry 내부에 있습니다.
ROBOT_TYPES = device_registry.get_robot_types()

DEFAULT_CONFIG = {
    "robot_mode":          "single",
    "follower_port":       "/dev/follower_arm_1",
    "leader_port":         "/dev/leader_arm_1",
    "robot_id":            "my_so101_follower_1",
    "teleop_id":           "my_so101_leader_1",
    "left_follower_port":  "/dev/follower_arm_1",
    "right_follower_port": "/dev/follower_arm_2",
    "left_leader_port":    "/dev/leader_arm_1",
    "right_leader_port":   "/dev/leader_arm_2",
    "left_robot_id":       "my_so101_follower_1",
    "right_robot_id":      "my_so101_follower_2",
    "left_teleop_id":      "my_so101_leader_1",
    "right_teleop_id":     "my_so101_leader_2",
    "cameras": {
        "wrist_1": "/dev/wrist_cam_1",
        "top_1":   "/dev/top_cam_1",
        "top_2":   "/dev/top_cam_2",
    },
    "camera_settings": {
        "codec":        "MJPG",
        "width":        640,
        "height":       480,
        "fps":          30,
        "jpeg_quality": 70,
    },
    "record_task":     "",
    "record_episodes": 50,
    "record_repo_id":  "user/my-dataset",
    "record_resume":   False,
    "profile_name":    "default",
    "train_dataset_source": "local",
    "process_view_url": "",
    "eval_policy_path": "outputs/train/checkpoints/last/pretrained_model",
    "eval_repo_id": "user/my-dataset",
    "eval_episodes": 10,
    "eval_device": "cuda",
    "eval_task": "",
}

_DEFAULT_CAM_SETTINGS = {
    "codec": "MJPG", "width": 640, "height": 480, "fps": 30, "jpeg_quality": 70,
}
_PREVIEW_SETTINGS = {
    "codec": "MJPG", "width": 192, "height": 144, "fps": 5, "jpeg_quality": 50,
}
# ─── Device Detection ──────────────────────────────────────────────────────────
def udev_props(dev_path: str) -> dict:
    try:
        r = subprocess.run(
            ["udevadm", "info", "--query=property", dev_path],
            capture_output=True, text=True, timeout=2,
        )
        return dict(ln.split("=", 1) for ln in r.stdout.splitlines() if "=" in ln)
    except Exception:
        return {}


def kernels_from_devpath(devpath: str) -> str:
    for part in reversed(devpath.split("/")):
        if re.match(r"^\d+-\d+(\.\d+)*$", part):
            return part
    return ""


def find_symlink(target_name: str) -> str:
    for f in Path("/dev").iterdir():
        try:
            if f.is_symlink() and f.resolve().name == target_name:
                return f.name
        except Exception:
            pass
    return ""


def get_cameras() -> list[dict]:
    cameras = []
    for video in sorted(Path("/dev").glob("video*")):
        if not re.match(r"^video\d+$", video.name):
            continue
        try:
            idx = int(Path(f"/sys/class/video4linux/{video.name}/index").read_text().strip())
            if idx != 0:
                continue
        except Exception:
            continue
        props = udev_props(str(video))
        kernels = kernels_from_devpath(props.get("DEVPATH", ""))
        cameras.append({
            "device":  video.name,
            "path":    str(video),
            "kernels": kernels,
            "symlink": find_symlink(video.name),
            "model":   props.get("ID_MODEL", "Unknown"),
        })
    return cameras


def get_arms() -> list[dict]:
    arms = []
    for p in sorted(Path("/dev").glob("tty*")):
        if not any(x in p.name for x in ("USB", "ACM")):
            continue
        props = udev_props(str(p))
        arms.append({
            "device":  p.name,
            "path":    str(p),
            "symlink": find_symlink(p.name),
            "serial": props.get("ID_SERIAL_SHORT", ""),
            "kernels": kernels_from_devpath(props.get("DEVPATH", "")),
        })
    return arms


# ─── MJPEG Streaming ──────────────────────────────────────────────────────────
_cam_open_lock = threading.Lock()


class CameraStreamer:
    def __init__(self, path: str, settings: dict):
        self.real_path = os.path.realpath(path)
        self.settings = settings
        self.latest_frame: bytes | None = None
        self.running = True
        self.failed = False
        self.clients = 0
        self._fps: float = 0.0
        self._mbps: float = 0.0
        self._stat_frames: int = 0
        self._stat_bytes: int = 0
        self._stat_ts: float = time.monotonic()
        self.thread = threading.Thread(target=self._capture_loop, daemon=True)
        self.thread.start()

    def _capture_loop(self):
        s = self.settings
        cap = None
        for attempt in range(5):
            opened = False
            with _cam_open_lock:
                cap = cv2.VideoCapture(self.real_path)
                fourcc_fn = getattr(cv2, "VideoWriter_fourcc", None)
                if callable(fourcc_fn):
                    fourcc = cast(int, fourcc_fn(*s["codec"]))
                else:
                    fourcc = cast(int, cv2.VideoWriter.fourcc(*s["codec"]))
                cap.set(cv2.CAP_PROP_FOURCC, float(fourcc))
                cap.set(cv2.CAP_PROP_FRAME_WIDTH, s["width"])
                cap.set(cv2.CAP_PROP_FRAME_HEIGHT, s["height"])
                cap.set(cv2.CAP_PROP_FPS, min(s["fps"], 8))
                cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                if cap.isOpened():
                    ret, _ = cap.read()
                    if ret:
                        cap.set(cv2.CAP_PROP_FPS, s["fps"])
                        opened = True
                    else:
                        cap.release()
                        cap = None
                else:
                    cap.release()
                    cap = None
            if opened:
                time.sleep(0.5)
                break
            if cap is not None:
                cap.release()
                cap = None
            time.sleep(2.0)

        if not cap or not cap.isOpened():
            self.failed = True
            return

        quality = s["jpeg_quality"]
        target_fps = max(s["fps"], 1)
        frame_interval = 1.0 / target_fps
        last_encode_ts = 0.0

        while self.running:
            ret, frame = cap.read()
            if ret:
                now = time.monotonic()
                if now - last_encode_ts < frame_interval:
                    continue
                last_encode_ts = now
                _, jpg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
                self.latest_frame = jpg.tobytes()
                self._stat_frames += 1
                self._stat_bytes += len(self.latest_frame) if self.latest_frame else 0
                elapsed = now - self._stat_ts
                if elapsed >= 1.0:
                    self._fps  = self._stat_frames / elapsed
                    self._mbps = self._stat_bytes / elapsed / (1024 * 1024)
                    self._stat_frames = 0
                    self._stat_bytes  = 0
                    self._stat_ts     = now
            else:
                time.sleep(0.1)
        cap.release()

    def get_stats(self) -> dict:
        return {"fps": round(self._fps, 1), "mbps": round(self._mbps, 2)}

    def stop(self):
        self.running = False


_streamers: dict[str, CameraStreamer] = {}
_streamers_lock = threading.Lock()

_preview_streamers: dict[str, CameraStreamer] = {}
_cameras_locked = False  # When True, no new streamers will be created (cameras reserved for subprocess)
_preview_lock = threading.Lock()
_rerun_server_proc: Optional[subprocess.Popen] = None
_rerun_server_lock = threading.Lock()


def _get_cam_settings(config_path: Path) -> dict:
    cfg = _load_config(config_path)
    return {**_DEFAULT_CAM_SETTINGS, **cfg.get("camera_settings", {})}


def get_streamer(video_path: str, config_path: Path) -> CameraStreamer | None:
    if _cameras_locked:
        return None
    real_path = os.path.realpath(video_path)
    with _streamers_lock:
        if real_path not in _streamers:
            _streamers[real_path] = CameraStreamer(real_path, _get_cam_settings(config_path))
        _streamers[real_path].clients += 1
        return _streamers[real_path]


def release_streamer(video_path: str):
    real_path = os.path.realpath(video_path)
    with _streamers_lock:
        if real_path in _streamers:
            _streamers[real_path].clients -= 1
            if _streamers[real_path].clients <= 0:
                _streamers[real_path].stop()
                del _streamers[real_path]


def get_preview_streamer(video_path: str) -> CameraStreamer | None:
    if _cameras_locked:
        return None
    real_path = os.path.realpath(video_path)
    with _preview_lock:
        if real_path not in _preview_streamers:
            _preview_streamers[real_path] = CameraStreamer(real_path, _PREVIEW_SETTINGS)
        _preview_streamers[real_path].clients += 1
        return _preview_streamers[real_path]


def release_preview_streamer(video_path: str):
    real_path = os.path.realpath(video_path)
    with _preview_lock:
        if real_path in _preview_streamers:
            _preview_streamers[real_path].clients -= 1
            if _preview_streamers[real_path].clients <= 0:
                _preview_streamers[real_path].stop()
                del _preview_streamers[real_path]


def stop_all_streamers_for_process():
    global _cameras_locked
    _cameras_locked = True  # Block any new streamer creation from browser requests
    threads = []
    with _streamers_lock:
        for streamer in _streamers.values():
            streamer.stop()
            threads.append(streamer.thread)
        _streamers.clear()
    with _preview_lock:
        for streamer in _preview_streamers.values():
            streamer.stop()
            threads.append(streamer.thread)
        _preview_streamers.clear()
    # Wait for ALL capture threads to fully exit and release their cameras
    for t in threads:
        t.join(timeout=5.0)
    time.sleep(1.5)  # Extra buffer for V4L2 device node release


def unlock_cameras():
    global _cameras_locked
    _cameras_locked = False


def ensure_rerun_web_server(python_exe: str, web_port: int = 9090, grpc_port: int = 9876):
    global _rerun_server_proc
    with _rerun_server_lock:
        if _rerun_server_proc is not None and _rerun_server_proc.poll() is None:
            return
        cmd = [
            python_exe,
            "-c",
            (
                "import time;"
                "import rerun as rr;"
                "rr.init('lestudio_view', spawn=False);"
                f"rr.serve_grpc(grpc_port={grpc_port});"
                f"rr.serve_web_viewer(web_port={web_port}, open_browser=False, connect_to='rerun+http://127.0.0.1:{grpc_port}/proxy');"
                "\nwhile True:\n    time.sleep(3600)"
            ),
        ]
        _rerun_server_proc = subprocess.Popen(
            cmd,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            close_fds=True,
        )

def restart_all_streamers(config_path: Path):
    with _streamers_lock:
        for streamer in _streamers.values():
            streamer.stop()
        paths = list(_streamers.keys())
        _streamers.clear()
    with _preview_lock:
        for streamer in _preview_streamers.values():
            streamer.stop()
        _preview_streamers.clear()
    time.sleep(1.5)
    settings = _get_cam_settings(config_path)
    for p in paths:
        with _streamers_lock:
            _streamers[p] = CameraStreamer(p, settings)
            _streamers[p].clients = 1


# ─── Config ────────────────────────────────────────────────────────────────────
def _load_config(config_path: Path) -> dict:
    if config_path.exists():
        try:
            content = config_path.read_text().strip()
            if content:
                return {**DEFAULT_CONFIG, **json.loads(content)}
        except (json.JSONDecodeError, Exception):
            pass
    return DEFAULT_CONFIG.copy()


def _save_config(config_path: Path, cfg: dict):
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(json.dumps(cfg, indent=2))


def _is_valid_profile_name(name: str) -> bool:
    return re.fullmatch(r"[A-Za-z0-9._-]+", name or "") is not None


def _profile_path(profiles_dir: Path, name: str) -> Path:
    return profiles_dir / f"{name}.json"


def _list_profiles(profiles_dir: Path) -> list[str]:
    if not profiles_dir.exists():
        return []
    names = []
    for p in profiles_dir.glob("*.json"):
        if p.is_file():
            names.append(p.stem)
    return sorted(names)


def _load_profile(profiles_dir: Path, name: str) -> dict | None:
    path = _profile_path(profiles_dir, name)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text())
    except Exception:
        return None
    return {**DEFAULT_CONFIG, **data}


def _save_profile(profiles_dir: Path, name: str, cfg: dict):
    profiles_dir.mkdir(parents=True, exist_ok=True)
    _profile_path(profiles_dir, name).write_text(json.dumps(cfg, indent=2))


# ─── udev Rules ────────────────────────────────────────────────────────────────
def _arm_rule_lines(rules_path: Path) -> list[str]:
    if not rules_path.exists():
        return []
    return [
        ln for ln in rules_path.read_text().splitlines()
        if "idVendor" in ln and "SYMLINK" in ln
    ]


def _parse_udev_rules(content: str) -> dict[str, list[dict[str, str | bool]]]:
    camera_rules: list[dict[str, str | bool]] = []
    arm_rules: list[dict[str, str | bool]] = []
    devices: list[dict[str, str | bool]] = []

    def _extract(pattern: str, text: str) -> str:
        match = re.search(pattern, text)
        if not match:
            return ""
        return match.group(1)

    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "SYMLINK" not in line:
            continue

        subsystem = _extract(r'SUBSYSTEM=="([^"]+)"', line)
        kernels = _extract(r'KERNELS=="([^"]+)"', line)
        serial = _extract(r'ATTRS\{serial\}=="([^"]+)"', line)
        symlink = _extract(r'SYMLINK\+="([^"]+)"', line)
        mode = _extract(r'MODE="([^"]+)"', line)

        if not symlink:
            continue

        exists = os.path.exists(f"/dev/{symlink}")
        item = {
            "subsystem": subsystem,
            "kernel": kernels,
            "serial": serial,
            "symlink": symlink,
            "mode": mode,
            "exists": exists,
        }
        devices.append(item)
        if subsystem == "video4linux":
            camera_rules.append(item)
        elif subsystem == "tty":
            arm_rules.append(item)

    return {
        "camera_rules": camera_rules,
        "arm_rules": arm_rules,
        "devices": devices,
    }


def _build_rules(assignments: dict[str, str], arm_assignments: dict[str, str], rules_path: Path) -> str:
    lines = _arm_rule_lines(rules_path) + [
        "",
        "# LeRobot Camera Rules",
        '# Note: Cameras share Serial "SN0001", so we use physical port paths (KERNELS).',
        "# If you plug cameras into different ports, you MUST update these paths!",
        "",
    ]
    for kernels, role in sorted(assignments.items()):
        if role and role != "(none)":
            lines.append(
                f'SUBSYSTEM=="video4linux", KERNELS=="{kernels}", '
                f'ATTR{{index}}=="0", SYMLINK+="{role}", MODE="0666"'
            )

    lines += [
        "",
        "# LeRobot Arm Rules",
        "# Arms use serial-number matching.",
        "",
    ]
    for serial, role in sorted(arm_assignments.items()):
        if serial and role and role != "(none)":
            lines.append(
                f'SUBSYSTEM=="tty", ATTRS{{serial}}=="{serial}", '
                f'SYMLINK+="{role}", MODE="0666"'
            )
    return "\n".join(lines) + "\n"


def _apply_rules(assignments: dict[str, str], arm_assignments: dict[str, str], rules_path: Path) -> tuple[bool, str]:
    return _apply_rules_with_fallback(assignments, arm_assignments, rules_path, None)


def _manual_udev_install_commands(source_rules: Path, target_rules: Path) -> list[str]:
    source_q = shlex.quote(str(source_rules))
    target_q = shlex.quote(str(target_rules))
    return [
        f"sudo cp {source_q} {target_q}",
        "sudo udevadm control --reload-rules",
        "sudo udevadm trigger --subsystem-match=video4linux",
        "sudo udevadm trigger --subsystem-match=tty",
    ]


def _run_privileged_udev_apply(command_prefix: list[str], source_rules: Path, target_rules: Path) -> tuple[bool, str]:
    steps = [
        [*command_prefix, "cp", str(source_rules), str(target_rules)],
        [*command_prefix, "udevadm", "control", "--reload-rules"],
        [*command_prefix, "udevadm", "trigger", "--subsystem-match=video4linux"],
        [*command_prefix, "udevadm", "trigger", "--subsystem-match=tty"],
    ]
    for step in steps:
        result = subprocess.run(step, capture_output=True, text=True)
        if result.returncode != 0:
            stderr = (result.stderr or "").strip()
            stdout = (result.stdout or "").strip()
            err = stderr or stdout or f"{' '.join(step)} failed"
            return False, err
    return True, ""


def _apply_rules_with_fallback(
    assignments: dict[str, str],
    arm_assignments: dict[str, str],
    rules_path: Path,
    fallback_rules_path: Path | None,
) -> tuple[bool, str]:
    content = _build_rules(assignments, arm_assignments, rules_path)
    tmp = Path(f"/tmp/99-lerobot.rules.{uuid.uuid4().hex}.new")
    tmp.write_text(content)

    if fallback_rules_path is not None:
        try:
            fallback_rules_path.parent.mkdir(parents=True, exist_ok=True)
            fallback_rules_path.write_text(content)
        except Exception:
            pass

    try:
        sudo_ok, sudo_err = _run_privileged_udev_apply(["sudo", "-n"], tmp, rules_path)
        if sudo_ok:
            return True, ""

        pkexec_err = ""
        if shutil.which("pkexec"):
            pkexec_ok, pkexec_err = _run_privileged_udev_apply(["pkexec"], tmp, rules_path)
            if pkexec_ok:
                return True, ""

        base_err = sudo_err or "sudo failed — install udev rules via CLI helper"
        if pkexec_err:
            base_err = f"{base_err}\npkexec failed: {pkexec_err}"

        if fallback_rules_path is None:
            return False, base_err
        commands = _manual_udev_install_commands(fallback_rules_path, rules_path)
        hint = "\n".join(commands)
        return False, (
            f"{base_err}\n\n"
            f"Saved rules to: {fallback_rules_path}\n"
            f"Run these commands:\n{hint}"
        )
    finally:
        try:
            tmp.unlink(missing_ok=True)
        except Exception:
            pass


def _check_cuda_runtime_compat(python_exe: str) -> tuple[bool, str]:
    script = (
        "import json,sys;"
        "\ntry:"
        "\n import torch"
        "\n if not torch.cuda.is_available():"
        "\n  print(json.dumps({'ok': False, 'reason': 'CUDA is not available in this environment.'})); sys.exit(0)"
        "\n try:"
        "\n  idx = torch.cuda.current_device()"
        "\n except Exception:"
        "\n  idx = 0"
        "\n major, minor = torch.cuda.get_device_capability(idx)"
        "\n gpu_arch = f'sm_{major}{minor}'"
        "\n raw_arches = []"
        "\n try:"
        "\n  raw_arches = torch.cuda.get_arch_list() or []"
        "\n except Exception:"
        "\n  raw_arches = []"
        "\n supported = []"
        "\n for arch in raw_arches:"
        "\n  if arch.startswith('sm_'): supported.append(arch)"
        "\n  elif arch.startswith('compute_'): supported.append('sm_' + arch.split('_', 1)[1])"
        "\n supported = sorted(set(supported))"
        "\n if supported and gpu_arch not in supported:"
        "\n  msg = 'CUDA arch mismatch: GPU ' + gpu_arch + ', torch supports ' + ', '.join(supported) + '.'"
        "\n  print(json.dumps({'ok': False, 'reason': msg})); sys.exit(0)"
        "\n print(json.dumps({'ok': True, 'reason': f'CUDA arch supported ({gpu_arch})'}))"
        "\nexcept Exception as e:"
        "\n print(json.dumps({'ok': False, 'reason': f'CUDA preflight check failed: {e}'}))"
    )

    try:
        r = subprocess.run([python_exe, "-c", script], capture_output=True, text=True, timeout=8)
    except Exception as e:
        return False, f"CUDA preflight check failed: {e}"

    out = (r.stdout or "").strip().splitlines()
    if not out:
        err = (r.stderr or "").strip()
        return False, f"CUDA preflight check returned no output. {err}".strip()

    try:
        payload = json.loads(out[-1])
    except Exception:
        return False, f"CUDA preflight parse error: {out[-1]}"

    ok = bool(payload.get("ok"))
    reason = str(payload.get("reason", "Unknown CUDA preflight result."))
    return ok, reason


def _cuda_tag_to_toolkit_version(cuda_tag: str) -> str | None:
    token = (cuda_tag or "").strip().lower()
    if not token.startswith("cu"):
        return None
    digits = token[2:]
    if not digits.isdigit() or len(digits) < 2:
        return None
    if len(digits) == 3:
        major = int(digits[:2])
        minor = int(digits[2])
    else:
        major = int(digits[:-1])
        minor = int(digits[-1])
    return f"{major}.{minor}"


def _check_torchcodec_compat(python_exe: str) -> dict:
    """torchcodec가 현재 환경에서 로드 가능한지 확인하고, 실패 시 원인을 분류합니다."""
    script = textwrap.dedent("""
        import json, sys
        try:
            from torchcodec.decoders import VideoDecoder
            print(json.dumps({"ok": True, "reason": "torchcodec is available."}))
        except ImportError:
            import torch
            tv = torch.__version__
            is_nightly = "dev" in tv
            cuda_tag = ""
            if "+cu" in tv:
                cuda_tag = "cu" + tv.split("+cu")[1]
            try:
                import torchvision
                has_video_opt = bool(getattr(torchvision.io, "_HAS_VIDEO_OPT", False))
                has_cpu_decoder = bool(getattr(torchvision.io, "_HAS_CPU_VIDEO_DECODER", False))
                if not (has_video_opt and has_cpu_decoder):
                    print(json.dumps({
                        "ok": False,
                        "reason": "torchcodec is not installed and torchvision VideoReader is unavailable on this build. Training video decode will fail unless torchcodec is installed.",
                        "cause": "pyav_video_reader_unavailable",
                        "nightly": is_nightly,
                        "cuda_tag": cuda_tag,
                    }))
                    raise SystemExit(0)
                print(json.dumps({"ok": True, "reason": "torchcodec not installed. pyav will be used as fallback.", "fallback": True, "nightly": is_nightly, "cuda_tag": cuda_tag}))
            except Exception as e:
                print(json.dumps({
                    "ok": False,
                    "reason": f"torchcodec is not installed and pyav fallback probe failed: {type(e).__name__}",
                    "cause": "pyav_video_reader_unavailable",
                    "nightly": is_nightly,
                    "cuda_tag": cuda_tag,
                }))
        except RuntimeError as e:
            import torch
            err = str(e)
            tv = torch.__version__
            is_nightly = "dev" in tv
            cuda_tag = ""
            if "+cu" in tv:
                cuda_tag = "cu" + tv.split("+cu")[1]
            # 원인 분류
            if "libnppicc" in err or "libnpp" in err:
                cause = "missing_cuda_toolkit"
                msg = f"CUDA toolkit libraries (libnppicc) not found. torchcodec requires the CUDA toolkit to be installed."
            elif "libavcodec" in err or "libavformat" in err or "FFmpeg" in err.split("Likely causes")[0] if "Likely causes" in err else False:
                cause = "missing_ffmpeg"
                msg = "FFmpeg libraries not found. torchcodec requires FFmpeg 4-7 to be installed."
            elif "is not compatible" in err:
                cause = "version_mismatch"
                msg = f"torchcodec is incompatible with PyTorch {tv}. Reinstall torchcodec to match your PyTorch version."
            else:
                cause = "unknown"
                msg = f"torchcodec failed to load (PyTorch {tv}). Check your CUDA toolkit and FFmpeg installation."
            print(json.dumps({"ok": False, "reason": msg, "cause": cause, "nightly": is_nightly, "cuda_tag": cuda_tag}))
        except Exception as e:
            print(json.dumps({"ok": False, "reason": f"torchcodec check error: {type(e).__name__}", "cause": "unknown"}))
    """)
    try:
        r = subprocess.run([python_exe, "-c", script], capture_output=True, text=True, timeout=10)
    except Exception as e:
        return {"ok": False, "reason": f"torchcodec check failed: {e}", "cause": "unknown"}
    out = (r.stdout or "").strip().splitlines()
    if not out:
        err = (r.stderr or "").strip()
        return {"ok": False, "reason": f"torchcodec check returned no output. {err}".strip(), "cause": "unknown"}
    try:
        payload = json.loads(out[-1])
    except Exception:
        return {"ok": False, "reason": f"torchcodec check parse error: {out[-1]}", "cause": "unknown"}
    # 실패 시 cause별 install 명령어 생성
    if not payload.get("ok"):
        cause = payload.get("cause", "unknown")
        nightly = payload.get("nightly", False)
        cuda_tag = str(payload.get("cuda_tag", ""))
        toolkit_version = _cuda_tag_to_toolkit_version(cuda_tag)
        if cause == "missing_cuda_toolkit":
            if toolkit_version:
                payload["command"] = f"conda install -y -c nvidia cuda-toolkit={toolkit_version}"
                payload["reason"] = (
                    f"CUDA toolkit libraries (libnppicc) matching PyTorch {cuda_tag} are missing. "
                    f"Install CUDA toolkit {toolkit_version} runtime libraries."
                )
            else:
                payload["command"] = "conda install -y -c nvidia cuda-toolkit"
        elif cause == "missing_ffmpeg":
            payload["command"] = "conda install -y -c conda-forge ffmpeg"
        else:
            parts = ["pip", "install", "--force-reinstall"]
            if nightly:
                parts.append("--pre")
            parts.append("torchcodec")
            if nightly and cuda_tag:
                parts.extend(["--index-url", f"https://download.pytorch.org/whl/nightly/{cuda_tag}"])
            elif cuda_tag:
                parts.extend(["--index-url", f"https://download.pytorch.org/whl/{cuda_tag}"])
            payload["command"] = " ".join(parts)
    return payload


def _check_train_python_deps(python_exe: str) -> dict:
    script = textwrap.dedent("""
        import importlib.util
        import json

        required = ["accelerate", "av"]
        missing = []
        for name in required:
            try:
                if importlib.util.find_spec(name) is None:
                    missing.append(name)
            except Exception:
                missing.append(name)

        print(json.dumps({"ok": len(missing) == 0, "missing": missing}))
    """)
    try:
        r = subprocess.run([python_exe, "-c", script], capture_output=True, text=True, timeout=8)
    except Exception as e:
        return {"ok": True, "reason": f"Dependency probe skipped: {e}"}

    out = (r.stdout or "").strip().splitlines()
    if not out:
        return {"ok": True, "reason": "Dependency probe skipped: no output"}

    try:
        payload = json.loads(out[-1])
    except Exception:
        return {"ok": True, "reason": f"Dependency probe skipped: parse error ({out[-1]})"}

    missing = [str(name).strip() for name in payload.get("missing", []) if str(name).strip()]
    if missing:
        args = [python_exe, "-m", "pip", "install", *missing]
        pkg_text = ", ".join(missing)
        return {
            "ok": False,
            "reason": f"Missing required Python package(s) for training: {pkg_text}.",
            "action": "install_python_dep",
            "command": _format_cmd(args),
            "missing": missing,
        }

    return {"ok": True, "reason": "Core training dependencies are available."}

def _build_torch_install_args(python_exe: str, cuda_tag: str = "cu128", nightly: bool = True) -> list[str]:
    channel = "nightly" if nightly else "stable"
    index_url = f"https://download.pytorch.org/whl/{channel}/{cuda_tag}" if nightly else f"https://download.pytorch.org/whl/{cuda_tag}"
    args = [python_exe, "-m", "pip", "install", "--upgrade"]
    if nightly:
        args.append("--pre")
    args.extend(["torch", "torchvision", "torchaudio", "--index-url", index_url])
    return args


def _format_cmd(args: list[str]) -> str:
    return " ".join(shlex.quote(a) for a in args)


def _ensure_non_interactive_conda_args(args: list[str]) -> list[str]:
    if not args:
        return args
    exe = Path(args[0]).name.lower()
    if exe not in {"conda", "mamba", "micromamba"}:
        return args
    if len(args) < 2:
        return args
    subcommand = args[1].lower()
    if subcommand not in {"install", "update", "remove", "uninstall"}:
        return args
    if "-y" in args[2:] or "--yes" in args[2:]:
        return args
    return [args[0], args[1], "-y", *args[2:]]


def _parse_install_args(raw_command: str, python_exe: str) -> list[str]:
    command = str(raw_command or "").strip()
    if not command:
        return []
    try:
        args = shlex.split(command)
    except Exception:
        return []
    if not args:
        return []

    head = args[0]
    if head in {"pip", "pip3"}:
        args = [python_exe, "-m", "pip", *args[1:]]
    elif head in {"python", "python3"} and len(args) >= 3 and args[1] == "-m" and args[2] == "pip":
        args = [python_exe, "-m", "pip", *args[3:]]
    return _ensure_non_interactive_conda_args(args)


def _normalize_console_command(python_exe: str, raw_command: str) -> tuple[list[str], str]:
    command = (raw_command or "").strip()
    if not command:
        raise ValueError("No command provided.")

    args = shlex.split(command)
    if not args:
        raise ValueError("No command provided.")

    head = args[0]
    if head in {"pip", "pip3"}:
        args = [python_exe, "-m", "pip", *args[1:]]
    elif head in {"python", "python3"} and len(args) >= 3 and args[1] == "-m" and args[2] == "pip":
        args = [python_exe, "-m", "pip", *args[3:]]
    args = _ensure_non_interactive_conda_args(args)

    return args, _format_cmd(args)


# ─── USB Bus Info ──────────────────────────────────────────────────────────────
def get_usb_bus_for_camera(video_name: str) -> dict:
    try:
        dev = Path(f"/sys/class/video4linux/{video_name}/device").resolve()
        parts = str(dev).split("/")
        usb_port = next(p for p in reversed(parts) if re.match(r"^\d+-[\d.]+$", p))
        bus = usb_port.split("-")[0]
        speed_path = Path(f"/sys/bus/usb/devices/usb{bus}/speed")
        max_mbps = int(speed_path.read_text().strip()) if speed_path.exists() else 480
        return {"bus": bus, "port": usb_port, "max_mbps": max_mbps}
    except Exception:
        return {"bus": "?", "port": "?", "max_mbps": 480}


# ─── App Factory ───────────────────────────────────────────────────────────────
def create_app(
    lerobot_src: Path,
    config_dir: Path,
    rules_path: Path,
) -> FastAPI:
    STATIC_DIR = Path(__file__).parent / "static"
    CONFIG_PATH = config_dir / "config.json"
    PROFILES_DIR = config_dir / "profiles"
    FALLBACK_RULES_PATH = config_dir / "99-lerobot.rules"
    HISTORY_PATH = config_dir / "history.json"
    HISTORY_MAX = 200
    PYTHON = sys.executable

    app = FastAPI(title="LeStudio")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
    )

    class NoCacheStaticMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request, call_next):
            response: Response = await call_next(request)
            if request.url.path.startswith("/static/"):
                response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            return response

    app.add_middleware(NoCacheStaticMiddleware)

    def _on_process_exit(name: str):
        if name in {"record", "teleop"}:
            unlock_cameras()
        append_history(f"{name}_end")

    proc_mgr = ProcessManager(lerobot_src, on_process_exit=_on_process_exit)
    push_jobs: dict[str, dict] = {}
    push_jobs_lock = threading.Lock()

    def load_config() -> dict:
        return _load_config(CONFIG_PATH)

    def save_config(cfg: dict):
        _save_config(CONFIG_PATH, cfg)

    def append_history(event_type: str, meta: dict | None = None):
        """Append a session event to history.json (best-effort, never raises)."""
        entry = {
            "ts": datetime.datetime.now().isoformat(timespec="seconds"),
            "type": event_type,
            "meta": meta or {},
        }
        try:
            if HISTORY_PATH.exists():
                entries = json.loads(HISTORY_PATH.read_text())
                if not isinstance(entries, list):
                    entries = []
            else:
                entries = []
            entries.append(entry)
            if len(entries) > HISTORY_MAX:
                entries = entries[-HISTORY_MAX:]
            HISTORY_PATH.write_text(json.dumps(entries, indent=2))
        except Exception:
            pass

    # ─── API: Devices & Config ─────────────────────────────────────────────
    @app.get("/api/devices")
    def api_devices():
        return {"cameras": get_cameras(), "arms": get_arms()}

    @app.post("/api/camera/check_paths")
    def api_camera_check_paths(data: dict[str, object]):
        paths = data.get("paths", [])
        result: dict[str, bool] = {}
        if not isinstance(paths, list):
            return result
        for p in paths:
            if not isinstance(p, str):
                continue
            try:
                real = os.path.realpath(p)
                result[p] = os.path.exists(real)
            except Exception:
                result[p] = False
        return result

    @app.get("/api/config")
    def api_config_get():
        return load_config()

    @app.post("/api/config")
    async def api_config_save(data: dict):
        save_config(data)
        return {"ok": True}

    @app.get("/api/profiles")
    def api_profiles_list():
        cfg = load_config()
        active = str(cfg.get("profile_name", "default"))
        names = _list_profiles(PROFILES_DIR)
        if not names:
            _save_profile(PROFILES_DIR, "default", cfg)
            names = ["default"]
        if active not in names:
            active = names[0]
        return {"profiles": names, "active": active}

    @app.get("/api/profiles/{name}")
    def api_profiles_get(name: str):
        if not _is_valid_profile_name(name):
            return {"ok": False, "error": "Invalid profile name"}
        cfg = _load_profile(PROFILES_DIR, name)
        if cfg is None:
            return {"ok": False, "error": "Profile not found"}
        return {"ok": True, "config": cfg}

    @app.post("/api/profiles/{name}")
    async def api_profiles_save(name: str, data: dict):
        if not _is_valid_profile_name(name):
            return {"ok": False, "error": "Invalid profile name"}
        cfg = {**DEFAULT_CONFIG, **data}
        cfg["profile_name"] = name
        _save_profile(PROFILES_DIR, name, cfg)
        return {"ok": True}

    @app.delete("/api/profiles/{name}")
    def api_profiles_delete(name: str):
        if not _is_valid_profile_name(name):
            return {"ok": False, "error": "Invalid profile name"}
        path = _profile_path(PROFILES_DIR, name)
        if not path.exists():
            return {"ok": False, "error": "Profile not found"}
        try:
            path.unlink()
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    @app.post("/api/profiles-import")
    async def api_profiles_import(data: dict):
        name = str(data.get("name", "")).strip()
        cfg = data.get("config", {})
        if not _is_valid_profile_name(name):
            return {"ok": False, "error": "Invalid profile name"}
        if not isinstance(cfg, dict):
            return {"ok": False, "error": "Invalid profile content"}
        merged = {**DEFAULT_CONFIG, **cfg}
        merged["profile_name"] = name
        _save_profile(PROFILES_DIR, name, merged)
        return {"ok": True}

    @app.get("/api/camera_roles")
    def api_camera_roles():
        return CAMERA_ROLES

    @app.get("/api/camera_settings")
    def api_camera_settings_get():
        return _get_cam_settings(CONFIG_PATH)

    @app.post("/api/camera_settings")
    async def api_camera_settings_save(data: dict):
        cfg = load_config()
        cfg["camera_settings"] = {**_DEFAULT_CAM_SETTINGS, **data}
        save_config(cfg)
        restart_all_streamers(CONFIG_PATH)
        return {"ok": True}

    @app.get("/api/robot_types")
    def api_robot_types():
        """[Deprecated] /api/robots 사용 권장. 하위 호환용으로 유지."""
        return device_registry.get_robot_types()

    # ─── API: Ecosystem Registry (Phase 0) ────────────────────────────────
    @app.get("/api/robots")
    def api_robots():
        """등록된 모든 Robot 타입 목록 + capabilities + 호환 teleop 반환."""
        robot_types = device_registry.get_robot_types()
        return {
            "types": robot_types,
            "details": {
                t: {
                    "capabilities": device_registry.get_capabilities(t),
                    "compatible_teleops": device_registry.get_compatible_teleops(t),
                }
                for t in robot_types
            },
            "lerobot_available": device_registry.is_lerobot_available(),
        }

    @app.get("/api/robots/{robot_type}/schema")
    def api_robot_schema(robot_type: str):
        """특정 Robot 타입의 config 스키마 반환 (핵심 필드만)."""
        return device_registry.get_config_schema("robots", robot_type)

    @app.get("/api/teleops")
    def api_teleops(robot_type: str | None = None):
        """등록된 Teleoperator 타입 목록 반환. robot_type 지정 시 호환 목록만."""
        return {
            "types": device_registry.get_teleop_types(robot_type),
            "lerobot_available": device_registry.is_lerobot_available(),
        }

    @app.get("/api/cameras")
    def api_cameras():
        """등록된 Camera 타입 목록 반환."""
        return {
            "types": device_registry.get_camera_types(),
            "lerobot_available": device_registry.is_lerobot_available(),
        }

    @app.get("/api/ecosystem/status")
    def api_ecosystem_status():
        """LeRobot 생태계 연결 상태 및 전체 디바이스 목록 반환."""
        return device_registry.list_all_devices()

    # ─── API: udev Rules ───────────────────────────────────────────────────
    def _current_rules_payload() -> dict[str, str | list[dict[str, str | bool]]]:
        if not rules_path.exists():
            return {"content": "# File not found", "camera_rules": [], "arm_rules": [], "devices": []}
        content = rules_path.read_text()
        parsed = _parse_udev_rules(content)
        return {"content": content, **parsed}

    @app.get("/api/udev/rules")
    def api_udev_rules():
        return _current_rules_payload()

    @app.get("/api/rules/current")
    def api_rules_current():
        return _current_rules_payload()

    @app.get("/api/rules/status")
    def api_rules_status():
        sudo_noninteractive = False
        try:
            probe = subprocess.run(["sudo", "-n", "true"], capture_output=True)
            sudo_noninteractive = probe.returncode == 0
        except Exception:
            sudo_noninteractive = False
        pkexec_available = shutil.which("pkexec") is not None
        graphical_session = bool((os.environ.get("DISPLAY") or "").strip() or (os.environ.get("WAYLAND_DISPLAY") or "").strip())
        gui_auth_available = pkexec_available and graphical_session
        rules_installed = rules_path.exists()
        install_needed = not rules_installed
        needs_root_for_install = install_needed and not (sudo_noninteractive or gui_auth_available)
        return {
            "rules_path": str(rules_path),
            "rules_installed": rules_installed,
            "install_needed": install_needed,
            "needs_root_for_install": needs_root_for_install,
            "fallback_rules_path": str(FALLBACK_RULES_PATH),
            "fallback_rules_exists": FALLBACK_RULES_PATH.exists(),
            "sudo_noninteractive": sudo_noninteractive,
            "pkexec_available": pkexec_available,
            "graphical_session": graphical_session,
            "gui_auth_available": gui_auth_available,
            "manual_commands": _manual_udev_install_commands(FALLBACK_RULES_PATH, rules_path),
        }

    @app.post("/api/rules/preview")
    async def api_rules_preview(data: dict):
        return {
            "content": _build_rules(
                data.get("assignments", {}),
                data.get("arm_assignments", {}),
                rules_path,
            )
        }

    @app.post("/api/rules/apply")
    async def api_rules_apply(data: dict):
        ok, err = _apply_rules_with_fallback(
            data.get("assignments", {}),
            data.get("arm_assignments", {}),
            rules_path,
            FALLBACK_RULES_PATH,
        )
        return {
            "ok": ok,
            "error": err,
            "fallback_rules_path": str(FALLBACK_RULES_PATH),
            "manual_commands": _manual_udev_install_commands(FALLBACK_RULES_PATH, rules_path),
        }


    @app.get("/api/rules/verify")
    def api_rules_verify():
        """Check each expected symlink from installed rules and report status."""
        if not rules_path.exists():
            return {"ok": True, "results": [], "note": "No rules file installed."}

        parsed = _parse_udev_rules(rules_path.read_text())
        results = []
        for device in parsed.get("devices", []):
            symlink = device.get("symlink", "")
            if not symlink:
                continue
            dev_path = Path(f"/dev/{symlink}")
            exists = dev_path.exists()
            resolved_target = ""
            status = "missing"
            if exists:
                try:
                    resolved_target = dev_path.resolve().name
                    status = "ok"
                except Exception:
                    resolved_target = "(unresolvable)"
                    status = "error"
            results.append({
                "role": symlink,
                "subsystem": device.get("subsystem", ""),
                "match_key": device.get("serial") or device.get("kernel") or "",
                "exists": exists,
                "resolved_target": resolved_target,
                "status": status,
            })
        return {"ok": True, "results": results}
    @app.post("/api/preflight")
    async def api_preflight(data: dict):
        checks = []
        hard_error = False

        def add(status: str, label: str, msg: str):
            nonlocal hard_error
            checks.append({"status": status, "label": label, "msg": msg})
            if status == "error":
                hard_error = True

        def check_port(path: str, label: str):
            if not path:
                add("error", label, "Missing path")
                return
            if not os.path.exists(path):
                add("error", label, f"{path} does not exist")
                return
            if not os.access(path, os.R_OK | os.W_OK):
                add("error", label, f"Permission denied for {path}")
                return
            add("ok", label, f"{path} is accessible")

        def check_calibration(device_type: str, device_id: str, label: str):
            """캘리브레이션 파일 존재 여부를 확인합니다 (동적 경로)."""
            if not device_id:
                add("warn", label, "Missing device id")
                return
            base = Path.home() / ".cache" / "huggingface" / "lerobot" / "calibration"
            category, dir_name = device_registry.get_calibration_path_prefix(device_type)
            path = base / category / dir_name / f"{device_id}.json"
            if path.exists():
                add("ok", label, f"Found calibration file ({path.name})")
            else:
                add("warn", label, f"Calibration file not found ({path.name})")

        def check_camera(path: str, label: str):
            if not path:
                return
            if not os.path.exists(path):
                add("error", label, f"{path} does not exist")
                return
            if not os.access(path, os.R_OK | os.W_OK):
                add("error", label, f"Permission denied for {path}")
                return
            # If LeStudio already has this camera open (MJPEG preview), skip re-opening
            real_path = str(Path(path).resolve())
            with _streamers_lock:
                already_streaming = real_path in _streamers or real_path in _preview_streamers
            if already_streaming:
                add("ok", label, f"{path} is streaming (ready)")
                return
            cap = None
            try:
                cap = cv2.VideoCapture(path)
                if cap is None or not cap.isOpened():
                    add("warn", label, f"{path} exists but could not be opened (possibly busy)")
                    return
                ok, _ = cap.read()
                if not ok:
                    add("warn", label, f"{path} opened but no frame available yet")
                    return
                add("ok", label, f"{path} is readable")
            except Exception as e:
                add("warn", label, f"Camera probe failed: {e}")
            finally:
                if cap is not None:
                    cap.release()

        mode = data.get("robot_mode", "single")
        # robot_type/teleop_type가 config에 있으면 사용, 없으면 SO-101 기본값 (하위 호환)
        robot_type = data.get("robot_type", "so101_follower")
        teleop_type = data.get("teleop_type", "so101_leader")
        if mode == "single":
            check_port(data.get("follower_port", ""), "Follower arm port")
            check_port(data.get("leader_port", ""), "Leader arm port")
            check_calibration(robot_type, data.get("robot_id", ""), "Follower calibration")
            check_calibration(teleop_type, data.get("teleop_id", ""), "Leader calibration")
        else:
            check_port(data.get("left_follower_port", ""), "Left follower arm port")
            check_port(data.get("right_follower_port", ""), "Right follower arm port")
            check_port(data.get("left_leader_port", ""), "Left leader arm port")
            check_port(data.get("right_leader_port", ""), "Right leader arm port")
            check_calibration(robot_type, data.get("left_robot_id", ""), "Left follower calibration")
            check_calibration(robot_type, data.get("right_robot_id", ""), "Right follower calibration")
            check_calibration(teleop_type, data.get("left_teleop_id", ""), "Left leader calibration")
            check_calibration(teleop_type, data.get("right_teleop_id", ""), "Right leader calibration")

        cameras = data.get("cameras", {}) or {}
        for name, path in cameras.items():
            check_camera(path, f"Camera {name}")

        return {"ok": not hard_error, "checks": checks}

    # ─── API: MJPEG Streaming ──────────────────────────────────────────────
    async def mjpeg_gen(video_path: str, request: Request, preview: bool = False):
        cam_name = Path(video_path).name
        shm_path = f"/dev/shm/lerobot_cam_{cam_name}.jpg"
        use_process_frames = proc_mgr.is_running("record") or proc_mgr.is_running("teleop")
        if use_process_frames and os.path.exists(shm_path):
            while True:
                if await request.is_disconnected():
                    break
                if not (proc_mgr.is_running("record") or proc_mgr.is_running("teleop")):
                    break
                try:
                    with open(shm_path, "rb") as f:
                        frame = f.read()
                    if frame:
                        yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + frame + b"\r\n"
                except Exception:
                    pass
                await asyncio.sleep(1 / 30)

        if _cameras_locked and not (proc_mgr.is_running("record") or proc_mgr.is_running("teleop")):
            unlock_cameras()
        
        if preview:
            streamer = get_preview_streamer(video_path)
        else:
            streamer = get_streamer(video_path, CONFIG_PATH)
        if streamer is None:
            return
        try:
            while True:
                if await request.is_disconnected():
                    break
                if _cameras_locked:
                    break
                if streamer.failed:
                    break
                frame = streamer.latest_frame
                if frame:
                    yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + frame + b"\r\n"
                await asyncio.sleep(1 / 30)
        finally:
            if preview:
                release_preview_streamer(video_path)
            else:
                release_streamer(video_path)
        
    @app.get("/stream/{video_name}")
    async def stream_camera(request: Request, video_name: str, preview: int = 0):
        return StreamingResponse(
            mjpeg_gen(f"/dev/{video_name}", request, preview=bool(preview)),
            media_type="multipart/x-mixed-replace; boundary=frame",
            headers={
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache",
                "Expires": "0",
            },
        )

    # ─── API: Camera Stats ─────────────────────────────────────────────────
    @app.get("/api/camera/stats")
    def api_camera_stats():
        cameras: dict = {}
        bus_data: dict = {}
        with _streamers_lock:
            for real_path, streamer in _streamers.items():
                video_name = Path(real_path).name
                stats    = streamer.get_stats()
                bus_info = get_usb_bus_for_camera(video_name)
                cameras[video_name] = {**stats, **bus_info}
                bus = bus_info["bus"]
                if bus not in bus_data:
                    usable = bus_info["max_mbps"] / 8 * 0.80
                    bus_data[bus] = {"max_mb_per_sec": round(usable, 1), "used_mbps": 0.0}
                bus_data[bus]["used_mbps"] += stats["mbps"]
        for info in bus_data.values():
            info["used_mb_per_sec"] = round(info.pop("used_mbps"), 2)
            info["pct"] = round(
                info["used_mb_per_sec"] / info["max_mb_per_sec"] * 100, 1
            ) if info["max_mb_per_sec"] > 0 else 0
        return {"cameras": cameras, "buses": bus_data}

    # ─── API: GPU Stats ────────────────────────────────────────────────────
    @app.get("/api/gpu/status")
    def api_gpu_status():
        try:
            r = subprocess.run(
                ["nvidia-smi", "--query-gpu=utilization.gpu,memory.used,memory.total", "--format=csv,noheader,nounits"],
                capture_output=True, text=True, timeout=2,
            )
            if r.returncode != 0:
                return {"exists": False, "error": "nvidia-smi failed"}
            lines = r.stdout.strip().splitlines()
            if not lines:
                return {"exists": False, "error": "no output"}
            # Return first GPU stats
            util, mem_used, mem_total = [int(x.strip()) for x in lines[0].split(",")]
            return {
                "exists": True,
                "utilization": util,
                "memory_used": mem_used,
                "memory_total": mem_total,
                "memory_percent": round(mem_used / mem_total * 100, 1) if mem_total > 0 else 0
            }
        except Exception as e:
            return {"exists": False, "error": str(e)}

    @app.get("/api/system/resources")
    def api_system_resources():
        try:
            cpu_pct = psutil.cpu_percent(interval=0.2)
            vm = psutil.virtual_memory()
            du = shutil.disk_usage(Path.home())
            hf_cache = Path.home() / ".cache" / "huggingface" / "lerobot"
            lerobot_du = None
            if hf_cache.exists():
                try:
                    lerobot_bytes = sum(f.stat().st_size for f in hf_cache.rglob('*') if f.is_file())
                    lerobot_du = round(lerobot_bytes / 1024 / 1024, 1)
                except Exception:
                    pass
            return {
                "ok": True,
                "cpu_percent": round(cpu_pct, 1),
                "ram_used_mb": round(vm.used / 1024 / 1024),
                "ram_total_mb": round(vm.total / 1024 / 1024),
                "ram_percent": round(vm.percent, 1),
                "disk_used_gb": round(du.used / 1024 ** 3, 1),
                "disk_total_gb": round(du.total / 1024 ** 3, 1),
                "disk_percent": round(du.used / du.total * 100, 1),
                "lerobot_cache_mb": lerobot_du,
            }
        except Exception as e:
            return {"ok": False, "error": str(e)}

    # ─── API: Session History ──────────────────────────────────────────────
    @app.get("/api/history")
    def api_history(limit: int = 50):
        try:
            if HISTORY_PATH.exists():
                entries = json.loads(HISTORY_PATH.read_text())
                if not isinstance(entries, list):
                    entries = []
                return {"ok": True, "entries": entries[-limit:]}
            return {"ok": True, "entries": []}
        except Exception as e:
            return {"ok": False, "entries": [], "error": str(e)}

    @app.post("/api/history/clear")
    def api_history_clear():
        try:
            if HISTORY_PATH.exists():
                HISTORY_PATH.unlink()
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    # ─── API: Process Control ──────────────────────────────────────────────
    @app.get("/api/process/{name}/status")
    def api_proc_status(name: str):
        return {"running": proc_mgr.is_running(name)}

    @app.post("/api/process/{name}/stop")
    def api_proc_stop(name: str):
        if name not in PROCESS_NAMES:
            return {"ok": False, "error": f"Unknown process: {name}"}

        targets = [name]
        if name == "train":
            targets = ["train_install", "train"]

        for target in targets:
            proc_mgr.stop(target)
        unlock_cameras()
        return {"ok": True, "stopped": targets}

    @app.post("/api/process/{name}/input")
    async def api_proc_input(name: str, data: dict):
        if name not in PROCESS_NAMES:
            return {"ok": False, "error": f"Unknown process: {name}"}

        target = name
        if not proc_mgr.is_running(target):
            if name == "train" and proc_mgr.is_running("train_install"):
                target = "train_install"
            else:
                return {"ok": False, "error": f"{name} is not running"}

        text = data.get("text", "")
        if text is None:
            text = ""
        if not isinstance(text, str):
            text = str(text)

        ok = proc_mgr.send_input(target, text)
        if not ok:
            return {"ok": False, "error": f"Failed to write to {target} stdin"}
        return {"ok": True, "process": target}

    @app.post("/api/process/{name}/command")
    async def api_proc_command(name: str, data: dict | None = None):
        if proc_mgr.is_running(name):
            return {"ok": False, "error": f"{name} is running. Stop it or send stdin input instead."}

        payload = data or {}
        raw_command = str(payload.get("command", "")).strip()
        try:
            args, normalized = _normalize_console_command(PYTHON, raw_command)
        except ValueError as e:
            return {"ok": False, "error": str(e)}

        ok = proc_mgr.start(name, args)
        return {
            "ok": ok,
            "command": normalized,
            "error": None if ok else "Failed to launch command process.",
        }

    # ─── API: Teleop ───────────────────────────────────────────────────────
    @app.post("/api/teleop/start")
    async def api_teleop_start(data: dict):
        if proc_mgr.is_running("teleop"):
            return {"ok": False, "error": "Already running"}
        conflicts = proc_mgr.conflicting_processes("teleop")
        if conflicts:
            return {"ok": False, "error": f"Cannot start: {', '.join(conflicts)} is using shared hardware"}
        stop_all_streamers_for_process()
        args = build_teleop_args(PYTHON, data)
        return {"ok": proc_mgr.start("teleop", args)}

    # ─── API: Record ───────────────────────────────────────────────────────
    @app.post("/api/record/start")
    async def api_record_start(data: dict):
        if proc_mgr.is_running("record"):
            return {"ok": False, "error": "Already running"}
        conflicts = proc_mgr.conflicting_processes("record")
        if conflicts:
            return {"ok": False, "error": f"Cannot start: {', '.join(conflicts)} is using shared hardware"}
        stop_all_streamers_for_process()
        cfg = data
        # Inject camera settings (resolution/fps) from user's config into record args
        cam_settings = _get_cam_settings(CONFIG_PATH)
        cfg["record_cam_width"] = cam_settings.get("width", 640)
        cfg["record_cam_height"] = cam_settings.get("height", 480)
        cfg["record_cam_fps"] = cam_settings.get("fps", 30)
        requested_resume, resume_enabled = resolve_record_resume(cfg)
        args = build_record_args(PYTHON, cfg, resume_enabled)
        ok = proc_mgr.start("record", args)
        if ok:
            append_history("record_start", {
                "repo_id": data.get("record_repo_id", ""),
                "task": data.get("record_task", ""),
                "num_episodes": data.get("record_num_episodes", ""),
            })
        return {
            "ok": ok,
            "resume_requested": requested_resume,
            "resume_enabled": resume_enabled,
        }

    # ─── API: Train ────────────────────────────────────────────────────────
    @app.get("/api/train/preflight")
    def api_train_preflight(device: str = "cuda"):
        dev = (device or "cuda").lower()

        deps = _check_train_python_deps(PYTHON)
        if not deps.get("ok"):
            return {
                "ok": False,
                "reason": deps.get("reason", "Training dependency check failed."),
                "action": deps.get("action", "install_python_dep"),
                "command": deps.get("command", ""),
            }

        if dev != "cuda":
            # non-CUDA: CUDA 체크 스킵, torchcodec만 확인
            tc = _check_torchcodec_compat(PYTHON)
            if tc.get("ok"):
                return {"ok": True, "reason": f"{dev.upper()} selected. {tc['reason']}"}
            cause = tc.get("cause", "unknown")
            action_map = {"missing_cuda_toolkit": "install_cuda_toolkit", "missing_ffmpeg": "install_ffmpeg", "version_mismatch": "install_torchcodec"}
            return {
                "ok": False,
                "reason": tc.get("reason", "torchcodec check failed."),
                "action": action_map.get(cause, "install_torchcodec"),
                "command": tc.get("command", ""),
            }

        ok, reason = _check_cuda_runtime_compat(PYTHON)
        if not ok:
            install_args = _build_torch_install_args(PYTHON, cuda_tag="cu128", nightly=True)
            return {
                "ok": False,
                "reason": f"{reason} Switch Compute Device to CPU/MPS or install a CUDA-compatible PyTorch build.",
                "action": "install_torch_cuda",
                "command": _format_cmd(install_args),
            }

        # CUDA OK → torchcodec 체크
        tc = _check_torchcodec_compat(PYTHON)
        if tc.get("ok"):
            return {"ok": True, "reason": f"{reason} | {tc['reason']}"}
        cause = tc.get("cause", "unknown")
        action_map = {"missing_cuda_toolkit": "install_cuda_toolkit", "missing_ffmpeg": "install_ffmpeg", "version_mismatch": "install_torchcodec"}
        return {
            "ok": False,
            "reason": tc.get("reason", "torchcodec check failed."),
            "action": action_map.get(cause, "install_torchcodec"),
            "command": tc.get("command", ""),
        }

    @app.get("/api/deps/status")
    def api_deps_status():
        return {
            "ok": True,
            "huggingface_cli": bool(shutil.which("huggingface-cli")),
        }

    @app.post("/api/train/install_pytorch")
    async def api_train_install_pytorch(data: dict | None = None):
        if proc_mgr.is_running("train"):
            return {"ok": False, "error": "Stop training before installing PyTorch."}
        if proc_mgr.is_running("train_install"):
            return {"ok": False, "error": "PyTorch installer is already running."}

        payload = data or {}
        cuda_tag = str(payload.get("cuda_tag", "cu128")).strip() or "cu128"
        nightly = bool(payload.get("nightly", True))
        args = _build_torch_install_args(PYTHON, cuda_tag=cuda_tag, nightly=nightly)

        ok = proc_mgr.start("train_install", args)
        return {
            "ok": ok,
            "command": _format_cmd(args),
            "error": None if ok else "Failed to launch installer process.",
        }

    @app.post("/api/train/install_torchcodec_fix")
    async def api_train_install_torchcodec_fix(data: dict | None = None):
        if proc_mgr.is_running("train"):
            return {"ok": False, "error": "Stop training before installing."}
        if proc_mgr.is_running("train_install"):
            return {"ok": False, "error": "Another installer is already running."}
        payload = data or {}
        command = str(payload.get("command", "")).strip()
        if not command:
            return {"ok": False, "error": "No install command provided."}
        args = _parse_install_args(command, PYTHON)
        if not args:
            return {"ok": False, "error": "Invalid install command."}
        ok = proc_mgr.start("train_install", args)
        return {
            "ok": ok,
            "command": " ".join(args),
            "error": None if ok else "Failed to launch installer process.",
        }

    def ensure_train_installer(command: str) -> tuple[bool, bool]:
        if proc_mgr.is_running("train_install"):
            return True, True
        args = _parse_install_args(command, PYTHON)
        if not args:
            return False, False
        return proc_mgr.start("train_install", args), False

    @app.post("/api/train/start")
    async def api_train_start(data: dict):
        if proc_mgr.is_running("train"):
            return {"ok": False, "error": "Already running"}
        conflicts = proc_mgr.conflicting_processes("train")
        if conflicts:
            return {"ok": False, "error": f"Cannot start: {', '.join(conflicts)} is using shared hardware"}

        deps = _check_train_python_deps(PYTHON)
        if not deps.get("ok"):
            command = str(deps.get("command", "")).strip()
            reason = str(deps.get("reason", "Missing required Python package for training.")).strip()
            ok_install, already_running = ensure_train_installer(command)
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

        tc = _check_torchcodec_compat(PYTHON)
        if not tc.get("ok"):
            command = str(tc.get("command", "")).strip()
            reason = str(tc.get("reason", "torchcodec check failed.")).strip()
            ok_install, already_running = ensure_train_installer(command)
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
            ok, reason = _check_cuda_runtime_compat(PYTHON)
            if not ok:
                return {
                    "ok": False,
                    "error": f"{reason} Switch Compute Device to CPU/MPS or install a CUDA-compatible PyTorch build.",
                }

        args = build_train_args(PYTHON, data)
        ok = proc_mgr.start("train", args)
        if ok:
            append_history("train_start", {
                "policy": data.get("train_policy", ""),
                "repo_id": data.get("train_repo_id", ""),
                "steps": data.get("train_steps", ""),
                "device": data.get("train_device", ""),
            })
        return {"ok": ok}


    @app.get("/api/checkpoints")
    def api_checkpoints():
        """Scan outputs/train/ for available checkpoints (flat & timestamped runs)."""
        results = []
        seen_paths = set()

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
                ckpt = {
                    "name": name,
                    "display": display,
                    "path": str(entry / "pretrained_model"),
                    "step": None,
                    "policy": None,
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

                # Read policy type from pretrained_model/train_config.json
                train_cfg = pretrained / "train_config.json"
                if train_cfg.exists():
                    try:
                        tc = json.loads(train_cfg.read_text())
                        ckpt["policy"] = tc.get("policy", {}).get("type") or tc.get("policy_type")
                    except Exception:
                        pass

                # Calculate size and modification time
                total_bytes = 0
                latest_mtime = 0
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

        # Pattern 1: outputs/train/checkpoints/ (flat)
        _scan_checkpoints_dir(Path("outputs/train/checkpoints"))

        # Pattern 2: outputs/train/<run_name>/checkpoints/ (timestamped)
        train_root = Path("outputs/train")
        if train_root.is_dir():
            for run_dir in train_root.iterdir():
                if run_dir.name == "checkpoints":
                    continue  # already scanned above
                if run_dir.is_dir():
                    _scan_checkpoints_dir(run_dir / "checkpoints", run_dir.name)

        # Sort: 'last' first, then by step descending, then by modified
        def sort_key(c):
            if c["name"] == "last":
                return (0, 0, "")
            if c["name"] == "best":
                return (1, 0, "")
            return (2, -(c["step"] or 0), c["modified"] or "")
        results.sort(key=sort_key)

        return {"ok": True, "checkpoints": results}

    @app.post("/api/eval/start")
    async def api_eval_start(data: dict):
        if proc_mgr.is_running("eval"):
            return {"ok": False, "error": "Already running"}
        conflicts = proc_mgr.conflicting_processes("eval")
        if conflicts:
            return {"ok": False, "error": f"Cannot start: {', '.join(conflicts)} is using shared hardware"}

        deps = _check_train_python_deps(PYTHON)
        if not deps.get("ok"):
            command = str(deps.get("command", "")).strip()
            reason = str(deps.get("reason", "Missing required Python package for evaluation.")).strip()
            ok_install, already_running = ensure_train_installer(command)
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

        tc = _check_torchcodec_compat(PYTHON)
        if not tc.get("ok"):
            command = str(tc.get("command", "")).strip()
            reason = str(tc.get("reason", "torchcodec check failed.")).strip()
            ok_install, already_running = ensure_train_installer(command)
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
            ok, reason = _check_cuda_runtime_compat(PYTHON)
            if not ok:
                return {
                    "ok": False,
                    "error": f"{reason} Switch Compute Device to CPU/MPS or install a CUDA-compatible PyTorch build.",
                }

        args = build_eval_args(PYTHON, data)
        ok = proc_mgr.start("eval", args)
        if ok:
            append_history("eval_start", {
                "policy_path": data.get("eval_policy_path", ""),
                "device": data.get("eval_device", ""),
            })
        return {"ok": ok}

    # ─── API: Calibrate ────────────────────────────────────────────────────
    @app.get("/api/calibrate/file")
    def api_calibrate_file(robot_type: str, robot_id: str):
        base = Path.home() / ".cache" / "huggingface" / "lerobot" / "calibration"
        category, dir_name = device_registry.get_calibration_path_prefix(robot_type)
        path = base / category / dir_name / f"{robot_id}.json"
        if path.exists():
            mtime = path.stat().st_mtime
            mdate = datetime.datetime.fromtimestamp(mtime).strftime('%Y-%m-%d %H:%M:%S')
            return {
                "exists": True,
                "path": str(path),
                "modified": mdate,
                "size": path.stat().st_size,
            }
        return {"exists": False, "path": str(path)}

    @app.get("/api/calibrate/list")
    def api_calibrate_list():
        base = Path.home() / ".cache" / "huggingface" / "lerobot" / "calibration"
        files = []
        if base.exists():
            for p in base.rglob("*.json"):
                if not p.is_file():
                    continue
                mtime = p.stat().st_mtime
                mdate = datetime.datetime.fromtimestamp(mtime).strftime('%Y-%m-%d %H:%M:%S')
                rel = p.relative_to(base)
                path_str = str(rel)
                guessed_type = "so101_follower"
                if "leader" in path_str:
                    guessed_type = "so100_leader" if "100" in p.stem else "so101_leader"
                else:
                    guessed_type = "so100_follower" if "100" in p.stem else "so101_follower"
                files.append({
                    "id": p.stem,
                    "rel_path": path_str,
                    "modified": mdate,
                    "timestamp": mtime,
                    "size": p.stat().st_size,
                    "guessed_type": guessed_type,
                })
        files.sort(key=lambda x: x["timestamp"], reverse=True)
        return {"files": files}

    @app.delete("/api/calibrate/file")
    def api_calibrate_delete(robot_type: str, robot_id: str):
        base = Path.home() / ".cache" / "huggingface" / "lerobot" / "calibration"
        try:
            category, dir_name = device_registry.get_calibration_path_prefix(robot_type)
        except Exception as e:
            return {"ok": False, "error": f"Unknown robot_type '{robot_type}': {e}"}
        path = base / category / dir_name / f"{robot_id}.json"
        if path.exists():
            try:
                path.unlink()
                return {"ok": True}
            except Exception as e:
                return {"ok": False, "error": str(e)}
        return {"ok": False, "error": "File not found"}

    @app.post("/api/calibrate/start")
    async def api_calibrate_start(data: dict):
        if proc_mgr.is_running("calibrate"):
            return {"ok": False, "error": "Already running"}
        conflicts = proc_mgr.conflicting_processes("calibrate")
        if conflicts:
            return {"ok": False, "error": f"Cannot start: {', '.join(conflicts)} is using shared hardware"}
        args = build_calibrate_args(PYTHON, data)
        ok = proc_mgr.start("calibrate", args)
        if ok:
            append_history("calibrate_start", {
                "robot_type": data.get("calibrate_robot_type", ""),
                "robot_id": data.get("calibrate_robot_id", ""),
            })
        return {"ok": ok}

    # ─── API: Dataset Viewer ───────────────────────────────────────────────
    @app.get("/api/datasets")
    def api_datasets_list():
        base = Path.home() / ".cache" / "huggingface" / "lerobot"
        datasets = []
        if base.exists():
            for user_dir in base.iterdir():
                if not user_dir.is_dir():
                    continue
                for ds_dir in user_dir.iterdir():
                    if not ds_dir.is_dir():
                        continue
                    info_path = ds_dir / "meta" / "info.json"
                    if info_path.exists():
                        try:
                            info = json.loads(info_path.read_text())
                            mtime = info_path.stat().st_mtime
                            mdate = datetime.datetime.fromtimestamp(mtime).strftime('%Y-%m-%d %H:%M:%S')
                            data_size_raw = info.get("data_files_size_in_mb", 0)
                            video_size_raw = info.get("video_files_size_in_mb", 0)
                            try:
                                info_size = float(data_size_raw or 0) + float(video_size_raw or 0)
                            except Exception:
                                info_size = 0.0

                            disk_size = 0.0
                            try:
                                total_bytes = sum(f.stat().st_size for f in ds_dir.rglob('*') if f.is_file())
                                disk_size = round(total_bytes / (1024 * 1024), 1)
                            except Exception:
                                disk_size = 0.0

                            info_size = disk_size if disk_size > 0 else round(info_size, 1)
                            datasets.append({
                                "id": f"{user_dir.name}/{ds_dir.name}",
                                "total_episodes": info.get("total_episodes", 0),
                                "total_frames": info.get("total_frames", 0),
                                "fps": info.get("fps", 30),
                                "modified": mdate,
                                "timestamp": mtime,
                                "size_mb": info_size
                            })
                        except Exception:
                            pass
        datasets.sort(key=lambda x: x["timestamp"], reverse=True)
        return {"datasets": datasets}

    @app.get("/api/datasets/{user}/{repo}")
    def api_dataset_info(user: str, repo: str):
        repo_id = f"{user}/{repo}"
        base = Path.home() / ".cache" / "huggingface" / "lerobot" / user / repo
        info_path = base / "meta" / "info.json"
        
        if not info_path.exists():
            from fastapi.responses import JSONResponse
            return JSONResponse(status_code=404, content={"detail": "Dataset not found"})

        try:
            info = json.loads(info_path.read_text())
            cameras = [k for k, v in info.get("features", {}).items() if v.get("dtype") == "video"]

            episodes = []
            episodes_dir = base / "meta" / "episodes"
            if episodes_dir.exists():
                try:
                    pd = __import__("pandas")

                    rows = []
                    for pq_path in sorted(episodes_dir.glob("**/*.parquet")):
                        try:
                            base_cols = ["episode_index", "length", "tasks"]
                            video_cols = []
                            for cam in cameras:
                                video_cols.append(f"videos/{cam}/chunk_index")
                                video_cols.append(f"videos/{cam}/file_index")
                                video_cols.append(f"videos/{cam}/from_timestamp")
                                video_cols.append(f"videos/{cam}/to_timestamp")
                            try:
                                df = pd.read_parquet(pq_path, columns=base_cols + video_cols)
                            except Exception:
                                df = pd.read_parquet(pq_path)
                            for _, row in df.iterrows():
                                tasks = row.get("tasks", [])
                                if tasks is None:
                                    tasks = []
                                elif not isinstance(tasks, list):
                                    tasks = list(tasks)
                                length_value = row.get("length", row.get("episode_length", row.get("num_frames", row.get("frame_count", 0))))
                                if length_value is None or pd.isna(length_value):
                                    length_value = 0
                                episode_index_value = row.get("episode_index", row.get("episode_id", 0))
                                if episode_index_value is None or pd.isna(episode_index_value):
                                    episode_index_value = 0
                                video_files = {}
                                for cam in cameras:
                                    chunk_key = f"videos/{cam}/chunk_index"
                                    file_key = f"videos/{cam}/file_index"
                                    from_key = f"videos/{cam}/from_timestamp"
                                    to_key = f"videos/{cam}/to_timestamp"
                                    if chunk_key in row and file_key in row:
                                        chunk_val = row.get(chunk_key)
                                        file_val = row.get(file_key)
                                        if not pd.isna(chunk_val) and not pd.isna(file_val):
                                            from_val = row.get(from_key) if from_key in row else None
                                            to_val = row.get(to_key) if to_key in row else None
                                            video_files[cam] = {
                                                "chunk_index": int(chunk_val),
                                                "file_index": int(file_val),
                                                "from_timestamp": None if from_val is None or pd.isna(from_val) else float(from_val),
                                                "to_timestamp": None if to_val is None or pd.isna(to_val) else float(to_val),
                                            }
                                rows.append({
                                    "episode_index": int(episode_index_value),
                                    "length": int(length_value),
                                    "tasks": tasks,
                                    "video_files": video_files,
                                })
                        except Exception:
                            continue

                    rows.sort(key=lambda x: x["episode_index"])
                    episodes = rows
                except Exception:
                    episodes = []

            if not episodes:
                for ep_idx in range(info.get("total_episodes", 0)):
                    episodes.append({
                        "episode_index": ep_idx,
                        "length": 0,
                        "tasks": [],
                        "video_files": {},
                    })
            
            return {
                "dataset_id": repo_id,
                "total_episodes": info.get("total_episodes", 0),
                "total_frames": info.get("total_frames", 0),
                "fps": info.get("fps", 30),
                "cameras": cameras,
                "episodes": episodes
            }
        except Exception as e:
            from fastapi.responses import JSONResponse
            return JSONResponse(status_code=500, content={"detail": f"Failed to load dataset: {str(e)}"})

    @app.get("/api/datasets/{user}/{repo}/videos/{camera}/{chunk}/{file}")
    def api_dataset_video(request: Request, user: str, repo: str, camera: str, chunk: str, file: str):
        # Serve MP4 with HTTP 206 Range support so browser <video> can seek freely
        video_path = Path.home() / ".cache" / "huggingface" / "lerobot" / user / repo / "videos" / camera / chunk / file
        if not video_path.exists():
            return Response(status_code=404, content="Video not found")
        file_size = video_path.stat().st_size
        range_header = request.headers.get("range")
        if range_header:
            try:
                range_val = range_header.strip().lower().replace("bytes=", "")
                start_str, end_str = range_val.split("-", 1)
                start = int(start_str) if start_str else 0
                end = int(end_str) if end_str else file_size - 1
            except Exception:
                return Response(status_code=416, headers={"Content-Range": f"bytes */{file_size}"})
            start = max(0, min(start, file_size - 1))
            end = max(start, min(end, file_size - 1))
            chunk_size = end - start + 1
            def _iter_file(path: Path, s: int, length: int, buf: int = 1 << 20):
                with open(path, "rb") as fh:
                    fh.seek(s)
                    remaining = length
                    while remaining > 0:
                        data = fh.read(min(buf, remaining))
                        if not data:
                            break
                        remaining -= len(data)
                        yield data
            headers = {
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(chunk_size),
                "Content-Type": "video/mp4",
            }
            return StreamingResponse(
                _iter_file(video_path, start, chunk_size),
                status_code=206,
                headers=headers,
                media_type="video/mp4",
            )
        # Full response (first load - no Range header)
        from fastapi.responses import FileResponse
        return FileResponse(video_path, media_type="video/mp4", headers={"Accept-Ranges": "bytes"})

    @app.delete("/api/datasets/{user}/{repo}")
    def api_dataset_delete(user: str, repo: str):
        base = Path.home() / ".cache" / "huggingface" / "lerobot" / user / repo
        if not base.exists():
            from fastapi.responses import JSONResponse
            return JSONResponse(status_code=404, content={"detail": "Dataset not found"})
        try:
            import shutil
            shutil.rmtree(base)
            return {"ok": True}
        except Exception as e:
            from fastapi.responses import JSONResponse
            return JSONResponse(status_code=500, content={"detail": f"Failed to delete dataset: {str(e)}"})

    @app.get("/api/datasets/{user}/{repo}/quality")
    def api_dataset_quality(user: str, repo: str):
        base = Path.home() / ".cache" / "huggingface" / "lerobot" / user / repo
        info_path = base / "meta" / "info.json"
        if not info_path.exists():
            return {"ok": False, "error": "Dataset not found"}

        checks = []
        score = 100
        category_weight = {
            "metadata": 1.2,
            "episodes": 1.1,
            "videos": 1.4,
            "distribution": 0.8,
            "general": 1.0,
        }
        category_penalty: dict[str, int] = {k: 0 for k in category_weight.keys()}

        def add_check(level: str, name: str, message: str, category: str = "general"):
            nonlocal score
            cat = category if category in category_weight else "general"
            checks.append({"level": level, "name": name, "message": message, "category": cat})
            base = 0
            if level == "error":
                base = 20
            elif level == "warn":
                base = 8
            if base > 0:
                penalty = int(round(base * category_weight[cat]))
                category_penalty[cat] += penalty
                score -= penalty

        try:
            info = json.loads(info_path.read_text())
        except Exception as e:
            return {"ok": False, "error": f"Failed to parse info.json: {e}"}

        total_expected = int(info.get("total_episodes", 0) or 0)
        total_frames = int(info.get("total_frames", 0) or 0)
        fps = int(info.get("fps", 0) or 0)
        if fps <= 0:
            add_check("error", "fps", "FPS in info.json is invalid or missing", "metadata")
        elif fps < 5:
            add_check("warn", "fps", f"FPS is low ({fps})", "metadata")
        else:
            add_check("ok", "fps", f"FPS looks valid ({fps})", "metadata")

        cameras = [k for k, v in info.get("features", {}).items() if isinstance(v, dict) and v.get("dtype") == "video"]
        if not cameras:
            add_check("warn", "cameras", "No video camera features found in dataset metadata", "metadata")
        else:
            add_check("ok", "cameras", f"Detected {len(cameras)} camera streams", "metadata")

        episodes = []
        episodes_dir = base / "meta" / "episodes"
        if episodes_dir.exists():
            try:
                pd = __import__("pandas")
                for pq_path in sorted(episodes_dir.glob("**/*.parquet")):
                    try:
                        df = pd.read_parquet(pq_path, columns=["episode_index", "length"])
                    except Exception:
                        try:
                            df = pd.read_parquet(pq_path, columns=["episode_index", "episode_length"])
                        except Exception:
                            df = pd.read_parquet(pq_path)
                    for _, row in df.iterrows():
                        length_value = row.get("length", row.get("episode_length", row.get("num_frames", row.get("frame_count", 0))))
                        if length_value is None or pd.isna(length_value):
                            length_value = 0
                        episode_index_value = row.get("episode_index", row.get("episode_id", 0))
                        if episode_index_value is None or pd.isna(episode_index_value):
                            episode_index_value = 0
                        episodes.append({
                            "episode_index": int(episode_index_value),
                            "length": int(length_value),
                        })
            except Exception as e:
                add_check("warn", "episodes", f"Could not parse episode parquet files: {e}", "episodes")

        actual_episodes = len(episodes)
        if total_expected > 0 and actual_episodes > 0 and actual_episodes != total_expected:
            add_check("warn", "episode_count", f"Expected {total_expected} episodes, found {actual_episodes}", "episodes")
        else:
            add_check("ok", "episode_count", f"Episode count: {max(total_expected, actual_episodes)}", "episodes")

        non_positive_lengths = [ep for ep in episodes if ep["length"] <= 0]
        if non_positive_lengths:
            add_check("warn", "episode_length_zero", f"Episodes with non-positive length: {len(non_positive_lengths)}", "episodes")

        zero_byte_videos = 0
        total_videos = 0
        per_camera_files: dict[str, int] = {cam: 0 for cam in cameras}
        videos_root = base / "videos"
        if videos_root.exists():
            for p in videos_root.rglob("*.mp4"):
                total_videos += 1
                parts = p.parts
                if "videos" in parts:
                    idx = parts.index("videos")
                    if idx + 1 < len(parts):
                        cam_name = parts[idx + 1]
                        per_camera_files[cam_name] = per_camera_files.get(cam_name, 0) + 1
                try:
                    if p.stat().st_size == 0:
                        zero_byte_videos += 1
                except Exception:
                    zero_byte_videos += 1

        if total_videos == 0:
            add_check("warn", "videos", "No video files found under videos/", "videos")
        elif zero_byte_videos > 0:
            add_check("warn", "videos", f"Found {zero_byte_videos} zero-byte/corrupt candidate video files", "videos")
        else:
            add_check("ok", "videos", f"Video files present: {total_videos}", "videos")

        missing_camera_files = [cam for cam, cnt in per_camera_files.items() if cnt <= 0]
        if cameras and missing_camera_files:
            add_check("warn", "camera_coverage", f"Cameras without any video files: {', '.join(missing_camera_files)}", "videos")
        elif cameras:
            add_check("ok", "camera_coverage", "All camera streams have video files", "videos")

        avg_ep_len = 0
        median_ep_len = 0
        if episodes:
            lengths = sorted(ep["length"] for ep in episodes)
            avg_ep_len = round(sum(lengths) / max(1, len(lengths)), 2)
            mid = len(lengths) // 2
            if len(lengths) % 2 == 0:
                median_ep_len = round((lengths[mid - 1] + lengths[mid]) / 2, 2)
            else:
                median_ep_len = round(lengths[mid], 2)
            if avg_ep_len <= 1:
                add_check("warn", "episode_length", "Average episode length is very short", "distribution")
            else:
                add_check("ok", "episode_length", f"Average episode length: {avg_ep_len} frames", "distribution")

            if median_ep_len > 0:
                ratio = avg_ep_len / max(1e-6, median_ep_len)
                if ratio > 2.5 or ratio < 0.4:
                    add_check("warn", "episode_length_distribution", "Episode lengths are highly imbalanced", "distribution")
                else:
                    add_check("ok", "episode_length_distribution", "Episode length distribution looks reasonable", "distribution")

        if total_frames <= 0:
            add_check("warn", "total_frames", "Total frame count is zero or missing", "metadata")
        else:
            add_check("ok", "total_frames", f"Total frames: {total_frames}", "metadata")

        score = max(0, min(100, score))
        has_error = any(c["level"] == "error" for c in checks)
        return {
            "ok": not has_error,
            "score": score,
            "checks": checks,
            "score_breakdown": category_penalty,
            "stats": {
                "dataset_id": f"{user}/{repo}",
                "total_expected_episodes": total_expected,
                "total_detected_episodes": actual_episodes,
                "total_frames": total_frames,
                "fps": fps,
                "camera_count": len(cameras),
                "camera_file_counts": per_camera_files,
                "video_files": total_videos,
                "zero_byte_videos": zero_byte_videos,
                "avg_episode_length": avg_ep_len,
                "median_episode_length": median_ep_len,
                "non_positive_episode_count": len(non_positive_lengths),
            },
        }

    @app.get("/api/datasets/{user}/{repo}/tags")
    def api_episode_tags_get(user: str, repo: str):
        tags_dir = config_dir / "episode-tags"
        tags_file = tags_dir / f"{user}_{repo}.json"
        if tags_file.exists():
            try:
                tags = json.loads(tags_file.read_text())
            except Exception:
                tags = {}
        else:
            tags = {}
        return {"ok": True, "tags": tags}

    @app.post("/api/datasets/{user}/{repo}/tags")
    def api_episode_tags_post(user: str, repo: str, body: dict | None = None):
        payload = body or {}
        episode_index = str(payload.get("episode_index", ""))
        tag = str(payload.get("tag", "untagged"))
        VALID_TAGS = {"good", "bad", "review", "untagged"}
        if tag not in VALID_TAGS:
            return {"ok": False, "error": f"Invalid tag. Must be one of: {', '.join(sorted(VALID_TAGS))}"}
        if not episode_index:
            return {"ok": False, "error": "episode_index is required"}
        tags_dir = config_dir / "episode-tags"
        tags_dir.mkdir(parents=True, exist_ok=True)
        tags_file = tags_dir / f"{user}_{repo}.json"
        if tags_file.exists():
            try:
                tags = json.loads(tags_file.read_text())
            except Exception:
                tags = {}
        else:
            tags = {}
        if tag == "untagged":
            tags.pop(episode_index, None)
        else:
            tags[episode_index] = tag
        tags_file.write_text(json.dumps(tags, indent=2))
        return {"ok": True, "episode_index": episode_index, "tag": tag}

    @app.post("/api/datasets/{user}/{repo}/push")
    async def api_dataset_push(user: str, repo: str, data: dict | None = None):
        payload = data or {}
        local_path = Path.home() / ".cache" / "huggingface" / "lerobot" / user / repo
        if not local_path.exists():
            return {"ok": False, "error": "Dataset not found in local cache"}

        target_repo_id = str(payload.get("target_repo_id", f"{user}/{repo}")).strip() or f"{user}/{repo}"
        private = bool(payload.get("private", False))

        token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_HUB_TOKEN")
        if not token:
            return {"ok": False, "error": "HF_TOKEN (or HUGGINGFACE_HUB_TOKEN) is not set"}

        cli = shutil.which("huggingface-cli")
        if not cli:
            return {"ok": False, "error": "huggingface-cli is not installed in this environment"}

        job_id = uuid.uuid4().hex[:12]
        now = time.time()
        with push_jobs_lock:
            push_jobs[job_id] = {
                "job_id": job_id,
                "status": "queued",
                "phase": "queued",
                "progress": 0,
                "repo_id": target_repo_id,
                "dataset_id": f"{user}/{repo}",
                "started_at": now,
                "updated_at": now,
                "logs": [],
                "error": "",
            }

        def run_push_job():
            with push_jobs_lock:
                if job_id not in push_jobs:
                    return
                push_jobs[job_id]["status"] = "running"
                push_jobs[job_id]["phase"] = "preparing"
                push_jobs[job_id]["progress"] = 5
                push_jobs[job_id]["updated_at"] = time.time()

            cmd = [cli, "upload", target_repo_id, str(local_path), ".", "--repo-type", "dataset"]
            if private:
                cmd.append("--private")

            try:
                proc = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    env={**os.environ, "HF_TOKEN": token, "HUGGINGFACE_HUB_TOKEN": token},
                    bufsize=1,
                )
            except Exception as e:
                with push_jobs_lock:
                    push_jobs[job_id]["status"] = "error"
                    push_jobs[job_id]["error"] = str(e)
                    push_jobs[job_id]["updated_at"] = time.time()
                return

            progress = 5
            if proc.stdout is not None:
                for raw in proc.stdout:
                    line = raw.rstrip("\n")
                    with push_jobs_lock:
                        job = push_jobs.get(job_id)
                        if not job:
                            continue
                        logs = job["logs"]
                        logs.append(line)
                        if len(logs) > 300:
                            del logs[:-300]

                        job["phase"] = "uploading"

                        m = re.search(r"(\d{1,3})%", line)
                        ratio = re.search(r"\b([0-9]{1,6})\s*/\s*([0-9]{1,6})\b", line)
                        if m:
                            pct = max(0, min(99, int(m.group(1))))
                            progress = max(progress, pct)
                        elif ratio:
                            done = int(ratio.group(1))
                            total = max(1, int(ratio.group(2)))
                            pct = max(0, min(99, int((done / total) * 100)))
                            progress = max(progress, pct)
                        else:
                            progress = min(95, progress + 1)
                        job["progress"] = progress
                        job["updated_at"] = time.time()

            rc = proc.wait()
            with push_jobs_lock:
                job = push_jobs.get(job_id)
                if not job:
                    return
                if rc == 0:
                    job["phase"] = "finalizing"
                    job["progress"] = max(97, int(job.get("progress", 0)))
                    job["updated_at"] = time.time()
                    job["status"] = "success"
                    job["phase"] = "completed"
                    job["progress"] = 100
                else:
                    job["status"] = "error"
                    job["phase"] = "error"
                    if not job["error"]:
                        tail = "\n".join(job["logs"][-5:]).strip()
                        job["error"] = tail or f"Upload failed with exit code {rc}"
                job["updated_at"] = time.time()

        threading.Thread(target=run_push_job, daemon=True).start()
        return {"ok": True, "job_id": job_id}

    @app.get("/api/datasets/push/status/{job_id}")
    def api_dataset_push_status(job_id: str):
        with push_jobs_lock:
            job = push_jobs.get(job_id)
            if not job:
                return {"ok": False, "error": "Push job not found"}
            return {"ok": True, **job}

    # ─── API: HF Identity ─────────────────────────────────────────────────
    @app.get("/api/hf/whoami")
    def api_hf_whoami():
        """Return the HuggingFace username associated with the current token."""
        token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_HUB_TOKEN")
        if not token:
            return {"ok": False, "username": None, "error": "no_token"}
        try:
            from huggingface_hub import whoami  # type: ignore
            info = whoami(token=token)
            username = info.get("name", None) if isinstance(info, dict) else None
            if not username:
                return {"ok": False, "username": None, "error": "no_username"}
            return {"ok": True, "username": username}
        except ImportError:
            return {"ok": False, "username": None, "error": "huggingface_hub_not_installed"}
        except Exception:
            return {"ok": False, "username": None, "error": "auth_failed"}

    # ─── API: HF Hub Dataset Search / Download ──────────────────────────────
    download_jobs: dict[str, dict] = {}
    download_jobs_lock = threading.Lock()

    @app.get("/api/hub/datasets/search")
    def api_hub_datasets_search(query: str = "", limit: int = 20, tag: str = "lerobot"):
        """Search HuggingFace Hub for LeRobot datasets."""
        try:
            from huggingface_hub import list_datasets  # type: ignore
        except ImportError:
            return {"ok": False, "error": "huggingface_hub is not installed", "datasets": []}

        limit = max(1, min(limit, 100))
        try:
            search_tags = [tag] if tag else []
            kwargs: dict = {"tags": search_tags, "limit": limit, "full": False}
            if query:
                kwargs["search"] = query
            results = []
            for ds in list_datasets(**kwargs):
                entry = {
                    "id": ds.id,
                    "downloads": getattr(ds, "downloads", 0) or 0,
                    "likes": getattr(ds, "likes", 0) or 0,
                    "tags": list(getattr(ds, "tags", []) or []),
                    "last_modified": str(getattr(ds, "last_modified", "") or ""),
                }
                results.append(entry)
            return {"ok": True, "datasets": results}
        except Exception as e:
            return {"ok": False, "error": str(e), "datasets": []}

    @app.post("/api/hub/datasets/download")
    async def api_hub_datasets_download(data: dict | None = None):
        """Download a dataset from HuggingFace Hub to local cache."""
        payload = data or {}
        repo_id = str(payload.get("repo_id", "")).strip()
        if not repo_id or "/" not in repo_id:
            return {"ok": False, "error": "repo_id must be in user/repo format"}

        job_id = uuid.uuid4().hex[:12]
        now = time.time()
        with download_jobs_lock:
            download_jobs[job_id] = {
                "job_id": job_id,
                "repo_id": repo_id,
                "status": "queued",
                "progress": 0,
                "logs": [],
                "error": "",
                "started_at": now,
                "updated_at": now,
            }

        def run_download_job():
            with download_jobs_lock:
                job = download_jobs.get(job_id)
                if not job:
                    return
                job["status"] = "running"
                job["progress"] = 5
                job["updated_at"] = time.time()

            rc = -1
            try:
                from huggingface_hub import snapshot_download  # type: ignore
                local_dir = Path.home() / ".cache" / "huggingface" / "lerobot" / repo_id
                cli = shutil.which("huggingface-cli")
                if cli:
                    cmd = [cli, "download", repo_id, "--repo-type", "dataset", "--local-dir", str(local_dir)]
                    env = {**os.environ}
                    proc = subprocess.Popen(
                        cmd,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.STDOUT,
                        text=True,
                        env=env,
                        bufsize=1,
                    )
                    progress = 5
                    if proc.stdout:
                        for raw in proc.stdout:
                            line = raw.rstrip("\n")
                            with download_jobs_lock:
                                job2 = download_jobs.get(job_id)
                                if not job2:
                                    continue
                                job2["logs"].append(line)
                                if len(job2["logs"]) > 200:
                                    del job2["logs"][:-200]
                                m = re.search(r"(\d{1,3})%", line)
                                ratio = re.search(r"\b([0-9]{1,6})\s*/\s*([0-9]{1,6})\b", line)
                                if m:
                                    pct = max(0, min(99, int(m.group(1))))
                                    progress = max(progress, pct)
                                elif ratio:
                                    done = int(ratio.group(1))
                                    total = max(1, int(ratio.group(2)))
                                    pct = max(0, min(99, int((done / total) * 100)))
                                    progress = max(progress, pct)
                                else:
                                    progress = min(95, progress + 1)
                                job2["progress"] = progress
                                job2["updated_at"] = time.time()
                    rc = proc.wait()
                else:
                    snapshot_download(repo_id=repo_id, repo_type="dataset", local_dir=str(local_dir))
                    rc = 0

                with download_jobs_lock:
                    job3 = download_jobs.get(job_id)
                    if not job3:
                        return
                    if rc == 0:
                        job3["status"] = "success"
                        job3["progress"] = 100
                    else:
                        job3["status"] = "error"
                        tail = "\n".join(job3["logs"][-5:]).strip()
                        job3["error"] = tail or f"Download failed (exit {rc})"
                    job3["updated_at"] = time.time()

            except Exception as e:
                with download_jobs_lock:
                    job4 = download_jobs.get(job_id)
                    if job4:
                        job4["status"] = "error"
                        job4["error"] = str(e)
                        job4["updated_at"] = time.time()

        threading.Thread(target=run_download_job, daemon=True).start()
        return {"ok": True, "job_id": job_id}

    @app.get("/api/hub/datasets/download/status/{job_id}")
    def api_hub_download_status(job_id: str):
        with download_jobs_lock:
            job = download_jobs.get(job_id)
            if not job:
                return {"ok": False, "error": "Download job not found"}
            return {"ok": True, **job}

    # ─── API: Motor Setup ──────────────────────────────────────────────────
    @app.post("/api/motor_setup/start")
    async def api_motor_setup_start(data: dict):
        if proc_mgr.is_running("motor_setup"):
            return {"ok": False, "error": "Already running"}
        conflicts = proc_mgr.conflicting_processes("motor_setup")
        if conflicts:
            return {"ok": False, "error": f"Cannot start: {', '.join(conflicts)} is using shared hardware"}
        args = build_motor_setup_args(PYTHON, data)
        return {"ok": proc_mgr.start("motor_setup", args)}

    # ─── WebSocket ─────────────────────────────────────────────────────────
    @app.websocket("/ws")
    async def ws_endpoint(websocket: WebSocket):
        await websocket.accept()
        try:
            while True:
                items = []
                while True:
                    try:
                        items.append(proc_mgr.out_q.get_nowait())
                    except queue.Empty:
                        break
                for item in items:
                    if item.get("kind") == "metric":
                        await websocket.send_json({
                            "type": "metric",
                            "process": item.get("process"),
                            "metric": item.get("metric", {}),
                        })
                    else:
                        await websocket.send_json({"type": "output", **item})
                await websocket.send_json({"type": "status", "processes": proc_mgr.status_all()})
                await asyncio.sleep(0.2)
        except (WebSocketDisconnect, Exception):
            pass

    # ─── Static + Root ─────────────────────────────────────────────────────
    # Vite builds assets to STATIC_DIR with root-relative paths (/assets/...)
    # Mount at "/" with html=True so /assets/* resolves and SPA fallback works.
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
    return app
