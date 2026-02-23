import os
import threading
import time
from pathlib import Path

_patched = False
_STATUS_PATH = "/dev/shm/lerobot_cam_patch_status.txt"


def _write_status(text: str) -> None:
    try:
        with open(_STATUS_PATH, "w", encoding="utf-8") as f:
            f.write(text)
    except Exception:
        pass


def install_camera_patch():
    global _patched
    if _patched:
        return
    _patched = True

    _write_status("install_camera_patch: begin")

    try:
        from lerobot.cameras.opencv.camera_opencv import OpenCVCamera
        _write_status("install_camera_patch: imported lerobot.cameras.opencv.camera_opencv.OpenCVCamera")
    except ImportError:
        try:
            from lerobot.common.robot_devices.cameras.opencv import OpenCVCamera
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
        import cv2
        write_count = 0

        while True:
            time.sleep(0.01)
            with queue_lock:
                items = list(jpeg_queue.items())
                jpeg_queue.clear()

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
                    if write_count % 30 == 0:
                        _write_status(f"writer: writes={write_count} last={name} ts={time.time():.3f}")
                except Exception:
                    _write_status(f"writer: encode/write exception for {name}")

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
