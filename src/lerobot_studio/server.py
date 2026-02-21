#!/usr/bin/env python3
"""LeRobot Studio — Web GUI server (packaged version)."""

import asyncio
import datetime
import json
import os
import queue
import re
import subprocess
import sys
import threading
import time
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
}

_DEFAULT_CAM_SETTINGS = {
    "codec": "MJPG", "width": 640, "height": 480, "fps": 30, "jpeg_quality": 70,
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
        arms.append({
            "device":  p.name,
            "path":    str(p),
            "symlink": find_symlink(p.name),
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
            with _cam_open_lock:
                cap = cv2.VideoCapture(self.real_path)
                fourcc = cv2.VideoWriter_fourcc(*s["codec"])
                cap.set(cv2.CAP_PROP_FOURCC, fourcc)
                cap.set(cv2.CAP_PROP_FRAME_WIDTH, s["width"])
                cap.set(cv2.CAP_PROP_FRAME_HEIGHT, s["height"])
                cap.set(cv2.CAP_PROP_FPS, s["fps"])
                cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                if cap.isOpened():
                    ret, _ = cap.read()
                    if ret:
                        time.sleep(0.5)
                    else:
                        cap.release()
                        cap = None
            if cap is not None:
                break
            time.sleep(2.0)

        if not cap or not cap.isOpened():
            self.failed = True
            return

        quality = s["jpeg_quality"]
        while self.running:
            ret, frame = cap.read()
            if ret:
                _, jpg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
                self.latest_frame = jpg.tobytes()
                self._stat_frames += 1
                self._stat_bytes += len(self.latest_frame) if self.latest_frame else 0
                now = time.monotonic()
                elapsed = now - self._stat_ts
                if elapsed >= 1.0:
                    self._fps  = self._stat_frames / elapsed
                    self._mbps = self._stat_bytes / elapsed / (1024 * 1024)
                    self._stat_frames = 0
                    self._stat_bytes  = 0
                    self._stat_ts     = now
            else:
                time.sleep(0.1)
            time.sleep(0.01)
        cap.release()

    def get_stats(self) -> dict:
        return {"fps": round(self._fps, 1), "mbps": round(self._mbps, 2)}

    def stop(self):
        self.running = False


_streamers: dict[str, CameraStreamer] = {}
_streamers_lock = threading.Lock()


def _get_cam_settings(config_path: Path) -> dict:
    cfg = _load_config(config_path)
    return {**_DEFAULT_CAM_SETTINGS, **cfg.get("camera_settings", {})}


def get_streamer(video_path: str, config_path: Path) -> CameraStreamer:
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


def restart_all_streamers(config_path: Path):
    with _streamers_lock:
        for streamer in _streamers.values():
            streamer.stop()
        paths = list(_streamers.keys())
        _streamers.clear()
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


# ─── udev Rules ────────────────────────────────────────────────────────────────
def _arm_rule_lines(rules_path: Path) -> list[str]:
    if not rules_path.exists():
        return []
    return [
        ln for ln in rules_path.read_text().splitlines()
        if "idVendor" in ln and "SYMLINK" in ln
    ]


def _build_rules(assignments: dict[str, str], rules_path: Path) -> str:
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
    return "\n".join(lines) + "\n"


def _apply_rules(assignments: dict[str, str], rules_path: Path) -> tuple[bool, str]:
    content = _build_rules(assignments, rules_path)
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
    return True, ""


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

    proc_mgr = ProcessManager(lerobot_src)

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
        return {"content": _build_rules(data.get("assignments", {}), rules_path)}

    @app.post("/api/rules/apply")
    async def api_rules_apply(data: dict):
        ok, err = _apply_rules(data.get("assignments", {}), rules_path)
        return {"ok": ok, "error": err}

    # ─── API: MJPEG Streaming ──────────────────────────────────────────────
    async def mjpeg_gen(video_path: str, request: Request):
        streamer = get_streamer(video_path, CONFIG_PATH)
        try:
            while True:
                if await request.is_disconnected():
                    break
                if streamer.failed:
                    break
                frame = streamer.latest_frame
                if frame:
                    yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + frame + b"\r\n"
                await asyncio.sleep(1 / 30)
        finally:
            release_streamer(video_path)

    @app.get("/stream/{video_name}")
    async def stream_camera(request: Request, video_name: str):
        return StreamingResponse(
            mjpeg_gen(f"/dev/{video_name}", request),
            media_type="multipart/x-mixed-replace; boundary=frame",
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
        args = build_teleop_args(PYTHON, data)
        return {"ok": proc_mgr.start("teleop", args)}

    # ─── API: Record ───────────────────────────────────────────────────────
    @app.post("/api/record/start")
    async def api_record_start(data: dict):
        if proc_mgr.is_running("record"):
            return {"ok": False, "error": "Already running"}
        cfg = data
        requested_resume, resume_enabled = resolve_record_resume(cfg)
        args = build_record_args(PYTHON, cfg, resume_enabled)
        return {
            "ok": proc_mgr.start("record", args),
            "resume_requested": requested_resume,
            "resume_enabled": resume_enabled,
        }

    # ─── API: Train ────────────────────────────────────────────────────────
    @app.post("/api/train/start")
    async def api_train_start(data: dict):
        if proc_mgr.is_running("train"):
            return {"ok": False, "error": "Already running"}
        args = build_train_args(PYTHON, data)
        return {"ok": proc_mgr.start("train", args)}

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
            return Response(status_code=404, content="Dataset not found")
        
        try:
            from lerobot.common.datasets.lerobot_dataset import LeRobotDataset
        except ImportError:
            return Response(status_code=500, content="lerobot is not installed")

        try:
            ds = LeRobotDataset(repo_id, local_files_only=True)
            info = json.loads(info_path.read_text())
            cameras = [k for k, v in info.get("features", {}).items() if v.get("dtype") == "video"]
            
            episodes = []
            if hasattr(ds, "meta") and hasattr(ds.meta, "episodes"):
                for ep_idx, ep_data in ds.meta.episodes.items():
                    episodes.append({
                        "episode_index": ep_idx,
                        "length": ep_data.get("length", 0),
                        "tasks": ep_data.get("tasks", [])
                    })
            else:
                for ep_idx in range(info.get("total_episodes", 0)):
                    episodes.append({
                        "episode_index": ep_idx,
                        "length": 0,
                        "tasks": []
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
            return Response(status_code=500, content=f"Failed to load dataset: {str(e)}")

    @app.get("/api/datasets/{user}/{repo}/videos/{camera}/{chunk}/{file}")
    def api_dataset_video(user: str, repo: str, camera: str, chunk: str, file: str):
        # Serve the MP4 file directly for the browser to play
        video_path = Path.home() / ".cache" / "huggingface" / "lerobot" / user / repo / "videos" / camera / chunk / file
        if not video_path.exists():
            return Response(status_code=404, content="Video not found")
        from fastapi.responses import FileResponse
        return FileResponse(video_path, media_type="video/mp4")

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
