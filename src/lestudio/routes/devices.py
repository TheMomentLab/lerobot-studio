"""Device, camera, and robot registry routes."""
from __future__ import annotations

import logging
import os

from fastapi import APIRouter

from lestudio import device_registry
from lestudio._config_helpers import DEFAULT_CONFIG
from lestudio._device_helpers import CAMERA_ROLES, get_arms, get_cameras
from lestudio._streaming import _DEFAULT_CAM_SETTINGS, _get_cam_settings, restart_all_streamers
from lestudio.routes._state import AppState
from lestudio.routes.models import CameraPathsRequest, CameraSettingsRequest

logger = logging.getLogger(__name__)


def create_router(state: AppState) -> APIRouter:
    router = APIRouter()

    @router.get("/api/devices")
    def api_devices():
        return {"cameras": get_cameras(), "arms": get_arms()}

    @router.post("/api/camera/check_paths")
    def api_camera_check_paths(data: CameraPathsRequest):
        paths = data.paths
        result: dict[str, bool] = {}
        if not isinstance(paths, list):
            return result
        for p in paths:
            if not isinstance(p, str):
                continue
            try:
                real = os.path.realpath(p)
                result[p] = os.path.exists(real)
            except OSError:
                result[p] = False
        return result

    @router.get("/api/camera_roles")
    def api_camera_roles():
        return CAMERA_ROLES

    @router.get("/api/camera_settings")
    def api_camera_settings_get():
        return _get_cam_settings(state.config_path)

    @router.post("/api/camera_settings")
    async def api_camera_settings_save(data: CameraSettingsRequest):
        cfg = state.load_config()
        cfg["camera_settings"] = {**_DEFAULT_CAM_SETTINGS, **data.model_dump()}
        state.save_config(cfg)
        restart_all_streamers(state.config_path)
        return {"ok": True}

    @router.get("/api/robot_types")
    def api_robot_types():
        """[Deprecated] /api/robots 사용 권장. 하위 호환용으로 유지."""
        return device_registry.get_robot_types()

    @router.get("/api/robots")
    def api_robots():
        """등록된 모든 Robot 타입 목록 + capabilities + 호환 teleop 반환."""
        robot_types = device_registry.get_robot_types()
        return {
            "types": robot_types,
            "details": {
                t: {
                    "capabilities": device_registry.get_capabilities(t),
                    "compatible_teleops": device_registry.get_compatible_teleops(t),
                }
                for t in robot_types
            },
            "lerobot_available": device_registry.is_lerobot_available(),
        }

    @router.get("/api/robots/{robot_type}/schema")
    def api_robot_schema(robot_type: str):
        """특정 Robot 타입의 config 스키마 반환 (핵심 필드만)."""
        return device_registry.get_config_schema("robots", robot_type)

    @router.get("/api/teleops")
    def api_teleops(robot_type: str | None = None):
        """등록된 Teleoperator 타입 목록 반환. robot_type 지정 시 호환 목록만."""
        return {
            "types": device_registry.get_teleop_types(robot_type),
            "lerobot_available": device_registry.is_lerobot_available(),
        }

    @router.get("/api/cameras")
    def api_cameras():
        """등록된 Camera 타입 목록 반환."""
        return {
            "types": device_registry.get_camera_types(),
            "lerobot_available": device_registry.is_lerobot_available(),
        }

    @router.get("/api/ecosystem/status")
    def api_ecosystem_status():
        """LeRobot 생태계 연결 상태 및 전체 디바이스 목록 반환."""
        return device_registry.list_all_devices()

    return router
