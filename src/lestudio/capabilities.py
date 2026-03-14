from __future__ import annotations

from enum import Enum


class Capability(str, Enum):
    PROCESS_CONTROL = "process_control"
    DATASET_MUTATION = "dataset_mutation"
    HARDWARE_CONTROL = "hardware_control"
    HUB_CREDENTIALS = "hub_credentials"
    CONFIG_MUTATION = "config_mutation"
    DEVICE_CONFIG = "device_config"
    STREAM_OBSERVE = "stream_observe"


_ROUTE_CAPABILITIES: dict[str, Capability] = {}


def register(path: str, capability: Capability) -> None:
    _ROUTE_CAPABILITIES[path] = capability


def get_capability(path: str) -> Capability | None:
    if path in _ROUTE_CAPABILITIES:
        return _ROUTE_CAPABILITIES[path]
    for registered_path, cap in _ROUTE_CAPABILITIES.items():
        if _matches_pattern(registered_path, path):
            return cap
    return None


def requires_protection(path: str) -> bool:
    return get_capability(path) is not None


def _matches_pattern(pattern: str, path: str) -> bool:
    pattern_parts = pattern.split("/")
    path_parts = path.split("/")
    if len(pattern_parts) != len(path_parts):
        return False
    return all(pp.startswith("{") or pp == actual for pp, actual in zip(pattern_parts, path_parts, strict=False))
