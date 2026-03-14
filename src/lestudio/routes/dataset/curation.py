from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from ...services import dataset_service

from .._state import AppState


def register_routes(router: APIRouter, state: AppState):
    jobs_state = state.dataset_jobs

    @router.get("/api/datasets/{user}/{repo}/tags")
    def api_episode_tags_get(user: str, repo: str):
        return dataset_service.get_episode_tags(state.config_dir, user, repo)

    @router.post("/api/datasets/{user}/{repo}/tags")
    def api_episode_tags_post(user: str, repo: str, body: dict[str, Any] | None = None):
        payload = body or {}
        return dataset_service.set_episode_tag(
            state.config_dir,
            user,
            repo,
            payload.get("episode_index", ""),
            payload.get("tag", "untagged"),
        )

    @router.post("/api/datasets/{user}/{repo}/tags/bulk")
    def api_episode_tags_bulk(user: str, repo: str, body: dict[str, Any] | None = None):
        payload = body or {}
        return dataset_service.bulk_set_episode_tags(
            state.config_dir,
            user,
            repo,
            payload.get("updates", []),
        )

    @router.get("/api/datasets/{user}/{repo}/stats")
    def api_episode_stats(user: str, repo: str):
        result = dataset_service.get_episode_stats(user, repo)
        if not result.get("ok", False) and "status_code" in result:
            return JSONResponse(
                {"ok": False, "error": str(result.get("error", "Failed to compute stats"))},
                status_code=int(result["status_code"]),
            )
        return result

    @router.post("/api/datasets/{user}/{repo}/stats/recompute")
    async def api_episode_stats_recompute(user: str, repo: str, request: Request):
        body = await request.json() if request else {}
        force = bool((body or {}).get("force", False))
        result = dataset_service.start_episode_stats_recompute_job(jobs_state, user, repo, force)
        if not result.get("ok", False) and "status_code" in result:
            return JSONResponse(
                {"ok": False, "error": str(result.get("error", "Failed to queue stats job"))},
                status_code=int(result["status_code"]),
            )
        return result

    @router.get("/api/datasets/stats/status/{job_id}")
    def api_episode_stats_status(job_id: str):
        return dataset_service.get_episode_stats_job_status(jobs_state, job_id)

    @router.post("/api/datasets/stats/cancel/{job_id}")
    def api_episode_stats_cancel(job_id: str):
        return dataset_service.cancel_episode_stats_job(jobs_state, job_id)

    @router.post("/api/datasets/{user}/{repo}/derive")
    async def api_derive_dataset(user: str, repo: str, request: Request):
        body = await request.json()
        result = dataset_service.start_derive_dataset_job(
            jobs_state,
            state.python_exe,
            user,
            repo,
            str((body or {}).get("new_repo_id", "")).strip(),
            (body or {}).get("keep_indices", []),
        )
        if not result.get("ok", False) and "status_code" in result:
            return JSONResponse(
                {"ok": False, "error": str(result.get("error", "Failed to queue derive job"))},
                status_code=int(result["status_code"]),
            )
        return result

    @router.get("/api/datasets/derive/status/{job_id}")
    def api_derive_status(job_id: str):
        return dataset_service.get_derive_job_status(jobs_state, job_id)

    @router.post("/api/datasets/derive/cancel/{job_id}")
    def api_derive_cancel(job_id: str):
        return dataset_service.cancel_derive_job(jobs_state, job_id)
