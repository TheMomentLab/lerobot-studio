# LeStudio - 기능 명세

최종 업데이트: 2026-03-14
상태: 현재 구현 범위

---

## 1. 목적

이 문서는 LeStudio가 현재 제품으로서 무엇을 제공하는지에 대한 내부 기준 문서입니다.

이 문서는 의도적으로 다음 문서들과 구분됩니다.

- `roadmap.md` - 다음에 무엇을 만들 예정인지
- `current-architecture.md` - 시스템이 어떻게 구성되어 있는지
- `api-and-streaming.md` - 프론트엔드와 백엔드 사이에서 데이터가 어떻게 이동하는지

이 문서는 다른 질문에 답합니다.

> LeStudio는 현재 어떤 기능을 제공하며, 그 기능은 어디에 있고, 실질적인 범위는 어디까지인가?

---

## 2. 이 문서를 사용하는 방법

다음이 필요할 때 이 문서를 사용하세요.

- 새 작업을 추가하기 전에 해당 기능이 이미 존재하는지 확인할 때
- README, 문서, UI 전반에서 제품 용어를 맞출 때
- 특정 기능 영역의 주요 UI와 백엔드 접점을 찾을 때
- 이미 구현된 기능과 로드맵 항목을 구분할 때

이 문서에서 사용하는 상태 의미는 다음과 같습니다.

- `implemented` - 현재 제품에서 사용 가능함
- `implemented with constraints` - 사용 가능하지만 범위가 의도적으로 제한되어 있거나 특정 하드웨어에 종속됨

---

## 3. 제품 범위 요약

LeStudio는 LeRobot 워크플로를 위한 로컬 우선 GUI 워크벤치입니다.

현재의 엔드투엔드 제품 범위는 다음과 같습니다.

1. 하드웨어 설정 및 검증
2. 텔레오퍼레이션 및 녹화
3. 데이터셋 검사 및 큐레이션
4. 학습 및 평가
5. 런타임 모니터링, 프로세스 제어, 작업자 피드백

---

## 4. 기능 카탈로그

### 4.1 워크벤치 및 런타임 기반

| Feature | User-facing outcome | Main UI surface | Main backend surface | Status |
|---|---|---|---|---|
| Workbench layout | 설정부터 ML까지 이어지는 사이드바 기반 워크플로 | `frontend/src/app/components/layout/` | `server.py`에서 서빙되는 정적 SPA | implemented |
| Global console drawer | 공용 프로세스 출력 보기와 로그 복사 동작 | `RuntimeConsoleDrawer` 및 앱 셸 | `/ws`, `ProcessManager` | implemented |
| Responsive navigation | 데스크톱 사이드바, 태블릿 레일, 모바일 드로어 | 앱 셸 및 반응형 레이아웃 컴포넌트 | n/a | implemented |
| Status badges | 실행 중 / 성능 저하 / 의존성 누락 상태 피드백 | 헤더, 사이드바, 페이지 단위 상태 UI | bootstrap + 프로세스 상태 API | implemented |
| Desktop notifications | 프로세스 완료 및 실패에 대한 브라우저 알림 | `services/notifications.ts` | `/ws` 및 상태 폴링을 통한 프로세스 완료 신호 | implemented |
| Theme toggle | 라이트 / 다크 모드 전환 | 테마 컨텍스트 및 공용 레이아웃 | n/a | implemented |
| Session history | 실행 관련 이벤트 타임라인 | 히스토리 관련 UI 및 설정 흐름 | `routes/config.py` 히스토리 엔드포인트 | implemented |
| Config profiles | 프로필 저장, 불러오기, 가져오기, 내보내기, 삭제 | 전역 설정을 사용하는 여러 페이지 | `routes/config.py` | implemented |

### 4.2 하드웨어 설정 및 검증

