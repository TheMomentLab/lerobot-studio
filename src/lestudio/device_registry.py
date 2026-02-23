"""Device Registry — LeRobot 생태계 타입 탐색 및 메타데이터 제공.

LeRobot import는 이 파일에만 격리됩니다 (접점 #4).
LeRobot이 설치되지 않은 경우 하드코딩된 fallback을 사용합니다.

설계 결정 (Q9~Q12):
  Q9=A: 핵심 필드만 노출 (port, id, cameras, remote_ip 등)
  Q10=A: 정적 메타데이터 우선 + 추론 fallback
  Q11=B: 기존 command_builders.py와 병행 운영 (Phase 1에서 GenericCommandBuilder 추가 후 점진 전환)
  Q12=B: 타입별 템플릿 + 미지 타입은 동적 fallback
"""

from __future__ import annotations

import dataclasses
import logging
import warnings
from typing import Any

logger = logging.getLogger(__name__)

# ─── LeRobot 격리 import ────────────────────────────────────────────────────────
_LEROBOT_AVAILABLE = False
_RobotConfig: Any = None
_TeleoperatorConfig: Any = None
_CameraConfig: Any = None

try:
    from lerobot.robots.config import RobotConfig as _RobotConfig  # type: ignore
    from lerobot.teleoperators.config import TeleoperatorConfig as _TeleoperatorConfig  # type: ignore
    from lerobot.cameras.configs import CameraConfig as _CameraConfig  # type: ignore
    from lerobot.utils.import_utils import register_third_party_plugins  # type: ignore

    register_third_party_plugins()
    _LEROBOT_AVAILABLE = True
    logger.info("LeRobot registry loaded successfully.")
except Exception as _e:
    warnings.warn(
        f"LeRobot not available ({_e}). Using fallback robot types. "
        "Install lerobot to unlock full ecosystem support.",
        stacklevel=2,
    )

# ─── Fallback types (LeRobot 없을 때) ───────────────────────────────────────────
_FALLBACK_ROBOT_TYPES = ["so101_follower", "so100_follower"]
_FALLBACK_TELEOP_TYPES = ["so101_leader", "so100_leader"]
_FALLBACK_CAMERA_TYPES = ["opencv"]

