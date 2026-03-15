# Contributing to LeStudio

LeStudio is a web GUI orchestrator for Hugging Face LeRobot workflows.
This guide defines the minimum engineering bar for pull requests.

## Local Setup

```bash
git clone --recursive https://github.com/TheMomentLab/lestudio.git
cd lestudio
conda create -n lerobot python=3.10 -y
conda activate lerobot
make dev
cd frontend && npm ci && cd ..
```

Use `make install` only if you want the runtime package without contributor tooling. `make dev` installs the backend dev extras used by CI (`ruff`, `mypy`, pytest helpers).

## Development Run

Backend:

```bash
conda activate lerobot
lestudio serve --port 8000 --no-browser
```

Frontend:

```bash
cd frontend
npm run dev
```

Restart guidance (what to restart after frontend/backend changes):

- See `docs/operations/dev-restart-guide.md`

## Non-Negotiable Architecture Rule

Do not import `lerobot.*` outside these 5 adapter files:

1. `src/lestudio/teleop_bridge.py`
2. `src/lestudio/record_bridge.py`
3. `src/lestudio/camera_patch.py`
4. `src/lestudio/device_registry.py`
5. `src/lestudio/motor_monitor_bridge.py`

All other backend code must stay decoupled and run LeRobot through subprocess orchestration.

A few files reference `lerobot` **indirectly** via subprocess spawning or `importlib.import_module()`.
These are intentional and acceptable because they create runtime coupling only, not compile-time imports:

- `command_builders.py` — Builds subprocess command strings containing `lerobot` script paths
- `calibrate_bridge.py` — Uses `importlib.import_module()` for dynamic robot-type resolution
- `motor_setup_bridge.py` — Spawns `lerobot_setup_motors` as a subprocess

The CI boundary check (`rg` + `grep` in `ci.yml`) enforces the compile-time import rule.
Subprocess and dynamic-import patterns are outside its scope by design.

## Required Checks Before PR

Backend:

```bash
python3 -m ruff check src/lestudio
python3 -m mypy src/lestudio --ignore-missing-imports
python3 -m compileall -q src/lestudio
make test
```

Frontend:

```bash
cd frontend
npm ci
npm run lint
npm test -- --run
npm run test:e2e
npm run build
```

Hardware smoke checks (optional, real devices only):

```bash
make test-hw
```

## Test Scope Expectations

1. Backend route/process logic changes must include regression tests in `tests/`.
2. Frontend state or tab behavior changes must pass `npm run lint`, `npm test -- --run`, `npm run test:e2e`, and `npm run build`.
3. Hardware-dependent validation belongs in `tests/smoke_hw` with `@pytest.mark.smoke_hw`.

## Pull Request Expectations

1. Explain behavioral impact and risks clearly.
2. Include validation commands and outcomes in the PR description.
3. Keep commits focused and reviewable.
4. Follow the release gate in [CHANGELOG.md](CHANGELOG.md) for release-facing changes.
5. If user-visible functionality or top-level product messaging changes, update `docs_public/feature-spec.md`, `README.md`, and `README.ko.md` in the same PR.

## Security Reporting

Do not post vulnerabilities in public issues.
Use GitHub private vulnerability reporting or contact maintainers privately.
