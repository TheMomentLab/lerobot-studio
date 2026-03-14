#!/usr/bin/env python3

import builtins
import logging
import sys
import threading
from collections.abc import Callable

logger = logging.getLogger(__name__)

_CALIBRATION_REUSE_PROMPT = "Press ENTER to use provided calibration file associated with the id"


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
                logger.info("Auto-accepting lerobot calibration reuse prompt during record")
                return ""
            return original_input("")
        return original_input()

    builtins.input = patched_input

    def restore() -> None:
        builtins.input = original_input

    return restore


def _install_stdin_bridge():
    from lerobot.scripts import lerobot_record as record_mod
    from lerobot.utils import control_utils

    original = control_utils.init_keyboard_listener

    def patched_init_keyboard_listener():
        listener, events = original()

        def read_stdin():
            while True:
                line = sys.stdin.readline()
                if line == "":
                    break
                cmd = line.strip().lower()
                if cmd in {"right", "save", "next", "->"}:
                    events["exit_early"] = True
                elif cmd in {"left", "discard", "rerecord", "<-"}:
                    events["rerecord_episode"] = True
                    events["exit_early"] = True
                elif cmd in {"escape", "esc", "stop", "end"}:
                    events["stop_recording"] = True
                    events["exit_early"] = True

        threading.Thread(target=read_stdin, daemon=True).start()
        return listener, events

    control_utils.init_keyboard_listener = patched_init_keyboard_listener
    record_mod.init_keyboard_listener = patched_init_keyboard_listener

    # Force sequential video encoding to avoid ProcessPoolExecutor deadlock.
    # When this subprocess is spawned via Popen with stdin/stdout PIPE,
    # fork() inside ProcessPoolExecutor inherits the pipe file descriptors
    # and causes deadlock or silent crash during video encoding.
    from lerobot.datasets.lerobot_dataset import LeRobotDataset

    _orig_save_episode = LeRobotDataset.save_episode

    def _sequential_save_episode(self, episode_data=None, parallel_encoding=True):
        try:
            return _orig_save_episode(self, episode_data=episode_data, parallel_encoding=False)
        except ValueError as exc:
            msg = str(exc)
            if "add one or several frames" in msg:
                print("[record-bridge] skip empty episode (no frames captured before save)", flush=True)
                return None
            raise

    LeRobotDataset.save_episode = _sequential_save_episode

    return record_mod


def main():
    from lestudio.camera_patch import install_camera_patch

    install_camera_patch()
    record_mod = _install_stdin_bridge()
    restore_input = _install_input_prompt_passthrough()
    try:
        record_mod.main()
    except FileNotFoundError as exc:
        if "parquet" in str(exc) and "episodes" in str(exc):
            _auto_clean_broken_cache_and_retry(exc, record_mod)
        else:
            raise
    finally:
        restore_input()


def _auto_clean_broken_cache_and_retry(exc: FileNotFoundError, record_mod):
    """Clean corrupted local dataset cache and retry without resume.

    When ``--resume=true`` hits a broken dataset (locally cached or on Hub),
    delete the local cache and retry with ``resume=False`` so lerobot
    creates a fresh dataset instead of trying to load corrupted metadata.
    """
    import re
    import shutil
    import sys
    from pathlib import Path

    msg = str(exc)
    # Extract path from error message like:
    #   "…: /home/…/.cache/huggingface/lerobot/user/dataset/meta/episodes"
    m = re.search(r"(/\S+/meta(?:/\S*)?)", msg)
    if not m:
        raise exc

    meta_path = Path(m.group(1))
    # Go up to dataset root: …/<user>/<dataset>/meta/… → …/<user>/<dataset>
    cache_root = meta_path
    while cache_root.name != "meta" and cache_root.parent != cache_root:
        cache_root = cache_root.parent
    cache_root = cache_root.parent  # now at …/<user>/<dataset>

    if not cache_root.exists():
        raise exc
    # Safety: only clean known dataset directories (HF cache or explicit --dataset.root)
    is_hf_cache = "huggingface" in str(cache_root) or ".cache" in str(cache_root)
    has_meta = (cache_root / "meta").exists() or (cache_root / "meta").is_dir()
    if not (is_hf_cache or has_meta):
        raise exc

    print(f"[record-bridge] Broken dataset cache detected, cleaning: {cache_root}", flush=True)
    shutil.rmtree(cache_root, ignore_errors=True)

    # Strip --resume=true from sys.argv so the retry creates a fresh dataset
    sys.argv = [a for a in sys.argv if not a.startswith("--resume")]

    print("[record-bridge] Retrying record without resume…", flush=True)
    record_mod.main()


if __name__ == "__main__":
    main()
