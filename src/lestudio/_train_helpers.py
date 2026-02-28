"""Training dependency checks and install helpers."""
from __future__ import annotations

import json
import logging
import shlex
import subprocess
import textwrap
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


def _check_cuda_runtime_compat(python_exe: str) -> tuple[bool, str]:
    script = (
        "import json,sys;"
        "\ntry:"
        "\n import torch"
        "\n if not torch.cuda.is_available():"
        "\n  print(json.dumps({'ok': False, 'reason': 'CUDA is not available in this environment.'})); sys.exit(0)"
        "\n try:"
        "\n  idx = torch.cuda.current_device()"
        "\n except Exception:"
        "\n  idx = 0"
        "\n major, minor = torch.cuda.get_device_capability(idx)"
        "\n gpu_arch = f'sm_{major}{minor}'"
        "\n raw_arches = []"
        "\n try:"
        "\n  raw_arches = torch.cuda.get_arch_list() or []"
        "\n except Exception:"
        "\n  raw_arches = []"
        "\n supported = []"
        "\n compute_caps = []"
        "\n for arch in raw_arches:"
        "\n  if arch.startswith('sm_'): supported.append(arch)"
        "\n  elif arch.startswith('compute_'):"
        "\n   supported.append('sm_' + arch.split('_', 1)[1])"
        "\n   compute_caps.append(int(arch.split('_', 1)[1]))"
        "\n supported = sorted(set(supported))"
        "\n gpu_cap = major * 10 + minor"
        "\n forward_ok = any(gpu_cap >= cc for cc in compute_caps) if compute_caps else False"
        "\n if supported and gpu_arch not in supported and not forward_ok:"
        "\n  try:"
        "\n   t = torch.zeros(1, device='cuda'); _ = t + t"
        "\n   print(json.dumps({'ok': True, 'reason': f'CUDA forward compat ({gpu_arch} via PTX)'}))"
        "\n  except Exception:"
        "\n   msg = 'CUDA arch mismatch: GPU ' + gpu_arch + ', torch supports ' + ', '.join(supported) + '.'"
        "\n   print(json.dumps({'ok': False, 'reason': msg}))"
        "\n  sys.exit(0)"
        "\n print(json.dumps({'ok': True, 'reason': f'CUDA arch supported ({gpu_arch})'}))"
        "\nexcept Exception as e:"
        "\n print(json.dumps({'ok': False, 'reason': f'CUDA preflight check failed: {e}'}))"
    )

    try:
        r = subprocess.run([python_exe, "-c", script], capture_output=True, text=True, timeout=8)
    except (OSError, subprocess.SubprocessError) as e:
        return False, f"CUDA preflight check failed: {e}"

    out = (r.stdout or "").strip().splitlines()
    if not out:
        err = (r.stderr or "").strip()
        return False, f"CUDA preflight check returned no output. {err}".strip()

    try:
        payload: dict[str, Any] = json.loads(out[-1])
    except (json.JSONDecodeError, TypeError, ValueError):
        return False, f"CUDA preflight parse error: {out[-1]}"

    ok = bool(payload.get("ok"))
    reason = str(payload.get("reason", "Unknown CUDA preflight result."))
    return ok, reason


def _cuda_tag_to_toolkit_version(cuda_tag: str) -> str | None:
    token = (cuda_tag or "").strip().lower()
    if not token.startswith("cu"):
        return None
    digits = token[2:]
    if not digits.isdigit() or len(digits) < 2:
        return None
    if len(digits) == 3:
        major = int(digits[:2])
        minor = int(digits[2])
    else:
        major = int(digits[:-1])
        minor = int(digits[-1])
    return f"{major}.{minor}"


