#!/usr/bin/env python3
"""LeRobot Studio — Web GUI server (packaged version)."""

import asyncio
import datetime
import json
import os
import queue
import re
import shlex
import shutil
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Optional

import cv2
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from lerobot_studio.command_builders import (
    build_calibrate_args,
    build_eval_args,
    build_motor_setup_args,
    build_record_args,
    build_teleop_args,
    build_train_args,
    resolve_record_resume,
)
from lerobot_studio.process_manager import ProcessManager
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

CAMERA_ROLES = [
    "(none)", "top_cam_1", "top_cam_2", "top_cam_3",
    "follower_cam_1", "follower_cam_2",
]
ROBOT_TYPES = [
    "so101_follower", "so100_follower",
    "so101_leader",   "so100_leader",
]

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
        "front_1": "/dev/follower_cam_1",
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
                fourcc = cv2.VideoWriter_fourcc(*s["codec"])
                cap.set(cv2.CAP_PROP_FOURCC, fourcc)
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
                "rr.init('lerobot_studio_view', spawn=False);"
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
        return {**DEFAULT_CONFIG, **json.loads(config_path.read_text())}
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
    content = _build_rules(assignments, arm_assignments, rules_path)
    tmp = Path("/tmp/99-lerobot.rules.new")
    tmp.write_text(content)
    r = subprocess.run(
        ["sudo", "-n", "cp", str(tmp), str(rules_path)],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        return False, r.stderr or "sudo failed — add NOPASSWD to sudoers for cp/udevadm"
    subprocess.run(["sudo", "-n", "udevadm", "control", "--reload-rules"], capture_output=True)
    subprocess.run(
        ["sudo", "-n", "udevadm", "trigger", "--subsystem-match=video4linux"],
        capture_output=True,
    )
    subprocess.run(
        ["sudo", "-n", "udevadm", "trigger", "--subsystem-match=tty"],
        capture_output=True,
    )
    return True, ""


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
    PYTHON = sys.executable

    app = FastAPI(title="LeRobot Studio")
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

    proc_mgr = ProcessManager(lerobot_src, on_process_exit=_on_process_exit)
    push_jobs: dict[str, dict] = {}
    push_jobs_lock = threading.Lock()

    def load_config() -> dict:
        return _load_config(CONFIG_PATH)

    def save_config(cfg: dict):
        _save_config(CONFIG_PATH, cfg)

    # ─── API: Devices & Config ─────────────────────────────────────────────
    @app.get("/api/devices")
    def api_devices():
        return {"cameras": get_cameras(), "arms": get_arms()}

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
        return ROBOT_TYPES

    # ─── API: udev Rules ───────────────────────────────────────────────────
    @app.get("/api/rules/current")
    def api_rules_current():
        return {"content": rules_path.read_text() if rules_path.exists() else "# File not found"}

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
        ok, err = _apply_rules(
            data.get("assignments", {}),
            data.get("arm_assignments", {}),
            rules_path,
        )
        return {"ok": ok, "error": err}

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

        def check_calibration(robot_type: str, robot_id: str, label: str):
            if not robot_id:
                add("warn", label, "Missing robot id")
                return
            base = Path.home() / ".cache" / "huggingface" / "lerobot" / "calibration"
            if "follower" in robot_type:
                path = base / "robots" / "so_follower" / f"{robot_id}.json"
            else:
                path = base / "teleoperators" / "so_leader" / f"{robot_id}.json"
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
        if mode == "single":
            check_port(data.get("follower_port", ""), "Follower arm port")
            check_port(data.get("leader_port", ""), "Leader arm port")
            check_calibration("follower", data.get("robot_id", ""), "Follower calibration")
            check_calibration("leader", data.get("teleop_id", ""), "Leader calibration")
        else:
            check_port(data.get("left_follower_port", ""), "Left follower arm port")
            check_port(data.get("right_follower_port", ""), "Right follower arm port")
            check_port(data.get("left_leader_port", ""), "Left leader arm port")
            check_port(data.get("right_leader_port", ""), "Right leader arm port")
            check_calibration("follower", data.get("left_robot_id", ""), "Left follower calibration")
            check_calibration("follower", data.get("right_robot_id", ""), "Right follower calibration")
            check_calibration("leader", data.get("left_teleop_id", ""), "Left leader calibration")
            check_calibration("leader", data.get("right_teleop_id", ""), "Right leader calibration")

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

    # ─── API: Process Control ──────────────────────────────────────────────
    @app.get("/api/process/{name}/status")
    def api_proc_status(name: str):
        return {"running": proc_mgr.is_running(name)}

    @app.post("/api/process/{name}/stop")
    def api_proc_stop(name: str):
        proc_mgr.stop(name)
        unlock_cameras()
        return {"ok": True}

    @app.post("/api/process/{name}/input")
    async def api_proc_input(name: str, data: dict):
        proc_mgr.send_input(name, data.get("text", ""))
        return {"ok": True}

    # ─── API: Teleop ───────────────────────────────────────────────────────
    @app.post("/api/teleop/start")
    async def api_teleop_start(data: dict):
        if proc_mgr.is_running("teleop"):
            return {"ok": False, "error": "Already running"}
        stop_all_streamers_for_process()
        args = build_teleop_args(PYTHON, data)
        return {"ok": proc_mgr.start("teleop", args)}

    # ─── API: Record ───────────────────────────────────────────────────────
    @app.post("/api/record/start")
    async def api_record_start(data: dict):
        if proc_mgr.is_running("record"):
            return {"ok": False, "error": "Already running"}
        stop_all_streamers_for_process()
        cfg = data
        # Inject camera settings (resolution/fps) from user's config into record args
        cam_settings = _get_cam_settings(CONFIG_PATH)
        cfg["record_cam_width"] = cam_settings.get("width", 640)
        cfg["record_cam_height"] = cam_settings.get("height", 480)
        cfg["record_cam_fps"] = cam_settings.get("fps", 30)
        requested_resume, resume_enabled = resolve_record_resume(cfg)
        args = build_record_args(PYTHON, cfg, resume_enabled)
        return {
            "ok": proc_mgr.start("record", args),
            "resume_requested": requested_resume,
            "resume_enabled": resume_enabled,
        }

    # ─── API: Train ────────────────────────────────────────────────────────
    @app.get("/api/train/preflight")
    def api_train_preflight(device: str = "cuda"):
        dev = (device or "cuda").lower()
        if dev != "cuda":
            return {"ok": True, "reason": f"{dev.upper()} selected. Compatibility preflight is only required for CUDA."}

        ok, reason = _check_cuda_runtime_compat(PYTHON)
        if ok:
            return {"ok": True, "reason": reason}
        install_args = _build_torch_install_args(PYTHON, cuda_tag="cu128", nightly=True)
        return {
            "ok": False,
            "reason": f"{reason} Switch Compute Device to CPU/MPS or install a CUDA-compatible PyTorch build.",
            "action": "install_torch_cuda",
            "command": _format_cmd(install_args),
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

    @app.post("/api/train/start")
    async def api_train_start(data: dict):
        if proc_mgr.is_running("train"):
            return {"ok": False, "error": "Already running"}

        train_device = str(data.get("train_device", "cuda")).lower()
        if train_device == "cuda":
            ok, reason = _check_cuda_runtime_compat(PYTHON)
            if not ok:
                return {
                    "ok": False,
                    "error": f"{reason} Switch Compute Device to CPU/MPS or install a CUDA-compatible PyTorch build.",
                }

        args = build_train_args(PYTHON, data)
        return {"ok": proc_mgr.start("train", args)}

    @app.post("/api/eval/start")
    async def api_eval_start(data: dict):
        if proc_mgr.is_running("eval"):
            return {"ok": False, "error": "Already running"}

        eval_device = str(data.get("eval_device", "cuda")).lower()
        if eval_device == "cuda":
            ok, reason = _check_cuda_runtime_compat(PYTHON)
            if not ok:
                return {
                    "ok": False,
                    "error": f"{reason} Switch Compute Device to CPU/MPS or install a CUDA-compatible PyTorch build.",
                }

        args = build_eval_args(PYTHON, data)
        return {"ok": proc_mgr.start("eval", args)}

    # ─── API: Calibrate ────────────────────────────────────────────────────
    @app.get("/api/calibrate/file")
    def api_calibrate_file(robot_type: str, robot_id: str):
        base = Path.home() / ".cache" / "huggingface" / "lerobot" / "calibration"
        if "follower" in robot_type:
            path = base / "robots" / "so_follower" / f"{robot_id}.json"
        elif "leader" in robot_type:
            path = base / "teleoperators" / "so_leader" / f"{robot_id}.json"
        else:
            return {"exists": False, "error": "Unknown robot_type"}
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
        if "follower" in robot_type:
            path = base / "robots" / "so_follower" / f"{robot_id}.json"
        elif "leader" in robot_type:
            path = base / "teleoperators" / "so_leader" / f"{robot_id}.json"
        else:
            return {"ok": False, "error": "Unknown robot_type"}
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
        args = build_calibrate_args(PYTHON, data)
        return {"ok": proc_mgr.start("calibrate", args)}

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
                            datasets.append({
                                "id": f"{user_dir.name}/{ds_dir.name}",
                                "total_episodes": info.get("total_episodes", 0),
                                "total_frames": info.get("total_frames", 0),
                                "fps": info.get("fps", 30),
                                "modified": mdate,
                                "timestamp": mtime,
                                "size_mb": info.get("data_files_size_in_mb", 0) + info.get("video_files_size_in_mb", 0)
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
                            df = pd.read_parquet(pq_path, columns=base_cols)
                        for _, row in df.iterrows():
                            tasks = row.get("tasks", [])
                            if tasks is None:
                                tasks = []
                            elif not isinstance(tasks, list):
                                tasks = list(tasks)
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
                                "episode_index": int(row["episode_index"]),
                                "length": int(row["length"]),
                                "tasks": tasks,
                                "video_files": video_files,
                            })

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
    def api_dataset_video(user: str, repo: str, camera: str, chunk: str, file: str):
        # Serve the MP4 file directly for the browser to play
        video_path = Path.home() / ".cache" / "huggingface" / "lerobot" / user / repo / "videos" / camera / chunk / file
        if not video_path.exists():
            return Response(status_code=404, content="Video not found")
        from fastapi.responses import FileResponse
        return FileResponse(video_path, media_type="video/mp4")

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

        def add_check(level: str, name: str, message: str):
            nonlocal score
            checks.append({"level": level, "name": name, "message": message})
            if level == "error":
                score -= 20
            elif level == "warn":
                score -= 8

        try:
            info = json.loads(info_path.read_text())
        except Exception as e:
            return {"ok": False, "error": f"Failed to parse info.json: {e}"}

        total_expected = int(info.get("total_episodes", 0) or 0)
        total_frames = int(info.get("total_frames", 0) or 0)
        fps = int(info.get("fps", 0) or 0)
        if fps <= 0:
            add_check("error", "fps", "FPS in info.json is invalid or missing")
        elif fps < 5:
            add_check("warn", "fps", f"FPS is low ({fps})")
        else:
            add_check("ok", "fps", f"FPS looks valid ({fps})")

        cameras = [k for k, v in info.get("features", {}).items() if isinstance(v, dict) and v.get("dtype") == "video"]
        if not cameras:
            add_check("warn", "cameras", "No video camera features found in dataset metadata")
        else:
            add_check("ok", "cameras", f"Detected {len(cameras)} camera streams")

        episodes = []
        episodes_dir = base / "meta" / "episodes"
        if episodes_dir.exists():
            try:
                pd = __import__("pandas")
                for pq_path in sorted(episodes_dir.glob("**/*.parquet")):
                    df = pd.read_parquet(pq_path, columns=["episode_index", "length"])
                    for _, row in df.iterrows():
                        episodes.append({
                            "episode_index": int(row.get("episode_index", 0)),
                            "length": int(row.get("length", 0)),
                        })
            except Exception as e:
                add_check("warn", "episodes", f"Could not parse episode parquet files: {e}")

        actual_episodes = len(episodes)
        if total_expected > 0 and actual_episodes > 0 and actual_episodes != total_expected:
            add_check("warn", "episode_count", f"Expected {total_expected} episodes, found {actual_episodes}")
        else:
            add_check("ok", "episode_count", f"Episode count: {max(total_expected, actual_episodes)}")

        non_positive_lengths = [ep for ep in episodes if ep["length"] <= 0]
        if non_positive_lengths:
            add_check("warn", "episode_length_zero", f"Episodes with non-positive length: {len(non_positive_lengths)}")

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
            add_check("warn", "videos", "No video files found under videos/")
        elif zero_byte_videos > 0:
            add_check("warn", "videos", f"Found {zero_byte_videos} zero-byte/corrupt candidate video files")
        else:
            add_check("ok", "videos", f"Video files present: {total_videos}")

        missing_camera_files = [cam for cam, cnt in per_camera_files.items() if cnt <= 0]
        if cameras and missing_camera_files:
            add_check("warn", "camera_coverage", f"Cameras without any video files: {', '.join(missing_camera_files)}")
        elif cameras:
            add_check("ok", "camera_coverage", "All camera streams have video files")

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
                add_check("warn", "episode_length", "Average episode length is very short")
            else:
                add_check("ok", "episode_length", f"Average episode length: {avg_ep_len} frames")

            if median_ep_len > 0:
                ratio = avg_ep_len / max(1e-6, median_ep_len)
                if ratio > 2.5 or ratio < 0.4:
                    add_check("warn", "episode_length_distribution", "Episode lengths are highly imbalanced")
                else:
                    add_check("ok", "episode_length_distribution", "Episode length distribution looks reasonable")

        if total_frames <= 0:
            add_check("warn", "total_frames", "Total frame count is zero or missing")
        else:
            add_check("ok", "total_frames", f"Total frames: {total_frames}")

        score = max(0, min(100, score))
        has_error = any(c["level"] == "error" for c in checks)
        return {
            "ok": not has_error,
            "score": score,
            "checks": checks,
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
                    job["status"] = "success"
                    job["progress"] = 100
                else:
                    job["status"] = "error"
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

    # ─── API: Motor Setup ──────────────────────────────────────────────────
    @app.post("/api/motor_setup/start")
    async def api_motor_setup_start(data: dict):
        if proc_mgr.is_running("motor_setup"):
            return {"ok": False, "error": "Already running"}
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
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

    @app.get("/")
    async def root():
        return HTMLResponse((STATIC_DIR / "index.html").read_text())

    return app
