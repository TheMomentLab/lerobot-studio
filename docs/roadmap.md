# LeStudio — 구현 로드맵 (Implementation Roadmap)

최종 갱신: 2026-03-14

## 현재 상태 (Current State)

사이드바 네비게이션 및 글로벌 콘솔 서랍(drawer)이 있는 워크벤치 스타일 웹 GUI:
**설정(상태/매핑/모터 설정/캘리브레이션) → 작동(원격 조작/녹화) → 데이터(데이터셋) → ML(학습/평가)**

백엔드: FastAPI + subprocess 생성 + WebSocket stdout 스트리밍
프론트엔드: React + TypeScript + Vite + 커스텀 전역 스토어 (`useSyncExternalStore` 기반)
lerobot 포크: git submodule (`TheMomentLab/lerobot`) — torch 버전 캡 제거, preprocess_observation 수정 포함

### 완료된 기능 (Completed Features)

| 기능 | 설명 |
|---|---|
| 워크벤치 레이아웃 | 사이드바(Setup/Operate/Data/ML) + 메인 워크스페이스 + 하단 콘솔 서랍 |
| 카메라 스트리밍 | MJPEG 스트리밍, SHM 공유(프로세스 중 카메라 피드), 로딩/에러/LIVE 피드백 |
| USB 대역폭 모니터링 | 피드별 실시간 fps/MB·s, 버스 사용률 바 |
| 장치 매핑 (udev) | 카메라 KERNELS 기반 + 팔 serial 기반 심볼릭 링크 생성/적용/검증 |
| Arm Identify Wizard | 분리/재연결 diff 기반 팔 식별, Preview/Apply/Verify 흐름 |
| 모터 설정 | `lerobot_setup_motors` CLI 래핑 |
| 캘리브레이션 | 캘리브레이션 실행/파일 관리/삭제 |
| Preflight 사전 점검 | Teleop/Record/Train 시작 전 포트/캘리브레이션/카메라/CUDA 자동 검증 |
| 원격 조작 (Teleop) | 멀티카메라 원격 조작, camera_patch를 통한 SHM 프레임 공유 |
| 녹화 (Record) | 에피소드 녹화, stdin 브리지(키보드 명령), resume 지원 |
| 데이터셋 관리 | 로컬 데이터셋 조회/상세/삭제, 품질 검사, Hub push(진행률 추적) |
| 에피소드 비디오 리플레이어 | 멀티카메라 동기 재생, 타임라인 스크러빙 |
| 에피소드 큐레이션 | 개별 에피소드 삭제/태그/필터 |
| HF Hub 데이터셋 검색 | Hub API 기반 데이터셋 검색/다운로드 |
| 학습 (Train) | 학습 실행, CUDA preflight, PyTorch 설치, 메트릭 파싱(step/loss/lr) |
| 실시간 Loss 커브 차트 | Canvas 기반 Loss/LR 시각화 + ETA/진행률 |
| 체크포인트 브라우저 | 체크포인트 스캔/목록/Eval 자동 연결 |
| 학습 하이퍼파라미터 프리셋 | Quick Test / Standard / Full 프리셋 + Advanced 파라미터 노출 |
| 평가 (Eval) | 정책 평가 실행, env-type 추론, gym_manipulator 카메라 설정, 에피소드별 성과 추적 |
| 설정 프로필 | 저장/불러오기/가져오기/내보내기/삭제 |
| 에러 번역 레이어 | 주요 CLI 에러 패턴 → 사용자 친화적 가이드 메시지 |
| 매핑 강제 정책 | Teleop/Record/Eval에서 arm/camera 매핑을 강제, 매핑 안 되면 BlockerCard로 Setup 유도 |
| ArmPairSelector | follower/leader 독립 선택 드롭다운, type/port/calibration ID 자동 유도 |
| 카메라 선택 체크박스 | Teleop/Record에서 사용할 카메라를 체크박스로 선택/해제 |
| Bimanual 캘리브레이션 정규화 | shared base id 기반 left/right pair 관리, 일관된 작명법 |
| 캘리브레이션 파일 필터 | Single/Bi 스코프 필터, 상위 모드 전환 시 자동 연동 |
| 캘리브레이션 이상 감지 | calibration_validator.py로 파일 내 anomaly 자동 검출 |
| 파일 기반 로깅 | ~/.config/lestudio/logs/ (5MB×3, 7일 만료), 프로세스별 로그 저장 |
| Identify Arms 모달 | 분리된 identify arm 플로우, 취소 지원 |
| 시스템 리소스 대시보드 | CPU/RAM/Disk/GPU 실시간 모니터링 |
| 세션 히스토리 | 실험 로그 타임라인 (녹화/학습/평가 이벤트 추적) |
| 다크 모드 | CSS 변수 기반 라이트/다크 테마 전환 |

