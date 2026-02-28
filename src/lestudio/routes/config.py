"""Config, profile, and history routes."""
from __future__ import annotations

import json
import logging

from fastapi import APIRouter

from lestudio._config_helpers import (
    DEFAULT_CONFIG,
    _is_valid_profile_name,
    _list_profiles,
    _load_profile,
    _profile_path,
    _save_profile,
)
from lestudio.routes._state import AppState
from lestudio.routes.models import ProfileImportRequest

logger = logging.getLogger(__name__)


def create_router(state: AppState) -> APIRouter:
    router = APIRouter()

    # ─── Config ────────────────────────────────────────────────────────────────
    @router.get("/api/config")
    def api_config_get():
        return state.load_config()

    @router.post("/api/config")
    async def api_config_save(data: dict):
        state.save_config(data)
        return {"ok": True}

    # ─── Profiles ──────────────────────────────────────────────────────────────
    @router.get("/api/profiles")
    def api_profiles_list():
        cfg = state.load_config()
        active = str(cfg.get("profile_name", "default"))
        names = _list_profiles(state.profiles_dir)
        if not names:
            _save_profile(state.profiles_dir, "default", cfg)
            names = ["default"]
        if active not in names:
            active = names[0]
        return {"profiles": names, "active": active}

    @router.get("/api/profiles/{name}")
    def api_profiles_get(name: str):
        if not _is_valid_profile_name(name):
            return {"ok": False, "error": "Invalid profile name"}
        cfg = _load_profile(state.profiles_dir, name)
        if cfg is None:
            return {"ok": False, "error": "Profile not found"}
        return {"ok": True, "config": cfg}

    @router.post("/api/profiles/{name}")
    async def api_profiles_save(name: str, data: dict):
        if not _is_valid_profile_name(name):
            return {"ok": False, "error": "Invalid profile name"}
        cfg = {**DEFAULT_CONFIG, **data}
        cfg["profile_name"] = name
        _save_profile(state.profiles_dir, name, cfg)
        return {"ok": True}

    @router.delete("/api/profiles/{name}")
    def api_profiles_delete(name: str):
        if not _is_valid_profile_name(name):
            return {"ok": False, "error": "Invalid profile name"}
        path = _profile_path(state.profiles_dir, name)
        if not path.exists():
            return {"ok": False, "error": "Profile not found"}
        try:
            path.unlink()
            return {"ok": True}
        except OSError as e:
            return {"ok": False, "error": str(e)}

    @router.post("/api/profiles-import")
    async def api_profiles_import(data: ProfileImportRequest):
        name = data.name.strip()
        cfg = data.config
        if not _is_valid_profile_name(name):
            return {"ok": False, "error": "Invalid profile name"}
        if not isinstance(cfg, dict):
            return {"ok": False, "error": "Invalid profile content"}
        merged = {**DEFAULT_CONFIG, **cfg}
        merged["profile_name"] = name
        _save_profile(state.profiles_dir, name, merged)
        return {"ok": True}

    # ─── History ───────────────────────────────────────────────────────────────
    @router.get("/api/history")
    def api_history(limit: int = 50):
        try:
            if state.history_path.exists():
                entries = json.loads(state.history_path.read_text())
                if not isinstance(entries, list):
                    entries = []
                return {"ok": True, "entries": entries[-limit:]}
            return {"ok": True, "entries": []}
        except (OSError, json.JSONDecodeError, TypeError, ValueError) as e:
            return {"ok": False, "entries": [], "error": str(e)}

    @router.post("/api/history/clear")
    def api_history_clear():
        try:
            if state.history_path.exists():
                state.history_path.unlink()
            return {"ok": True}
        except OSError as e:
            return {"ok": False, "error": str(e)}

    return router
