"""Calibration file anomaly detection.

Validates calibration JSON files against known constraints for
Feetech STS3215 servos used in SO-100/SO-101 arms (6 motors each).

Returns structured warnings and errors that the API layer can surface
to operators before they start teleop/record.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# ── STS3215 physical constants ──────────────────────────────────────────────
POSITION_MIN = 0
POSITION_MAX = 4095  # 12-bit resolution
DRIVE_MODE_VALID = {0, 1}
MIN_USEFUL_SPAN = 300  # ticks – below this the joint barely moves
SPAN_ASYMMETRY_WARN = 0.30  # 30% leader/follower mismatch

# Expected joints for SO-100 / SO-101 arms (both leader and follower)
EXPECTED_JOINTS_SO = frozenset(["shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll", "gripper"])


@dataclass
class CalibrationIssue:
    """A single validation finding."""

    severity: str  # "error" or "warning"
    joint: str  # joint name, or "" for file-level issues
    code: str  # machine-readable code
    message: str  # human-readable description


@dataclass
class CalibrationValidationResult:
    """Aggregate validation result for one calibration file."""

    path: str = ""
    errors: list[CalibrationIssue] = field(default_factory=list)
    warnings: list[CalibrationIssue] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return len(self.errors) == 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "path": self.path,
            "errors": [
                {"severity": i.severity, "joint": i.joint, "code": i.code, "message": i.message} for i in self.errors
            ],
            "warnings": [
                {"severity": i.severity, "joint": i.joint, "code": i.code, "message": i.message} for i in self.warnings
            ],
        }


@dataclass
class CrossValidationResult:
    """Aggregate cross-validation result for a leader/follower pair."""

    leader_path: str = ""
    follower_path: str = ""
    warnings: list[CalibrationIssue] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "leader_path": self.leader_path,
            "follower_path": self.follower_path,
            "warnings": [
                {"severity": i.severity, "joint": i.joint, "code": i.code, "message": i.message} for i in self.warnings
            ],
        }


# ── Single-file validation ──────────────────────────────────────────────────


def validate_calibration_data(
    data: dict[str, Any],
    *,
    path: str = "",
    expected_joints: frozenset[str] | None = None,
) -> CalibrationValidationResult:
    """Validate a parsed calibration dict.

    Parameters
    ----------
    data : dict
        Parsed JSON content of a calibration file.
    path : str
        File path (for display only).
    expected_joints : frozenset[str] | None
        If provided, checks for missing / extra joints.
        Defaults to SO arm joint set.
    """
    result = CalibrationValidationResult(path=path)

    if expected_joints is None:
        expected_joints = EXPECTED_JOINTS_SO

    if not data:
        result.errors.append(CalibrationIssue("error", "", "EMPTY_FILE", "Calibration file is empty or invalid JSON."))
        return result

    # ── Joint presence ───────────────────────────────────────────────────
    present_joints = set(data.keys())
    missing = expected_joints - present_joints
    extra = present_joints - expected_joints

    for j in sorted(missing):
        result.errors.append(CalibrationIssue("error", j, "MISSING_JOINT", f"Expected joint '{j}' is missing."))
    for j in sorted(extra):
        result.warnings.append(CalibrationIssue("warning", j, "EXTRA_JOINT", f"Unexpected joint '{j}' found."))

    # ── Motor ID duplicates ──────────────────────────────────────────────
    seen_ids: dict[int, str] = {}
    for joint_name, joint_data in data.items():
        if not isinstance(joint_data, dict):
            result.errors.append(
                CalibrationIssue(
                    "error", joint_name, "INVALID_JOINT_DATA", f"Joint '{joint_name}' data is not a dict."
                )
            )
            continue

        motor_id = joint_data.get("id")
        if motor_id is not None:
            if motor_id in seen_ids:
                result.errors.append(
                    CalibrationIssue(
                        "error",
                        joint_name,
                        "DUPLICATE_MOTOR_ID",
                        f"Motor ID {motor_id} is used by both '{seen_ids[motor_id]}' and '{joint_name}'.",
                    )
                )
            else:
                seen_ids[motor_id] = joint_name

    # ── Per-joint field validation ───────────────────────────────────────
    for joint_name, joint_data in data.items():
        if not isinstance(joint_data, dict):
            continue
        _validate_joint(joint_name, joint_data, result)

    return result


def _validate_joint(
    joint_name: str,
    joint_data: dict[str, Any],
    result: CalibrationValidationResult,
) -> None:
    """Validate a single joint's calibration fields."""

    range_min = joint_data.get("range_min")
    range_max = joint_data.get("range_max")
    drive_mode = joint_data.get("drive_mode")
    _ = joint_data.get("homing_offset")  # read but validated via field loop below

    # ── Required fields ──────────────────────────────────────────────────
    for field_name in ("id", "drive_mode", "homing_offset", "range_min", "range_max"):
        if field_name not in joint_data:
            result.errors.append(
                CalibrationIssue(
                    "error",
                    joint_name,
                    "MISSING_FIELD",
                    f"Required field '{field_name}' is missing.",
                )
            )

    # ── drive_mode ───────────────────────────────────────────────────────
    if drive_mode is not None and drive_mode not in DRIVE_MODE_VALID:
        result.errors.append(
            CalibrationIssue(
                "error",
                joint_name,
                "INVALID_DRIVE_MODE",
                f"drive_mode={drive_mode} is invalid (must be 0 or 1).",
            )
        )

    # ── range_min / range_max ────────────────────────────────────────────
    if range_min is not None and range_max is not None:
        if not isinstance(range_min, (int, float)) or not isinstance(range_max, (int, float)):
            result.errors.append(
                CalibrationIssue(
                    "error",
                    joint_name,
                    "INVALID_RANGE_TYPE",
                    f"range_min/range_max must be numeric (got {type(range_min).__name__}/{type(range_max).__name__}).",
                )
            )
        else:
            # Out of physical bounds
            if range_min < POSITION_MIN or range_min > POSITION_MAX:
                result.errors.append(
                    CalibrationIssue(
                        "error",
                        joint_name,
                        "RANGE_MIN_OUT_OF_BOUNDS",
                        f"range_min={range_min} is outside [{POSITION_MIN}, {POSITION_MAX}].",
                    )
                )
            if range_max < POSITION_MIN or range_max > POSITION_MAX:
                result.errors.append(
                    CalibrationIssue(
                        "error",
                        joint_name,
                        "RANGE_MAX_OUT_OF_BOUNDS",
                        f"range_max={range_max} is outside [{POSITION_MIN}, {POSITION_MAX}].",
                    )
                )

            # Inverted range
            if range_min >= range_max:
                result.errors.append(
                    CalibrationIssue(
                        "error",
                        joint_name,
                        "INVERTED_RANGE",
                        f"range_min ({range_min}) >= range_max ({range_max}). Range is inverted or zero.",
                    )
                )
            else:
                # Span too narrow
                span = range_max - range_min
                if span < MIN_USEFUL_SPAN:
                    result.warnings.append(
                        CalibrationIssue(
                            "warning",
                            joint_name,
                            "NARROW_SPAN",
                            f"Span is only {span} ticks (< {MIN_USEFUL_SPAN}). "
                            "Joint may have very limited range of motion. Consider recalibrating.",
                        )
                    )


