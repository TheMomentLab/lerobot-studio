import json
import logging
import os
import re
import shlex
import signal
import subprocess
import sys
import threading
import time
from collections import deque
from collections.abc import Callable
from pathlib import Path
from typing import Any, TypedDict

logger = logging.getLogger(__name__)


class TrainMetric(TypedDict, total=False):
    total_steps: int
    step: int
    loss: float
    lr: float


class RunMeta(TypedDict, total=False):
    name: str
    pid: int
    started_at: float
    ended_at: float
    command: list[str]
    exit_code: int | None


class OrphanInfo(TypedDict):
    pid: int
    pgid: int
    cmdline_prefix: str


class QueueItem(TypedDict, total=False):
    process: str
    line: str
    kind: str
    replace: str
    metric: TrainMetric


class EventBuffer:
    def __init__(self, maxlen: int = 2000):
        self._buf: deque[tuple[int, QueueItem]] = deque(maxlen=maxlen)
        self._seq: int = 0
        self._lock = threading.Lock()
        self._subscribers: dict[int, int] = {}
        self._next_sub_id: int = 0

    def push(self, item: QueueItem) -> None:
        with self._lock:
            self._seq += 1
            self._buf.append((self._seq, item))

    def subscribe(self) -> int:
        with self._lock:
            sub_id = self._next_sub_id
            self._next_sub_id += 1
            self._subscribers[sub_id] = self._seq
            return sub_id

    def unsubscribe(self, sub_id: int) -> None:
        with self._lock:
            self._subscribers.pop(sub_id, None)

    def poll(self, sub_id: int) -> list[QueueItem]:
        with self._lock:
            last_seen = self._subscribers.get(sub_id)
            if last_seen is None:
                return []

            items = [item for seq, item in self._buf if seq > last_seen]
            if self._buf:
                self._subscribers[sub_id] = self._buf[-1][0]
            return items

    def flush_process(self, name: str) -> None:
        with self._lock:
            self._buf = deque(
                ((seq, item) for seq, item in self._buf if item.get("process") != name),
                maxlen=self._buf.maxlen,
            )


PROCESS_NAMES = ["teleop", "record", "calibrate", "motor_setup", "train", "train_install", "eval"]

# Hardware conflict groups: processes sharing the same physical resource
# must not run concurrently.
HARDWARE_GROUPS: dict[str, list[str]] = {
    "arms": ["calibrate", "teleop", "record", "motor_setup"],
    "gpu": ["train", "eval"],
}
_ANSI_CSI_RE = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")
_ANSI_OSC_RE = re.compile(r"\x1b\][^\x07]*(?:\x07|\x1b\\)")
_ANSI_ESC_RE = re.compile(r"\x1b[@-_]")
_CONTROL_CHAR_RE = re.compile(r"[\x00-\x08\x0b-\x1a\x1c-\x1f\x7f]")
_LIVE_PROGRESS_RE = re.compile(r"\b\d{1,3}%\|.*\|\s*\d+/\d+")
_TELEOP_LOOP_RE = re.compile(r"^Teleop loop time:")
_TELEOP_DEBUG_RE = re.compile(r"^\[LESTUDIO_TELEOP_DEBUG\]\s+")
_TELEOP_DEBUG_META_RE = re.compile(r"^\[LESTUDIO_TELEOP_DEBUG_META\]\s+")
_TRAIN_TOTAL_RE = re.compile(r"cfg\.steps=([0-9_,]+)", re.IGNORECASE)
_TRAIN_STEP_RE = re.compile(r"\bstep\s*[:=]\s*([0-9]+(?:\.[0-9]+)?[KMBTQ]?)", re.IGNORECASE)
_TRAIN_LOSS_RE = re.compile(r"\bloss\s*[:=]\s*([+-]?[0-9]*\.?[0-9]+(?:e[+-]?[0-9]+)?)", re.IGNORECASE)
_TRAIN_LR_RE = re.compile(r"\blr\s*[:=]\s*([+-]?[0-9]*\.?[0-9]+(?:e[+-]?[0-9]+)?)", re.IGNORECASE)

