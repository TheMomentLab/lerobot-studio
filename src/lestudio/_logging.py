"""Centralized logging configuration for LeStudio."""

import logging
import sys


def configure_logging(*, level: int = logging.INFO) -> None:
    """Configure root logger for LeStudio.

    Called once at server startup. Uses a simple format suitable for
    both development and production (systemd/docker captures stdout).
    """
    fmt = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
    datefmt = "%Y-%m-%d %H:%M:%S"

    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(logging.Formatter(fmt, datefmt=datefmt))

    root = logging.getLogger("lestudio")
    root.setLevel(level)
    root.addHandler(handler)

    # Quiet noisy third-party loggers
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
