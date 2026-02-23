#!/usr/bin/env python3

import sys
import threading


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
    record_mod.main()


if __name__ == "__main__":
    main()
