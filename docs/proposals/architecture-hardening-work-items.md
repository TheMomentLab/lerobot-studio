# LeStudio — 아키텍처 리팩터링 작업 티켓

최종 갱신: 2026-03-14
상태: 작업 초안 (Work Items)

## 1. 목적

이 문서는 [`architecture-hardening-plan.md`](architecture-hardening-plan.md)을 실제 구현 가능한 작업 티켓 단위로 분해한 실행 문서다.

원칙:

- 각 티켓은 독립적으로 리뷰 가능해야 한다
- 파일 소유 범위를 가급적 분리한다
- "구조 정리"만 하지 말고, 테스트와 운영 이득이 같이 나와야 한다

## 2. 추천 실행 순서

1. A1 capability registry
2. A2 path policy centralization
3. A3 policy/route regression tests
4. B1 process event buffer
5. B2 websocket fan-out
6. B3 recent-log REST API
7. C1 bootstrap contract typing
8. C2 job/preflight contract typing
9. D1 process service extraction
10. D2 dataset service extraction
11. D3 training service extraction
12. E1 run ownership metadata

## 3. 작업 티켓

### A1. Route Capability Registry 도입

- 목표: 경로 문자열 기반 보호/정책 연결을 capability 선언 방식으로 전환한다.
- 범위:
  - `src/lestudio/_auth.py`
  - `src/lestudio/server.py`
  - `src/lestudio/routes/*.py`
  - 신규 `src/lestudio/capabilities.py`
- 작업:
  - capability enum 또는 상수 집합 정의
  - 라우트별 capability 매핑 표준화
  - 기존 protected prefix 로직을 capability 조회 방식으로 교체
- 완료 기준:
  - 새 mutation endpoint 추가 시 `_auth.py` 문자열 목록 수정이 필요 없다
  - process/dataset/motor/udev/hf-token 관련 보호 정책이 한 구조 안에서 조회된다
- 테스트:
  - capability별 보호 범위 테스트
  - 경로 rename에 덜 민감한 회귀 테스트
- 선행/의존:
  - 없음

### A2. Path Policy Helper 중앙화

- 목표: dataset/calibration/token/log/temp 경로 규칙을 단일 helper 계층으로 모은다.
- 범위:
  - `src/lestudio/command_builders.py`
  - `src/lestudio/routes/process.py`
  - `src/lestudio/routes/training.py`
  - `src/lestudio/routes/dataset/listing.py`
  - `src/lestudio/routes/dataset/hub.py`
  - 신규 `src/lestudio/path_policy.py`
- 작업:
  - dataset root, calibration root, hf token file, temp dir, logs root helper 정의
  - 개별 라우트의 직접 경로 조립 제거
  - 향후 workspace root override 가능성 고려
- 완료 기준:
  - 주요 저장 경로 규칙이 한 파일에 모인다
  - route module이 `Path.home()`를 직접 조합하는 코드가 크게 줄어든다
- 테스트:
  - path helper 단위 테스트
  - local dataset root / default cache path 회귀 테스트
- 선행/의존:
  - 없음

### A3. 정책/경로 정합성 회귀 테스트 보강

- 목표: policy와 route drift를 테스트에서 조기에 잡는다.
- 범위:
  - `tests/test_server_auth.py`
  - 신규 또는 확장 테스트 파일
- 작업:
  - 모든 mutating route 목록을 기준으로 보호 정책 검증
  - capability 기준 테스트 추가
  - route path와 protection 범위 불일치 검출 테스트 추가
- 완료 기준:
  - 주요 mutating endpoint가 테스트에 열거된다
  - policy 누락이 CI에서 바로 드러난다
- 테스트:
  - pytest
- 선행/의존:
  - A1 이후 권장

### B1. Process Event Buffer 도입

- 목표: 단일 소비 queue 대신 process별 ring buffer 또는 append-only event store를 도입한다.
- 범위:
  - `src/lestudio/process_manager.py`
  - 신규 `src/lestudio/events.py`
- 작업:
  - process별 event append 구조 설계
  - 출력/metric/status 이벤트를 공통 envelope로 저장
  - 최근 N개 조회 API를 위한 read interface 정의
- 완료 기준:
  - 로그가 subscriber 유무와 무관하게 최근 이력을 유지한다
  - event schema가 queue payload보다 명확해진다
- 테스트:
  - append/read/fan-out 단위 테스트
  - max buffer trimming 테스트
- 선행/의존:
  - 없음

### B2. WebSocket Fan-out 구조로 전환

- 목표: websocket이 queue를 drain하지 않고 event subscription consumer가 되도록 바꾼다.
- 범위:
  - `src/lestudio/routes/streaming.py`
  - `src/lestudio/process_manager.py`
  - `frontend/src/app/services/apiClient.ts`
- 작업:
  - websocket connection별 cursor 또는 sequence 기반 소비 모델 설계
  - 다중 브라우저 탭 동시 수신 보장
  - reconnect 후 최근 이벤트 재동기화 가능 구조 마련
