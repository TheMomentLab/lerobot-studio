"""Dataset routes package."""
from __future__ import annotations

from fastapi import APIRouter

from .._state import AppState
from .curation import register_routes as register_curation
from .hub import register_routes as register_hub
from .listing import register_routes as register_listing


def create_router(state: AppState) -> APIRouter:
    router = APIRouter()
    register_listing(router, state)
    register_curation(router, state)
    register_hub(router, state)
    return router
