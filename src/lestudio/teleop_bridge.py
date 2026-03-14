#!/usr/bin/env python3

from __future__ import annotations

import builtins
import importlib
import json
import logging
import math
import os
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, cast

logger = logging.getLogger(__name__)

_ANTIJITTER_PREFIX = "--lestudio.antijitter."
_INVERT_PREFIX = "--lestudio.invert."
_DEBUG_PREFIX = "--lestudio.debug."
_ACTION_KEY = "action"
_TELEOP_DEBUG_PREFIX = "[LESTUDIO_TELEOP_DEBUG] "
_TELEOP_DEBUG_META_PREFIX = "[LESTUDIO_TELEOP_DEBUG_META] "
_DEFAULT_DEBUG_INTERVAL_S = 0.25
_DEBUG_JOINT_LIMIT = 16
_CALIBRATION_REUSE_PROMPT = "Press ENTER to use provided calibration file associated with the id"


@dataclass(frozen=True)
class AntiJitterSettings:
    enabled: bool = False
    alpha: float = 0.35
    deadband: float = 0.75
    max_step: float | None = None


@dataclass(frozen=True)
class JointInvertSettings:
    shoulder_lift: bool = False
    wrist_roll: bool = False

    def joints(self) -> tuple[str, ...]:
        enabled: list[str] = []
        if self.shoulder_lift:
            enabled.append("shoulder_lift")
        if self.wrist_roll:
            enabled.append("wrist_roll")
        return tuple(enabled)


@dataclass(frozen=True)
class TeleopDebugSettings:
    enabled: bool = False
    sample_interval_s: float = _DEFAULT_DEBUG_INTERVAL_S


@dataclass(frozen=True)
class JointPositionSnapshot:
    values: dict[str, float]
    total_count: int


