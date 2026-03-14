# pyright: reportMissingTypeArgument=false

import json
import logging
import shutil
from json import JSONDecodeError
from pathlib import Path

from lestudio import path_policy

from ._device_helpers import derive_bi_calibration_profile_id, get_calibration_dir

logger = logging.getLogger(__name__)

MOTOR_SETUP_COMPATIBLE_TYPES = {
    "koch_follower",
    "koch_leader",
    "omx_follower",
    "omx_leader",
    "so100_follower",
    "so100_leader",
    "so101_follower",
    "so101_leader",
    "lekiwi",
}


def _normalized_process_types(cfg: dict, *, is_bi: bool) -> tuple[str, str]:
    default_robot = "bi_so_follower" if is_bi else "so101_follower"
    default_teleop = "bi_so_leader" if is_bi else "so101_leader"
    robot_type = str(cfg.get("robot_type", default_robot) or default_robot).strip()
    teleop_type = str(cfg.get("teleop_type", default_teleop) or default_teleop).strip()

    if is_bi:
        if not robot_type.startswith("bi_"):
            robot_type = default_robot
        if not teleop_type.startswith("bi_"):
            teleop_type = default_teleop
    else:
        if robot_type.startswith("bi_"):
            robot_type = default_robot
        if teleop_type.startswith("bi_"):
            teleop_type = default_teleop

    return robot_type, teleop_type


def _is_bimanual_mode(value: object) -> bool:
    return str(value or "single").strip().lower() != "single"


def dataset_cache_path(repo_id: str, root: str | None = None) -> Path:
    """Return the local path where a dataset is stored.

    If *root* is given (local mode), the dataset lives at ``<root>/<repo_id>``.
    Otherwise it falls back to the default HuggingFace cache location.
    """
    if root:
        return Path(root).expanduser() / repo_id
    return path_policy.dataset_local_dir(repo_id)


def resolve_record_resume(cfg: dict) -> tuple[bool, bool]:
    requested_resume = bool(cfg.get("record_resume"))
    repo_id = str(cfg.get("record_repo_id", "user/dataset"))
    if "/" not in repo_id:
        repo_id = f"local/{repo_id}"
    root = cfg.get("record_dataset_root") or None
    cache_dir = dataset_cache_path(repo_id, root)

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
    anti_jitter_enabled = bool(cfg.get("teleop_antijitter_enabled", False))
    anti_jitter_alpha = cfg.get("teleop_antijitter_alpha", 0.35)
    anti_jitter_deadband = cfg.get("teleop_antijitter_deadband", 0.75)
    anti_jitter_max_step = cfg.get("teleop_antijitter_max_step")
    teleop_debug_enabled = bool(cfg.get("teleop_debug_enabled", False))
    invert_shoulder_lift = bool(cfg.get("teleop_invert_shoulder_lift", False))
    invert_wrist_roll = bool(cfg.get("teleop_invert_wrist_roll", False))

    # Build camera config dict so the robot reads camera frames
    # (needed by camera_patch to write SHM files for live preview)
    cameras = cfg.get("cameras", {})
    cam_dict = {}
    for name, path in cameras.items():
        if path:
            if not path.startswith("/dev/"):
                path = f"/dev/{path}"
            cam_dict[name] = {
                "type": "opencv",
                "index_or_path": path,
                "width": 640,
                "height": 480,
                "fps": 30,
                "fourcc": "MJPG",
            }

    is_bi = _is_bimanual_mode(cfg.get("robot_mode"))
    robot_type, teleop_type = _normalized_process_types(cfg, is_bi=is_bi)
    if is_bi:
        robot_profile_id = derive_bi_calibration_profile_id(
            str(cfg.get("left_robot_id", "")),
            str(cfg.get("right_robot_id", "")),
            "follower",
        )
        teleop_profile_id = derive_bi_calibration_profile_id(
            str(cfg.get("left_teleop_id", "")),
            str(cfg.get("right_teleop_id", "")),
            "leader",
        )
        args = [
            python_exe,
            "-m",
            "lestudio.teleop_bridge",
            f"--robot.type={robot_type}",
            f"--robot.id={robot_profile_id}",
            _calibration_dir_arg("robot", robot_type),
            f"--robot.left_arm_config.port={cfg['left_follower_port']}",
            f"--robot.right_arm_config.port={cfg['right_follower_port']}",
            f"--teleop.type={teleop_type}",
            f"--teleop.id={teleop_profile_id}",
            _calibration_dir_arg("teleop", teleop_type),
            f"--teleop.left_arm_config.port={cfg['left_leader_port']}",
            f"--teleop.right_arm_config.port={cfg['right_leader_port']}",
            "--display_data=false",
        ]
        if cam_dict:
            cam_str = json.dumps(cam_dict)
            args.append(f"--robot.left_arm_config.cameras={cam_str}")
        if max_rel is not None:
            args.append(f"--robot.left_arm_config.max_relative_target={max_rel}")
            args.append(f"--robot.right_arm_config.max_relative_target={max_rel}")
        args.extend(
            _build_antijitter_bridge_args(
                enabled=anti_jitter_enabled,
                alpha=anti_jitter_alpha,
                deadband=anti_jitter_deadband,
                max_step=anti_jitter_max_step,
            )
        )
        args.extend(
            _build_joint_invert_bridge_args(
                shoulder_lift=invert_shoulder_lift,
                wrist_roll=invert_wrist_roll,
            )
        )
        args.extend(_build_debug_bridge_args(enabled=teleop_debug_enabled))
        return args
    args = [
        python_exe,
        "-m",
        "lestudio.teleop_bridge",
        f"--robot.type={robot_type}",
        f"--robot.port={cfg['follower_port']}",
        f"--robot.id={cfg.get('robot_id', 'follower_arm_1')}",
        f"--teleop.type={teleop_type}",
        f"--teleop.port={cfg['leader_port']}",
        f"--teleop.id={cfg.get('teleop_id', 'leader_arm_1')}",
        "--display_data=false",
    ]
    if cam_dict:
        cam_str = json.dumps(cam_dict)
        args.append(f"--robot.cameras={cam_str}")
    if max_rel is not None:
        args.append(f"--robot.max_relative_target={max_rel}")
    args.extend(
        _build_antijitter_bridge_args(
            enabled=anti_jitter_enabled,
            alpha=anti_jitter_alpha,
            deadband=anti_jitter_deadband,
            max_step=anti_jitter_max_step,
        )
    )
    args.extend(
        _build_joint_invert_bridge_args(
            shoulder_lift=invert_shoulder_lift,
            wrist_roll=invert_wrist_roll,
        )
    )
    args.extend(_build_debug_bridge_args(enabled=teleop_debug_enabled))
    return args


