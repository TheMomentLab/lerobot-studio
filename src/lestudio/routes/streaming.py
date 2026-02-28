"""Camera streaming, system stats, and WebSocket routes."""
from __future__ import annotations

import asyncio
import logging
import os
import queue
import shutil
import subprocess
import time
from pathlib import Path

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi import Request
from fastapi.responses import Response, StreamingResponse

import psutil

import lestudio._streaming as _str
from lestudio._device_helpers import get_usb_bus_for_camera
from lestudio._streaming import (
    _streamers,
    _streamers_lock,
    get_preview_streamer,
    get_streamer,
    release_preview_streamer,
    release_streamer,
    snapshot_get_frame,
    unlock_cameras,
)
from lestudio.routes._state import AppState

logger = logging.getLogger(__name__)

# 모듈 레벨 캐시 변수
_lerobot_cache_size: float | None = None
_lerobot_cache_ts: float = 0.0
_LEROBOT_CACHE_TTL = 60.0  # 레로보트 HF 캐시 크기: 60초마다 재계산

def create_router(state: AppState) -> APIRouter:
    router = APIRouter()

    # ─── MJPEG Streaming ───────────────────────────────────────────────────────
    async def mjpeg_gen(video_path: str, request: Request, preview: bool = False):
        cam_name = Path(video_path).name
        shm_path = f"/dev/shm/lerobot_cam_{cam_name}.jpg"
        use_process_frames = state.proc_mgr.is_running("record") or state.proc_mgr.is_running("teleop")
        if use_process_frames and os.path.exists(shm_path):
            while True:
                if await request.is_disconnected():
                    break
                if not (state.proc_mgr.is_running("record") or state.proc_mgr.is_running("teleop")):
                    break
                try:
                    with open(shm_path, "rb") as f:
                        frame = f.read()
                    if frame:
                        yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + frame + b"\r\n"
                except OSError:
                    pass
                await asyncio.sleep(1 / 30)

        if _str._cameras_locked and not (state.proc_mgr.is_running("record") or state.proc_mgr.is_running("teleop")):
            unlock_cameras()

        if preview:
            streamer = get_preview_streamer(video_path)
        else:
            streamer = get_streamer(video_path, state.config_path)
        if streamer is None:
            return
        try:
            while True:
                if await request.is_disconnected():
                    break
                if _str._cameras_locked:
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

    @router.get("/stream/{video_name}")
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

    # --- Snapshot endpoint: single JPEG frame for JS polling ---
    # Unlike /stream/, this does NOT keep HTTP connections open,
    # so the browser page-load spinner completes normally.
    @router.get("/api/camera/snapshot/{video_name}")
    async def snapshot_camera(video_name: str):

        # During teleop/record: read from shared memory (fastest path)
        shm_path = f"/dev/shm/lerobot_cam_{video_name}.jpg"
        use_shm = state.proc_mgr.is_running("record") or state.proc_mgr.is_running("teleop")
        if use_shm and os.path.exists(shm_path):
            try:
                with open(shm_path, "rb") as f:
                    frame = f.read()
                if frame:
                    return Response(content=frame, media_type="image/jpeg",
                                    headers={"Cache-Control": "no-store"})
            except OSError:
                pass

        # Normal path: use streamer pool
        frame = snapshot_get_frame(f"/dev/{video_name}", state.config_path)
        if frame:
            return Response(content=frame, media_type="image/jpeg",
                            headers={"Cache-Control": "no-store"})

        # Streamer just opened -- wait up to 3s for first frame
        for _ in range(30):
            await asyncio.sleep(0.1)
            frame = snapshot_get_frame(f"/dev/{video_name}", state.config_path)
            if frame:
                return Response(content=frame, media_type="image/jpeg",
                                headers={"Cache-Control": "no-store"})

        return Response(status_code=503)
    # ─── Camera Stats ──────────────────────────────────────────────────────────
    @router.get("/api/camera/stats")
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

    # ─── GPU Stats ─────────────────────────────────────────────────────────────
    @router.get("/api/gpu/status")
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
            util, mem_used, mem_total = [int(x.strip()) for x in lines[0].split(",")]
            return {
                "exists": True,
                "utilization": util,
                "memory_used": mem_used,
                "memory_total": mem_total,
                "memory_percent": round(mem_used / mem_total * 100, 1) if mem_total > 0 else 0
            }
        except (OSError, subprocess.SubprocessError, ValueError) as e:
            return {"exists": False, "error": str(e)}

    # ─── System Resources ──────────────────────────────────────────────────────
    @router.get("/api/system/resources")
    def api_system_resources():
        try:
            global _lerobot_cache_size, _lerobot_cache_ts
            # cpu_percent(interval=None): 논블로킹 — 이전 호출 이후 델타를 즉시 반환.
            # 첫 호출은 0.0을 반환하지만 폴링 구조상 문제없음. 단일 호출만 사용.
            cpu_pct = psutil.cpu_percent(interval=None)
            vm = psutil.virtual_memory()
            du = shutil.disk_usage(Path.home())
            hf_cache = Path.home() / ".cache" / "huggingface" / "lerobot"
            lerobot_du = _lerobot_cache_size
            now = time.monotonic()
            if hf_cache.exists() and (now - _lerobot_cache_ts > _LEROBOT_CACHE_TTL or _lerobot_cache_size is None):
                try:
                    lerobot_bytes = sum(f.stat().st_size for f in hf_cache.rglob('*') if f.is_file())
                    _lerobot_cache_size = round(lerobot_bytes / 1024 / 1024, 1)
                    _lerobot_cache_ts = now
                    lerobot_du = _lerobot_cache_size
                except OSError:
                    pass
            elif not hf_cache.exists():
                _lerobot_cache_size = None
                _lerobot_cache_ts = 0.0
                lerobot_du = None
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
        except Exception as e:  # broad-except: catch-all HTTP response
            return {"ok": False, "error": str(e)}

    # ─── WebSocket ─────────────────────────────────────────────────────────────
    @router.websocket("/ws")
    async def ws_endpoint(websocket: WebSocket):
        await websocket.accept()
        try:
            while True:
                items = []
                while True:
                    try:
                        items.append(state.proc_mgr.out_q.get_nowait())
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
                await websocket.send_json({"type": "status", "processes": state.proc_mgr.status_all()})
                await asyncio.sleep(0.2)
        except WebSocketDisconnect:
            pass
        except Exception:  # broad-except: websocket loop safety net for disconnect/race conditions
            pass

    return router
