# LeStudio

A comprehensive web-based GUI for setting up and operating [Hugging Face LeRobot](https://github.com/huggingface/lerobot) robot arms. This tool replaces the traditional CLI-heavy flow with a guided workbench for setup, operation, dataset management, training, and evaluation.

## Features

- **Workbench Navigation**: Setup -> Operate -> Data -> ML flow with Guided/Advanced modes.
- **Status**: Live device and process overview.
- **Mapping**: Camera and arm udev assignment, rule preview/apply, and stream setting controls.
- **Motor Setup**: Basic motor connectivity and setup commands.
- **Calibration**: Real-time motor range visualization, lock/unlock, and calibration file actions.
- **Teleop**: Multi-camera teleoperation with preflight checks and process logs.
- **Record**: Dataset collection with episode controls, preflight checks, and keyboard shortcuts.
- **Dataset**: Local dataset listing, details, cleanup, and Hub push workflows.
- **Train**: `lerobot` training orchestration with preflight and metric/log streaming.
- **Eval**: Policy evaluation run orchestration with live process output.
- **Global Console Drawer**: Unified stdout/stderr stream and stdin input routing per process.
- **Profiles**: Save/load/import/export/delete full configuration profiles.

## Requirements

- Python 3.10+
- Linux (for `udev` rules and `/dev/video*` access)
- `huggingface/lerobot` installed in your environment

### Optional Dependencies and Permissions

- **udev apply**: non-interactive `sudo` is recommended for one-click rule installation. Without it, Studio provides manual commands.
- **Hub push**: `huggingface-cli` login and valid token are required.
- **GPU checks/monitoring**: CUDA-enabled environment and `nvidia-smi` are needed for full Train diagnostics.

## Installation

You can install this tool directly via pip:

```bash
pip install lestudio
```

Or from source:

```bash
git clone https://github.com/TheMomentLab/lestudio.git
cd lestudio
pip install -e .
```

## Usage

Once installed, simply run the setup command from your terminal. Make sure your `lerobot` conda environment (or equivalent) is activated so the tool can detect the `lerobot` package.

```bash
lestudio
```

By default, the server will start at `http://localhost:7860`. Open this URL in your web browser.

### Command Line Options

```text
usage: lestudio [-h] [--port PORT] [--host HOST] [--lerobot-path LEROBOT_PATH] [--config-dir CONFIG_DIR] [--rules-path RULES_PATH]

LeStudio

options:
  -h, --help            show this help message and exit
  --port PORT           Server port (default: 7860)
  --host HOST           Server host (default: 0.0.0.0)
  --lerobot-path LEROBOT_PATH
                        Path to lerobot source (auto-detected if installed)
  --config-dir CONFIG_DIR
                        Config directory (default: ~/.config/lestudio)
  --rules-path RULES_PATH
                        Path to udev rules file (default: /etc/udev/rules.d/99-lerobot.rules)
```

## Setup Process Guide

1. **Status**: Confirm cameras/arms are visible and process status is healthy.
2. **Mapping**: Bind physical devices to stable symlinks (`top_cam_1`, `follower_arm_1`, etc.) and apply rules.
3. **Motor Setup**: Run basic motor setup if needed for your hardware profile.
4. **Calibration**: Perform follower/leader calibration and verify the generated files.
5. **Teleop**: Validate motion control and camera feeds with preflight checks.
6. **Record**: Capture episodes for your target task and dataset repo.
7. **Dataset**: Inspect local datasets and optionally push to Hugging Face Hub.
8. **Train**: Start training from recorded data and monitor logs/metrics.
9. **Eval**: Run policy evaluation to close the setup -> data -> ML loop.

## License

This project is licensed under the Apache 2.0 License.
