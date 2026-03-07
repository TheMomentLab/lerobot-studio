# Contributing

Thank you for contributing to LeStudio!

## Development Setup

```bash
git clone --recursive https://github.com/TheMomentLab/lestudio.git
cd lestudio
conda activate lerobot
make install
```

## Project Structure

```
LeStudio/
├── frontend/               # React + TypeScript + Vite frontend
│   └── src/
│       ├── main.tsx        # Frontend entrypoint
│       ├── app/
│       │   ├── App.tsx     # Root app assembly
│       │   ├── routes.ts   # React Router route definitions
│       │   ├── store/      # Zustand global store
│       │   ├── components/ # Shared UI and layout components
│       │   └── hooks/      # Custom hooks
├── src/lestudio/           # Python FastAPI backend
│   ├── cli.py              # CLI entrypoint
│   ├── server.py           # App factory + router assembly
│   ├── routes/             # API route modules
│   ├── process_manager.py  # subprocess lifecycle management
│   ├── command_builders.py # CLI command builders
│   ├── teleop_bridge.py    # LeRobot teleop wrapper (lerobot import boundary)
│   ├── record_bridge.py    # LeRobot record wrapper (lerobot import boundary)
│   ├── camera_patch.py     # OpenCVCamera SHM patch (lerobot import boundary)
│   ├── device_registry.py  # 3-Registry discovery (lerobot import boundary)
│   └── motor_monitor_bridge.py  # FeetechMotorsBus REST (lerobot import boundary)
└── tests/                  # Backend pytest tests
```

## Critical Constraints

### LeRobot Import Boundary

`lerobot.*` imports are **only** allowed in these five files:

- `teleop_bridge.py`
- `record_bridge.py`
- `camera_patch.py`
- `device_registry.py`
- `motor_monitor_bridge.py`

Do **not** add `from lerobot.*` anywhere else. These five files are the adapter boundary for future multi-robot support.

### Frontend Rules

- **State management**: Zustand single store (`frontend/src/app/store/index.ts`) — no local state sprawl
- **Styling**: Match the existing utility-class and shared-component patterns in `frontend/src/app/components/`
- **Types**: Minimize `any`; define proper interfaces/types close to the feature or in shared contracts
- **Build output**: `frontend/` → `src/lestudio/static/` via `npm run build`

## Running Tests

**Backend:**

```bash
conda activate lerobot
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python -m pytest -q -m "not smoke_hw" tests
```

**Frontend:**

```bash
cd frontend
npm ci
npx tsc --noEmit
npm run build
```

**Hardware smoke tests** (requires physical devices):

```bash
LESTUDIO_RUN_HW_SMOKE=1 PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python -m pytest -q -m "smoke_hw" tests/smoke_hw
```

## Adding a Feature

When wrapping a new `lerobot` capability:

1. Update or add a command builder in `command_builders.py`
2. Add or extend a route module under `src/lestudio/routes/`, then include it from `server.py`
3. Create or update the page component under `frontend/src/app/pages/`
4. Add custom hooks in `frontend/src/app/hooks/` if needed
5. Verify WebSocket log streaming works end-to-end

## Code Quality

- No `as any`, `@ts-ignore`, or `@ts-expect-error` in TypeScript
- No empty `catch` blocks
- Run `lsp_diagnostics` (or `tsc --noEmit`) before submitting a PR
- Match existing patterns — check nearby files before introducing a new paradigm
