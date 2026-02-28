"""udev rules management helpers."""
from __future__ import annotations

import logging
import os
import re
import shlex
import shutil
import subprocess
import uuid
from pathlib import Path

logger = logging.getLogger(__name__)


def _arm_rule_lines(rules_path: Path) -> list[str]:
    if not rules_path.exists():
        return []
    return [
        ln for ln in rules_path.read_text().splitlines()
        if "idVendor" in ln and "SYMLINK" in ln
    ]


def _parse_udev_rules(content: str) -> dict[str, list[dict[str, str | bool]]]:
    camera_rules: list[dict[str, str | bool]] = []
    arm_rules: list[dict[str, str | bool]] = []
    devices: list[dict[str, str | bool]] = []

    def _extract(pattern: str, text: str) -> str:
        match = re.search(pattern, text)
        if not match:
            return ""
        return match.group(1)

    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "SYMLINK" not in line:
            continue

        subsystem = _extract(r'SUBSYSTEM=="([^"]+)"', line)
        kernels = _extract(r'KERNELS=="([^"]+)"', line)
        serial = _extract(r'ATTRS\{serial\}=="([^"]+)"', line)
        symlink = _extract(r'SYMLINK\+="([^"]+)"', line)
        mode = _extract(r'MODE="([^"]+)"', line)

        if not symlink:
            continue

        exists = os.path.exists(f"/dev/{symlink}")
        item = {
            "subsystem": subsystem,
            "kernel": kernels,
            "serial": serial,
            "symlink": symlink,
            "mode": mode,
            "exists": exists,
        }
        devices.append(item)
        if subsystem == "video4linux":
            camera_rules.append(item)
        elif subsystem == "tty":
            arm_rules.append(item)

    return {
        "camera_rules": camera_rules,
        "arm_rules": arm_rules,
        "devices": devices,
    }


def _build_rules(assignments: dict[str, str], arm_assignments: dict[str, str], rules_path: Path) -> str:
    lines = _arm_rule_lines(rules_path) + [
        "",
        "# LeRobot Camera Rules",
        '# Note: Cameras share Serial "SN0001", so we use physical port paths (KERNELS).',
        "# If you plug cameras into different ports, you MUST update these paths!",
        "",
    ]
    for kernels, role in sorted(assignments.items()):
        if role and role != "(none)":
            lines.append(
                f'SUBSYSTEM=="video4linux", KERNELS=="{kernels}", '
                f'ATTR{{index}}=="0", SYMLINK+="{role}", MODE="0666"'
            )

    lines += [
        "",
        "# LeRobot Arm Rules",
        "# Arms use serial-number matching.",
        "",
    ]
    for serial, role in sorted(arm_assignments.items()):
        if serial and role and role != "(none)":
            lines.append(
                f'SUBSYSTEM=="tty", ATTRS{{serial}}=="{serial}", '
                f'SYMLINK+="{role}", MODE="0666"'
            )
    return "\n".join(lines) + "\n"


def _apply_rules(assignments: dict[str, str], arm_assignments: dict[str, str], rules_path: Path) -> tuple[bool, str]:
    return _apply_rules_with_fallback(assignments, arm_assignments, rules_path, None)


def _manual_udev_install_commands(source_rules: Path, target_rules: Path) -> list[str]:
    source_q = shlex.quote(str(source_rules))
    target_q = shlex.quote(str(target_rules))
    return [
        f"sudo cp {source_q} {target_q}",
        "sudo udevadm control --reload-rules",
        "sudo udevadm trigger --subsystem-match=video4linux",
        "sudo udevadm trigger --subsystem-match=tty",
    ]


def _run_privileged_udev_apply(command_prefix: list[str], source_rules: Path, target_rules: Path) -> tuple[bool, str]:
    steps = [
        [*command_prefix, "cp", str(source_rules), str(target_rules)],
        [*command_prefix, "udevadm", "control", "--reload-rules"],
        [*command_prefix, "udevadm", "trigger", "--subsystem-match=video4linux"],
        [*command_prefix, "udevadm", "trigger", "--subsystem-match=tty"],
    ]
    for step in steps:
        result = subprocess.run(step, capture_output=True, text=True)
        if result.returncode != 0:
            stderr = (result.stderr or "").strip()
            stdout = (result.stdout or "").strip()
            err = stderr or stdout or f"{' '.join(step)} failed"
            return False, err
    return True, ""


def _apply_rules_with_fallback(
    assignments: dict[str, str],
    arm_assignments: dict[str, str],
    rules_path: Path,
    fallback_rules_path: Path | None,
) -> tuple[bool, str]:
    content = _build_rules(assignments, arm_assignments, rules_path)
    tmp = Path(f"/tmp/99-lerobot.rules.{uuid.uuid4().hex}.new")
    tmp.write_text(content)

    if fallback_rules_path is not None:
        try:
            fallback_rules_path.parent.mkdir(parents=True, exist_ok=True)
            fallback_rules_path.write_text(content)
        except OSError:
            pass

    try:
        sudo_ok, sudo_err = _run_privileged_udev_apply(["sudo", "-n"], tmp, rules_path)
        if sudo_ok:
            return True, ""

        pkexec_err = ""
        if shutil.which("pkexec"):
            pkexec_ok, pkexec_err = _run_privileged_udev_apply(["pkexec"], tmp, rules_path)
            if pkexec_ok:
                return True, ""

        base_err = sudo_err or "sudo failed — install udev rules via CLI helper"
        if pkexec_err:
            base_err = f"{base_err}\npkexec failed: {pkexec_err}"

        if fallback_rules_path is None:
            return False, base_err
        commands = _manual_udev_install_commands(fallback_rules_path, rules_path)
        hint = "\n".join(commands)
        return False, (
            f"{base_err}\n\n"
            f"Saved rules to: {fallback_rules_path}\n"
            f"Run these commands:\n{hint}"
        )
    finally:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
