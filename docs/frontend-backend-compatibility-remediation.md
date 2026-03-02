# Frontend-Backend Compatibility Remediation Plan

Last updated: 2026-03-02 (PM, live runtime validated)

## Document Status

- Status: DONE
- Owner: AI agent (Hephaestus)
- Scope: New `frontend/` compatibility hardening against current FastAPI backend

## Goal

신규 `frontend/`를 실제 백엔드 계약(REST/WS/payload shape)에 맞춰 안정화한다.
또한 각 항목 개선 전 'frontend_legacy/'에는 어떻게 구현되어 있는지 확인한다.

- Primary target: 백엔드 정합성 (기능이 실제로 시작/중지/조회되는지)
- Non-target: 디자인/스타일 개선

## Current Assessment (What is broken)

현재 신규 프론트는 일부 화면이 mock/demo 계약(camelCase, UI-friendly field)으로 구현되어 있어,
백엔드의 snake_case 계약과 충돌한다.

### P0 - Immediate Breakage

1. `POST /api/preflight` request key mismatch
   - Affected: `frontend/src/app/pages/Teleop.tsx`, `frontend/src/app/pages/Recording.tsx`
   - Required by backend: `robot_mode`, ports, ids, `cameras` (`src/lestudio/routes/process.py`)

2. `POST /api/teleop/start` payload mismatch
   - Affected: `frontend/src/app/pages/Teleop.tsx`
   - Required by backend builder: `teleop_speed`, `follower_port/leader_port` or bimanual port keys (`src/lestudio/command_builders.py`)

3. `POST /api/record/start` payload mismatch
   - Affected: `frontend/src/app/pages/Recording.tsx`
   - Required by backend builder: `record_repo_id`, `record_episodes`, `record_task`, `record_push_to_hub`, `record_resume`, arm ports, `cameras` (`src/lestudio/command_builders.py`)

4. `POST /api/eval/start` payload mismatch (DONE)
   - Affected: `frontend/src/app/pages/Evaluation.tsx`
   - Required by backend builder: `eval_env_type`, `eval_policy_path`, `eval_repo_id`, `eval_episodes`, `eval_device`, `eval_task` (`src/lestudio/routes/eval.py`, `src/lestudio/command_builders.py`)

5. `GET /api/history` render crash risk (DONE)
   - Affected: `frontend/src/app/pages/SystemStatus.tsx`
   - Backend may return object `meta`; frontend must not render object as React child (`src/lestudio/routes/config.py`, `src/lestudio/routes/_state.py`)

6. Dataset/Hub contract mismatch (DONE)
   - Affected: `frontend/src/app/pages/DatasetManagement.tsx`
   - `/api/hub/datasets/search`: param/field mismatch (`q` vs `query`, `results` vs `datasets`)
   - `/api/datasets`: field mismatch (`episodes/frames/size` vs `total_episodes/total_frames/size_mb`)

### P1 - Degraded Behavior

1. `POST /api/train/start` payload mismatch (DONE)
   - Affected: `frontend/src/app/pages/Training.tsx`
   - Required by backend: `train_policy`, `train_repo_id`, `train_steps`, `train_device`, `train_lr`, `train_batch_size`

2. Device label normalization missing (`CUDA (GPU)` vs `cuda`) (DONE)
   - Affected: `frontend/src/app/pages/Training.tsx`, `frontend/src/app/pages/Evaluation.tsx`

3. Resource response field mismatch (DONE)
   - Affected: `frontend/src/app/pages/SystemStatus.tsx`
   - Backend keys: `ram_used_mb`, `ram_total_mb`, `disk_used_gb`, `disk_total_gb`, `lerobot_cache_mb`

4. Checkpoint `step` nullable safety (DONE)
   - Affected: `frontend/src/app/pages/Training.tsx`

5. Non-train websocket subscription gap (DONE)
   - Affected: `frontend/src/app/services/apiClient.ts`

### P2 - Quality/Observability

- [x] Preflight error message quality (`checks[]` 기반 사용자 메시지 합성)
- [x] Bootstrap defensive normalization hardening
- [x] Mock handlers contract sync (`frontend/src/mock-api/handlers.ts`)

## Implementation Plan (Improved)

