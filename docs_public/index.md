# LeStudio

**LeStudio** is a web-based GUI workbench for [Hugging Face LeRobot](https://github.com/huggingface/lerobot) — covering the full robot pipeline from hardware setup to policy evaluation.

It replaces the CLI-heavy LeRobot workflow with a browser-based interface that runs locally on your machine.

## Features

### Hardware Setup & Ops
- **Status** — Live device and process overview with real-time CPU/RAM/Disk/GPU monitoring.
- **Mapping** — Camera and arm udev rule management. Includes Arm Identify Wizard and USB bandwidth monitoring.
- **Motor Setup** — Motor connectivity and configuration via `lerobot_setup_motors`.
- **Calibration** — Calibration execution, file management, and delete.

### Operation
- **Teleop** — Multi-camera teleoperation with preflight checks and live SHM-shared camera feeds.
- **Record** — Episode recording with keyboard bridge (next/abort from browser), resume support, and preflight checks.

### Data
- **Dataset** — Local dataset listing, episode details, quality check, and Hub push.
- **Episode Replayer** — Multi-camera synchronized playback with timeline scrubbing.
- **Episode Curation** — Per-episode delete, tag, and filter.
- **Hub Search** — Search and download datasets directly from Hugging Face Hub.

### ML
- **Train** — LeRobot training with CUDA preflight, real-time loss/LR chart, ETA tracking, and hyperparameter presets.
- **Checkpoint Browser** — Scan local checkpoints and auto-link to Eval.
- **Eval** — Policy evaluation with live output and per-episode result tracking.

### General
- **Global Console Drawer** — Unified stdout/stderr stream and stdin routing per process.
- **Dark/Light Theme** — CSS variable-based theme toggle.
- **Responsive Layout** — Desktop sidebar, tablet icon rail, mobile drawer.

## Quick Links

- [Installation](installation.md) — Set up your environment and install LeStudio.
- [Quick Start](getting-started.md) — Run your first session.
- [Hardware Guide](hardware.md) — Connect cameras, arms, and configure udev rules.
- [Workflow](workflow.md) — End-to-end pipeline walkthrough.
- [Troubleshooting](troubleshooting.md) — Common issues and fixes.
