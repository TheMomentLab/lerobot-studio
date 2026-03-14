"""Shared application state passed to all route factories."""

from __future__ import annotations

import datetime
import json
import logging
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from lestudio._config_helpers import _load_config, _save_config
from lestudio.process_manager import ProcessManager

logger = logging.getLogger(__name__)


@dataclass
class DatasetJobState:
    push_jobs: dict[str, dict[str, Any]] = field(default_factory=dict)
    push_jobs_lock: threading.Lock = field(default_factory=threading.Lock)
    download_jobs: dict[str, dict[str, Any]] = field(default_factory=dict)
    download_jobs_lock: threading.Lock = field(default_factory=threading.Lock)
    derive_jobs: dict[str, dict[str, Any]] = field(default_factory=dict)
    derive_jobs_lock: threading.Lock = field(default_factory=threading.Lock)
    derive_procs: dict[str, Any] = field(default_factory=dict)
    derive_procs_lock: threading.Lock = field(default_factory=threading.Lock)
    stats_jobs: dict[str, dict[str, Any]] = field(default_factory=dict)
    stats_jobs_lock: threading.Lock = field(default_factory=threading.Lock)
    stats_cancel_events: dict[str, threading.Event] = field(default_factory=dict)
    stats_cancel_lock: threading.Lock = field(default_factory=threading.Lock)


@dataclass
class AppState:
    proc_mgr: ProcessManager
    config_path: Path
    config_dir: Path
    rules_path: Path
    fallback_rules_path: Path
    history_path: Path
    history_max: int
    python_exe: str
    dataset_jobs: DatasetJobState = field(default_factory=DatasetJobState)
    device_watcher: object | None = None

    def load_config(self) -> dict:
        return _load_config(self.config_path)

    def save_config(self, cfg: dict) -> None:
        _save_config(self.config_path, cfg)

    def append_history(self, event_type: str, meta: dict | None = None) -> None:
        """Append a session event to history.json (best-effort, never raises)."""
        entry = {
            "ts": datetime.datetime.now().isoformat(timespec="seconds"),
            "type": event_type,
            "meta": meta or {},
        }
        try:
            if self.history_path.exists():
                entries = json.loads(self.history_path.read_text())
                if not isinstance(entries, list):
                    entries = []
            else:
                entries = []
            entries.append(entry)
            if len(entries) > self.history_max:
                entries = entries[-self.history_max :]
            self.history_path.write_text(json.dumps(entries, indent=2))
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            pass
