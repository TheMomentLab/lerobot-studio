# Contributing to LeStudio

LeStudio is a web GUI orchestrator for Hugging Face LeRobot workflows.
This guide defines the minimum engineering bar for pull requests.

## Local Setup

```bash
git clone https://github.com/TheMomentLab/lestudio.git
cd lestudio
conda create -n lerobot python=3.10 -y
conda activate lerobot
make dev
cd frontend && npm ci && cd ..
```

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

## Non-Negotiable Architecture Rule

Do not import `lerobot.*` outside these 5 adapter files:

1. `src/lestudio/teleop_bridge.py`
2. `src/lestudio/record_bridge.py`
3. `src/lestudio/camera_patch.py`
4. `src/lestudio/device_registry.py`
5. `src/lestudio/motor_monitor_bridge.py`

All other backend code must stay decoupled and run LeRobot through subprocess orchestration.

## Required Checks Before PR

Backend:

```bash
python3 -m compileall -q src/lestudio
ruff check src/lestudio
mypy src/lestudio --ignore-missing-imports
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest -q -m "not smoke_hw" tests
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest -q -p pytest_cov -m "not smoke_hw" --cov=lestudio --cov-report=term-missing --cov-report=xml tests
```

Frontend:

```bash
cd frontend
npm run lint
npm test -- --run
npm run build
```

Hardware smoke checks (optional, real devices only):

```bash
LESTUDIO_RUN_HW_SMOKE=1 PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest -q -m "smoke_hw" tests/smoke_hw
```

## Test Scope Expectations

1. Backend route/process logic changes must include regression tests in `tests/`.
2. Frontend state or tab behavior changes must update/add tests when logic changes.
3. Hardware-dependent validation belongs in `tests/smoke_hw` with `@pytest.mark.smoke_hw`.

## Pull Request Expectations

1. Explain behavioral impact and risks clearly.
2. Include validation commands and outcomes in the PR description.
3. Keep commits focused and reviewable.
4. Follow the release gate in [docs/release-checklist.md](docs/release-checklist.md) for release-facing changes.

## Security Reporting

Do not post vulnerabilities in public issues.
Use GitHub private vulnerability reporting or contact maintainers privately.
