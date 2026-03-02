# LeStudio Frontend

React 19 + TypeScript + Vite frontend for LeStudio.

This app powers the 9-tab workbench UI and is served by FastAPI after build output is written to `src/lestudio/static`.

## Prerequisites

- Node.js 20+
- npm 10+
- LeStudio backend installed (`pip install -e .` from repo root)

## Local Development

From `LeStudio/frontend`:

```bash
npm install
npm run dev
```

Default dev server:

- Frontend: `http://localhost:5173`
- API proxy target: `http://localhost:8000`
- WS proxy target: `ws://localhost:8000`

Start backend in a separate terminal (from repo root):

```bash
lestudio --port 8000
```

## Build

```bash
npm run build
```

Build behavior is defined in `frontend/vite.config.ts`:

- `outDir: ../src/lestudio/static`
- `emptyOutDir: true`

So the build is directly deployed into the backend static directory.

## Lint and Preview

```bash
npm run lint
npm run preview
```

## Key Frontend Structure

- `src/App.tsx`: app shell, navigation, mode/theme/global behaviors
- `src/store/index.ts`: Zustand global state
- `src/tabs/*`: feature tabs (Status, Device Setup, Motor Setup, Calibrate, Teleop, Record, Dataset, Train, Eval)
- `src/components/shared/*`: reusable UI blocks
- `src/hooks/*`: API and websocket hooks

## Notes

- Keep shared state in Zustand; avoid per-tab duplicated source-of-truth state.
- Keep API access in hooks when possible (`useConfig`, `useProcess`, `useWebSocket`).
- Keep styling in project CSS and existing variable conventions.
