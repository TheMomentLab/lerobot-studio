# LeStudio — 구현 로드맵 (Implementation Roadmap)

최종 갱신: 2026-02-23

## 현재 상태 (Current State)

사이드바 네비게이션 및 글로벌 콘솔 서랍(drawer)이 있는 워크벤치 스타일 웹 GUI:
**설정(상태/매핑/모터 설정/캘리브레이션) → 작동(원격 조작/녹화) → 데이터(데이터셋) → ML(학습/평가)**

백엔드: FastAPI + subprocess 생성 + WebSocket stdout 스트리밍
프론트엔드: Vanilla HTML/JS/CSS (18개 모듈 분리 완료), 프레임워크 없음

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
| 평가 (Eval) | 정책 평가 실행, 에피소드별 성과 추적 |
| 설정 프로필 | 저장/불러오기/가져오기/내보내기/삭제 |
| 에러 번역 레이어 | 주요 CLI 에러 패턴 → 사용자 친화적 가이드 메시지 |
| 시스템 리소스 대시보드 | CPU/RAM/Disk/GPU 실시간 모니터링 |
| 세션 히스토리 | 실험 로그 타임라인 (녹화/학습/평가 이벤트 추적) |
| 다크 모드 | CSS 변수 기반 라이트/다크 테마 전환 |
| Guided/Advanced 모드 | Guided 기본(Data/ML 잠금) + Advanced 토글 |
| 상태 배지 | RUNNING/ERROR/NEEDS_ROOT/MISSING_DEP/NEEDS_DEVICE |
| 글로벌 단축키 | Space/Arrow/Esc 전역 바인딩 |
| 데스크톱 알림 | 프로세스 완료/비정상 종료 Browser Notification |
| 반응형 레이아웃 | 데스크톱 사이드바, 태블릿 아이콘 레일, 모바일 서랍 |

---

## 구현 스냅샷

| 단계 | 상태 | 메모 |
|---|---|---|
| 1단계 (Train/Eval 고도화) | **완료** | Loss 차트, 체크포인트, 프리셋 등 모든 과제 구현 완료 |
| 2단계 (데이터셋 심화) | **완료** | 리플레이어, 큐레이션, Hub 검색/다운로드 구현 완료 |
| 2.5단계 (UI/UX 안정화 스프린트) | **완료** | 모바일 헤더/상태 피드백/접근성 + Dataset 액션 밀도 + Teleop/Record 고급 설정 분리 반영 |
| 3단계 (OSS 준비) | **다음** | CONTRIBUTING.md, CI, Docker, 커뮤니티 공지 |
| 4단계 (다중 로봇 & 플러그인) | 백로그 | 커뮤니티 수요 확인 후 |
| 5단계 (원격 조작) | 백로그 | WebRTC/인증 미착수 |

---

## 3단계 — OSS 준비 (다음 단계)

**목표**: LeRobot 커뮤니티에서 기여할 수 있는 프로젝트로 공개한다.

- [ ] `CONTRIBUTING.md` — 설정 가이드, PR 흐름, 코드 스타일
- [ ] GitHub Actions CI — lint + 기본 임포트/시작 테스트
- [ ] 이슈 템플릿 — 버그 리포트, 기능 요청
- [ ] Docker 이미지 — `docker run` 원커맨드 시작
- [ ] 커뮤니티 공지 (LeRobot Discord / HuggingFace 포럼)

---

## 2.5단계 — UI/UX 안정화 스프린트 (진행 중)

**목표**: 실사용 중 마찰이 큰 UI/UX 이슈를 우선순위 기반으로 단기 개선한다.

- [x] 모바일 헤더 오버플로우 개선 (핵심 액션 접근성 확보)
- [x] 연결 상태를 `Connected / Degraded / Disconnected`로 분리 표시
- [x] 주요 폼 입력 label-for/aria 접근성 보강
- [x] 반복 액션(예: Dataset 카드 버튼군) 밀도 최적화
- [x] Teleop/Record 필수 설정과 고급 설정 분리

**입력 문서**: `docs/uiux-audit.md`

---

## 4단계 — 생태계 통합 (Ecosystem Integration)
**목표**: LeRobot 생태계 전체 (16+ Robot, 16+ Teleoperator, 4 Camera 타입, 커스텀 플랫폼)를 하드코딩 없이 지원한다.

**상세 설계 문서**: [`docs/ecosystem-integration-plan.md`](ecosystem-integration-plan.md) (v2 — LeRobot 공식 문서 분석 반영)
**핵심 변경**:
 DeviceRegistry: LeRobot의 3-Registry (Robot/Teleoperator/Camera) 통합 동적 탐색 + 플러그인 자동 발견
 ConnectionAdapter: Serial/CAN bus/ZMQ/Cloud SDK/Ethernet 통신 프로토콜 추상화
 GenericCommandBuilder: `--robot.type` + `--teleop.type` 분리, 새 CLI 엔트리포인트(`lerobot-teleoperate` 등) 사용
 Capability 기반 UI: 로봇 능력(팔/바퀴/카메라/네트워크)에 따라 패널 동적 렌더링

**v2 주요 발견 (LeRobot 문서 분석)**:
 🔴 Robot ↔ Teleoperator 완전 분리 (SO-101 follower=Robot, SO-101 leader=Teleoperator)
 🔴 플러그인 시스템 공식 존재 (`lerobot_robot_*`, `lerobot_camera_*`, `lerobot_teleoperator_*`)
 🔴 draccus.ChoiceRegistry — `_subclass_registry` dict로 런타임 동적 쿼리 가능
 🟡 Processor Pipeline 시스템 (Phase 2+ 대응)
 🟡 CLI 엔트리포인트 변경 (`lerobot-teleoperate` 등)
**구현 Phase**:
 Phase 0: 추상화 레이어 삽입 (DeviceRegistry 3-Registry + 플러그인 발견)
 Phase 1: Backend 일반화 (GenericCommandBuilder, ConnectionAdapter 4종, 새 CLI)
 Phase 2: Frontend 적응형 UI (네트워크 설정, 모바일 베이스, 양팔, 카메라 타입별 폼)
 Phase 3: 커스텀 로봇 가이드 & 플러그인 관리 UI

**아키텍처 참고**: LeRobot 직접 결합은 현재 bridge 3파일 + 신규 `device_registry.py` (4번째 접점)에 격리. `connection.py`, `command_builders.py`는 LeRobot import 없음.
---

## 5단계 — 원격 조작 (Remote Operation)

**목표**: 네트워크를 통해 다른 머신에서 로봇을 조작한다.

- WebRTC 카메라 스트리밍 (MJPEG 대체)
- WebSocket 원격 조작 (브라우저 → 관절 명령)
- 인증 레이어 (토큰 기반)

---

## 의존성 맵

```
1단계 (Train/Eval 고도화)  ─── 완료
2단계 (데이터셋 심화)      ─── 완료
3단계 (OSS 준비)           ─── 다음 (즉시 착수 가능)
4단계 (플러그인)           ─── 3단계 커뮤니티 검증 후
5단계 (원격 조작)          ─── 4단계 안정성 확보 후
```

---

## 알려진 제약

- LeRobot 학습은 Hydra 설정 — 핵심 파라미터만 노출
- 장기 프로세스는 서버 재시작 시 종료됨
- 카메라 SHM 공유는 LeRobot OpenCVCamera 내부를 런타임 패치하는 방식 — upstream 변경 시 호환성 확인 필요
