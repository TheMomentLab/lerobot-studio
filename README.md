# LeRobot Studio

A comprehensive web-based GUI for setting up and operating [Hugging Face LeRobot](https://github.com/huggingface/lerobot) robot arms. This tool provides an interactive interface to replace the traditional CLI setup process, making it easier to configure cameras, calibrate motors, run teleoperation, and record datasets.

## Features

- **Status Dashboard**: See all connected cameras and robot arms at a glance.
- **Camera Setup**: Configure udev rules, assign symlinks (e.g., `top_cam_1`), and adjust streaming quality (Resolution, FPS, JPEG Quality).
- **Motor Setup**: Interactive motor calibration and configuration.
- **Calibration**: Real-time visualization of motor ranges with interactive locking/unlocking and calibration file management.
- **Teleop**: Live view of up to 3 cameras simultaneously while testing leader-follower teleoperation.
- **Record**: Start and stop data collection with live visual feedback.

## Requirements

- Python 3.10+
- Linux (for `udev` rules and `/dev/video*` access)
- `huggingface/lerobot` installed in your environment

## Installation

You can install this tool directly via pip:

```bash
pip install lerobot-studio
```

Or from source:

```bash
git clone https://github.com/TheMomentLab/lerobot-studio.git
cd lerobot-studio
pip install -e .
```

## Usage

Once installed, simply run the setup command from your terminal. Make sure your `lerobot` conda environment (or equivalent) is activated so the tool can detect the `lerobot` package.

```bash
lerobot-studio
```

By default, the server will start at `http://localhost:7860`. Open this URL in your web browser.

### Command Line Options

```text
usage: lerobot-studio [-h] [--port PORT] [--host HOST] [--lerobot-path LEROBOT_PATH] [--config-dir CONFIG_DIR] [--rules-path RULES_PATH]

LeRobot Studio

options:
  -h, --help            show this help message and exit
  --port PORT           Server port (default: 7860)
  --host HOST           Server host (default: 0.0.0.0)
  --lerobot-path LEROBOT_PATH
                        Path to lerobot source (auto-detected if installed)
  --config-dir CONFIG_DIR
                        Config directory (default: ~/.config/lerobot-studio)
  --rules-path RULES_PATH
                        Path to udev rules file (default: /etc/udev/rules.d/99-lerobot.rules)
```

## Setup Process Guide

1. **Status**: Check if your OS recognizes the connected USB cameras and robot arms.
2. **Camera Setup**: Bind your physical cameras to symlinks (`top_cam_1`, `follower_cam_1`, etc.) by applying udev rules. The tool will auto-reload the rules.
3. **Motor Setup**: (If needed) Test basic motor connectivity.
4. **Calibration**: Follow the on-screen steps to calibrate your follower and leader arms. You can see real-time range values for each motor.
5. **Teleop**: Verify that the leader arm accurately controls the follower arm while streaming multiple camera angles.
6. **Record**: Collect your episodic data.

## License

This project is licensed under the Apache 2.0 License.