# ─── 정적 Capabilities 메타데이터 (Q10=A) ───────────────────────────────────────
# 14종 로봇의 capabilities. 미지 타입은 config 필드에서 추론 (fallback).
_KNOWN_CAPABILITIES: dict[str, dict] = {
    "so101_follower": {
        "has_arm": True,
        "arm_count": 1,
        "has_mobile_base": False,
        "has_cameras": True,
        "is_remote": False,
        "has_keyboard_teleop": False,
        "motor_protocol": "feetech",
        "connection_type": "serial",
        "description": "SO-101 Follower Arm (Feetech)",
        "display_name": "SO-101 Follower",
    },
    "so100_follower": {
        "has_arm": True,
        "arm_count": 1,
        "has_mobile_base": False,
        "has_cameras": True,
        "is_remote": False,
        "has_keyboard_teleop": False,
        "motor_protocol": "feetech",
        "connection_type": "serial",
        "description": "SO-100 Follower Arm (Feetech)",
        "display_name": "SO-100 Follower",
    },
    "bi_so_follower": {
        "has_arm": True,
        "arm_count": 2,
        "has_mobile_base": False,
        "has_cameras": True,
        "is_remote": False,
        "has_keyboard_teleop": False,
        "motor_protocol": "feetech",
        "connection_type": "serial",
        "description": "Bimanual SO Follower Arms (2× Feetech)",
        "display_name": "Bimanual SO Follower",
    },
    "lekiwi": {
        "has_arm": True,
        "arm_count": 1,
        "has_mobile_base": True,
        "has_cameras": True,
        "is_remote": False,
        "has_keyboard_teleop": True,
        "motor_protocol": "feetech",
        "connection_type": "serial",
        "description": "LeKiwi Mobile Manipulator — local host (Feetech + differential drive)",
        "display_name": "LeKiwi (local)",
    },
    "lekiwi_client": {
        "has_arm": True,
        "arm_count": 1,
        "has_mobile_base": True,
        "has_cameras": True,
        "is_remote": True,
        "has_keyboard_teleop": True,
        "motor_protocol": "zmq",
        "connection_type": "zmq",
        "description": "LeKiwi Mobile Manipulator — ZMQ remote client",
        "display_name": "LeKiwi (ZMQ client)",
    },
    "koch_follower": {
        "has_arm": True,
        "arm_count": 1,
        "has_mobile_base": False,
        "has_cameras": False,
        "is_remote": False,
        "has_keyboard_teleop": False,
        "motor_protocol": "dynamixel",
        "connection_type": "serial",
        "description": "Koch Follower Arm (Dynamixel)",
        "display_name": "Koch Follower",
    },
    "omx_follower": {
        "has_arm": True,
        "arm_count": 1,
        "has_mobile_base": False,
        "has_cameras": False,
        "is_remote": False,
        "has_keyboard_teleop": False,
        "motor_protocol": "dynamixel",
        "connection_type": "serial",
        "description": "OMX Follower Arm (Dynamixel)",
        "display_name": "OMX Follower",
    },
    "openarm_follower": {
        "has_arm": True,
        "arm_count": 1,
        "has_mobile_base": False,
        "has_cameras": False,
        "is_remote": False,
        "has_keyboard_teleop": False,
        "motor_protocol": "can",
        "connection_type": "can",
        "description": "OpenArm Follower (CAN bus / Damiao)",
        "display_name": "OpenArm Follower",
    },
    "bi_openarm_follower": {
        "has_arm": True,
        "arm_count": 2,
        "has_mobile_base": False,
        "has_cameras": False,
        "is_remote": False,
        "has_keyboard_teleop": False,
        "motor_protocol": "can",
        "connection_type": "can",
        "description": "Bimanual OpenArm Follower (CAN bus)",
        "display_name": "Bimanual OpenArm Follower",
    },
    "hope_jr_hand": {
        "has_arm": True,
        "arm_count": 1,
        "has_mobile_base": False,
        "has_cameras": False,
        "is_remote": False,
        "has_keyboard_teleop": False,
        "motor_protocol": "can",
        "connection_type": "can",
        "description": "Hope Jr Hand (CAN bus)",
        "display_name": "Hope Jr Hand",
    },
    "hope_jr_arm": {
        "has_arm": True,
        "arm_count": 1,
        "has_mobile_base": False,
        "has_cameras": False,
        "is_remote": False,
        "has_keyboard_teleop": False,
        "motor_protocol": "can",
        "connection_type": "can",
        "description": "Hope Jr Arm (CAN bus)",
        "display_name": "Hope Jr Arm",
    },
    "reachy2": {
        "has_arm": True,
        "arm_count": 2,
        "has_mobile_base": True,
        "has_cameras": True,
        "is_remote": True,
        "has_keyboard_teleop": False,
        "motor_protocol": "cloud_sdk",
        "connection_type": "ethernet",
        "description": "Reachy2 Humanoid (Ethernet / Pollen SDK)",
        "display_name": "Reachy2",
    },
    "unitree_g1": {
        "has_arm": True,
        "arm_count": 2,
        "has_mobile_base": True,
        "has_cameras": True,
        "is_remote": True,
        "has_keyboard_teleop": False,
        "motor_protocol": "cloud_sdk",
        "connection_type": "ethernet",
        "description": "Unitree G1 Humanoid (Unitree SDK)",
        "display_name": "Unitree G1",
    },
    "earthrover_mini_plus": {
        "has_arm": False,
        "arm_count": 0,
        "has_mobile_base": True,
        "has_cameras": True,
        "is_remote": True,
        "has_keyboard_teleop": True,
        "motor_protocol": "cloud_sdk",
        "connection_type": "cloud",
        "description": "EarthRover Mini+ Mobile Platform (Cloud SDK)",
        "display_name": "EarthRover Mini+",
    },
}