def _check_torchcodec_compat(python_exe: str) -> dict[str, Any]:
    """torchcodec가 현재 환경에서 로드 가능한지 확인하고, 실패 시 원인을 분류합니다."""
    script = textwrap.dedent("""
        import json, sys
        try:
            from torchcodec.decoders import VideoDecoder
            print(json.dumps({"ok": True, "reason": "torchcodec is available."}))
        except ImportError:
            import torch
            tv = torch.__version__
            is_nightly = "dev" in tv
            cuda_tag = ""
            if "+cu" in tv:
                cuda_tag = "cu" + tv.split("+cu")[1]
            try:
                import torchvision
                has_video_opt = bool(getattr(torchvision.io, "_HAS_VIDEO_OPT", False))
                has_cpu_decoder = bool(getattr(torchvision.io, "_HAS_CPU_VIDEO_DECODER", False))
                if not (has_video_opt and has_cpu_decoder):
                    print(json.dumps({
                        "ok": False,
                        "reason": "torchcodec is not installed and torchvision VideoReader is unavailable on this build. Training video decode will fail unless torchcodec is installed.",
                        "cause": "pyav_video_reader_unavailable",
                        "nightly": is_nightly,
                        "cuda_tag": cuda_tag,
                    }))
                    raise SystemExit(0)
                print(json.dumps({"ok": True, "reason": "torchcodec not installed. pyav will be used as fallback.", "fallback": True, "nightly": is_nightly, "cuda_tag": cuda_tag}))
            except Exception as e:
                print(json.dumps({
                    "ok": False,
                    "reason": f"torchcodec is not installed and pyav fallback probe failed: {type(e).__name__}",
                    "cause": "pyav_video_reader_unavailable",
                    "nightly": is_nightly,
                    "cuda_tag": cuda_tag,
                }))
        except RuntimeError as e:
            import torch
            err = str(e)
            tv = torch.__version__
            is_nightly = "dev" in tv
            cuda_tag = ""
            if "+cu" in tv:
                cuda_tag = "cu" + tv.split("+cu")[1]
            # 원인 분류
            if "libnppicc" in err or "libnpp" in err:
                cause = "missing_cuda_toolkit"
                msg = f"CUDA toolkit libraries (libnppicc) not found. torchcodec requires the CUDA toolkit to be installed."
            elif "libavcodec" in err or "libavformat" in err or "FFmpeg" in err.split("Likely causes")[0] if "Likely causes" in err else False:
                cause = "missing_ffmpeg"
                msg = "FFmpeg libraries not found. torchcodec requires FFmpeg 4-7 to be installed."
            elif "is not compatible" in err:
                cause = "version_mismatch"
                msg = f"torchcodec is incompatible with PyTorch {tv}. Reinstall torchcodec to match your PyTorch version."
            else:
                cause = "unknown"
                msg = f"torchcodec failed to load (PyTorch {tv}). Check your CUDA toolkit and FFmpeg installation."
            print(json.dumps({"ok": False, "reason": msg, "cause": cause, "nightly": is_nightly, "cuda_tag": cuda_tag}))
        except Exception as e:
            print(json.dumps({"ok": False, "reason": f"torchcodec check error: {type(e).__name__}", "cause": "unknown"}))
    """)
    try:
        r = subprocess.run([python_exe, "-c", script], capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError) as e:
        return {"ok": False, "reason": f"torchcodec check failed: {e}", "cause": "unknown"}
    out = (r.stdout or "").strip().splitlines()
    if not out:
        err = (r.stderr or "").strip()
        return {"ok": False, "reason": f"torchcodec check returned no output. {err}".strip(), "cause": "unknown"}
    try:
        payload: dict[str, Any] = json.loads(out[-1])
    except (json.JSONDecodeError, TypeError, ValueError):
        return {"ok": False, "reason": f"torchcodec check parse error: {out[-1]}", "cause": "unknown"}
    # 실패 시 cause별 install 명령어 생성
    if not payload.get("ok"):
        cause = payload.get("cause", "unknown")
        nightly = payload.get("nightly", False)
        cuda_tag = str(payload.get("cuda_tag", ""))
        toolkit_version = _cuda_tag_to_toolkit_version(cuda_tag)
        if cause == "missing_cuda_toolkit":
            if toolkit_version:
                payload["command"] = f"conda install -y -c nvidia cuda-toolkit={toolkit_version}"
                payload["reason"] = (
                    f"CUDA toolkit libraries (libnppicc) matching PyTorch {cuda_tag} are missing. "
                    f"Install CUDA toolkit {toolkit_version} runtime libraries."
                )
            else:
                payload["command"] = "conda install -y -c nvidia cuda-toolkit"
        elif cause == "missing_ffmpeg":
            payload["command"] = "conda install -y -c conda-forge ffmpeg"
        else:
            parts = ["pip", "install", "--force-reinstall"]
            if nightly:
                parts.append("--pre")
            parts.append("torchcodec")
            if nightly and cuda_tag:
                parts.extend(["--index-url", f"https://download.pytorch.org/whl/nightly/{cuda_tag}"])
            elif cuda_tag:
                parts.extend(["--index-url", f"https://download.pytorch.org/whl/{cuda_tag}"])
            payload["command"] = " ".join(parts)
    return payload


def _check_train_python_deps(python_exe: str) -> dict[str, Any]:
    script = textwrap.dedent("""
        import importlib.util
        import json

        required = ["accelerate", "av"]
        missing = []
        for name in required:
            try:
                if importlib.util.find_spec(name) is None:
                    missing.append(name)
            except Exception:
                missing.append(name)

        print(json.dumps({"ok": len(missing) == 0, "missing": missing}))
    """)
    try:
        r = subprocess.run([python_exe, "-c", script], capture_output=True, text=True, timeout=8)
    except (OSError, subprocess.SubprocessError) as e:
        return {"ok": True, "reason": f"Dependency probe skipped: {e}"}

    out = (r.stdout or "").strip().splitlines()
    if not out:
        return {"ok": True, "reason": "Dependency probe skipped: no output"}

    try:
        payload: dict[str, Any] = json.loads(out[-1])
    except (json.JSONDecodeError, TypeError, ValueError):
        return {"ok": True, "reason": f"Dependency probe skipped: parse error ({out[-1]})"}

    missing = [str(name).strip() for name in payload.get("missing", []) if str(name).strip()]
    if missing:
        args = [python_exe, "-m", "pip", "install", *missing]
        pkg_text = ", ".join(missing)
        return {
            "ok": False,
            "reason": f"Missing required Python package(s) for training: {pkg_text}.",
            "action": "install_python_dep",
            "command": _format_cmd(args),
            "missing": missing,
        }

    return {"ok": True, "reason": "Core training dependencies are available."}


