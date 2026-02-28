"""Process management, preflight, teleop, record, calibrate, motor setup routes."""
from __future__ import annotations

import datetime
import logging
import os
from pathlib import Path

import cv2
from fastapi import APIRouter

from lestudio import device_registry
from lestudio.command_builders import build_calibrate_args, build_motor_setup_args, build_record_args, build_teleop_args
from lestudio.command_builders import resolve_record_resume
from lestudio.process_manager import PROCESS_NAMES
from lestudio._streaming import (
    _streamers,
    _streamers_lock,
    _preview_streamers,
    _get_cam_settings,
    stop_all_streamers_for_process,
    unlock_cameras,
)
from lestudio._train_helpers import _normalize_console_command
from lestudio.routes._state import AppState
from lestudio.motor_monitor_bridge import get_bridge as _get_motor_bridge
from lestudio.routes.models import ProcessCommandRequest, ProcessInputRequest

logger = logging.getLogger(__name__)


def _guard_process_start(state: AppState, name: str) -> dict | None:
    """Check if process can start. Returns error dict if blocked, None if OK."""
    if state.proc_mgr.is_running(name):
        return {"ok": False, "error": "Already running"}
    conflicts = state.proc_mgr.conflicting_processes(name)
    if conflicts:
        return {"ok": False, "error": f"Cannot start: {', '.join(conflicts)} is using shared hardware"}
    return None

def create_router(state: AppState) -> APIRouter:
    router = APIRouter()

    # ─── Process Control ───────────────────────────────────────────────────────
    @router.get("/api/process/{name}/status")
    def api_proc_status(name: str):
        return {"running": state.proc_mgr.is_running(name)}

    @router.post("/api/process/{name}/stop")
    def api_proc_stop(name: str):
        if name not in PROCESS_NAMES:
            return {"ok": False, "error": f"Unknown process: {name}"}

        targets = [name]
        if name == "train":
            targets = ["train_install", "train"]

        for target in targets:
            state.proc_mgr.stop(target)
        unlock_cameras()
        return {"ok": True, "stopped": targets}

    @router.post("/api/process/{name}/input")
    async def api_proc_input(name: str, data: ProcessInputRequest):
        if name not in PROCESS_NAMES:
            return {"ok": False, "error": f"Unknown process: {name}"}

        target = name
        if not state.proc_mgr.is_running(target):
            if name == "train" and state.proc_mgr.is_running("train_install"):
                target = "train_install"
            else:
                return {"ok": False, "error": f"{name} is not running"}

        text = data.text

        ok = state.proc_mgr.send_input(target, text)
        if not ok:
            return {"ok": False, "error": f"Failed to write to {target} stdin"}
        return {"ok": True, "process": target}

    @router.post("/api/process/{name}/command")
    async def api_proc_command(name: str, data: ProcessCommandRequest | None = None):
        if name not in PROCESS_NAMES:
            return {"ok": False, "error": f"Unknown process: {name}"}

        if state.proc_mgr.is_running(name):
            return {"ok": False, "error": f"{name} is running. Stop it or send stdin input instead."}

        payload = data or ProcessCommandRequest()
        raw_command = payload.command.strip()
        try:
            args, normalized = _normalize_console_command(state.python_exe, raw_command)
        except ValueError as e:
            return {"ok": False, "error": str(e)}

        ok = state.proc_mgr.start(name, args)
        return {
            "ok": ok,
            "command": normalized,
            "error": None if ok else "Failed to launch command process.",
        }

    # ─── Preflight ─────────────────────────────────────────────────────────────
    @router.post("/api/preflight")
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
            except (cv2.error, OSError, ValueError) as e:
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

    # ─── Teleop ────────────────────────────────────────────────────────────────
    @router.post("/api/teleop/start")
    async def api_teleop_start(data: dict):
        guard = _guard_process_start(state, "teleop")
        if guard:
            return guard
        _get_motor_bridge().disconnect()  # 모터 모니터가 포트를 점유 중이면 반환
        stop_all_streamers_for_process()
        args = build_teleop_args(state.python_exe, data)
        return {"ok": state.proc_mgr.start("teleop", args)}

    # ─── Record ────────────────────────────────────────────────────────────────
    @router.post("/api/record/start")
    async def api_record_start(data: dict):
        _get_motor_bridge().disconnect()  # 모터 모니터가 포트를 점유 중이면 반환
        guard = _guard_process_start(state, "record")
        if guard:
            return guard
        stop_all_streamers_for_process()
        cfg = data
        # Inject camera settings (resolution/fps) from user's config into record args
        cam_settings = _get_cam_settings(state.config_path)
        cfg["record_cam_width"] = cam_settings.get("width", 640)
        cfg["record_cam_height"] = cam_settings.get("height", 480)
        cfg["record_cam_fps"] = cam_settings.get("fps", 30)
        requested_resume, resume_enabled = resolve_record_resume(cfg)
        args = build_record_args(state.python_exe, cfg, resume_enabled)
        ok = state.proc_mgr.start("record", args)
        if ok:
            state.append_history("record_start", {
                "repo_id": data.get("record_repo_id", ""),
                "task": data.get("record_task", ""),
                "num_episodes": data.get("record_num_episodes", ""),
            })
        return {
            "ok": ok,
            "resume_requested": requested_resume,
            "resume_enabled": resume_enabled,
        }

    # ─── Calibrate ─────────────────────────────────────────────────────────────
    @router.get("/api/calibrate/file")
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

    @router.get("/api/calibrate/list")
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

    @router.delete("/api/calibrate/file")
    def api_calibrate_delete(robot_type: str, robot_id: str):

        base = Path.home() / ".cache" / "huggingface" / "lerobot" / "calibration"
        try:
            category, dir_name = device_registry.get_calibration_path_prefix(robot_type)
        except (TypeError, ValueError) as e:
            return {"ok": False, "error": f"Unknown robot_type '{robot_type}': {e}"}
        path = base / category / dir_name / f"{robot_id}.json"
        if path.exists():
            try:
                path.unlink()
                return {"ok": True}
            except OSError as e:
                return {"ok": False, "error": str(e)}
        return {"ok": False, "error": "File not found"}

    @router.post("/api/calibrate/start")
    async def api_calibrate_start(data: dict):
        _get_motor_bridge().disconnect()  # 모터 모니터가 포트를 점유 중이면 반환
        guard = _guard_process_start(state, "calibrate")
        if guard:
            return guard
        args = build_calibrate_args(state.python_exe, data)
        ok = state.proc_mgr.start("calibrate", args)
        if ok:
            state.append_history("calibrate_start", {
                "robot_type": data.get("calibrate_robot_type", ""),
                "robot_id": data.get("calibrate_robot_id", ""),
            })
        return {"ok": ok}

    # ─── Motor Setup ───────────────────────────────────────────────────────────
    @router.post("/api/motor_setup/start")
    async def api_motor_setup_start(data: dict):
        _get_motor_bridge().disconnect()  # 모터 모니터가 포트를 점유 중이면 반환
        guard = _guard_process_start(state, "motor_setup")
        if guard:
            return guard
        args = build_motor_setup_args(state.python_exe, data)
        return {"ok": state.proc_mgr.start("motor_setup", args)}

    return router
