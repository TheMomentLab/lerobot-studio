from __future__ import annotations

from pathlib import Path

from lestudio.server import create_app


def test_server_route_inventory_contains_expected_contract(tmp_path: Path):
    lerobot_src = tmp_path / "lerobot_src"
    (lerobot_src / "lerobot").mkdir(parents=True)
    config_dir = tmp_path / "config"
    config_dir.mkdir(parents=True)
    rules_path = tmp_path / "99-lerobot.rules"

    app = create_app(lerobot_src=lerobot_src, config_dir=config_dir, rules_path=rules_path)
    paths = {
        route.path
        for route in app.routes
        if hasattr(route, "path")
        and (route.path.startswith("/api/") or route.path in {"/ws", "/stream/{video_name}"})
    }

    assert len(paths) == 56
    assert "/api/process/{name}/command" in paths
    assert "/api/teleop/start" in paths
    assert "/api/record/start" in paths
    assert "/api/train/start" in paths
    assert "/api/eval/start" in paths
    assert "/api/datasets/{user}/{repo}" in paths
    assert "/api/hub/datasets/download" in paths
    assert "/stream/{video_name}" in paths
    assert "/ws" in paths
