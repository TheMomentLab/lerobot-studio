# wireframe_test API Contract Mock Layer Design

Last updated: 2026-03-02

## Goal

`wireframe_test`에 "실행 가능한 최소 계약면"을 추가한다.

- 목적: 백엔드 구현 전에도 `frontend`와 동일한 엔드포인트 형태를 기준으로 화면/흐름 검증
- 범위: Teleop/Record/Train 우선
- 비범위: 실제 하드웨어 제어, 완전한 서버 로직 재현

## Design Principles

- Endpoint-shape parity first: URL/메서드/요청-응답 key를 `frontend` 기대치와 맞춘다.
- Stateful but minimal: 세션/프로세스 상태만 유지하고 세부 연산은 단순화한다.
- Progressive replacement: 현재 정적 `useState` 흐름을 단계적으로 API 어댑터 호출로 치환한다.
- Transport split: HTTP 계약 + 선택적 WS 이벤트 시뮬레이션을 분리한다.

## Source Contracts (frontend evidence)

- Config/Process 공통
  - `frontend/src/hooks/useConfig.ts`
  - `frontend/src/hooks/useProcess.ts`
  - `frontend/src/hooks/useWebSocket.ts`
- Tab별 계약 사용처
  - `frontend/src/tabs/TeleopTab.tsx`
  - `frontend/src/tabs/RecordTab.tsx`
  - `frontend/src/tabs/TrainTab.tsx`

## Minimum Contract Surface

### 1) Common

- `GET /api/config`
- `POST /api/config`
- `POST /api/preflight`
- `POST /api/process/:name/stop`
- `POST /api/process/:name/input`

### 2) Teleop

- `GET /api/robots`
- `GET /api/teleops?robot_type=...`
- `GET /api/calibrate/list`
- `POST /api/camera/check_paths`
- `POST /api/teleop/start`

### 3) Record

- `GET /api/camera/stats`
- `POST /api/record/start`

### 4) Train

- `GET /api/datasets`
- `GET /api/gpu/status`
- `GET /api/checkpoints`
- `GET /api/train/preflight?device=...`
- `POST /api/train/start`
- `POST /api/train/install_pytorch`
- `POST /api/train/install_torchcodec_fix`
- `POST /api/train/colab/config`
- `GET /api/train/colab/link?...`

### 5) Optional WS Simulation

- status: process 상태 변화 이벤트
- output: process 로그 라인 이벤트
- metric: train metric 이벤트(step/loss/total)

## Proposed Structure (wireframe_test)

```text
wireframe_test/src/
  mock-api/
    contracts/
      common.ts
      teleop.ts
      record.ts
      train.ts
    state/
      processState.ts
      sessions.ts
      configState.ts
    handlers/
      common.ts
      teleop.ts
      record.ts
      train.ts
    ws/
      emitter.ts
      channels.ts
    adapter.ts
  app/
    services/
      apiClient.ts
      teleopService.ts
      recordService.ts
      trainService.ts
```

## Adapter Contract

`apiClient`는 UI가 호출하는 단일 진입점이다.

- `get<T>(path: string): Promise<T>`
- `post<T>(path: string, body?: unknown): Promise<T>`
- `transportMode: "mock" | "passthrough"` (기본: `mock`)

현재 구현 상태:

- `wireframe_test/src/app/services/apiClient.ts`에서 transport mode 지원
  - env: `VITE_API_TRANSPORT_MODE=mock|passthrough`
  - runtime: localStorage key `wireframe-api-transport-mode`

`mock` 모드에서는 `mock-api/adapter.ts`가 path matcher로 handler에 위임한다.

## Minimal Stateful Model

- `configState`: `/api/config` 저장소
- `processState`: `{ teleop, record, train, train_install, ... }` boolean map
- `sessions`: teleop/record/train session id, step/episode counters
- `logs`: process별 최근 로그 버퍼 (console drawer용)

## Capability-State Model (Oracle-aligned)

갭 평가는 "endpoint 개수"가 아니라 "사용자 가시 상태 전이" 기준으로 한다.

- 공통 process 상태: `idle -> starting -> running -> stopping -> stopped/error`
- Teleop capability-state 예시
  - `teleop_preflight_ok`
  - `teleop_started`
  - `teleop_blocked_conflict`