| 상태 배지 | RUNNING/ERROR/NEEDS_ROOT/MISSING_DEP/NEEDS_DEVICE |
| 글로벌 단축키 | Space/Arrow/Esc 전역 바인딩 |
| 데스크톱 알림 | 프로세스 완료/비정상 종료 Browser Notification |
| 반응형 레이아웃 | 데스크톱 사이드바, 태블릿 아이콘 레일, 모바일 서랍 |
| lerobot 서브모듈 관리 | git submodule로 커스텀 포크 관리, Makefile install (--no-deps로 PyTorch nightly 보호) |
| ConsoleDrawer 로그 복사 | All / last 20/50/100 줄 클립보드 복사 버튼 |

---

## 구현 스냅샷

| 단계 | 상태 | 메모 |
|---|---|---|
| 1단계 (Train/Eval 고도화) | **완료** | Loss 차트, 체크포인트, 프리셋, Eval env-type 추론/카메라 설정 오버홀 |
| 2단계 (데이터셋 심화) | **완료** | 리플레이어, 큐레이션, Hub 검색/다운로드 구현 완료 |
| 2.5단계 (UI/UX 안정화 + React 전환) | **완료** | 모바일 헤더/상태 피드백/접근성 + Vanilla JS → React + TS 전환 완료 |
| 3.0단계 (안정화 게이트) | **완료** | 보안 경로 차단, 경계 정합성, 테스트/CI 최소선 확보 |
| 3단계 (OSS 준비) | **다음** | 3.0 완료 후 착수 |
| 3.1단계 (리팩토링) | **다음** | 코드 품질 개선 및 구조 정리, [`proposals/architecture-hardening-plan.md`](proposals/architecture-hardening-plan.md) 기준 |
| 3.5단계 (기능 확장) | 백로그 | Teleop/Train/Eval/Data 각 단계별 기능 강화 |
| 4단계 (다중 로봇 & 플러그인) | 백로그 | 커뮤니티 수요 확인 후 |
| 5단계 (원격 조작) | 백로그 | WebRTC/인증 미착수 |
| 6단계 (시뮬레이션 & 배포) | 백로그 | MuJoCo 연동, 모델 내보내기 |

---

## 2.5단계 — UI/UX 안정화 + React 전환 (완료)

**목표**: 실사용 중 마찰이 큰 UI/UX 이슈를 우선순위 기반으로 단기 개선한다.

- [x] 모바일 헤더 오버플로우 개선 (핵심 액션 접근성 확보)
- [x] 연결 상태를 `Connected / Degraded / Disconnected`로 분리 표시
- [x] 주요 폼 입력 label-for/aria 접근성 보강
- [x] 반복 액션(예: Dataset 카드 버튼군) 밀도 최적화
- [x] Teleop/Record 필수 설정과 고급 설정 분리
- [x] 프론트엔드 React + TypeScript 기반 구조로 전환 (Vanilla JS에서 마이그레이션 완료)

**입력 문서**: 초기 UI/UX 검토 메모를 바탕으로 반영 완료. 세부 초안은 현재 기준 문서에서 분리 보관한다.

---

## 3.0단계 — 안정화 게이트 (완료)

