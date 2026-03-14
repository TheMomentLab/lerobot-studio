from __future__ import annotations

from fastapi import APIRouter

from ...capabilities import Capability, register
from ...services import dataset_service
from .._state import AppState
from ..models import HfTokenRequest, HfWhoamiResponse

register("/api/datasets/{user}/{repo}/push", Capability.DATASET_MUTATION)
register("/api/hf/token", Capability.HUB_CREDENTIALS)
register("/api/hub/datasets/download", Capability.DATASET_MUTATION)


def register_routes(router: APIRouter, state: AppState):
    jobs_state = state.dataset_jobs

    @router.post("/api/datasets/{user}/{repo}/push")
    async def api_dataset_push(user: str, repo: str, data: dict[str, object] | None = None):
        payload = data or {}
        return dataset_service.hub_push_start(
            jobs_state=jobs_state,
            repo_id=f"{user}/{repo}",
            token=str(payload.get("token", "") or ""),
            target_repo_id=str(payload.get("target_repo_id", "") or ""),
            private=bool(payload.get("private", False)),
            config_dir=state.config_dir,
        )

    @router.get("/api/datasets/push/status/{job_id}")
    def api_dataset_push_status(job_id: str):
        return dataset_service.hub_push_status(jobs_state, job_id)

    @router.get("/api/hf/token/status")
    def api_hf_token_status():
        return dataset_service.hf_token_read(config_dir=state.config_dir)

    @router.put("/api/hf/token")
    @router.post("/api/hf/token")
    async def api_hf_token_set(data: HfTokenRequest | None = None):
        token = data.token if data else ""
        return dataset_service.hf_token_write(token, config_dir=state.config_dir)

    @router.delete("/api/hf/token")
    def api_hf_token_clear():
        return dataset_service.clear_hf_token(config_dir=state.config_dir)

    @router.get("/api/hf/whoami", response_model=HfWhoamiResponse)
    def api_hf_whoami():
        return dataset_service.hf_whoami(config_dir=state.config_dir)

    @router.get("/api/hf/my-datasets")
    def api_hf_my_datasets(limit: int = 50):
        return dataset_service.hf_my_datasets(config_dir=state.config_dir, limit=limit)

    @router.get("/api/hub/datasets/search")
    def api_hub_datasets_search(query: str = "", limit: int = 20, tag: str = "lerobot"):
        return dataset_service.hub_search(query=query, limit=limit, tag=tag)

    @router.post("/api/hub/datasets/download")
    async def api_hub_datasets_download(data: dict[str, object] | None = None):
        payload = data or {}
        repo_id = str(payload.get("repo_id", "")).strip()
        return dataset_service.hub_download_start(jobs_state, repo_id)

    @router.get("/api/hub/datasets/download/status/{job_id}")
    def api_hub_download_status(job_id: str):
        return dataset_service.get_hub_download_status(jobs_state, job_id)