| Feature | User-facing outcome | Main UI surface | Main backend surface | Status |
|---|---|---|---|---|
| System status dashboard | 디바이스, 프로세스, CPU, RAM, 디스크, GPU 상태 가시화 | `frontend/src/app/pages/SystemStatus.tsx` | `routes/streaming.py`, 디바이스 API | implemented |
| Camera preview | 구성된 카메라의 라이브 프리뷰 | `frontend/src/app/pages/CameraSetup.tsx` | `/stream/*`, 스냅샷 API, `_streaming.py` | implemented |
| USB bandwidth visibility | 카메라별 FPS / MB/s / 버스 사용률 피드백 | 카메라 설정 UI | 카메라 통계 엔드포인트 | implemented |
| Device mapping (udev) | 안정적인 카메라 및 암 symlink 생성과 검증. Teleop/Record/Eval에서 매핑 강제 정책 적용. | `frontend/src/app/pages/MotorSetup/`의 매핑 및 udev 탭 | `routes/udev.py` 및 헬퍼 | implemented |
| Mapping enforcement | 매핑 안 된 arm/camera로는 Teleop/Record/Eval 시작 불가. BlockerCard로 Setup 유도. | Teleop/Record/Eval 페이지 | n/a (프론트엔드 gate) | implemented |
| Arm Identify Modal | 분리된 모달 대화상자로 leader/follower arm 식별. 취소 플로우 지원. | `IdentifyArmModal.tsx` | 디바이스 및 udev 헬퍼 | implemented |
| ArmPairSelector | follower/leader 독립 선택 드롭다운. type/port/calibration ID 자동 유도. Teleop/Record/Eval 공유. | `ArmPairSelector.tsx`, `armSets.ts` | config persist | implemented |
| Camera selection checkboxes | Teleop/Record에서 매핑된 카메라 중 사용할 것을 체크박스로 선택/해제 | Teleop/Record 카메라 탭 | payload에 선택된 카메라만 포함 | implemented |
| Motor setup | 모터 초기화 및 설정 명령 실행 | `frontend/src/app/pages/MotorSetup/` | `routes/process.py`, `command_builders.py` | implemented with constraints |
| Calibration management | 캘리브레이션 실행, Single/Bi 파일 필터, shared profile 정규화, 이상 감지, 파일 삭제 | 모터 설정 캘리브레이션 흐름 | `routes/process.py`, `calibration_validator.py` | implemented |
| Calibration anomaly detection | 캘리브레이션 파일 내 homing offset/range 이상치 자동 검출 | 캘리브레이션 상태 UI | `calibration_validator.py` | implemented |
| File-based logging | 프로세스별 로그 파일 저장 (~/.config/lestudio/logs/, 5MB×3, 7일 만료) | n/a (백엔드 인프라) | `_logging.py`, teleop/record/process 로거 | implemented |
| Preflight checks | 실행 전 카메라, 캘리브레이션, 디바이스 준비 상태, CUDA 검증 | Teleop / Record / Train / Eval 페이지 | `routes/process.py`, `routes/training.py` | implemented |

### 4.3 운영: 텔레옵 및 녹화

| Feature | User-facing outcome | Main UI surface | Main backend surface | Status |
|---|---|---|---|---|
| Teleop launch | ArmPairSelector로 arm 선택, 카메라 체크박스로 카메라 선택, Motor tuning 접기. 매핑 강제. | `frontend/src/app/pages/Teleop.tsx` | `routes/process.py`, `command_builders.py`, `teleop_bridge.py` | implemented |
| Teleop live camera retention | teleop가 디바이스를 점유한 동안에도 카메라 피드 유지 | Teleop 페이지 카메라 영역 | `camera_patch.py`, SHM 스냅샷 경로, 스트리밍 라우트 | implemented |
| Teleop conflict management | 호환되지 않는 프로세스의 동시 실행 방지 | Teleop 페이지 + 전역 프로세스 상태 | `ProcessManager` conflict groups | implemented |
| Record launch | ArmPairSelector로 arm 선택, 카메라 체크박스로 카메라 선택. 매핑 강제. | `frontend/src/app/pages/Recording/` | `routes/process.py`, `record_bridge.py`, `command_builders.py` | implemented |
| Episode control bridge | Next / abort / stdin 기반 런타임 제어 | Recording 런타임 UI | `/api/process/{name}/input`, stdin 브리지 경로 | implemented |
| Resume recording support | 기존 흐름에 이어서 녹화 계속 진행 | Recording 계획/런타임 흐름 | record 실행 옵션 | implemented |

### 4.4 데이터셋 및 Hub 워크플로

| Feature | User-facing outcome | Main UI surface | Main backend surface | Status |
|---|---|---|---|---|
| Local dataset listing | 로컬에 있는 데이터셋 탐색 | `frontend/src/app/pages/DatasetManagement/` | `routes/dataset/listing.py` | implemented |
| Dataset detail and delete | 메타데이터 확인, 녹화 환경 표시 (robot type, 카메라, 관절), 삭제 | 데이터셋 관리 UI | `routes/dataset/listing.py` | implemented |
| Episode video replay | 멀티카메라 동기 재생 및 스크러빙 | 데이터셋 비디오 플레이어 컴포넌트 | 데이터셋 비디오 서빙 엔드포인트 | implemented |
| Episode curation | 에피소드 삭제, 태깅, 필터링 | 큐레이션 관련 데이터셋 UI | `routes/dataset/curation.py` | implemented |
| Dataset quality checks | 데이터셋 무결성과 품질 관련 조건 검증 | 데이터셋 관리 UI | `routes/dataset/listing.py` 품질 검사 | implemented |
| HF Hub search and download | 원격 데이터셋 검색 및 다운로드 | Hub 검색 및 다운로드 UI | `routes/dataset/hub.py` | implemented |
| HF Hub push | 작업 추적과 함께 로컬 데이터셋을 Hub에 푸시 | 푸시 UI 및 작업 상태 UI | `routes/dataset/hub.py` | implemented |
| HF identity and token handling | whoami 및 토큰 상태 확인 | 데이터셋 / 인증 관련 UI | Hub 관련 라우트 및 인증 헬퍼 | implemented |