- 완료 기준:
  - 두 개 이상 클라이언트가 같은 로그를 안정적으로 본다
  - websocket reconnect 시 최근 상태를 복원할 수 있다
- 테스트:
  - backend websocket integration test
  - frontend reconnect smoke test
- 선행/의존:
  - B1

### B3. Recent Log / Event Snapshot API 추가

- 목표: live stream 외에 최근 로그/메트릭을 REST로 조회할 수 있게 한다.
- 범위:
  - `src/lestudio/routes/streaming.py`
  - `src/lestudio/process_manager.py`
- 작업:
  - process별 recent events endpoint 추가
  - run inspector 및 모바일 클라이언트에서 재사용 가능하도록 응답 구조 고정
- 완료 기준:
  - websocket 없이도 최근 상태/로그 tail을 조회할 수 있다
  - inspector/mobile 확장에 재사용 가능한 API가 생긴다
- 테스트:
  - recent log API 테스트
- 선행/의존:
  - B1

### C1. Bootstrap Contract 타입화

- 목표: bootstrap에서 쓰는 응답 구조를 명시적 계약으로 고정한다.
- 범위:
  - `src/lestudio/routes/config.py`
  - `src/lestudio/routes/devices.py`
  - `src/lestudio/routes/training.py`
  - `src/lestudio/routes/dataset/hub.py`
  - `frontend/src/app/services/bootstrap.ts`
  - `frontend/src/app/store/types.ts`
- 작업:
  - bootstrap에 필요한 API 응답 타입 정의
  - 프론트 normalize/fallback 최소화
  - snake_case/camelCase 혼재 정리 방향 결정
- 완료 기준:
  - `bootstrap.ts`의 추측성 정규화 코드가 줄어든다
  - bootstrap 관련 타입이 store와 일치한다
- 테스트:
  - frontend typecheck
  - bootstrap normalization regression test
- 선행/의존:
  - 없음

### C2. Job / Preflight / Event Envelope 계약 통합

- 목표: train/eval/dataset job 및 preflight 응답을 공통 패턴으로 정리한다.
- 범위:
  - `src/lestudio/routes/training.py`
  - `src/lestudio/routes/eval.py`
  - `src/lestudio/routes/dataset/hub.py`
  - `src/lestudio/routes/dataset/curation.py`
  - `src/lestudio/routes/models.py`
  - `frontend/src/app/services/contracts.ts`
- 작업:
  - job status 공통 필드 정의
  - preflight 응답 모델 정리
  - websocket event envelope 타입 통합
- 완료 기준:
  - job polling UI가 endpoint별 예외 처리 없이 동작한다
  - frontend contracts가 실제 backend 응답과 맞물린다
- 테스트:
  - response model regression tests
  - frontend compile/type tests
- 선행/의존:
  - C1 권장
  - B1/B2와 병행 가능

### D1. ProcessLaunchService 추출

- 목표: process route에서 orchestration 로직을 분리한다.
- 범위:
  - `src/lestudio/routes/process.py`
  - 신규 `src/lestudio/services/process_service.py`
- 작업:
  - guard/start/stop/input/preflight 일부를 서비스로 이동
  - route는 request parsing과 response shaping만 남기기
- 완료 기준:
  - `routes/process.py`가 얇아진다
  - 서비스 단위 테스트가 가능해진다
- 테스트:
  - service unit tests
  - process route regression tests
- 선행/의존:
  - A2 있으면 유리

### D2. DatasetService 추출

- 목표: dataset listing/hub/curation에 흩어진 파일 I/O와 job orchestration을 묶는다.
- 범위:
  - `src/lestudio/routes/dataset/listing.py`
  - `src/lestudio/routes/dataset/hub.py`
  - `src/lestudio/routes/dataset/curation.py`
  - 신규 `src/lestudio/services/dataset_service.py`
- 작업:
  - dataset path resolution
  - delete/list/video/job orchestration
  - episode tags/stats/derive helper 분리
- 완료 기준:
  - dataset routes가 파일 조립과 subprocess orchestration을 직접 하지 않는다
  - dataset 관련 정책을 한 서비스에서 테스트할 수 있다
- 테스트:
  - dataset service tests
  - tags/stats/derive regression tests
- 선행/의존:
  - A2 strongly recommended

### D3. TrainingService / PreflightService 추출

- 목표: training route의 dependency probe, installer start, colab config 생성을 분리한다.
- 범위:
  - `src/lestudio/routes/training.py`
  - 신규 `src/lestudio/services/training_service.py`
- 작업:
  - preflight/cache/install/start/colab 책임 분리
  - installer command 처리와 UI-facing 응답 shaping 경계 정리
- 완료 기준:
  - `routes/training.py`가 orchestration 세부사항을 거의 갖지 않는다
  - preflight와 installer 흐름이 독립 테스트 가능하다
- 테스트:
  - training service unit tests
  - colab config regression tests
- 선행/의존:
  - A2, C2 권장