**목표**: OSS 공개 전에 보안/아키텍처/테스트 기준을 먼저 통과한다.

- [x] `/api/process/{name}/command` 경로에 process allowlist 검증 추가
- [x] 기본 노출 설정 최소화 (`host`, CORS 정책 재점검)
- [x] AGENTS 경계 정합성 복구 (`cli.py`의 `import lerobot` 제거)
- [x] 최소 회귀 테스트 추가 (`pytest` 0건 상태 해소)
- [x] CI 기본 파이프라인 구축 (`frontend lint/build`, backend 테스트)

**완료 기준(DoD)**:
- 명령 실행 경로가 allowlist 없이 동작하지 않는다.
- 기본 실행 시 불필요한 외부 노출이 줄어든다.
- 최소 핵심 회귀 테스트가 CI에서 자동 통과한다.
- `lerobot.*` 결합 경계(5파일 원칙)를 만족한다.

**실행 기준 문서**: [`archive/quality-improvement-2026-02-28.md`](archive/quality-improvement-2026-02-28.md)

---

## 3단계 — OSS 준비 (3.0 완료 후)

**목표**: LeRobot 커뮤니티에서 기여할 수 있는 프로젝트로 공개한다.

- [x] `CONTRIBUTING.md` — 설정 가이드, PR 흐름, 코드 스타일
- [x] GitHub Actions CI — lint + 기본 임포트/시작 테스트
- [x] 이슈 템플릿 — 버그 리포트, 기능 요청
- [x] Docker 이미지 — `docker run` 원커맨드 시작
- [ ] 커뮤니티 공지 (LeRobot Discord / HuggingFace 포럼)
- [x] Public Docs Site — `docs_public/` + MkDocs 기반 공개 문서 사이트 운영 시작


**전략 문서**: [`research/competitive-analysis.md`](research/competitive-analysis.md) — 경쟁 환경 분석, 포지셔닝, 런칭 전략
---

## 3.1단계 — 리팩토링

**목표**: 기능 추가 속도를 유지하면서도, 전역 상태/느슨한 계약/이벤트 전달 구조 때문에 생기는 회귀 위험을 줄인다.

- [x] path policy helper 중앙화 (dataset/calibration/token/log/temp) — `path_policy.py` 구현 완료
- [ ] capability 기반 정책/보호 구조로 정리 — 매핑 강제 gate가 시작점, 전체 정리 미착수
- [x] process output fan-out 가능한 event model로 교체 — `EventBuffer` (deque ring buffer + subscriber fan-out) 구현 완료, WebSocket이 subscribe/poll 모델로 전환됨
- [x] bootstrap / job / preflight 응답 계약 타입화 — `apiGet<unknown>` → typed calls, normalize/fallback 경량화, 공유 타입 `store/types.ts`로 통합
- [ ] route orchestration을 service 계층으로 분리 — D1(process) 완료, D3(training) 완료, D2(dataset) 미착수

**실행 기준 문서**: [`proposals/architecture-hardening-plan.md`](proposals/architecture-hardening-plan.md)
**작업 분해 문서**: [`proposals/architecture-hardening-work-items.md`](proposals/architecture-hardening-work-items.md)

---

## 3.5단계 — 기능 확장 (Feature Enhancement)

**목표**: 현재 파이프라인의 각 단계(Teleop/Record/Train/Eval/Data)를 깊게 강화한다.

### Teleop 강화
- [ ] Phone Teleop UI — LeRobot `phone` teleoperator 선택 시 QR 코드 표시 + HEBI 앱 연결 가이드
- [ ] 안전 제한 설정 UI — 관절 범위 제한, 최대 속도, 비상 정지 (LeRobot `ProcessorPipeline` 활용)
- [ ] 3D 관절 시각화 — 간단한 3D 스켈레톤 + 실시간 관절 각도 표시 (디버깅 도구)

