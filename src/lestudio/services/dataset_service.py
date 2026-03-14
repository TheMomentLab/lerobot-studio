from __future__ import annotations

import datetime
import hashlib
import json
import os
import re
import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path
from collections.abc import Sequence
from typing import Any

from .. import path_policy
from ..command_builders import build_derive_args
from ..lib.async_job_manager import TERMINAL_JOB_STATUS, _cleanup_finished_jobs
from ..routes._state import DatasetJobState

VALID_TAGS = {"good", "bad", "review", "untagged"}

_WHOAMI_CACHE: dict[str, object] = {}


def discover_parquet_files(source_path: Path) -> list[Path]:
    data_dir = source_path / "data"
    if not data_dir.exists():
        return []
    return sorted(data_dir.glob("**/*.parquet"))


def list_local_datasets() -> dict[str, Any]:
    base = path_policy.lerobot_cache_root()
    datasets = []
    if base.exists():
        for user_dir in base.iterdir():
            if not user_dir.is_dir():
                continue
            for ds_dir in user_dir.iterdir():
                if not ds_dir.is_dir():
                    continue
                info_path = ds_dir / "meta" / "info.json"
                if not info_path.exists():
                    continue
                try:
                    info = json.loads(info_path.read_text())
                    mtime = info_path.stat().st_mtime
                    mdate = datetime.datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M:%S")
                    try:
                        total_bytes = sum(f.stat().st_size for f in ds_dir.rglob("*") if f.is_file())
                        size_mb = round(total_bytes / (1024 * 1024), 1)
                    except Exception:
                        size_mb = 0.0
                    datasets.append(
                        {
                            "id": f"{user_dir.name}/{ds_dir.name}",
                            "total_episodes": info.get("total_episodes", 0),
                            "total_frames": info.get("total_frames", 0),
                            "fps": info.get("fps", 30),
                            "modified": mdate,
                            "timestamp": mtime,
                            "size_mb": size_mb,
                        }
                    )
                except Exception:
                    continue
    datasets.sort(key=lambda x: x["timestamp"], reverse=True)
    return {"datasets": datasets}


