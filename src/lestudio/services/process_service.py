from __future__ import annotations

import datetime
import logging
import os
from pathlib import Path

import cv2

from lestudio import command_builders, device_registry, path_policy
from lestudio._device_helpers import ensure_bimanual_calibration_files, get_calibration_file_path
from lestudio._streaming import (
    _get_cam_settings,
    _preview_streamers,
    _streamers,
    _streamers_lock,
    stop_all_streamers_for_process,
)
from lestudio.calibration_validator import (
    CalibrationIssue,
    CalibrationValidationResult,
    validate_and_cross_validate,
    validate_calibration_file,
)
from lestudio.motor_monitor_bridge import get_bridge as _get_motor_bridge
from lestudio.routes._state import AppState

logger = logging.getLogger(__name__)


def _is_bimanual_mode(value: object) -> bool:
    return str(value or "single").strip().lower() != "single"


def _is_bimanual_calibration_type(robot_type: str) -> bool:
    return str(robot_type or "").startswith("bi_")


def _bimanual_member_ids(robot_id: str) -> list[str]:
    value = str(robot_id or "").strip()
    if value.endswith("_left") or value.endswith("_right"):
        return [value]
    return [f"{value}_left", f"{value}_right"] if value else []


def _bimanual_member_paths(robot_type: str, robot_id: str) -> list[Path]:
    return [get_calibration_file_path(robot_type, member_id) for member_id in _bimanual_member_ids(robot_id)]


def _bimanual_display_path(robot_type: str, robot_id: str) -> str:
    member_paths = _bimanual_member_paths(robot_type, robot_id)
    if not member_paths:
        return ""
    if len(member_paths) == 1:
        return str(member_paths[0])
    shared_base = str(robot_id or "").strip()
    return str(member_paths[0].parent / f"{shared_base}_{{left,right}}.json")


def _merge_bimanual_validation(robot_type: str, robot_id: str, paths: list[Path]) -> CalibrationValidationResult:
    merged = CalibrationValidationResult(path=_bimanual_display_path(robot_type, robot_id))
    if len(paths) != 2:
        return merged
    for side, path in zip(("left", "right"), paths, strict=True):
        result = validate_calibration_file(path)
        merged.errors.extend(
            CalibrationIssue(
                severity=issue.severity,
                joint=f"{side}.{issue.joint}" if issue.joint else side,
                code=issue.code,
                message=f"{side}: {issue.message}",
            )
            for issue in result.errors
        )
        merged.warnings.extend(
            CalibrationIssue(
                severity=issue.severity,
                joint=f"{side}.{issue.joint}" if issue.joint else side,
                code=issue.code,
                message=f"{side}: {issue.message}",
            )
            for issue in result.warnings
        )
    return merged


def _guard_process_start(state: AppState, name: str) -> dict | None:
    if state.proc_mgr.is_running(name):
        return {"ok": False, "error": "Already running"}
    conflicts = state.proc_mgr.conflicting_processes(name)
    if conflicts:
        return {"ok": False, "error": f"Cannot start: {', '.join(conflicts)} is using shared hardware"}
    return None


