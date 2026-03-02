"""Config and history routes."""
from __future__ import annotations

import json
import logging

from fastapi import APIRouter

from lestudio.routes._state import AppState

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
