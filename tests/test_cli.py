from __future__ import annotations

import importlib.util
from types import SimpleNamespace
from pathlib import Path
import argparse
import pytest

from lestudio import cli


def test_build_parser_defaults_host_to_localhost():
    parser = cli.build_parser()
    args = parser.parse_args(["serve"])
    assert args.host == "127.0.0.1"


def test_find_lerobot_src_uses_find_spec(monkeypatch, tmp_path: Path):
    pkg_dir = tmp_path / "site-packages" / "lerobot"
    pkg_dir.mkdir(parents=True)

    spec = SimpleNamespace(submodule_search_locations=[str(pkg_dir)], origin=None)
    monkeypatch.setattr(importlib.util, "find_spec", lambda name: spec if name == "lerobot" else None)

    resolved = cli.find_lerobot_src()
    assert resolved == pkg_dir.parent


def test_resolve_config_dir_prefers_new_default_and_migrates(monkeypatch, tmp_path: Path):
    fake_home = tmp_path / "home"
    fake_home.mkdir()
    monkeypatch.setattr(Path, "home", lambda: fake_home)

    old = fake_home / ".config" / "lerobot-studio"
    old.mkdir(parents=True)
    (old / "config.json").write_text("{}")

    resolved = cli.resolve_config_dir(None)
    assert resolved == fake_home / ".config" / "lestudio"
    assert resolved.exists()
    assert (resolved / "config.json").exists()


def test_resolve_config_dir_explicit_argument(tmp_path: Path):
    target = tmp_path / "custom-config"
    resolved = cli.resolve_config_dir(target)
    assert resolved == target
    assert target.exists()


def test_manual_commands_and_extract_symlinks():
    commands = cli._manual_commands(Path("/tmp/rules"), Path("/etc/udev/rules.d/99-lerobot.rules"))
    assert commands[0].startswith("sudo cp ")

    content = 'SUBSYSTEM=="video4linux", SYMLINK+="top_cam_1"\nSUBSYSTEM=="tty", SYMLINK+="leader_arm_1"\n'
    symlinks = cli._extract_symlink_names(content)
    assert symlinks == ["leader_arm_1", "top_cam_1"]


def test_resolve_lerobot_src_accepts_repo_root(tmp_path: Path):
    root = tmp_path / "lerobot"
    (root / "src" / "lerobot").mkdir(parents=True)
    resolved = cli.resolve_lerobot_src(root)
    assert resolved == (root / "src").resolve()


def test_resolve_lerobot_src_errors_when_missing(monkeypatch):
    monkeypatch.setattr(cli, "find_lerobot_src", lambda: None)
    with pytest.raises(SystemExit):
        cli.resolve_lerobot_src(None)


def test_main_infers_serve_for_option_form(monkeypatch):
    captured = {}

    def fake_handler(args):
        captured["command"] = args.command
        captured["port"] = args.port

    parser = cli.build_parser()
    serve_action = next(a for a in parser._subparsers._group_actions if isinstance(a, argparse._SubParsersAction))
    serve_parser = serve_action.choices["serve"]
    serve_parser.set_defaults(handler=fake_handler)
    monkeypatch.setattr(cli, "build_parser", lambda: parser)
    monkeypatch.setattr(cli.sys, "argv", ["lestudio", "--port", "9999"])

    cli.main()
    assert captured == {"command": "serve", "port": 9999}
