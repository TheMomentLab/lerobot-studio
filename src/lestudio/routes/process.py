from __future__ import annotations

import logging

from fastapi import APIRouter

from .._streaming import unlock_cameras
from .._train_helpers import _normalize_console_command
from ..capabilities import Capability, register
from ..process_manager import PROCESS_NAMES
from ..services.process_service import (
    calibrate_delete,
    calibrate_file_status,
    calibrate_list,
    calibrate_validate,
    calibrate_validate_pair,
    run_preflight,
    start_calibrate,
    start_motor_setup,
    start_record,
    start_teleop,
)
from ._state import AppState
from .models import ProcessCommandRequest, ProcessInputRequest

logger = logging.getLogger(__name__)

register("/api/process/{name}/stop", Capability.PROCESS_CONTROL)
register("/api/process/{name}/input", Capability.PROCESS_CONTROL)
register("/api/process/{name}/command", Capability.PROCESS_CONTROL)
register("/api/preflight", Capability.PROCESS_CONTROL)
register("/api/teleop/start", Capability.PROCESS_CONTROL)
register("/api/record/start", Capability.PROCESS_CONTROL)
register("/api/calibrate/validate-pair", Capability.PROCESS_CONTROL)
register("/api/calibrate/file", Capability.PROCESS_CONTROL)
register("/api/calibrate/start", Capability.PROCESS_CONTROL)
register("/api/motor_setup/start", Capability.PROCESS_CONTROL)


def create_router(state: AppState) -> APIRouter:
    router = APIRouter()

    @router.get("/api/process/{name}/status")
    def api_proc_status(name: str):
        return {"running": state.proc_mgr.is_running(name), "reconnected": state.proc_mgr.is_orphan(name)}

    @router.post("/api/process/{name}/stop")
    def api_proc_stop(name: str):
        if name not in PROCESS_NAMES:
            logger.warning("Stop requested for unknown process: %s", name)
            return {"ok": False, "error": f"Unknown process: {name}"}

        is_running = state.proc_mgr.is_running(name)
        is_orphan = state.proc_mgr.is_orphan(name)
        logger.info(
            "Process stop requested: name=%s running=%s orphan=%s",
            name,
            is_running,
            is_orphan,
        )

        targets = [name]
        if name == "train":
            targets = ["train_install", "train"]

        for target in targets:
            state.proc_mgr.stop(target)
        unlock_cameras()
        logger.info("Process stopped: targets=%s", targets)
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

    @router.post("/api/preflight")
    async def api_preflight(data: dict[str, object]):
        return run_preflight(data, state)

    @router.post("/api/teleop/start")
    async def api_teleop_start(data: dict[str, object]):
        return start_teleop(data, state)

    @router.post("/api/record/start")
    async def api_record_start(data: dict[str, object]):
        return start_record(data, state)

    @router.get("/api/calibrate/file")
    def api_calibrate_file(robot_type: str, robot_id: str):
        return calibrate_file_status(robot_type, robot_id)

    @router.get("/api/calibrate/list")
    def api_calibrate_list():
        return calibrate_list()

    @router.get("/api/calibrate/validate")
    def api_calibrate_validate(robot_type: str, robot_id: str):
        return calibrate_validate(robot_type, robot_id)

    @router.post("/api/calibrate/validate-pair")
    async def api_calibrate_validate_pair(data: dict[str, object]):
        return calibrate_validate_pair(data)

    @router.delete("/api/calibrate/file")
    def api_calibrate_delete(robot_type: str, robot_id: str):
        return calibrate_delete(robot_type, robot_id)

    @router.post("/api/calibrate/start")
    async def api_calibrate_start(data: dict[str, object]):
        return start_calibrate(data, state)

    @router.post("/api/motor_setup/start")
    async def api_motor_setup_start(data: dict[str, object]):
        return start_motor_setup(data, state)

    return router
