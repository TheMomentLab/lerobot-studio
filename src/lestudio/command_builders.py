import json
import logging
import shutil
from json import JSONDecodeError
from pathlib import Path

logger = logging.getLogger(__name__)

def dataset_cache_path(repo_id: str) -> Path:
    return Path.home() / ".cache" / "huggingface" / "lerobot" / repo_id


def resolve_record_resume(cfg: dict) -> tuple[bool, bool]:
    requested_resume = bool(cfg.get("record_resume"))
    repo_id = str(cfg.get("record_repo_id", "user/dataset"))
    cache_dir = dataset_cache_path(repo_id)
    
    if not requested_resume:
        if cache_dir.exists():
            shutil.rmtree(cache_dir, ignore_errors=True)
        return False, False

    meta_path = cache_dir / "meta" / "tasks.parquet"
    enabled = meta_path.exists()
    
    if cache_dir.exists() and not enabled:
        shutil.rmtree(cache_dir, ignore_errors=True)
        
    return True, enabled


def build_teleop_args(python_exe: str, cfg: dict) -> list[str]:
    # Speed multiplier → max_relative_target (degrees per tick at 60fps)
    # 1.0 = no limit, 0.5 ≈ 15 deg/tick, 0.25 ≈ 8, 0.1 ≈ 3
    _SPEED_TO_MAX_REL: dict[str, float | None] = {
        "1.0": None,
        "0.75": 25.0,
        "0.5": 15.0,
        "0.25": 8.0,
        "0.1": 3.0,
    }
    speed_key = str(cfg.get("teleop_speed", "0.5"))
    max_rel = _SPEED_TO_MAX_REL.get(speed_key, 15.0)
    if cfg.get("robot_mode") == "bi":
        args = [
            python_exe,
            "-m",
            "lestudio.teleop_bridge",
            "--robot.type=bi_so_follower",
            f'--robot.left_arm_config.port={cfg["left_follower_port"]}',
            f'--robot.right_arm_config.port={cfg["right_follower_port"]}',
            "--teleop.type=bi_so_leader",
            f'--teleop.left_arm_config.port={cfg["left_leader_port"]}',
            f'--teleop.right_arm_config.port={cfg["right_leader_port"]}',
            "--display_data=false",
        ]
        if max_rel is not None:
            args.append(f"--robot.left_arm_config.max_relative_target={max_rel}")
            args.append(f"--robot.right_arm_config.max_relative_target={max_rel}")
        return args
    args = [
        python_exe,
        "-m",
        "lestudio.teleop_bridge",
        "--robot.type=so101_follower",
        f'--robot.port={cfg["follower_port"]}',
        f'--robot.id={cfg.get("robot_id", "my_so101_follower_1")}',
        "--teleop.type=so101_leader",
        f'--teleop.port={cfg["leader_port"]}',
        f'--teleop.id={cfg.get("teleop_id", "my_so101_leader_1")}',
        "--display_data=false",
    ]
    if max_rel is not None:
        args.append(f"--robot.max_relative_target={max_rel}")
    return args


