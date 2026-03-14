from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from starlette.responses import Response

from ...services import dataset_service

from .._state import AppState


def _discover_parquet_files(source_path: Path) -> list[Path]:
    return dataset_service.discover_parquet_files(source_path)


def _serve_video_file(video_path: Path, file_size: int, range_header: str | None):
    plan = dataset_service.build_video_range_plan(file_size, range_header)
    if not plan.get("ok", False):
        return Response(status_code=int(plan.get("status_code", 416)), headers=plan.get("headers", {}))
    if bool(plan.get("partial", False)):
        return StreamingResponse(
            dataset_service.iter_video_file(video_path, int(plan["start"]), int(plan["chunk_size"])),
            status_code=206,
            headers=plan["headers"],
            media_type="video/mp4",
        )
    return FileResponse(video_path, media_type="video/mp4", headers={"Accept-Ranges": "bytes"})


def register_routes(router: APIRouter, state: AppState):
    _ = state

    @router.get("/api/datasets")
    def api_datasets_list():
        return dataset_service.list_local_datasets()

    @router.get("/api/datasets/{user}/{repo}")
    def api_dataset_info(user: str, repo: str):
        result = dataset_service.get_dataset_info(user, repo)
        if result.get("ok", False):
            return {k: v for k, v in result.items() if k != "ok"}
        return JSONResponse(
            status_code=int(result.get("status_code", 500)),
            content={"detail": str(result.get("detail", "Failed to load dataset"))},
        )

    @router.get("/api/datasets/{user}/{repo}/videos/{camera}/{chunk}/{file}")
    def api_dataset_video(request: Request, user: str, repo: str, camera: str, chunk: str, file: str):
        resolved = dataset_service.resolve_dataset_video(user, repo, camera, chunk, file)
        if not resolved.get("ok", False):
            return Response(status_code=int(resolved.get("status_code", 404)), content=str(resolved.get("error", "")))
        range_header = request.headers.get("range")
        return _serve_video_file(
            resolved["video_path"],
            int(resolved["file_size"]),
            range_header=range_header,
        )

    @router.delete("/api/datasets/{user}/{repo}")
    def api_dataset_delete(user: str, repo: str):
        result = dataset_service.delete_dataset(user, repo)
        if result.get("ok", False):
            return {"ok": True}
        return JSONResponse(
            status_code=int(result.get("status_code", 500)),
            content={"detail": str(result.get("detail", "Failed to delete dataset"))},
        )

    @router.get("/api/datasets/{user}/{repo}/quality")
    def api_dataset_quality(user: str, repo: str):
        return dataset_service.check_dataset_quality(user, repo)
