from __future__ import annotations

from fastapi import APIRouter

from ..models import HfTokenRequest, HfWhoamiResponse
from ...services import dataset_service

from .._state import AppState


def register_routes(router: APIRouter, state: AppState):
    jobs_state = state.dataset_jobs
    token_file = state.config_dir / "hf_token"

    @router.post("/api/datasets/{user}/{repo}/push")
    async def api_dataset_push(user: str, repo: str, data: dict[str, object] | None = None):
        payload = data or {}
        return dataset_service.start_dataset_push_job(jobs_state, token_file, user, repo, payload)

    @router.get("/api/datasets/push/status/{job_id}")
    def api_dataset_push_status(job_id: str):
        return dataset_service.get_push_job_status(jobs_state, job_id)

    @router.get("/api/hf/token/status")
    def api_hf_token_status():
        return dataset_service.get_hf_token_status(token_file)

    @router.put("/api/hf/token")
    @router.post("/api/hf/token")
    async def api_hf_token_set(data: HfTokenRequest | None = None):
        token = data.token if data else ""
        return dataset_service.set_hf_token(token_file, token)

    @router.delete("/api/hf/token")
    def api_hf_token_clear():
        return dataset_service.clear_hf_token(token_file)

    @router.get("/api/hf/whoami", response_model=HfWhoamiResponse)
    def api_hf_whoami():
        return dataset_service.hf_whoami(token_file)

    @router.get("/api/hf/my-datasets")
    def api_hf_my_datasets(limit: int = 50):
        return dataset_service.hf_my_datasets(token_file, limit=limit)

    @router.get("/api/hub/datasets/search")
    def api_hub_datasets_search(query: str = "", limit: int = 20, tag: str = "lerobot"):
        return dataset_service.hub_search_datasets(query=query, limit=limit, tag=tag)

    @router.post("/api/hub/datasets/download")
    async def api_hub_datasets_download(data: dict[str, object] | None = None):
        payload = data or {}
        repo_id = str(payload.get("repo_id", "")).strip()
        return dataset_service.start_hub_download_job(jobs_state, repo_id)

    @router.get("/api/hub/datasets/download/status/{job_id}")
    def api_hub_download_status(job_id: str):
        return dataset_service.get_hub_download_status(jobs_state, job_id)