def get_dataset_info(user: str, repo: str) -> dict[str, Any]:
    repo_id = f"{user}/{repo}"
    base = path_policy.dataset_local_dir(repo_id)
    info_path = base / "meta" / "info.json"

    if not info_path.exists():
        return {"ok": False, "status_code": 404, "detail": "Dataset not found"}

    try:
        info = json.loads(info_path.read_text())
        cameras = [k for k, v in info.get("features", {}).items() if v.get("dtype") == "video"]

        episodes = []
        episodes_dir = base / "meta" / "episodes"
        if episodes_dir.exists():
            try:
                pd = __import__("pandas")

                rows = []
                for pq_path in sorted(episodes_dir.glob("**/*.parquet")):
                    try:
                        base_cols = ["episode_index", "length", "tasks"]
                        video_cols = []
                        for cam in cameras:
                            video_cols.append(f"videos/{cam}/chunk_index")
                            video_cols.append(f"videos/{cam}/file_index")
                            video_cols.append(f"videos/{cam}/from_timestamp")
                            video_cols.append(f"videos/{cam}/to_timestamp")
                        try:
                            df = pd.read_parquet(pq_path, columns=base_cols + video_cols)
                        except Exception:
                            df = pd.read_parquet(pq_path)
                        for _, row in df.iterrows():
                            tasks = row.get("tasks", [])
                            if tasks is None:
                                tasks = []
                            elif not isinstance(tasks, list):
                                tasks = list(tasks)
                            length_value = row.get(
                                "length",
                                row.get("episode_length", row.get("num_frames", row.get("frame_count", 0))),
                            )
                            if length_value is None or pd.isna(length_value):
                                length_value = 0
                            episode_index_value = row.get("episode_index", row.get("episode_id", 0))
                            if episode_index_value is None or pd.isna(episode_index_value):
                                episode_index_value = 0
                            video_files = {}
                            for cam in cameras:
                                chunk_key = f"videos/{cam}/chunk_index"
                                file_key = f"videos/{cam}/file_index"
                                from_key = f"videos/{cam}/from_timestamp"
                                to_key = f"videos/{cam}/to_timestamp"
                                if chunk_key in row and file_key in row:
                                    chunk_val = row.get(chunk_key)
                                    file_val = row.get(file_key)
                                    if not pd.isna(chunk_val) and not pd.isna(file_val):
                                        from_val = row.get(from_key) if from_key in row else None
                                        to_val = row.get(to_key) if to_key in row else None
                                        video_files[cam] = {
                                            "chunk_index": int(chunk_val),
                                            "file_index": int(file_val),
                                            "from_timestamp": None
                                            if from_val is None or pd.isna(from_val)
                                            else float(from_val),
                                            "to_timestamp": None
                                            if to_val is None or pd.isna(to_val)
                                            else float(to_val),
                                        }
                            rows.append(
                                {
                                    "episode_index": int(episode_index_value),
                                    "length": int(length_value),
                                    "tasks": tasks,
                                    "video_files": video_files,
                                }
                            )
                    except Exception:
                        continue

                rows.sort(key=lambda x: x["episode_index"])
                episodes = rows
            except Exception:
                episodes = []

        if not episodes:
            for ep_idx in range(info.get("total_episodes", 0)):
                episodes.append(
                    {
                        "episode_index": ep_idx,
                        "length": 0,
                        "tasks": [],
                        "video_files": {},
                    }
                )

        features = info.get("features", {})
        camera_details = []
        joint_names = []
        for key, feat in features.items():
            if feat.get("dtype") == "video" and key.startswith("observation.images."):
                cam_name = key.replace("observation.images.", "")
                cam_info = feat.get("info", {})
                camera_details.append(
                    {
                        "name": cam_name,
                        "width": cam_info.get("video.width"),
                        "height": cam_info.get("video.height"),
                        "fps": cam_info.get("video.fps"),
                        "codec": cam_info.get("video.codec"),
                    }
                )
            if key == "action" and isinstance(feat.get("names"), list):
                joint_names = feat["names"]

        return {
            "ok": True,
            "dataset_id": repo_id,
            "total_episodes": info.get("total_episodes", 0),
            "total_frames": info.get("total_frames", 0),
            "fps": info.get("fps", 30),
            "cameras": cameras,
            "episodes": episodes,
            "robot_type": info.get("robot_type", ""),
            "camera_details": camera_details,
            "joint_names": joint_names,
        }
    except Exception as exc:
        return {"ok": False, "status_code": 500, "detail": f"Failed to load dataset: {exc}"}


def resolve_dataset_video(user: str, repo: str, camera: str, chunk: str, file: str) -> dict[str, Any]:
    video_path = path_policy.dataset_video_path(user, repo, camera, chunk, file)
    if not video_path.exists():
        return {"ok": False, "status_code": 404, "error": "Video not found"}
    return {"ok": True, "video_path": video_path, "file_size": video_path.stat().st_size}


def build_video_range_plan(file_size: int, range_header: str | None) -> dict[str, Any]:
    if not range_header:
        return {"ok": True, "partial": False}
    try:
        range_val = range_header.strip().lower().replace("bytes=", "")
        start_str, end_str = range_val.split("-", 1)
        start = int(start_str) if start_str else 0
        end = int(end_str) if end_str else file_size - 1
    except Exception:
        return {
            "ok": False,
            "status_code": 416,
            "headers": {"Content-Range": f"bytes */{file_size}"},
        }
    start = max(0, min(start, file_size - 1))
    end = max(start, min(end, file_size - 1))
    chunk_size = end - start + 1
    headers = {
        "Content-Range": f"bytes {start}-{end}/{file_size}",
        "Accept-Ranges": "bytes",
        "Content-Length": str(chunk_size),
        "Content-Type": "video/mp4",
    }
    return {
        "ok": True,
        "partial": True,
        "start": start,
        "end": end,
        "chunk_size": chunk_size,
        "headers": headers,
    }


def iter_video_file(path: Path, start: int, length: int, buf: int = 1 << 20):
    with open(path, "rb") as fh:
        fh.seek(start)
        remaining = length
        while remaining > 0:
            data = fh.read(min(buf, remaining))
            if not data:
                break
            remaining -= len(data)
            yield data


