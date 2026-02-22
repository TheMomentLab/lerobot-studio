# LeRobot Studio GUI Redesign: Workbench Layout

작성일: 2026-02-22

이 문서는 현재 LeRobot Studio의 상단 탭 중심 UI(`src/lerobot_studio/static/index.html`)를 "로봇 워크벤치(workbench)" 형태로 재설계하기 위한 구체 설계안이다. 기존 디자인/코드를 유지해도 되지만, 탭 수가 늘어난 현재(9탭) 구조에서는 왼쪽 내비게이션 + 작업 공간 모델이 장기적으로 확장성과 가독성이 좋다.

## 목표

- 초보 사용자가 `Setup -> Operate -> Data -> ML` 흐름을 따라가며 막히지 않게 한다.
- "왜 안 되는지"를 UI에서 즉시 드러낸다(권한/의존성/장치 접근/프로세스 상태).
- Teleop/Record의 멀티 카메라 피드가 좁아지지 않게 한다(사이드바 축소/전체화면).
- 현재 백엔드 API/WS 구조(`src/lerobot_studio/server.py`, `/ws`)는 그대로 활용한다.

## 비목표

- 프론트엔드 프레임워크 도입(React/Vue 등) 강제하지 않는다.
- 인증/권한 모델을 여기서 완결하지 않는다(Phase 5 Remote Operation 범위).

## 구현 현황 (2026-02-22)

- [x] 1단계: 레이아웃 뼈대 교체
  - 상단 탭 대신 좌측 사이드바(Setup/Operate/Data/ML) 도입
  - 기존 탭 로직(`.tab-btn` + `data-tab`) 재사용으로 동작 리스크 최소화
- [x] 2단계: Console Drawer 통합
  - 하단 공통 콘솔 드로어 추가(프로세스 선택 + 로그 + stdin)
  - 탭 내부 개별 로그 패널은 제거, 공통 콘솔 단일 경로로 정리
- [x] 3단계 일부: Guided/Advanced + 배지 기본 적용
  - Guided 기본, Advanced 토글 제공
  - Guided에서 Data/ML unlock(데이터셋 존재, train preflight) 적용
  - RUNNING/ERROR 배지 적용(`/ws` status + 최근 error line)
- [ ] 후속
  - NEEDS ROOT / MISSING DEP / NEEDS DEVICE 배지 정교화
  - Mobile에서 콘솔 fullscreen overlay 옵션 검토
  - Guided 단계별 CTA(Next) 강화

## 정보 구조(IA)

왼쪽 내비게이션은 "기능 나열"이 아니라 "워크플로우 그룹"으로 구성한다.

- Setup
  - Status
  - Device Mapping (udev)
  - Motor Setup
  - Calibration
- Operate
  - Teleop
  - Record
- Data
  - Dataset (local browser / quality / hub push)
- ML
  - Train
  - Eval

각 메뉴 항목에는 상태 배지(예: RUNNING, ERROR, NEEDS ROOT, MISSING DEP)를 붙여 사용자가 맥락 전환 없이 문제를 파악하게 한다.

## 레이아웃(2-column + drawers)

### 1) Top Bar (전역)

상단바는 전역 요소만 포함한다.

- 프로파일 선택/저장/가져오기(기존 `ProfileManager`)
- WebSocket 연결 상태(기존 ws dot/label)
- GitHub 링크
- (선택) "Guided/Advanced" 토글

### 2) Left Sidebar (내비게이션)

- 그룹 접기/펼치기(Setup/Operate/Data/ML)
- 메뉴 항목 클릭 시 해당 "뷰" 로드
- 항목별 배지/아이콘 표시
- 사이드바 축소 모드(아이콘 레일) 제공

### 3) Main Workspace (콘텐츠)

기본 패턴은 "설정/컨트롤"과 "프리뷰/결과"의 2패널을 사용한다.

- 기본 뷰:
  - 좌측 패널: 폼/버튼/체크리스트(설정)
  - 우측 패널: 결과(장치 리스트, 품질 리포트, 미리보기)
- Teleop/Record 뷰:
  - 피드 그리드가 메인
  - 설정은 접히는 패널(우측 drawer 또는 상단 collapse panel)
  - "Full screen feeds" 토글 제공(피드 몰입 모드)

### 4) Bottom Console Drawer (로그/STDIN)

현재는 탭 내에 로그가 흩어져 있는데, 공통 콘솔 드로어로 통합한다.

- 프로세스 선택(teleop/record/calibrate/motor_setup/train/eval)
- stdout/stderr/translation 표시(기존 WS 메시지 kind를 그대로 사용)
- 입력(선택) `POST /api/process/{name}/input`의 UI
- 에러가 발생하면 콘솔 드로어에 배지/하이라이트를 주어 즉시 확인 가능하게 한다.

## 와이어프레임(텍스트)