# ── Cross-validation (leader vs follower) ────────────────────────────────────


def cross_validate(
    leader_data: dict[str, Any],
    follower_data: dict[str, Any],
    *,
    leader_path: str = "",
    follower_path: str = "",
) -> CrossValidationResult:
    """Compare leader and follower calibration for span asymmetry.

    Large span differences between leader and follower for the same joint
    can cause unexpected amplification of motion.
    """
    result = CrossValidationResult(leader_path=leader_path, follower_path=follower_path)

    common_joints = set(leader_data.keys()) & set(follower_data.keys())

    for joint_name in sorted(common_joints):
        leader_joint = leader_data.get(joint_name, {})
        follower_joint = follower_data.get(joint_name, {})

        if not isinstance(leader_joint, dict) or not isinstance(follower_joint, dict):
            continue

        l_min = leader_joint.get("range_min")
        l_max = leader_joint.get("range_max")
        f_min = follower_joint.get("range_min")
        f_max = follower_joint.get("range_max")

        if None in (l_min, l_max, f_min, f_max):
            continue
        if not isinstance(l_min, (int, float)) or not isinstance(l_max, (int, float)):
            continue
        if not isinstance(f_min, (int, float)) or not isinstance(f_max, (int, float)):
            continue

        l_span = l_max - l_min
        f_span = f_max - f_min

        if l_span <= 0 or f_span <= 0:
            continue  # Already caught by single-file validation

        # Asymmetry = |leader - follower| / max(leader, follower)
        max_span = max(l_span, f_span)
        diff_ratio = abs(l_span - f_span) / max_span

        if diff_ratio > SPAN_ASYMMETRY_WARN:
            pct = int(diff_ratio * 100)
            result.warnings.append(
                CalibrationIssue(
                    "warning",
                    joint_name,
                    "SPAN_ASYMMETRY",
                    f"Leader span ({l_span}) vs follower span ({f_span}) differ by {pct}%. "
                    "This can cause motion amplification. Consider recalibrating with full range of motion.",
                )
            )

    return result


# ── File-level convenience ───────────────────────────────────────────────────


def validate_calibration_file(path: Path) -> CalibrationValidationResult:
    """Load and validate a calibration JSON file."""
    str_path = str(path)
    if not path.exists():
        r = CalibrationValidationResult(path=str_path)
        r.errors.append(CalibrationIssue("error", "", "FILE_NOT_FOUND", f"File not found: {str_path}"))
        return r
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        r = CalibrationValidationResult(path=str_path)
        r.errors.append(CalibrationIssue("error", "", "PARSE_ERROR", f"Cannot parse calibration file: {exc}"))
        return r

    return validate_calibration_data(data, path=str_path)


def validate_and_cross_validate(
    leader_path: Path,
    follower_path: Path,
) -> dict[str, Any]:
    """Validate both files individually and cross-validate as a pair.

    Returns a dict ready for JSON serialization with keys:
      - leader: CalibrationValidationResult.to_dict()
      - follower: CalibrationValidationResult.to_dict()
      - cross: CrossValidationResult.to_dict()
    """
    leader_result = validate_calibration_file(leader_path)
    follower_result = validate_calibration_file(follower_path)

    cross_result = CrossValidationResult(
        leader_path=str(leader_path),
        follower_path=str(follower_path),
    )

    # Only cross-validate if both files parsed successfully
    if leader_result.ok and follower_result.ok:
        try:
            leader_data = json.loads(leader_path.read_text(encoding="utf-8"))
            follower_data = json.loads(follower_path.read_text(encoding="utf-8"))
            cross_result = cross_validate(
                leader_data,
                follower_data,
                leader_path=str(leader_path),
                follower_path=str(follower_path),
            )
        except Exception:
            logger.exception("Cross-validation failed")

    return {
        "leader": leader_result.to_dict(),
        "follower": follower_result.to_dict(),
        "cross": cross_result.to_dict(),
    }