def delete_dataset(user: str, repo: str) -> dict[str, Any]:
    base = path_policy.dataset_local_dir(f"{user}/{repo}")
    if not base.exists():
        return {"ok": False, "status_code": 404, "detail": "Dataset not found"}
    try:
        shutil.rmtree(base)
        return {"ok": True}
    except Exception as exc:
        return {"ok": False, "status_code": 500, "detail": f"Failed to delete dataset: {exc}"}


def check_dataset_quality(user: str, repo: str) -> dict[str, Any]:
    base = path_policy.dataset_local_dir(f"{user}/{repo}")
    info_path = base / "meta" / "info.json"
    if not info_path.exists():
        return {"ok": False, "error": "Dataset not found"}

    checks = []
    score = 100
    category_weight = {
        "metadata": 1.2,
        "episodes": 1.1,
        "videos": 1.4,
        "distribution": 0.8,
        "general": 1.0,
    }
    category_penalty: dict[str, int] = {k: 0 for k in category_weight.keys()}

    def add_check(level: str, name: str, message: str, category: str = "general"):
        nonlocal score
        cat = category if category in category_weight else "general"
        checks.append({"level": level, "name": name, "message": message, "category": cat})
        base_val = 0
        if level == "error":
            base_val = 20
        elif level == "warn":
            base_val = 8
        if base_val > 0:
            penalty = int(round(base_val * category_weight[cat]))
            category_penalty[cat] += penalty
            score -= penalty

    try:
        info = json.loads(info_path.read_text())
    except Exception as exc:
        return {"ok": False, "error": f"Failed to parse info.json: {exc}"}

    total_expected = int(info.get("total_episodes", 0) or 0)
    total_frames = int(info.get("total_frames", 0) or 0)
    fps = int(info.get("fps", 0) or 0)
    if fps <= 0:
        add_check("error", "fps", "FPS in info.json is invalid or missing", "metadata")
    elif fps < 5:
        add_check("warn", "fps", f"FPS is low ({fps})", "metadata")
    else:
        add_check("ok", "fps", f"FPS looks valid ({fps})", "metadata")

    cameras = [k for k, v in info.get("features", {}).items() if isinstance(v, dict) and v.get("dtype") == "video"]
    if not cameras:
        add_check("warn", "cameras", "No video camera features found in dataset metadata", "metadata")
    else:
        add_check("ok", "cameras", f"Detected {len(cameras)} camera streams", "metadata")

    episodes = []
    episodes_dir = base / "meta" / "episodes"
    if episodes_dir.exists():
        try:
            pd = __import__("pandas")
            for pq_path in sorted(episodes_dir.glob("**/*.parquet")):
                try:
                    df = pd.read_parquet(pq_path, columns=["episode_index", "length"])
                except Exception:
                    try:
                        df = pd.read_parquet(pq_path, columns=["episode_index", "episode_length"])
                    except Exception:
                        df = pd.read_parquet(pq_path)
                for _, row in df.iterrows():
                    length_value = row.get(
                        "length", row.get("episode_length", row.get("num_frames", row.get("frame_count", 0)))
                    )
                    if length_value is None or pd.isna(length_value):
                        length_value = 0
                    episode_index_value = row.get("episode_index", row.get("episode_id", 0))
                    if episode_index_value is None or pd.isna(episode_index_value):
                        episode_index_value = 0
                    episodes.append(
                        {
                            "episode_index": int(episode_index_value),
                            "length": int(length_value),
                        }
                    )
        except Exception as exc:
            add_check("warn", "episodes", f"Could not parse episode parquet files: {exc}", "episodes")

    actual_episodes = len(episodes)
    if total_expected > 0 and actual_episodes > 0 and actual_episodes != total_expected:
        add_check("warn", "episode_count", f"Expected {total_expected} episodes, found {actual_episodes}", "episodes")
    else:
        add_check("ok", "episode_count", f"Episode count: {max(total_expected, actual_episodes)}", "episodes")

    non_positive_lengths = [ep for ep in episodes if ep["length"] <= 0]
    if non_positive_lengths:
        add_check(
            "warn",
            "episode_length_zero",
            f"Episodes with non-positive length: {len(non_positive_lengths)}",
            "episodes",
        )

    zero_byte_videos = 0
    total_videos = 0
    per_camera_files: dict[str, int] = {cam: 0 for cam in cameras}
    videos_root = base / "videos"
    if videos_root.exists():
        for p in videos_root.rglob("*.mp4"):
            total_videos += 1
            parts = p.parts
            if "videos" in parts:
                idx = parts.index("videos")
                if idx + 1 < len(parts):
                    cam_name = parts[idx + 1]
                    per_camera_files[cam_name] = per_camera_files.get(cam_name, 0) + 1
            try:
                if p.stat().st_size == 0:
                    zero_byte_videos += 1
            except Exception:
                zero_byte_videos += 1

    if total_videos == 0:
        add_check("warn", "videos", "No video files found under videos/", "videos")
    elif zero_byte_videos > 0:
        add_check("warn", "videos", f"Found {zero_byte_videos} zero-byte/corrupt candidate video files", "videos")
    else:
        add_check("ok", "videos", f"Video files present: {total_videos}", "videos")

    missing_camera_files = [cam for cam, cnt in per_camera_files.items() if cnt <= 0]
    if cameras and missing_camera_files:
        add_check(
            "warn",
            "camera_coverage",
            f"Cameras without any video files: {', '.join(missing_camera_files)}",
            "videos",
        )
    elif cameras:
        add_check("ok", "camera_coverage", "All camera streams have video files", "videos")

    avg_ep_len = 0
    median_ep_len = 0
    if episodes:
        lengths = sorted(ep["length"] for ep in episodes)
        avg_ep_len = round(sum(lengths) / max(1, len(lengths)), 2)
        mid = len(lengths) // 2
        if len(lengths) % 2 == 0:
            median_ep_len = round((lengths[mid - 1] + lengths[mid]) / 2, 2)
        else:
            median_ep_len = round(lengths[mid], 2)
        if avg_ep_len <= 1:
            add_check("warn", "episode_length", "Average episode length is very short", "distribution")
        else:
            add_check("ok", "episode_length", f"Average episode length: {avg_ep_len} frames", "distribution")

        if median_ep_len > 0:
            ratio = avg_ep_len / max(1e-6, median_ep_len)
            if ratio > 2.5 or ratio < 0.4:
                add_check(
                    "warn", "episode_length_distribution", "Episode lengths are highly imbalanced", "distribution"
                )
            else:
                add_check(
                    "ok",
                    "episode_length_distribution",
                    "Episode length distribution looks reasonable",
                    "distribution",
                )

    if total_frames <= 0:
        add_check("warn", "total_frames", "Total frame count is zero or missing", "metadata")
    else:
        add_check("ok", "total_frames", f"Total frames: {total_frames}", "metadata")

    score = max(0, min(100, score))
    has_error = any(c["level"] == "error" for c in checks)
    return {
        "ok": not has_error,
        "score": score,
        "checks": checks,
        "score_breakdown": category_penalty,
        "stats": {
            "dataset_id": f"{user}/{repo}",
            "total_expected_episodes": total_expected,
            "total_detected_episodes": actual_episodes,
            "total_frames": total_frames,
            "fps": fps,
            "camera_count": len(cameras),
            "camera_file_counts": per_camera_files,
            "video_files": total_videos,
            "zero_byte_videos": zero_byte_videos,
            "avg_episode_length": avg_ep_len,
            "median_episode_length": median_ep_len,
            "non_positive_episode_count": len(non_positive_lengths),
        },
    }


