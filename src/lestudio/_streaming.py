"""MJPEG camera streaming helpers."""

from __future__ import annotations

import logging
import os
import subprocess
import threading
import time
from pathlib import Path
from typing import cast

import cv2

from lestudio._config_helpers import _load_config

logger = logging.getLogger(__name__)

_DEFAULT_CAM_SETTINGS = {
    "codec": "MJPG",
    "width": 640,
    "height": 480,
    "fps": 30,
    "jpeg_quality": 70,
}
_PREVIEW_SETTINGS = {
    "codec": "MJPG",
    "width": 192,
    "height": 144,
    "fps": 5,
    "jpeg_quality": 50,
}

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
        for _attempt in range(5):
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
                    self._fps = self._stat_frames / elapsed
                    self._mbps = self._stat_bytes / elapsed / (1024 * 1024)
                    self._stat_frames = 0
                    self._stat_bytes = 0
                    self._stat_ts = now
            else:
                time.sleep(0.1)
        cap.release()

    def get_stats(self) -> dict:
        return {"fps": round(self._fps, 1), "mbps": round(self._mbps, 2)}

    def stop(self):
        self.running = False


# ─── StreamerManager: encapsulates all mutable streamer state ──────────────


class StreamerManager:
    """Manages camera streamer lifecycle, preview streamers, and rerun server.

    Encapsulates all module-level mutable state for testability and potential
    multi-instance support. A default singleton is created at module level.
    """

    _SNAPSHOT_TTL = 3.0

    def __init__(self):
        self._streamers: dict[str, CameraStreamer] = {}
        self._streamers_lock = threading.Lock()
        self._preview_streamers: dict[str, CameraStreamer] = {}
        self._cameras_locked = False
        self._preview_lock = threading.Lock()
        self._rerun_server_proc: subprocess.Popen | None = None
        self._rerun_server_lock = threading.Lock()
        self._snapshot_pool: dict[str, float] = {}

    def snapshot_get_frame(self, video_path: str, config_path: Path) -> bytes | None:
        """Return the latest JPEG frame for snapshot polling."""
        if self._cameras_locked:
            return None
        real_path = os.path.realpath(video_path)
        now = time.monotonic()
        streamer: CameraStreamer | None = None
        with self._streamers_lock:
            # Clean up expired snapshot clients
            expired = [p for p, ts in self._snapshot_pool.items() if now - ts > self._SNAPSHOT_TTL]
            for p in expired:
                del self._snapshot_pool[p]
                if p in self._streamers:
                    self._streamers[p].clients -= 1
                    if self._streamers[p].clients <= 0:
                        self._streamers[p].stop()
                        del self._streamers[p]

            held_by_snapshot = real_path in self._snapshot_pool
            streamer = self._streamers.get(real_path)
            if streamer is None:
                streamer = CameraStreamer(real_path, _get_cam_settings(config_path))
                self._streamers[real_path] = streamer
            if held_by_snapshot:
                if streamer.clients <= 0:
                    streamer.clients = 1
            else:
                streamer.clients += 1

            self._snapshot_pool[real_path] = now

        if streamer is None or streamer.failed:
            return None
        return streamer.latest_frame

    def get_streamer(self, video_path: str, config_path: Path) -> CameraStreamer | None:
        if self._cameras_locked:
            return None
        real_path = os.path.realpath(video_path)
        with self._streamers_lock:
            if real_path not in self._streamers:
                self._streamers[real_path] = CameraStreamer(real_path, _get_cam_settings(config_path))
            self._streamers[real_path].clients += 1
            return self._streamers[real_path]

    def release_streamer(self, video_path: str):
        real_path = os.path.realpath(video_path)
        with self._streamers_lock:
            if real_path in self._streamers:
                self._streamers[real_path].clients -= 1
                if self._streamers[real_path].clients <= 0:
                    self._streamers[real_path].stop()
                    del self._streamers[real_path]

    def get_preview_streamer(self, video_path: str) -> CameraStreamer | None:
        if self._cameras_locked:
            return None
        real_path = os.path.realpath(video_path)
        with self._preview_lock:
            if real_path not in self._preview_streamers:
                self._preview_streamers[real_path] = CameraStreamer(real_path, _PREVIEW_SETTINGS)
            self._preview_streamers[real_path].clients += 1
            return self._preview_streamers[real_path]

    def release_preview_streamer(self, video_path: str):
        real_path = os.path.realpath(video_path)
        with self._preview_lock:
            if real_path in self._preview_streamers:
                self._preview_streamers[real_path].clients -= 1
                if self._preview_streamers[real_path].clients <= 0:
                    self._preview_streamers[real_path].stop()
                    del self._preview_streamers[real_path]

    def stop_all_streamers_for_process(self):
        self._cameras_locked = True
        threads = []
        with self._streamers_lock:
            self._snapshot_pool.clear()
            for streamer in self._streamers.values():
                streamer.stop()
                threads.append(streamer.thread)
            self._streamers.clear()
        with self._preview_lock:
            for streamer in self._preview_streamers.values():
                streamer.stop()
                threads.append(streamer.thread)
            self._preview_streamers.clear()
        for t in threads:
            t.join(timeout=5.0)
        time.sleep(1.5)

    def unlock_cameras(self):
        self._cameras_locked = False

    def ensure_rerun_web_server(self, python_exe: str, web_port: int = 9090, grpc_port: int = 9876):
        with self._rerun_server_lock:
            if self._rerun_server_proc is not None and self._rerun_server_proc.poll() is None:
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
            self._rerun_server_proc = subprocess.Popen(
                cmd,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                close_fds=True,
            )

    def restart_all_streamers(self, config_path: Path):
        with self._streamers_lock:
            self._snapshot_pool.clear()
            for streamer in self._streamers.values():
                streamer.stop()
            paths = list(self._streamers.keys())
            self._streamers.clear()
        with self._preview_lock:
            for streamer in self._preview_streamers.values():
                streamer.stop()
            self._preview_streamers.clear()
        time.sleep(1.5)
        settings = _get_cam_settings(config_path)
        for p in paths:
            with self._streamers_lock:
                self._streamers[p] = CameraStreamer(p, settings)
                self._streamers[p].clients = 1


