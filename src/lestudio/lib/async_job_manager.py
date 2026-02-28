"""Generic async job lifecycle helpers."""
from __future__ import annotations

import threading
import time
from typing import Any, TypeAlias

TERMINAL_JOB_STATUS = {"success", "error", "cancelled"}

JobEntry: TypeAlias = dict[str, Any]
JobMap: TypeAlias = dict[str, JobEntry]


def _cleanup_finished_jobs(
    lock: threading.Lock,
    jobs: JobMap,
    ttl_seconds: int = 3600,
    max_finished: int = 200,
) -> None:
    now = time.time()
    with lock:
        stale = [
            jid
            for jid, job in jobs.items()
            if str(job.get("status", "")) in TERMINAL_JOB_STATUS
            and now - float(job.get("updated_at", now)) > ttl_seconds
        ]
        for jid in stale:
            jobs.pop(jid, None)

        finished = [
            (jid, float(job.get("updated_at", 0.0)))
            for jid, job in jobs.items()
            if str(job.get("status", "")) in TERMINAL_JOB_STATUS
        ]
        if len(finished) > max_finished:
            finished.sort(key=lambda x: x[1])
            for jid, _ in finished[:-max_finished]:
                jobs.pop(jid, None)