### E1. Run Ownership Metadata 추가

- 목표: 누가 어떤 run을 시작했고 어떤 장치/로봇에 연결되는지 메타데이터를 남긴다.
- 범위:
  - `src/lestudio/process_manager.py`
  - `src/lestudio/routes/_state.py`
  - `src/lestudio/routes/streaming.py`
- 작업:
  - process별 owner/session/workspace/robot metadata 구조 설계
  - history 및 event에 ownership metadata 포함
  - future multi-session/multi-robot을 위한 key 설계
- 완료 기준:
  - run 단위 식별자가 status/log/history에서 일관되게 보인다
  - 추후 session-scoped observer 추가가 쉬워진다
- 테스트:
  - metadata persistence tests
- 선행/의존:
  - B1 이후 권장

## 4. 실행 결정 (2026-03-14)

### 지금 실행하는 것

| 티켓 | 사유 | 상태 |
|---|---|---|
| **A2. Path Policy 중앙화** | 경로 중복이 실제 버그 원인이 될 수 있다. `Path.home() / ".cache" / ..."` 조합이 5개 이상 파일에 반복되고, dataset root / calibration root 변경 시 수정 지점이 흩어져 있다. 변경 범위가 작고 즉시 이득이 있다. | **완료** (`path_policy.py`) |
| **B1. Event Buffer (경량)** | `out_q.get_nowait()` 단일 소비 큐가 실재하는 문제다. `collections.deque` ring buffer + subscriber list로 교체. WebSocket이 subscribe/poll 모델로 전환. B2/B3은 이 위에서 필요할 때 확장. | **완료** (`EventBuffer` in `process_manager.py`) |
| **C1. Bootstrap Contract 타입화** | `bootstrap.ts`의 normalize/fallback 코드가 실제로 복잡하다. 백엔드 응답 구조와 프론트 타입이 일치하면 새 페이지 추가 시 정규화 로직 반복이 줄어든다. | **다음** |

### 보류하는 것과 사유

| 티켓 | 사유 |
|---|---|
| **A1. Capability Registry** | 엔드포인트 15~20개 수준에서 capability enum + 미들웨어 교체는 ceremony 대비 이득이 낮다. 현재 prefix list가 fragile한 건 맞지만 엔드포인트 추가 빈도가 높지 않다. 엔드포인트가 30개를 넘거나 정책 분기가 복잡해지면 그때 도입한다. |
| **A3. 정합성 회귀 테스트** | A1 없이도 가능하지만, A2 완료 후 path helper 단위 테스트와 함께 묶는 게 효율적이다. A2 완료 후 후속으로 진행. |
| **B2. WebSocket Fan-out** | B1 경량 버전(deque + subscriber)이 사실상 fan-out 기초를 포함한다. cursor 기반 재동기화까지 가는 건 모바일/inspector 클라이언트가 실제로 필요해질 때 한다. |
| **B3. Recent Log REST API** | B1 경량 버전의 deque에서 직접 읽으면 되므로 별도 티켓 규모가 아니다. 필요하면 B1과 함께 endpoint 하나 추가하는 수준. |
| **C2. Job/Preflight Contract** | C1 이후 자연스럽게 진행. C1 없이 하면 bootstrap 타입과 job 타입이 따로 놀게 된다. |
| **D1~D3. Service 추출** | Route가 두꺼운 건 맞지만, 현재 기능 개발을 막고 있지 않다. A2/C1 완료 후 route 코드가 정리되면 자연스럽게 추출 지점이 보인다. 지금 하면 경로/계약이 불안정한 상태에서 서비스를 만드는 셈이다. |
| **E1. Run Ownership** | YAGNI. 다중 로봇/다중 세션 요구사항이 확정되지 않은 상태에서 ownership metadata를 설계하면, 실제 요구사항이 나왔을 때 다시 뒤집힐 가능성이 높다. ecosystem-integration-plan 확정 후 진행. |

### 우선순위 근거

1. **운영 안정성 > 아키텍처 순도**: 유저가 지금 겪는 문제(경로 중복으로 인한 누락, 다중 탭 로그 누락, 타입 불일치)를 먼저 고친다.
2. **작은 변경, 확실한 이득**: 대규모 리팩터링(A1, D1~D3)보다 변경 범위가 작고 즉시 효과가 나는 항목을 먼저 한다.
3. **YAGNI**: 아직 확정되지 않은 미래 요구사항(다중 로봇, 모바일 앱, 원격 관측자)을 위해 지금 설계하지 않는다.

### 실행 후 재평가 기준

- A2 완료 후: A3 회귀 테스트를 A2 path helper 테스트와 묶어서 진행
- B1 완료 후: 다중 탭 안정성 확인. 문제가 남으면 B2 cursor 모델 검토
- C1 완료 후: C2를 바로 이어서 할지, D 계열로 갈지 결정
- 엔드포인트 30개 초과 시: A1 재검토
- 다중 로봇 로드맵 확정 시: E1 재검토