def _build_torch_install_args(python_exe: str, cuda_tag: str = "cu128", nightly: bool = True) -> list[str]:
    channel = "nightly" if nightly else "stable"
    index_url = f"https://download.pytorch.org/whl/{channel}/{cuda_tag}" if nightly else f"https://download.pytorch.org/whl/{cuda_tag}"
    args = [python_exe, "-m", "pip", "install", "--upgrade"]
    if nightly:
        args.append("--pre")
    args.extend(["torch", "torchvision", "torchaudio", "--index-url", index_url])
    return args


def _format_cmd(args: list[str]) -> str:
    return " ".join(shlex.quote(a) for a in args)


def _ensure_non_interactive_conda_args(args: list[str]) -> list[str]:
    if not args:
        return args
    exe = Path(args[0]).name.lower()
    if exe not in {"conda", "mamba", "micromamba"}:
        return args
    if len(args) < 2:
        return args
    subcommand = args[1].lower()
    if subcommand not in {"install", "update", "remove", "uninstall"}:
        return args
    if "-y" in args[2:] or "--yes" in args[2:]:
        return args
    return [args[0], args[1], "-y", *args[2:]]


def _parse_install_args(raw_command: str, python_exe: str) -> list[str]:
    command = str(raw_command or "").strip()
    if not command:
        return []
    try:
        args = shlex.split(command)
    except ValueError:
        return []
    if not args:
        return []

    head = args[0]
    if head in {"pip", "pip3"}:
        args = [python_exe, "-m", "pip", *args[1:]]
    elif Path(head).name.startswith("python") and len(args) >= 3 and args[1] == "-m" and args[2] == "pip":
        args = [python_exe, "-m", "pip", *args[3:]]
    return _ensure_non_interactive_conda_args(args)


def _normalize_console_command(python_exe: str, raw_command: str) -> tuple[list[str], str]:
    """Parse and normalize a console command, enforcing an allowlist.

    Only the following command families are allowed:
    - pip / pip3 install|uninstall|download
    - python -m pip install|uninstall|download
    - conda / mamba / micromamba install|update|remove|uninstall
    """
    command = (raw_command or "").strip()
    if not command:
        raise ValueError("No command provided.")

    args = shlex.split(command)
    if not args:
        raise ValueError("No command provided.")

    head = args[0]

    # ── Allowlist check ────────────────────────────────────────────────────────
    _PIP_SUBCOMMANDS = {"install", "uninstall", "download"}
    _CONDA_SUBCOMMANDS = {"install", "update", "remove", "uninstall"}
    _CONDA_EXECUTABLES = {"conda", "mamba", "micromamba"}

    if head in {"pip", "pip3"}:
        subcommand = args[1].lower() if len(args) > 1 else ""
        if subcommand not in _PIP_SUBCOMMANDS:
            raise ValueError(f"Command not allowed: 'pip {subcommand}'. Only pip {'/'.join(sorted(_PIP_SUBCOMMANDS))} are permitted.")
        args = [python_exe, "-m", "pip", *args[1:]]
    elif Path(head).name.lower().startswith("python") and len(args) >= 3 and args[1] == "-m" and args[2] == "pip":
        subcommand = args[3].lower() if len(args) > 3 else ""
        if subcommand not in _PIP_SUBCOMMANDS:
            raise ValueError(f"Command not allowed: 'python -m pip {subcommand}'. Only pip {'/'.join(sorted(_PIP_SUBCOMMANDS))} are permitted.")
        args = [python_exe, "-m", "pip", *args[3:]]
    elif Path(head).name.lower() in _CONDA_EXECUTABLES:
        subcommand = args[1].lower() if len(args) > 1 else ""
        if subcommand not in _CONDA_SUBCOMMANDS:
            raise ValueError(f"Command not allowed: '{Path(head).name} {subcommand}'. Only conda/mamba {'/'.join(sorted(_CONDA_SUBCOMMANDS))} are permitted.")
    else:
        raise ValueError(f"Command not allowed: '{head}'. Only pip install/uninstall/download and conda/mamba install/update/remove are permitted.")

    args = _ensure_non_interactive_conda_args(args)

    return args, _format_cmd(args)
