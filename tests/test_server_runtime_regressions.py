from __future__ import annotations

import asyncio
import importlib
import json
import sys
import types
from pathlib import Path

import pytest

import lestudio.routes.training as training_routes
import lestudio.services.training_service as training_service
from lestudio.routes.models import HfTokenRequest
from lestudio.server import create_app

_has_lerobot_rl = importlib.util.find_spec("lerobot.rl") is not None


def _make_app(tmp_path: Path):
    lerobot_src = tmp_path / "lerobot_src"
    (lerobot_src / "lerobot").mkdir(parents=True)
    config_dir = tmp_path / "config"
    config_dir.mkdir()
    rules_path = tmp_path / "99-lerobot.rules"
    return create_app(lerobot_src=lerobot_src, config_dir=config_dir, rules_path=rules_path)


def _find_endpoint(app, path: str, method: str):
    method = method.upper()
    for route in app.routes:
        if getattr(route, "path", None) != path:
            continue
        methods = getattr(route, "methods", set()) or set()
        if method in methods:
            return route.endpoint
    raise AssertionError(f"Route not found: {method} {path}")


def test_api_proc_stop_train_stops_train_and_installer(monkeypatch, tmp_path: Path):
    stopped: list[str] = []
    unlocked = {"called": False}

    def fake_stop(self, name: str):
        stopped.append(name)

    def fake_unlock():
        unlocked["called"] = True

    monkeypatch.setattr("lestudio.process_manager.ProcessManager.stop", fake_stop)
    monkeypatch.setattr("lestudio.routes.process.unlock_cameras", fake_unlock)

    app = _make_app(tmp_path)
    endpoint = _find_endpoint(app, "/api/process/{name}/stop", "POST")
    payload = endpoint("train")

    assert payload["ok"] is True
    assert payload["stopped"] == ["train_install", "train"]
    assert stopped == ["train_install", "train"]
    assert unlocked["called"] is True


def test_api_record_start_stops_streamers_and_injects_camera_settings(monkeypatch, tmp_path: Path):
    captured: dict[str, object] = {}
    stop_calls = {"count": 0}

    monkeypatch.setattr("lestudio.process_manager.ProcessManager.is_running", lambda self, name: False)
    monkeypatch.setattr("lestudio.process_manager.ProcessManager.conflicting_processes", lambda self, name: [])

    def fake_start(self, name: str, args: list[str]) -> bool:
        captured["name"] = name
        captured["args"] = args
        return True

    def fake_stop_streamers():
        stop_calls["count"] += 1

    def fake_build_args(python_exe: str, cfg: dict, resume_enabled: bool):
        captured["cfg"] = dict(cfg)
        captured["resume_enabled"] = resume_enabled
        return [python_exe, "-m", "fake_record"]

    monkeypatch.setattr("lestudio.process_manager.ProcessManager.start", fake_start)
    monkeypatch.setattr("lestudio.services.process_service.stop_all_streamers_for_process", fake_stop_streamers)
    monkeypatch.setattr(
        "lestudio.services.process_service.command_builders.resolve_record_resume", lambda cfg: (False, False)
    )
    monkeypatch.setattr(
        "lestudio.services.process_service._get_cam_settings",
        lambda config_path: {"width": 960, "height": 540, "fps": 25},
    )
    monkeypatch.setattr("lestudio.services.process_service.command_builders.build_record_args", fake_build_args)

    app = _make_app(tmp_path)
    endpoint = _find_endpoint(app, "/api/record/start", "POST")
    payload = asyncio.run(endpoint({"record_repo_id": "user/ds", "record_task": "pick"}))

    assert payload["ok"] is True
    assert payload["resume_requested"] is False
    assert payload["resume_enabled"] is False
    assert stop_calls["count"] == 1
    assert captured["name"] == "record"

    cfg = captured["cfg"]
    assert isinstance(cfg, dict)
    assert cfg["record_cam_width"] == 960
    assert cfg["record_cam_height"] == 540
    assert cfg["record_cam_fps"] == 25