```
┌───────────────────────────────────────────────────────────────────────┐
│ Top Bar: Profile | WS Status | Guided/Advanced | GitHub               │
├───────────────┬───────────────────────────────────────────────────────┤
│ Sidebar       │ Main Workspace                                          │
│ - Setup ▾     │  [View Header + per-view actions]                       │
│   - Status    │  ┌───────────────┬───────────────────────────────────┐ │
│   - Mapping   │  │ Controls/Form │ Preview/Results                    │ │
│   - Motors    │  └───────────────┴───────────────────────────────────┘ │
│   - Calib     │                                                       │
│ - Operate ▾   │  (Teleop/Record: feeds grid + collapsible controls)    │
│ - Data ▾      │                                                       │
│ - ML ▾        │                                                       │
├───────────────┴───────────────────────────────────────────────────────┤
│ Bottom Console Drawer: [proc select] [log] [stdin input]               │
└───────────────────────────────────────────────────────────────────────┘
```

## 상태/배지 설계(확장성 핵심)

### 배지 종류

- RUNNING: `proc_mgr.status_all()`에서 true
- ERROR: 최근 120초 내 error line 감지(프론트에서 이미 `lastErrorAtByProcess`로 추정 가능)
- NEEDS ROOT: udev apply가 `sudo -n` 실패한 상태 또는 권한 필요 상태
- MISSING DEP: 기능 실행에 필요한 외부 의존성 미설치
  - 예: Hub push는 `huggingface-cli` 필요(`src/lerobot_studio/server.py`에서 which로 검사)
  - 예: Dataset 상세/품질은 parquet/pandas가 필요할 수 있음(런타임 import)
- NEEDS DEVICE: `preflight` 실패(카메라/포트 접근 불가)

### 배지 데이터 소스(권장)

프론트는 아래 API를 폴링/캐시해 배지를 계산한다.

- `/ws` status: 프로세스 실행 여부
- `GET /api/devices`: 장치 존재/리스트
- `POST /api/preflight`: 포트/캘리브레이션/카메라 접근 체크
- `GET /api/train/preflight`: CUDA 호환성 체크
- `GET /api/datasets`: 로컬 데이터셋 존재 체크
- `GET /api/datasets/push/status/{job_id}`: Hub push 진행 상태

## Guided vs Advanced 모드(UX 전략)

### Guided (기본 권장)

- Setup/Operate만 기본 노출
- Data/ML은 "Unlock" 방식(Record로 데이터 생성 후, Dataset이 활성화 / Train은 CUDA preflight 통과 시 활성화)
- 각 단계에 "Next" CTA를 제공(예: Calibration 통과 후 Teleop로 이동)

### Advanced

- 모든 메뉴 노출
- 고급 파라미터(예: `robot.type`, `teleop.type`, train flags) 표시

## 뷰별 구현 단위(현재 코드 매핑)

기존 `main.js`의 Tab 객체들을 "View 모듈"로 재구성한다(기능 코드는 재사용, DOM 셀렉터만 변경).

- StatusView: `StatusTab`
- MappingView: 기존 Mapping DOM + `/api/rules/*`
- MotorSetupView: `MotorSetupTab`
- CalibrationView: `CalibrateTab`
- TeleopView: `TeleopTab`
- RecordView: `RecordTab`
- DatasetView: Dataset 관련 로직(이미 `/api/datasets*` 풍부)
- TrainView: `TrainTab`
- EvalView: `EvalTab`
- ConsoleDrawer: WS output 라우팅/프로세스 선택/STDIN

## 반응형/화면 제약

- Desktop(>= 1100px): 사이드바 + 2패널 기본
- Medium(800-1100px): 사이드바 collapse(아이콘 레일) 기본, Teleop/Record는 "feeds first"
- Mobile(< 800px): 사이드바는 drawer, 콘솔은 풀스크린 오버레이 가능

Teleop/Record의 카메라 영역은 최소 폭을 보장해야 하므로, 이 두 뷰에서는 "전체화면(피드)" 토글이 사실상 필수다.

## 단계적 마이그레이션(권장)

리스크를 낮추기 위해 구조 변경을 3단계로 나눈다.

1) 레이아웃 뼈대만 교체
   - TopBar/Sidebar/Main/ConsoleDrawer DOM 추가
   - 기존 탭 섹션은 그대로 두고, 클릭 시 `display: none/block`만 바꿔서 동작 유지
2) ConsoleDrawer로 로그 통합
   - 기존 탭 내부 로그 영역은 유지하되, 콘솔도 동시에 표시(동시 기간)
   - 안정화 후 탭 내부 로그를 축소하거나 제거
3) Guided 모드 도입 + 배지 정교화
   - preflight 기반으로 메뉴 활성화/비활성화
   - NEEDS ROOT/MISSING DEP 같은 즉시 피드백 추가

## 오픈 질문(결정 필요)

- 기본 모드를 Guided로 둘지 Advanced로 둘지
- Teleop/Record에서 설정 패널 위치를 우측 drawer로 고정할지, 상단 collapse로 할지
- “ML(Train/Eval)”을 별도 앱으로 분리할지, 동일 앱에서 계속 가져갈지
