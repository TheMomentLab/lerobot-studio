# LeRobot Studio — Feature Proposals

> Generated: 2025-02-22
> Based on: codebase analysis + LeRobot community/GitHub issue research

---

## Tier 1 — Killer Features (Immediate Differentiation)

### 1. Preflight Check (사전 환경 점검)

**Problem**: 현재 Start 버튼을 누르면 CLI 프로세스가 뜨고, 에러가 터미널 로그에 뿌려지는 구조. 사용자가 로그를 읽고 원인을 파악해야 함.

**Solution**: Teleop/Record 시작 **전에** 전체 환경을 자동 검증하고 결과를 시각적으로 표시.

```
✅ Follower port /dev/follower_arm_1 — 접근 가능
✅ Leader port /dev/leader_arm_1 — 접근 가능
✅ Calibration file (my_so101_follower_1) — 존재함 (2025-02-21)
❌ Camera /dev/top_cam_1 — 장치 없음 → "USB 케이블을 확인하거나, Mapping 탭에서 다시 할당하세요"
⚠️ Camera /dev/follower_cam_1 — 접근 가능하지만 다른 프로세스가 점유 중
```

**Implementation**:
- `server.py`에 `/api/preflight` 엔드포인트 추가
- 포트 접근성 (`os.access`, `os.path.exists`)
- 캘리브레이션 파일 존재 여부 (기존 `/api/calibrate/file` 로직 재활용)
- 카메라 장치 존재 및 점유 상태 (`cv2.VideoCapture` 시도 or `/proc` 체크)
- Start 버튼 클릭 시 preflight 먼저 실행 → 통과 시 자동 진행, 실패 시 결과 표시

**Impact**: LeRobot GitHub에서 가장 많은 이슈(포트/카메라/캘리브 관련 ~250+건)의 90%를 GUI 단에서 선제 차단.

---

### 2. Configuration Profiles (설정 프로필)

**Problem**: 현재 `config.json` 하나에 글로벌 설정이 저장됨. 연구실에서 여러 로봇/세팅을 왔다갔다 할 수 없음.

**Solution**: 프로필 단위로 전체 설정을 저장/로드/공유.

```
[프로필 드롭다운]  ▼ Lab Setup A   |  Lab Setup B  |  Demo  |  + 새 프로필
```

**Scope**: 프로필 하나에 포함되는 항목:
- 로봇 타입 (SO100/SO101, single/bi)
- 포트 경로 (follower, leader)
- 카메라 경로 및 설정 (해상도, FPS, 코덱)
- Record 기본값 (repo ID, episodes, task)

**Implementation**:
- `~/.config/lerobot-studio/profiles/` 디렉토리에 `{name}.json` 저장
- `/api/profiles` CRUD 엔드포인트
- Header 영역에 프로필 드롭다운 추가
- 프로필 JSON 파일 import/export (팀원 간 공유)

---

### 3. Arm Port udev Rules (로봇 팔 포트 udev 관리)

**Problem**: 카메라 udev는 GUI로 관리 가능하지만, 로봇 팔 포트(`ttyACM*`, `ttyUSB*`)의 udev 규칙은 GUI에서 생성 불가. `_arm_rule_lines()`가 기존 규칙 보존만 하고 새 규칙 생성 UI 없음.

**Solution**: Mapping 탭에서 카메라처럼 **시리얼 번호 기반으로 팔 포트에 심볼릭 링크 자동 할당**.

**Implementation**:
- `udevadm info --query=property /dev/ttyACM0`에서 `ID_SERIAL_SHORT` 추출
- Mapping 탭 하단에 "Arm Port Mapping" 섹션 추가
- 드롭다운: `(none)`, `follower_arm_1`, `follower_arm_2`, `leader_arm_1`, `leader_arm_2`
- `SUBSYSTEM=="tty", ATTRS{serial}=="...", SYMLINK+="follower_arm_1", MODE="0666"` 규칙 자동 생성

---

## Tier 2 — Workflow Completeness (Pipeline Loop Close)

### 4. Training Progress Visualization (학습 진행 시각화)

**Problem**: Train 탭에 터미널 로그만 출력됨. 수시간~수일 걸리는 학습의 상태를 파악하기 어려움.

**Solution**: 로그 파싱을 통한 실시간 학습 대시보드.

**Features**:
- 실시간 Loss 커브 그래프 (Canvas or lightweight chart lib)
- 현재 Step / 전체 Step 진행률 바
- 예상 남은 시간 (ETA) 계산
- GPU 사용률 연동 (이미 `/api/gpu/status` API 존재)

**Implementation**:
- `process_manager.py`의 `_reader`에서 `step=..., loss=..., lr=...` 패턴 파싱
- WebSocket으로 파싱된 메트릭을 별도 `type: "metric"` 메시지로 전송
- 프론트엔드에서 canvas 기반 미니 차트 렌더링

---

### 5. Eval / Replay Tab (평가/리플레이 탭)

**Problem**: 현재 파이프라인이 `셋업 → 캘리브 → 텔레옵 → 녹화 → 학습`에서 끊김. 학습된 Policy로 로봇을 돌려보는 Eval 단계가 없음.

**Solution**: 학습 완료 후 바로 Policy 평가를 실행할 수 있는 탭.

**Features**:
- Checkpoint 경로 또는 HF Hub ID 입력
- 로봇/카메라 설정 (Teleop 탭 설정 공유)
- Start Evaluation 버튼 + 카메라 피드
- 실시간 action 시각화 (선택적)

