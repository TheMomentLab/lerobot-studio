"""CORS helper utilities for LeStudio server."""
from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)

_DEFAULT_CORS_ORIGIN_REGEX = r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"


def _parse_cors_origins(raw: str | None) -> list[str]:
    if raw is None:
        return []
    origins = [origin.strip() for origin in raw.split(",")]
    return [origin for origin in origins if origin]


def _resolve_cors_settings() -> tuple[list[str], str | None]:
    origins = _parse_cors_origins(os.environ.get("LESTUDIO_CORS_ORIGINS"))
    regex_raw = (os.environ.get("LESTUDIO_CORS_ORIGIN_REGEX") or "").strip()
    origin_regex = regex_raw or None

    # Local development should work by default without allowing arbitrary origins.
    if not origins and origin_regex is None:
        origin_regex = _DEFAULT_CORS_ORIGIN_REGEX

    if origins == ["*"]:
        origin_regex = None

    return origins, origin_regex
