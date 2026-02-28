"""Dataset curation, tags, stats, and derive routes."""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Sequence

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from ...lib.async_job_manager import TERMINAL_JOB_STATUS, _cleanup_finished_jobs
from .._state import AppState

from .listing import _discover_parquet_files


VALID_TAGS = {"good", "bad", "review", "untagged"}


def _cleanup_runtime_refs(state: AppState):
    jobs_state = state.dataset_jobs
    with jobs_state.derive_jobs_lock:
        derive_status = {jid: str(job.get("status", "")) for jid, job in jobs_state.derive_jobs.items()}
    with jobs_state.derive_procs_lock:
        stale_proc_ids = [
            jid
            for jid in jobs_state.derive_procs.keys()
            if jid not in derive_status or derive_status.get(jid) in TERMINAL_JOB_STATUS
        ]
        for jid in stale_proc_ids:
            jobs_state.derive_procs.pop(jid, None)

    with jobs_state.stats_jobs_lock:
        stats_status = {jid: str(job.get("status", "")) for jid, job in jobs_state.stats_jobs.items()}
    with jobs_state.stats_cancel_lock:
        stale_cancel_ids = [
            jid
            for jid in jobs_state.stats_cancel_events.keys()
            if jid not in stats_status or stats_status.get(jid) in TERMINAL_JOB_STATUS
        ]
        for jid in stale_cancel_ids:
            jobs_state.stats_cancel_events.pop(jid, None)


def _tags_file_path(state: AppState, user: str, repo: str) -> Path:
    tags_dir = state.config_dir / "episode-tags"
    return tags_dir / f"{user}_{repo}.json"


def _load_tags(tags_file: Path) -> dict[str, str]:
    if tags_file.exists():
        try:
            loaded = json.loads(tags_file.read_text())
            if isinstance(loaded, dict):
                return {str(k): str(v) for k, v in loaded.items()}
        except Exception:
            pass
    return {}

def _save_tags(tags_file: Path, tags: dict[str, str]) -> None:
    tags_file.parent.mkdir(parents=True, exist_ok=True)
    tags_file.write_text(json.dumps(tags, indent=2))


def _compute_stats_signature(source_path: Path, info_path: Path, pq_files: list[Path]) -> str:
    h = hashlib.sha256()
    info_stat = info_path.stat()
    h.update(f"info:{info_stat.st_mtime_ns}:{info_stat.st_size}".encode("utf-8"))
    h.update(f"pq_count:{len(pq_files)}".encode("utf-8"))
    for p in pq_files:
        try:
            ps = p.stat()
            rel = p.relative_to(source_path)
            h.update(f"{rel}:{ps.st_mtime_ns}:{ps.st_size}".encode("utf-8"))
        except Exception:
            h.update(str(p).encode("utf-8"))
    return h.hexdigest()


def _build_dataset_summary(episode_stats: list[dict[str, Any]], np_mod) -> dict[str, Any]:
    def _pct(vals: Sequence[int | float], p: int) -> float:
        arr = np_mod.array(vals, dtype=float)
        return round(float(np_mod.percentile(arr, p)), 4) if len(arr) else 0.0

    frames_vals = [int(e.get("frames", 0)) for e in episode_stats]
    move_vals = [float(e.get("movement", 0.0)) for e in episode_stats]
    jerk_vals = [float(e.get("jerk_score", 0.0)) for e in episode_stats]
    jerk_ratio_vals = [float(e.get("jerk_ratio", 0.0)) for e in episode_stats]

    if not episode_stats:
        return {
            "frames": {"min": 0, "max": 0, "p25": 0.0, "p75": 0.0, "median": 0.0},
            "movement": {"min": 0.0, "max": 0.0, "p25": 0.0, "p75": 0.0, "median": 0.0},
            "jerk_score": {"min": 0.0, "max": 0.0, "p25": 0.0, "p75": 0.0, "median": 0.0},
            "jerk_ratio": {"min": 0.0, "max": 0.0, "p25": 0.0, "p75": 0.0, "median": 0.0},
        }

    return {
        "frames": {
            "min": min(frames_vals),
            "max": max(frames_vals),
            "p25": _pct(frames_vals, 25),
            "p75": _pct(frames_vals, 75),
            "median": _pct(frames_vals, 50),
        },
        "movement": {
            "min": round(min(move_vals), 4),
            "max": round(max(move_vals), 4),
            "p25": _pct(move_vals, 25),
            "p75": _pct(move_vals, 75),
            "median": _pct(move_vals, 50),
        },
        "jerk_score": {
            "min": round(min(jerk_vals), 4),
            "max": round(max(jerk_vals), 4),
            "p25": _pct(jerk_vals, 25),
            "p75": _pct(jerk_vals, 75),
            "median": _pct(jerk_vals, 50),
        },
        "jerk_ratio": {
            "min": round(min(jerk_ratio_vals), 4),
            "max": round(max(jerk_ratio_vals), 4),
            "p25": _pct(jerk_ratio_vals, 25),
            "p75": _pct(jerk_ratio_vals, 75),
            "median": _pct(jerk_ratio_vals, 50),
        },
    }