def resolve_hf_token(token_file: Path) -> tuple[str, str]:
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


def mask_token(token: str) -> str:
    if not token:
        return ""
    if len(token) <= 8:
        return "*" * len(token)
    return f"{token[:4]}...{token[-4:]}"


def start_dataset_push_job(
    jobs_state: DatasetJobState,
    token_file: Path,
    user: str,
    repo: str,
    payload: dict[str, object],
) -> dict[str, Any]:
    local_path = path_policy.dataset_local_dir(f"{user}/{repo}")
    if not local_path.exists():
        return {"ok": False, "error": "Dataset not found in local cache"}

    target_repo_id = str(payload.get("target_repo_id", f"{user}/{repo}")).strip() or f"{user}/{repo}"
    private = bool(payload.get("private", False))

    token, _ = resolve_hf_token(token_file)
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
        except Exception as exc:
            with jobs_state.push_jobs_lock:
                jobs_state.push_jobs[job_id]["status"] = "error"
                jobs_state.push_jobs[job_id]["error"] = str(exc)
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


def get_push_job_status(jobs_state: DatasetJobState, job_id: str) -> dict[str, Any]:
    _cleanup_finished_jobs(jobs_state.push_jobs_lock, jobs_state.push_jobs)
    with jobs_state.push_jobs_lock:
        job = jobs_state.push_jobs.get(job_id)
        if not job:
            return {"ok": False, "error": "Push job not found"}
        return {"ok": True, **job}