def run_preflight(data: dict, state: AppState) -> dict:
    checks: list[dict[str, str]] = []
    hard_error = False
    bimanual = _is_bimanual_mode(data.get("robot_mode", "single"))
    logger.info(
        "Preflight requested: robot_mode=%s bimanual=%s robot_type=%s teleop_type=%s cameras=%d",
        data.get("robot_mode"),
        bimanual,
        data.get("robot_type"),
        data.get("teleop_type"),
        len(data.get("cameras", {}) or {}),
    )

    def add(status: str, label: str, msg: str) -> None:
        nonlocal hard_error
        checks.append({"status": status, "label": label, "msg": msg})
        if status == "error":
            hard_error = True

    def check_port(path: str, label: str) -> None:
        if not path:
            add("error", label, "Missing path")
            return
        if not os.path.exists(path):
            if "/lerobot/" in path:
                add(
                    "error",
                    label,
                    f"{path} does not exist — apply udev rules in Status page and re-plug the device",
                )
            else:
                add("error", label, f"{path} does not exist")
            return
        if not os.access(path, os.R_OK | os.W_OK):
            add("error", label, f"Permission denied for {path}")
            return
        add("ok", label, f"{path} is accessible")

    def check_calibration(device_type: str, device_id: str, label: str) -> None:
        if not device_id:
            add("warn", label, "Missing device id")
            return
        path = get_calibration_file_path(device_type, device_id)
        if not path.exists():
            add("warn", label, f"Calibration file not found ({path.name})")
            return
        validation = validate_calibration_file(path)
        if validation.errors:
            msgs = "; ".join(e.message for e in validation.errors[:3])
            add("error", label, f"Calibration file has errors: {msgs}")
        elif validation.warnings:
            msgs = "; ".join(w.message for w in validation.warnings[:3])
            add("warn", label, f"Found calibration file ({path.name}) — {msgs}")
        else:
            add("ok", label, f"Found calibration file ({path.name})")

    def check_bimanual_calibration(
        device_type: str,
        left_id: str,
        right_id: str,
        left_port: str,
        right_port: str,
        label: str,
    ) -> None:
        try:
            shared_id, copied = ensure_bimanual_calibration_files(
                device_type,
                left_id,
                right_id,
                left_port,
                right_port,
                label,
            )
        except ValueError as exc:
            add("error", label, str(exc))
            return

        left_path = get_calibration_file_path(device_type, f"{shared_id}_left")
        right_path = get_calibration_file_path(device_type, f"{shared_id}_right")
        missing = [path.name for path in (left_path, right_path) if not path.exists()]
        if missing:
            add("warn", label, f"Calibration file not found ({', '.join(missing)})")
            return
        validation_results = [validate_calibration_file(left_path), validate_calibration_file(right_path)]
        errors = [err.message for result in validation_results for err in result.errors[:3]]
        warnings = [warn.message for result in validation_results for warn in result.warnings[:3]]
        copied_msg = ""
        if copied:
            copied_msg = " — auto-created from " + ", ".join(
                f"{side} {path.name}" for side, path in sorted(copied.items())
            )
        if errors:
            msgs = "; ".join(errors[:3])
            add("error", label, f"Calibration file has errors: {msgs}")
        elif warnings:
            msgs = "; ".join(warnings[:3])
            add(
                "warn",
                label,
                f"Found calibration files ({left_path.name}, {right_path.name}){copied_msg} — {msgs}",
            )
        else:
            add("ok", label, f"Found calibration files ({left_path.name}, {right_path.name}){copied_msg}")

    def check_camera(path: str, label: str) -> None:
        if not path:
            return
        if not os.path.exists(path):
            if "/lerobot/" in path:
                add(
                    "error",
                    label,
                    f"{path} does not exist — apply udev rules in Status page and re-plug the camera",
                )
            else:
                add("error", label, f"{path} does not exist")
            return
        if not os.access(path, os.R_OK | os.W_OK):
            add("error", label, f"Permission denied for {path}")
            return
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

    is_bimanual = bimanual
    robot_type = data.get("robot_type", "bi_so_follower" if is_bimanual else "so101_follower")
    teleop_type = data.get("teleop_type", "bi_so_leader" if is_bimanual else "so101_leader")
    if not is_bimanual:
        check_port(data.get("follower_port", ""), "Follower arm port")
        check_port(data.get("leader_port", ""), "Leader arm port")
        check_calibration(robot_type, data.get("robot_id", ""), "Follower calibration")
        check_calibration(teleop_type, data.get("teleop_id", ""), "Leader calibration")
    else:
        check_port(data.get("left_follower_port", ""), "Left follower arm port")
        check_port(data.get("right_follower_port", ""), "Right follower arm port")
        check_port(data.get("left_leader_port", ""), "Left leader arm port")
        check_port(data.get("right_leader_port", ""), "Right leader arm port")
        check_bimanual_calibration(
            robot_type,
            data.get("left_robot_id", ""),
            data.get("right_robot_id", ""),
            data.get("left_follower_port", ""),
            data.get("right_follower_port", ""),
            "follower",
        )
        check_bimanual_calibration(
            teleop_type,
            data.get("left_teleop_id", ""),
            data.get("right_teleop_id", ""),
            data.get("left_leader_port", ""),
            data.get("right_leader_port", ""),
            "leader",
        )

    cameras = data.get("cameras", {}) or {}
    for name, path in cameras.items():
        check_camera(path, f"Camera {name}")

    ok_count = sum(1 for c in checks if c["status"] == "ok")
    warn_count = sum(1 for c in checks if c["status"] == "warn")
    err_count = sum(1 for c in checks if c["status"] == "error")
    logger.info(
        "Preflight result: pass=%s ok=%d warn=%d error=%d",
        not hard_error,
        ok_count,
        warn_count,
        err_count,
    )
    if hard_error:
        failed = [c for c in checks if c["status"] == "error"]
        for failure in failed:
            logger.warning("Preflight FAIL: [%s] %s", failure["label"], failure["msg"])

    return {"ok": not hard_error, "checks": checks}


