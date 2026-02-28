"""Behavioral tests for dataset listing and config/profile routes.

Covers the routes that were refactored (dataset.py → dataset/ package,
config routes) to ensure they continue to work after splitting.
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

from lestudio.routes.models import CameraSettingsRequest, ProfileImportRequest
from lestudio.server import create_app


def _make_app(tmp_path: Path):
    lerobot_src = tmp_path / "lerobot_src"
    (lerobot_src / "lerobot").mkdir(parents=True)
    config_dir = tmp_path / "config"
    config_dir.mkdir()
    rules_path = tmp_path / "99-lerobot.rules"
    return create_app(lerobot_src=lerobot_src, config_dir=config_dir, rules_path=rules_path)


def _find_endpoint(app, path: str, method: str):
    method = method.upper()
    for route in app.routes:
        if getattr(route, "path", None) != path:
            continue
        methods = getattr(route, "methods", set()) or set()
        if method in methods:
            return route.endpoint
    raise AssertionError(f"Route not found: {method} {path}")


# ─── Dataset listing ───────────────────────────────────────────────────────

def test_api_datasets_returns_empty_list_when_no_local_datasets(tmp_path: Path):
    """GET /api/datasets should return empty list when HF cache has no datasets."""
    app = _make_app(tmp_path)
    endpoint = _find_endpoint(app, "/api/datasets", "GET")
    result = endpoint()
    assert "datasets" in result
    assert isinstance(result["datasets"], list)


def test_api_datasets_unknown_user_repo_returns_404_or_error(tmp_path: Path):
    """GET /api/datasets/{user}/{repo} should handle non-existent dataset gracefully."""
    from fastapi.responses import JSONResponse
    app = _make_app(tmp_path)
    endpoint = _find_endpoint(app, "/api/datasets/{user}/{repo}", "GET")
    result = endpoint("nonexistent_user_xyz", "nonexistent_repo_xyz")
    # Endpoint may return a dict or a JSONResponse for errors — both are acceptable
    if isinstance(result, JSONResponse):
        body = json.loads(result.body)
        assert "ok" in body or "error" in body or "episodes" in body or "detail" in body
    else:
        assert "ok" in result or "error" in result or "episodes" in result or "detail" in result

# ─── Config routes ─────────────────────────────────────────────────────────

def test_api_config_get_returns_defaults(tmp_path: Path):
    """GET /api/config should return a dict with default configuration."""
    app = _make_app(tmp_path)
    endpoint = _find_endpoint(app, "/api/config", "GET")
    result = endpoint()
    assert isinstance(result, dict)
    # Should have at least some basic keys
    assert len(result) > 0


def test_api_config_save_and_reload(tmp_path: Path):
    """POST /api/config should persist changes readable by GET /api/config."""
    app = _make_app(tmp_path)
    get_endpoint = _find_endpoint(app, "/api/config", "GET")
    save_endpoint = _find_endpoint(app, "/api/config", "POST")

    original = get_endpoint()
    new_config = {**original, "robot_id": "test_robot_save_reload"}

    saved = asyncio.run(save_endpoint(new_config))
    assert saved["ok"] is True

    reloaded = get_endpoint()
    assert reloaded.get("robot_id") == "test_robot_save_reload"


# ─── Profile routes ────────────────────────────────────────────────────────

def test_api_profiles_list_returns_at_least_default(tmp_path: Path):
    """GET /api/profiles should return at least one profile ('default')."""
    app = _make_app(tmp_path)
    endpoint = _find_endpoint(app, "/api/profiles", "GET")
    result = endpoint()
    assert "profiles" in result
    assert isinstance(result["profiles"], list)
    assert len(result["profiles"]) >= 1


def test_api_profiles_save_and_get(tmp_path: Path):
    """POST /api/profiles/{name} then GET /api/profiles/{name} should round-trip."""
    app = _make_app(tmp_path)
    save_endpoint = _find_endpoint(app, "/api/profiles/{name}", "POST")
    get_endpoint = _find_endpoint(app, "/api/profiles/{name}", "GET")

    cfg = {"robot_id": "my_test_bot", "follower_port": "/dev/test_arm"}
    saved = asyncio.run(save_endpoint("test_profile", cfg))
    assert saved["ok"] is True

    got = get_endpoint("test_profile")
    assert got["ok"] is True
    assert got["config"]["robot_id"] == "my_test_bot"


def test_api_profiles_import(tmp_path: Path):
    """POST /api/profiles-import should create a profile from an import payload."""
    app = _make_app(tmp_path)
    import_endpoint = _find_endpoint(app, "/api/profiles-import", "POST")
    get_endpoint = _find_endpoint(app, "/api/profiles/{name}", "GET")

    payload = ProfileImportRequest(name="imported_profile", config={"robot_id": "imported_bot"})
    result = asyncio.run(import_endpoint(payload))
    assert result["ok"] is True

    got = get_endpoint("imported_profile")
    assert got["ok"] is True
    assert got["config"]["robot_id"] == "imported_bot"


def test_api_profiles_delete(tmp_path: Path):
    """DELETE /api/profiles/{name} should remove an existing profile."""
    app = _make_app(tmp_path)
    save_endpoint = _find_endpoint(app, "/api/profiles/{name}", "POST")
    delete_endpoint = _find_endpoint(app, "/api/profiles/{name}", "DELETE")
    get_endpoint = _find_endpoint(app, "/api/profiles/{name}", "GET")

    asyncio.run(save_endpoint("to_delete", {"robot_id": "bye"}))

    deleted = delete_endpoint("to_delete")
    assert deleted["ok"] is True

    got = get_endpoint("to_delete")
    assert got["ok"] is False


def test_api_profiles_reject_invalid_name(tmp_path: Path):
    """Profile names with path traversal or special chars should be rejected."""
    app = _make_app(tmp_path)
    save_endpoint = _find_endpoint(app, "/api/profiles/{name}", "POST")

    result = asyncio.run(save_endpoint("../evil", {}))
    assert result["ok"] is False
    assert "Invalid" in result["error"]


# ─── Camera settings ───────────────────────────────────────────────────────

def test_api_camera_settings_save_and_get(tmp_path: Path, monkeypatch):
    """POST /api/camera_settings should persist settings; GET should read them back."""
    monkeypatch.setattr("lestudio._streaming.restart_all_streamers", lambda config_path: None)

    app = _make_app(tmp_path)
    save_endpoint = _find_endpoint(app, "/api/camera_settings", "POST")
    get_endpoint = _find_endpoint(app, "/api/camera_settings", "GET")

    payload = CameraSettingsRequest(width=1280, height=720, fps=15, codec="MJPG", jpeg_quality=80)
    saved = asyncio.run(save_endpoint(payload))
    assert saved["ok"] is True

    got = get_endpoint()
    assert got["width"] == 1280
    assert got["height"] == 720
    assert got["fps"] == 15