def _compute_episode_stats(
    source_path: Path,
    cancel_event: threading.Event | None = None,
    progress_cb=None,
) -> dict[str, Any]:
    pd = __import__("pandas")
    np = __import__("numpy")

    pq_files = _discover_parquet_files(source_path)
    if not pq_files:
        raise FileNotFoundError("No parquet files found")

    states: dict[int, dict[str, Any]] = {}
    total_files = len(pq_files)

    for file_idx, pq_path in enumerate(pq_files, start=1):
        if cancel_event and cancel_event.is_set():
            raise RuntimeError("cancelled")

        df = pd.read_parquet(
            pq_path,
            columns=["action", "timestamp", "frame_index", "episode_index"],
        )

        if len(df) == 0:
            if progress_cb:
                progress_cb(file_idx, total_files)
            continue

        for ep_idx, group in df.groupby("episode_index"):
            try:
                ep_key = int(ep_idx)
            except Exception:
                continue

            st = states.get(ep_key)
            if st is None:
                st = {
                    "frames": 0,
                    "min_ts": None,
                    "max_ts": None,
                    "movement_sum": 0.0,
                    "movement_count": 0,
                    "jerk_sum": 0.0,
                    "jerk_count": 0,
                    "max_jerk": 0.0,
                    "prev_action": None,
                    "prev_vel": None,
                }
                states[ep_key] = st

            ordered = group.sort_values("frame_index")
            for row in ordered.itertuples(index=False):
                if cancel_event and cancel_event.is_set():
                    raise RuntimeError("cancelled")

                st["frames"] = int(st.get("frames", 0) or 0) + 1

                ts = getattr(row, "timestamp", None)
                if ts is not None and not pd.isna(ts):
                    ts_val = float(ts)
                    if st["min_ts"] is None or ts_val < st["min_ts"]:
                        st["min_ts"] = ts_val
                    if st["max_ts"] is None or ts_val > st["max_ts"]:
                        st["max_ts"] = ts_val

                action_raw = getattr(row, "action", None)
                action = None
                if action_raw is not None:
                    try:
                        action = np.asarray(action_raw, dtype=float).reshape(-1)
                        if action.size == 0:
                            action = None
                    except Exception:
                        action = None

                if action is None:
                    continue

                prev_action = st.get("prev_action")
                if prev_action is not None and getattr(prev_action, "shape", None) == action.shape:
                    vel = action - prev_action
                    vel_norm = float(np.linalg.norm(vel))
                    st["movement_sum"] = float(st.get("movement_sum", 0.0) or 0.0) + vel_norm
                    st["movement_count"] = int(st.get("movement_count", 0) or 0) + 1

                    prev_vel = st.get("prev_vel")
                    if prev_vel is not None and getattr(prev_vel, "shape", None) == vel.shape:
                        jerk = vel - prev_vel
                        jerk_norm = float(np.linalg.norm(jerk))
                        st["jerk_sum"] = float(st.get("jerk_sum", 0.0) or 0.0) + jerk_norm
                        st["jerk_count"] = int(st.get("jerk_count", 0) or 0) + 1
                        if jerk_norm > float(st.get("max_jerk", 0.0) or 0.0):
                            st["max_jerk"] = jerk_norm
                    st["prev_vel"] = vel
                else:
                    st["prev_vel"] = None

                st["prev_action"] = action

        if progress_cb:
            progress_cb(file_idx, total_files)

    episode_stats: list[dict[str, Any]] = []
    for ep_idx in sorted(states.keys()):
        st = states[ep_idx]
        n_frames = int(st["frames"])
        min_ts = st["min_ts"]
        max_ts = st["max_ts"]
        duration_s = float(max_ts - min_ts) if min_ts is not None and max_ts is not None and n_frames > 1 else 0.0

        movement = float(st["movement_sum"] / st["movement_count"]) if st["movement_count"] > 0 else 0.0
        jerk_score = float(st["jerk_sum"] / st["jerk_count"]) if st["jerk_count"] > 0 else 0.0
        max_jerk = float(st["max_jerk"])
        jerk_ratio = float(jerk_score / max(1e-6, movement)) if movement > 0 else 0.0

        episode_stats.append(
            {
                "episode_index": ep_idx,
                "frames": n_frames,
                "duration_s": round(duration_s, 3),
                "movement": round(movement, 4),
                "jerk_score": round(jerk_score, 4),
                "max_jerk": round(max_jerk, 4),
                "jerk_ratio": round(jerk_ratio, 4),
            }
        )

    return {
        "episodes": episode_stats,
        "dataset_summary": _build_dataset_summary(episode_stats, np),
        "computed_at": time.time(),
        "episode_count": len(episode_stats),
    }