def calibrate_file_status(robot_type: str, robot_id: str) -> dict:
    if _is_bimanual_calibration_type(robot_type):
        paths = _bimanual_member_paths(robot_type, robot_id)
        if len(paths) == 2 and all(path.exists() for path in paths):
            latest_mtime = max(path.stat().st_mtime for path in paths)
            validation = _merge_bimanual_validation(robot_type, robot_id, paths)
            return {
                "exists": True,
                "path": _bimanual_display_path(robot_type, robot_id),
                "modified": datetime.datetime.fromtimestamp(latest_mtime).strftime("%Y-%m-%d %H:%M:%S"),
                "size": sum(path.stat().st_size for path in paths),
                "validation": validation.to_dict(),
            }
        return {"exists": False, "path": _bimanual_display_path(robot_type, robot_id)}

    category, dir_name = device_registry.get_calibration_path_prefix(robot_type)
    path = path_policy.calibration_file(category, dir_name, robot_id)
    if path.exists():
        mtime = path.stat().st_mtime
        mdate = datetime.datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M:%S")
        validation = validate_calibration_file(path)
        return {
            "exists": True,
            "path": str(path),
            "modified": mdate,
            "size": path.stat().st_size,
            "validation": validation.to_dict(),
        }
    return {"exists": False, "path": str(path)}


_DIR_TO_TYPE: dict[tuple[str, str], str] = {
    ("robots", "so_follower"): "so101_follower",
    ("robots", "bi_so_follower"): "bi_so_follower",
    ("robots", "koch_follower"): "koch_follower",
    ("robots", "omx_follower"): "omx_follower",
    ("robots", "openarm_follower"): "openarm_follower",
    ("robots", "bi_openarm_follower"): "bi_openarm_follower",
    ("robots", "lekiwi"): "lekiwi",
    ("teleoperators", "so_leader"): "so101_leader",
    ("teleoperators", "bi_so_leader"): "bi_so_leader",
    ("teleoperators", "koch_leader"): "koch_leader",
    ("teleoperators", "omx_leader"): "omx_leader",
    ("teleoperators", "openarm_leader"): "openarm_leader",
    ("teleoperators", "bi_openarm_leader"): "bi_openarm_leader",
}


def calibrate_list() -> dict:
    base = path_policy.calibration_root()
    files = []
    if base.exists():
        for p in base.rglob("*.json"):
            if not p.is_file():
                continue
            mtime = p.stat().st_mtime
            mdate = datetime.datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M:%S")
            rel = p.relative_to(base)
            parts = rel.parts
            guessed_type = "so101_follower"
            if len(parts) >= 3:
                guessed_type = _DIR_TO_TYPE.get((parts[0], parts[1]), guessed_type)
            files.append(
                {
                    "id": p.stem,
                    "rel_path": str(rel),
                    "modified": mdate,
                    "timestamp": mtime,
                    "size": p.stat().st_size,
                    "guessed_type": guessed_type,
                }
            )
    files.sort(key=lambda x: x["timestamp"], reverse=True)
    return {"files": files}


def calibrate_validate(robot_type: str, robot_id: str) -> dict:
    try:
        category, dir_name = device_registry.get_calibration_path_prefix(robot_type)
    except (TypeError, ValueError) as e:
        return {"ok": False, "error": f"Unknown robot_type '{robot_type}': {e}"}
    path = path_policy.calibration_file(category, dir_name, robot_id)
    result = validate_calibration_file(path)
    return result.to_dict()


def calibrate_validate_pair(data: dict) -> dict:
    robot_type = data.get("robot_type", "")
    robot_id = data.get("robot_id", "")
    teleop_type = data.get("teleop_type", "")
    teleop_id = data.get("teleop_id", "")

    if not robot_type or not robot_id or not teleop_type or not teleop_id:
        return {"ok": False, "error": "All of robot_type, robot_id, teleop_type, teleop_id are required."}

    try:
        f_cat, f_dir = device_registry.get_calibration_path_prefix(robot_type)
        l_cat, l_dir = device_registry.get_calibration_path_prefix(teleop_type)
    except (TypeError, ValueError) as e:
        return {"ok": False, "error": f"Unknown device type: {e}"}

    follower_path = path_policy.calibration_file(f_cat, f_dir, robot_id)
    leader_path = path_policy.calibration_file(l_cat, l_dir, teleop_id)

    result = validate_and_cross_validate(leader_path, follower_path)
    return result


