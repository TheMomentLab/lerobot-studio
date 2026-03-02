"""Config management helpers."""
from __future__ import annotations

import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

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
        "wrist_1": "/dev/wrist_cam_1",
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
    "train_dataset_source": "local",
    "train_output_repo": "",
    "process_view_url": "",
    "eval_policy_path": "outputs/train/checkpoints/last/pretrained_model",
    "eval_repo_id": "",
    "eval_env_type": "",
    "eval_episodes": 10,
    "eval_device": "cuda",
    "eval_task": "",
    "eval_robot_type": "so101_follower",
    "eval_teleop_type": "so101_leader",
}


def _load_config(config_path: Path) -> dict:
    if config_path.exists():
        try:
            content = config_path.read_text().strip()
            if content:
                return {**DEFAULT_CONFIG, **json.loads(content)}
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            pass
    return DEFAULT_CONFIG.copy()


def _save_config(config_path: Path, cfg: dict):
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(json.dumps(cfg, indent=2))

