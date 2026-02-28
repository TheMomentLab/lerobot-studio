# LeStudio

A web-based GUI workbench for [Hugging Face LeRobot](https://github.com/huggingface/lerobot) — covering the full pipeline from hardware setup to policy evaluation. Replaces the CLI-heavy LeRobot workflow with a browser-based interface.

## Features

### Hardware Setup & Ops
- **Status**: Live device and process overview with real-time CPU/RAM/Disk/GPU monitoring.
- **Mapping**: Camera and arm udev rule management — create, preview, apply, verify, and delete. Includes Arm Identify Wizard (disconnect/reconnect diff-based detection) and USB bandwidth monitoring (real-time fps/MB·s per feed with bus utilization bar).
- **Motor Setup**: Motor connectivity and setup via `lerobot_setup_motors`.
- **Calibration**: Calibration execution, file management, and delete.

### Operation
- **Teleop**: Multi-camera teleoperation with preflight checks and live camera feeds (SHM-shared during process — feed stays visible while teleop runs).
- **Record**: Episode recording with keyboard bridge (next/abort from browser UI), resume support, and preflight checks.

### Data
- **Dataset**: Local dataset listing, episode details, quality check, and Hub push with progress tracking.
- **Episode Replayer**: Multi-camera synchronized playback with timeline scrubbing.
- **Episode Curation**: Per-episode delete, tag, and filter for data quality management.
- **Hub Search**: Search and download datasets directly from Hugging Face Hub.

### ML
- **Train**: LeRobot training orchestration with CUDA preflight (auto-detects incompatible builds + one-click PyTorch reinstall), real-time loss/LR chart, ETA tracking, and hyperparameter presets (Quick Test / Standard / Full).
- **Checkpoint Browser**: Scan local checkpoints and auto-link to Eval.
- **Eval**: Policy evaluation with live process output and per-episode result tracking.

### General
- **Global Console Drawer**: Unified stdout/stderr stream and stdin routing per process.
- **Error Translation**: CLI stderr patterns → user-friendly guidance messages.
- **Profiles**: Save/load/import/export/delete full configuration profiles.
- **Session History**: Timeline of recording, training, and evaluation events.
- **Desktop Notifications**: Browser notifications on process completion or error.
- **Guided/Advanced Modes**: Guided mode for step-by-step setup; Advanced mode unlocks all tabs.
- **Dark/Light Theme**: CSS variable-based theme toggle.
- **Responsive Layout**: Desktop sidebar, tablet icon rail, mobile drawer.

## Requirements

- Python 3.10+
- Linux (for `udev` rules and `/dev/video*` access)
- `huggingface/lerobot` installed in your environment

### Optional

- **udev apply**: one-click install works with either passwordless `sudo` or a desktop Polkit auth prompt (`pkexec`). In headless/SSH environments without those, LeStudio provides manual commands.
- **Hub push / download**: `huggingface-cli login` and a valid token are required.
- **GPU monitoring / CUDA preflight**: CUDA environment and `nvidia-smi` required for full Train diagnostics.

## Installation

Install from source:

```bash
git clone --recursive https://github.com/TheMomentLab/lestudio.git
cd lestudio
# one-time (if needed): conda create -n lerobot python=3.10 -y
conda activate lerobot
make install
```

The [custom lerobot fork](https://github.com/TheMomentLab/lerobot) is tracked as a git submodule. `--recursive` pulls it automatically; `make install` installs both packages in editable mode.

## Usage

```bash
lestudio
```

The server starts at `http://localhost:7860` and opens a browser tab automatically (skipped on SSH sessions or headless environments).

### Command Line Options

```
usage: lestudio [-h] {serve,install-udev} ...

subcommands:
  serve           Start the LeStudio web server (default when no subcommand given)
  install-udev    Install udev rules via sudo (CLI alternative to the web UI)

lestudio serve:
  --port PORT           Server port (default: 7860)
  --host HOST           Server host (default: 127.0.0.1)
  --lerobot-path PATH   Path to lerobot source (auto-detected if installed)
  --config-dir DIR      Config directory (default: ~/.config/lestudio)
  --rules-path PATH     udev rules file (default: /etc/udev/rules.d/99-lerobot.rules)
  --no-browser          Do not open browser automatically
  --headless            Alias for --no-browser
```

Flags can be passed without explicitly typing `serve` — `lestudio --port 8080` works the same as `lestudio serve --port 8080`.

### Network & CORS

- Default bind is local-only: `127.0.0.1`.
- To expose on LAN, use: `lestudio serve --host 0.0.0.0`.
- Default CORS allows localhost origins only (`localhost` / `127.0.0.1`).

You can override CORS with environment variables:

```bash
# Comma-separated explicit allowlist
export LESTUDIO_CORS_ORIGINS="http://localhost:7860,https://studio.example.com"

# Optional regex override (used when explicit origins are not set)
export LESTUDIO_CORS_ORIGIN_REGEX='^https://(localhost|127\\.0\\.0\\.1)(:\\d+)?$'
```

For development compatibility only, `LESTUDIO_CORS_ORIGINS="*"` is supported but not recommended for shared networks.

## Development

Backend checks:

```bash
python3 -m compileall -q src/lestudio
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest -q -m "not smoke_hw" tests
```

Frontend checks:

```bash
cd frontend
npm ci
npm run lint
npm run build
```

CI runs these checks in GitHub Actions: `.github/workflows/ci.yml`.

Hardware smoke checks (real devices only, opt-in):

```bash
LESTUDIO_RUN_HW_SMOKE=1 PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest -q -m "smoke_hw" tests/smoke_hw
```

Release readiness checklist: [docs/release-checklist.md](docs/release-checklist.md)

## Workflow Guide

1. **Status** — Confirm cameras and arms are visible and process status is healthy.
2. **Mapping** — Bind devices to stable symlinks (`top_cam_1`, `follower_arm_1`, …) and apply udev rules.
3. **Motor Setup** — Run motor setup if needed for your hardware.
4. **Calibration** — Calibrate follower/leader arms and verify the generated files.
5. **Teleop** — Validate motion and camera feeds with preflight checks.
6. **Record** — Capture episodes for your target task.
7. **Dataset** — Inspect episodes, curate data, and push to Hugging Face Hub.
8. **Train** — Start training and monitor loss/metrics in real time.
9. **Eval** — Run policy evaluation to close the loop.

## License

Apache 2.0
