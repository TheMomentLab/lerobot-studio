# Full Workflow

LeStudio is designed around a nine-step pipeline. Each step corresponds to a tab in the UI.

## Overview

```
Status → Mapping → Motor Setup → Calibration → Teleop → Record → Dataset → Train → Eval
```

---

## Step 1: Status

**Tab**: Status

Confirm your environment is healthy before doing anything else:

- Cameras and arms appear with their `/dev/` paths or symlinks
- System resources are within normal range
- No active processes are blocking ports

---

## Step 2: Mapping

**Tab**: Mapping

Bind USB devices to stable symlinks so the rest of the pipeline can reference them reliably.

1. Add camera and arm rules
2. Apply rules (or run `lestudio install-udev` manually)
3. Re-plug USB devices to activate symlinks
4. Verify symlinks appear in the Status tab

See the [Hardware Guide](hardware.md) for details.

---

## Step 3: Motor Setup

**Tab**: Motor Setup

Run only when setting up new hardware or replacing servos.

1. Select your arm type
2. Run `lerobot_setup_motors` via the UI
3. Confirm motor IDs are detected correctly

---

## Step 4: Calibration

**Tab**: Calibration

Calibrate follower and leader arms to establish accurate joint positions.

1. Select your robot and teleoperator
2. Run calibration for follower arm, then leader arm
3. Verify calibration files are saved (shown in the file list)
4. Delete and re-run if calibration looks off

---

## Step 5: Teleop

**Tab**: Teleop

Validate motion and camera feeds before recording real data.

1. Run **Preflight** — checks cameras, arms, and calibration files
2. Click **Start Teleop**
3. Move the leader arm and verify the follower tracks it
4. Check all camera feeds are live and unobstructed
5. Click **Stop**

!!! tip
    Camera feeds remain visible in the Teleop tab via shared memory (SHM) while the teleop process runs — no need for a separate viewer.

---

## Step 6: Record

**Tab**: Record

Capture episodes for your target task.

1. Set dataset name, task description, number of episodes, FPS, and warm-up time
2. Click **Start Recording**
3. Perform the task with the leader arm
4. Click **Next Episode** (or press the bound key) to save the episode and move on
5. Click **Abort Episode** to discard and redo
6. When all episodes are captured, the dataset is saved locally

---

## Step 7: Dataset

**Tab**: Dataset

Inspect, curate, and push your dataset to Hugging Face Hub.

- **Episode Replayer** — synchronized multi-camera playback with scrubbing
- **Episode Curation** — delete bad episodes, tag episodes, filter by quality
- **Hub Push** — push your local dataset to `hf.co/datasets/<your-username>/<repo>`
- **Hub Search** — browse and download existing LeRobot datasets

---

## Step 8: Train

**Tab**: Train

Launch a LeRobot training run and monitor it in real time.

1. Select a policy and dataset
2. Choose a hyperparameter preset (Quick / Standard / Full) or set manually
3. Run **CUDA Preflight** to verify your GPU setup
4. Click **Start Training**
5. Watch the live loss/LR chart and ETA tracker

!!! note
    If CUDA preflight detects an incompatible PyTorch build, LeStudio offers a one-click reinstall.

---

## Step 9: Eval

**Tab**: Eval

Run policy evaluation to close the loop.

1. Use **Checkpoint Browser** to select a checkpoint
2. Configure eval parameters
3. Click **Start Eval**
4. Review per-episode results in the output panel