def get_hf_token_status(token_file: Path) -> dict[str, Any]:
    token, source = resolve_hf_token(token_file)
    return {
        "ok": True,
        "has_token": bool(token),
        "source": source,
        "masked_token": mask_token(token),
    }


def set_hf_token(token_file: Path, token: str) -> dict[str, Any]:
    token_value = token.strip()
    if not token_value:
        return {"ok": False, "error": "token is required"}
    try:
        token_file.parent.mkdir(parents=True, exist_ok=True)
        token_file.write_text(token_value)
        try:
            os.chmod(token_file, 0o600)
        except Exception:
            pass
        os.environ["HF_TOKEN"] = token_value
        os.environ["HUGGINGFACE_HUB_TOKEN"] = token_value
        _WHOAMI_CACHE.clear()
        return {"ok": True, "has_token": True, "source": "env"}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def clear_hf_token(token_file: Path) -> dict[str, Any]:
    os.environ.pop("HF_TOKEN", None)
    os.environ.pop("HUGGINGFACE_HUB_TOKEN", None)
    try:
        if token_file.exists():
            token_file.unlink()
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
    _WHOAMI_CACHE.clear()
    return {"ok": True, "has_token": False, "source": "none"}


def hf_whoami(token_file: Path) -> dict[str, Any]:
    token, _ = resolve_hf_token(token_file)
    if not token:
        _WHOAMI_CACHE.clear()
        return {"ok": False, "username": None, "error": "no_token"}

    cached = _WHOAMI_CACHE.get("result")
    expires_raw = _WHOAMI_CACHE.get("expires", 0.0)
    expires = float(expires_raw) if isinstance(expires_raw, (int, float)) else 0.0
    token_cached = _WHOAMI_CACHE.get("token")
    if cached and time.monotonic() < expires and isinstance(token_cached, str) and token_cached == token:
        if isinstance(cached, dict):
            return dict(cached)

    try:
        hub_mod = __import__("huggingface_hub")
        whoami = getattr(hub_mod, "whoami")
        info = whoami(token=token)
        username = info.get("name", None) if isinstance(info, dict) else None
        if not username:
            return {"ok": False, "username": None, "error": "no_username"}
        result = {"ok": True, "username": username}
        _WHOAMI_CACHE["result"] = result
        _WHOAMI_CACHE["expires"] = time.monotonic() + 300.0
        _WHOAMI_CACHE["token"] = token
        return result
    except ImportError:
        return {"ok": False, "username": None, "error": "huggingface_hub_not_installed"}
    except Exception as exc:
        status_code: int | None = None
        response = getattr(exc, "response", None)
        msg = str(exc).lower()
        if response is not None:
            status_raw = getattr(response, "status_code", None)
            if isinstance(status_raw, int):
                status_code = status_raw

        if status_code in (401, 403):
            if "expired" in msg or "expiration" in msg or "has expired" in msg:
                return {"ok": False, "username": None, "error": "expired_token"}
            return {"ok": False, "username": None, "error": "invalid_token"}

        if "401" in msg or "403" in msg or "unauthorized" in msg or "forbidden" in msg or "invalid token" in msg:
            if "expired" in msg or "expiration" in msg or "has expired" in msg:
                return {"ok": False, "username": None, "error": "expired_token"}
            return {"ok": False, "username": None, "error": "invalid_token"}

        if (
            "timed out" in msg
            or "timeout" in msg
            or "connection" in msg
            or "network" in msg
            or "temporary failure" in msg
            or "name resolution" in msg
            or "503" in msg
            or "502" in msg
            or "504" in msg
        ):
            return {"ok": False, "username": None, "error": "network_error"}

        return {"ok": False, "username": None, "error": "auth_failed"}


