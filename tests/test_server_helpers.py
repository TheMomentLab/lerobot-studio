from __future__ import annotations

from pathlib import Path

import pytest

from lestudio._cors import _parse_cors_origins
from lestudio._config_helpers import _is_valid_profile_name
from lestudio._udev_helpers import _build_rules, _parse_udev_rules, _manual_udev_install_commands
from lestudio._train_helpers import (
    _ensure_non_interactive_conda_args,
    _parse_install_args,
    _normalize_console_command,
    _cuda_tag_to_toolkit_version,
    _format_cmd,
)
from lestudio._device_helpers import get_usb_bus_for_camera
import lestudio._udev_helpers as _udev_mod


def test_parse_cors_origins_handles_empty_and_csv():
    assert _parse_cors_origins(None) == []
    assert _parse_cors_origins("https://a.com, http://b.local ") == ["https://a.com", "http://b.local"]


def test_is_valid_profile_name():
    assert _is_valid_profile_name("default")
    assert _is_valid_profile_name("my-profile_1")
    assert not _is_valid_profile_name("../bad")
    assert not _is_valid_profile_name("white space")


def test_build_rules_contains_camera_and_arm_rules(tmp_path: Path):
    rules_path = tmp_path / "rules"
    rules_path.write_text('SUBSYSTEM=="tty", ATTRS{serial}=="old", SYMLINK+="old_arm", MODE="0666"\n')
    rendered = _build_rules(
        assignments={"1-1.2": "top_cam_1"},
        arm_assignments={"A1B2": "leader_arm_1"},
        rules_path=rules_path,
    )
    assert 'KERNELS=="1-1.2"' in rendered
    assert 'SYMLINK+="top_cam_1"' in rendered
    assert 'ATTRS{serial}=="A1B2"' in rendered
    assert 'SYMLINK+="leader_arm_1"' in rendered


def test_parse_udev_rules_parses_devices(monkeypatch):
    monkeypatch.setattr(_udev_mod.os.path, "exists", lambda p: p.endswith("top_cam_1"))
    content = """
    SUBSYSTEM=="video4linux", KERNELS=="1-1.2", ATTR{index}=="0", SYMLINK+="top_cam_1", MODE="0666"
    SUBSYSTEM=="tty", ATTRS{serial}=="ABC", SYMLINK+="leader_arm_1", MODE="0666"
    """
    parsed = _parse_udev_rules(content)
    assert len(parsed["camera_rules"]) == 1
    assert len(parsed["arm_rules"]) == 1
    assert parsed["camera_rules"][0]["exists"] is True


def test_manual_udev_install_commands_quote_paths():
    commands = _manual_udev_install_commands(Path("/tmp/my rules"), Path("/etc/udev/rules.d/99-lerobot.rules"))
    assert commands[0].startswith("sudo cp ")
    assert "'/tmp/my rules'" in commands[0]


def test_ensure_non_interactive_conda_args():
    args = _ensure_non_interactive_conda_args(["conda", "install", "numpy"])
    assert args == ["conda", "install", "-y", "numpy"]
    args = _ensure_non_interactive_conda_args(["conda", "install", "-y", "numpy"])
    assert args == ["conda", "install", "-y", "numpy"]
    args = _ensure_non_interactive_conda_args(["python", "-m", "pip", "install", "x"])
    assert args == ["python", "-m", "pip", "install", "x"]


def test_parse_install_args_normalizes_pip_and_conda():
    pip_args = _parse_install_args("pip install rich", "/py")
    assert pip_args[:4] == ["/py", "-m", "pip", "install"]

    py_pip_args = _parse_install_args("python -m pip install fastapi", "/py")
    assert py_pip_args[:4] == ["/py", "-m", "pip", "install"]

    conda_args = _parse_install_args("conda install pandas", "/py")
    assert conda_args == ["conda", "install", "-y", "pandas"]


def test_normalize_console_command_behaviors():
    args, normalized = _normalize_console_command("/py", "pip install uvicorn")
    assert args[:4] == ["/py", "-m", "pip", "install"]
    assert "/py -m pip install uvicorn" in normalized

    args, _ = _normalize_console_command("/py", "conda install pandas")
    assert args == ["conda", "install", "-y", "pandas"]

    with pytest.raises(ValueError):
        _normalize_console_command("/py", " ")


def test_normalize_console_command_allowlist():
    # Allowed: pip download
    args, _ = _normalize_console_command("/py", "pip download torch")
    assert args[:4] == ["/py", "-m", "pip", "download"]

    # Allowed: mamba install
    args, _ = _normalize_console_command("/py", "mamba install numpy")
    assert args[:3] == ["mamba", "install", "-y"]

    # Blocked: arbitrary binary
    with pytest.raises(ValueError, match="not allowed"):
        _normalize_console_command("/py", "vim /etc/passwd")

    # Blocked: pip list (not in pip subcommand allowlist)
    with pytest.raises(ValueError, match="not allowed"):
        _normalize_console_command("/py", "pip list")

    # Blocked: conda run (not in conda subcommand allowlist)
    with pytest.raises(ValueError, match="not allowed"):
        _normalize_console_command("/py", "conda run rm -rf /")


def test_cuda_tag_to_toolkit_version():
    assert _cuda_tag_to_toolkit_version("cu128") == "12.8"
    assert _cuda_tag_to_toolkit_version("cu121") == "12.1"
    assert _cuda_tag_to_toolkit_version("cpu") is None


def test_format_cmd_quotes():
    rendered = _format_cmd(["python", "-c", "print('x y')"])
    assert rendered.startswith("python -c ")
    assert "x y" in rendered


def test_get_usb_bus_for_camera_fallback():
    result = get_usb_bus_for_camera("no-such-video")
    assert result == {"bus": "?", "port": "?", "max_mbps": 480}