### Data 강화
- [x] 데이터셋 녹화 환경 메타데이터 표시 — 상세 페이지에서 robot_type, 카메라(이름/해상도/fps/코덱), 관절 이름 표시. `info.json` features에서 추출.
- [ ] 데이터셋 병합 — 여러 세션의 데이터셋을 하나로 합치기
- [ ] 데이터 증강 UI — 카메라 색상 변환, 크롭, 노이즈 등 기본 augmentation 설정 (LeRobot 학습 config 내 augmentation 옵션 UI 노출)

### Train 강화
- [ ] 배치 학습 / 하이퍼파라미터 스윕 — 파라미터 그리드 설정 → 순차 실행 → 결과 비교표
- [ ] 정책 비교 / A·B 테스트 — 체크포인트 2개 선택 → 동일 에피소드에서 성과 비교 차트

### Eval 강화
- [ ] 시뮬레이션 연동 (6단계 선행) — MuJoCo/ALOHA sim에서 실물 없이 정책 평가

### Inspection UX 강화
- [ ] Run Inspector — `record` / `eval` / `train` run 단위 통합 상세 화면 (설정, 장치, 로그, 결과, artifact 연결)
- [ ] 이벤트 / 실패 마커 — dropped frame, jerk spike, abort, eval failure 등 문제 구간을 timeline/replay에서 자동 표시
- [ ] Run 비교 보기 — config diff, metric diff, 실패 구간 diff 중심의 비교 뷰
- [ ] replay/chart 통합 inspector화 — 기존 Episode Replayer + 차트를 run 중심 inspection 화면으로 재구성

### 인프라
- [ ] 캘리브레이션 파일에 시리얼 메타데이터 기록 — arm 교체 시 "이 캘리브레이션은 다른 arm에서 생성됨" 경고 표시 가능
- [ ] SystemStatus 매핑 현황 요약 — 매핑된 arm/camera 수 표시, USB 해제 시 상태 반영
- [ ] 워크스페이스 백업/복원 — 설정 프로필 + 캘리브레이션 + 데이터셋 경로를 한 번에 export/import
- [ ] 원격 로봇 네트워크 진단 — LeKiwi/XLeRobot 등 ZMQ 기반 원격 로봇의 ping/latency/packet loss 표시
- [ ] 로봇 타입 기반 디바이스 역할 동적 구성 — 현재 카메라/팔 역할 리스트가 팔 로봇(SO-100) 전제로 하드코딩됨. device_registry에서 로봇 타입별 기대 디바이스를 조회하여 드롭다운을 동적으로 생성 (LeKiwi 등 모바일 로봇 지원 필수)

- [ ] 언어 선택 / i18n 점진 도입 — 전면 번역은 나중에, locale 상태/공통 영역부터 정리 ([`proposals/i18n-plan.md`](proposals/i18n-plan.md))

- [ ] PWA (Progressive Web App) — `manifest.webmanifest` + 앱 아이콘 추가, `display: standalone`으로 브라우저 크롬 제거하여 네이티브 앱 느낌으로 실행

**우선순위**: Phone Teleop UI > 정책 비교 > 데이터셋 병합 > 배치 학습 > 나머지
**참고**: 안전 제한 설정은 [`ecosystem-integration-plan.md`](ecosystem-integration-plan.md) §2.3.6 ProcessorPipeline과 연계.
**제안 문서**: [`proposals/native-inspection-strategy.md`](proposals/native-inspection-strategy.md) — LeStudio-native inspection 전략과 Rerun 경계 정의

---

## 4단계 — 생태계 통합 (Ecosystem Integration)
**목표**: LeRobot 생태계 전체 (16+ Robot, 16+ Teleoperator, 4 Camera 타입, 커스텀 플랫폼)를 하드코딩 없이 지원한다.

