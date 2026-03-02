# Frontend-Wireframe Coverage Checklist

Last updated: 2026-03-02

## 목적

`frontend`(실제 동작 UI)와 `wireframe_test`(디자인 검증 UI)의 커버리지를 같은 기준으로 점검한다.

- 범위: 화면 구조, 사용자 인터랙션, 런타임 동작(API/WS/프로세스)
- 목표: 디자인 개선 중에도 실제 기능 요구사항 누락을 빠르게 찾기

## 기준 파일

- `frontend/src/App.tsx`
- `frontend/src/hooks/useConfig.ts`
- `frontend/src/hooks/useProcess.ts`
- `frontend/src/hooks/useWebSocket.ts`
- `wireframe_test/src/app/routes.ts`
- `wireframe_test/src/app/components/layout/AppShell.tsx`

## 1) 현재 스냅샷 (Baseline)

| 항목 | 상태 | 메모 |
| --- | --- | --- |
| 정보 구조(탭/페이지) 매핑 | PASS | 9개 기능 영역 모두 매핑 가능 |
| 레이아웃/내비게이션 패리티 | PASS | AppShell/사이드바/페이지 전환 구조 존재 |
| 실제 런타임 동작 패리티(API/WS/프로세스) | PARTIAL | Top3(Teleop/Record/Train) P0 endpoint-shape mock 연동 완료 + 알림 패리티(브라우저 Notification/인앱 Toast) 선반영 |
| 디자인 검증 용도 적합성 | PASS | 화면 구성, 밀도, 컴포넌트 일관성 검증에 적합 |

## 2) 기능 영역 매핑 체크

- [x] `status` (frontend) <-> `/` `SystemStatus` (wireframe)
- [x] `device-setup` <-> `/camera-setup`
- [x] `motor-setup` <-> `/motor-setup`
- [x] `calibrate` <-> `/motor-setup` 내 Calibration 탭/섹션
- [x] `teleop` <-> `/teleop`
- [x] `record` <-> `/recording`
- [x] `dataset` <-> `/dataset`
- [x] `train` <-> `/training`
- [x] `eval` <-> `/evaluation`

## 3) 디자인 패리티 체크 (Wireframe 목적)

- [x] 상단 헤더 정보 구조(브랜드/상태/유틸 액션)가 실제 앱 흐름과 충돌하지 않는다.
- [x] 사이드바 그룹(Setup/Operate/Data/ML)과 이동 순서가 `frontend` 학습 순서와 일치한다.
- [x] 각 페이지의 핵심 섹션 우선순위가 `frontend`와 동일하다.
- [x] 하단 고정 제어바(또는 동등한 주요 CTA 영역)가 Train/Eval/Record/Teleop에 존재한다.
- [x] 상태 배지/칩/에러 배너의 시각적 위계가 일관된다.
- [x] 모바일/태블릿/데스크톱에서 페이지 밀도와 스크롤 전략이 무너지지 않는다.

## 4) 인터랙션 패리티 체크 (UI 동작)

- [x] Start/Stop/Refresh/Goto 등 핵심 액션의 위치와 우선순위가 동일하다.
- [x] 상세/고급 설정 펼침 패턴이 일관되고 과도한 중첩이 없다.
- [x] 리스트 선택, 필터, 검색, 정렬의 피드백 패턴이 유지된다.
- [x] 빈 상태/로딩 상태/에러 상태 메시지 톤과 복구 동선이 정의된다.

## 5) 런타임 패리티 체크 (기능 커버 핵심)

아래 항목은 현재 `wireframe_test`에서 기본적으로 비어 있을 수 있으며, 필요 시 어댑터/목 계층으로 채운다.

- [x] Config 읽기/쓰기 계약이 `frontend`와 동일한 키 집합을 사용한다.
- [x] Process 제어(start/stop/preflight) 상태 머신이 실제 앱과 동일하다.
- [x] WebSocket 이벤트(log/proc status/resource/status feed) 채널이 정의되어 있다.
- [x] Dataset 목록/허브 검색 흐름에 대한 API 계약이 정의되어 있다. (`apiGet("/api/datasets")`, `apiGet("/api/hub/datasets/search")`)
- [x] Train/Eval 시작 전 블로커(preflight, checkpoint, env/task) 규칙이 반영되어 있다. (Eval: `apiGet("/api/eval/env-types")`, `apiPost("/api/eval/start")`)
- [x] Teleop/Record의 카메라 매핑/세션 상태/진행률 신호가 반영되어 있다.
- [x] SystemStatus가 `apiGet("/api/devices")`, `apiGet("/api/system/resources")`, `apiGet("/api/history")`를 사용한다.