# ─── 호환 Teleoperator 매핑 (정적) ──────────────────────────────────────────────
_COMPATIBLE_TELEOPS: dict[str, list[str]] = {
    "so101_follower": ["so101_leader", "so100_leader"],
    "so100_follower": ["so100_leader", "so101_leader"],
    "bi_so_follower": ["bi_so_leader"],
    "lekiwi": ["so101_leader", "keyboard_rover", "keyboard"],
    "lekiwi_client": ["so101_leader", "keyboard_rover", "keyboard"],
    "koch_follower": ["koch_leader"],
    "omx_follower": ["omx_leader", "keyboard_ee", "keyboard"],
    "openarm_follower": ["openarm_leader"],
    "bi_openarm_follower": ["bi_openarm_leader"],
    "hope_jr_hand": ["homunculus_glove"],
    "hope_jr_arm": ["homunculus_arm"],
    "reachy2": ["reachy2_teleoperator"],
    "unitree_g1": ["unitree_g1"],
    "earthrover_mini_plus": ["gamepad", "keyboard_rover"],
}

# ─── UI에 노출할 핵심 필드 목록 (Q9=A) ────────────────────────────────────────────
_CORE_FIELDS: dict[str, list[str]] = {
    "robots": [
        "port",
        "id",
        "cameras",
        "remote_ip",
        "port_zmq_cmd",
        "port_zmq_observations",
    ],
    "teleoperators": ["port", "id"],
    "cameras": ["fps", "width", "height", "index_or_path", "serial_number_or_path"],
}

# 내부 필드 (UI 미노출)
_HIDDEN_FIELDS = {"calibration_dir"}


# ─── Capabilities 추론 (미지 타입 fallback) ──────────────────────────────────────
def _infer_capabilities(robot_type: str, config_cls: Any) -> dict:
    """config 클래스 필드에서 capabilities를 추론합니다 (알려지지 않은 타입의 fallback)."""
    caps: dict[str, Any] = {
        "has_arm": False,
        "arm_count": 0,
        "has_mobile_base": False,
        "has_cameras": False,
        "is_remote": False,
        "has_keyboard_teleop": False,
        "motor_protocol": "unknown",
        "connection_type": "unknown",
        "description": f"{robot_type} (auto-detected)",
        "display_name": robot_type,
    }

    if config_cls is None:
        return caps

    try:
        field_names = {f.name for f in dataclasses.fields(config_cls)}
    except Exception:
        return caps

    if "port" in field_names:
        caps["connection_type"] = "serial"
        caps["motor_protocol"] = "serial"
    if "remote_ip" in field_names:
        caps["is_remote"] = True
        caps["connection_type"] = "zmq"
        caps["motor_protocol"] = "zmq"
    if "cameras" in field_names:
        caps["has_cameras"] = True
    if "teleop_keys" in field_names:
        caps["has_keyboard_teleop"] = True
        caps["has_mobile_base"] = True
    if "port" in field_names or "cameras" in field_names:
        caps["has_arm"] = True
        caps["arm_count"] = 1

    return caps


# ─── Public API ─────────────────────────────────────────────────────────────────


def is_lerobot_available() -> bool:
    """LeRobot이 설치되어 있고 import 가능한지 반환합니다."""
    return _LEROBOT_AVAILABLE


def get_robot_types() -> list[str]:
    """등록된 모든 Robot 타입을 반환합니다. LeRobot 없으면 fallback 목록."""
    if not _LEROBOT_AVAILABLE or _RobotConfig is None:
        return _FALLBACK_ROBOT_TYPES.copy()
    try:
        return list(_RobotConfig._subclass_registry.keys())
    except Exception as e:
        logger.warning("Failed to query RobotConfig registry: %s", e)
        return _FALLBACK_ROBOT_TYPES.copy()