def build_record_args(python_exe: str, cfg: dict, resume_enabled: bool) -> list[str]:
    base = [
        f'--dataset.repo_id={cfg.get("record_repo_id", "user/dataset")}',
        f'--dataset.num_episodes={cfg.get("record_episodes", 50)}',
        f'--dataset.single_task={cfg.get("record_task", "task")}',
        "--display_data=false",
        "--dataset.vcodec=h264",
        "--dataset.push_to_hub=true" if cfg.get("record_push_to_hub") else "--dataset.push_to_hub=false",
    ]
    if resume_enabled:
        base.append("--resume=true")

    rec_w = cfg.get("record_cam_width", 640)
    rec_h = cfg.get("record_cam_height", 480)
    rec_fps = cfg.get("record_cam_fps", 30)
    
    cameras = cfg.get("cameras", {})
    cam_dict = {}
    for name, path in cameras.items():
        if path:
            if not path.startswith("/dev/"):
                path = f"/dev/{path}"
            cam_dict[name] = {"type": "opencv", "index_or_path": path, "width": rec_w, "height": rec_h, "fps": rec_fps, "fourcc": "MJPG"}
    
    is_bi = cfg.get("robot_mode") == "bi"
    if cam_dict:
        cam_str = json.dumps(cam_dict)
        if is_bi:
            base.append(f"--robot.cameras={{}}")
            base.append(f"--robot.left_arm_config.cameras={cam_str}")
        else:
            base.append(f"--robot.cameras={cam_str}")

    if is_bi:
        return [
            python_exe,
            "-m",
            "lestudio.record_bridge",
            "--robot.type=bi_so_follower",
            f'--robot.left_arm_config.port={cfg["left_follower_port"]}',
            f'--robot.right_arm_config.port={cfg["right_follower_port"]}',
            "--teleop.type=bi_so_leader",
            f'--teleop.left_arm_config.port={cfg["left_leader_port"]}',
            f'--teleop.right_arm_config.port={cfg["right_leader_port"]}',
        ] + base
    return [
        python_exe,
        "-m",
        "lestudio.record_bridge",
        "--robot.type=so101_follower",
        f'--robot.port={cfg["follower_port"]}',
        f'--robot.id={cfg.get("robot_id", "my_so101_follower_1")}',
        "--teleop.type=so101_leader",
        f'--teleop.port={cfg["leader_port"]}',
        f'--teleop.id={cfg.get("teleop_id", "my_so101_leader_1")}',
    ] + base


def build_calibrate_args(python_exe: str, data: dict) -> list[str]:
    robot_mode = data.get("robot_mode", "single")

    if robot_mode == "bi":
        bi_type = data.get("bi_type", "bi_so_follower")
        robot_id = data.get("robot_id", "bimanual_follower")
        left_port = data.get("left_port", "/dev/follower_arm_1")
        right_port = data.get("right_port", "/dev/follower_arm_2")
        if "leader" in bi_type:
            return [
                python_exe,
                "-m",
                "lerobot.scripts.lerobot_calibrate",
                f"--teleop.type={bi_type}",
                f"--teleop.left_arm_config.port={left_port}",
                f"--teleop.right_arm_config.port={right_port}",
                f"--teleop.id={robot_id}",
            ]
        return [
            python_exe,
            "-m",
            "lerobot.scripts.lerobot_calibrate",
            f"--robot.type={bi_type}",
            f"--robot.left_arm_config.port={left_port}",
            f"--robot.right_arm_config.port={right_port}",
            f"--robot.id={robot_id}",
        ]

    robot_type = data.get("robot_type", "so101_follower")
    robot_id = data.get("robot_id", "my_so101_follower_1")
    port = data.get("port", "/dev/follower_arm_1")
    if "leader" in robot_type:
        return [
            python_exe,
            "-m",
            "lerobot.scripts.lerobot_calibrate",
            f"--teleop.type={robot_type}",
            f"--teleop.port={port}",
            f"--teleop.id={robot_id}",
        ]
    return [
        python_exe,
        "-m",
        "lerobot.scripts.lerobot_calibrate",
        f"--robot.type={robot_type}",
        f"--robot.port={port}",
        f"--robot.id={robot_id}",
    ]


def build_motor_setup_args(python_exe: str, data: dict) -> list[str]:
    robot_type = data.get("robot_type", "so101_follower")
    port = data.get("port", "/dev/follower_arm_1")
    if "leader" in robot_type:
        return [
            python_exe,
            "-m",
            "lerobot.scripts.lerobot_setup_motors",
            f"--teleop.type={robot_type}",
            f"--teleop.port={port}",
        ]
    return [
        python_exe,
        "-m",
        "lerobot.scripts.lerobot_setup_motors",
        f"--robot.type={robot_type}",
        f"--robot.port={port}",
    ]


