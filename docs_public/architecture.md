# Architecture

LeStudio is built as a local-first web application with a browser frontend, a FastAPI orchestration layer, and a small LeRobot adapter boundary.

Use this page when you want the shortest accurate picture of how the product is assembled today.

## Core structure

- `frontend/` contains the React + TypeScript UI.
- `src/lestudio/server.py` assembles the FastAPI app and serves the built frontend from `src/lestudio/static/`.
- `src/lestudio/routes/` contains route modules for devices, config, udev, process control, training, eval, dataset workflows (listing, curation, hub), streaming, and motor monitoring.
- `src/lestudio/process_manager.py` owns subprocess lifecycle, output parsing, orphan recovery, and hardware conflict checks.
- LeRobot-specific imports stay isolated to the adapter boundary: `teleop_bridge.py`, `record_bridge.py`, `camera_patch.py`, `device_registry.py`, and `motor_monitor_bridge.py`.

## Runtime model

LeStudio uses three transport paths:

- REST for control actions and point-in-time state
- WebSocket for live process output, metrics, and running status
- HTTP camera endpoints for MJPEG and snapshots

Typical execution flow:

```text
UI action
  -> REST request
  -> route module validates and builds command args
  -> ProcessManager launches subprocess
  -> output and metrics flow into `/ws`
  -> frontend updates console, charts, and status badges
```

## Frontend state

The UI currently uses a custom global store in `frontend/src/app/store/index.ts` built on `useSyncExternalStore`.

The store keeps:

- loaded config
- device inventory
- process status
- runtime log lines
- sidebar signals
- dataset state
- UI-only state such as active tab and console height

## Important current-state nuance

LeStudio already has dynamic device discovery through `device_registry.py`, but command execution is only partially generalized. Some teleop/record/calibrate paths still contain SO-family defaults while the broader multi-robot design work is underway.

## Related Guides

- [API and Streaming](api-and-streaming.md) for REST, WebSocket, and camera delivery
- [Workflow](workflow.md) for the user-facing setup-to-eval flow
- [Contributing](contributing.md) for development constraints and codebase boundaries

## More detail

- See [API and Streaming](api-and-streaming.md) for transport and endpoint behavior.
- See the repository docs for deeper internal notes: `docs/current-architecture.md` and `docs/api-and-streaming.md`.
