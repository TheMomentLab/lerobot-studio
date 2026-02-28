from __future__ import annotations

import asyncio
import sys
from pathlib import Path

from lestudio.routes.models import ProcessCommandRequest
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


def test_api_proc_command_rejects_unknown_process(tmp_path: Path):
    app = _make_app(tmp_path)
    endpoint = _find_endpoint(app, "/api/process/{name}/command", "POST")
    payload = asyncio.run(endpoint("not_allowed", {"command": "pip install rich"}))
    assert payload["ok"] is False
    assert "Unknown process" in payload["error"]


def test_api_proc_command_allows_known_process_and_normalizes_pip(monkeypatch, tmp_path: Path):
    captured: dict[str, object] = {}

    def fake_is_running(self, name: str) -> bool:
        return False

    def fake_start(self, name: str, args: list[str]) -> bool:
        captured["name"] = name
        captured["args"] = args
        return True

    monkeypatch.setattr("lestudio.process_manager.ProcessManager.is_running", fake_is_running)
    monkeypatch.setattr("lestudio.process_manager.ProcessManager.start", fake_start)

    app = _make_app(tmp_path)
    endpoint = _find_endpoint(app, "/api/process/{name}/command", "POST")
    payload = asyncio.run(endpoint("train", ProcessCommandRequest(command="pip install rich")))
    assert payload["ok"] is True
    assert captured["name"] == "train"

    args = captured["args"]
    assert isinstance(args, list)
    assert args[0] == sys.executable
    assert args[1:4] == ["-m", "pip", "install"]