## 6) 탭별 최소 커버 기준

| 도메인 | 디자인 구조 | 인터랙션 | 런타임 계약 |
| --- | --- | --- | --- |
| Status/SystemStatus | [x] | [x] | [x] |
| DeviceSetup/CameraSetup | [x] | [x] | [x] |
| MotorSetup(+Calibrate) | [x] | [x] | [x] |
| Teleop | [x] | [x] | [x] |
| Record/Recording | [x] | [x] | [x] |
| Dataset/DatasetManagement | [x] | [x] | [x] |
| Train/Training | [x] | [x] | [x] |
| Eval/Evaluation | [x] | [x] | [x] |

## 7) Known Gaps — 향후 개선 필요 항목

### Motor Setup: 인터랙티브 위저드 UI 정합성 (frontend 미흡)

`lerobot` motor setup은 모터를 **하나씩** 연결하고 ENTER를 눌러 ID/baud rate를 EEPROM에 영구 기록하는 인터랙티브 프로세스다 (6개 모터 순차 반복).

현재 **frontend**는 이 과정을 여전히 CLI 출력 + 하단 콘솔 드로어 입력에 의존한다. 반면 **wireframe_test**는 6-step 전용 위저드 UI(단계 진행/입력/에러 재시도)를 선반영했다.

**frontend 기준 향후 구현 필요:**
- 모터별 단계 진행 UI (1/6 → 2/6 → ... → 6/6)
- 각 단계에서 어떤 모터를 연결해야 하는지 시각적 안내 (예: "gripper 모터만 연결하고 ENTER")
- 완료된 모터의 ID/baud rate 할당 결과 표시
- 콘솔 드로어에 의존하지 않는 전용 입력 흐름

**참고:** 현재 frontend의 Step 1은 Start/Stop 버튼 + 가이드 텍스트만 존재하며, 백엔드 CLI 프로세스의 stdout을 콘솔 드로어로 전달하는 구조.

## 8) Frontend 교체 게이트 (Cutover)

아래 항목은 wireframe을 실제 frontend로 전환할 때의 필수 게이트다.

### 8.1 필수 정합 게이트

- [x] **Bootstrap side-effects parity**: 앱 부팅 시 `config/devices/deps/hf-whoami/sidebar signals` 초기화 흐름이 일치한다. **(현재: DONE)**
  - 근거: `frontend/src/App.tsx`, `frontend/src/hooks/useConfig.ts`, `frontend/src/hooks/useMappedCameras.ts`
  - 완료: `bootstrap.ts` → `runBootstrap()` (5 endpoint `Promise.allSettled`) → normalizer → store set. `App.tsx` useEffect에서 호출하여 `setConfig/setDevices/setSidebarSignals/setHfUsername` 반영.
- [x] **Global state semantics parity**: `activeTab/procStatus/wsReady/logLines/datasets/consoleHeight/mobileSidebarOpen` 의미와 생명주기가 일치한다. **(현재: DONE)**
  - 근거: `wireframe_test/src/app/store/index.ts` — `useSyncExternalStore` 기반, frontend Zustand store와 동일 키/타입/생명주기 구현.
- [x] **WebSocket event parity**: `/ws`의 `output/status/metric/api_health/api_support` 처리와 side-effect가 일치한다. **(현재: DONE)**
  - 근거: `frontend/src/hooks/useWebSocket.ts`, `wireframe_test/src/app/services/apiClient.ts`
  - 완료: `apiClient.ts`에 `api_health`/`api_support` 이벤트 리스너 + store `setApiHealth`/`setApiSupport` side-effect 추가.
- [x] **Process control parity**: `/api/preflight`, `/api/process/:name/{input,command,stop}`와 process name 집합이 일치한다. **(현재: DONE)**
  - 근거: `frontend/src/hooks/useProcess.ts`
  - 완료: `handlers.ts`에 `/api/process/:name/command` endpoint 추가 (request: `{command}`, response: `{ok, command}`).
- [x] **Console runtime parity**: 프로세스별 로그/입력 라우팅, running bar, train/eval 파싱(step/loss/reward/eta) 동작이 일치한다. **(현재: DONE)**
  - 근거: `frontend/src/components/shared/ConsoleDrawer.tsx`
- [x] **API surface hole 0건**: `/api/devices`, `/api/resources`, `/api/history`, `/api/eval/env-types`, `/api/camera/snapshot/:cam`, 삭제 계열 API가 누락되지 않는다. **(현재: DONE)**
  - 완료: `/api/devices`, `/api/system/resources`, `/api/history`, `/api/eval/env-types`, `/api/deps/status`, `/api/hf/whoami`, `/api/hub/datasets/search`, `/api/camera/snapshot/:cam` 전부 존재.