def _build_antijitter_bridge_args(
    *,
    enabled: bool,
    alpha: object,
    deadband: object,
    max_step: object,
) -> list[str]:
    args = [f"--lestudio.antijitter.enabled={'true' if enabled else 'false'}"]
    args.append(f"--lestudio.antijitter.alpha={alpha}")
    args.append(f"--lestudio.antijitter.deadband={deadband}")
    if max_step not in (None, ""):
        args.append(f"--lestudio.antijitter.max_step={max_step}")
    return args


def _build_joint_invert_bridge_args(*, shoulder_lift: bool, wrist_roll: bool) -> list[str]:
    return [
        f"--lestudio.invert.shoulder_lift={'true' if shoulder_lift else 'false'}",
        f"--lestudio.invert.wrist_roll={'true' if wrist_roll else 'false'}",
    ]


def _build_debug_bridge_args(*, enabled: bool) -> list[str]:
    return [f"--lestudio.debug.enabled={'true' if enabled else 'false'}"]


def build_record_args(python_exe: str, cfg: dict, resume_enabled: bool) -> list[str]:
    repo_id = cfg.get("record_repo_id", "user/dataset")
    dataset_root = cfg.get("record_dataset_root")

    # lerobot requires repo_id in "user/name" format (sanity_check_dataset_name).
    # For local-only datasets, ensure the slash exists.
    if "/" not in str(repo_id):
        repo_id = f"local/{repo_id}"

    base = [
        f"--dataset.repo_id={repo_id}",
        f"--dataset.num_episodes={cfg.get('record_episodes', 50)}",
        f"--dataset.single_task={cfg.get('record_task', 'task')}",
        "--display_data=false",
        "--dataset.vcodec=h264",
        "--dataset.push_to_hub=true" if cfg.get("record_push_to_hub") else "--dataset.push_to_hub=false",
    ]
    # Local dataset root — lerobot uses root as-is (does NOT append repo_id),
    # so we must build the full path: <user_root>/<repo_id>
    if dataset_root:
        full_root = Path(dataset_root).expanduser() / repo_id
        base.append(f"--dataset.root={full_root}")
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
            cam_dict[name] = {
                "type": "opencv",
                "index_or_path": path,
                "width": rec_w,
                "height": rec_h,
                "fps": rec_fps,
                "fourcc": "MJPG",
            }

    is_bi = _is_bimanual_mode(cfg.get("robot_mode"))
    robot_type, teleop_type = _normalized_process_types(cfg, is_bi=is_bi)
    if cam_dict:
        cam_str = json.dumps(cam_dict)
        if is_bi:
            base.append(f"--robot.left_arm_config.cameras={cam_str}")
        else:
            base.append(f"--robot.cameras={cam_str}")

    if is_bi:
        robot_profile_id = derive_bi_calibration_profile_id(
            str(cfg.get("left_robot_id", "")),
            str(cfg.get("right_robot_id", "")),
            "follower",
        )
        teleop_profile_id = derive_bi_calibration_profile_id(
            str(cfg.get("left_teleop_id", "")),
            str(cfg.get("right_teleop_id", "")),
            "leader",
        )
        return [
            python_exe,
            "-m",
            "lestudio.record_bridge",
            f"--robot.type={robot_type}",
            f"--robot.id={robot_profile_id}",
            _calibration_dir_arg("robot", robot_type),
            f"--robot.left_arm_config.port={cfg['left_follower_port']}",
            f"--robot.right_arm_config.port={cfg['right_follower_port']}",
            f"--teleop.type={teleop_type}",
            f"--teleop.id={teleop_profile_id}",
            _calibration_dir_arg("teleop", teleop_type),
            f"--teleop.left_arm_config.port={cfg['left_leader_port']}",
            f"--teleop.right_arm_config.port={cfg['right_leader_port']}",
        ] + base
    return [
        python_exe,
        "-m",
        "lestudio.record_bridge",
        f"--robot.type={robot_type}",
        f"--robot.port={cfg['follower_port']}",
        f"--robot.id={cfg.get('robot_id', 'follower_arm_1')}",
        f"--teleop.type={teleop_type}",
        f"--teleop.port={cfg['leader_port']}",
        f"--teleop.id={cfg.get('teleop_id', 'leader_arm_1')}",
    ] + base