**Implementation**:
- `build_eval_args()` in `command_builders.py`
- `lerobot.scripts.lerobot_eval` 또는 커스텀 eval 스크립트 래핑
- ProcessManager에 `"eval"` 프로세스 추가

---

### 6. Dataset Hub Upload (데이터셋 Hub 업로드)

**Problem**: 녹화 후 HuggingFace Hub에 Push하려면 CLI에서 별도로 `huggingface-cli upload` 실행 필요.

**Solution**: Dataset 탭에서 원클릭 업로드.

```
[각 데이터셋 옆에]
📤 Push to Hub  →  진행률 바  →  "✅ https://huggingface.co/datasets/user/my-dataset"
```

**Implementation**:
- HF Hub Python API (`huggingface_hub.upload_folder`) 활용
- `/api/datasets/{user}/{repo}/push` 엔드포인트
- 업로드 진행률을 WebSocket으로 스트리밍
- HF 토큰 설정 UI (`huggingface-cli login` 상태 확인)

---

## Tier 3 — User Experience (Polish & QoL)

### 7. Error Translation Layer (에러 번역 레이어)

**Problem**: CLI 에러 메시지가 기술적이라 초보자가 원인을 파악하기 어려움.

**Solution**: 자주 나오는 에러 패턴을 잡아서 사용자 친화적 메시지로 변환.

| CLI 에러 | GUI 표시 |
|---|---|
| `Permission denied: /dev/ttyACM0` | `⚠️ 포트 권한 없음 → sudo chmod 666 /dev/ttyACM0 또는 udev 규칙 추가` |
| `Could not find calibration file` | `⚠️ 캘리브레이션 파일 없음 → Calibration 탭에서 먼저 캘리브 실행` |
| `Camera index 0 cannot be opened` | `⚠️ 카메라 열기 실패 → 다른 프로세스가 사용 중이거나 연결 확인` |
| `CUDA out of memory` | `⚠️ GPU 메모리 부족 → batch size 줄이거나 더 작은 모델 사용` |

**Implementation**:
- `process_manager.py`의 `_reader`에서 regex 패턴 매칭
- 매칭 시 원본 로그 + 번역 메시지를 함께 WebSocket으로 전송
- 프론트엔드에서 번역 메시지를 노란색 안내 박스로 렌더링

---

### 8. Dataset Quality Inspector (데이터셋 품질 검사)

**Problem**: 학습에 쓸 데이터셋의 품질을 사전에 검증할 방법이 없음.

**Solution**: Dataset 탭에서 선택한 데이터셋의 상태를 자동 점검.

**Checks**:
- 에피소드별 프레임 수 분포 (너무 짧거나 긴 에피소드 하이라이트)
- 비디오 파일 존재/손상 여부
- 카메라별 프레임 동기화 확인
- 총 용량, 예상 학습 시간

---

### 9. Global Keyboard Shortcuts (글로벌 단축키)

**Problem**: 로봇 앞에서 양손이 로봇 팔에 가 있으면 마우스로 버튼 누르기가 어려움. 현재 Record 탭에 `→`, `←`, `Esc` 키 안내가 있지만 실제 `window.addEventListener('keydown', ...)` 바인딩이 없어서 작동하지 않음.

**Solution**: 전역 키보드 바인딩 추가.

```
Space : Start/Stop Teleop or Record
→     : Save episode
←     : Discard episode
Esc   : End recording session
```

**Implementation**:
- `main.js`에 `window.addEventListener('keydown', ...)` 추가
- 현재 활성 탭 기준으로 컨텍스트별 동작
- input/textarea에 포커스 있을 때는 무시
- 단축키 헬프 오버레이 (`?` 키로 토글)

---

### 10. Desktop Notifications (데스크톱 알림)

**Problem**: 학습 완료, 녹화 세션 종료 등 장시간 작업 완료를 다른 탭에서 알 수 없음.

**Solution**: Browser Notification API로 작업 완료 알림.

**Triggers**:
- 학습 완료 (`train process ended`)
- 녹화 세션 완료 (모든 에피소드 수집 완료)
- 프로세스 비정상 종료 (에러)

**Implementation**:
- `Notification.requestPermission()` on first use
- `WS.onOutput`에서 프로세스 종료 감지 시 notification 발행

---

## Priority Summary

| Priority | Feature | Effort | Impact | Notes |
|:---:|---|:---:|:---:|---|
| **1** | Preflight Check | M | ★★★ | 가장 많은 사용자 고통 해소, 경쟁 우위 |
| **2** | Configuration Profiles | S | ★★★ | 실제 랩 환경에서 필수, 구현 난이도 낮음 |
| **3** | Arm Port udev | M | ★★★ | 카메라만 되고 팔은 안 되면 절반만 해결 |
| **4** | Training Visualization | M | ★★☆ | 기존 Train 탭 완성도 업 |
| **5** | Eval / Replay Tab | L | ★★☆ | 파이프라인 루프를 닫는 마지막 퍼즐 |
| **6** | Hub Upload | S | ★★☆ | 원클릭 공유 → 커뮤니티 바이럴 |
| **7** | Error Translation | S | ★★☆ | 초보자 경험 대폭 개선 |
| **8** | Dataset Inspector | M | ★☆☆ | 학습 실패 사전 예방 |
| **9** | Keyboard Shortcuts | S | ★★☆ | 코드 변경량 대비 체감 효과 최대 |
| **10** | Desktop Notifications | S | ★☆☆ | 장시간 작업 시 편의 |

Effort: S = 1-2일, M = 3-5일, L = 1주+