def build_train_args(python_exe: str, cfg: dict) -> list[str]:
    policy_raw = str(cfg.get("train_policy", "act"))
    policy = "tdmpc" if policy_raw == "tdmpc2" else policy_raw
    repo_id = cfg.get("train_repo_id", "user/dataset")
    steps = cfg.get("train_steps", 100000)
    device = cfg.get("train_device", "cuda")
    args = [
        python_exe,
        "-m",
        "lerobot.scripts.lerobot_train",
        f"--policy.type={policy}",
        f"--dataset.repo_id={repo_id}",
        f"--steps={steps}",
        f"--policy.device={device}",
        "--policy.push_to_hub=false",
    ]

    batch_size = cfg.get("train_batch_size")
    if batch_size:
        args.append(f"--batch_size={int(batch_size)}")

    lr = cfg.get("train_lr")
    if lr:
        args.append(f"--optimizer.lr={float(lr)}")

    return args


def _normalize_env_type(raw: str) -> str:
    return (raw or "").strip()


def _sanitize_env_value(raw: object) -> str:
    value = str(raw or "").strip()
    if value.lower() in {"", "none", "null"}:
        return ""
    return value


def build_eval_args(python_exe: str, cfg: dict) -> list[str]:
    policy_path = str(cfg.get("eval_policy_path", "")).strip()
    if not policy_path:
        policy_path = "outputs/train/checkpoints/last/pretrained_model"

    repo_id = str(cfg.get("eval_repo_id", "")).strip()
    episodes = int(cfg.get("eval_episodes", 10) or 10)
    device = str(cfg.get("eval_device", cfg.get("train_device", "cuda"))).strip() or "cuda"
    env_type = _normalize_env_type(str(cfg.get("eval_env_type", "")))
    env_task = _sanitize_env_value(cfg.get("eval_task", ""))

    if policy_path:
        train_cfg_path = Path(policy_path) / "train_config.json"
        if train_cfg_path.is_file():
            try:
                train_cfg = json.loads(train_cfg_path.read_text())
                env_cfg = train_cfg.get("env") if isinstance(train_cfg, dict) else None
                if isinstance(env_cfg, dict):
                    if not env_type:
                        inferred_type = _normalize_env_type(str(env_cfg.get("type", "")))
                        if inferred_type:
                            env_type = inferred_type
                    if not env_task:
                        inferred_task = _sanitize_env_value(env_cfg.get("task", ""))
                        if inferred_task:
                            env_task = inferred_task
                    if not env_task:
                        inferred_name = _sanitize_env_value(env_cfg.get("name", ""))
                        if inferred_name:
                            env_task = inferred_name
            except (OSError, JSONDecodeError, TypeError, ValueError):
                pass

    if not env_type:
        raise ValueError(
            "Eval requires env.type but the checkpoint has no env metadata (env: null in train_config.json). "
            "This usually means the model was trained on real-robot data without a gym environment. "
            "Set the Env Type override in Advanced Overrides (e.g. 'gym_manipulator' for SO-101 arms)."
        )
    if not env_task:
        raise ValueError(
            "Eval requires env.task but none was found in the checkpoint metadata. "
            "Set a Task description in the Eval tab (e.g. 'Pick up the block')."
        )

    args = [
        python_exe,
        "-m",
        "lerobot.scripts.lerobot_eval",
        f"--policy.path={policy_path}",
        f"--env.type={env_type}",
        f"--eval.n_episodes={episodes}",
        f"--eval.batch_size={episodes}",
        f"--policy.device={device}",
        f"--env.task={env_task}",
    ]

    if repo_id:
        args.append(f"--dataset.repo_id={repo_id}")

    # gym_manipulator (real robot) requires robot and teleop config
    if env_type == "gym_manipulator":
        is_bi = cfg.get("robot_mode") == "bi"
        if is_bi:
            robot_type = str(cfg.get("eval_robot_type", "bi_so_follower")).strip() or "bi_so_follower"
            teleop_type = str(cfg.get("eval_teleop_type", "bi_so_leader")).strip() or "bi_so_leader"
            args += [
                f"--env.robot.type={robot_type}",
                f'--env.robot.left_arm_config.port={cfg.get("left_follower_port", "/dev/follower_arm_1")}',
                f'--env.robot.right_arm_config.port={cfg.get("right_follower_port", "/dev/follower_arm_2")}',
                f"--env.teleop.type={teleop_type}",
                f'--env.teleop.left_arm_config.port={cfg.get("left_leader_port", "/dev/leader_arm_1")}',
                f'--env.teleop.right_arm_config.port={cfg.get("right_leader_port", "/dev/leader_arm_2")}',
            ]
        else:
            robot_type = str(cfg.get("eval_robot_type", "so101_follower")).strip() or "so101_follower"
            teleop_type = str(cfg.get("eval_teleop_type", "so101_leader")).strip() or "so101_leader"
            follower_port = str(cfg.get("follower_port", "/dev/follower_arm_1")).strip()
            leader_port = str(cfg.get("leader_port", "/dev/leader_arm_1")).strip()
            robot_id = str(cfg.get("robot_id", "my_so101_follower_1")).strip()
            teleop_id = str(cfg.get("teleop_id", "my_so101_leader_1")).strip()
            args += [
                f"--env.robot.type={robot_type}",
                f"--env.robot.port={follower_port}",
                f"--env.robot.id={robot_id}",
                f"--env.teleop.type={teleop_type}",
                f"--env.teleop.port={leader_port}",
                f"--env.teleop.id={teleop_id}",
            ]

        # Pass camera configurations so the robot has images to observe.
        # Camera names (e.g. 'follower_cam_1') must match the feature keys
        # in the trained policy (observation.images.<name>).
        cam_w = int(cfg.get("eval_cam_width", cfg.get("record_cam_width", 640)))
        cam_h = int(cfg.get("eval_cam_height", cfg.get("record_cam_height", 480)))
        cam_fps = int(cfg.get("eval_cam_fps", cfg.get("record_cam_fps", 30)))
        cameras = cfg.get("cameras", {})
        cam_dict = {}
        for name, path in cameras.items():
            if path:
                if not path.startswith("/dev/"):
                    path = f"/dev/{path}"
                cam_dict[name] = {
                    "type": "opencv",
                    "index_or_path": path,
                    "width": cam_w,
                    "height": cam_h,
                    "fps": cam_fps,
                    "fourcc": "MJPG",
                }
        if cam_dict:
            cam_str = json.dumps(cam_dict)
            if is_bi:
                args.append(f"--env.robot.cameras={{}}")
                args.append(f"--env.robot.left_arm_config.cameras={cam_str}")
            else:
                args.append(f"--env.robot.cameras={cam_str}")
    return args


def build_derive_args(python_exe: str, cfg: dict) -> list[str]:
    """Build args for lerobot_edit_dataset delete_episodes to derive a new dataset.

    cfg keys:
      source_repo_id  – original dataset (user/repo)
      new_repo_id     – target dataset   (user/new-repo)
      delete_indices  – list[int] episode indices to remove
      root            – optional local cache root override
    """
    delete_indices = cfg.get("delete_indices", [])
    args = [
        python_exe, "-m", "lerobot.scripts.lerobot_edit_dataset",
        f'--repo_id={cfg["source_repo_id"]}',
        f'--new_repo_id={cfg["new_repo_id"]}',
        "--operation.type=delete_episodes",
        f"--operation.episode_indices={delete_indices}",
        "--push_to_hub=false",
    ]
    root = cfg.get("root")
    if root:
        args.append(f"--root={root}")
    return args