def build_calibrate_args(python_exe: str, data: dict) -> list[str]:
    robot_mode = data.get("robot_mode", "single")

    if _is_bimanual_mode(robot_mode):
        bi_type = data.get("bi_type", "bi_so_follower")
        robot_id = data.get("robot_id", "bimanual_follower")
        left_port = data.get("left_port", "/dev/follower_arm_1")
        right_port = data.get("right_port", "/dev/follower_arm_2")
        if "leader" in bi_type:
            return [
                python_exe,
                "-m",
                "lestudio.calibrate_bridge",
                f"--teleop.type={bi_type}",
                _calibration_dir_arg("teleop", bi_type),
                f"--teleop.left_arm_config.port={left_port}",
                f"--teleop.right_arm_config.port={right_port}",
                f"--teleop.id={robot_id}",
            ]
        return [
            python_exe,
            "-m",
            "lestudio.calibrate_bridge",
            f"--robot.type={bi_type}",
            _calibration_dir_arg("robot", bi_type),
            f"--robot.left_arm_config.port={left_port}",
            f"--robot.right_arm_config.port={right_port}",
            f"--robot.id={robot_id}",
        ]

    robot_type = data.get("robot_type", "so101_follower")
    robot_id = data.get("robot_id", "follower_arm_1")
    port = data.get("port", "/dev/follower_arm_1")
    if "leader" in robot_type:
        return [
            python_exe,
            "-m",
            "lestudio.calibrate_bridge",
            f"--teleop.type={robot_type}",
            f"--teleop.port={port}",
            f"--teleop.id={robot_id}",
        ]
    return [
        python_exe,
        "-m",
        "lestudio.calibrate_bridge",
        f"--robot.type={robot_type}",
        f"--robot.port={port}",
        f"--robot.id={robot_id}",
    ]


