"""udev rules management routes."""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
from pathlib import Path
from typing import cast

from fastapi import APIRouter

from .._udev_helpers import (
    _apply_rules_with_fallback,
    _build_rules,
    _manual_udev_install_commands,
    _parse_udev_rules,
)
from ..capabilities import Capability, register
from ._state import AppState

logger = logging.getLogger(__name__)

register("/api/rules/preview", Capability.HARDWARE_CONTROL)
register("/api/rules/apply", Capability.HARDWARE_CONTROL)


def create_router(state: AppState) -> APIRouter:
    router = APIRouter()

    def _current_rules_payload() -> dict[str, str | list[dict[str, str | bool]]]:
        if not state.rules_path.exists():
            return {"content": "# File not found", "camera_rules": [], "arm_rules": [], "devices": []}
        content = state.rules_path.read_text()
        parsed = _parse_udev_rules(content)
        return {"content": content, **parsed}

    @router.get("/api/udev/rules")
    def api_udev_rules():
        payload = _current_rules_payload()
        camera_rules = payload.get("camera_rules", [])
        if not isinstance(camera_rules, list):
            camera_rules = []
        arm_rules = payload.get("arm_rules", [])
        if not isinstance(arm_rules, list):
            arm_rules = []
        cam = [r.get("symlink") for r in camera_rules if isinstance(r, dict) and r.get("symlink")]
        arm = {r.get("serial", "?"): r.get("symlink") for r in arm_rules if isinstance(r, dict) and r.get("symlink")}
        logger.info("GET /api/udev/rules → cameras=%s, arms=%s", cam, arm)
        return payload

    @router.get("/api/rules/current")
    def api_rules_current():
        return _current_rules_payload()

    @router.get("/api/rules/status")
    def api_rules_status():
        sudo_noninteractive = False
        try:
            probe = subprocess.run(["sudo", "-n", "true"], capture_output=True)
            sudo_noninteractive = probe.returncode == 0
        except OSError:
            sudo_noninteractive = False
        pkexec_available = shutil.which("pkexec") is not None
        graphical_session = bool(
            (os.environ.get("DISPLAY") or "").strip() or (os.environ.get("WAYLAND_DISPLAY") or "").strip()
        )
        gui_auth_available = pkexec_available and graphical_session
        rules_installed = state.rules_path.exists()
        install_needed = not rules_installed
        needs_root_for_install = install_needed and not (sudo_noninteractive or gui_auth_available)
        return {
            "rules_path": str(state.rules_path),
            "rules_installed": rules_installed,
            "install_needed": install_needed,
            "needs_root_for_install": needs_root_for_install,
            "fallback_rules_path": str(state.fallback_rules_path),
            "fallback_rules_exists": state.fallback_rules_path.exists(),
            "sudo_noninteractive": sudo_noninteractive,
            "pkexec_available": pkexec_available,
            "graphical_session": graphical_session,
            "gui_auth_available": gui_auth_available,
            "manual_commands": _manual_udev_install_commands(state.fallback_rules_path, state.rules_path),
        }

    @router.post("/api/rules/preview")
    async def api_rules_preview(data: dict[str, object]):
        raw_assignments = data.get("assignments", {})
        raw_arm_assignments = data.get("arm_assignments", {})
        assignments = cast(dict[str, str], raw_assignments) if isinstance(raw_assignments, dict) else {}
        arm_assignments = cast(dict[str, str], raw_arm_assignments) if isinstance(raw_arm_assignments, dict) else {}
        return {
            "content": _build_rules(
                assignments,
                arm_assignments,
                state.rules_path,
            )
        }

    @router.post("/api/rules/apply")
    async def api_rules_apply(data: dict[str, object]):
        raw_assignments = data.get("assignments", {})
        raw_arm_assignments = data.get("arm_assignments", {})
        assignments = cast(dict[str, str], raw_assignments) if isinstance(raw_assignments, dict) else {}
        arm_assignments = cast(dict[str, str], raw_arm_assignments) if isinstance(raw_arm_assignments, dict) else {}
        logger.info(
            "Applying udev rules — cameras: %s, arms: %s",
            {k: v for k, v in assignments.items() if v != "(none)"},
            {k: v for k, v in arm_assignments.items() if v != "(none)"},
        )
        ok, err = _apply_rules_with_fallback(
            assignments,
            arm_assignments,
            state.rules_path,
            state.fallback_rules_path,
        )
        if ok:
            logger.info("udev rules applied successfully")
        else:
            logger.warning("udev rules apply failed: %s", err)
        return {
            "ok": ok,
            "error": err,
            "fallback_rules_path": str(state.fallback_rules_path),
            "manual_commands": _manual_udev_install_commands(state.fallback_rules_path, state.rules_path),
        }

    @router.get("/api/rules/verify")
    def api_rules_verify():
        """Check each expected symlink from installed rules and report status."""
        if not state.rules_path.exists():
            return {"ok": True, "results": [], "note": "No rules file installed."}

        parsed = _parse_udev_rules(state.rules_path.read_text())
        results = []
        for device in parsed.get("devices", []):
            symlink = device.get("symlink", "")
            if not symlink:
                continue
            dev_path = Path(f"/dev/{symlink}")
            exists = dev_path.exists()
            resolved_target = ""
            status = "missing"
            if exists:
                try:
                    resolved_target = dev_path.resolve().name
                    status = "ok"
                except (OSError, RuntimeError):
                    resolved_target = "(unresolvable)"
                    status = "error"
            results.append(
                {
                    "role": symlink,
                    "subsystem": device.get("subsystem", ""),
                    "match_key": device.get("serial") or device.get("kernel") or "",
                    "exists": exists,
                    "resolved_target": resolved_target,
                    "status": status,
                }
            )
        return {"ok": True, "results": results}

    return router