def calibrate_delete(robot_type: str, robot_id: str) -> dict:
    try:
        category, dir_name = device_registry.get_calibration_path_prefix(robot_type)
    except (TypeError, ValueError) as e:
        return {"ok": False, "error": f"Unknown robot_type '{robot_type}': {e}"}

    if _is_bimanual_calibration_type(robot_type):
        deleted_any = False
        for path in _bimanual_member_paths(robot_type, robot_id):
            if not path.exists():
                continue
            try:
                path.unlink()
                deleted_any = True
            except OSError as e:
                return {"ok": False, "error": str(e)}
        if deleted_any:
            return {"ok": True}
        return {"ok": False, "error": "File not found"}

    path = path_policy.calibration_file(category, dir_name, robot_id)
    if path.exists():
        try:
            path.unlink()
            return {"ok": True}
        except OSError as e:
            return {"ok": False, "error": str(e)}
    return {"ok": False, "error": "File not found"}


def start_teleop(data: dict, state: AppState) -> dict:
    bimanual = _is_bimanual_mode(data.get("robot_mode"))
    logger.info(
        "Teleop start requested: robot_mode=%s bimanual=%s robot_type=%s teleop_type=%s",
        data.get("robot_mode"),
        bimanual,
        data.get("robot_type"),
        data.get("teleop_type"),
    )
    if bimanual:
        logger.info(
            "Teleop bimanual ports: left_follower=%s right_follower=%s left_leader=%s right_leader=%s",
            data.get("left_follower_port"),
            data.get("right_follower_port"),
            data.get("left_leader_port"),
            data.get("right_leader_port"),
        )
        logger.info(
            "Teleop bimanual IDs: left_robot=%s right_robot=%s left_teleop=%s right_teleop=%s",
            data.get("left_robot_id"),
            data.get("right_robot_id"),
            data.get("left_teleop_id"),
            data.get("right_teleop_id"),
        )
    else:
        logger.info(
            "Teleop single-arm: follower_port=%s leader_port=%s robot_id=%s teleop_id=%s",
            data.get("follower_port"),
            data.get("leader_port"),
            data.get("robot_id"),
            data.get("teleop_id"),
        )
    cameras = data.get("cameras", {})
    if cameras:
        logger.info("Teleop cameras: %s", cameras)
    guard = _guard_process_start(state, "teleop")
    if guard:
        logger.warning("Teleop start blocked: %s", guard.get("error"))
        return guard
    _get_motor_bridge().disconnect()
    stop_all_streamers_for_process()
    if bimanual:
        try:
            ensure_bimanual_calibration_files(
                str(data.get("robot_type", "bi_so_follower") or "bi_so_follower"),
                str(data.get("left_robot_id", "")),
                str(data.get("right_robot_id", "")),
                str(data.get("left_follower_port", "")),
                str(data.get("right_follower_port", "")),
                "follower",
            )
            ensure_bimanual_calibration_files(
                str(data.get("teleop_type", "bi_so_leader") or "bi_so_leader"),
                str(data.get("left_teleop_id", "")),
                str(data.get("right_teleop_id", "")),
                str(data.get("left_leader_port", "")),
                str(data.get("right_leader_port", "")),
                "leader",
            )
            logger.info("Teleop bimanual calibration ensure completed")
        except ValueError as e:
            logger.error("Teleop bimanual calibration ensure failed: %s", e)
            return {"ok": False, "error": str(e)}
    try:
        args = command_builders.build_teleop_args(state.python_exe, data)
    except ValueError as e:
        logger.error("Teleop build_args failed: %s", e)
        return {"ok": False, "error": str(e)}
    logger.debug("Teleop command: %s", args)
    ok = state.proc_mgr.start("teleop", args)
    if ok:
        logger.info("Teleop process started successfully")
    else:
        logger.error("Teleop process failed to start")
    return {"ok": ok}


