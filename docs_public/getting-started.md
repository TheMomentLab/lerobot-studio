# Quick Start

This guide gets you from a fresh install to your first teleoperation session in minutes.

## 1. Start the Server

```bash
conda activate lerobot
lestudio
```

The server starts at `http://localhost:7860`.
If you want LeStudio to open a browser automatically on desktop sessions, run `lestudio --browser`.
On SSH/headless environments the browser is not opened — navigate there manually.

## 2. Check Hardware Status

Open the **Status** page. You should see:

- **Cameras** listed with their `/dev/` paths or symlinks
- **Arms** (if connected) shown under robot devices
- System resources (CPU, RAM, Disk, GPU if available)

If devices are missing, go to the **Motor Setup** page → **Mapping** tab to create udev rules.

## 3. Map Devices (First Time Only)

The **Motor Setup** page → **Mapping** tab lets you assign stable symlinks to your USB devices:

1. Click **Add Camera Rule** or **Add Arm Rule**
2. Plug in your device and follow the Arm Identify Wizard (for arms) or select the video device (for cameras)
3. Click **Apply Rules** to write `/etc/udev/rules.d/99-lerobot.rules`
4. Re-plug your USB devices to activate the symlinks

!!! tip
    If the Apply button fails (SSH / headless environment), run `lestudio install-udev` in your terminal instead.

## 4. Calibrate

Go to the **Motor Setup** page → **Calibration** tab and run calibration for your follower and leader arms.
Calibration files are saved to `~/.config/lestudio/` by default.

## 5. Teleop

Open the **Teleop** page:

1. Select your robot and teleoperator from the dropdowns
2. Click **Preflight** to verify cameras and arms are ready
3. Click **Start Teleop** — live camera feeds appear in the UI while the process runs
4. Click **Stop** when done

## 6. Record Episodes

Switch to the **Record** page:

1. Set your dataset name, task name, and episode count
2. Click **Start Recording**
3. Use **Next Episode** / **Abort Episode** buttons (or keyboard shortcuts) to control episodes
4. When all episodes are captured, the dataset is saved locally

## 7. Inspect & Push

Use the **Dataset** page to review episodes, curate data, and push to Hugging Face Hub.

## Next Steps

- Read [Workflow](workflow.md) for the full setup-to-eval pipeline.
- Read [Hardware Guide](hardware.md) if you need more detail on cameras, arms, or udev rules.
- Read [Troubleshooting](troubleshooting.md) if a process, device, or permission check fails.