def get_teleop_types(robot_type: str | None = None) -> list[str]:
    """등록된 Teleoperator 타입을 반환합니다.

    robot_type 지정 시: 해당 로봇과 호환되는 타입만 반환.
    robot_type=None: 전체 목록.
    """
    if not _LEROBOT_AVAILABLE or _TeleoperatorConfig is None:
        return _FALLBACK_TELEOP_TYPES.copy()
    try:
        all_teleops = list(_TeleoperatorConfig._subclass_registry.keys())
    except Exception as e:
        logger.warning("Failed to query TeleoperatorConfig registry: %s", e)
        return _FALLBACK_TELEOP_TYPES.copy()

    if robot_type is None:
        return all_teleops

    # 알려진 매핑 우선
    compatible = _COMPATIBLE_TELEOPS.get(robot_type)
    if compatible:
        return [t for t in compatible if t in all_teleops]

    # 미지 타입: 범용 teleop 제안
    generic_fallback = ["keyboard", "keyboard_ee", "keyboard_rover", "gamepad", "phone"]
    return [t for t in generic_fallback if t in all_teleops]


def get_camera_types() -> list[str]:
    """등록된 Camera 타입을 반환합니다."""
    if not _LEROBOT_AVAILABLE or _CameraConfig is None:
        return _FALLBACK_CAMERA_TYPES.copy()
    try:
        return list(_CameraConfig._subclass_registry.keys())
    except Exception as e:
        logger.warning("Failed to query CameraConfig registry: %s", e)
        return _FALLBACK_CAMERA_TYPES.copy()


def get_capabilities(robot_type: str) -> dict:
    """로봇 타입의 capabilities를 반환합니다 (정적 메타데이터 우선, 추론 fallback)."""
    # Q10=A: 알려진 타입은 정적 메타데이터 즉시 반환
    if robot_type in _KNOWN_CAPABILITIES:
        return _KNOWN_CAPABILITIES[robot_type].copy()

    # 미지 타입: config 필드에서 추론
    if _LEROBOT_AVAILABLE and _RobotConfig is not None:
        try:
            config_cls = _RobotConfig._subclass_registry.get(robot_type)
            return _infer_capabilities(robot_type, config_cls)
        except Exception as e:
            logger.warning("Failed to infer capabilities for %s: %s", robot_type, e)

    return _infer_capabilities(robot_type, None)


def get_config_schema(registry: str, type_name: str) -> dict:
    """디바이스 타입의 config 스키마를 반환합니다 (Q9=A: 핵심 필드만).

    Args:
        registry: "robots" | "teleoperators" | "cameras"
        type_name: 등록된 타입명 (예: "so101_follower")

    Returns:
        {"type": str, "fields": [...], "error": str | None}
        각 field: {"name": str, "type": str, "is_core": bool, "required": bool, "default": Any}
    """
    result: dict[str, Any] = {"type": type_name, "fields": [], "error": None}

    if not _LEROBOT_AVAILABLE:
        result["error"] = "LeRobot not available"
        return result

    try:
        if registry == "robots":
            config_cls = (
                _RobotConfig._subclass_registry.get(type_name) if _RobotConfig else None
            )
        elif registry == "teleoperators":
            config_cls = (
                _TeleoperatorConfig._subclass_registry.get(type_name)
                if _TeleoperatorConfig
                else None
            )
        elif registry == "cameras":
            config_cls = (
                _CameraConfig._subclass_registry.get(type_name)
                if _CameraConfig
                else None
            )
        else:
            result["error"] = f"Unknown registry: {registry}"
            return result

        if config_cls is None:
            result["error"] = f"Type '{type_name}' not found in {registry} registry"
            return result

        core_field_names = set(_CORE_FIELDS.get(registry, []))
        fields = []

        for f in dataclasses.fields(config_cls):
            if f.name in _HIDDEN_FIELDS:
                continue

            is_core = f.name in core_field_names

            # 타입 힌트 직렬화
            if isinstance(f.type, str):
                type_str = f.type
            elif hasattr(f.type, "__name__"):
                type_str = f.type.__name__
            else:
                type_str = str(f.type)

            # 기본값 추출
            default: Any = None
            has_default = False
            if f.default is not dataclasses.MISSING:
                has_default = True
                default = f.default
                if not isinstance(default, (str, int, float, bool, type(None))):
                    default = str(default)
            elif f.default_factory is not dataclasses.MISSING:  # type: ignore
                has_default = True
                try:
                    raw = f.default_factory()  # type: ignore
                    if isinstance(raw, (str, int, float, bool, dict, list, type(None))):
                        default = raw
                    else:
                        default = str(raw)
                except Exception:
                    default = None

            fields.append(
                {
                    "name": f.name,
                    "type": type_str,
                    "is_core": is_core,
                    "required": not has_default,
                    "default": default,
                }
            )

        result["fields"] = fields

    except Exception as e:
        logger.exception(
            "Failed to extract config schema for %s/%s", registry, type_name
        )
        result["error"] = str(e)

    return result