def test_api_teleop_start_auto_copies_bimanual_calibration_from_single_arm_files(monkeypatch, tmp_path: Path):
    captured: dict[str, object] = {}

    monkeypatch.setattr("lestudio.process_manager.ProcessManager.is_running", lambda self, name: False)
    monkeypatch.setattr("lestudio.process_manager.ProcessManager.conflicting_processes", lambda self, name: [])
    monkeypatch.setattr("lestudio.services.process_service.stop_all_streamers_for_process", lambda: None)
    monkeypatch.setattr(Path, "home", lambda: tmp_path)

    def fake_start(self, name: str, args: list[str]) -> bool:
        captured["name"] = name
        captured["args"] = args
        return True

    monkeypatch.setattr("lestudio.process_manager.ProcessManager.start", fake_start)

    robot_single_dir = tmp_path / ".cache" / "huggingface" / "lerobot" / "calibration" / "robots" / "so_follower"
    teleop_single_dir = tmp_path / ".cache" / "huggingface" / "lerobot" / "calibration" / "teleoperators" / "so_leader"
    robot_single_dir.mkdir(parents=True)
    teleop_single_dir.mkdir(parents=True)
    robot_calibration = {"joint_a": {"id": 1, "drive_mode": 0, "homing_offset": 0, "range_min": 1, "range_max": 2}}
    leader_calibration = {"joint_a": {"id": 1, "drive_mode": 1, "homing_offset": 0, "range_min": 1, "range_max": 2}}
    for name in ("follower_arm_1", "follower_arm_2"):
        (robot_single_dir / f"{name}.json").write_text(json.dumps(robot_calibration), encoding="utf-8")
    for name in ("leader_arm_1", "leader_arm_2"):
        (teleop_single_dir / f"{name}.json").write_text(json.dumps(leader_calibration), encoding="utf-8")

    app = _make_app(tmp_path)
    endpoint = _find_endpoint(app, "/api/teleop/start", "POST")
    payload = asyncio.run(
        endpoint(
            {
                "robot_mode": "bi",
                "robot_type": "bi_so_follower",
                "teleop_type": "bi_so_leader",
                "left_robot_id": "bimanual_follower_left",
                "right_robot_id": "bimanual_follower_right",
                "left_teleop_id": "bimanual_leader_left",
                "right_teleop_id": "bimanual_leader_right",
                "left_follower_port": "/dev/follower_arm_1",
                "right_follower_port": "/dev/follower_arm_2",
                "left_leader_port": "/dev/leader_arm_1",
                "right_leader_port": "/dev/leader_arm_2",
                "cameras": {},
            }
        )
    )

    assert payload["ok"] is True
    assert captured["name"] == "teleop"
    bi_robot_dir = tmp_path / ".cache" / "huggingface" / "lerobot" / "calibration" / "robots" / "bi_so_follower"
    bi_teleop_dir = tmp_path / ".cache" / "huggingface" / "lerobot" / "calibration" / "teleoperators" / "bi_so_leader"
    assert (bi_robot_dir / "bimanual_follower_left.json").exists()
    assert (bi_robot_dir / "bimanual_follower_right.json").exists()
    assert (bi_teleop_dir / "bimanual_leader_left.json").exists()
    assert (bi_teleop_dir / "bimanual_leader_right.json").exists()


def test_api_teleop_start_auto_normalizes_bimanual_ids_without_suffixes(monkeypatch, tmp_path: Path):
    captured: dict[str, object] = {}

    monkeypatch.setattr("lestudio.process_manager.ProcessManager.is_running", lambda self, name: False)
    monkeypatch.setattr("lestudio.process_manager.ProcessManager.conflicting_processes", lambda self, name: [])
    monkeypatch.setattr("lestudio.services.process_service.stop_all_streamers_for_process", lambda: None)
    monkeypatch.setattr(Path, "home", lambda: tmp_path)

    def fake_start(self, name: str, args: list[str]) -> bool:
        captured["name"] = name
        captured["args"] = args
        return True

    monkeypatch.setattr("lestudio.process_manager.ProcessManager.start", fake_start)

    robot_single_dir = tmp_path / ".cache" / "huggingface" / "lerobot" / "calibration" / "robots" / "so_follower"
    teleop_single_dir = tmp_path / ".cache" / "huggingface" / "lerobot" / "calibration" / "teleoperators" / "so_leader"
    robot_single_dir.mkdir(parents=True)
    teleop_single_dir.mkdir(parents=True)
    robot_cal = {"j": {"id": 1, "drive_mode": 0, "homing_offset": 0, "range_min": 1, "range_max": 2}}
    leader_cal = {"j": {"id": 1, "drive_mode": 1, "homing_offset": 0, "range_min": 1, "range_max": 2}}
    for name in ("follower_arm_1", "follower_arm_2"):
        (robot_single_dir / f"{name}.json").write_text(json.dumps(robot_cal), encoding="utf-8")
    for name in ("leader_arm_1", "leader_arm_2"):
        (teleop_single_dir / f"{name}.json").write_text(json.dumps(leader_cal), encoding="utf-8")

    app = _make_app(tmp_path)
    endpoint = _find_endpoint(app, "/api/teleop/start", "POST")
    payload = asyncio.run(
        endpoint(
            {
                "robot_mode": "bi",
                "robot_type": "bi_so_follower",
                "teleop_type": "bi_so_leader",
                "left_robot_id": "follower",
                "right_robot_id": "follower",
                "left_teleop_id": "leader",
                "right_teleop_id": "leader",
                "left_follower_port": "/dev/follower_arm_1",
                "right_follower_port": "/dev/follower_arm_2",
                "left_leader_port": "/dev/leader_arm_1",
                "right_leader_port": "/dev/leader_arm_2",
                "cameras": {},
            }
        )
    )

    assert payload["ok"] is True
    bi_robot_dir = tmp_path / ".cache" / "huggingface" / "lerobot" / "calibration" / "robots" / "bi_so_follower"
    bi_teleop_dir = tmp_path / ".cache" / "huggingface" / "lerobot" / "calibration" / "teleoperators" / "bi_so_leader"
    assert (bi_robot_dir / "follower_left.json").exists()
    assert (bi_robot_dir / "follower_right.json").exists()
    assert (bi_teleop_dir / "leader_left.json").exists()
    assert (bi_teleop_dir / "leader_right.json").exists()


