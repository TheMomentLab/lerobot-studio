# Release Checklist

Use this checklist before tagging a public release.

## 1. Quality Gate

Run all required checks from a clean environment.

```bash
# 1. Submodule 확인
git submodule update --init --recursive

# 2. 환경 설치 (lerobot submodule 포함)
make install  # 또는 make install-full (추가 의존성 포함)

# 3. Backend 검증
python3 -m compileall -q src/lestudio
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest -q -m "not smoke_hw" tests

# 4. Frontend 검증
cd frontend
npm ci
npm run lint
npm test -- --run
npm run build
```

## 2. Architecture Guardrails

1. Confirm `lerobot.*` imports exist only in:
   - `src/lestudio/teleop_bridge.py`
   - `src/lestudio/record_bridge.py`
   - `src/lestudio/camera_patch.py`
   - `src/lestudio/device_registry.py`
2. Verify new route/process logic includes regression tests.
3. Keep hardware-only assertions in `tests/smoke_hw`.
4. Confirm lerobot submodule commit is up-to-date with `TheMomentLab/lerobot` main.
5. Verify `make install` completes without downgrading PyTorch (check `python -c 'import torch; print(torch.__version__)'`).

## 3. Hardware Validation

On a hardware host:

```bash
LESTUDIO_RUN_HW_SMOKE=1 PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest -q -m "smoke_hw" tests/smoke_hw
```

Record the host profile used (camera/arm model, OS, kernel, GPU presence).

## 4. Security & Operations

1. Validate `SECURITY.md` and `README.md` reflect current deployment guidance.
2. Confirm localhost default bind and token behavior on non-localhost exposure.
3. Ensure no secrets/tokens are committed.

## 5. Documentation & Community

1. Update `README.md` for user-facing behavior changes.
2. Update `CONTRIBUTING.md` if dev workflow or checks changed.
3. Ensure issue/PR templates still match the current validation flow.

## 6. Release Notes

1. Summarize user-visible changes.
2. Call out breaking changes and migration steps.
3. Include known limitations and deferred risks.
