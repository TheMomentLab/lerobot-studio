# LeStudio - API and Streaming

Last updated: 2026-03-08
Status: current-state reference

---

## 1. Purpose

This document explains how LeStudio moves data between the browser and the backend today.

It focuses on:

- REST API responsibilities
- WebSocket event flow
- camera transport paths
- frontend transport handling
- current extension constraints

For broader system context, read `docs/current-architecture.md` first.

---

## 2. Transport Model

LeStudio uses three different transport paths at runtime.

### 2.1 REST (`/api/*`)

REST is used for:

- point-in-time reads
- configuration persistence
- process control actions
- preflight and dependency checks
- dataset and Hub workflows

Typical examples:

- load config
- list devices
- start teleop
- stop record
- run train preflight
- fetch checkpoint list

### 2.2 WebSocket (`/ws`)

WebSocket is used for:

- live process console output
- parsed training metrics
- periodic running/stopped process snapshots

This is the main live-runtime channel between backend and frontend.

### 2.3 HTTP camera endpoints

Camera transport is separate from `/ws`.

LeStudio uses:

- `/stream/{video_name}` for MJPEG
- `/api/camera/snapshot/{video_name}` for one-frame polling

This keeps camera delivery independent from process log delivery.

---

## 3. Backend API Surface

The backend is split by route module under `src/lestudio/routes/`.

### 3.1 Bootstrap and configuration APIs

These are heavily used during frontend startup.

- `GET /api/config`
- `POST /api/config`
- `GET /api/history`
- `POST /api/history/clear`
- `GET /api/devices`
- `GET /api/deps/status`
- `GET /api/hf/whoami`
- `GET /api/train/preflight`

`frontend/src/app/services/bootstrap.ts` calls these endpoints in parallel, then normalizes the results into initial UI state.

### 3.2 Device and ecosystem APIs

Device discovery is exposed through `routes/devices.py`.

Key endpoint groups:

- camera path checking and settings
- camera role and saved camera configuration
- robot type listing and schema lookup
- teleoperator listing
- camera type listing
- ecosystem status

Representative endpoints:

- `GET /api/robot_types`
- `GET /api/robots`
- `GET /api/robots/{robot_type}/schema`
- `GET /api/teleops`
- `GET /api/cameras`
- `GET /api/ecosystem/status`

Important current-state detail:

- discovery is already dynamic through `device_registry.py`
- execution paths are still only partially generalized

### 3.3 Process control APIs

`routes/process.py` is the main control surface for interactive robot operations.

Core managed-process endpoints:

- `GET /api/process/{name}/status`
- `POST /api/process/{name}/stop`
- `POST /api/process/{name}/input`
- `POST /api/process/{name}/command`

Workflow-oriented endpoints:

- `POST /api/preflight`
- `POST /api/teleop/start`
- `POST /api/record/start`
- `GET /api/calibrate/file`
- `GET /api/calibrate/list`
- `DELETE /api/calibrate/file`
- `POST /api/calibrate/start`
- `POST /api/motor_setup/start`

These routes do three things:

1. validate readiness and conflicts
2. convert request data into command-builder arguments
3. launch or control subprocesses through `ProcessManager`

### 3.4 Training and eval APIs

Training and evaluation are separated from the general process routes.

Training-related endpoints from `routes/training.py`:

- `GET /api/train/preflight`
- `GET /api/deps/status`
- `POST /api/train/install_pytorch`
- `POST /api/train/install_torchcodec_fix`
- `POST /api/train/start`
- `POST /api/train/colab/config`
- `GET /api/train/colab/link`

Eval-related endpoints from `routes/eval.py`:

- `GET /api/checkpoints`
- `POST /api/eval/start`
- `GET /api/eval/env-types`

### 3.5 Camera, system, and runtime observation APIs

`routes/streaming.py` exposes non-process runtime telemetry:

- `GET /stream/{video_name}`
- `GET /api/camera/snapshot/{video_name}`
- `GET /api/camera/stats`
- `GET /api/gpu/status`
- `GET /api/system/resources`
- `WS /ws`

### 3.6 Dataset and Hub APIs

Dataset functionality is split across listing, curation, and Hub modules.

Important groups include:

- local dataset listing and detail
- video serving
- quality checks
- tag editing and bulk tagging
- derived dataset jobs
- push/download job status
- HF token and identity management
- Hub search

This is the broadest API surface in the product, but it follows the same pattern: REST for actions and state snapshots, polling for long-running dataset jobs, and `/ws` for managed process logs.

### 3.7 Motor monitoring APIs

`routes/motor.py` mounts under `/api/motor` and exposes direct real-time motor operations.

Examples:

- `POST /api/motor/connect`
- `GET /api/motor/positions`
- `POST /api/motor/{motor_id}/move`
- `POST /api/motor/torque_off`
- `POST /api/motor/freewheel/enter`
- `POST /api/motor/freewheel/exit`
- `POST /api/motor/disconnect`

Unlike the LeRobot subprocess paths, these routes talk to `motor_monitor_bridge.py` directly.

