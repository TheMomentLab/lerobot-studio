from __future__ import annotations

import json
from pathlib import Path

from lestudio import command_builders as cb


def test_dataset_cache_path_uses_hf_lerobot_prefix(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    assert cb.dataset_cache_path("user/repo") == tmp_path / ".cache" / "huggingface" / "lerobot" / "user/repo"


def test_resolve_record_resume_false_cleans_cache(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    cache_dir = cb.dataset_cache_path("user/repo")
    cache_dir.mkdir(parents=True)
    (cache_dir / "stale.txt").write_text("x")

    requested, enabled = cb.resolve_record_resume({"record_resume": False, "record_repo_id": "user/repo"})
    assert (requested, enabled) == (False, False)
    assert not cache_dir.exists()


def test_resolve_record_resume_true_enabled_when_meta_exists(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    meta = cb.dataset_cache_path("user/repo") / "meta" / "tasks.parquet"
    meta.parent.mkdir(parents=True)
    meta.write_bytes(b"parquet")

    requested, enabled = cb.resolve_record_resume({"record_resume": True, "record_repo_id": "user/repo"})
    assert (requested, enabled) == (True, True)


def test_resolve_record_resume_true_without_meta_cleans_cache(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    cache_dir = cb.dataset_cache_path("user/repo")
    cache_dir.mkdir(parents=True)
    (cache_dir / "old.bin").write_bytes(b"old")

    requested, enabled = cb.resolve_record_resume({"record_resume": True, "record_repo_id": "user/repo"})
    assert (requested, enabled) == (True, False)
    assert not cache_dir.exists()


def test_build_teleop_args_single_mode_includes_speed_limit():
    args = cb.build_teleop_args(
        "/py",
        {
            "follower_port": "/dev/follower_arm_1",
            "leader_port": "/dev/leader_arm_1",
            "teleop_speed": "0.25",
            "robot_id": "r1",
            "teleop_id": "t1",
        },
    )
    assert args[:3] == ["/py", "-m", "lestudio.teleop_bridge"]
    assert "--robot.type=so101_follower" in args
    assert "--teleop.type=so101_leader" in args
    assert "--robot.max_relative_target=8.0" in args


def test_build_teleop_args_bi_mode_without_limit_when_speed_1():
    args = cb.build_teleop_args(
        "/py",
        {
            "robot_mode": "bi",
            "left_follower_port": "/dev/f1",
            "right_follower_port": "/dev/f2",
            "left_leader_port": "/dev/l1",
            "right_leader_port": "/dev/l2",
            "teleop_speed": "1.0",
        },
    )
    assert "--robot.type=bi_so_follower" in args
    assert "--teleop.type=bi_so_leader" in args
    assert not any("max_relative_target" in a for a in args)


def test_build_record_args_single_with_camera_serialization():
    cfg = {
        "record_repo_id": "u/ds",
        "record_episodes": 3,
        "record_task": "pick",
        "follower_port": "/dev/f",
        "leader_port": "/dev/l",
        "cameras": {"top_1": "video0", "wrist_1": "/dev/video1", "none": ""},
        "record_cam_width": 320,
        "record_cam_height": 240,
        "record_cam_fps": 15,
    }
    args = cb.build_record_args("/py", cfg, resume_enabled=True)
    assert "--resume=true" in args
    cam_arg = next(a for a in args if a.startswith("--robot.cameras="))
    payload = json.loads(cam_arg.split("=", 1)[1])
    assert payload["top_1"]["index_or_path"] == "/dev/video0"
    assert payload["wrist_1"]["width"] == 320
    assert "--robot.type=so101_follower" in args


def test_build_record_args_bi_mode_places_camera_on_left_arm():
    cfg = {
        "robot_mode": "bi",
        "left_follower_port": "/dev/f1",
        "right_follower_port": "/dev/f2",
        "left_leader_port": "/dev/l1",
        "right_leader_port": "/dev/l2",
        "cameras": {"top_1": "/dev/video0"},
    }
    args = cb.build_record_args("/py", cfg, resume_enabled=False)
    assert "--robot.type=bi_so_follower" in args
    assert "--teleop.type=bi_so_leader" in args
    assert "--robot.cameras={}" in args
    left_cam = next(a for a in args if a.startswith("--robot.left_arm_config.cameras="))
    assert "video0" in left_cam


def test_build_calibrate_args_single_robot_and_leader():
    robot_args = cb.build_calibrate_args("/py", {"robot_type": "so101_follower", "robot_id": "rid", "port": "/dev/f"})
    assert "--robot.type=so101_follower" in robot_args
    assert "--robot.id=rid" in robot_args

    leader_args = cb.build_calibrate_args("/py", {"robot_type": "so101_leader", "robot_id": "lid", "port": "/dev/l"})
    assert "--teleop.type=so101_leader" in leader_args
    assert "--teleop.id=lid" in leader_args


def test_build_calibrate_args_bi_leader_uses_teleop_namespace():
    args = cb.build_calibrate_args(
        "/py",
        {
            "robot_mode": "bi",
            "bi_type": "bi_so_leader",
            "robot_id": "bi-id",
            "left_port": "/dev/l1",
            "right_port": "/dev/l2",
        },
    )
    assert "--teleop.type=bi_so_leader" in args
    assert "--teleop.left_arm_config.port=/dev/l1" in args
    assert "--teleop.right_arm_config.port=/dev/l2" in args


def test_build_motor_setup_args_switches_namespace_for_leader():
    robot_args = cb.build_motor_setup_args("/py", {"robot_type": "so101_follower", "port": "/dev/f"})
    assert "--robot.type=so101_follower" in robot_args

    leader_args = cb.build_motor_setup_args("/py", {"robot_type": "so101_leader", "port": "/dev/l"})
    assert "--teleop.type=so101_leader" in leader_args
    assert "--teleop.port=/dev/l" in leader_args


def test_build_train_args_maps_tdmpc2_and_optional_fields():
    args = cb.build_train_args(
        "/py",
        {
            "train_policy": "tdmpc2",
            "train_repo_id": "u/ds",
            "train_steps": 123,
            "train_device": "cpu",
            "train_batch_size": 16,
            "train_lr": 1e-4,
        },
    )
    assert "--policy.type=tdmpc" in args
    assert "--dataset.repo_id=u/ds" in args
    assert "--batch_size=16" in args
    assert "--optimizer.lr=0.0001" in args


def test_build_eval_args_defaults_and_task():
    args = cb.build_eval_args("/py", {"train_repo_id": "u/train", "eval_task": "pick-red"})
    assert "--policy.path=outputs/train/checkpoints/last/pretrained_model" in args
    assert "--dataset.repo_id=u/train" in args
    assert "--env.task=pick-red" in args
