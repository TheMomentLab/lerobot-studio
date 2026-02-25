from __future__ import annotations

import queue
from pathlib import Path

from lestudio.process_manager import ProcessManager, _extract_train_metric, _parse_compact_int, _translate_error_line


def test_translate_error_line_known_patterns():
    msg = _translate_error_line("Permission denied: /dev/video0")
    assert msg is not None and "/dev/video0" in msg

    msg = _translate_error_line("could not find calibration file for robot")
    assert msg is not None and "Calibration file is missing" in msg

    msg = _translate_error_line("ModuleNotFoundError: No module named 'httpx'")
    assert msg is not None and "pip install httpx" in msg


def test_translate_error_line_unknown_returns_none():
    assert _translate_error_line("all good") is None


def test_parse_compact_int_supports_suffixes():
    assert _parse_compact_int("1.5K") == 1500
    assert _parse_compact_int("2M") == 2_000_000
    assert _parse_compact_int("42") == 42
    assert _parse_compact_int("bad") is None


def test_extract_train_metric_parses_multiple_values():
    metric = _extract_train_metric("cfg.steps=100_000 step=1.5K loss=0.12 lr=1e-4")
    assert metric is not None
    assert metric["total_steps"] == 100_000
    assert metric["step"] == 1500
    assert metric["loss"] == 0.12
    assert metric["lr"] == 1e-4


def test_extract_train_metric_none_when_no_match():
    assert _extract_train_metric("hello world") is None


def test_conflicting_processes_dedupes_and_respects_running(monkeypatch):
    pm = ProcessManager(Path("/tmp/lerobot-src"))
    monkeypatch.setattr(pm, "is_running", lambda name: name in {"record", "calibrate"})
    assert pm.conflicting_processes("teleop") == ["calibrate", "record"]
    assert pm.conflicting_processes("train") == []


def test_flush_queue_removes_entries_for_target_process():
    pm = ProcessManager(Path("/tmp/lerobot-src"))
    pm.out_q.put_nowait({"process": "train", "line": "1"})
    pm.out_q.put_nowait({"process": "teleop", "line": "2"})
    pm.flush_queue("train")

    got = []
    while True:
        try:
            got.append(pm.out_q.get_nowait())
        except queue.Empty:
            break
    assert got == [{"process": "teleop", "line": "2"}]


def test_push_translation_deduplicates():
    pm = ProcessManager(Path("/tmp/lerobot-src"))
    pm._push_translation("train", "same")
    pm._push_translation("train", "same")
    pm._push_translation("train", "other")

    items = []
    while True:
        try:
            items.append(pm.out_q.get_nowait())
        except queue.Empty:
            break
    assert len(items) == 2
    assert items[0]["kind"] == "translation"
    assert items[1]["line"].endswith("other")


def test_start_handles_popen_failure(monkeypatch):
    pm = ProcessManager(Path("/tmp/lerobot-src"))

    def boom(*args, **kwargs):
        raise RuntimeError("fail")

    monkeypatch.setattr("subprocess.Popen", boom)
    ok = pm.start("train", ["python", "-V"])
    assert ok is False
    item = pm.out_q.get_nowait()
    assert item["kind"] == "error"


def test_send_input_returns_false_for_not_running_process():
    pm = ProcessManager(Path("/tmp/lerobot-src"))
    assert pm.send_input("train", "hello") is False