현 상태 요약:

- `DONE`: bootstrap.ts + App.tsx 부팅 흐름 완전 구현. 5개 endpoint 호출 → normalize → store 반영.
- `DONE`: store/index.ts에 frontend 수준의 전역 store contract 완전 구현 (`activeTab/procStatus/wsReady/logLines/apiHealth/apiSupport/...`).
- `DONE`: apiClient.ts에 `api_health/api_support` + non-train `output` WS 이벤트 처리 반영.
- `DONE`: handlers.ts에 `/api/process/:name/command` endpoint 추가.
- `DONE`: AppShell.tsx 콘솔 runtime parity 반영.
  - 완료: 프로세스 탭 선택, store `logLines` 렌더링, `/api/process/:name/input|command|stop` 라우팅, running info bar, train status/output/metric 수집.
  - 완료: train/eval 파서 보강(step/loss/eta/reward), mock 모드 non-train 로그 밀도 보강, passthrough non-train output 반영.
- `DONE`: `/api/camera/snapshot/:cam` 포함 전체 API surface 완료.

### 8.2 실행 순서 (권장)

- [x] **Phase A**: Foundation (store + bootstrap + localStorage semantics) **(완료)**
  - 선행 조건: 없음
  - 비고: bootstrap.ts/App.tsx/store 전부 구현 완료. 8.1의 bootstrap + global state 게이트 해소.
- [x] **Phase B**: Runtime contracts (WS + process API + 누락 endpoint) **(완료)**
  - 선행 조건: Phase A 완료
  - 비고: `api_health/api_support` WS parity, `/api/process/:name/command`, `/api/camera/snapshot/:cam` 추가 완료.
- [x] **Phase C**: Operator UX (console/runtime 운영 흐름) **(완료)**
  - 선행 조건: Phase B 완료
  - 비고: console의 입력 라우팅/진행 파싱은 process & WS 계약이 먼저 안정화되어야 검증 가능
- [x] **Phase D**: Cutover rehearsal (frontend 기준 시나리오 리플레이 + diff 보고) **(완료)**
  - 선행 조건: Phase A~C 완료
  - 비고: Blocking/High diff 판정은 기능 계약 구현 후에만 유효함

### 8.3 Go/No-Go 기준

- [x] Blocking diff 0건
- [x] High diff 0건
- [x] 빌드/타입체크/핵심 E2E 통과
- [x] rollback 경로 사전 리허설 완료

검증 근거 (2026-03-02):

- `wireframe_test`: `npm run build` 성공
- `wireframe_test`: `node workflow_audit.mjs` 결과 0 issues
- `wireframe_test`: `node verify_fixes.mjs` 결과 6/6
- `frontend`: 누락된 `src/lib/*` 모듈 복구 후 `npm run build` 성공
- rollback rehearsal: `src/lestudio/static` 백업 -> frontend build -> 백업본 restore -> `PYTHONPATH=src python -m lestudio --help` 성공

## 9) 완료 조건 (Definition of Done)

- [x] 디자인 리뷰에서 섹션 구조 mismatch 0건
- [x] 핵심 CTA 위치 mismatch 0건
- [x] 탭별 최소 커버 기준(6번 표) 전 항목 체크 완료
- [x] 런타임 계약 항목 중 우선순위 상(Top 3 탭: Teleop/Record/Train) 완료
- [x] 8번 Cutover 게이트 항목 전부 체크 완료
- [x] 변경 내용을 `wireframe_test/DESIGN_GUIDE.md`와 함께 유지보수 가능하게 문서화

DoD 검증 근거 (2026-03-02):

- `wireframe_test/workflow_audit.mjs` 실행 결과 0 issues (47 screenshots)
- `wireframe_test/verify_fixes.mjs` 실행 결과 6/6
- Top3 탭(Teleop/Record/Train) 런타임 계약: process start/stop/input + console parsing(step/loss/eta/reward) + WS 상태 반영 확인
- Section 8 cutover gate 전 항목 [x] 상태와 빌드/리허설 증적 동기화 완료
- `wireframe_test/DESIGN_GUIDE.md` 20장(컷오버 문서 연계) 추가로 유지보수 규칙 문서화

## 10) 카드 스타일 일관성 전수조사 (2026-03-02)

기준:

