import os
import queue
import re
import signal
import subprocess
import threading
from pathlib import Path
from typing import Callable

PROCESS_NAMES = ["teleop", "record", "calibrate", "motor_setup", "train", "train_install", "eval"]
_ANSI_RE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
_TRAIN_TOTAL_RE = re.compile(r"cfg\.steps=([0-9_,]+)", re.IGNORECASE)
_TRAIN_STEP_RE = re.compile(r"\bstep\s*[:=]\s*([0-9]+(?:\.[0-9]+)?[KMBTQ]?)", re.IGNORECASE)
_TRAIN_LOSS_RE = re.compile(r"\bloss\s*[:=]\s*([+-]?[0-9]*\.?[0-9]+(?:e[+-]?[0-9]+)?)", re.IGNORECASE)
_TRAIN_LR_RE = re.compile(r"\blr\s*[:=]\s*([+-]?[0-9]*\.?[0-9]+(?:e[+-]?[0-9]+)?)", re.IGNORECASE)

_ERR_PERMISSION_DEV_RE = re.compile(r"permission denied[^\n]*(/dev/[^\s:'\"]+)", re.IGNORECASE)
_ERR_CALIB_RE = re.compile(r"could not find calibration file|calibration file.*not found", re.IGNORECASE)
_ERR_CAMERA_OPEN_RE = re.compile(r"camera index\s*\d+\s*cannot be opened|cannot open camera|failed to open.*video", re.IGNORECASE)
_ERR_CUDA_OOM_RE = re.compile(r"cuda out of memory|outofmemoryerror|cublas_status_alloc_failed", re.IGNORECASE)
_ERR_CUDA_UNAVAILABLE_RE = re.compile(r"cuda is not available|torch\.cuda\.is_available\(\).*false|no cuda", re.IGNORECASE)


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

    return None


def _parse_compact_int(token: str) -> int | None:
    raw = (token or "").strip().upper()
    m = re.match(r"^([0-9]+(?:\.[0-9]+)?)([KMBTQ]?)$", raw)
    if not m:
        try:
            return int(float(raw.replace(",", "")))
        except Exception:
            return None
    base = float(m.group(1))
    suffix = m.group(2)
    scale = {"": 0, "K": 1, "M": 2, "B": 3, "T": 4, "Q": 5}.get(suffix, 0)
    return int(base * (1000 ** scale))


def _extract_train_metric(line: str) -> dict | None:
    metric: dict = {}
    m_total = _TRAIN_TOTAL_RE.search(line)
    if m_total:
        try:
            total = int(m_total.group(1).replace("_", "").replace(",", ""))
            if total > 0:
                metric["total_steps"] = total
        except Exception:
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
        except Exception:
            pass

    m_lr = _TRAIN_LR_RE.search(line)
    if m_lr:
        try:
            metric["lr"] = float(m_lr.group(1))
        except Exception:
            pass

    return metric or None


class ProcessManager:
    def __init__(self, lerobot_src: Path, on_process_exit: Callable[[str], None] | None = None):
        self.lerobot_src = lerobot_src
        self.procs: dict[str, subprocess.Popen] = {}
        self.out_q: queue.Queue = queue.Queue(maxsize=1000)
        self.on_process_exit = on_process_exit

    def flush_queue(self, name: str):
        items = []
        while True:
            try:
                item = self.out_q.get_nowait()
                if item["process"] != name:
                    items.append(item)
            except queue.Empty:
                break
        for item in items:
            try:
                self.out_q.put_nowait(item)
            except queue.Full:
                pass

    def start(self, name: str, args: list[str]) -> bool:
        self.stop(name)
        self.flush_queue(name)
        env = {
            **os.environ,
            "PYTHONPATH": str(self.lerobot_src) + ":" + os.environ.get("PYTHONPATH", ""),
            "PYTHONUNBUFFERED": "1",
        }
        try:
            proc = subprocess.Popen(
                args,
                env=env,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                bufsize=0,
                start_new_session=True,
            )
            self.procs[name] = proc
            threading.Thread(target=self._reader, args=(name, proc), daemon=True).start()
            return True
        except Exception as e:
            self._push(name, f"[ERROR] {e}", "error")
            return False

    def stop(self, name: str):
        proc = self.procs.pop(name, None)
        if proc and proc.poll() is None:
            try:
                pgid = os.getpgid(proc.pid)
            except Exception:
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

    def send_input(self, name: str, text: str):
        proc = self.procs.get(name)
        if proc and proc.poll() is None and proc.stdin:
            try:
                proc.stdin.write((text + "\n").encode())
                proc.stdin.flush()
            except Exception:
                pass

    def is_running(self, name: str) -> bool:
        proc = self.procs.get(name)
        return proc is not None and proc.poll() is None

    def status_all(self) -> dict:
        return {n: self.is_running(n) for n in PROCESS_NAMES}

    def _reader(self, name: str, proc: subprocess.Popen):
        import select as sel

        if proc.stdout is None:
            return
        buf = b""
        while True:
            try:
                r, _, _ = sel.select([proc.stdout], [], [], 0.1)
            except Exception:
                break
            if r:
                chunk = proc.stdout.read(256)
                if not chunk:
                    break
                buf += chunk
                while b"\n" in buf:
                    line, buf = buf.split(b"\n", 1)
                    text = _ANSI_RE.sub("", line.decode("utf-8", errors="replace").rstrip("\r"))
                    if text:
                        self._push(name, text, "stdout")
                        translated = _translate_error_line(text)
                        if translated is not None:
                            self._push_translation(name, translated)
                        if name == "train":
                            metric = _extract_train_metric(text)
                            if metric is not None:
                                self._push_metric(name, metric)
            else:
                if buf:
                    text = _ANSI_RE.sub("", buf.decode("utf-8", errors="replace").rstrip("\r"))
                    if text:
                        self._push(name, text, "stdout")
                        translated = _translate_error_line(text)
                        if translated is not None:
                            self._push_translation(name, translated)
                        if name == "train":
                            metric = _extract_train_metric(text)
                            if metric is not None:
                                self._push_metric(name, metric)
                    buf = b""
                if proc.poll() is not None:
                    break
        if buf:
            text = _ANSI_RE.sub("", buf.decode("utf-8", errors="replace").rstrip("\r"))
            if text:
                self._push(name, text, "stdout")
                translated = _translate_error_line(text)
                if translated is not None:
                    self._push_translation(name, translated)
                if name == "train":
                    metric = _extract_train_metric(text)
                    if metric is not None:
                        self._push_metric(name, metric)
        self._push(name, f"[{name} process ended]", "info")
        if self.on_process_exit is not None:
            try:
                self.on_process_exit(name)
            except Exception:
                pass

    def _push(self, name: str, line: str, kind: str):
        try:
            self.out_q.put_nowait({"process": name, "line": line, "kind": kind})
        except queue.Full:
            pass

    def _push_metric(self, name: str, metric: dict):
        try:
            self.out_q.put_nowait({"process": name, "kind": "metric", "metric": metric})
        except queue.Full:
            pass

    def _push_translation(self, name: str, message: str):
        try:
            self.out_q.put_nowait({"process": name, "line": f"[GUIDE] {message}", "kind": "translation"})
        except queue.Full:
            pass