def test_api_preflight_uses_bimanual_defaults_for_non_single_mode(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setattr(
        "lestudio.services.process_service.validate_calibration_file",
        lambda path: types.SimpleNamespace(errors=[], warnings=[]),
    )

    robot_single_dir = tmp_path / ".cache" / "huggingface" / "lerobot" / "calibration" / "robots" / "so_follower"
    teleop_single_dir = tmp_path / ".cache" / "huggingface" / "lerobot" / "calibration" / "teleoperators" / "so_leader"
    robot_single_dir.mkdir(parents=True)
    teleop_single_dir.mkdir(parents=True)
    calibration = {"joint_a": {"id": 1, "drive_mode": 0, "homing_offset": 0, "range_min": 1, "range_max": 2}}
    for name in ("follower_arm_1", "follower_arm_2"):
        (robot_single_dir / f"{name}.json").write_text(json.dumps(calibration), encoding="utf-8")
    for name in ("leader_arm_1", "leader_arm_2"):
        (teleop_single_dir / f"{name}.json").write_text(json.dumps(calibration), encoding="utf-8")

    left_follower = tmp_path / "follower_arm_1"
    right_follower = tmp_path / "follower_arm_2"
    left_leader = tmp_path / "leader_arm_1"
    right_leader = tmp_path / "leader_arm_2"
    for path in (left_follower, right_follower, left_leader, right_leader):
        path.write_text("", encoding="utf-8")

    app = _make_app(tmp_path)
    endpoint = _find_endpoint(app, "/api/preflight", "POST")
    payload = asyncio.run(
        endpoint(
            {
                "robot_mode": "bimanual",
                "left_robot_id": "bimanual_follower_left",
                "right_robot_id": "bimanual_follower_right",
                "left_teleop_id": "bimanual_leader_left",
                "right_teleop_id": "bimanual_leader_right",
                "left_follower_port": str(left_follower),
                "right_follower_port": str(right_follower),
                "left_leader_port": str(left_leader),
                "right_leader_port": str(right_leader),
                "cameras": {},
            }
        )
    )

    assert payload["ok"] is True
    checks = {entry["label"]: entry["msg"] for entry in payload["checks"]}
    assert "bimanual_follower_left.json" in checks["follower"]
    assert "bimanual_leader_left.json" in checks["leader"]


def test_api_eval_start_blocks_missing_real_robot_calibration(monkeypatch, tmp_path: Path):
    started = {"called": False}
    streamer_calls = {"count": 0}
    unlock_calls = {"count": 0}

    monkeypatch.setattr("lestudio.process_manager.ProcessManager.is_running", lambda self, name: False)
    monkeypatch.setattr("lestudio.process_manager.ProcessManager.conflicting_processes", lambda self, name: [])
    monkeypatch.setattr("lestudio.routes.eval._check_train_python_deps", lambda python_exe: {"ok": True})
    monkeypatch.setattr("lestudio.routes.eval._check_torchcodec_compat", lambda python_exe: {"ok": True})
    monkeypatch.setattr("lestudio.routes.eval._check_cuda_runtime_compat", lambda python_exe: (True, ""))
    monkeypatch.setattr(
        "lestudio.routes.eval.stop_all_streamers_for_process",
        lambda: streamer_calls.__setitem__("count", streamer_calls["count"] + 1),
    )
    monkeypatch.setattr(
        "lestudio.routes.eval.unlock_cameras",
        lambda: unlock_calls.__setitem__("count", unlock_calls["count"] + 1),
    )
    monkeypatch.setattr(
        "lestudio.routes.eval.build_eval_args",
        lambda python_exe, data: [python_exe, "-m", "lerobot.scripts.lerobot_eval", "--env.type=gym_manipulator"],
    )

    def fake_start(self, name: str, args: list[str]) -> bool:
        started["called"] = True
        return True

    monkeypatch.setattr("lestudio.process_manager.ProcessManager.start", fake_start)
    monkeypatch.setattr(Path, "home", lambda: tmp_path)

    app = _make_app(tmp_path)
    endpoint = _find_endpoint(app, "/api/eval/start", "POST")
    payload = asyncio.run(
        endpoint(
            {
                "eval_env_type": "gym_manipulator",
                "eval_task": "real_robot",
                "robot_mode": "single",
                "eval_robot_type": "so101_follower",
                "eval_teleop_type": "so101_leader",
                "robot_id": "follower_arm_1",
                "teleop_id": "leader_arm_1",
            }
        )
    )

    assert payload["ok"] is False
    assert "Missing follower calibration file" in payload["error"]
    assert started["called"] is False
    assert streamer_calls["count"] == 0
    assert unlock_calls["count"] == 0


def test_api_eval_start_rejects_invalid_bimanual_profile_ids(monkeypatch, tmp_path: Path):
    monkeypatch.setattr("lestudio.process_manager.ProcessManager.is_running", lambda self, name: False)
    monkeypatch.setattr("lestudio.process_manager.ProcessManager.conflicting_processes", lambda self, name: [])
    monkeypatch.setattr("lestudio.routes.eval._check_train_python_deps", lambda python_exe: {"ok": True})
    monkeypatch.setattr("lestudio.routes.eval._check_torchcodec_compat", lambda python_exe: {"ok": True})
    monkeypatch.setattr("lestudio.routes.eval._check_cuda_runtime_compat", lambda python_exe: (True, ""))

    app = _make_app(tmp_path)
    endpoint = _find_endpoint(app, "/api/eval/start", "POST")
    payload = asyncio.run(
        endpoint(
            {
                "eval_env_type": "gym_manipulator",
                "eval_task": "real_robot",
                "robot_mode": "bi",
                "eval_robot_type": "bi_so_follower",
                "eval_teleop_type": "bi_so_leader",
                "left_robot_id": "../evil_left",
                "right_robot_id": "bimanual_follower_right",
                "left_teleop_id": "bimanual_leader_left",
                "right_teleop_id": "bimanual_leader_right",
            }
        )
    )

    assert payload["ok"] is False
    assert "Invalid" in payload["error"]


@pytest.mark.skipif(not _has_lerobot_rl, reason="lerobot.rl not available")
def test_api_eval_start_auto_copies_missing_bimanual_calibration(monkeypatch, tmp_path: Path):
    started = {"called": False}

    monkeypatch.setattr("lestudio.process_manager.ProcessManager.is_running", lambda self, name: False)
    monkeypatch.setattr("lestudio.process_manager.ProcessManager.conflicting_processes", lambda self, name: [])
    monkeypatch.setattr("lestudio.routes.eval._check_train_python_deps", lambda python_exe: {"ok": True})
    monkeypatch.setattr("lestudio.routes.eval._check_torchcodec_compat", lambda python_exe: {"ok": True})
    monkeypatch.setattr("lestudio.routes.eval._check_cuda_runtime_compat", lambda python_exe: (True, ""))
    monkeypatch.setattr("lestudio.routes.eval.stop_all_streamers_for_process", lambda: None)
    monkeypatch.setattr("lestudio.routes.eval.unlock_cameras", lambda: None)
    monkeypatch.setattr(
        "lestudio.routes.eval.build_eval_args",
        lambda python_exe, data: [python_exe, "-m", "lerobot.scripts.lerobot_eval", "--env.type=gym_manipulator"],
    )
    monkeypatch.setattr(Path, "home", lambda: tmp_path)

    def fake_start(self, name: str, args: list[str]) -> bool:
        started["called"] = True
        return True

    monkeypatch.setattr("lestudio.process_manager.ProcessManager.start", fake_start)

    robot_single_dir = tmp_path / ".cache" / "huggingface" / "lerobot" / "calibration" / "robots" / "so_follower"
    teleop_single_dir = tmp_path / ".cache" / "huggingface" / "lerobot" / "calibration" / "teleoperators" / "so_leader"
    robot_single_dir.mkdir(parents=True)
    teleop_single_dir.mkdir(parents=True)
    robot_calibration = {"joint_a": {"id": 1, "drive_mode": 0, "homing_offset": 0, "range_min": 1, "range_max": 2}}
    leader_calibration = {"joint_a": {"id": 1, "drive_mode": 1, "homing_offset": 0, "range_min": 1, "range_max": 2}}
    for name in ("follower_arm_1", "follower_arm_2"):
        (robot_single_dir / f"{name}.json").write_text(json.dumps(robot_calibration), encoding="utf-8")
    for name in ("leader_arm_1", "leader_arm_2"):
        (teleop_single_dir / f"{name}.json").write_text(json.dumps(leader_calibration), encoding="utf-8")

    app = _make_app(tmp_path)
    endpoint = _find_endpoint(app, "/api/eval/start", "POST")
    payload = asyncio.run(
        endpoint(
            {
                "eval_env_type": "gym_manipulator",
                "eval_task": "real_robot",
                "robot_mode": "bi",
                "eval_robot_type": "bi_so_follower",
                "eval_teleop_type": "bi_so_leader",
                "left_robot_id": "bimanual_follower_left",
                "right_robot_id": "bimanual_follower_right",
                "left_teleop_id": "bimanual_leader_left",
                "right_teleop_id": "bimanual_leader_right",
                "left_follower_port": "/dev/follower_arm_1",
                "right_follower_port": "/dev/follower_arm_2",
                "left_leader_port": "/dev/leader_arm_1",
                "right_leader_port": "/dev/leader_arm_2",
            }
        )
    )

    assert payload["ok"] is True
    assert started["called"] is True
    bi_robot_dir = tmp_path / ".cache" / "huggingface" / "lerobot" / "calibration" / "robots" / "bi_so_follower"
    bi_teleop_dir = tmp_path / ".cache" / "huggingface" / "lerobot" / "calibration" / "teleoperators" / "bi_so_leader"
    assert (bi_robot_dir / "bimanual_follower_left.json").exists()
    assert (bi_robot_dir / "bimanual_follower_right.json").exists()
    assert (bi_teleop_dir / "bimanual_leader_left.json").exists()
    assert (bi_teleop_dir / "bimanual_leader_right.json").exists()


def test_api_teleop_start_rejects_invalid_bimanual_profile_id(monkeypatch, tmp_path: Path):
    monkeypatch.setattr("lestudio.process_manager.ProcessManager.is_running", lambda self, name: False)
    monkeypatch.setattr("lestudio.process_manager.ProcessManager.conflicting_processes", lambda self, name: [])
    monkeypatch.setattr("lestudio.services.process_service.stop_all_streamers_for_process", lambda: None)

    app = _make_app(tmp_path)
    endpoint = _find_endpoint(app, "/api/teleop/start", "POST")
    payload = asyncio.run(
        endpoint(
            {
                "robot_mode": "bi",
                "robot_type": "bi_so_follower",
                "teleop_type": "bi_so_leader",
                "left_robot_id": "../evil_left",
                "right_robot_id": "bimanual_follower_right",
                "left_teleop_id": "bimanual_leader_left",
                "right_teleop_id": "bimanual_leader_right",
                "left_follower_port": "/dev/follower_arm_1",
                "right_follower_port": "/dev/follower_arm_2",
                "left_leader_port": "/dev/leader_arm_1",
                "right_leader_port": "/dev/leader_arm_2",
                "cameras": {},
            }
        )
    )

    assert payload["ok"] is False
    assert "Invalid follower left calibration profile id" in payload["error"]


def test_api_calibrate_file_supports_bimanual_shared_profile_id(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setattr(
        "lestudio.services.process_service.validate_calibration_file",
        lambda path: types.SimpleNamespace(errors=[], warnings=[]),
    )

    bi_dir = tmp_path / ".cache" / "huggingface" / "lerobot" / "calibration" / "teleoperators" / "bi_so_leader"
    bi_dir.mkdir(parents=True)
    left_path = bi_dir / "leader_arm_left.json"
    right_path = bi_dir / "leader_arm_right.json"
    left_path.write_text(json.dumps({"left": True}), encoding="utf-8")
    right_path.write_text(json.dumps({"right": True}), encoding="utf-8")

    app = _make_app(tmp_path)
    endpoint = _find_endpoint(app, "/api/calibrate/file", "GET")
    payload = endpoint("bi_so_leader", "leader_arm")

    assert payload["exists"] is True
    assert payload["path"].endswith("leader_arm_{left,right}.json")
    assert payload["size"] == left_path.stat().st_size + right_path.stat().st_size
    assert payload["validation"]["ok"] is True


def test_api_calibrate_delete_supports_bimanual_shared_profile_id(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(Path, "home", lambda: tmp_path)

    bi_dir = tmp_path / ".cache" / "huggingface" / "lerobot" / "calibration" / "robots" / "bi_so_follower"
    bi_dir.mkdir(parents=True)
    left_path = bi_dir / "follower_arm_left.json"
    right_path = bi_dir / "follower_arm_right.json"
    left_path.write_text(json.dumps({"left": True}), encoding="utf-8")
    right_path.write_text(json.dumps({"right": True}), encoding="utf-8")

    app = _make_app(tmp_path)
    endpoint = _find_endpoint(app, "/api/calibrate/file", "DELETE")
    payload = endpoint("bi_so_follower", "follower_arm")

    assert payload["ok"] is True
    assert not left_path.exists()
    assert not right_path.exists()


def test_api_motor_setup_start_rejects_unsupported_type(monkeypatch, tmp_path: Path):
    monkeypatch.setattr("lestudio.process_manager.ProcessManager.is_running", lambda self, name: False)
    monkeypatch.setattr("lestudio.process_manager.ProcessManager.conflicting_processes", lambda self, name: [])

    app = _make_app(tmp_path)
    endpoint = _find_endpoint(app, "/api/motor_setup/start", "POST")
    payload = asyncio.run(endpoint({"robot_type": "bi_so_follower", "port": "/dev/follower_arm_1"}))

    assert payload["ok"] is False
    assert "Motor Setup does not support 'bi_so_follower'" in payload["error"]


def test_snapshot_camera_returns_streamer_frame(monkeypatch, tmp_path: Path):
    monkeypatch.setattr("lestudio.process_manager.ProcessManager.is_running", lambda self, name: False)
    monkeypatch.setattr("lestudio.routes.streaming.snapshot_get_frame", lambda video_path, config_path: b"jpeg-bytes")

    app = _make_app(tmp_path)
    endpoint = _find_endpoint(app, "/api/camera/snapshot/{video_name}", "GET")
    response = asyncio.run(endpoint("video0"))

    assert response.status_code == 200
    assert response.media_type == "image/jpeg"
    assert response.body == b"jpeg-bytes"


def test_snapshot_camera_returns_503_when_frame_unavailable(monkeypatch, tmp_path: Path):
    async def _fast_sleep(_seconds: float):
        return None

    monkeypatch.setattr("lestudio.process_manager.ProcessManager.is_running", lambda self, name: False)
    monkeypatch.setattr("lestudio.routes.streaming.snapshot_get_frame", lambda video_path, config_path: None)
    monkeypatch.setattr("lestudio.routes.streaming.asyncio.sleep", _fast_sleep)

    app = _make_app(tmp_path)
    endpoint = _find_endpoint(app, "/api/camera/snapshot/{video_name}", "GET")
    response = asyncio.run(endpoint("video0"))

    assert response.status_code == 503
    assert response.headers.get("retry-after") == "1"


def test_train_preflight_cache_is_used_and_invalidated(monkeypatch, tmp_path: Path):
    training_service._preflight_cache.clear()
    calls = {"cuda": 0}

    monkeypatch.setattr("lestudio.process_manager.ProcessManager.is_running", lambda self, name: False)
    monkeypatch.setattr("lestudio.process_manager.ProcessManager.start", lambda self, name, args: True)
    monkeypatch.setattr("lestudio.services.training_service._check_train_python_deps", lambda python_exe: {"ok": True})

    def fake_cuda_compat(_python_exe: str):
        calls["cuda"] += 1
        return False, "cuda mismatch"

    monkeypatch.setattr("lestudio.services.training_service._check_cuda_runtime_compat", fake_cuda_compat)
    monkeypatch.setattr(
        "lestudio.services.training_service._build_torch_install_args",
        lambda python_exe, cuda_tag, nightly: ["pip", "install", "torch"],
    )
    monkeypatch.setattr("lestudio.services.training_service._format_cmd", lambda args: "pip install torch")

    app = _make_app(tmp_path)
    preflight = _find_endpoint(app, "/api/train/preflight", "GET")
    install = _find_endpoint(app, "/api/train/install_pytorch", "POST")

    first = preflight("cuda")
    second = preflight("cuda")
    assert first["ok"] is False
    assert second["ok"] is False
    assert calls["cuda"] == 1
    assert training_service._preflight_cache

    payload = asyncio.run(install({"nightly": True, "cuda_tag": "cu128"}))
    assert payload["ok"] is True
    assert training_service._preflight_cache == {}
    training_service._preflight_cache.clear()


def test_hf_whoami_cache_is_token_scoped(monkeypatch, tmp_path: Path):
    calls = {"count": 0}

    def fake_whoami(*, token: str):
        calls["count"] += 1
        return {"name": f"user-{token}"}

    monkeypatch.setitem(sys.modules, "huggingface_hub", types.SimpleNamespace(whoami=fake_whoami))
    monkeypatch.setenv("HF_TOKEN", "token-a")

    app = _make_app(tmp_path)
    endpoint = _find_endpoint(app, "/api/hf/whoami", "GET")

    first = endpoint()
    second = endpoint()
    assert first == {"ok": True, "username": "user-token-a"}
    assert second == {"ok": True, "username": "user-token-a"}
    assert calls["count"] == 1

    monkeypatch.setenv("HF_TOKEN", "token-b")
    third = endpoint()
    assert third == {"ok": True, "username": "user-token-b"}
    assert calls["count"] == 2


def test_hf_token_crud_status(monkeypatch, tmp_path: Path):
    monkeypatch.delenv("HF_TOKEN", raising=False)
    monkeypatch.delenv("HUGGINGFACE_HUB_TOKEN", raising=False)

    app = _make_app(tmp_path)
    status_endpoint = _find_endpoint(app, "/api/hf/token/status", "GET")
    set_endpoint = _find_endpoint(app, "/api/hf/token", "POST")
    set_endpoint_put = _find_endpoint(app, "/api/hf/token", "PUT")
    clear_endpoint = _find_endpoint(app, "/api/hf/token", "DELETE")

    initial = status_endpoint()
    assert initial["ok"] is True
    assert initial["has_token"] is False
    assert initial["source"] == "none"

    saved = asyncio.run(set_endpoint(HfTokenRequest(token="hf_test_123456")))
    assert saved["ok"] is True
    assert saved["has_token"] is True
    assert saved["source"] == "env"

    after_set = status_endpoint()
    assert after_set["ok"] is True
    assert after_set["has_token"] is True
    assert after_set["source"] == "env"
    assert after_set["masked_token"].startswith("hf_t")

    token_file = tmp_path / "config" / "hf_token"
    assert token_file.exists()
    assert token_file.read_text() == "hf_test_123456"

    saved_put = asyncio.run(set_endpoint_put(HfTokenRequest(token="hf_test_654321")))
    assert saved_put["ok"] is True
    assert saved_put["has_token"] is True
    assert saved_put["source"] == "env"
    assert token_file.read_text() == "hf_test_654321"

    cleared = clear_endpoint()
    assert cleared["ok"] is True
    assert cleared["has_token"] is False
    assert cleared["source"] == "none"
    assert not token_file.exists()

    after_clear = status_endpoint()
    assert after_clear["ok"] is True
    assert after_clear["has_token"] is False
    assert after_clear["source"] == "none"


def test_train_colab_config_uploads_json_and_returns_link(monkeypatch, tmp_path: Path):
    captured: dict[str, object] = {}
    monkeypatch.setenv("HF_TOKEN", "hf_test_token")

    def fake_which(name: str):
        if name == "huggingface-cli":
            return "/usr/bin/huggingface-cli"
        return None

    def fake_run(cmd, capture_output, text, env, timeout):
        captured["cmd"] = list(cmd)
        captured["env_tokens"] = (env.get("HF_TOKEN"), env.get("HUGGINGFACE_HUB_TOKEN"))
        cfg_path = Path(cmd[3])
        captured["cfg"] = json.loads(cfg_path.read_text())
        return types.SimpleNamespace(returncode=0, stdout="uploaded", stderr="")

    monkeypatch.setattr(training_service.shutil, "which", fake_which)
    monkeypatch.setattr(training_service.subprocess, "run", fake_run)

    app = _make_app(tmp_path)
    endpoint = _find_endpoint(app, "/api/train/colab/config", "POST")
    payload = asyncio.run(
        endpoint(
            {
                "train_repo_id": "user/my-dataset",
                "train_policy": "act",
                "train_steps": 12345,
                "train_device": "mps",
                "train_batch_size": 16,
                "train_lr": "1e-4",
                "train_output_repo": "user/my-policy",
                "colab_notebook_url": "https://colab.research.google.com/github/acme/repo/blob/main/notebooks/train.ipynb?foo=bar&repo_id={repo_id}&config_path={config_path}",
            }
        )
    )

    assert payload["ok"] is True
    assert payload["repo_id"] == "user/my-dataset"
    assert payload["config_path"] == "lestudio_train_config.json"
    assert payload["manual_run_required"] is True
    assert "repo_id=user%2Fmy-dataset" in payload["colab_link"]
    assert "config_path=lestudio_train_config.json" in payload["colab_link"]

    cmd = captured["cmd"]
    assert isinstance(cmd, list)
    assert cmd[:3] == ["/usr/bin/huggingface-cli", "upload", "user/my-dataset"]
    assert cmd[4] == "lestudio_train_config.json"
    assert captured["env_tokens"] == ("hf_test_token", "hf_test_token")

    cfg = captured["cfg"]
    assert isinstance(cfg, dict)
    assert cfg["dataset_repo"] == "user/my-dataset"
    assert cfg["policy"] == "act"
    assert cfg["steps"] == 12345
    assert cfg["train_device"] == "cuda"
    assert cfg["batch_size"] == 16
    assert cfg["output_repo"] == "user/my-policy"


def test_train_colab_config_requires_hf_token(monkeypatch, tmp_path: Path):
    monkeypatch.delenv("HF_TOKEN", raising=False)
    monkeypatch.delenv("HUGGINGFACE_HUB_TOKEN", raising=False)

    app = _make_app(tmp_path)
    endpoint = _find_endpoint(app, "/api/train/colab/config", "POST")
    payload = asyncio.run(endpoint({"train_repo_id": "user/my-dataset"}))

    assert payload["ok"] is False
    assert "HF_TOKEN" in payload["error"]


def test_train_colab_link_defaults_to_starter_notebook(monkeypatch, tmp_path: Path):
    app = _make_app(tmp_path)
    endpoint = _find_endpoint(app, "/api/train/colab/link", "GET")
    payload = endpoint("user/my-dataset", "lestudio_train_config.json", "")

    assert payload["ok"] is True
    assert payload["repo_id"] == "user/my-dataset"
    assert (
        payload["url"]
        == "https://colab.research.google.com/github/TheMomentLab/lerobot-studio/blob/dev/notebooks/lerobot_train.ipynb"
    )


def test_train_colab_link_does_not_mutate_colab_root_url(monkeypatch, tmp_path: Path):
    app = _make_app(tmp_path)
    endpoint = _find_endpoint(app, "/api/train/colab/link", "GET")
    payload = endpoint("user/my-dataset", "lestudio_train_config.json", "https://colab.research.google.com/")

    assert payload["ok"] is True
    assert payload["url"] == "https://colab.research.google.com/"


def test_train_colab_link_expands_placeholders_when_present(monkeypatch, tmp_path: Path):
    app = _make_app(tmp_path)
    endpoint = _find_endpoint(app, "/api/train/colab/link", "GET")
    payload = endpoint(
        "user/my-dataset",
        "lestudio_train_config.json",
        "https://colab.research.google.com/github/acme/repo/blob/main/notebooks/train.ipynb?repo_id={repo_id}&config_path={config_path}",
    )

    assert payload["ok"] is True
    assert "repo_id=user%2Fmy-dataset" in payload["url"]
    assert "config_path=lestudio_train_config.json" in payload["url"]


def test_api_checkpoints_scans_nested_train_run_layout(monkeypatch, tmp_path: Path):
    monkeypatch.chdir(tmp_path)

    pretrained = (
        tmp_path / "outputs" / "train" / "2026-02-28" / "02-34-35_act" / "checkpoints" / "020000" / "pretrained_model"
    )
    pretrained.mkdir(parents=True)
    (pretrained / "config.json").write_text("{}")
    (pretrained / "model.safetensors").write_text("weights")
    (pretrained / "train_config.json").write_text('{"policy": {"type": "act"}}')

    app = _make_app(tmp_path)
    endpoint = _find_endpoint(app, "/api/checkpoints", "GET")
    payload = endpoint()

    assert payload["ok"] is True
    checkpoints = payload["checkpoints"]
    assert len(checkpoints) == 1
    assert checkpoints[0]["display"] == "2026-02-28/02-34-35_act/020000"
    assert checkpoints[0]["path"].endswith("outputs/train/2026-02-28/02-34-35_act/checkpoints/020000/pretrained_model")
    assert checkpoints[0]["step"] == 20000