_ERR_PERMISSION_DEV_RE = re.compile(r"permission denied[^\n]*(/dev/[^\s:'\"]+)", re.IGNORECASE)
_ERR_CALIB_RE = re.compile(r"could not find calibration file|calibration file.*not found", re.IGNORECASE)
_ERR_CAMERA_OPEN_RE = re.compile(
    r"camera index\s*\d+\s*cannot be opened|cannot open camera|failed to open.*video", re.IGNORECASE
)
_ERR_CUDA_OOM_RE = re.compile(r"cuda out of memory|outofmemoryerror|cublas_status_alloc_failed", re.IGNORECASE)
_ERR_CUDA_UNAVAILABLE_RE = re.compile(
    r"cuda is not available|torch\.cuda\.is_available\(\).*false|no cuda", re.IGNORECASE
)
_ERR_MISSING_MODULE_RE = re.compile(r"ModuleNotFoundError:\s*No module named ['\"]([^'\"]+)['\"]", re.IGNORECASE)


def _translate_error_line(line: str) -> str | None:
    m_perm = _ERR_PERMISSION_DEV_RE.search(line)
    if m_perm:
        dev = m_perm.group(1)
        return f"Access denied for {dev}. Add udev rule or run: sudo chmod 666 {dev}"

    if _ERR_CALIB_RE.search(line):
        return "Calibration file is missing. Run Calibration tab first, then retry."

    if _ERR_CAMERA_OPEN_RE.search(line):
        return "Camera open failed. Check USB connection, mapping, or close other app using this camera."

    if _ERR_CUDA_OOM_RE.search(line):
        return "GPU memory is insufficient. Reduce steps/batch load or switch compute device to CPU/MPS."

    if _ERR_CUDA_UNAVAILABLE_RE.search(line):
        return "CUDA runtime is unavailable. Install compatible PyTorch CUDA build or switch to CPU/MPS."

    m_missing = _ERR_MISSING_MODULE_RE.search(line)
    if m_missing:
        pkg = m_missing.group(1)
        python = shlex.quote(sys.executable)
        return f"Missing Python package '{pkg}'. Install in the same environment: {python} -m pip install {pkg}"

    return None


def _strip_terminal_artifacts(text: str) -> str:
    cleaned = _ANSI_OSC_RE.sub("", text)
    cleaned = _ANSI_CSI_RE.sub("", cleaned)
    cleaned = _ANSI_ESC_RE.sub("", cleaned)
    return _CONTROL_CHAR_RE.sub("", cleaned)


def _parse_compact_int(token: str) -> int | None:
    raw = (token or "").strip().upper()
    m = re.match(r"^([0-9]+(?:\.[0-9]+)?)([KMBTQ]?)$", raw)
    if not m:
        try:
            return int(float(raw.replace(",", "")))
        except (TypeError, ValueError):
            return None
    base = float(m.group(1))
    suffix = m.group(2)
    scale = {"": 0, "K": 1, "M": 2, "B": 3, "T": 4, "Q": 5}.get(suffix, 0)
    return int(base * (1000**scale))


def _extract_train_metric(line: str) -> TrainMetric | None:
    metric: TrainMetric = {}
    m_total = _TRAIN_TOTAL_RE.search(line)
    if m_total:
        try:
            total = int(m_total.group(1).replace("_", "").replace(",", ""))
            if total > 0:
                metric["total_steps"] = total
        except (TypeError, ValueError):
            pass

    m_step = _TRAIN_STEP_RE.search(line)
    if m_step:
        step = _parse_compact_int(m_step.group(1))
        if step is not None and step >= 0:
            metric["step"] = step

    m_loss = _TRAIN_LOSS_RE.search(line)
    if m_loss:
        try:
            metric["loss"] = float(m_loss.group(1))
        except (TypeError, ValueError):
            pass

    m_lr = _TRAIN_LR_RE.search(line)
    if m_lr:
        try:
            metric["lr"] = float(m_lr.group(1))
        except (TypeError, ValueError):
            pass

    return metric or None


