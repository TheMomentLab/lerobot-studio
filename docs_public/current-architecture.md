# LeStudio - Current Architecture

Last updated: 2026-03-08
Status: current-state reference

---

## 1. Purpose

This document describes how LeStudio is built and operates today.

It is intentionally different from:

- `docs/roadmap.md` - feature and delivery roadmap
- `docs/ecosystem-integration-plan.md` - future-facing expansion and multi-robot redesign

This document focuses on the implemented runtime architecture: frontend/backend boundaries, subprocess orchestration, streaming, shared state, and the current LeRobot coupling boundary.

---

## 2. System Overview

LeStudio is a browser-based workbench around LeRobot workflows.

At a high level:

1. The frontend is built in `frontend/` and bundled into `src/lestudio/static/`.
2. FastAPI serves both the REST/WebSocket backend and the built frontend assets.
3. Long-running operations such as teleop, record, calibrate, train, and eval are executed as subprocesses.
4. Process stdout/stderr, derived metrics, and status updates are streamed to the browser over `/ws`.
5. Camera previews use MJPEG and snapshot HTTP endpoints, with a separate SHM-based fast path during teleop/record.

Today, the application is best understood as a three-layer system:

- Frontend UI and client transport
- FastAPI orchestration layer
- LeRobot bridge layer plus subprocess execution

---

## 3. Top-Level Architecture

