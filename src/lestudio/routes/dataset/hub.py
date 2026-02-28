"""Dataset push and HuggingFace Hub integration routes."""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter

from ...lib.async_job_manager import _cleanup_finished_jobs
from .._state import AppState


def register_routes(router: APIRouter, state: AppState):
    jobs_state = state.dataset_jobs
    token_file = state.config_dir / "hf_token"

    def _resolve_hf_token() -> tuple[str, str]:
        token_env = (os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_HUB_TOKEN") or "").strip()
        if token_env:
            return token_env, "env"

        if token_file.exists():
            try:
                token_saved = token_file.read_text().strip()
            except Exception:
                token_saved = ""
            if token_saved:
                os.environ["HF_TOKEN"] = token_saved
                os.environ["HUGGINGFACE_HUB_TOKEN"] = token_saved
                return token_saved, "file"

        return "", "none"

    def _mask_token(token: str) -> str:
        if not token:
            return ""
        if len(token) <= 8:
            return "*" * len(token)
        return f"{token[:4]}...{token[-4:]}"

    # ─── Dataset Push ──────────────────────────────────────────────────────────
    @router.post("/api/datasets/{user}/{repo}/push")
    async def api_dataset_push(user: str, repo: str, data: dict[str, object] | None = None):
        payload = data or {}
        local_path = Path.home() / ".cache" / "huggingface" / "lerobot" / user / repo
        if not local_path.exists():
            return {"ok": False, "error": "Dataset not found in local cache"}

        target_repo_id = str(payload.get("target_repo_id", f"{user}/{repo}")).strip() or f"{user}/{repo}"
        private = bool(payload.get("private", False))

        token, _ = _resolve_hf_token()
        if not token:
            return {"ok": False, "error": "HF_TOKEN (or HUGGINGFACE_HUB_TOKEN) is not set"}

        cli = shutil.which("huggingface-cli")
        if not cli:
            return {"ok": False, "error": "huggingface-cli is not installed in this environment"}

        _cleanup_finished_jobs(jobs_state.push_jobs_lock, jobs_state.push_jobs)
        job_id = uuid.uuid4().hex[:12]
        now = time.time()
        with jobs_state.push_jobs_lock:
            jobs_state.push_jobs[job_id] = {
                "job_id": job_id,
                "status": "queued",
                "phase": "queued",
                "progress": 0,
                "repo_id": target_repo_id,
                "dataset_id": f"{user}/{repo}",
                "started_at": now,
                "updated_at": now,
                "logs": [],
                "error": "",
            }

        def run_push_job():
            with jobs_state.push_jobs_lock:
                if job_id not in jobs_state.push_jobs:
                    return
                jobs_state.push_jobs[job_id]["status"] = "running"
                jobs_state.push_jobs[job_id]["phase"] = "preparing"
                jobs_state.push_jobs[job_id]["progress"] = 5
                jobs_state.push_jobs[job_id]["updated_at"] = time.time()

            cmd = [cli, "upload", target_repo_id, str(local_path), ".", "--repo-type", "dataset"]
            if private:
                cmd.append("--private")

            try:
                proc = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    env={**os.environ, "HF_TOKEN": token, "HUGGINGFACE_HUB_TOKEN": token},
                    bufsize=1,
                )
            except Exception as e:
                with jobs_state.push_jobs_lock:
                    jobs_state.push_jobs[job_id]["status"] = "error"
                    jobs_state.push_jobs[job_id]["error"] = str(e)
                    jobs_state.push_jobs[job_id]["updated_at"] = time.time()
                return

            progress = 5
            if proc.stdout is not None:
                for raw in proc.stdout:
                    line = raw.rstrip("\n")
                    with jobs_state.push_jobs_lock:
                        job = jobs_state.push_jobs.get(job_id)
                        if not job:
                            continue
                        logs = job["logs"]
                        logs.append(line)
                        if len(logs) > 300:
                            del logs[:-300]

                        job["phase"] = "uploading"

                        m = re.search(r"(\d{1,3})%", line)
                        ratio = re.search(r"\b([0-9]{1,6})\s*/\s*([0-9]{1,6})\b", line)
                        if m:
                            pct = max(0, min(99, int(m.group(1))))
                            progress = max(progress, pct)
                        elif ratio:
                            done = int(ratio.group(1))
                            total = max(1, int(ratio.group(2)))
                            pct = max(0, min(99, int((done / total) * 100)))
                            progress = max(progress, pct)
                        else:
                            progress = min(95, progress + 1)
                        job["progress"] = progress
                        job["updated_at"] = time.time()

            rc = proc.wait()
            with jobs_state.push_jobs_lock:
                job = jobs_state.push_jobs.get(job_id)
                if not job:
                    return
                if rc == 0:
                    job["phase"] = "finalizing"
                    job["progress"] = max(97, int(job.get("progress", 0)))
                    job["updated_at"] = time.time()
                    job["status"] = "success"
                    job["phase"] = "completed"
                    job["progress"] = 100
                else:
                    job["status"] = "error"
                    job["phase"] = "error"
                    if not job["error"]:
                        tail = "\n".join(job["logs"][-5:]).strip()
                        job["error"] = tail or f"Upload failed with exit code {rc}"
                job["updated_at"] = time.time()

        threading.Thread(target=run_push_job, daemon=True).start()
        return {"ok": True, "job_id": job_id}

    @router.get("/api/datasets/push/status/{job_id}")
    def api_dataset_push_status(job_id: str):
        _cleanup_finished_jobs(jobs_state.push_jobs_lock, jobs_state.push_jobs)
        with jobs_state.push_jobs_lock:
            job = jobs_state.push_jobs.get(job_id)
            if not job:
                return {"ok": False, "error": "Push job not found"}
            return {"ok": True, **job}

    # ─── HF Identity ─────────────────────────────────────────────────────────
    _whoami_cache: dict[str, object] = {}  # {"result": ..., "expires": float, "token": str}

    @router.get("/api/hf/token/status")
    def api_hf_token_status():
        token, source = _resolve_hf_token()
        return {
            "ok": True,
            "has_token": bool(token),
            "source": source,
            "masked_token": _mask_token(token),
        }

    @router.put("/api/hf/token")
    @router.post("/api/hf/token")
    async def api_hf_token_set(data: dict[str, object] | None = None):
        payload = data or {}
        token = str(payload.get("token", "")).strip()
        if not token:
            return {"ok": False, "error": "token is required"}
        try:
            token_file.parent.mkdir(parents=True, exist_ok=True)
            token_file.write_text(token)
            try:
                os.chmod(token_file, 0o600)
            except Exception:
                pass
            os.environ["HF_TOKEN"] = token
            os.environ["HUGGINGFACE_HUB_TOKEN"] = token
            _whoami_cache.clear()
            return {"ok": True, "has_token": True, "source": "env"}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    @router.delete("/api/hf/token")
    def api_hf_token_clear():
        os.environ.pop("HF_TOKEN", None)
        os.environ.pop("HUGGINGFACE_HUB_TOKEN", None)
        try:
            if token_file.exists():
                token_file.unlink()
        except Exception as e:
            return {"ok": False, "error": str(e)}
        _whoami_cache.clear()
        return {"ok": True, "has_token": False, "source": "none"}

    @router.get("/api/hf/whoami")
    def api_hf_whoami():
        """Return the HuggingFace username associated with the current token."""
        # ok:True만 캐싱 (5분). 토큰이 달라지면 즉시 무효화.
        token, _ = _resolve_hf_token()
        if not token:
            _whoami_cache.clear()
            return {"ok": False, "username": None, "error": "no_token"}
        cached = _whoami_cache.get("result")
        expires_raw = _whoami_cache.get("expires", 0.0)
        expires = float(expires_raw) if isinstance(expires_raw, (int, float)) else 0.0
        token_cached = _whoami_cache.get("token")
        if (cached
                and time.monotonic() < expires
                and isinstance(token_cached, str)
                and token_cached == token):
            return cached

        try:
            hub_mod = __import__("huggingface_hub")
            whoami = getattr(hub_mod, "whoami")
            info = whoami(token=token)
            username = info.get("name", None) if isinstance(info, dict) else None
            if not username:
                return {"ok": False, "username": None, "error": "no_username"}
            result = {"ok": True, "username": username}
            _whoami_cache["result"] = result
            _whoami_cache["expires"] = time.monotonic() + 300.0  # 5분
            _whoami_cache["token"] = token
            return result
        except ImportError:
            return {"ok": False, "username": None, "error": "huggingface_hub_not_installed"}
        except Exception:
            return {"ok": False, "username": None, "error": "auth_failed"}

    # ─── Hub Search / Download ─────────────────────────────────────────────────
    @router.get("/api/hub/datasets/search")
    def api_hub_datasets_search(query: str = "", limit: int = 20, tag: str = "lerobot"):
        """Search HuggingFace Hub for LeRobot datasets."""
        try:
            hub_mod = __import__("huggingface_hub")
            list_datasets = getattr(hub_mod, "list_datasets")
        except ImportError:
            return {"ok": False, "error": "huggingface_hub is not installed", "datasets": []}

        limit = max(1, min(limit, 100))
        try:
            search_tags = [tag] if tag else []
            kwargs: dict[str, Any] = {"tags": search_tags, "limit": limit, "full": False}
            if query:
                kwargs["search"] = query
            results = []
            for ds in list_datasets(**kwargs):
                entry = {
                    "id": ds.id,
                    "downloads": getattr(ds, "downloads", 0) or 0,
                    "likes": getattr(ds, "likes", 0) or 0,
                    "tags": list(getattr(ds, "tags", []) or []),
                    "last_modified": str(getattr(ds, "last_modified", "") or ""),
                }
                results.append(entry)
            return {"ok": True, "datasets": results}
        except Exception as e:
            return {"ok": False, "error": str(e), "datasets": []}

    @router.post("/api/hub/datasets/download")
    async def api_hub_datasets_download(data: dict[str, object] | None = None):
        """Download a dataset from HuggingFace Hub to local cache."""
        payload = data or {}
        repo_id = str(payload.get("repo_id", "")).strip()
        if not repo_id or "/" not in repo_id:
            return {"ok": False, "error": "repo_id must be in user/repo format"}

        _cleanup_finished_jobs(jobs_state.download_jobs_lock, jobs_state.download_jobs)
        job_id = uuid.uuid4().hex[:12]
        now = time.time()
        with jobs_state.download_jobs_lock:
            jobs_state.download_jobs[job_id] = {
                "job_id": job_id,
                "repo_id": repo_id,
                "status": "queued",
                "progress": 0,
                "logs": [],
                "error": "",
                "started_at": now,
                "updated_at": now,
            }

        def run_download_job():
            with jobs_state.download_jobs_lock:
                job = jobs_state.download_jobs.get(job_id)
                if not job:
                    return
                job["status"] = "running"
                job["progress"] = 5
                job["updated_at"] = time.time()

            rc = -1
            try:
                hub_mod = __import__("huggingface_hub")
                snapshot_download = getattr(hub_mod, "snapshot_download")
                local_dir = Path.home() / ".cache" / "huggingface" / "lerobot" / repo_id
                cli = shutil.which("huggingface-cli")
                if cli:
                    cmd = [cli, "download", repo_id, "--repo-type", "dataset", "--local-dir", str(local_dir)]
                    env = {**os.environ}
                    proc = subprocess.Popen(
                        cmd,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.STDOUT,
                        text=True,
                        env=env,
                        bufsize=1,
                    )
                    progress = 5
                    if proc.stdout:
                        for raw in proc.stdout:
                            line = raw.rstrip("\n")
                            with jobs_state.download_jobs_lock:
                                job2 = jobs_state.download_jobs.get(job_id)
                                if not job2:
                                    continue
                                job2["logs"].append(line)
                                if len(job2["logs"]) > 200:
                                    del job2["logs"][:-200]
                                m = re.search(r"(\d{1,3})%", line)
                                ratio = re.search(r"\b([0-9]{1,6})\s*/\s*([0-9]{1,6})\b", line)
                                if m:
                                    pct = max(0, min(99, int(m.group(1))))
                                    progress = max(progress, pct)
                                elif ratio:
                                    done = int(ratio.group(1))
                                    total = max(1, int(ratio.group(2)))
                                    pct = max(0, min(99, int((done / total) * 100)))
                                    progress = max(progress, pct)
                                else:
                                    progress = min(95, progress + 1)
                                job2["progress"] = progress
                                job2["updated_at"] = time.time()
                    rc = proc.wait()
                else:
                    snapshot_download(repo_id=repo_id, repo_type="dataset", local_dir=str(local_dir))
                    rc = 0

                with jobs_state.download_jobs_lock:
                    job3 = jobs_state.download_jobs.get(job_id)
                    if not job3:
                        return
                    if rc == 0:
                        job3["status"] = "success"
                        job3["progress"] = 100
                    else:
                        job3["status"] = "error"
                        tail = "\n".join(job3["logs"][-5:]).strip()
                        job3["error"] = tail or f"Download failed (exit {rc})"
                    job3["updated_at"] = time.time()

            except Exception as e:
                with jobs_state.download_jobs_lock:
                    job4 = jobs_state.download_jobs.get(job_id)
                    if job4:
                        job4["status"] = "error"
                        job4["error"] = str(e)
                        job4["updated_at"] = time.time()

        threading.Thread(target=run_download_job, daemon=True).start()
        return {"ok": True, "job_id": job_id}

    @router.get("/api/hub/datasets/download/status/{job_id}")
    def api_hub_download_status(job_id: str):
        _cleanup_finished_jobs(jobs_state.download_jobs_lock, jobs_state.download_jobs)
        with jobs_state.download_jobs_lock:
            job = jobs_state.download_jobs.get(job_id)
            if not job:
                return {"ok": False, "error": "Download job not found"}
            return {"ok": True, **job}