### 4.5 학습 및 평가

| Feature | User-facing outcome | Main UI surface | Main backend surface | Status |
|---|---|---|---|---|
| Training launch | GUI에서 LeRobot 학습 시작 | `frontend/src/app/pages/Training/` | `routes/training.py`, `command_builders.py` | implemented |
| CUDA preflight | 학습 전 GPU / PyTorch 호환성 문제 감지 | 학습 preflight UI | `routes/training.py`, 헬퍼 로직 | implemented |
| One-click dependency remediation | 앱 흐름 안에서 PyTorch 또는 관련 수정 설치 | 학습 설치 흐름 | 학습 설치 엔드포인트 | implemented with constraints |
| Live training metrics | 손실 / LR / ETA / step 진행률 실시간 표시 | 학습 진행 UI 및 차트 | `ProcessManager` 메트릭 파싱 + `/ws` | implemented |
| Checkpoint browser | 체크포인트를 스캔하고 eval로 넘길 준비 수행 | 학습/평가 공용 UI | `routes/eval.py` 체크포인트 API | implemented |
| Eval launch | ArmPairSelector로 arm 선택 (real robot만). 매핑 강제. | `frontend/src/app/pages/Evaluation/` | `routes/eval.py`, `command_builders.py` | implemented |
| Eval env-type assistance | env type을 추론하거나 선택하고 관련 설정 적용 | 평가 설정 UI | `routes/eval.py` 및 헬퍼 로직 | implemented |
| Eval result tracking | 에피소드별 결과 및 라이브 프로세스 출력 검토 | 평가 진행/결과 UI | `/ws`를 통한 eval 프로세스 출력 | implemented |

### 4.6 스트리밍, 모니터링, 직접 제어

| Feature | User-facing outcome | Main UI surface | Main backend surface | Status |
|---|---|---|---|---|
| Shared WebSocket runtime bus | 라이브 콘솔 출력, 메트릭, 상태 업데이트 | `apiClient.ts`를 사용하는 여러 페이지 | `routes/streaming.py` `/ws` | implemented |
| Camera snapshot path | 필요 시 정지 이미지 프레임 조회 | 카메라 및 teleop 관련 UI | `routes/streaming.py`의 스냅샷 API | implemented |
| GPU and system resource monitoring | UI에서 런타임 머신 상태 가시화 | 상태 페이지 및 관련 UI | `routes/streaming.py` 리소스 엔드포인트 | implemented |
| Process status and stop controls | 시작/중지 가시성과 프로세스 복구 상태 | 페이지 단위 프로세스 위젯 및 상태 UI | `routes/process.py`, `ProcessManager` | implemented |
| Orphan process recovery | 재시작 후 이미 실행 중인 관리 프로세스 감지 | 프로세스 인지형 UI 상태 | `ProcessManager`의 영속 PID 메타데이터 | implemented |
| Error translation layer | 일반적인 원시 실패를 작업자가 이해할 수 있는 안내로 변환 | 콘솔 및 페이지 단위 오류 경험 | `ProcessManager` 출력 파싱 | implemented |
| Motor monitor APIs | 직접 연결 / 읽기 / 이동 / freewheel / torque-off 흐름 | 모터 모니터 UI | `routes/motor.py`, `motor_monitor_bridge.py` | implemented with constraints |

---

## 5. 현재 중요한 제약 사항

아래 항목들은 기능 목록을 읽을 때 중요한, 제품에 드러나는 제약 사항입니다.

- 매핑 강제 정책으로 Teleop/Record/Eval 사용 전 Motor Setup/Camera Setup에서 arm/camera 매핑이 필수입니다.
- 설정, 텔레옵, 녹화, 캘리브레이션 흐름이 여전히 SO-family 스타일 역할과 시리얼 디바이스 워크플로를 가정합니다.
- 더 넓은 생태계 탐색 기능은 존재하지만, 엔드투엔드 일반화 실행은 아직 진행 중입니다.
- 하드웨어 관련 기능은 udev, `/dev/*`, 로컬 디바이스 접근에 의존하기 때문에 Linux 우선입니다.
- 카메라 동작은 SHM 프리뷰 경로 때문에 idle preview 모드와 active teleop/record 모드 사이에서 차이가 있습니다.
- 캘리브레이션 파일에 시리얼 메타데이터가 없어서, arm 교체 시 자동 감지가 불가능합니다 (udev 시리얼 매핑이 간접적으로 보호).

확장성 격차에 대한 더 깊은 목록은 `ecosystem-current-gaps.md`를 참고하세요.

---

## 6. 관련 문서

- `roadmap.md` - 계획된 기능과 순서
- `current-architecture.md` - 런타임 아키텍처
- `api-and-streaming.md` - 전송 동작
- `ecosystem-current-gaps.md` - 현재 확장성 저해 요소
- `ecosystem-integration-plan.md` - 향후 일반화 아키텍처