def _antijitter_disabled_by_env() -> bool:
    raw = os.getenv("LESTUDIO_DISABLE_ANTIJITTER_PLUGIN", "")
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _parse_bool(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _parse_float(value: str, default: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    return parsed if parsed == parsed else default


def extract_antijitter_settings(argv: list[str] | None = None) -> tuple[AntiJitterSettings, list[str]]:
    raw_args = list(sys.argv[1:] if argv is None else argv)
    filtered_args: list[str] = []
    values: dict[str, str] = {}

    for arg in raw_args:
        if not arg.startswith(_ANTIJITTER_PREFIX):
            filtered_args.append(arg)
            continue
        key, sep, value = arg[len(_ANTIJITTER_PREFIX) :].partition("=")
        if not sep:
            continue
        values[key] = value

    settings = AntiJitterSettings(
        enabled=_parse_bool(values.get("enabled", "false")),
        alpha=_parse_float(values.get("alpha", "0.35"), 0.35),
        deadband=_parse_float(values.get("deadband", "0.75"), 0.75),
        max_step=(_parse_float(values["max_step"], 0.0) if values.get("max_step", "").strip() else None),
    )
    return settings, filtered_args


def extract_joint_inversion_settings(argv: list[str]) -> tuple[JointInvertSettings, list[str]]:
    filtered_args: list[str] = []
    values: dict[str, str] = {}

    for arg in argv:
        if not arg.startswith(_INVERT_PREFIX):
            filtered_args.append(arg)
            continue
        key, sep, value = arg[len(_INVERT_PREFIX) :].partition("=")
        if not sep:
            continue
        values[key] = value

    settings = JointInvertSettings(
        shoulder_lift=_parse_bool(values.get("shoulder_lift", "false")),
        wrist_roll=_parse_bool(values.get("wrist_roll", "false")),
    )
    return settings, filtered_args


def extract_debug_settings(argv: list[str]) -> tuple[TeleopDebugSettings, list[str]]:
    filtered_args: list[str] = []
    values: dict[str, str] = {}

    for arg in argv:
        if not arg.startswith(_DEBUG_PREFIX):
            filtered_args.append(arg)
            continue
        key, sep, value = arg[len(_DEBUG_PREFIX) :].partition("=")
        if not sep:
            continue
        values[key] = value

    settings = TeleopDebugSettings(
        enabled=_parse_bool(values.get("enabled", "false")),
        sample_interval_s=max(
            _parse_float(values.get("interval_s", str(_DEFAULT_DEBUG_INTERVAL_S)), _DEFAULT_DEBUG_INTERVAL_S), 0.05
        ),
    )
    return settings, filtered_args


def antijitter_plugin_available() -> bool:
    if _antijitter_disabled_by_env():
        return False
    try:
        _load_antijitter_step_class()
    except Exception:
        return False
    return True


def _load_antijitter_step_class() -> type[Any]:
    module = importlib.import_module("lerobot_teleoperator_antijitter")
    step_class = module.AntiJitterProcessorStep
    return step_class


def _patch_default_processors(
    teleop_mod: object,
    antijitter_settings: AntiJitterSettings,
    invert_settings: JointInvertSettings,
) -> None:
    if not antijitter_settings.enabled and not invert_settings.joints():
        return

    step_class = _load_antijitter_step_class() if antijitter_settings.enabled else None
    original_factory = teleop_mod.make_default_processors

    def patched_make_default_processors():
        processors = original_factory()
        teleop_action_processor, robot_action_processor, robot_observation_processor = processors
        if antijitter_settings.enabled and step_class is not None:
            teleop_action_processor = _prepend_antijitter_step(
                teleop_action_processor, step_class, antijitter_settings
            )
        if invert_settings.joints():
            teleop_action_processor = _prepend_joint_inversion_step(teleop_action_processor, invert_settings)
        return teleop_action_processor, robot_action_processor, robot_observation_processor

    teleop_mod.make_default_processors = patched_make_default_processors
    if antijitter_settings.enabled:
        logger.info(
            "LeStudio anti-jitter enabled (alpha=%s, deadband=%s, max_step=%s)",
            antijitter_settings.alpha,
            antijitter_settings.deadband,
            antijitter_settings.max_step,
        )
    if invert_settings.joints():
        logger.info("LeStudio teleop joint inversion enabled for %s", ", ".join(invert_settings.joints()))


def _to_finite_float(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    numeric = float(value)
    if not math.isfinite(numeric):
        return None
    return round(numeric, 4)


def _extract_joint_positions(values: object, *, limit: int = _DEBUG_JOINT_LIMIT) -> JointPositionSnapshot:
    if not isinstance(values, dict):
        return JointPositionSnapshot(values={}, total_count=0)
    extracted: list[tuple[str, float]] = []
    total_count = 0
    for key, raw_value in values.items():
        if not isinstance(key, str) or not key.endswith(".pos"):
            continue
        total_count += 1
        numeric = _to_finite_float(raw_value)
        if numeric is None:
            continue
        extracted.append((key, numeric))
    extracted.sort(key=lambda item: item[0])
    return JointPositionSnapshot(values=dict(extracted[:limit]), total_count=total_count)


def _compute_joint_delta(target: dict[str, float], current: dict[str, float]) -> dict[str, float]:
    delta: dict[str, float] = {}
    for key, target_value in target.items():
        current_value = current.get(key)
        if current_value is None:
            continue
        delta[key] = round(target_value - current_value, 4)
    return delta


def _build_debug_snapshot_payload(
    *,
    loop_index: int,
    uptime_s: float,
    active_loop_ms: float,
    raw_action: object,
    observation: object,
    teleop_action: object,
    robot_action: object,
) -> dict[str, object]:
    leader_raw = _extract_joint_positions(raw_action)
    follower_current = _extract_joint_positions(observation)
    teleop_mapped = _extract_joint_positions(teleop_action)
    follower_goal = _extract_joint_positions(robot_action)
    goal_delta = _compute_joint_delta(follower_goal.values, follower_current.values)
    worst_joint = ""
    max_abs_goal_error = 0.0
    if goal_delta:
        worst_joint = max(goal_delta.items(), key=lambda item: abs(item[1]))[0]
        max_abs_goal_error = round(max(abs(value) for value in goal_delta.values()), 4)
    rms_goal_error = round(
        math.sqrt(sum(value * value for value in goal_delta.values()) / len(goal_delta)) if goal_delta else 0.0,
        4,
    )
    total_joint_count = max(
        leader_raw.total_count,
        follower_current.total_count,
        teleop_mapped.total_count,
        follower_goal.total_count,
    )
    emitted_joint_count = max(
        len(leader_raw.values),
        len(follower_current.values),
        len(teleop_mapped.values),
        len(follower_goal.values),
    )
    return {
        "schema_version": 1,
        "emitted_at_ms": int(time.time() * 1000),
        "loop_index": loop_index,
        "uptime_s": round(uptime_s, 3),
        "active_loop_ms": round(active_loop_ms, 3),
        "joint_count_total": total_joint_count,
        "joint_count_emitted": emitted_joint_count,
        "truncated": total_joint_count > emitted_joint_count,
        "leader_raw_pos": leader_raw.values,
        "follower_current_pos": follower_current.values,
        "teleop_action_pos": teleop_mapped.values,
        "follower_goal_pos": follower_goal.values,
        "goal_minus_current_pos": goal_delta,
        "max_abs_goal_error": max_abs_goal_error,
        "rms_goal_error": rms_goal_error,
        "worst_joint": worst_joint,
    }


def _emit_structured_debug_line(prefix: str, payload: dict[str, object]) -> None:
    sys.stdout.write(f"{prefix}{json.dumps(payload, sort_keys=True, separators=(',', ':'))}\n")
    sys.stdout.flush()


def _patch_teleop_loop(
    teleop_mod: object,
    debug_settings: TeleopDebugSettings,
    antijitter_settings: AntiJitterSettings,
    invert_settings: JointInvertSettings,
) -> None:
    if not debug_settings.enabled:
        return

    original_loop = teleop_mod.teleop_loop
    move_cursor_up = teleop_mod.move_cursor_up
    precise_sleep = teleop_mod.precise_sleep
    log_rerun_data = teleop_mod.log_rerun_data

    def debug_teleop_loop(
        teleop: object,
        robot: object,
        fps: int,
        teleop_action_processor: object,
        robot_action_processor: object,
        robot_observation_processor: object,
        display_data: bool = False,
        duration: float | None = None,
        display_compressed_images: bool = False,
    ) -> None:
        robot_obj = cast(Any, robot)
        teleop_obj = cast(Any, teleop)
        teleop_action_processor_fn = cast(Any, teleop_action_processor)
        robot_action_processor_fn = cast(Any, robot_action_processor)
        robot_observation_processor_fn = cast(Any, robot_observation_processor)

        if not hasattr(robot_obj, "action_features"):
            _emit_structured_debug_line(
                _TELEOP_DEBUG_META_PREFIX,
                {
                    "debug_enabled": debug_settings.enabled,
                    "debug_supported": False,
                    "reason": "robot_missing_action_features",
                    "schema_version": 1,
                },
            )
            return original_loop(
                teleop=teleop,
                robot=robot,
                fps=fps,
                teleop_action_processor=teleop_action_processor,
                robot_action_processor=robot_action_processor,
                robot_observation_processor=robot_observation_processor,
                display_data=display_data,
                duration=duration,
                display_compressed_images=display_compressed_images,
            )

        display_len = max(len(key) for key in cast(dict[str, object], robot_obj.action_features))
        start_time = time.perf_counter()
        last_debug_at = 0.0
        loop_index = 0
        _emit_structured_debug_line(
            _TELEOP_DEBUG_META_PREFIX,
            {
                "antijitter_alpha": antijitter_settings.alpha,
                "antijitter_deadband": antijitter_settings.deadband,
                "antijitter_enabled": antijitter_settings.enabled,
                "antijitter_max_step": antijitter_settings.max_step,
                "debug_enabled": debug_settings.enabled,
                "debug_interval_s": debug_settings.sample_interval_s,
                "debug_supported": True,
                "invert_joints": list(invert_settings.joints()),
                "schema_version": 1,
            },
        )

        while True:
            loop_start = time.perf_counter()
            observation = cast(dict[str, object], robot_obj.get_observation())
            raw_action = cast(dict[str, object], teleop_obj.get_action())
            teleop_action = cast(dict[str, object], teleop_action_processor_fn((raw_action, observation)))
            robot_action_to_send = cast(dict[str, object], robot_action_processor_fn((teleop_action, observation)))
            robot_obj.send_action(robot_action_to_send)
            loop_index += 1

            active_loop_ms = (time.perf_counter() - loop_start) * 1e3
            now = time.perf_counter()
            if now - last_debug_at >= debug_settings.sample_interval_s:
                _emit_structured_debug_line(
                    _TELEOP_DEBUG_PREFIX,
                    _build_debug_snapshot_payload(
                        loop_index=loop_index,
                        uptime_s=now - start_time,
                        active_loop_ms=active_loop_ms,
                        raw_action=raw_action,
                        observation=observation,
                        teleop_action=teleop_action,
                        robot_action=robot_action_to_send,
                    ),
                )
                last_debug_at = now

            if display_data:
                obs_transition = robot_observation_processor_fn(observation)
                log_rerun_data(
                    observation=obs_transition,
                    action=teleop_action,
                    compress_images=display_compressed_images,
                )

                print("\n" + "-" * (display_len + 10))
                print(f"{'NAME':<{display_len}} | {'NORM':>7}")
                for motor, value in robot_action_to_send.items():
                    numeric_value = _to_finite_float(value)
                    rendered = f"{numeric_value:>7.2f}" if numeric_value is not None else str(value)
                    print(f"{motor:<{display_len}} | {rendered}")
                move_cursor_up(len(robot_action_to_send) + 3)

            dt_s = time.perf_counter() - loop_start
            precise_sleep(max(1 / fps - dt_s, 0.0))
            loop_s = time.perf_counter() - loop_start
            print(f"Teleop loop time: {loop_s * 1e3:.2f}ms ({1 / loop_s:.0f} Hz)")
            move_cursor_up(1)

            if duration is not None and time.perf_counter() - start_time >= duration:
                return

    teleop_mod.teleop_loop = debug_teleop_loop
    logger.info("LeStudio teleop debug enabled (interval=%ss)", debug_settings.sample_interval_s)


def _prepend_antijitter_step(
    pipeline: Any,
    step_class: type[Any],
    settings: AntiJitterSettings,
) -> Any:
    step = step_class(
        alpha=settings.alpha,
        deadband=settings.deadband,
        max_step=settings.max_step,
        enabled=True,
    )
    pipeline.steps = [step, *list(cast(list[Any], pipeline.steps))]
    return pipeline


def _build_joint_inversion_step(settings: JointInvertSettings) -> Any:
    joints = set(settings.joints())

    class JointInvertProcessorStep:
        def __init__(self, enabled_joints: set[str]):
            self.enabled_joints = enabled_joints

        def action(self, action: dict[str, Any]) -> dict[str, Any]:
            updated = action.copy()
            for joint in self.enabled_joints:
                key = f"{joint}.pos"
                value = updated.get(key)
                if isinstance(value, (int, float)):
                    updated[key] = -value
            return updated

        def __call__(self, transition: dict[str, Any]) -> dict[str, Any]:
            updated_transition = transition.copy()
            action = updated_transition.get(_ACTION_KEY)
            if action is None or not isinstance(action, dict):
                raise ValueError(f"Action should be a RobotAction type (dict), but got {type(action)}")
            updated_transition[_ACTION_KEY] = self.action(action)
            return updated_transition

        def transform_features(self, features: dict[Any, dict[str, Any]]) -> dict[Any, dict[str, Any]]:
            return features

    return JointInvertProcessorStep(joints)


def _prepend_joint_inversion_step(pipeline: Any, settings: JointInvertSettings) -> Any:
    step = _build_joint_inversion_step(settings)
    pipeline.steps = [step, *list(cast(list[Any], pipeline.steps))]
    return pipeline


def _install_input_prompt_passthrough() -> Callable[[], None]:
    original_input = builtins.input

    def patched_input(prompt: object = "") -> str:
        prompt_text = "" if prompt is None else str(prompt)
        if prompt_text:
            if prompt_text.endswith("\n"):
                sys.stdout.write(prompt_text)
            else:
                sys.stdout.write(f"{prompt_text}\n")
            sys.stdout.flush()
            if _CALIBRATION_REUSE_PROMPT in prompt_text:
                logger.info("Auto-accepting lerobot calibration reuse prompt during teleop")
                return ""
            return original_input("")
        return original_input()

    builtins.input = patched_input

    def restore() -> None:
        builtins.input = original_input

    return restore


def main() -> None:
    antijitter_settings, filtered_args = extract_antijitter_settings()
    invert_settings, filtered_args = extract_joint_inversion_settings(filtered_args)
    debug_settings, filtered_args = extract_debug_settings(filtered_args)
    sys.argv = [sys.argv[0], *filtered_args]

    logger.info(
        "Teleop bridge starting: antijitter=%s(alpha=%.2f, deadband=%.2f, max_step=%s) "
        "invert=%s debug=%s(interval=%.2fs) remaining_args=%d",
        antijitter_settings.enabled,
        antijitter_settings.alpha,
        antijitter_settings.deadband,
        antijitter_settings.max_step,
        invert_settings.joints() or "none",
        debug_settings.enabled,
        debug_settings.sample_interval_s,
        len(filtered_args),
    )

    from .camera_patch import install_camera_patch

    install_camera_patch()

    teleop_mod = importlib.import_module("lerobot.scripts.lerobot_teleoperate")

    _patch_default_processors(teleop_mod, antijitter_settings, invert_settings)
    _patch_teleop_loop(teleop_mod, debug_settings, antijitter_settings, invert_settings)
    restore_input = _install_input_prompt_passthrough()
    try:
        teleop_mod.main()
        logger.info("Teleop bridge finished normally")
    except KeyboardInterrupt:
        logger.info("Teleop bridge interrupted by user (KeyboardInterrupt)")
    except Exception:
        logger.exception("Teleop bridge crashed with unhandled exception")
        raise
    finally:
        restore_input()


if __name__ == "__main__":
    main()
