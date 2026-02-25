import argparse
import os
import re
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path


DEFAULT_RULES_PATH = Path("/etc/udev/rules.d/99-lerobot.rules")


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
            return Path(module_file).parent.parent  # return src/ not src/lerobot/
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


def resolve_config_dir(config_dir_arg: Path | None) -> Path:
    if config_dir_arg is not None:
        config_dir = config_dir_arg
    else:
        new_default = Path.home() / ".config" / "lestudio"
        # Migration: auto-rename old config dirs to new name
        old_default = Path.home() / ".config" / "lerobot-studio"
        old_moment = Path.home() / ".config" / "moment-lerobot-studio"
        moment_default = Path.home() / ".config" / "moment-lestudio"
        legacy_default = Path.home() / ".config" / "lerobot-setup"
        if old_default.exists() and not new_default.exists():
            old_default.rename(new_default)
        if old_moment.exists() and not moment_default.exists():
            old_moment.rename(moment_default)
        if new_default.exists():
            config_dir = new_default
        elif moment_default.exists():
            config_dir = moment_default
        elif legacy_default.exists():
            config_dir = legacy_default
        else:
            config_dir = new_default
    config_dir.mkdir(parents=True, exist_ok=True)
    return config_dir


def resolve_lerobot_src(lerobot_path_arg: Path | None) -> Path:
    lerobot_src = lerobot_path_arg
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
    # If user passed the repo root (e.g. .../lerobot), resolve to src/ automatically
    src_candidate = lerobot_src / "src"
    if (src_candidate / "lerobot").is_dir():
        lerobot_src = src_candidate
    return lerobot_src


def _manual_commands(source_rules: Path, target_rules: Path) -> list[str]:
    source_q = str(source_rules)
    target_q = str(target_rules)
    return [
        f"sudo cp {source_q} {target_q}",
        "sudo udevadm control --reload-rules",
        "sudo udevadm trigger --subsystem-match=video4linux",
        "sudo udevadm trigger --subsystem-match=tty",
    ]


def _extract_symlink_names(rules_content: str) -> list[str]:
    matches = re.findall(r'SYMLINK\+="([^"]+)"', rules_content)
    return sorted(set(matches))


def _print_verify_symlinks(symlinks: list[str]):
    if not symlinks:
        print("- Verify: no SYMLINK entries found in rules file")
        return
    print("- Verify symlinks:")
    for link in symlinks:
        path = Path("/dev") / link
        if not path.exists() and not path.is_symlink():
            print(f"  [MISSING] {path}")
            continue
        try:
            target = path.resolve()
            print(f"  [OK] {path} -> {target}")
        except Exception as exc:
            print(f"  [WARN] {path} exists but resolve failed: {exc}")


def command_serve(args):
    lerobot_src = resolve_lerobot_src(args.lerobot_path)
    config_dir = resolve_config_dir(args.config_dir)

    from lestudio.server import create_app
    import uvicorn

    app = create_app(
        lerobot_src=lerobot_src,
        config_dir=config_dir,
        rules_path=args.rules_path,
    )

    print(f"🤖  LeStudio v{_version()}")
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


def command_install_udev(args):
    config_dir = resolve_config_dir(args.config_dir)
    source_rules = args.source_rules if args.source_rules is not None else (config_dir / "99-lerobot.rules")
    target_rules = args.rules_path

    print(f"Source rules: {source_rules}")
    print(f"Target rules: {target_rules}")

    if not source_rules.exists():
        print("ERROR: source rules file does not exist.", file=sys.stderr)
        print("Generate/save mapping rules from the UI first, or pass --source-rules.", file=sys.stderr)
        print(f"Expected file: {source_rules}", file=sys.stderr)
        sys.exit(1)

    cmds = _manual_commands(source_rules, target_rules)
    print("\nCommands to run:")
    for cmd in cmds:
        print(f"  {cmd}")

    if args.dry_run:
        print("\nDry-run complete. No system changes were made.")
        return

    copy_res = subprocess.run(["sudo", "cp", str(source_rules), str(target_rules)], capture_output=True, text=True)
    if copy_res.returncode != 0:
        err = (copy_res.stderr or "").strip() or "Failed to copy rules file"
        print(f"ERROR: {err}", file=sys.stderr)
        sys.exit(copy_res.returncode)

    reload_res = subprocess.run(["sudo", "udevadm", "control", "--reload-rules"], capture_output=True, text=True)
    if reload_res.returncode != 0:
        err = (reload_res.stderr or "").strip() or "udevadm reload failed"
        print(f"ERROR: {err}", file=sys.stderr)
        sys.exit(reload_res.returncode)

    trig_video = subprocess.run(["sudo", "udevadm", "trigger", "--subsystem-match=video4linux"], capture_output=True, text=True)
    if trig_video.returncode != 0:
        err = (trig_video.stderr or "").strip() or "udevadm trigger video4linux failed"
        print(f"WARN: {err}")

    trig_tty = subprocess.run(["sudo", "udevadm", "trigger", "--subsystem-match=tty"], capture_output=True, text=True)
    if trig_tty.returncode != 0:
        err = (trig_tty.stderr or "").strip() or "udevadm trigger tty failed"
        print(f"WARN: {err}")

    content = source_rules.read_text()
    symlinks = _extract_symlink_names(content)
    print("\nInstall complete.")
    _print_verify_symlinks(symlinks)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="lestudio",
        description="LeStudio",
    )
    sub = parser.add_subparsers(dest="command")

    serve = sub.add_parser("serve", help="Run LeStudio web server")
    serve.add_argument("--port", type=int, default=7860, help="Server port (default: 7860)")
    serve.add_argument("--host", default="0.0.0.0", help="Server host (default: 0.0.0.0)")
    serve.add_argument("--lerobot-path", type=Path, default=None, help="Path to lerobot source (auto-detected if installed)")
    serve.add_argument("--config-dir", type=Path, default=None, help="Config directory (default: ~/.config/lestudio)")
    serve.add_argument("--rules-path", type=Path, default=DEFAULT_RULES_PATH, help="Path to udev rules file")
    serve.add_argument("--no-browser", action="store_true", help="Do not open a browser automatically")
    serve.add_argument("--headless", action="store_true", help="Alias for --no-browser")
    serve.set_defaults(handler=command_serve)

    install = sub.add_parser("install-udev", help="Install udev rules with sudo (separate from web UI)")
    install.add_argument("--config-dir", type=Path, default=None, help="Config directory (default: ~/.config/lestudio)")
    install.add_argument("--source-rules", type=Path, default=None, help="Source rules file (default: <config-dir>/99-lerobot.rules)")
    install.add_argument("--rules-path", type=Path, default=DEFAULT_RULES_PATH, help="Target rules file (default: /etc/udev/rules.d/99-lerobot.rules)")
    install.add_argument("--dry-run", action="store_true", help="Print commands only without applying")
    install.set_defaults(handler=command_install_udev)

    return parser


def main():
    parser = build_parser()
    argv = sys.argv[1:]
    if not argv:
        argv = ["serve", *argv]
    elif argv[0].startswith("-") and argv[0] not in {"-h", "--help"}:
        argv = ["serve", *argv]
    args = parser.parse_args(argv)
    if not hasattr(args, "handler"):
        parser.print_help()
        sys.exit(2)
    args.handler(args)


def _version() -> str:
    from lestudio import __version__

    return __version__