## Phase 1 - Contract Adapter First (P0)

Create a central adapter layer to avoid per-page one-off mapping.

- Add: `frontend/src/app/services/contracts.ts`
  - `toBackendPreflightPayload(...)`
  - `toBackendTeleopStartPayload(...)`
  - `toBackendRecordStartPayload(...)`
  - `toBackendTrainStartPayload(...)`
  - `toBackendEvalStartPayload(...)`
  - `fromBackendResources(...)`
  - `fromBackendHistory(...)`
  - `fromBackendDatasetList(...)`
  - `fromBackendHubSearch(...)`

- Update callers:
  - `frontend/src/app/pages/Teleop.tsx`
  - `frontend/src/app/pages/Recording.tsx`
  - `frontend/src/app/pages/Training.tsx`
  - `frontend/src/app/pages/Evaluation.tsx`
  - `frontend/src/app/pages/SystemStatus.tsx`
  - `frontend/src/app/pages/DatasetManagement.tsx`

Reason:
- 계약 변경점이 한 파일에서 통제되므로 회귀가 줄고 테스트 작성이 쉬워진다.

## Phase 2 - Runtime Safety + WS Completion (P1)

- `frontend/src/app/pages/SystemStatus.tsx`
  - `meta` object-safe rendering (`JSON.stringify` fallback)

- `frontend/src/app/pages/Training.tsx`
  - `step` null-safe formatting

- `frontend/src/app/services/apiClient.ts`
  - `subscribeNonTrainChannel` 실제 이벤트 라우팅 구현

## Phase 3 - Quality Gate (P2)

- Improve preflight failure message synthesis
- Align mock handlers to real backend response keys
- Add local compatibility smoke tests (frontend service layer 중심)

## Detailed Task Checklist

### A. Contract Mapping Tasks

- [x] Add `contracts.ts` with strict TypeScript interfaces for backend payload/response
- [x] Map Teleop page start/preflight payload to backend schema
- [x] Map Recording page start/preflight payload to backend schema
- [x] Map Training page start payload and device normalization
- [x] Map Evaluation page start payload and env/task fields
- [x] Map SystemStatus resources/history response parsers
- [x] Map DatasetManagement local list + hub search parsers

### B. Runtime Safety Tasks

- [x] Guard `history.meta` render against object values
- [x] Guard `checkpoint.step` formatting when null/undefined
- [x] Implement non-train WS channel subscription path

### C. Validation Tasks

- [x] Teleop: preflight pass + start/stop success
- [x] Record: preflight pass + start/input/stop success
- [x] Train: start success with intended config keys
- [x] Eval: start success with env/policy/task keys
- [x] SystemStatus: no runtime render error on history/resources
- [x] DatasetManagement: local list + hub search load without key errors

## Definition of Done

All conditions below must be true:

1. Teleop/Record/Train/Eval requests use backend-expected snake_case keys.
2. SystemStatus and DatasetManagement handle backend response fields without runtime errors.
3. WebSocket events update train + non-train channels consistently.
4. Frontend validation succeeds (`lint`, `build`, related tests for changed modules).
5. No fallback dependency on mock-only response shape in production passthrough mode.

## Verification Evidence (Latest)

- Frontend type + build gate passed in `frontend/` via `npm run build` (`tsc --noEmit && vite build`).
- Build artifacts updated under `src/lestudio/static/`.
- Live backend runtime checks passed against `http://127.0.0.1:8000`.
- Verified flows: `teleop` preflight/start/stop, `record` preflight/start/input/stop, `train` start/stop, `eval` start/stop.
- Verified data endpoints: `/api/system/resources`, `/api/history`, `/api/datasets`, `/api/hub/datasets/search`.
- Raw runtime evidence saved at `/tmp/lestudio_runtime_checks_live.json`.

## Recommended Execution Order

1. Build `contracts.ts` and migrate all API callers.
2. Fix SystemStatus and DatasetManagement response parsing.
3. Complete WS non-train subscription path.
4. Run verification gates and collect evidence.

## Effort Estimate

- Engineering effort: Medium (1-2 working days)
- Risk: Medium (multiple page-level integrations)

## Completion Marker

- This document creation/update task: DONE
- Frontend compatibility remediation implementation task: DONE