# ─── Default singleton + backward-compatible module-level API ──────────────

_default_manager = StreamerManager()

# Mutable containers are shared by reference — changes via manager are visible here.
_streamers = _default_manager._streamers
_streamers_lock = _default_manager._streamers_lock
_preview_streamers = _default_manager._preview_streamers
_preview_lock = _default_manager._preview_lock
# _cameras_locked is a bool (immutable); external code accesses it via
# `import lestudio._streaming as _str; _str._cameras_locked`, which reads
# the module attribute. The module-level functions and manager update this
# module attribute directly.
_cameras_locked = False
_snapshot_pool = _default_manager._snapshot_pool


def _get_cam_settings(config_path: Path) -> dict:
    cfg = _load_config(config_path)
    return {**_DEFAULT_CAM_SETTINGS, **cfg.get("camera_settings", {})}


def snapshot_get_frame(video_path: str, config_path: Path) -> bytes | None:
    return _default_manager.snapshot_get_frame(video_path, config_path)


def get_streamer(video_path: str, config_path: Path) -> CameraStreamer | None:
    return _default_manager.get_streamer(video_path, config_path)


def release_streamer(video_path: str):
    _default_manager.release_streamer(video_path)


def get_preview_streamer(video_path: str) -> CameraStreamer | None:
    return _default_manager.get_preview_streamer(video_path)


def release_preview_streamer(video_path: str):
    _default_manager.release_preview_streamer(video_path)


def stop_all_streamers_for_process():
    global _cameras_locked
    _default_manager.stop_all_streamers_for_process()
    _cameras_locked = _default_manager._cameras_locked


def unlock_cameras():
    global _cameras_locked
    _default_manager.unlock_cameras()
    _cameras_locked = _default_manager._cameras_locked


def ensure_rerun_web_server(python_exe: str, web_port: int = 9090, grpc_port: int = 9876):
    _default_manager.ensure_rerun_web_server(python_exe, web_port, grpc_port)


def restart_all_streamers(config_path: Path):
    _default_manager.restart_all_streamers(config_path)