def hf_my_datasets(token_file: Path, limit: int = 50) -> dict[str, Any]:
    token, _ = resolve_hf_token(token_file)
    if not token:
        return {"ok": False, "error": "no_token", "datasets": []}

    try:
        hub_mod = __import__("huggingface_hub")
        whoami = getattr(hub_mod, "whoami")
        list_datasets = getattr(hub_mod, "list_datasets")
    except ImportError:
        return {"ok": False, "error": "huggingface_hub is not installed", "datasets": []}

    try:
        info = whoami(token=token)
        username = info.get("name") if isinstance(info, dict) else None
        if not username:
            return {"ok": False, "error": "no_username", "datasets": []}
    except Exception as exc:
        return {"ok": False, "error": str(exc), "datasets": []}

    local_root = path_policy.lerobot_cache_root()
    limit = max(1, min(limit, 200))
    try:
        results = []
        for ds in list_datasets(author=username, limit=limit, full=False):
            repo_id = ds.id
            local_path = local_root / repo_id
            local_sync = local_path.exists()
            size_str = ""
            if local_sync:
                try:
                    total_bytes = sum(f.stat().st_size for f in local_path.rglob("*") if f.is_file())
                    if total_bytes >= 1_073_741_824:
                        size_str = f"{total_bytes / 1_073_741_824:.1f} GB"
                    elif total_bytes >= 1_048_576:
                        size_str = f"{total_bytes / 1_048_576:.0f} MB"
                    else:
                        size_str = f"{total_bytes / 1024:.0f} KB"
                except Exception:
                    size_str = ""
            last_mod = getattr(ds, "last_modified", None)
            modified_str = str(last_mod)[:10] if last_mod else ""
            results.append(
                {
                    "id": repo_id,
                    "downloads": getattr(ds, "downloads", 0) or 0,
                    "likes": getattr(ds, "likes", 0) or 0,
                    "size": size_str,
                    "modified": modified_str,
                    "local_sync": local_sync,
                }
            )
        return {"ok": True, "username": username, "datasets": results}
    except Exception as exc:
        return {"ok": False, "error": str(exc), "datasets": []}


def hub_search_datasets(query: str = "", limit: int = 20, tag: str = "lerobot") -> dict[str, Any]:
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
    except Exception as exc:
        return {"ok": False, "error": str(exc), "datasets": []}


def start_hub_download_job(jobs_state: DatasetJobState, repo_id: str) -> dict[str, Any]:
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
            local_dir = path_policy.dataset_local_dir(repo_id)
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

        except Exception as exc:
            with jobs_state.download_jobs_lock:
                job4 = jobs_state.download_jobs.get(job_id)
                if job4:
                    job4["status"] = "error"
                    job4["error"] = str(exc)
                    job4["updated_at"] = time.time()

    threading.Thread(target=run_download_job, daemon=True).start()
    return {"ok": True, "job_id": job_id}


def get_hub_download_status(jobs_state: DatasetJobState, job_id: str) -> dict[str, Any]:
    _cleanup_finished_jobs(jobs_state.download_jobs_lock, jobs_state.download_jobs)
    with jobs_state.download_jobs_lock:
        job = jobs_state.download_jobs.get(job_id)
        if not job:
            return {"ok": False, "error": "Download job not found"}
        return {"ok": True, **job}


def tags_file_path(config_dir: Path, user: str, repo: str) -> Path:
    tags_dir = config_dir / "episode-tags"
    return tags_dir / f"{user}_{repo}.json"


def load_tags(tags_file: Path) -> dict[str, str]:
    if tags_file.exists():
        try:
            loaded = json.loads(tags_file.read_text())
            if isinstance(loaded, dict):
                return {str(k): str(v) for k, v in loaded.items()}
        except Exception:
            pass
    return {}


def save_tags(tags_file: Path, tags: dict[str, str]) -> None:
    tags_file.parent.mkdir(parents=True, exist_ok=True)
    tags_file.write_text(json.dumps(tags, indent=2))