- Record capability-state 예시
  - `record_session_started`
  - `record_episode_saved`
  - `record_episode_discarded`
- Train capability-state 예시
  - `train_preflight_failed`
  - `train_install_needed`
  - `train_running_with_metrics`
  - `train_stopped_with_checkpoint`

## Handler Behavior (minimum)

- `/api/preflight`: 입력 cfg를 받아 `ok/checks[]` 반환
  - 규칙은 단순화: 필수 key 누락/형식 오류/충돌 플래그만 체크
- `/api/teleop/start`: 상태 전이 `teleop=false -> true`, 기본 로그 append
- `/api/record/start`: 상태 전이 `record=false -> true`, episode base 초기화
- `/api/train/start`: 상태 전이 `train=false -> true`, 진행 카운터 초기화
- `/api/process/:name/stop`: 해당 process false로 전환
- `/api/process/record/input`: `right/left/escape` 처리

## WS Event Simulation (optional but recommended)

- 500ms tick으로 train metric 생성: `step`, `loss`, `total`
- process 상태 변경 시 status 이벤트 발행
- start/stop/에러 조건에서 output 로그 발행

현재 구현 상태:

- `wireframe_test/src/mock-api/handlers.ts`에서 in-memory `status/output/metric` 채널 분리 완료
- `wireframe_test/src/app/pages/Training.tsx`가 channel 구독으로 진행률/상태/로그 라인을 반영
- `wireframe_test/src/app/pages/Teleop.tsx`가 `/api/camera/check_paths`로 카메라 경로 검증 반영
- `wireframe_test/src/app/pages/Recording.tsx`가 `/api/camera/stats` 폴링으로 FPS 표시 반영
- `wireframe_test/src/app/pages/Training.tsx`가 `/api/datasets`, `/api/gpu/status` 폴링 반영
- `wireframe_test/src/app/services/apiClient.ts` passthrough에서 실제 `/ws` 메시지(`type=status|output|metric`)를
  channel 이벤트(`status|output|metric`)로 정규화해 소비 가능
  - metric 필드 호환: `totalSteps | total | total_steps` 모두 지원
  - status 필드 호환: `train_install=true` + `train=false` 조합을 `starting`으로 정규화

## Scenario Set (deterministic)

다음 시나리오는 REST 응답과 WS 이벤트 순서를 함께 규정한다.

- `happy_path`: 정상 시작/진행/중지
- `no_device`: preflight 실패 + blocker 노출
- `process_crash`: running 중 error output 후 stopped
- `train_install_needed`: preflight action + install endpoint 경유
- `colab_link_missing`: config 업로드 성공, link 재조회 필요

각 시나리오는 동일 입력에서 동일 타임라인을 반환해야 한다.

UI가 현재 폴링/로그 파싱 기반이므로, WS를 붙이면 Top3 탭의 동작 검증 밀도가 크게 올라간다.

## Migration Plan

1. Phase A: Client abstraction
   - 페이지 direct state 변경 전후에 `apiClient` 호출만 추가
2. Phase B: Common contracts
   - `/api/config`, `/api/preflight`, `/api/process/*` 연결
3. Phase C: Teleop/Record contracts
   - 시작/중지/입력/카메라 stats/check_paths 연결
4. Phase D: Train contracts
   - preflight/install/start/checkpoints/colab 링크 연결
5. Phase E: WS simulation
   - status/output/metric 채널 추가

## Risks and Mitigations

- Risk: mock shape drift (`frontend` 변경 후 `wireframe_test` 미반영)
  - Mitigation: 계약 키셋 체크리스트를 PR 템플릿에 추가
- Risk: 상태 전이 불일치(예: train_install vs train)
  - Mitigation: process state map에 canonical alias 규칙 명시
- Risk: 지나친 mock 복잡화
  - Mitigation: 하드웨어/실연산은 비범위 고정, 상태 전이/계약면만 유지

## Definition of Done

- Top3 탭에서 start/stop/핵심 액션이 모두 `apiClient` 경유
- `frontend`가 기대하는 필수 endpoint shape를 `wireframe_test`에서 응답
- console/status/진행률 UI가 mock 상태 전이에 따라 동작
- 계약 문서와 실제 handler key가 불일치 0건
