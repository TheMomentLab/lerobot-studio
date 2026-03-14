from __future__ import annotations

import importlib

from fastapi import APIRouter

from ._state import AppState
from .models import DepsStatusResponse, TrainPreflightResponse
from ..services.process_service import _guard_process_start

training_service = importlib.import_module("lestudio.services.training_service")

DEFAULT_COLAB_NOTEBOOK_URL = training_service.DEFAULT_COLAB_NOTEBOOK_URL


def create_router(state: AppState) -> APIRouter:
    router = APIRouter()

    @router.get("/api/train/preflight", response_model=TrainPreflightResponse)
    def api_train_preflight(device: str = "cuda"):
        return training_service.train_preflight(device=device, python_exe=state.python_exe)

    @router.get("/api/deps/status", response_model=DepsStatusResponse)
    def api_deps_status():
        return training_service.deps_status()

    @router.post("/api/train/install_pytorch")
    async def api_train_install_pytorch(data: dict[str, object] | None = None):
        return training_service.train_install_pytorch(state=state, payload=data)

    @router.post("/api/train/install_torchcodec_fix")
    async def api_train_install_torchcodec_fix(data: dict[str, object] | None = None):
        return training_service.train_install_torchcodec_fix(state=state, payload=data)

    @router.post("/api/train/start")
    async def api_train_start(data: dict[str, object]):
        guard = _guard_process_start(state, "train")
        if guard:
            return guard
        return training_service.train_start(state=state, data=data)

    @router.post("/api/train/colab/config")
    async def api_train_colab_config(data: dict[str, object] | None = None):
        return training_service.train_colab_config(state=state, payload=data)

    @router.get("/api/train/colab/link")
    def api_train_colab_link(
        repo_id: str = "",
        config_path: str = "lestudio_train_config.json",
        notebook_url: str = DEFAULT_COLAB_NOTEBOOK_URL,
    ):
        return training_service.train_colab_link(repo_id=repo_id, config_path=config_path, notebook_url=notebook_url)

    return router
