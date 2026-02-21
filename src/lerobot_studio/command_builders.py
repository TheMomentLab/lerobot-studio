from pathlib import Path


def dataset_cache_path(repo_id: str) -> Path:
    return Path.home() / ".cache" / "huggingface" / "lerobot" / repo_id


def resolve_record_resume(cfg: dict) -> tuple[bool, bool]:
    requested_resume = bool(cfg.get("record_resume"))
    if not requested_resume:
        return False, False
    repo_id = str(cfg.get("record_repo_id", "user/dataset"))
    enabled = dataset_cache_path(repo_id).exists()
    return True, enabled


def build_teleop_args(python_exe: str, cfg: dict) -> list[str]:
    if cfg.get("robot_mode") == "bi":
        return [
            python_exe,
            "-m",
            "lerobot.scripts.lerobot_teleoperate",
            "--robot.type=bi_so_follower",
            f'--robot.left_arm_config.port={cfg["left_follower_port"]}',
            f'--robot.right_arm_config.port={cfg["right_follower_port"]}',
            "--teleop.type=bi_so_leader",
            f'--teleop.left_arm_config.port={cfg["left_leader_port"]}',
            f'--teleop.right_arm_config.port={cfg["right_leader_port"]}',
        ]
    return [
        python_exe,
        "-m",
        "lerobot.scripts.lerobot_teleoperate",
        "--robot.type=so101_follower",
        f'--robot.port={cfg["follower_port"]}',
        f'--robot.id={cfg.get("robot_id", "my_so101_follower_1")}',
        "--teleop.type=so101_leader",
        f'--teleop.port={cfg["leader_port"]}',
        f'--teleop.id={cfg.get("teleop_id", "my_so101_leader_1")}',
    ]


def build_record_args(python_exe: str, cfg: dict, resume_enabled: bool) -> list[str]:
    base = [
        f'--dataset.repo_id={cfg.get("record_repo_id", "user/dataset")}',
        f'--dataset.num_episodes={cfg.get("record_episodes", 50)}',
        f'--dataset.single_task={cfg.get("record_task", "task")}',
        "--display_data=false",
    ]
    if resume_enabled:
        base.append("--resume=true")

    if cfg.get("robot_mode") == "bi":
        return [
            python_exe,
            "-m",
            "lerobot_studio.record_bridge",
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
        "lerobot_studio.record_bridge",
        "--robot.type=so101_follower",
        f'--robot.port={cfg["follower_port"]}',
        f'--robot.id={cfg.get("robot_id", "my_so101_follower_1")}',
        "--teleop.type=so101_leader",
        f'--teleop.port={cfg["leader_port"]}',
        f'--teleop.id={cfg.get("teleop_id", "my_so101_leader_1")}',
    ] + base


def build_calibrate_args(python_exe: str, data: dict) -> list[str]:
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
    # LeRobot uses Hydra configuration
    policy = cfg.get("train_policy", "act")
    repo_id = cfg.get("train_repo_id", "user/dataset")
    steps = cfg.get("train_steps", 100000)
    device = cfg.get("train_device", "cuda")
    
    return [
        python_exe,
        "-m",
        "lerobot.scripts.train",
        f"policy={policy}",
        f"dataset_repo_id={repo_id}",
        f"training.offline_steps={steps}",
        f"device={device}",
    ]