- 기준 규칙: `docs/wireframe/spec.md`의 **3.8 페이지 공통 레이아웃 규칙 (카드 적용 기준)**
- raw card wrapper 판정 문자열(정규 기준): `rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden`
- 조사 대상: `frontend/src/app/pages/*.tsx` 9개 페이지

정량 결과:

- raw card wrapper(정규 기준) 총 31건
- 페이지별 분포: Training 6, Evaluation 5, SystemStatus 5, MotorSetup 5, DatasetManagement 5, CameraSetup 2, Recording 1, Teleop 1, Calibration 1
- 공유 `Card` 컴포넌트 사용: Calibration 3건, MotorSetup 3건
- 카드 계열 컨테이너 총계(raw wrapper + `Card`) 37건
- `BlockerCard` 사용: 5개 페이지 7건 (Training/Teleop/Recording/Calibration/MotorSetup)

페이지별 판정:

| 페이지 | 판정 | 근거 |
| --- | --- | --- |
| `Training.tsx` | PASS | 메인 학습 설정 카드 유지 (`frontend/src/app/pages/Training.tsx:650`) + 보조 카드 일관 |
| `Evaluation.tsx` | PASS | 메인 평가 설정 카드 유지 (`frontend/src/app/pages/Evaluation.tsx:383`), 독립 패널 카드 패턴 일관 |
| `SystemStatus.tsx` | PASS | 핵심 패널은 카드, 상단 verdict는 유틸 스트립로 분리 (`frontend/src/app/pages/SystemStatus.tsx:98`, `frontend/src/app/pages/SystemStatus.tsx:111`) |
| `DatasetManagement.tsx` | PASS | 목록/상세/패널 단위 카드 경계 일관 (`frontend/src/app/pages/DatasetManagement.tsx:1349`) |
| `CameraSetup.tsx` | PASS | 장치/카메라 주요 블록 카드 유지 (`frontend/src/app/pages/CameraSetup.tsx:261`, `frontend/src/app/pages/CameraSetup.tsx:316`) |
| `Teleop.tsx` | PASS (의도적 Mixed) | 서브탭 내부 입력폼 비카드(`frontend/src/app/pages/Teleop.tsx:273`), 카메라 설정은 카드(`frontend/src/app/pages/Teleop.tsx:329`) |
| `Recording.tsx` | PASS (의도적 Mixed) | 계획/디바이스 입력폼 비카드(`frontend/src/app/pages/Recording.tsx:337`, `frontend/src/app/pages/Recording.tsx:377`), 카메라 설정 카드(`frontend/src/app/pages/Recording.tsx:430`) |
| `MotorSetup.tsx` | REVIEW | **동시에 보이는** 동일 레벨 패널에서 shared `Card` + raw card wrapper 혼용 (`frontend/src/app/pages/MotorSetup.tsx:1213`, `frontend/src/app/pages/MotorSetup.tsx:762`) |
| `Calibration.tsx` | REVIEW | **동시에 보이는** 동일 레벨 패널에서 shared `Card` + raw card wrapper 혼용 (`frontend/src/app/pages/Calibration.tsx:372`, `frontend/src/app/pages/Calibration.tsx:509`) |

우선순위 개선 권고:

1. **P1 (일관성 핵심)**: `MotorSetup`, `Calibration`의 동일 레벨 패널 컨테이너를 `Card` 중심으로 수렴하거나, raw wrapper 유지 시 예외 규칙을 페이지 상단 주석/문서에 명시.
2. **P2 (확장성)**: 신규/대규모 수정 페이지는 독립 패널에 raw wrapper 추가 대신 `components/wireframe`의 `Card` 우선 사용.
3. **P3 (디자인 안정성)**: 비카드 폼은 서브탭 내부 연속 입력 흐름에만 제한하고, 메인 설정 블록은 카드 유지 원칙 고수.

판정 주의사항:

- Mixed 판정은 상호 배타적 탭 상태 간 차이가 아니라, **동일 뷰포트 상태에서 동시에 노출되는 sibling 패널** 혼용일 때만 적용한다.

## 11) 사용 방법

- 기능을 추가/수정할 때마다 2번(매핑)과 6번(탭별 기준)을 먼저 업데이트한다.
- 디자인 리뷰 전에는 3번/4번을 체크하고, 개발 착수 전에는 5번 런타임 계약을 확정한다.
- 전환 준비 단계에서는 8번(Cutover)부터 먼저 갭을 닫고, 마지막에 9번 DoD를 검증한다.
- `frontend`에 새 탭 또는 큰 플로우 변경이 생기면 이 문서를 같은 PR에서 같이 갱신한다.