def start_record(data: dict, state: AppState) -> dict:
    bimanual = _is_bimanual_mode(data.get("robot_mode"))
    logger.info(
        "Record start requested: repo_id=%s task=%s num_episodes=%s robot_mode=%s bimanual=%s",
        data.get("record_repo_id"),
        data.get("record_task"),
        data.get("record_num_episodes"),
        data.get("robot_mode"),
        bimanual,
    )
    if bimanual:
        logger.info(
            "Record bimanual ports: left_follower=%s right_follower=%s left_leader=%s right_leader=%s",
            data.get("left_follower_port"),
            data.get("right_follower_port"),
            data.get("left_leader_port"),
            data.get("right_leader_port"),
        )
    else:
        logger.info(
            "Record single-arm: follower_port=%s leader_port=%s robot_id=%s teleop_id=%s",
            data.get("follower_port"),
            data.get("leader_port"),
            data.get("robot_id"),
            data.get("teleop_id"),
        )
    cameras = data.get("cameras", {})
    if cameras:
        logger.info("Record cameras: %s", cameras)
    _get_motor_bridge().disconnect()
    guard = _guard_process_start(state, "record")
    if guard:
        logger.warning("Record start blocked: %s", guard.get("error"))
        return guard
    stop_all_streamers_for_process()
    cfg = data
    if bimanual:
        try:
            ensure_bimanual_calibration_files(
                str(cfg.get("robot_type", "bi_so_follower") or "bi_so_follower"),
                str(cfg.get("left_robot_id", "")),
                str(cfg.get("right_robot_id", "")),
                str(cfg.get("left_follower_port", "")),
                str(cfg.get("right_follower_port", "")),
                "follower",
            )
            ensure_bimanual_calibration_files(
                str(cfg.get("teleop_type", "bi_so_leader") or "bi_so_leader"),
                str(cfg.get("left_teleop_id", "")),
                str(cfg.get("right_teleop_id", "")),
                str(cfg.get("left_leader_port", "")),
                str(cfg.get("right_leader_port", "")),
                "leader",
            )
            logger.info("Record bimanual calibration ensure completed")
        except ValueError as e:
            logger.error("Record bimanual calibration ensure failed: %s", e)
            return {"ok": False, "error": str(e)}
    cam_settings = _get_cam_settings(state.config_path)
    cfg["record_cam_width"] = cam_settings.get("width", 640)
    cfg["record_cam_height"] = cam_settings.get("height", 480)
    cfg["record_cam_fps"] = cam_settings.get("fps", 30)
    requested_resume, resume_enabled = command_builders.resolve_record_resume(cfg)
    logger.info(
        "Record resume: requested=%s enabled=%s cam=%dx%d@%dfps",
        requested_resume,
        resume_enabled,
        cfg["record_cam_width"],
        cfg["record_cam_height"],
        cfg["record_cam_fps"],
    )
    try:
        args = command_builders.build_record_args(state.python_exe, cfg, resume_enabled)
    except ValueError as e:
        logger.error("Record build_args failed: %s", e)
        return {"ok": False, "error": str(e)}
    logger.debug("Record command: %s", args)
    ok = state.proc_mgr.start("record", args)
    if ok:
        logger.info("Record process started successfully")
        state.append_history(
            "record_start",
            {
                "repo_id": data.get("record_repo_id", ""),
                "task": data.get("record_task", ""),
                "num_episodes": data.get("record_num_episodes", ""),
            },
        )
    else:
        logger.error("Record process failed to start")
    return {
        "ok": ok,
        "resume_requested": requested_resume,
        "resume_enabled": resume_enabled,
    }


def start_calibrate(data: dict, state: AppState) -> dict:
    logger.info(
        "Calibrate start requested: robot_type=%s robot_id=%s port=%s",
        data.get("calibrate_robot_type"),
        data.get("calibrate_robot_id"),
        data.get("calibrate_port"),
    )
    _get_motor_bridge().disconnect()
    guard = _guard_process_start(state, "calibrate")
    if guard:
        logger.warning("Calibrate start blocked: %s", guard.get("error"))
        return guard
    args = command_builders.build_calibrate_args(state.python_exe, data)
    logger.debug("Calibrate command: %s", args)
    ok = state.proc_mgr.start("calibrate", args)
    if ok:
        logger.info("Calibrate process started successfully")
        state.append_history(
            "calibrate_start",
            {
                "robot_type": data.get("calibrate_robot_type", ""),
                "robot_id": data.get("calibrate_robot_id", ""),
            },
        )
    else:
        logger.error("Calibrate process failed to start")
    return {"ok": ok}


def start_motor_setup(data: dict, state: AppState) -> dict:
    logger.info(
        "Motor setup start requested: motor_type=%s port=%s brand=%s",
        data.get("motor_type"),
        data.get("motor_port"),
        data.get("motor_brand"),
    )
    _get_motor_bridge().disconnect()
    guard = _guard_process_start(state, "motor_setup")
    if guard:
        logger.warning("Motor setup start blocked: %s", guard.get("error"))
        return guard
    try:
        args = command_builders.build_motor_setup_args(state.python_exe, data)
    except ValueError as e:
        logger.error("Motor setup build_args failed: %s", e)
        return {"ok": False, "error": str(e)}
    logger.debug("Motor setup command: %s", args)
    ok = state.proc_mgr.start("motor_setup", args)
    if ok:
        logger.info("Motor setup process started successfully")
    else:
        logger.error("Motor setup process failed to start")
    return {"ok": ok}