def get_episode_tags(config_dir: Path, user: str, repo: str) -> dict[str, Any]:
    tags_file = tags_file_path(config_dir, user, repo)
    tags = load_tags(tags_file)
    return {"ok": True, "tags": tags}


def set_episode_tag(config_dir: Path, user: str, repo: str, episode_raw: Any, tag_raw: Any) -> dict[str, Any]:
    tag = str(tag_raw if tag_raw is not None else "untagged")
    if tag not in VALID_TAGS:
        return {"ok": False, "error": f"Invalid tag. Must be one of: {', '.join(sorted(VALID_TAGS))}"}
    try:
        episode_index_int = int(str(episode_raw))
    except Exception:
        return {"ok": False, "error": "episode_index is required"}
    if episode_index_int < 0:
        return {"ok": False, "error": "episode_index must be >= 0"}

    episode_index = str(episode_index_int)
    tags_file = tags_file_path(config_dir, user, repo)
    tags = load_tags(tags_file)
    if tag == "untagged":
        tags.pop(episode_index, None)
    else:
        tags[episode_index] = tag
    save_tags(tags_file, tags)
    return {"ok": True, "episode_index": episode_index, "tag": tag}


def bulk_set_episode_tags(config_dir: Path, user: str, repo: str, updates_raw: Any) -> dict[str, Any]:
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
            ep_idx = int(str(ep_raw))
        except Exception:
            return {"ok": False, "error": f"updates[{idx}].episode_index must be an integer"}
        if ep_idx < 0:
            return {"ok": False, "error": f"updates[{idx}].episode_index must be >= 0"}
        normalized.append((str(ep_idx), tag))

    tags_file = tags_file_path(config_dir, user, repo)
    tags = load_tags(tags_file)
    for ep_key, tag in normalized:
        if tag == "untagged":
            tags.pop(ep_key, None)
        else:
            tags[ep_key] = tag

    save_tags(tags_file, tags)
    return {"ok": True, "applied": len(normalized)}


def compute_stats_signature(source_path: Path, info_path: Path, pq_files: list[Path]) -> str:
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


def compute_episode_stats(
    source_path: Path,
    cancel_event: threading.Event | None = None,
    progress_cb=None,
) -> dict[str, Any]:
    pd = __import__("pandas")
    np = __import__("numpy")

    pq_files = discover_parquet_files(source_path)
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


def get_episode_stats(user: str, repo: str) -> dict[str, Any]:
    source_path = path_policy.dataset_local_dir(f"{user}/{repo}")
    info_path = source_path / "meta" / "info.json"
    if not info_path.exists():
        return {"ok": False, "status_code": 404, "error": "Dataset not found locally"}

    pq_files = discover_parquet_files(source_path)
    if not pq_files:
        return {"ok": False, "status_code": 404, "error": "No parquet files found"}

    cache_file = source_path / ".lestudio_ep_stats.json"
    signature = compute_stats_signature(source_path, info_path, pq_files)
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
        result = compute_episode_stats(source_path)
    except Exception as exc:
        return {"ok": False, "status_code": 500, "error": f"Failed to compute stats: {exc}"}

    payload = {"cache_signature": signature, **result}
    try:
        cache_file.write_text(json.dumps(payload))
    except Exception:
        pass

    return {"ok": True, "cached": False, **result}


def _cleanup_runtime_refs(jobs_state: DatasetJobState) -> None:
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


def start_episode_stats_recompute_job(
    jobs_state: DatasetJobState,
    user: str,
    repo: str,
    force: bool,
) -> dict[str, Any]:
    dataset_id = f"{user}/{repo}"
    source_path = path_policy.dataset_local_dir(dataset_id)
    info_path = source_path / "meta" / "info.json"
    if not info_path.exists():
        return {"ok": False, "status_code": 404, "error": "Dataset not found locally"}

    pq_files = discover_parquet_files(source_path)
    if not pq_files:
        return {"ok": False, "status_code": 404, "error": "No parquet files found"}

    cache_file = source_path / ".lestudio_ep_stats.json"
    signature = compute_stats_signature(source_path, info_path, pq_files)

    if not force and cache_file.exists():
        try:
            cached = json.loads(cache_file.read_text())
            if cached.get("cache_signature") == signature:
                return {"ok": True, "status": "ready", "cached": True, "job_id": ""}
        except Exception:
            pass

    _cleanup_finished_jobs(jobs_state.stats_jobs_lock, jobs_state.stats_jobs)
    _cleanup_runtime_refs(jobs_state)

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
            result = compute_episode_stats(source_path, cancel_event=cancel_event, progress_cb=on_progress)
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


