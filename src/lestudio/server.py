#!/usr/bin/env python3
"""LeStudio — Web GUI server (packaged version)."""

import importlib.util
import logging
import os
import shutil
import sys
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response
from starlette.types import Scope

from lestudio._logging import configure_logging
from lestudio._auth import TokenAuthMiddleware, generate_token
from lestudio._cors import _resolve_cors_settings
from lestudio._streaming import unlock_cameras
from lestudio.process_manager import ProcessManager
from lestudio import device_registry

logger = logging.getLogger(__name__)
configure_logging()


class SPAStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope: Scope):
        try:
            response = await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code != 404:
                raise
            response = None

        if response is not None and response.status_code != 404:
            return response

        normalized = path.lstrip("/")
        top_level = normalized.split("/", 1)[0]
        if top_level in {"api", "ws"}:
            if response is not None:
                return response
            raise StarletteHTTPException(status_code=404)

        if Path(normalized).suffix:
            if response is not None:
                return response
            raise StarletteHTTPException(status_code=404)

        return await super().get_response("index.html", scope)
# ─── nvidia pip 패키지의 .so를 LD_LIBRARY_PATH에 자동 추가 ─────────────────
def _patch_nvidia_lib_path():
    existing = os.environ.get("LD_LIBRARY_PATH", "")
    existing_parts = [p for p in existing.split(":") if p]
    seen = set(existing_parts)
    added: list[str] = []

    def add_lib_dir(path: str):
        if not path:
            return
        if not os.path.isdir(path):
            return
        if path in seen:
            return
        seen.add(path)
        added.append(path)

    for pkg in ["nvidia.npp", "nvidia.cudnn", "nvidia.cublas", "nvidia.cusparse", "nvidia.cufft", "nvidia.cusolver", "nvidia.nvjitlink"]:
        try:
            spec = importlib.util.find_spec(pkg)
        except ModuleNotFoundError:
            continue
        if spec and spec.submodule_search_locations:
            for loc in spec.submodule_search_locations:
                add_lib_dir(os.path.join(loc, "lib"))

    conda_prefix_candidates: list[Path] = []
    env_prefix = os.environ.get("CONDA_PREFIX", "").strip()
    if env_prefix:
        conda_prefix_candidates.append(Path(env_prefix))

    conda_exe = (os.environ.get("CONDA_EXE", "").strip() or shutil.which("conda") or "").strip()
    if conda_exe:
        conda_path = Path(conda_exe).resolve()
        if conda_path.parent.name in {"condabin", "bin"}:
            conda_prefix_candidates.append(conda_path.parent.parent)

    dedup_prefixes: list[Path] = []
    seen_prefixes: set[str] = set()
    for prefix in conda_prefix_candidates:
        key = str(prefix)
        if not key or key in seen_prefixes:
            continue
        seen_prefixes.add(key)
        dedup_prefixes.append(prefix)

    for prefix in dedup_prefixes:
        add_lib_dir(str(prefix / "lib"))

    if added:
        os.environ["LD_LIBRARY_PATH"] = ":".join(added + existing_parts)


_patch_nvidia_lib_path()

# ─── Module-level constants ────────────────────────────────────────────────────
ROBOT_TYPES = device_registry.get_robot_types()


# ─── App Factory ───────────────────────────────────────────────────────────────
def create_app(
    lerobot_src: Path,
    config_dir: Path,
    rules_path: Path,
    session_token: str | None = None,
) -> FastAPI:
    from lestudio.routes._state import AppState
    from lestudio.routes import devices, config, udev, process, training, eval as eval_routes, dataset, streaming, motor

    STATIC_DIR = Path(__file__).parent / "static"
    CONFIG_PATH = config_dir / "config.json"
    FALLBACK_RULES_PATH = config_dir / "99-lerobot.rules"
    HISTORY_PATH = config_dir / "history.json"
    HISTORY_MAX = 200
    PYTHON = sys.executable

    cors_origins, cors_origin_regex = _resolve_cors_settings()
    token = session_token if session_token is not None else generate_token()

    app = FastAPI(title="LeStudio")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_origin_regex=cors_origin_regex,
        allow_methods=["*"],
        allow_headers=["*", "X-LeStudio-Token"],
    )
    app.add_middleware(TokenAuthMiddleware, token=token)
    app.state.session_token = token

    class NoCacheStaticMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request, call_next):
            response: Response = await call_next(request)
            if request.url.path.startswith("/static/"):
                response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            return response

    app.add_middleware(NoCacheStaticMiddleware)

    # Create shared state; proc_mgr assigned after _on_process_exit is defined
    state = AppState(
        proc_mgr=None,  # type: ignore[arg-type]  # set below
        config_path=CONFIG_PATH,
        config_dir=config_dir,
        rules_path=rules_path,
        fallback_rules_path=FALLBACK_RULES_PATH,
        history_path=HISTORY_PATH,
        history_max=HISTORY_MAX,
        python_exe=PYTHON,
    )

    def _on_process_exit(name: str):
        if name in {"record", "teleop"}:
            unlock_cameras()
        state.append_history(f"{name}_end")

    state.proc_mgr = ProcessManager(lerobot_src, on_process_exit=_on_process_exit)

    # ─── Include routers ───────────────────────────────────────────────────────
    app.include_router(devices.create_router(state))
    app.include_router(config.create_router(state))
    app.include_router(udev.create_router(state))
    app.include_router(process.create_router(state))
    app.include_router(training.create_router(state))
    app.include_router(eval_routes.create_router(state))
    app.include_router(dataset.create_router(state))
    app.include_router(streaming.create_router(state))
    app.include_router(motor.create_router(state))

    # ─── Static + Root ─────────────────────────────────────────────────────────
    # Vite builds assets to STATIC_DIR with root-relative paths (/assets/...)
    app.mount("/", SPAStaticFiles(directory=str(STATIC_DIR), html=True), name="static")
    return app