class ProcessManager:
    def __init__(
        self,
        lerobot_src: Path,
        on_process_exit: Callable[[str], None] | None = None,
        state_dir: Path | None = None,
    ):
        self.lerobot_src: Path = lerobot_src
        self.procs: dict[str, subprocess.Popen[Any]] = {}
        self.event_buffer = EventBuffer(maxlen=2000)
        self.on_process_exit: Callable[[str], None] | None = on_process_exit
        self.last_translation: dict[str, str] = {}
        self.seen_translations: dict[str, set[str]] = {}
        # Live-table dedup: buffer lines between "---" separators and
        # emit only the latest complete table block.
        self._table_buf: dict[str, list[str]] = {}
        self._table_tag: dict[str, str] = {}  # tag to identify replace events
        # ── Orphan process recovery ──────────────────────────────────────────
        self._state_dir: Path | None = state_dir
        self._orphan_pids: dict[str, OrphanInfo] = {}
        self._orphan_lock: threading.Lock = threading.Lock()
        self._orphan_monitor_stop: threading.Event = threading.Event()
        self._session_log_handles: dict[str, Any] = {}
        self._session_log_paths: dict[str, Path] = {}
        self.run_meta: dict[str, RunMeta] = {}
        self._run_history: deque[RunMeta] = deque(maxlen=50)

    # ── PID persistence helpers ──────────────────────────────────────────────

    @property
    def _state_file(self) -> Path | None:
        return self._state_dir / "running_processes.json" if self._state_dir else None

    @property
    def _logs_root(self) -> Path | None:
        return self._state_dir / "logs" if self._state_dir else None

    def _session_log_latest_path(self, name: str) -> Path | None:
        root = self._logs_root
        if root is None:
            return None
        return root / name / "latest.txt"

    def _open_session_log(self, name: str) -> Path | None:
        root = self._logs_root
        if root is None:
            return None
        log_dir = root / name
        timestamp = time.strftime("%Y%m%d-%H%M%S")
        path = log_dir / f"{timestamp}.log"
        try:
            log_dir.mkdir(parents=True, exist_ok=True)
            handle = path.open("w", encoding="utf-8", buffering=1)
            self._session_log_handles[name] = handle
            self._session_log_paths[name] = path
            latest = self._session_log_latest_path(name)
            if latest is not None:
                latest.write_text(str(path) + "\n", encoding="utf-8")
            return path
        except OSError:
            return None

    def _write_session_log(self, name: str, text: str) -> None:
        handle = self._session_log_handles.get(name)
        if handle is None:
            return
        try:
            handle.write(text + "\n")
            handle.flush()
        except OSError:
            self._close_session_log(name)

    def _close_session_log(self, name: str) -> None:
        handle = self._session_log_handles.pop(name, None)
        self._session_log_paths.pop(name, None)
        if handle is None:
            return
        try:
            handle.close()
        except OSError:
            pass

    def _persist_state(self) -> None:
        """Write all running process PIDs to disk so they survive server restart."""
        sf = self._state_file
        if sf is None:
            return
        state: dict[str, OrphanInfo] = {}
        for name, proc in list(self.procs.items()):
            if proc.poll() is None:
                try:
                    pgid = os.getpgid(proc.pid)
                except (ProcessLookupError, OSError):
                    pgid = proc.pid
                state[name] = {
                    "pid": proc.pid,
                    "pgid": pgid,
                    "cmdline_prefix": self._read_cmdline(proc.pid),
                }
        with self._orphan_lock:
            for name, info in self._orphan_pids.items():
                if name not in state and self._is_pid_alive(info["pid"]):
                    state[name] = info
        try:
            sf.parent.mkdir(parents=True, exist_ok=True)
            sf.write_text(json.dumps(state, indent=2))
        except OSError:
            pass

    def _remove_from_state(self, name: str) -> None:
        """Remove a single process entry from the persisted state file."""
        sf = self._state_file
        if sf is None:
            return
        try:
            if sf.exists():
                raw = json.loads(sf.read_text())
                if isinstance(raw, dict) and name in raw:
                    del raw[name]
                    sf.write_text(json.dumps(raw, indent=2))
        except (OSError, json.JSONDecodeError):
            pass

    # ── PID validation ───────────────────────────────────────────────────────

    @staticmethod
    def _is_pid_alive(pid: int) -> bool:
        """Check whether *pid* is still running."""
        try:
            os.kill(pid, 0)
            return True
        except (ProcessLookupError, PermissionError, OSError):
            return False

    @staticmethod
    def _read_cmdline(pid: int) -> str:
        """Read ``/proc/{pid}/cmdline`` for PID-reuse validation."""
        try:
            data = Path(f"/proc/{pid}/cmdline").read_bytes()
            return data.replace(b"\x00", b" ").decode("utf-8", errors="replace").strip()
        except (OSError, PermissionError):
            return ""

    @classmethod
    def _validate_orphan_pid(cls, pid: int, saved_cmdline: str) -> bool:
        """Return True if *pid* is alive AND likely the same command (not PID reuse)."""
        if not cls._is_pid_alive(pid):
            return False
        if not saved_cmdline:
            return True
        current_cmdline = cls._read_cmdline(pid)
        if not current_cmdline:
            return True  # cannot read — trust the PID
        # Compare first few tokens to guard against PID recycling
        saved_tokens = set(saved_cmdline.lower().split()[:6])
        current_tokens = set(current_cmdline.lower().split()[:6])
        return len(saved_tokens & current_tokens) >= 2

    # ── Orphan recovery ──────────────────────────────────────────────────────

    def recover_orphans(self) -> None:
        """On startup, detect still-running processes from a previous server session."""
        sf = self._state_file
        if sf is None or not sf.exists():
            return
        try:
            state = json.loads(sf.read_text())
            if not isinstance(state, dict):
                return
        except (OSError, json.JSONDecodeError):
            return

        recovered: list[str] = []
        with self._orphan_lock:
            for name, info in state.items():
                pid = info.get("pid")
                if not pid or name in self.procs:
                    continue
                if self._validate_orphan_pid(pid, info.get("cmdline_prefix", "")):
                    self._orphan_pids[name] = info
                    recovered.append(name)
                    self._push(
                        name,
                        f"[Reconnected to running process (PID {pid}) — live output unavailable]",
                        "info",
                    )
                    logger.info("Recovered orphan process: %s (PID %d)", name, pid)

        if recovered:
            self._start_orphan_monitor()
        # Rewrite state: dead entries removed, alive entries kept
        self._persist_state()

    def _start_orphan_monitor(self) -> None:
        """Launch a daemon thread that polls orphan PIDs for liveness."""
        self._orphan_monitor_stop.clear()
        threading.Thread(target=self._orphan_monitor_loop, daemon=True).start()

    def _orphan_monitor_loop(self) -> None:
        while not self._orphan_monitor_stop.wait(2.0):
            dead: list[str] = []
            with self._orphan_lock:
                for name, info in list(self._orphan_pids.items()):
                    if not self._is_pid_alive(info["pid"]):
                        dead.append(name)
                for name in dead:
                    del self._orphan_pids[name]

            for name in dead:
                self._push(name, f"[{name} process ended]", "info")
                self._remove_from_state(name)
                if self.on_process_exit is not None:
                    try:
                        self.on_process_exit(name)
                    except Exception:  # broad-except: monitor must not crash
                        pass
                logger.info("Orphan process ended: %s", name)

            with self._orphan_lock:
                if not self._orphan_pids:
                    break

    def _kill_orphan_process(self, info: OrphanInfo) -> None:
        """Send escalating signals to an orphan process (by PID/PGID)."""
        pid = info["pid"]
        pgid = info.get("pgid", pid)

        if sys.platform == "win32":
            try:
                os.kill(pid, signal.SIGTERM)
            except (ProcessLookupError, OSError):
                pass
            return

        for sig, timeout in [
            (signal.SIGINT, 5),
            (signal.SIGTERM, 3),
            (signal.SIGKILL, 1),
        ]:
            target_is_group = pgid and pgid != pid
            try:
                if target_is_group:
                    os.killpg(pgid, sig)
                else:
                    os.kill(pid, sig)
            except (ProcessLookupError, OSError):
                return
            deadline = time.monotonic() + timeout
            while time.monotonic() < deadline:
                if not self._is_pid_alive(pid):
                    return
                time.sleep(0.1)

    # ── Public helpers ───────────────────────────────────────────────────────

    def is_orphan(self, name: str) -> bool:
        """Return True if *name* is tracked as a reconnected orphan (no live output)."""
        with self._orphan_lock:
            info = self._orphan_pids.get(name)
            return info is not None and self._is_pid_alive(info["pid"])

    # ── Core process lifecycle ───────────────────────────────────────────────

    def flush_queue(self, name: str):
        self.event_buffer.flush_process(name)

    def start(self, name: str, args: list[str]) -> bool:
        self.stop(name)
        self._close_session_log(name)
        # Clear any leftover orphan entry for this name
        with self._orphan_lock:
            self._orphan_pids.pop(name, None)
        self.flush_queue(name)
        self.last_translation.pop(name, None)
        self.seen_translations.pop(name, None)
        self._table_buf.pop(name, None)
        self._table_tag.pop(name, None)
        self.run_meta[name] = RunMeta(
            name=name,
            pid=0,
            started_at=time.time(),
            command=args,
        )
        logger.info("Starting process %s: %s", name, shlex.join(args))
        env = {
            **os.environ,
            "PYTHONPATH": str(self.lerobot_src) + os.pathsep + os.environ.get("PYTHONPATH", ""),
            "PYTHONUNBUFFERED": "1",
        }
        try:
            popen_kwargs: dict[str, Any] = dict(
                args=args,
                env=env,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                bufsize=0,
            )
            if sys.platform == "win32":
                popen_kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
            else:
                popen_kwargs["start_new_session"] = True
            proc = subprocess.Popen(**popen_kwargs)
            self.procs[name] = proc
            self.run_meta[name]["pid"] = proc.pid
            logger.info("Process %s launched: PID=%d", name, proc.pid)
            session_log_path = self._open_session_log(name) if name == "teleop" else None
            threading.Thread(target=self._reader, args=(name, proc), daemon=True).start()
            if session_log_path is not None:
                self._push(name, f"[Saved live log to {session_log_path}]", "info")
            self._persist_state()
            return True
        except Exception as e:  # broad-except: preserve process start failure handling for any launcher error
            logger.error("Process %s failed to launch: %s", name, e)
            self._close_session_log(name)
            self._push(name, f"[ERROR] {e}", "error")
            return False

    def stop(self, name: str):
        proc = self.procs.get(name)
        if proc and proc.poll() is None:

            def _kill():
                try:
                    self._kill_proc(proc)
                finally:
                    self.procs.pop(name, None)
                    self._remove_from_state(name)

            threading.Thread(target=_kill, daemon=True).start()
            return

        self.procs.pop(name, None)

        # Handle orphan processes
        with self._orphan_lock:
            info = self._orphan_pids.pop(name, None)
        if info:

            def _kill_orphan():
                self._kill_orphan_process(info)
                self._remove_from_state(name)
                self._push(name, f"[{name} process stopped]", "info")
                if self.on_process_exit is not None:
                    try:
                        self.on_process_exit(name)
                    except Exception:  # broad-except: exit hook must not break stop path
                        pass

            threading.Thread(target=_kill_orphan, daemon=True).start()

    @staticmethod
    def _kill_proc(proc: subprocess.Popen[Any]):
        """Escalate signals: SIGINT → SIGTERM → SIGKILL."""
        if sys.platform == "win32":
            try:
                proc.send_signal(signal.CTRL_BREAK_EVENT)
                proc.wait(timeout=5)
                return
            except (subprocess.TimeoutExpired, OSError):
                pass
            proc.kill()
            return

        # Unix: use process group for clean shutdown
        try:
            pgid = os.getpgid(proc.pid)
        except (ProcessLookupError, OSError):
            pgid = None

        try:
            if pgid is not None:
                os.killpg(pgid, signal.SIGINT)
            else:
                proc.send_signal(signal.SIGINT)
            proc.wait(timeout=5)
            return
        except subprocess.TimeoutExpired:
            pass

        if pgid is not None:
            try:
                os.killpg(pgid, signal.SIGTERM)
            except ProcessLookupError:
                return
        else:
            proc.terminate()

        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            if pgid is not None:
                try:
                    os.killpg(pgid, signal.SIGKILL)
                except ProcessLookupError:
                    return
            else:
                proc.kill()

    def send_input(self, name: str, text: str) -> bool:
        proc = self.procs.get(name)
        if not (proc and proc.poll() is None and proc.stdin):
            return False
        try:
            proc.stdin.write((text + "\n").encode())
            proc.stdin.flush()
            return True
        except (BrokenPipeError, OSError):
            return False

    def is_running(self, name: str) -> bool:
        proc = self.procs.get(name)
        if proc is not None and proc.poll() is None:
            return True
        # Also check orphan processes adopted from a previous server session
        with self._orphan_lock:
            info = self._orphan_pids.get(name)
            if info and self._is_pid_alive(info["pid"]):
                return True
        return False

    def status_all(self) -> dict[str, bool]:
        return {n: self.is_running(n) for n in PROCESS_NAMES}

    def get_run_meta(self, name: str) -> RunMeta | None:
        return self.run_meta.get(name)

    def get_run_history(self, limit: int = 20) -> list[RunMeta]:
        return list(self._run_history)[-limit:]

    def conflicting_processes(self, name: str) -> list[str]:
        """Return running process names that share a hardware group with *name*."""
        conflicts: list[str] = []
        for group in HARDWARE_GROUPS.values():
            if name in group:
                conflicts.extend(n for n in group if n != name and self.is_running(n))
        return list(dict.fromkeys(conflicts))  # dedupe, preserve order

    _TABLE_SEP_RE = re.compile(r"^-{5,}$")

    def _flush_table(self, name: str):
        """Emit the buffered table block as a single 'replace_table' message."""
        buf = self._table_buf.pop(name, None)
        tag = self._table_tag.get(name, f"{name}:table")
        if buf:
            combined = "\n".join(buf)
            self._write_session_log(name, combined)
            self._push(name, combined, "stdout", replace=tag)

    @staticmethod
    def _replace_tag(name: str, suffix: str) -> str:
        return f"{name}:{suffix}"

    @staticmethod
    def _looks_like_live_progress(text: str) -> bool:
        return bool(_LIVE_PROGRESS_RE.search(text))

    def _process_line(self, name: str, text: str):
        """Process a single decoded line: push to queue, translate errors, extract train metrics."""
        if not text:
            return

        # Live-table dedup: detect "---" separator lines and buffer the table block.
        if self._TABLE_SEP_RE.match(text):
            # New separator = start of a new table redraw → flush previous and start fresh
            self._flush_table(name)
            self._table_buf[name] = [text]
            return

        if name in self._table_buf:
            # Inside a table block: accumulate lines containing "|"
            if "|" in text:
                self._table_buf[name].append(text)
                return
            else:
                # Non-table line → flush the table and process this line normally
                self._flush_table(name)

        if self._looks_like_live_progress(text):
            replace = self._replace_tag(name, "progress")
        elif _TELEOP_DEBUG_META_RE.match(text):
            replace = self._replace_tag(name, "teleop_debug_meta")
        elif _TELEOP_DEBUG_RE.match(text):
            replace = self._replace_tag(name, "teleop_debug")
        elif _TELEOP_LOOP_RE.match(text):
            replace = self._replace_tag(name, "teleop_loop")
        else:
            replace = None
        self._write_session_log(name, text)
        self._push(name, text, "stdout", replace=replace)
        translated = _translate_error_line(text)
        if translated is not None:
            self._push_translation(name, translated)
        if name == "train":
            metric = _extract_train_metric(text)
            if metric is not None:
                self._push_metric(name, metric)

    @staticmethod
    def _decode_line(raw: bytes) -> str:
        """Decode a raw line, handling \\r (carriage-return) overwrites.

        Programs like lerobot calibrate use \\r to redraw a table in-place.
        We keep only the last \\r segment so the console shows the final
        state instead of accumulating every intermediate redraw.
        """
        decoded = raw.decode("utf-8", errors="replace")
        # Take only text after the last \r (carriage-return overwrite)
        if "\r" in decoded:
            parts = decoded.split("\r")
            decoded = next((part for part in reversed(parts) if part), "")
        decoded = _strip_terminal_artifacts(decoded)
        return decoded.strip("\r\n")

    def _flush_partial_buffer(self, name: str, buf: bytes) -> bytes:
        if not buf:
            return buf

        if b"\n" in buf:
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                text = self._decode_line(line)
                if text:
                    self._process_line(name, text)
            return buf

        if b"\r" not in buf:
            return buf

        text = self._decode_line(buf)
        if text:
            self._write_session_log(name, text)
            self._push(name, text, "stdout", replace=self._replace_tag(name, "progress"))
        return b""

    def _reader(self, name: str, proc: subprocess.Popen[Any]):
        import select as sel

        if proc.stdout is None:
            return
        buf = b""
        while True:
            try:
                r, _, _ = sel.select([proc.stdout], [], [], 0.1)
            except (OSError, ValueError):
                break
            if r:
                chunk = proc.stdout.read(4096)
                if not chunk:
                    break
                buf += chunk
                while b"\n" in buf:
                    line, buf = buf.split(b"\n", 1)
                    text = self._decode_line(line)
                    if text:
                        self._process_line(name, text)
            else:
                if buf:
                    buf = self._flush_partial_buffer(name, buf)
                if proc.poll() is not None:
                    break
        if buf:
            buf = self._flush_partial_buffer(name, buf)
            if buf:
                text = self._decode_line(buf)
                if text:
                    self._process_line(name, text)
        # Flush any remaining table buffer
        self._flush_table(name)
        exit_code = proc.poll()
        if name in self.run_meta:
            self.run_meta[name]["ended_at"] = time.time()
            self.run_meta[name]["exit_code"] = exit_code
            self._run_history.append(self.run_meta.pop(name))
        logger.info("Process %s ended: exit_code=%s PID=%d", name, exit_code, proc.pid)
        exit_msg = f"[{name} process ended (exit code: {exit_code})]"
        self._write_session_log(name, exit_msg)
        self._push(name, exit_msg, "info")
        self._remove_from_state(name)
        self._close_session_log(name)
        if self.on_process_exit is not None:
            try:
                self.on_process_exit(name)
            except Exception:  # broad-except: process-exit hook should never break reader shutdown path
                pass

    def _push(self, name: str, line: str, kind: str, replace: str | None = None):
        payload: QueueItem = {"process": name, "line": line, "kind": kind}
        if replace:
            payload["replace"] = replace
        self.event_buffer.push(payload)

    def _push_metric(self, name: str, metric: TrainMetric):
        self.event_buffer.push({"process": name, "kind": "metric", "metric": metric})

    def _push_translation(self, name: str, message: str):
        seen = self.seen_translations.setdefault(name, set())
        if message in seen:
            return
        prev = self.last_translation.get(name)
        if prev == message:
            return
        seen.add(message)
        self.last_translation[name] = message
        self.event_buffer.push({"process": name, "line": f"[GUIDE] {message}", "kind": "translation"})