def build_motor_setup_args(python_exe: str, data: dict) -> list[str]:
    robot_type = data.get("robot_type", "so101_follower")
    port = data.get("port", "/dev/follower_arm_1")
    if robot_type not in MOTOR_SETUP_COMPATIBLE_TYPES:
        supported = ", ".join(sorted(MOTOR_SETUP_COMPATIBLE_TYPES))
        raise ValueError(f"Motor Setup does not support '{robot_type}'. Supported types: {supported}")
    return [
        python_exe,
        str(Path(__file__).with_name("motor_setup_bridge.py")),
        f"--python-exe={python_exe}",
        f"--robot-type={robot_type}",
        f"--port={port}",
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


def _calibration_dir_arg(prefix: str, device_type: str) -> str:
    return f"--{prefix}.calibration_dir={get_calibration_dir(device_type)}"


def build_eval_args(python_exe: str, cfg: dict) -> list[str]:
    policy_path = str(cfg.get("eval_policy_path", "")).strip()
    if not policy_path:
        # Find the most recently modified pretrained_model directory under outputs/train
        outputs_dir = Path("outputs/train")
        candidates = (
            sorted(
                outputs_dir.glob("*/*/checkpoints/last/pretrained_model"),
                key=lambda p: p.stat().st_mtime,
                reverse=True,
            )
            if outputs_dir.exists()
            else []
        )
        policy_path = str(candidates[0]) if candidates else "outputs/train/checkpoints/last/pretrained_model"

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
    # gym_manipulator (real robot) requires robot and teleop config
    if env_type == "gym_manipulator":
        is_bi = _is_bimanual_mode(cfg.get("robot_mode"))
        if is_bi:
            robot_type = str(cfg.get("eval_robot_type", "bi_so_follower")).strip() or "bi_so_follower"
            teleop_type = str(cfg.get("eval_teleop_type", "bi_so_leader")).strip() or "bi_so_leader"
            robot_id = derive_bi_calibration_profile_id(
                str(cfg.get("left_robot_id", "")),
                str(cfg.get("right_robot_id", "")),
                "robot",
            )
            teleop_id = derive_bi_calibration_profile_id(
                str(cfg.get("left_teleop_id", "")),
                str(cfg.get("right_teleop_id", "")),
                "teleop",
            )
            args += [
                f"--env.robot.type={robot_type}",
                _calibration_dir_arg("env.robot", robot_type),
                f"--env.robot.id={robot_id}",
                f"--env.robot.left_arm_config.port={cfg.get('left_follower_port', '/dev/follower_arm_1')}",
                f"--env.robot.right_arm_config.port={cfg.get('right_follower_port', '/dev/follower_arm_2')}",
                f"--env.teleop.type={teleop_type}",
                _calibration_dir_arg("env.teleop", teleop_type),
                f"--env.teleop.id={teleop_id}",
                f"--env.teleop.left_arm_config.port={cfg.get('left_leader_port', '/dev/leader_arm_1')}",
                f"--env.teleop.right_arm_config.port={cfg.get('right_leader_port', '/dev/leader_arm_2')}",
            ]
        else:
            robot_type = str(cfg.get("eval_robot_type", "so101_follower")).strip() or "so101_follower"
            teleop_type = str(cfg.get("eval_teleop_type", "so101_leader")).strip() or "so101_leader"
            follower_port = str(cfg.get("follower_port", "/dev/follower_arm_1")).strip()
            leader_port = str(cfg.get("leader_port", "/dev/leader_arm_1")).strip()
            robot_id = str(cfg.get("robot_id", "follower_arm_1")).strip()
            teleop_id = str(cfg.get("teleop_id", "leader_arm_1")).strip()
            args += [
                f"--env.robot.type={robot_type}",
                _calibration_dir_arg("env.robot", robot_type),
                f"--env.robot.port={follower_port}",
                f"--env.robot.id={robot_id}",
                f"--env.teleop.type={teleop_type}",
                _calibration_dir_arg("env.teleop", teleop_type),
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
                args.append("--env.robot.cameras={}")
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
        python_exe,
        "-m",
        "lerobot.scripts.lerobot_edit_dataset",
        f"--repo_id={cfg['source_repo_id']}",
        f"--new_repo_id={cfg['new_repo_id']}",
        "--operation.type=delete_episodes",
        f"--operation.episode_indices={delete_indices}",
        "--push_to_hub=false",
    ]
    root = cfg.get("root")
    if root:
        args.append(f"--root={root}")
    return args
