import logging
import os
import threading
import time
from pathlib import Path

logger = logging.getLogger(__name__)

_patched = False
_STATUS_PATH = "/dev/shm/lerobot_cam_patch_status.txt"


def _write_status(text: str) -> None:
    try:
        with open(_STATUS_PATH, "w", encoding="utf-8") as f:
            f.write(text)
    except OSError:
        pass


def install_camera_patch():
    global _patched
    if _patched:
        return
    _patched = True

    _write_status("install_camera_patch: begin")

    try:
        OpenCVCamera = __import__(
            "lerobot.cameras.opencv.camera_opencv",
            fromlist=["OpenCVCamera"],
        ).OpenCVCamera
        _write_status("install_camera_patch: imported lerobot.cameras.opencv.camera_opencv.OpenCVCamera")
    except ImportError:
        try:
            OpenCVCamera = __import__(
                "lerobot.common.robot_devices.cameras.opencv",
                fromlist=["OpenCVCamera"],
            ).OpenCVCamera
            _write_status("install_camera_patch: imported lerobot.common.robot_devices.cameras.opencv.OpenCVCamera")
        except ImportError:
            _write_status("install_camera_patch: FAILED to import OpenCVCamera")
            return

    orig_read = getattr(OpenCVCamera, "read", None)
    orig_async_read = getattr(OpenCVCamera, "async_read", None)
    if orig_read is None:
        return

    jpeg_queue = {}
    queue_lock = threading.Lock()

    def camera_name(cam):
        raw = getattr(cam, "index_or_path", None)
        if raw is None and hasattr(cam, "config"):
            raw = getattr(cam.config, "index_or_path", None)
        if raw is None:
            return "unknown"
        return Path(str(raw)).name

    def enqueue(cam, frame):
        if frame is None:
            return
        name = camera_name(cam)
        with queue_lock:
            jpeg_queue[name] = frame

    def jpeg_writer():
        import json as _json

        import cv2
        write_count = 0
        # Per-camera FPS tracking
        cam_frame_count: dict[str, int] = {}
        cam_stat_ts: dict[str, float] = {}
        cam_fps: dict[str, float] = {}
        stats_path = "/dev/shm/lerobot_cam_stats.json"
        last_stats_write = 0.0

        while True:
            time.sleep(0.01)
            with queue_lock:
                items = list(jpeg_queue.items())
                jpeg_queue.clear()

            now = time.monotonic()
            fps_updated = False
            for name, img in items:
                try:
                    if img is None:
                        continue
                    small = cv2.resize(img, (320, 240), interpolation=cv2.INTER_AREA)
                    if len(small.shape) == 2:
                        encode_img = small
                    else:
                        encode_img = cv2.cvtColor(small, cv2.COLOR_RGB2BGR)
                    ok, jpg = cv2.imencode(".jpg", encode_img, [cv2.IMWRITE_JPEG_QUALITY, 50])
                    if not ok:
                        continue
                    out_path = f"/dev/shm/lerobot_cam_{name}.jpg"
                    tmp_path = out_path + ".tmp"
                    with open(tmp_path, "wb") as f:
                        f.write(jpg.tobytes())
                    os.replace(tmp_path, out_path)
                    write_count += 1

                    # Track per-camera FPS
                    cam_frame_count[name] = cam_frame_count.get(name, 0) + 1
                    if name not in cam_stat_ts:
                        cam_stat_ts[name] = now
                    elapsed = now - cam_stat_ts[name]
                    if elapsed >= 1.0:
                        cam_fps[name] = round(cam_frame_count[name] / elapsed, 1)
                        cam_frame_count[name] = 0
                        cam_stat_ts[name] = now
                        fps_updated = True

                    if write_count % 30 == 0:
                        _write_status(f"writer: writes={write_count} last={name} ts={time.time():.3f}")
                except (OSError, ValueError, cv2.error):
                    _write_status(f"writer: encode/write exception for {name}")

            # Write FPS stats to SHM whenever they update (decoupled from frame loop)
            if fps_updated or (cam_fps and now - last_stats_write >= 1.0):
                try:
                    with open(stats_path, "w", encoding="utf-8") as sf:
                        _json.dump(cam_fps, sf)
                    last_stats_write = now
                except OSError:
                    pass

    threading.Thread(target=jpeg_writer, daemon=True).start()

    def patched_read(self, *args, **kwargs):
        frame = orig_read(self, *args, **kwargs)
        enqueue(self, frame)
        return frame

    OpenCVCamera.read = patched_read

    if orig_async_read is not None:
        def patched_async_read(self, *args, **kwargs):
            frame = orig_async_read(self, *args, **kwargs)
            enqueue(self, frame)
            return frame

        OpenCVCamera.async_read = patched_async_read

    _write_status("install_camera_patch: patched read/async_read successfully")