def get_compatible_teleops(robot_type: str) -> list[str]:
    """로봇 타입에 호환되는 teleoperator 타입 목록을 반환합니다."""
    return get_teleop_types(robot_type=robot_type)


def get_calibration_path_prefix(robot_type: str) -> tuple[str, str]:
    """캘리브레이션 파일 경로에 필요한 (category, dir_name)을 반환합니다.

    Returns:
        (category, dir_name) where:
          category: "robots" | "teleoperators"
          dir_name: 실제 캘리브레이션 디렉토리명 (예: "so_follower")

    LeRobot 캘리브레이션 경로:
      ~/.cache/huggingface/lerobot/calibration/{category}/{dir_name}/{id}.json
    """
    # SO 계열 호환 경로 매핑 (레거시 파일명 호환)
    _ROBOT_CALIB_DIRS: dict[str, str] = {
        "so101_follower": "so_follower",
        "so100_follower": "so_follower",
        "bi_so_follower": "bi_so_follower",
        "lekiwi": "lekiwi",
        "lekiwi_client": "lekiwi",
        "koch_follower": "koch_follower",
        "omx_follower": "omx_follower",
        "openarm_follower": "openarm_follower",
        "bi_openarm_follower": "bi_openarm_follower",
        "hope_jr_hand": "hope_jr_hand",
        "hope_jr_arm": "hope_jr_arm",
        "reachy2": "reachy2",
        "unitree_g1": "unitree_g1",
        "earthrover_mini_plus": "earthrover_mini_plus",
    }
    _TELEOP_CALIB_DIRS: dict[str, str] = {
        "so101_leader": "so_leader",
        "so100_leader": "so_leader",
        "bi_so_leader": "bi_so_leader",
        "koch_leader": "koch_leader",
        "omx_leader": "omx_leader",
        "openarm_leader": "openarm_leader",
        "bi_openarm_leader": "bi_openarm_leader",
        "homunculus_glove": "homunculus_glove",
        "homunculus_arm": "homunculus_arm",
        "reachy2_teleoperator": "reachy2_teleoperator",
        "unitree_g1": "unitree_g1",
    }

    if robot_type in _ROBOT_CALIB_DIRS:
        return ("robots", _ROBOT_CALIB_DIRS[robot_type])
    if robot_type in _TELEOP_CALIB_DIRS:
        return ("teleoperators", _TELEOP_CALIB_DIRS[robot_type])

    # 미지 타입: type 이름 그대로 사용
    return ("robots", robot_type)


def list_all_devices() -> dict:
    """등록된 모든 디바이스 타입의 요약을 반환합니다."""
    return {
        "robots": get_robot_types(),
        "teleoperators": get_teleop_types(),
        "cameras": get_camera_types(),
        "lerobot_available": _LEROBOT_AVAILABLE,
    }