def register_routes(router: APIRouter, state: AppState):
    jobs_state = state.dataset_jobs

    # ─── Episode Tags ──────────────────────────────────────────────────────────
    @router.get("/api/datasets/{user}/{repo}/tags")
    def api_episode_tags_get(user: str, repo: str):
        tags_file = _tags_file_path(state, user, repo)
        tags = _load_tags(tags_file)
        return {"ok": True, "tags": tags}

    @router.post("/api/datasets/{user}/{repo}/tags")
    def api_episode_tags_post(user: str, repo: str, body: dict[str, Any] | None = None):
        payload = body or {}
        episode_raw = payload.get("episode_index", "")
        tag = str(payload.get("tag", "untagged"))
        if tag not in VALID_TAGS:
            return {"ok": False, "error": f"Invalid tag. Must be one of: {', '.join(sorted(VALID_TAGS))}"}
        try:
            episode_index_int = int(episode_raw)
        except Exception:
            return {"ok": False, "error": "episode_index is required"}
        if episode_index_int < 0:
            return {"ok": False, "error": "episode_index must be >= 0"}

        episode_index = str(episode_index_int)
        tags_file = _tags_file_path(state, user, repo)
        tags = _load_tags(tags_file)
        if tag == "untagged":
            tags.pop(episode_index, None)
        else:
            tags[episode_index] = tag
        _save_tags(tags_file, tags)
        return {"ok": True, "episode_index": episode_index, "tag": tag}

    @router.post("/api/datasets/{user}/{repo}/tags/bulk")
    def api_episode_tags_bulk(user: str, repo: str, body: dict[str, Any] | None = None):
        payload = body or {}
        updates_raw = payload.get("updates", [])
        if not isinstance(updates_raw, list) or len(updates_raw) == 0:
            return {"ok": False, "error": "updates must be a non-empty list"}
        if len(updates_raw) > 20000:
            return {"ok": False, "error": "updates is too large (max: 20000)"}

        normalized: list[tuple[str, str]] = []
        for idx, item in enumerate(updates_raw):
            if not isinstance(item, dict):
                return {"ok": False, "error": f"updates[{idx}] must be an object"}

            tag = str(item.get("tag", "untagged"))
            if tag not in VALID_TAGS:
                return {
                    "ok": False,
                    "error": f"updates[{idx}] has invalid tag '{tag}'. Allowed: {', '.join(sorted(VALID_TAGS))}",
                }

            ep_raw = item.get("episode_index", None)
            if ep_raw is None:
                return {"ok": False, "error": f"updates[{idx}].episode_index is required"}
            try:
                ep_idx = int(ep_raw)
            except Exception:
                return {"ok": False, "error": f"updates[{idx}].episode_index must be an integer"}
            if ep_idx < 0:
                return {"ok": False, "error": f"updates[{idx}].episode_index must be >= 0"}
            normalized.append((str(ep_idx), tag))

        tags_file = _tags_file_path(state, user, repo)
        tags = _load_tags(tags_file)
        for ep_key, tag in normalized:
            if tag == "untagged":
                tags.pop(ep_key, None)
            else:
                tags[ep_key] = tag

        _save_tags(tags_file, tags)
        return {"ok": True, "applied": len(normalized)}

    # ─── Episode Stats (Auto-flag) ─────────────────────────────────────────────
    @router.get("/api/datasets/{user}/{repo}/stats")
    def api_episode_stats(user: str, repo: str):
        from ...command_builders import dataset_cache_path

        source_path = dataset_cache_path(f"{user}/{repo}")
        info_path = source_path / "meta" / "info.json"
        if not info_path.exists():
            return JSONResponse({"ok": False, "error": "Dataset not found locally"}, status_code=404)

        pq_files = _discover_parquet_files(source_path)
        if not pq_files:
            return JSONResponse({"ok": False, "error": "No parquet files found"}, status_code=404)

        cache_file = source_path / ".lestudio_ep_stats.json"
        signature = _compute_stats_signature(source_path, info_path, pq_files)
        if cache_file.exists():
            try:
                cached = json.loads(cache_file.read_text())
                if cached.get("cache_signature") == signature:
                    return {
                        "ok": True,
                        "cached": True,
                        **{k: v for k, v in cached.items() if k != "cache_signature"},
                    }
            except Exception:
                pass

        try:
            result = _compute_episode_stats(source_path)
        except Exception as exc:
            return JSONResponse({"ok": False, "error": f"Failed to compute stats: {exc}"}, status_code=500)

        payload = {"cache_signature": signature, **result}
        try:
            cache_file.write_text(json.dumps(payload))
        except Exception:
            pass

        return {"ok": True, "cached": False, **result}

    @router.post("/api/datasets/{user}/{repo}/stats/recompute")
    async def api_episode_stats_recompute(user: str, repo: str, request: Request):
        from ...command_builders import dataset_cache_path

        body = await request.json() if request else {}
        force = bool((body or {}).get("force", False))
        dataset_id = f"{user}/{repo}"
        source_path = dataset_cache_path(dataset_id)
        info_path = source_path / "meta" / "info.json"
        if not info_path.exists():
            return JSONResponse({"ok": False, "error": "Dataset not found locally"}, status_code=404)

        pq_files = _discover_parquet_files(source_path)
        if not pq_files:
            return JSONResponse({"ok": False, "error": "No parquet files found"}, status_code=404)

        cache_file = source_path / ".lestudio_ep_stats.json"
        signature = _compute_stats_signature(source_path, info_path, pq_files)

        if not force and cache_file.exists():
            try:
                cached = json.loads(cache_file.read_text())
                if cached.get("cache_signature") == signature:
                    return {"ok": True, "status": "ready", "cached": True, "job_id": ""}
            except Exception:
                pass

        _cleanup_finished_jobs(jobs_state.stats_jobs_lock, jobs_state.stats_jobs)
        _cleanup_runtime_refs(state)

        job_id = uuid.uuid4().hex[:12]
        now = time.time()
        cancel_event = threading.Event()

        with jobs_state.stats_cancel_lock:
            jobs_state.stats_cancel_events[job_id] = cancel_event

        with jobs_state.stats_jobs_lock:
            jobs_state.stats_jobs[job_id] = {
                "job_id": job_id,
                "dataset_id": dataset_id,
                "status": "queued",
                "phase": "queued",
                "progress": 0,
                "started_at": now,
                "updated_at": now,
                "logs": [],
                "error": "",
                "cancel_requested": False,
            }

        def run_stats_job():
            with jobs_state.stats_jobs_lock:
                job = jobs_state.stats_jobs.get(job_id)
                if not job:
                    return
                job["status"] = "running"
                job["phase"] = "reading"
                job["progress"] = 3
                job["updated_at"] = time.time()

            def on_progress(done_files: int, total_files: int):
                pct = 5 + int((max(1, done_files) / max(1, total_files)) * 85)
                with jobs_state.stats_jobs_lock:
                    job2 = jobs_state.stats_jobs.get(job_id)
                    if not job2:
                        return
                    if bool(job2.get("cancel_requested", False)):
                        cancel_event.set()
                        return
                    job2["progress"] = max(int(job2.get("progress", 0)), min(95, pct))
                    job2["phase"] = "processing"
                    job2["updated_at"] = time.time()

            try:
                result = _compute_episode_stats(source_path, cancel_event=cancel_event, progress_cb=on_progress)
                if cancel_event.is_set():
                    with jobs_state.stats_jobs_lock:
                        job3 = jobs_state.stats_jobs.get(job_id)
                        if job3:
                            job3["status"] = "cancelled"
                            job3["phase"] = "cancelled"
                            job3["progress"] = 0
                            job3["error"] = "Cancelled by user"
                            job3["updated_at"] = time.time()
                    return

                payload = {"cache_signature": signature, **result}
                try:
                    cache_file.write_text(json.dumps(payload))
                except Exception:
                    pass

                with jobs_state.stats_jobs_lock:
                    job4 = jobs_state.stats_jobs.get(job_id)
                    if job4:
                        job4["status"] = "success"
                        job4["phase"] = "completed"
                        job4["progress"] = 100
                        job4["updated_at"] = time.time()
            except Exception as exc:
                with jobs_state.stats_jobs_lock:
                    job5 = jobs_state.stats_jobs.get(job_id)
                    if job5:
                        if cancel_event.is_set() or bool(job5.get("cancel_requested", False)):
                            job5["status"] = "cancelled"
                            job5["phase"] = "cancelled"
                            job5["progress"] = 0
                            job5["error"] = "Cancelled by user"
                        else:
                            job5["status"] = "error"
                            job5["phase"] = "error"
                            job5["error"] = str(exc)
                        job5["updated_at"] = time.time()

        threading.Thread(target=run_stats_job, daemon=True).start()
        return {"ok": True, "status": "queued", "cached": False, "job_id": job_id}

    @router.get("/api/datasets/stats/status/{job_id}")
    def api_episode_stats_status(job_id: str):
        _cleanup_finished_jobs(jobs_state.stats_jobs_lock, jobs_state.stats_jobs)
        _cleanup_runtime_refs(state)
        with jobs_state.stats_jobs_lock:
            job = jobs_state.stats_jobs.get(job_id)
            if not job:
                return {"ok": False, "error": "Stats job not found"}
            return {"ok": True, **job}

    @router.post("/api/datasets/stats/cancel/{job_id}")
    def api_episode_stats_cancel(job_id: str):
        with jobs_state.stats_jobs_lock:
            job = jobs_state.stats_jobs.get(job_id)
            if not job:
                return {"ok": False, "error": "Stats job not found"}
            status = str(job.get("status", ""))
            if status in TERMINAL_JOB_STATUS:
                return {"ok": False, "error": f"Job already finished ({status})"}
            job["cancel_requested"] = True
            if status == "queued":
                job["status"] = "cancelled"
                job["phase"] = "cancelled"
                job["error"] = "Cancelled by user"
                job["progress"] = 0
            job["updated_at"] = time.time()

        with jobs_state.stats_cancel_lock:
            ev = jobs_state.stats_cancel_events.get(job_id)
            if ev:
                ev.set()
        return {"ok": True, "job_id": job_id}

    # ─── Derive (non-destructive episode curation) ──────────────────────────
    @router.post("/api/datasets/{user}/{repo}/derive")
    async def api_derive_dataset(user: str, repo: str, request: Request):
        body = await request.json()
        new_repo_id = str((body or {}).get("new_repo_id", "")).strip()
        keep_indices_raw = (body or {}).get("keep_indices", [])

        if not new_repo_id:
            return JSONResponse({"ok": False, "error": "new_repo_id is required"}, status_code=400)
        if not re.match(r"^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$", new_repo_id):
            return JSONResponse({"ok": False, "error": "new_repo_id must be user/repo format"}, status_code=400)
        if not isinstance(keep_indices_raw, list) or len(keep_indices_raw) == 0:
            return JSONResponse({"ok": False, "error": "keep_indices must be a non-empty array"}, status_code=400)

        source_repo_id = f"{user}/{repo}"
        if source_repo_id == new_repo_id:
            return JSONResponse({"ok": False, "error": "new_repo_id must differ from source repo"}, status_code=400)

        from ...command_builders import build_derive_args, dataset_cache_path

        source_path = dataset_cache_path(source_repo_id)
        info_path = source_path / "meta" / "info.json"
        if not info_path.exists():
            return JSONResponse({"ok": False, "error": f"Dataset {source_repo_id} not found locally"}, status_code=404)

        try:
            info = json.loads(info_path.read_text())
            total_episodes = int(info.get("total_episodes", 0))
        except Exception as exc:
            return JSONResponse({"ok": False, "error": f"Failed to parse info.json: {exc}"}, status_code=500)

        keep_indices: list[int] = []
        for idx, raw in enumerate(keep_indices_raw):
            try:
                keep_indices.append(int(raw))
            except Exception:
                return JSONResponse(
                    {"ok": False, "error": f"keep_indices[{idx}] must be an integer"},
                    status_code=400,
                )

        keep_set = sorted(set(keep_indices))
        invalid = [i for i in keep_set if i < 0 or i >= total_episodes]
        if invalid:
            preview = ", ".join(str(i) for i in invalid[:20])
            return JSONResponse(
                {
                    "ok": False,
                    "error": f"keep_indices out of range [0, {max(0, total_episodes - 1)}]: {preview}",
                },
                status_code=400,
            )
        if len(keep_set) == 0:
            return JSONResponse({"ok": False, "error": "keep_indices must not be empty"}, status_code=400)
        if len(keep_set) >= total_episodes:
            return JSONResponse({"ok": False, "error": "all episodes selected; derive would be identical"}, status_code=400)

        all_indices = list(range(total_episodes))
        delete_indices = [i for i in all_indices if i not in set(keep_set)]

        _cleanup_finished_jobs(jobs_state.derive_jobs_lock, jobs_state.derive_jobs)
        _cleanup_runtime_refs(state)

        job_id = uuid.uuid4().hex[:12]
        now = time.time()
        with jobs_state.derive_jobs_lock:
            jobs_state.derive_jobs[job_id] = {
                "job_id": job_id,
                "status": "queued",
                "phase": "queued",
                "progress": 0,
                "source_repo_id": source_repo_id,
                "new_repo_id": new_repo_id,
                "keep_count": len(keep_set),
                "delete_count": len(delete_indices),
                "started_at": now,
                "updated_at": now,
                "logs": [],
                "error": "",
                "cancel_requested": False,
            }

        def run_derive_job():
            with jobs_state.derive_jobs_lock:
                job = jobs_state.derive_jobs.get(job_id)
                if not job:
                    return
                if bool(job.get("cancel_requested", False)):
                    job["status"] = "cancelled"
                    job["phase"] = "cancelled"
                    job["progress"] = 0
                    job["error"] = "Cancelled by user"
                    job["updated_at"] = time.time()
                    return
                job["status"] = "running"
                job["phase"] = "preparing"
                job["progress"] = 5
                job["updated_at"] = time.time()

            cfg = {
                "source_repo_id": source_repo_id,
                "new_repo_id": new_repo_id,
                "delete_indices": delete_indices,
            }
            cmd = build_derive_args(state.python_exe, cfg)

            proc = None
            try:
                proc = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    bufsize=1,
                )
                with jobs_state.derive_procs_lock:
                    jobs_state.derive_procs[job_id] = proc
            except Exception as exc:
                with jobs_state.derive_jobs_lock:
                    job2 = jobs_state.derive_jobs.get(job_id)
                    if job2:
                        job2["status"] = "error"
                        job2["error"] = str(exc)
                        job2["updated_at"] = time.time()
                return

            progress = 5
            if proc and proc.stdout is not None:
                for raw in proc.stdout:
                    with jobs_state.derive_jobs_lock:
                        job3 = jobs_state.derive_jobs.get(job_id)
                        if not job3:
                            continue
                        if bool(job3.get("cancel_requested", False)):
                            try:
                                proc.terminate()
                            except Exception:
                                pass
                            continue

                    line = raw.rstrip("\n")
                    with jobs_state.derive_jobs_lock:
                        job4 = jobs_state.derive_jobs.get(job_id)
                        if not job4:
                            continue
                        logs = job4["logs"]
                        logs.append(line)
                        if len(logs) > 300:
                            del logs[:-300]
                        job4["phase"] = "processing"
                        m = re.search(r"(\d{1,3})%", line)
                        if m:
                            pct = max(0, min(99, int(m.group(1))))
                            progress = max(progress, pct)
                        else:
                            progress = min(95, progress + 1)
                        job4["progress"] = progress
                        job4["updated_at"] = time.time()

            rc = proc.wait() if proc else -1
            with jobs_state.derive_jobs_lock:
                job5 = jobs_state.derive_jobs.get(job_id)
                if not job5:
                    return
                if bool(job5.get("cancel_requested", False)):
                    job5["status"] = "cancelled"
                    job5["phase"] = "cancelled"
                    job5["progress"] = 0
                    job5["error"] = "Cancelled by user"
                elif rc == 0:
                    job5["status"] = "success"
                    job5["phase"] = "completed"
                    job5["progress"] = 100
                else:
                    job5["status"] = "error"
                    job5["phase"] = "error"
                    if not job5["error"]:
                        tail = "\n".join(job5["logs"][-10:])
                        job5["error"] = tail or f"Process exited with code {rc}"
                job5["updated_at"] = time.time()

            with jobs_state.derive_procs_lock:
                jobs_state.derive_procs.pop(job_id, None)

        threading.Thread(target=run_derive_job, daemon=True).start()
        return {"ok": True, "job_id": job_id}

    @router.get("/api/datasets/derive/status/{job_id}")
    def api_derive_status(job_id: str):
        _cleanup_finished_jobs(jobs_state.derive_jobs_lock, jobs_state.derive_jobs)
        _cleanup_runtime_refs(state)
        with jobs_state.derive_jobs_lock:
            job = jobs_state.derive_jobs.get(job_id)
            if not job:
                return {"ok": False, "error": "Derive job not found"}
            return {"ok": True, **job}

    @router.post("/api/datasets/derive/cancel/{job_id}")
    def api_derive_cancel(job_id: str):
        with jobs_state.derive_jobs_lock:
            job = jobs_state.derive_jobs.get(job_id)
            if not job:
                return {"ok": False, "error": "Derive job not found"}

            status = str(job.get("status", ""))
            if status in TERMINAL_JOB_STATUS:
                return {"ok": False, "error": f"Job already finished ({status})"}

            job["cancel_requested"] = True
            if status == "queued":
                job["status"] = "cancelled"
                job["phase"] = "cancelled"
                job["progress"] = 0
                job["error"] = "Cancelled by user"
            job["updated_at"] = time.time()

        with jobs_state.derive_procs_lock:
            proc = jobs_state.derive_procs.get(job_id)
            if proc is not None:
                try:
                    proc.terminate()
                except Exception:
                    pass
        return {"ok": True, "job_id": job_id}
