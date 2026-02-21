import argparse
import sys
import os
import time
import socket
import threading
import webbrowser
from pathlib import Path


def find_lerobot_src() -> Path | None:
    for candidate in [
        Path.cwd() / "src" / "lerobot",
        Path.cwd() / "lerobot" / "src" / "lerobot",
        Path.cwd() / "reference" / "lerobot" / "src",
    ]:
        if candidate.is_dir():
            return candidate.parent

    try:
        import lerobot
        module_file = getattr(lerobot, "__file__", None)
        if isinstance(module_file, str) and module_file:
            return Path(module_file).parent
    except ImportError:
        pass

    return None


def get_local_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def open_browser(port: int):
    time.sleep(1.5)
    webbrowser.open(f"http://localhost:{port}")


def main():
    parser = argparse.ArgumentParser(
        prog="lerobot-studio",
        description="LeRobot Studio",
    )
    parser.add_argument(
        "--port", type=int, default=7860,
        help="Server port (default: 7860)",
    )
    parser.add_argument(
        "--host", default="0.0.0.0",
        help="Server host (default: 0.0.0.0)",
    )
    parser.add_argument(
        "--lerobot-path", type=Path, default=None,
        help="Path to lerobot source (auto-detected if installed)",
    )
    parser.add_argument(
        "--config-dir", type=Path, default=None,
        help="Config directory (default: ~/.config/lerobot-studio)",
    )
    parser.add_argument(
        "--rules-path", type=Path, default=Path("/etc/udev/rules.d/99-lerobot.rules"),
        help="Path to udev rules file",
    )
    parser.add_argument(
        "--no-browser", action="store_true",
        help="Do not open a browser automatically",
    )
    parser.add_argument(
        "--headless", action="store_true",
        help="Alias for --no-browser",
    )
    args = parser.parse_args()

    lerobot_src = args.lerobot_path
    if lerobot_src is None:
        lerobot_src = find_lerobot_src()
    if lerobot_src is None:
        print("ERROR: Cannot find lerobot source.", file=sys.stderr)
        print("Install lerobot (`pip install lerobot`) or pass --lerobot-path", file=sys.stderr)
        sys.exit(1)

    lerobot_src = lerobot_src.resolve()
    if not lerobot_src.is_dir():
        print(f"ERROR: --lerobot-path does not exist: {lerobot_src}", file=sys.stderr)
        sys.exit(1)

    if args.config_dir is not None:
        config_dir = args.config_dir
    else:
        new_default = Path.home() / ".config" / "lerobot-studio"
        moment_default = Path.home() / ".config" / "moment-lerobot-studio"
        legacy_default = Path.home() / ".config" / "lerobot-setup"
        if new_default.exists():
            config_dir = new_default
        elif moment_default.exists():
            config_dir = moment_default
        elif legacy_default.exists():
            config_dir = legacy_default
        else:
            config_dir = new_default
    config_dir.mkdir(parents=True, exist_ok=True)

    from lerobot_studio.server import create_app
    import uvicorn

    app = create_app(
        lerobot_src=lerobot_src,
        config_dir=config_dir,
        rules_path=args.rules_path,
    )

    print(f"🤖  LeRobot Studio v{_version()}")
    print(f"    lerobot: {lerobot_src}")
    print(f"    config:  {config_dir}")
    print(f"    Open (Local):   http://localhost:{args.port}")
    if args.host == "0.0.0.0":
        print(f"    Open (Network): http://{get_local_ip()}:{args.port}")
    print("\n")

    if not args.no_browser and not args.headless:
        is_ssh = "SSH_CLIENT" in os.environ or "SSH_TTY" in os.environ
        has_display = "DISPLAY" in os.environ or os.name == "nt"
        
        if not is_ssh and has_display:
            threading.Thread(target=open_browser, args=(args.port,), daemon=True).start()

    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


def _version() -> str:
    from lerobot_studio import __version__
    return __version__
