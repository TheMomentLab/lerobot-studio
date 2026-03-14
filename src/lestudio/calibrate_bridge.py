import builtins
import importlib
import sys
from collections.abc import Callable


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
            return original_input("")
        return original_input()

    builtins.input = patched_input

    def restore() -> None:
        builtins.input = original_input

    return restore


def main() -> None:
    calibrate_mod = importlib.import_module("lerobot.scripts.lerobot_calibrate")
    restore_input = _install_input_prompt_passthrough()
    try:
        calibrate_mod.main()
    finally:
        restore_input()


if __name__ == "__main__":
    main()
