"""Dataset listing and local inspection routes."""

from __future__ import annotations

import datetime
import json
import shutil
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from starlette.responses import Response

from lestudio import path_policy

from .._state import AppState


def _discover_parquet_files(source_path: Path) -> list[Path]:
    data_dir = source_path / "data"
    if not data_dir.exists():
        return []
    return sorted(data_dir.glob("**/*.parquet"))


def register_routes(router: APIRouter, state: AppState):
    _ = state

    # ─── Dataset List / Info ───────────────────────────────────────────────────
    @router.get("/api/datasets")
    def api_datasets_list():
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
                    if info_path.exists():
                        try:
                            info = json.loads(info_path.read_text())
                            mtime = info_path.stat().st_mtime
                            mdate = datetime.datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M:%S")
                            # Always compute real size on disk — info.json size
                            # fields are unreliable placeholders in lerobot v3.
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
                            pass
        datasets.sort(key=lambda x: x["timestamp"], reverse=True)
        return {"datasets": datasets}

    @router.get("/api/datasets/{user}/{repo}")
    def api_dataset_info(user: str, repo: str):
        repo_id = f"{user}/{repo}"
        base = path_policy.dataset_local_dir(repo_id)
        info_path = base / "meta" / "info.json"

        if not info_path.exists():
            return JSONResponse(status_code=404, content={"detail": "Dataset not found"})

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
        except Exception as e:
            return JSONResponse(status_code=500, content={"detail": f"Failed to load dataset: {str(e)}"})

    @router.get("/api/datasets/{user}/{repo}/videos/{camera}/{chunk}/{file}")
    def api_dataset_video(request: Request, user: str, repo: str, camera: str, chunk: str, file: str):
        # Serve MP4 with HTTP 206 Range support so browser <video> can seek freely
        video_path = path_policy.dataset_video_path(user, repo, camera, chunk, file)
        if not video_path.exists():
            return Response(status_code=404, content="Video not found")
        file_size = video_path.stat().st_size
        range_header = request.headers.get("range")
        return _serve_video_file(video_path, file_size, range_header=range_header)

    @router.delete("/api/datasets/{user}/{repo}")
    def api_dataset_delete(user: str, repo: str):
        base = path_policy.dataset_local_dir(f"{user}/{repo}")
        if not base.exists():
            return JSONResponse(status_code=404, content={"detail": "Dataset not found"})
        try:
            shutil.rmtree(base)
            return {"ok": True}
        except Exception as e:
            return JSONResponse(status_code=500, content={"detail": f"Failed to delete dataset: {str(e)}"})

    @router.get("/api/datasets/{user}/{repo}/quality")
    def api_dataset_quality(user: str, repo: str):
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
        except Exception as e:
            return {"ok": False, "error": f"Failed to parse info.json: {e}"}

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
            except Exception as e:
                add_check("warn", "episodes", f"Could not parse episode parquet files: {e}", "episodes")

        actual_episodes = len(episodes)
        if total_expected > 0 and actual_episodes > 0 and actual_episodes != total_expected:
            add_check(
                "warn", "episode_count", f"Expected {total_expected} episodes, found {actual_episodes}", "episodes"
            )
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


def _serve_video_file(video_path: Path, file_size: int, range_header: str | None):
    """Serve a video file with optional HTTP 206 Range support."""
    from fastapi.responses import FileResponse
    from fastapi.responses import StreamingResponse
    from starlette.responses import Response

    if range_header:
        try:
            range_val = range_header.strip().lower().replace("bytes=", "")
            start_str, end_str = range_val.split("-", 1)
            start = int(start_str) if start_str else 0
            end = int(end_str) if end_str else file_size - 1
        except Exception:
            return Response(status_code=416, headers={"Content-Range": f"bytes */{file_size}"})
        start = max(0, min(start, file_size - 1))
        end = max(start, min(end, file_size - 1))
        chunk_size = end - start + 1

        def _iter_file(path: Path, s: int, length: int, buf: int = 1 << 20):
            with open(path, "rb") as fh:
                fh.seek(s)
                remaining = length
                while remaining > 0:
                    data = fh.read(min(buf, remaining))
                    if not data:
                        break
                    remaining -= len(data)
                    yield data

        headers = {
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Accept-Ranges": "bytes",
            "Content-Length": str(chunk_size),
            "Content-Type": "video/mp4",
        }
        return StreamingResponse(
            _iter_file(video_path, start, chunk_size),
            status_code=206,
            headers=headers,
            media_type="video/mp4",
        )
    return FileResponse(video_path, media_type="video/mp4", headers={"Accept-Ranges": "bytes"})