---

## 4. Frontend API Consumption

### 4.1 Startup bootstrap

`frontend/src/app/App.tsx` calls `runBootstrap()` and then separately fetches per-process status for:

- `teleop`
- `record`
- `calibrate`
- `motor_setup`
- `train`
- `train_install`
- `eval`

This means startup state is assembled from multiple APIs rather than one backend bootstrap endpoint.

### 4.2 `apiClient.ts` responsibilities

`frontend/src/app/services/apiClient.ts` is the main frontend transport layer.

It provides:

- `apiGet`, `apiPost`, `apiDelete`
- transport switching between `mock` and `passthrough`
- WebSocket connection management
- event normalization for train and non-train flows
- fallback log appending into the global store

Important current behavior:

- the frontend keeps one shared WebSocket connection
- multiple pages/hooks subscribe to logical channels instead of opening independent sockets

### 4.3 Mock vs passthrough mode

The client supports two modes.

- `mock`: local fake handlers under `frontend/src/mock-api/handlers`
- `passthrough`: real backend via HTTP and WebSocket

This allows UI development without requiring the Python backend or hardware.

---

## 5. WebSocket Event Model

### 5.1 Backend event shapes

`routes/streaming.py` sends JSON objects over `/ws`.

Current backend event families are:

#### `output`

Used for process console lines.

Typical shape:

```json
{
  "type": "output",
  "process": "teleop",
  "line": "...",
  "kind": "stdout"
}
```

Some output events also include `replace` tags so the frontend can replace a previous line instead of appending a new one for live progress or table redraws.

#### `metric`

Used for parsed train metrics.

Typical shape:

```json
{
  "type": "metric",
  "process": "train",
  "metric": {
    "step": 1200,
    "total_steps": 10000,
    "loss": 0.123,
    "lr": 0.0001
  }
}
```

#### `status`

Used for periodic process snapshots.

Typical shape:

```json
{
  "type": "status",
  "processes": {
    "teleop": false,
    "record": true,
    "calibrate": false,
    "motor_setup": false,
    "train": false,
    "train_install": false,
    "eval": false
  }
}
```

### 5.2 Frontend normalization

The frontend does not use raw backend messages everywhere.

`apiClient.ts`:

- updates global API health/support flags through `handleGlobalWsEvents()`
- routes non-train output into per-process listeners
- converts backend `status` and `metric` messages into train channel events
- synthesizes `seq` and `ts` metadata for frontend listeners

This is why frontend consumers can subscribe to higher-level channels such as:

- train `status`
- train `output`
- train `metric`
- non-train output per process

### 5.3 Why replace-tags exist

`ProcessManager` emits `replace` tags for live progress and table redraw use cases.

The frontend store uses these tags to replace the last matching log line instead of appending endlessly. This prevents the console from filling with thousands of near-identical redraw lines.

---

## 6. Camera Transport

### 6.1 Idle path

When teleop/record is not running:

- `/stream/{video_name}` reads from the normal streamer pool
- `/api/camera/snapshot/{video_name}` reads one frame from snapshot helpers

### 6.2 Active process path

When teleop or record is running:

- the backend first tries shared-memory JPEG files under `/dev/shm`
- these files are written by the camera patch layer used by the LeRobot-facing bridge
- this lets the UI keep showing camera frames while the subprocess owns the camera device

This is a key LeStudio-specific design choice.

### 6.3 Camera stats path

Camera statistics also depend on runtime mode.

- during teleop/record, stats come from the SHM stats file written by the process-side patch path
- otherwise, stats come from the streamer pool in the backend server process

---

## 7. Current Extension Rules

When adding a new feature, the transport choice should follow current project patterns.

### Use REST when

- the action is request/response oriented
- the UI needs a snapshot, not a stream
- the backend operation is short-lived or polled separately

### Use WebSocket when

- the UI needs live process output
- the event stream is append/replace oriented
- the feature belongs to the existing managed-process runtime loop

### Use camera HTTP endpoints when

- the UI needs frame delivery
- browser image rendering should stay independent from console event handling

---

## 8. Current Constraints

- `/ws` is a shared runtime channel, not a feature-specific socket per page.
- Camera transport is intentionally separate from `/ws`.
- Some long-running dataset and Hub workflows use REST plus polling rather than WebSocket.
- Process output semantics depend on `ProcessManager` parsing and normalization, not only on raw subprocess text.
- The frontend transport layer already contains backend-shape compatibility logic, so backend event changes should be made carefully.

---

## 9. Related Files

- `src/lestudio/routes/process.py`
- `src/lestudio/routes/streaming.py`
- `src/lestudio/routes/training.py`
- `src/lestudio/routes/eval.py`
- `src/lestudio/routes/devices.py`
- `src/lestudio/routes/dataset/`
- `src/lestudio/routes/motor.py`
- `src/lestudio/process_manager.py`
- `frontend/src/app/services/apiClient.ts`
- `frontend/src/app/services/bootstrap.ts`
