from __future__ import annotations

from pathlib import Path

import pytest

from lestudio import server


def test_parse_cors_origins_handles_empty_and_csv():
    assert server._parse_cors_origins(None) == []
    assert server._parse_cors_origins("https://a.com, http://b.local ") == ["https://a.com", "http://b.local"]


def test_is_valid_profile_name():
    assert server._is_valid_profile_name("default")
    assert server._is_valid_profile_name("my-profile_1")
    assert not server._is_valid_profile_name("../bad")
    assert not server._is_valid_profile_name("white space")


def test_build_rules_contains_camera_and_arm_rules(tmp_path: Path):
    rules_path = tmp_path / "rules"
    rules_path.write_text('SUBSYSTEM=="tty", ATTRS{serial}=="old", SYMLINK+="old_arm", MODE="0666"\n')
    rendered = server._build_rules(
        assignments={"1-1.2": "top_cam_1"},
        arm_assignments={"A1B2": "leader_arm_1"},
        rules_path=rules_path,
    )
    assert 'KERNELS=="1-1.2"' in rendered
    assert 'SYMLINK+="top_cam_1"' in rendered
    assert 'ATTRS{serial}=="A1B2"' in rendered
    assert 'SYMLINK+="leader_arm_1"' in rendered


def test_parse_udev_rules_parses_devices(monkeypatch):
    monkeypatch.setattr(server.os.path, "exists", lambda p: p.endswith("top_cam_1"))
    content = """
    SUBSYSTEM=="video4linux", KERNELS=="1-1.2", ATTR{index}=="0", SYMLINK+="top_cam_1", MODE="0666"
    SUBSYSTEM=="tty", ATTRS{serial}=="ABC", SYMLINK+="leader_arm_1", MODE="0666"
    """
    parsed = server._parse_udev_rules(content)
    assert len(parsed["camera_rules"]) == 1
    assert len(parsed["arm_rules"]) == 1
    assert parsed["camera_rules"][0]["exists"] is True


def test_manual_udev_install_commands_quote_paths():
    commands = server._manual_udev_install_commands(Path("/tmp/my rules"), Path("/etc/udev/rules.d/99-lerobot.rules"))
    assert commands[0].startswith("sudo cp ")
    assert "'/tmp/my rules'" in commands[0]


def test_ensure_non_interactive_conda_args():
    args = server._ensure_non_interactive_conda_args(["conda", "install", "numpy"])
    assert args == ["conda", "install", "-y", "numpy"]
    args = server._ensure_non_interactive_conda_args(["conda", "install", "-y", "numpy"])
    assert args == ["conda", "install", "-y", "numpy"]
    args = server._ensure_non_interactive_conda_args(["python", "-m", "pip", "install", "x"])
    assert args == ["python", "-m", "pip", "install", "x"]


def test_parse_install_args_normalizes_pip_and_conda():
    pip_args = server._parse_install_args("pip install rich", "/py")
    assert pip_args[:4] == ["/py", "-m", "pip", "install"]

    py_pip_args = server._parse_install_args("python -m pip install fastapi", "/py")
    assert py_pip_args[:4] == ["/py", "-m", "pip", "install"]

    conda_args = server._parse_install_args("conda install pandas", "/py")
    assert conda_args == ["conda", "install", "-y", "pandas"]


def test_normalize_console_command_behaviors():
    args, normalized = server._normalize_console_command("/py", "pip install uvicorn")
    assert args[:4] == ["/py", "-m", "pip", "install"]
    assert "/py -m pip install uvicorn" in normalized

    args, _ = server._normalize_console_command("/py", "conda install pandas")
    assert args == ["conda", "install", "-y", "pandas"]

    with pytest.raises(ValueError):
        server._normalize_console_command("/py", " ")


def test_cuda_tag_to_toolkit_version():
    assert server._cuda_tag_to_toolkit_version("cu128") == "12.8"
    assert server._cuda_tag_to_toolkit_version("cu121") == "12.1"
    assert server._cuda_tag_to_toolkit_version("cpu") is None


def test_format_cmd_quotes():
    rendered = server._format_cmd(["python", "-c", "print('x y')"])
    assert rendered.startswith("python -c ")
    assert "x y" in rendered


def test_get_usb_bus_for_camera_fallback():
    result = server.get_usb_bus_for_camera("no-such-video")
    assert result == {"bus": "?", "port": "?", "max_mbps": 480}