```text
Browser UI
  -> REST (`/api/*`) for config, device queries, control actions
  -> WebSocket (`/ws`) for process output, metrics, status
  -> HTTP streaming (`/stream/*`, `/api/camera/snapshot/*`) for camera frames

FastAPI app (`src/lestudio/server.py`)
  -> shared AppState
  -> route modules under `src/lestudio/routes/`
  -> ProcessManager for subprocess lifecycle
  -> static frontend serving from `src/lestudio/static/`

LeRobot boundary
  -> command builders compose CLI arguments
  -> bridge modules isolate direct `lerobot.*` imports
  -> subprocesses execute teleop/record/calibrate/train/eval flows
```

---

## 4. Backend Architecture

### 4.1 App Factory and Route Assembly

`src/lestudio/server.py` is the backend entry point.

Key responsibilities:

- configure logging and runtime environment
- patch `LD_LIBRARY_PATH` for NVIDIA Python package layouts
- create the FastAPI app and apply CORS and token auth middleware
- create shared `AppState`
- construct `ProcessManager`
- recover orphaned processes from previous server sessions
- include route modules for devices, config, udev, process control, training, eval, dataset, streaming, and motor APIs
- mount `src/lestudio/static/` at `/` for SPA serving

Important implementation detail:

- `server.py` computes `ROBOT_TYPES` via `device_registry.get_robot_types()`, so backend startup already depends on the dynamic registry layer.

### 4.2 Shared AppState

`src/lestudio/routes/_state.py` defines `AppState`, which is passed into each route factory.

It centralizes:

- `proc_mgr` - subprocess lifecycle manager
- config file paths and helpers
- rule file paths
- history file path and append helper
- dataset background job state
- Python executable path used by launchers

This is the main in-memory coordination object for the backend.

### 4.3 Route Module Responsibilities

Current route split from `server.py`:

- `routes/devices.py` - hardware and device discovery
- `routes/config.py` - persisted UI/runtime configuration
- `routes/udev.py` - udev rule workflows
- `routes/process.py` - teleop/record/calibrate/motor setup start-stop-input flows and preflight checks
- `routes/training.py` - training orchestration and CUDA-related checks
- `routes/eval.py` - evaluation orchestration and checkpoint-driven execution
- `routes/dataset/*` - dataset listing, curation, Hub integration
- `routes/streaming.py` - camera MJPEG, snapshots, system metrics, WebSocket streaming
- `routes/motor.py` - live motor monitoring APIs

The backend is organized around route factories instead of one monolithic app module, with `AppState` used as the common dependency.

---

## 5. Process Orchestration

### 5.1 ProcessManager Role

`src/lestudio/process_manager.py` is the runtime core for long-running work.

Its responsibilities go beyond simply calling `subprocess.Popen`:

- start and stop managed processes
- isolate processes in new process groups/sessions
- stream stdout/stderr into a shared queue
- extract training metrics from text output
- translate common raw errors into user-facing guidance
- deduplicate live table redraws and carriage-return progress updates
- persist running PIDs so the server can reconnect after restart
- detect and monitor orphaned processes
- enforce hardware conflict groups

Managed process names are currently:

- `teleop`
- `record`
- `calibrate`
- `motor_setup`
- `train`
- `train_install`
- `eval`

Hardware conflict groups currently enforced:

- `arms`: `calibrate`, `teleop`, `record`, `motor_setup`
- `gpu`: `train`, `eval`

This means LeStudio treats process scheduling as part of the product logic, not as a thin shell wrapper.

### 5.2 Command Builders

`src/lestudio/command_builders.py` composes CLI arguments for teleop, record, calibrate, motor setup, train, eval, and dataset derivation.

Current state is mixed:

- train/eval builders are relatively generic
- `device_registry.py` is already moving toward dynamic ecosystem support
- teleop/record/calibrate builders still contain several SO-100/SO-101-centric defaults and direct type selections

That split is important: LeStudio is already architecturally preparing for generalized hardware support, but the runtime command composition is still only partially generalized.

### 5.3 Process Route Flow

`src/lestudio/routes/process.py` is the main control surface for long-running operations.

Important behaviors:

- `/api/process/{name}/status` exposes running and reconnected-orphan status
- `/api/process/{name}/stop` stops managed processes and unlocks cameras
- `/api/process/{name}/input` forwards stdin to running subprocesses
- `/api/process/{name}/command` launches normalized console commands in the managed process framework
- `/api/preflight` performs path, permission, calibration, and camera readiness checks
- `/api/teleop/start`, `/api/record/start`, `/api/calibrate/start`, `/api/motor_setup/start` translate UI config into command-builder launches

This route layer is where UI intent becomes operational subprocess work.

---

## 6. Streaming and Camera Architecture

### 6.1 WebSocket Channel

`src/lestudio/routes/streaming.py` exposes `/ws`.

Today the WebSocket sends:

- `output` events from the `ProcessManager` queue
- `metric` events for parsed training metrics
- periodic `status` snapshots for all managed processes

The browser uses this stream as the live runtime event bus for process consoles and train progress.

### 6.2 Camera Paths

LeStudio has two different camera paths:

1. Idle preview path
   - MJPEG streamers and snapshot helpers read from the normal streamer pool
   - used when teleop/record is not running

2. Active process path
   - during teleop/record, camera frames are read from shared memory JPEG files written by the camera patch layer
   - this keeps the UI preview alive while the LeRobot process owns the cameras

Relevant endpoints in `routes/streaming.py`:

- `/stream/{video_name}` - MJPEG stream
- `/api/camera/snapshot/{video_name}` - single-frame snapshot endpoint
- `/api/camera/stats` - camera FPS and bandwidth data
- `/api/system/resources` - CPU, RAM, disk, cache size
- `/api/gpu/status` - `nvidia-smi` backed GPU metrics

This split is a defining design choice of LeStudio: the UI keeps camera visibility even while the underlying robot process is running.

---

## 7. Frontend Architecture

### 7.1 App Bootstrap

`frontend/src/app/App.tsx` is the frontend root.

On startup it:

- requests browser notification permission
- runs `runBootstrap()` from `services/bootstrap.ts`
- loads config, devices, dependency status, HF identity, and train preflight state
- polls process status endpoints for all managed process names
- seeds global UI state before the routed pages render

This means the frontend does not wait for a single backend bootstrap payload. It assembles startup state from several API calls.

### 7.2 Routing

`frontend/src/app/routes.ts` defines the app shell plus the main workflow pages:

- status
- camera setup
- motor setup
- teleop
- record
- dataset
- train
- eval

The route structure mirrors the product workflow from setup to operation to ML evaluation.

### 7.3 Global Store

`frontend/src/app/store/index.ts` is the main UI state container.

Important current-state note:

- some older notes still refer to Zustand
- the actual implementation today is a custom global store built on `useSyncExternalStore`

The store currently owns:

- active tab and tab persistence
- loaded config
- device inventory
- process status and orphan-reconnection flags
- API health and support flags
- console log buffers with replace-tag support
- toast messages
- sidebar status signals
- mobile sidebar state
- Hugging Face username
- dataset list and loading state
- console drawer height

The store also contains action functions directly on the state object, so it behaves like a single application controller rather than a collection of isolated slices.

### 7.4 Transport Layer

`frontend/src/app/services/apiClient.ts` encapsulates API transport.

Key characteristics:

- dual mode: `mock` and `passthrough`
- REST helpers for GET/POST/DELETE
- a single shared WebSocket connection for runtime events
- separate listener registries for train and non-train channels
- normalization of backend event shapes into frontend event shapes
- fallback behavior that appends output directly into the global store when no explicit listener is attached

This file is effectively the frontend IPC layer.

### 7.5 Bootstrap Service

`frontend/src/app/services/bootstrap.ts` converts several backend responses into a normalized startup view model.

It is responsible for:

- tolerant parsing of config and device payloads
- deriving sidebar signals from dependency and preflight information
- auto-prefilling `user/...` repo IDs with the current HF username when available
- collecting degraded-startup errors without hard-failing the whole app

This keeps page components from having to implement backend-shape cleanup logic individually.

---

## 8. Current Runtime Flows

### 8.1 Startup Flow

```text
Browser loads SPA
  -> FastAPI serves built frontend assets
  -> App mounts and calls `runBootstrap()`
  -> frontend fetches config/devices/deps/HF/preflight
  -> frontend fetches per-process status
  -> global store is initialized
  -> pages render against hydrated state
```

### 8.2 Teleop / Record Execution Flow

```text
User starts teleop or record
  -> frontend POSTs to `/api/teleop/start` or `/api/record/start`
  -> route validates conflicts and readiness
  -> command builder creates CLI args
  -> ProcessManager launches subprocess
  -> bridge layer runs LeRobot-facing code
  -> stdout/stderr flows into ProcessManager queue
  -> `/ws` pushes output and status to browser
  -> frontend store and console UI update live
  -> camera frames come from SHM instead of normal preview streamers
```

### 8.3 Train Flow

```text
User starts training
  -> training route launches process
  -> ProcessManager parses training log lines
  -> extracted metrics are emitted as `metric` events
  -> frontend subscribes to status/output/metric channels
  -> charts and progress UI update incrementally
```

---

## 9. LeRobot Coupling Boundary

LeStudio is designed so most backend code does not import `lerobot.*` directly.

Current project guidance treats the LeRobot coupling boundary as isolated to these files:

- `src/lestudio/teleop_bridge.py`
- `src/lestudio/record_bridge.py`
- `src/lestudio/camera_patch.py`
- `src/lestudio/device_registry.py`
- `src/lestudio/motor_monitor_bridge.py`

Design intent:

- backend routes remain orchestration-focused
- command builders only compose arguments
- LeRobot-specific adaptation is concentrated in a small boundary layer
- future framework or multi-robot changes can be handled near the boundary instead of across the whole app

This is one of the most important architectural rules in the project.

---

## 10. Important Current-State Characteristics

### 10.1 Static Frontend, Unified Deployment

LeStudio is deployed as a single FastAPI application that serves both APIs and the built SPA. This keeps local installation and desktop-lab usage simple.

### 10.2 REST for Control, WebSocket for Live State

The app uses a clear split:

- REST for commands, config, discovery, and point-in-time state
- WebSocket for live process output and metrics
- HTTP streaming/snapshot endpoints for camera frames

### 10.3 Resilience Across Server Restarts

`ProcessManager` persists running process metadata and can reconnect to orphaned processes. Live stdout is not recovered, but the UI can still show that the process is running and later detect when it exits.

### 10.4 Error Translation Is Part of UX

LeStudio does not expose raw CLI output only. `ProcessManager` recognizes common failure patterns such as missing calibration, camera open failure, CUDA issues, and missing Python packages, then emits translated guide messages.

### 10.5 The Generalization Work Is In Progress

The codebase already contains a dynamic registry layer in `device_registry.py`, but the operational path is not fully generalized yet. In practice, the system still has SO-family assumptions in several command-building and process-launch flows.

This is important context when reading `docs/ecosystem-integration-plan.md`: that document is not detached theory, but an extension of work already underway in the current codebase.

---

## 11. Known Architectural Tensions

These are not necessarily bugs, but they matter for future changes.

- Some older planning notes still describe a Zustand-based frontend, while the current store is a custom external store.
- Dynamic device discovery is ahead of dynamic command generation.
- The server is modularized through route factories, but long-running workflow knowledge is still concentrated in a few large orchestration files.
- Camera handling has two runtime paths by design, which is powerful but makes streaming behavior more complex than a normal web dashboard.

Contributors should preserve existing patterns unless they are deliberately paying down one of these tensions.

---

## 12. Relationship to Other Docs

- Read this document first to understand how LeStudio works today.
- Read `docs/api-and-streaming.md` for transport-level details about REST, WebSocket, and camera delivery.
- Read `docs/roadmap.md` to understand what the team plans to build next.
- Read `docs/ecosystem-integration-plan.md` to understand how the current architecture is expected to evolve toward broader LeRobot ecosystem support.

Together, the three documents answer:

- what exists now
- what is planned next
- how the architecture is expected to expand