def get_episode_stats_job_status(jobs_state: DatasetJobState, job_id: str) -> dict[str, Any]:
    _cleanup_finished_jobs(jobs_state.stats_jobs_lock, jobs_state.stats_jobs)
    _cleanup_runtime_refs(jobs_state)
    with jobs_state.stats_jobs_lock:
        job = jobs_state.stats_jobs.get(job_id)
        if not job:
            return {"ok": False, "error": "Stats job not found"}
        return {"ok": True, **job}


def cancel_episode_stats_job(jobs_state: DatasetJobState, job_id: str) -> dict[str, Any]:
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


def start_derive_dataset_job(
    jobs_state: DatasetJobState,
    python_exe: str,
    user: str,
    repo: str,
    new_repo_id: str,
    keep_indices_raw: object,
) -> dict[str, Any]:
    if not new_repo_id:
        return {"ok": False, "status_code": 400, "error": "new_repo_id is required"}
    if not re.match(r"^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$", new_repo_id):
        return {"ok": False, "status_code": 400, "error": "new_repo_id must be user/repo format"}
    if not isinstance(keep_indices_raw, list) or len(keep_indices_raw) == 0:
        return {"ok": False, "status_code": 400, "error": "keep_indices must be a non-empty array"}

    source_repo_id = f"{user}/{repo}"
    if source_repo_id == new_repo_id:
        return {"ok": False, "status_code": 400, "error": "new_repo_id must differ from source repo"}

    source_path = path_policy.dataset_local_dir(source_repo_id)
    info_path = source_path / "meta" / "info.json"
    if not info_path.exists():
        return {"ok": False, "status_code": 404, "error": f"Dataset {source_repo_id} not found locally"}

    try:
        info = json.loads(info_path.read_text())
        total_episodes = int(info.get("total_episodes", 0))
    except Exception as exc:
        return {"ok": False, "status_code": 500, "error": f"Failed to parse info.json: {exc}"}

    keep_indices: list[int] = []
    for idx, raw in enumerate(keep_indices_raw):
        try:
            keep_indices.append(int(str(raw)))
        except Exception:
            return {"ok": False, "status_code": 400, "error": f"keep_indices[{idx}] must be an integer"}

    keep_set = sorted(set(keep_indices))
    invalid = [i for i in keep_set if i < 0 or i >= total_episodes]
    if invalid:
        preview = ", ".join(str(i) for i in invalid[:20])
        return {
            "ok": False,
            "status_code": 400,
            "error": f"keep_indices out of range [0, {max(0, total_episodes - 1)}]: {preview}",
        }
    if len(keep_set) == 0:
        return {"ok": False, "status_code": 400, "error": "keep_indices must not be empty"}
    if len(keep_set) >= total_episodes:
        return {"ok": False, "status_code": 400, "error": "all episodes selected; derive would be identical"}

    all_indices = list(range(total_episodes))
    keep_lookup = set(keep_set)
    delete_indices = [i for i in all_indices if i not in keep_lookup]

    _cleanup_finished_jobs(jobs_state.derive_jobs_lock, jobs_state.derive_jobs)
    _cleanup_runtime_refs(jobs_state)

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
        cmd = build_derive_args(python_exe, cfg)

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


def get_derive_job_status(jobs_state: DatasetJobState, job_id: str) -> dict[str, Any]:
    _cleanup_finished_jobs(jobs_state.derive_jobs_lock, jobs_state.derive_jobs)
    _cleanup_runtime_refs(jobs_state)
    with jobs_state.derive_jobs_lock:
        job = jobs_state.derive_jobs.get(job_id)
        if not job:
            return {"ok": False, "error": "Derive job not found"}
        return {"ok": True, **job}


def cancel_derive_job(jobs_state: DatasetJobState, job_id: str) -> dict[str, Any]:
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