**상세 설계 문서**:
- [`ecosystem-current-gaps.md`](ecosystem-current-gaps.md) - 현재 확장 제약 인벤토리
- [`ecosystem-integration-plan.md`](ecosystem-integration-plan.md) - 목표 아키텍처와 단계별 설계
**핵심 변경**:
- DeviceRegistry: LeRobot의 3-Registry (Robot/Teleoperator/Camera) 통합 동적 탐색 + 플러그인 자동 발견
- ConnectionAdapter: Serial/CAN bus/ZMQ/Cloud SDK/Ethernet 통신 프로토콜 추상화
- GenericCommandBuilder: `--robot.type` + `--teleop.type` 분리, 새 CLI 엔트리포인트(`lerobot-teleoperate` 등) 사용
- Capability 기반 UI: 로봇 능력(팔/바퀴/카메라/네트워크)에 따라 패널 동적 렌더링

**v2 주요 발견 (LeRobot 문서 분석)**:
 🔴 Robot ↔ Teleoperator 완전 분리 (SO-101 follower=Robot, SO-101 leader=Teleoperator)
 🔴 플러그인 시스템 공식 존재 (`lerobot_robot_*`, `lerobot_camera_*`, `lerobot_teleoperator_*`)
 🔴 draccus.ChoiceRegistry — `_subclass_registry` dict로 런타임 동적 쿼리 가능
 🟡 Processor Pipeline 시스템 (Phase 2+ 대응)
 🟡 CLI 엔트리포인트 변경 (`lerobot-teleoperate` 등)
**구현 Phase**:
  Phase 0: 추상화 레이어 삽입 (DeviceRegistry 3-Registry + 플러그인 발견) — **백엔드 구현 완료** (`device_registry.py`)
  Phase 1: Backend 일반화 (GenericCommandBuilder, ConnectionAdapter 4종, 새 CLI) — 미착수
  Phase 2: Frontend 적응형 UI (네트워크 설정, 모바일 베이스, 양팔, 카메라 타입별 폼)
  Phase 3: 커스텀 로봇 가이드 & 플러그인 관리 UI

**아키텍처 참고**: LeRobot 직접 결합은 `teleop_bridge.py`, `record_bridge.py`, `camera_patch.py`, `device_registry.py`, `motor_monitor_bridge.py`의 5파일 경계로 격리한다.
---

## 5단계 — 원격 조작 (Remote Operation)

**목표**: 네트워크를 통해 다른 머신에서 로봇을 조작한다.

- WebRTC 카메라 스트리밍 (MJPEG 대체)
- WebSocket 원격 조작 (브라우저 → 관절 명령)
- 인증 레이어 (토큰 기반)

---

## 6단계 — 시뮬레이션 & 배포 (Simulation & Deployment)

**목표**: 실물 로봇 없이 정책을 테스트하고, 학습된 모델을 엣지 디바이스에 배포한다.

- [ ] MuJoCo/ALOHA sim 연동 — 시뮬레이션 환경 선택 + eval 실행 (실물 없이 테스트)
- [ ] 모델 내보내기 — 학습된 정책을 ONNX/TensorRT로 변환 (엣지 배포용)
- [ ] 플러그인 관리 UI — `pip install lerobot_robot_*`를 GUI에서 실행, 설치된 플러그인 목록/활성화/비활성화

---

## 의존성 맵

```
1단계 (Train/Eval 고도화)  ─── 완료
2단계 (데이터셋 심화)      ─── 완료
2.5단계 (UI/UX 안정화)     ─── 완료
3.0단계 (안정화 게이트)    ─── 완료
3단계 (OSS 준비)           ─── 3.0 완료 후 착수
3.5단계 (기능 확장)       ─── 3단계 완료 후 우선순위 재조정
4단계 (플러그인)           ─── 3단계 커뮤니티 검증 후
5단계 (원격 조작)          ─── 4단계 안정성 확보 후
6단계 (시뮬레이션 & 배포) ─── 4단계 이후 (다중 로봇 전제)
```

---

## 알려진 제약

- LeRobot 학습은 Hydra 설정 — 핵심 파라미터만 노출
- 장기 프로세스는 서버 재시작 시 종료됨
- 카메라 SHM 공유는 LeRobot OpenCVCamera 내부를 런타임 패치하는 방식 — upstream 변경 시 호환성 확인 필요
