# LeStudio — 생태계 통합 계획서 (Ecosystem Integration Plan)

최종 갱신: 2026-02-23
상태: 초안 (Draft) — v2 (LeRobot 공식 문서 분석 반영)

---

## 1. 배경 및 목표

### 1.1 문제 인식

lestudio는 현재 **SO-100/SO-101 팔 로봇 전용**으로 설계되어 있다.
LeRobot 프레임워크가 지원하는 다양한 로봇 타입 (16+ Robot, 16+ Teleoperator) 과
모바일 플랫폼을 지원하지 못하며, 확장을 위한 추상화 레이어가 부재하다.

### 1.2 목표

**LeRobot 생태계 전체를 지원하는 범용 Studio로 재설계한다.**

- LeRobot 프레임워크에 등록된 모든 **Robot / Teleoperator / Camera** 타입을 자동 인식
- 팔 로봇, 모바일 로봇, 모바일 매니퓰레이터, 휴머노이드를 단일 UI에서 지원
- Serial, CAN bus, ZMQ, Cloud SDK, Ethernet 등 통신 프로토콜 추상화
- 서드파티 플러그인 패키지(`lerobot_robot_*` 등)도 동적 탐색
- 커스텀 모바일 플랫폼 (차동 4륜 등) 지원

### 1.3 설계 원칙

1. **LeRobot을 진실의 원천(Single Source of Truth)으로** — Studio가 로봇 타입을 하드코딩하지 않고 LeRobot 레지스트리에서 동적 탐색
2. **Robot / Teleoperator / Camera 분리 존중** — LeRobot의 3-Registry 구조를 그대로 반영 (Robot ≠ Teleoperator)
3. **Capability 기반 UI 렌더링** — 로봇의 능력(팔/바퀴/카메라)에 따라 관련 패널만 표시
4. **통신 프로토콜 추상화** — Serial이든 ZMQ든 Studio는 알 필요 없이 LeRobot이 처리
5. **Config 스키마 드리븐** — 각 로봇의 dataclass config에서 UI 폼을 자동 생성
6. **플러그인 인식(Plugin-Aware)** — `lerobot_robot_*`, `lerobot_camera_*`, `lerobot_teleoperator_*` 서드파티 패키지도 자동 탐색
7. **점진적 리팩터링** — 기존 SO-101 기능을 깨뜨리지 않으면서 확장

---

## 2. 현재 아키텍처 분석

### 2.1 lestudio 구조

```
src/lestudio/
├── cli.py                  # 진입점
├── server.py               # FastAPI 서버 (핵심 — ~1500줄)
├── command_builders.py     # CLI 커맨드 빌더 (teleop/record/train/eval/calibrate)
├── process_manager.py      # subprocess 생명주기 관리
├── teleop_bridge.py        # LeRobot teleop 실행 래퍼
├── record_bridge.py        # LeRobot record 실행 래퍼
├── camera_patch.py         # OpenCVCamera SHM 프레임 공유 패치
└── static/                 # 프론트엔드 (Vanilla HTML/JS/CSS, 18 모듈)
```

### 2.2 하드코딩 완전 인벤토리 (34+ 인스턴스, 7 파일)

#### Backend (server.py, command_builders.py)

| 위치 | 하드코딩 내용 | 영향 |
|------|-------------|------|
| `server.py:44-47` | `ROBOT_TYPES = ["so101_follower", "so100_follower", "so101_leader", "so100_leader"]` | 다른 로봇 타입 선택 불가 |
| `server.py:49-87` | `DEFAULT_CONFIG` — follower/leader 포트, 단일/양팔 모드만 | 모바일 베이스 설정 없음 |
| `server.py:147-160` | `get_arms()` — `/dev/tty*` Serial 디바이스만 탐색 | 네트워크 로봇 감지 불가 |
| `server.py:945-957` | `check_calibration()` — `so_follower`/`so_leader` 경로 고정 | 다른 로봇의 캘리브레이션 경로 미지원 |
| `server.py` | udev rules — `ttyUSB`/`ttyACM` 패턴 하드코딩 | CAN bus 로봇 미지원 |
| `command_builders.py:28-53` | `build_teleop_args()` — `--robot.type=so101_follower` 하드코딩 | 동적 로봇 타입 불가 |
| `command_builders.py:56-110` | `build_record_args()` — 동일 | 동일 |
| `command_builders.py:113-153` | `build_calibrate_args()` / `build_motor_setup_args()` — 동일 | 동일 |

#### Frontend (5 JS 파일)

| 위치 | 하드코딩 내용 | 영향 |
|------|-------------|------|
| `workbench_teleop.js` | 포트 기본값, role 매핑 (follower/leader) | SO-101 이외 로봇 지원 불가 |
| `workbench_record.js` | 동일한 포트/role 가정 | 동일 |
| `workbench_calibrate.js` | 캘리브레이션 대상 role 고정 | 동일 |
| `workbench_motor_setup.js` | 모터 ID 기본값, 모터 모델 가정 | Dynamixel/Damiao 모터 미지원 |
| `workbench_device_setup.js` | 시리얼 포트 패턴, validation 규칙 | 네트워크 로봇 미지원 |

### 2.3 LeRobot 프레임워크 아키텍처 (v0.4.4 기준)

> ⚠️ 이 섹션은 LeRobot 공식 문서 및 소스코드 분석 결과를 기반으로 작성되었다.
> 참고: https://huggingface.co/docs/lerobot/index

#### 2.3.1 3-Registry 시스템 (Robot / Teleoperator / Camera)

LeRobot은 **Robot, Teleoperator, Camera를 완전히 독립된 클래스 계층**으로 관리한다.
각각 `draccus.ChoiceRegistry`를 상속하며 별도의 type 문자열로 등록된다.

```python
# Robot 계층 — 물리적 로봇 (액추에이터 제어)
@dataclass
class RobotConfig(draccus.ChoiceRegistry, abc.ABC):
    id: str | None = None
    calibration_dir: Path | None = None

# Teleoperator 계층 — 입력 장치 (리더 팔, 키보드, 게임패드, 폰)
@dataclass
class TeleoperatorConfig(draccus.ChoiceRegistry, abc.ABC):
    id: str | None = None
    calibration_dir: Path | None = None

# Camera 계층 — 카메라 (OpenCV, ZMQ, RealSense, Reachy2)
@dataclass
class CameraConfig(draccus.ChoiceRegistry, abc.ABC):
    fps: int | None = None
    width: int | None = None
    height: int | None = None
```

**핵심 포인트**: SO-101 follower는 **Robot**, SO-101 leader는 **Teleoperator**이다.
Studio의 기존 "ROBOT_TYPES" 리스트에 leader가 포함된 것은 LeRobot 구조를 무시한 설계.

CLI에서는 `--robot.type`과 `--teleop.type`으로 **별도 지정**한다:
```bash
lerobot-teleoperate \
    --robot.type=so101_follower \    # Robot
    --teleop.type=so101_leader       # Teleoperator (별도!)
```

#### 2.3.2 draccus.ChoiceRegistry 메커니즘

각 Config 서브클래스는 `@register_subclass("type_name")` 데코레이터로 등록된다:

```python
@RobotConfig.register_subclass("so101_follower")
@RobotConfig.register_subclass("so100_follower")
@dataclass
class SOFollowerRobotConfig(RobotConfig):
    port: str
    cameras: dict[str, CameraConfig] = field(default_factory=dict)
    use_degrees: bool = True
    ...
```

등록된 타입은 `_subclass_registry` dict에 저장되며 **런타임에 동적 쿼리** 가능:

```python
from lerobot.robots.config import RobotConfig
from lerobot.teleoperators.config import TeleoperatorConfig
from lerobot.cameras.configs import CameraConfig
import dataclasses

# 등록된 모든 타입 조회
robot_types = RobotConfig._subclass_registry
# → {"so101_follower": SOFollowerRobotConfig, "lekiwi": LeKiwiConfig, ...}

teleop_types = TeleoperatorConfig._subclass_registry
# → {"so101_leader": SOLeaderTeleoperatorConfig, "keyboard": KeyboardConfig, ...}

camera_types = CameraConfig._subclass_registry
# → {"opencv": OpenCVCameraConfig, "zmq": ZMQCameraConfig, ...}

# 각 타입의 설정 필드(=UI 폼 항목) 추출
fields = dataclasses.fields(SOFollowerRobotConfig)
# → (Field(name='port', type=str), Field(name='cameras', ...), ...)

# Config → dict 변환
config_dict = dataclasses.asdict(config_instance)
```

#### 2.3.3 플러그인 자동 발견 시스템

LeRobot은 **서드파티 플러그인 패키지를 자동으로 발견**하는 메커니즘을 갖고 있다:

```python
# lerobot/utils/import_utils.py → register_third_party_plugins()
def register_third_party_plugins() -> None:
    prefixes = ("lerobot_robot_", "lerobot_camera_", "lerobot_teleoperator_", "lerobot_policy_")
    for dist in importlib.metadata.distributions():
        dist_name = dist.metadata.get("Name")
        if dist_name and dist_name.startswith(prefixes):
            importlib.import_module(dist_name)
```

**플러그인 패키지 컨벤션** (4가지):
1. 패키지명이 `lerobot_robot_*`, `lerobot_camera_*`, `lerobot_teleoperator_*` 접두사
2. Config 클래스 `MyDeviceConfig`, 구현 클래스 `MyDevice` (Config 접미사 제거)
3. 예측 가능한 파일 구조 (`config_*.py` + 구현 파일)
4. `__init__.py`에서 두 클래스를 export

**Studio에의 영향**: `register_third_party_plugins()` 호출 후 `_subclass_registry`를 쿼리하면
내장 타입 + 설치된 플러그인 타입이 **모두** 포함되어 나온다.

#### 2.3.4 CLI 엔트리포인트 (v0.4.4)

기존 `python -m lerobot.teleoperate` 방식에서 **전용 엔트리포인트**로 변경되었다:

| 명령 | 용도 | Studio 관련 |
|------|------|-------------|
| `lerobot-teleoperate` | 텔레옵 | ✅ 핵심 |
| `lerobot-record` | 데이터 수집 | ✅ 핵심 |
| `lerobot-calibrate` | 캘리브레이션 | ✅ 핵심 |
| `lerobot-setup-motors` | 모터 ID 설정 | ✅ 핵심 |
| `lerobot-find-port` | 시리얼 포트 탐색 | ✅ 유틸 |
| `lerobot-find-cameras` | 카메라 탐색 | ✅ 유틸 |
| `lerobot-setup-can` | CAN bus 설정 | ✅ CAN 로봇용 |
| `lerobot-replay` | 에피소드 리플레이 | 🟡 선택 |
| `lerobot-train` | 모델 학습 | ✅ 핵심 |
| `lerobot-eval` | 정책 평가 | ✅ 핵심 |
| `lerobot-find-joint-limits` | 모터 범위 탐색 | 🟡 선택 |

CLI 인자 구조 (dot-notation):
```bash
lerobot-teleoperate \
    --robot.type=so101_follower \
    --robot.port=/dev/ttyUSB0 \
    --robot.id=my_robot \
    --robot.cameras="{ front: {type: opencv, index_or_path: 0, width: 640, height: 480, fps: 30}}" \
    --teleop.type=so101_leader \
    --teleop.port=/dev/ttyUSB1 \
    --teleop.id=my_leader \
    --display_data=true
```

#### 2.3.5 Config → Robot 인스턴스화 흐름

```
CLI args (--robot.type=X --robot.port=Y)
    → draccus.parse() → RobotConfig 서브클래스 인스턴스
    → make_robot_from_config(config)
    → if 알려진 타입: 직접 import (if-elif 분기)
       else: make_device_from_device_class(config)  ← 플러그인용 제네릭 팩토리
    → Robot 인스턴스
```

`make_robot_from_config()` (robots/utils.py)는 알려진 타입은 직접 분기하고,
알 수 없는 타입은 config 클래스의 모듈 경로에서 구현 클래스를 동적 import한다.

#### 2.3.6 Processor Pipeline 시스템 (v0.4.4 신규)

LeRobot에 완전히 새로운 데이터 흐름 추상화가 추가되었다:

- **`RobotProcessorPipeline`** — 하드웨어 레벨 신호 변환 (정규화, 좌표 변환, 안전 제한)
- **`PolicyProcessorPipeline`** — 모델 입출력 변환 (텐서화, 정규화)
- **`EnvTransition`** — 유니버설 데이터 컨테이너 (observation → action → next_observation)

3-Pipeline 패턴:
```
Teleop → Dataset:  teleop.get_action() → RobotProcessorPipeline → dataset에 저장
Dataset → Robot:   dataset에서 읽기 → RobotProcessorPipeline → robot.send_action()
Robot → Dataset:   robot.get_observation() → RobotProcessorPipeline → dataset에 저장
```

Phone teleop은 이 pipeline을 활용하여 IK, EE bounds, safety limits를 적용한다.

**Studio에의 영향**: Phase 2+에서 record 시 processor 설정 옵션을 UI에 노출 검토.
Phase 0~1에서는 기본 pipeline을 사용하므로 즉시 대응 불필요.

---

## 3. 지원 대상 디바이스 분석

### 3.1 Robot 타입 전체 목록 (14+ 타입)

| Type String | 통신 | 모터 | 팔 | 모바일 | 카메라 | 비고 |
|-------------|------|------|:--:|:------:|--------|------|
| `so100_follower` | Serial | Feetech STS3215 | ✅ | ❌ | USB | SO-100 팔 |
| `so101_follower` | Serial | Feetech STS3215 | ✅ | ❌ | USB | SO-101 팔 |
| `bi_so_follower` | Serial | Feetech | ✅✅ | ❌ | USB | 양팔 SO |
| `lekiwi` | Serial (직결) | Feetech | ✅ | ✅ 3-omni | USB (Pi 탑재) | 모바일+팔, Host측 |
| `lekiwi_client` | ZMQ (WiFi) | — | ✅ | ✅ 3-omni | ZMQ 카메라 | 모바일+팔, Client측 |
| `koch_follower` | Serial | Dynamixel | ✅ | ❌ | USB | Koch 팔 |
| `omx_follower` | Serial | Dynamixel | ✅ | ❌ | USB | OMX 팔 (사전설정됨) |
| `openarm_follower` | CAN bus | Damiao | ✅ (7DOF) | ❌ | USB | OpenArm 7DOF |
| `bi_openarm_follower` | CAN bus | Damiao | ✅✅ (7DOF) | ❌ | USB | 양팔 OpenArm |
| `hope_jr_hand` | Serial | Feetech | ✅ (손) | ❌ | — | Hope Jr 손 |
| `hope_jr_arm` | Serial | Feetech | ✅ | ❌ | — | Hope Jr 팔 |
| `reachy2` | SDK | — | ✅✅ | ✅ | 내장 | Reachy2 휴머노이드 |
| `unitree_g1` | ZMQ + Ethernet | — | ✅✅ | ✅ | ZMQ 카메라 | Unitree G1 휴머노이드 |
| `earthrover_mini_plus` | Cloud SDK | — | ❌ | ✅ | 클라우드 | EarthRover, 클라우드 연결 |

> 추가로 XLeRobot (`xlerobot` / `xlerobot_client`)이 서드파티 플러그인으로 존재.

### 3.2 Teleoperator 타입 전체 목록 (16+ 타입)

| Type String | 입력 방식 | 대상 Robot | 비고 |
|-------------|----------|------------|------|
| `so100_leader` | 리더 팔 (Feetech) | SO-100 follower | 물리적 리더 |
| `so101_leader` | 리더 팔 (Feetech) | SO-101 follower, LeKiwi | 물리적 리더 |
| `bi_so_leader` | 양팔 리더 | bi_so_follower | 양팔 리더 |
| `koch_leader` | 리더 팔 (Dynamixel) | koch_follower | Koch 리더 |
| `omx_leader` | 리더 팔 (Dynamixel) | omx_follower | OMX 리더 |
| `openarm_leader` | 리더 팔 (Damiao) | openarm_follower | OpenArm 리더 |
| `bi_openarm_leader` | 양팔 리더 (Damiao) | bi_openarm_follower | 양팔 OpenArm 리더 |
| `keyboard` | 키보드 관절 제어 | 범용 | 키보드 → 관절 직접 |
| `keyboard_ee` | 키보드 EE 제어 | 범용 | 키보드 → End Effector |
| `keyboard_rover` | 키보드 이동 제어 | earthrover_mini_plus | 이동 로봇 전용 |
| `gamepad` | 게임패드 (pygame) | 범용 | Xbox/PS 컨트롤러 |
| `homunculus_glove` | 장갑 | hope_jr_hand | 손가락 텔레옵 |
| `homunculus_arm` | 외골격 팔 | hope_jr_arm | 팔 텔레옵 |
| `phone` | 스마트폰 (HEBI) | 범용 | iOS/Android, IK 사용 |
| `reachy2_teleoperator` | VR/전용 | reachy2 | Reachy2 전용 |
| `unitree_g1` | 외골격 | unitree_g1 | G1 전용 텔레옵 |

### 3.3 Camera 시스템 (4 타입)

| Type String | 용도 | 주요 설정 | 비고 |
|-------------|------|----------|------|
| `opencv` | USB, 웹캠, 노트북, 폰 | `index_or_path`, `fps`, `width`, `height`, `rotation` | 가장 범용 |
| `zmq` | 네트워크 카메라 | `server_address`, `port`, `camera_name` | LeKiwi, Unitree G1 |
| `intelrealsense` | Intel 깊이 카메라 | `serial_number_or_name`, `use_depth` | 깊이 정보 포함 |
| `reachy2_camera` | Reachy2 전용 | Reachy2 SDK 연동 | Reachy2 한정 |

카메라는 CLI에서 **인라인 YAML dict**로 전달한다:
```bash
--robot.cameras="{ front: {type: opencv, index_or_path: 0, width: 640, height: 480, fps: 30}}"
```

탐색 유틸: `lerobot-find-cameras opencv` 또는 `lerobot-find-cameras realsense`

### 3.4 통신 프로토콜별 분류

| 프로토콜 | 로봇 | 연결 방식 | 디바이스 탐색 |
|----------|------|----------|--------------|
| **Serial (Feetech)** | SO-100/101, LeKiwi(host), Hope Jr, bi_so | `/dev/ttyACM*`, `/dev/ttyUSB*` | `lerobot-find-port` |
| **Serial (Dynamixel)** | Koch, OMX | `/dev/ttyUSB*` | `lerobot-find-port` |
| **CAN bus (Damiao)** | OpenArm, bi_openarm | CAN 인터페이스 | `lerobot-setup-can` |
| **ZMQ** | LeKiwi(client), Unitree G1(cam), XLeRobot(client) | `tcp://{ip}:{port}` | 수동 IP 입력 |
| **Ethernet** | Unitree G1 (control) | 이더넷 직결 | 직접 연결 |
| **Cloud SDK** | EarthRover | HTTPS API | API 키 설정 |
| **SDK** | Reachy2 | reachy2_sdk | SDK 연결 |

### 3.5 XLeRobot 소프트웨어 아키텍처

XLeRobot은 Client/Host 분리 구조를 사용한다:

```
[PC/Laptop]                         [Raspberry Pi on Robot]
 XLerobotClient                      XLerobotHost
 ├── ZMQ CMD (port 5555)  ──→        ├── Serial → 팔 모터
 ├── ZMQ OBS (port 5556)  ←──        ├── Serial → 바퀴 모터  
 └── 로컬 카메라 (선택적)              └── 카메라 → 프레임 전송
```

**핵심 설정 (config_xlerobot.py):**
- `XLerobotConfig` — 로컬 직접 연결 (port1, port2: Serial)
- `XLerobotClientConfig` — 원격 연결 (remote_ip, port_zmq_cmd, port_zmq_observations)
- `XLerobotHostConfig` — Pi측 실행 (ZMQ 서버 + 모터 제어 + 카메라 캡처)

### 3.6 LeKiwi ZMQ 프로토콜 상세

LeKiwi는 LeRobot 내장 모바일 로봇으로, ZMQ 기반 Host/Client 분리 아키텍처를 사용한다:

```
[PC - Client]                        [Pi on Robot - Host]
 LeKiwiClient                         LeKiwiHost
 ├── ZMQ PUSH (5555)  ──→ cmd         ├── ZMQ PULL (5555) ← cmd
 ├── ZMQ PULL (5556)  ←── obs         ├── ZMQ PUSH (5556) → obs
 └── 키보드/리더 입력                   ├── Serial → Feetech 모터
                                       └── OpenCV → 카메라 2대
```

- 양쪽 소켓 `zmq.CONFLATE=1` — 최신 메시지만 유지 (latency 최소화)
- Observation 포맷: JSON + base64 JPEG 이미지
- Watchdog: 500ms 내 cmd 미수신 시 모터 정지
- 기본 카메라: front (640×480, 180° 회전) + wrist (480×640, 90° 회전)

---

## 4. 재설계 아키텍처

### 4.1 목표 아키텍처 개요

```
┌──────────────────────────────────────────────────────────────┐
│                       lestudio                          │
│                                                                │
│  ┌──────────────┐  ┌───────────────┐  ┌─────────────────┐    │
│  │  Frontend     │  │   API Layer   │  │   Core Layer    │    │
│  │  (Static)     │←→│   (FastAPI)   │←→│                 │    │
│  │               │  │               │  │ ┌─────────────┐ │    │
│  │ ┌───────────┐ │  │ /api/robots   │  │ │ Device      │ │    │
│  │ │ Arm Panel │ │  │ /api/teleops  │  │ │ Registry    │ │    │
│  │ │Mobile Pnl │ │  │ /api/cameras  │  │ │ (3-Registry)│ │    │
│  │ │Camera Pnl │ │  │ /api/config   │  │ ├─────────────┤ │    │
│  │ │Config Pnl │ │  │ /api/process  │  │ │ Command     │ │    │
│  │ │Teleop Pnl │ │  │               │  │ │ Builder     │ │    │
│  │ └───────────┘ │  └───────────────┘  │ ├─────────────┤ │    │
│  └──────────────┘                      │ │ Connection  │ │    │
│                                        │ │ Adapter     │ │    │
│                                        │ └─────────────┘ │    │
│                                        └────────┬────────┘    │
└─────────────────────────────────────────────────┼─────────────┘
                                                  │
                  ┌───────────────────────────────┼────────────┐
                  │          LeRobot Framework    │            │
                  │                               ▼            │
                  │  ┌─────────────┐ ┌──────────────────┐      │
                  │  │ RobotConfig │ │TeleoperatorConfig│      │
                  │  │  Registry   │ │    Registry      │      │
                  │  ├─────────────┤ ├──────────────────┤      │
                  │  │so101_follower│ │ so101_leader    │      │
                  │  │lekiwi_client│ │ keyboard        │      │
                  │  │unitree_g1   │ │ gamepad         │      │
                  │  │(plugins...) │ │ phone           │      │
                  │  └─────────────┘ └──────────────────┘      │
                  │                                            │
                  │  ┌──────────────┐                          │
                  │  │ CameraConfig │                          │
                  │  │   Registry   │                          │
                  │  ├──────────────┤                          │
                  │  │ opencv       │                          │
                  │  │ zmq          │                          │
                  │  │ intelrealsense│                         │
                  │  │ (plugins...) │                          │
                  │  └──────────────┘                          │
                  └────────────────────────────────────────────┘
```

### 4.2 신규 Core 모듈 설계

#### 4.2.1 DeviceRegistry — 3-Registry 통합 탐색

```python
# 목표: LeRobot의 3개 레지스트리 (Robot, Teleoperator, Camera) + 플러그인을 통합 탐색
class DeviceRegistry:
    """LeRobot의 draccus.ChoiceRegistry에서 등록된 모든 디바이스 타입을 동적으로 탐색"""

    def __init__(self):
        # 서드파티 플러그인 등록 (lerobot_robot_*, lerobot_camera_*, etc.)
        register_third_party_plugins()

    def get_robot_types() -> list[RobotTypeInfo]:
        """RobotConfig._subclass_registry 에서 등록된 모든 Robot 타입 반환"""
        ...

    def get_teleop_types() -> list[TeleopTypeInfo]:
        """TeleoperatorConfig._subclass_registry 에서 등록된 모든 Teleoperator 타입 반환"""
        ...

    def get_camera_types() -> list[CameraTypeInfo]:
        """CameraConfig._subclass_registry 에서 등록된 모든 Camera 타입 반환"""
        ...

    def get_config_schema(device_category: str, device_type: str) -> dict:
        """특정 디바이스의 config dataclass를 JSON Schema로 변환
        device_category: "robot" | "teleop" | "camera"
        device_type: 등록된 type 문자열 (e.g., "so101_follower")
        → dataclasses.fields() 순회 → JSON Schema (타입, 기본값, 설명)
        """
        ...

    def get_compatible_teleops(robot_type: str) -> list[str]:
        """특정 Robot 타입과 호환되는 Teleoperator 타입 목록 반환
        (모터 타입, DOF, 프로토콜 기반 추론)
        """
        ...

    def get_capabilities(robot_type: str) -> RobotCapabilities:
        """로봇의 능력 세트 반환 (has_arms, has_wheels, is_remote, etc.)
        config dataclass의 필드 존재 여부로 추론:
          - 'cameras' 필드 → has_cameras
          - 'remote_ip' 필드 → is_remote
          - 'teleop_keys' 필드 → has_keyboard_teleop
          - etc.
        """
        ...
```

**폴백 전략** (LeRobot import 실패 시):
- 하드코딩된 기본 타입 리스트로 폴백: `["so101_follower", "so100_follower"]`
- 상단 경고 배너: "LeRobot 레지스트리 탐색 실패 — 기본 로봇만 표시"

#### 4.2.2 ConnectionAdapter — 통신 프로토콜 추상화

```python
class ConnectionAdapter(ABC):
    """로봇 연결 추상화"""

    @abstractmethod
    def discover_devices() -> list[DeviceInfo]: ...
    @abstractmethod
    def check_connection(config) -> ConnectionStatus: ...
    @abstractmethod
    def get_preflight_checks(config) -> list[PreflightCheck]: ...

class SerialConnectionAdapter(ConnectionAdapter):
    """SO-100/101, Koch, OMX, Hope Jr — ttyUSB/ttyACM 탐색"""
    # lerobot-find-port 활용
    ...

class CANConnectionAdapter(ConnectionAdapter):
    """OpenArm — CAN bus 인터페이스 탐색"""
    # lerobot-setup-can 활용
    ...

class ZMQConnectionAdapter(ConnectionAdapter):
    """LeKiwi Client, XLeRobot Client, Unitree G1 — IP:port 연결 확인"""
    ...

class CloudConnectionAdapter(ConnectionAdapter):
    """EarthRover — API 키 기반 클라우드 연결"""
    ...
```

#### 4.2.3 CommandBuilder 일반화

```python
class GenericCommandBuilder:
    """로봇 config에서 CLI 인자를 동적으로 생성
    
    새 CLI 엔트리포인트 사용:
    - lerobot-teleoperate (기존: python -m lerobot.teleoperate)
    - lerobot-record
    - lerobot-calibrate
    - lerobot-setup-motors
    """

    def build_args(action: str, robot_config: dict, teleop_config: dict | None = None) -> list[str]:
        """
        action: "teleop" | "record" | "calibrate" | "motor_setup" | "train" | "eval"
        robot_config: Robot 설정 {"type": "so101_follower", "port": "/dev/ttyUSB0", ...}
        teleop_config: Teleoperator 설정 {"type": "so101_leader", "port": "/dev/ttyUSB1", ...}

        config dict의 키를 순회하며 --robot.{key}={value} / --teleop.{key}={value} 인자 생성
        cameras dict는 인라인 YAML로 직렬화
        """
        ...

    def get_entry_point(action: str) -> str:
        """액션에 해당하는 CLI 엔트리포인트 반환"""
        return {
            "teleop": "lerobot-teleoperate",
            "record": "lerobot-record",
            "calibrate": "lerobot-calibrate",
            "motor_setup": "lerobot-setup-motors",
            "train": "lerobot-train",
            "eval": "lerobot-eval",
        }[action]
```

### 4.3 Frontend 재설계

#### 4.3.1 Capability 기반 동적 UI

```
로봇 선택 시 → capabilities 조회 → 해당 패널만 렌더링

capabilities = {
    has_arms: true,        → 팔 설정/캘리브레이션/텔레옵 패널 표시
    has_wheels: true,      → 모바일 베이스 제어 패널 표시
    is_remote: true,       → 네트워크 설정 패널 표시 (IP, port)
    is_dual_arm: true,     → 양팔 설정 패널 표시
    has_keyboard_teleop: true, → 키보드 텔레옵 키 매핑 패널 표시
    camera_types: [...],   → 해당 카메라 설정 패널 표시
    compatible_teleops: [...], → 호환 텔레오퍼레이터 선택기 표시
}
```

#### 4.3.2 신규 UI 패널

| 패널 | 대상 로봇 | 기능 |
|------|----------|------|
| **로봇 타입 선택기** | 전체 | 드롭다운 + 로봇 정보/사양 카드 |
| **텔레오퍼레이터 선택기** | 전체 | 호환 텔레옵 드롭다운 (Robot과 분리) |
| **네트워크 설정** | LeKiwi, XLeRobot Client, Unitree G1 | IP 입력, ZMQ 포트, 연결 테스트 |
| **모바일 베이스 제어** | LeKiwi, XLeRobot, EarthRover | 방향 패드, 속도 슬라이더, 키 매핑 |
| **양팔 설정** | bi_so, bi_openarm, XLeRobot | Left/Right 독립 포트/캘리브레이션 |
| **카메라 설정** | 전체 | 타입별 (opencv/zmq/realsense) 동적 폼 |
| **CAN bus 설정** | OpenArm | CAN 인터페이스 설정, setup-can 실행 |

---

## 5. 구현 로드맵

### Phase 0: 추상화 레이어 삽입 (기반 공사)

**목표**: 하드코딩을 제거하고 3-Registry 기반의 확장 인터페이스를 삽입한다.
**기존 기능**: 깨지지 않아야 한다 (SO-101은 그대로 동작).

| 작업 | 파일 | 설명 |
|------|------|------|
| DeviceRegistry 구현 | `device_registry.py` (신규) | Robot + Teleoperator + Camera 3개 레지스트리 통합 탐색 |
| 플러그인 발견 통합 | `device_registry.py` | `register_third_party_plugins()` 호출 후 `_subclass_registry` 쿼리 |
| ROBOT_TYPES 동적화 | `server.py` | 하드코딩 리스트 → DeviceRegistry 호출로 교체 |
| `/api/robots` 엔드포인트 | `server.py` | Robot 타입 목록 + capabilities + config schema 반환 |
| `/api/teleops` 엔드포인트 | `server.py` | Teleoperator 타입 목록 + 호환성 정보 반환 |
| `/api/cameras` 엔드포인트 | `server.py` | Camera 타입 목록 + config schema 반환 |
| Config schema 자동 생성 | `device_registry.py` | `dataclasses.fields()` → JSON Schema 변환 |
| 프론트엔드 로봇 선택기 | `static/` | Robot + Teleoperator 분리 선택 드롭다운 + 로봇 정보 카드 |
| LeRobot import 폴백 | `device_registry.py` | import 실패 시 하드코딩 폴백 + 경고 배너 |

### Phase 1: Backend 일반화

**목표**: command_builders와 디바이스 탐색을 로봇 타입에 무관하게 동작시킨다.

| 작업 | 파일 | 설명 |
|------|------|------|
| GenericCommandBuilder | `command_builders.py` | 로봇 config 기반 동적 인자 생성 (`--robot.type` + `--teleop.type` 분리) |
| CLI 엔트리포인트 전환 | `command_builders.py` | `lerobot-teleoperate`, `lerobot-record` 등 새 CLI 사용 |
| ConnectionAdapter 인터페이스 | `connection.py` (신규) | Serial / CAN / ZMQ / Cloud 통합 추상화 |
| SerialConnectionAdapter | `connection.py` | 기존 get_arms() 로직 래핑 + `lerobot-find-port` 연동 |
| CANConnectionAdapter | `connection.py` | CAN bus 인터페이스 탐색 + `lerobot-setup-can` 연동 |
| ZMQConnectionAdapter | `connection.py` | IP:port 연결 검증, ping 체크 |
| CloudConnectionAdapter | `connection.py` | API 키 기반 연결 검증 (EarthRover) |
| get_devices() 통합 | `server.py` | Serial + CAN + 네트워크 디바이스 통합 탐색 |
| preflight 일반화 | `server.py` | 로봇 타입별 체크 항목 동적 결정 |
| 캘리브레이션 경로 동적화 | `server.py` | `~/.cache/huggingface/lerobot/calibration/{robots|teleoperators}/{type}/{id}.json` |

### Phase 2: Frontend 적응형 UI

**목표**: 로봇 capabilities에 따라 UI 패널이 동적으로 표시/숨겨진다.

| 작업 | 파일 | 설명 |
|------|------|------|
| 네트워크 설정 패널 | `static/` | IP/port 입력, 연결 테스트 버튼 |
| 모바일 베이스 제어 패널 | `static/` | 방향키 UI, 속도 제어, 키 매핑 |
| 양팔 설정 패널 | `static/` | Left/Right 독립 구성 |
| Capability 기반 패널 토글 | `static/` | capabilities 응답 기반 show/hide |
| 카메라 타입별 설정 폼 | `static/` | opencv/zmq/realsense 각각의 설정 UI |
| Teleoperator 선택기 UI | `static/` | 호환 텔레옵 드롭다운 + 설정 폼 |
| CAN bus 설정 UI | `static/` | CAN 인터페이스 설정, setup-can 실행 |
| Processor 설정 노출 (선택) | `static/` | record 시 processor pipeline 옵션 |

### Phase 3: 커스텀 로봇 & 플러그인

**목표**: 사용자가 자신의 로봇 타입을 등록하고 사용할 수 있다.

| 작업 | 설명 |
|------|------|
| 플러그인 패키지 가이드 | `lerobot_robot_*` 패키지 작성 방법 문서화 |
| Studio 플러그인 UI | 설치된 플러그인 목록 조회, 설치/제거 안내 |
| 커스텀 모바일 플랫폼 프로필 | 차동 4륜 등 비표준 플랫폼 설정 가이드 |
| URDF 연동 | 시뮬레이션 + 시각화 통합 |
| 커뮤니티 프로필 저장소 | HF Hub 또는 GitHub에서 프로필 공유 |

> **참고**: LeRobot의 플러그인 시스템이 이미 공식 존재하므로, Phase 0의 DeviceRegistry가
> `register_third_party_plugins()` 호출 시 자동으로 플러그인을 발견한다.
> Phase 3은 "플러그인 작성 가이드" 및 "Studio 내 플러그인 관리 UI" 에 집중.

---

## 6. 리스크 및 제약 사항

### 6.1 기술적 리스크

| 리스크 | 영향 | 완화 방안 |
|--------|------|----------|
| LeRobot 레지스트리 API 변경 | Registry 연동 깨짐 | 어댑터 패턴으로 격리, `_subclass_registry` 접근을 단일 함수로 캡슐화 |
| draccus 내부 API 변경 | `_subclass_registry` 접근 불가 | 공식 API(`get_choice_name()` 등)만 사용, 내부 dict 접근은 try/except 래핑 |
| ZMQ 연결 안정성 | 네트워크 로봇 텔레옵 끊김 | 재연결 로직, watchdog, 상태 표시 |
| Config schema 복잡도 | 일부 로봇의 nested config 처리 어려움 | 단계적 지원, 핵심 필드 우선 노출 |
| 프론트엔드 복잡도 증가 | Vanilla JS 한계 | 컴포넌트 모듈화 유지, 향후 프레임워크 전환 검토 |
| 플러그인 패키지 품질 불균일 | 잘못된 config schema, 누락 필드 | 방어적 파싱, 에러 시 해당 타입만 스킵 |

### 6.2 LeRobot Bridge 격리 원칙

현재 LeRobot 직접 결합은 3개 파일에 격리되어 있다:
- `teleop_bridge.py`
- `record_bridge.py`
- `camera_patch.py`

**이 격리 원칙을 확장하여 유지한다.**

- 신규 `device_registry.py`가 LeRobot의 Config 레지스트리를 import한다.
  → 이 파일이 4번째 "LeRobot 접점" 파일이 된다.
- `connection.py`는 LeRobot을 import하지 **않는다** (프로토콜 레벨만 처리).
- `command_builders.py`는 CLI 문자열만 조합하므로 LeRobot import 없음.
- `lerobot.*` import가 위 4개 파일 밖으로 퍼지지 않도록 유지한다.

### 6.3 하위 호환성

- Phase 0~1 완료 후에도 SO-101 사용자는 **기존과 동일한 경험**을 유지해야 한다.
- 로봇 타입 미선택 시 기본값은 `so101_follower`로 유지.
- 기존 프로필 JSON은 마이그레이션 없이 로드 가능해야 한다.
- Teleoperator 미선택 시 `so101_leader`를 기본 제안.

---

## 7. 의사결정 기록 (Architecture Decisions)

### 7.1 아키텍처 결정

- [x] **Q1**: DeviceRegistry가 LeRobot import에 실패할 경우 fallback 전략은?
  - **→ A: 하드코딩된 기본 타입 리스트로 폴백 + 상단 배너 경고**
  - 근거: LeRobot은 필수 의존성이지만 레지스트리 API가 버전 간 바뀔 수 있음. 방어적 설계로 폴백 시 기본 로봇(SO-100/101)만 표시하고 "범용 탐색 실패" 경고 배너를 노출한다.

- [x] **Q2**: 네트워크 로봇 탐색 방식은?
  - **→ A: 수동 IP 입력만 지원 (Phase 2+에서 mDNS 검토)**
  - 근거: mDNS는 양쪽에 avahi 필요 + 방화벽 이슈 + 네트워크 환경 차이가 큼. LeKiwi/XLeRobot 공식 가이드도 수동 IP 사용 중. 단순하고 확실한 방법부터.

- [x] **Q3**: XLeRobot Host 프로세스 관리를 Studio에서 할 것인가?
  - **→ B: Pi 호스트는 별도 관리, Studio는 Client만 담당**
  - 근거: SSH 관리를 Studio에 넣으면 복잡도 폭발 (SSH 키 관리, paramiko 의존, 보안, 에러 핸들링). Studio의 책임 범위를 Client 측으로 한정. Pi 호스트는 systemd 서비스 또는 Pi 측 경량 관리 도구로 분리.

- [x] **Q4**: 프론트엔드 프레임워크 전환 시점은?
  - **→ A: Vanilla JS 유지 (복잡도가 관리 가능한 동안)**
  - 근거: 현재 18모듈 구조로 이미 상당히 복잡한 UI를 잘 관리 중. 프레임워크 전환은 기존 UI 전체를 다시 짜는 것이라 리스크가 큼. Capability 기반 패널 토글 정도는 Vanilla JS로 충분. Phase 2 진행 중 한계가 오면 그때 재검토.

### 7.2 우선순위 결정

- [x] **Q5**: Phase 0와 3단계(OSS 준비)의 우선순위는?
  - **→ 병행 진행, 단 공개 시점은 Phase 0 이후**
  - 근거: OSS 준비(CI, CONTRIBUTING.md, Docker)는 Phase 0과 충돌하지 않아 병행 가능. 다만 SO-101 전용으로 공개하면 즉시 "내 로봇 지원" 요청 폭주 → 하드코딩 상태에서 임시 대응하게 됨. Phase 0 완료 후 "LeRobot 생태계 전체 지원"이라는 강한 런칭 스토리로 공개.

### 7.3 v2 신규 결정 (문서 분석 기반)

- [x] **Q6**: Robot / Teleoperator / Camera를 단일 레지스트리로 통합할 것인가?
  - **→ 분리 유지 (LeRobot 구조 존중)**
  - 근거: LeRobot이 의도적으로 분리한 구조. Studio에서 합치면 CLI 인자 생성 시 혼란 (`--robot.type` vs `--teleop.type`). DeviceRegistry가 3개를 각각 쿼리하되, API 응답에서 연관 관계(호환 teleop 목록)를 제공.

- [x] **Q7**: 플러그인 지원 시점은?
  - **→ Phase 0부터 기본 지원 (탐색만), Phase 3에서 관리 UI**
  - 근거: `register_third_party_plugins()` 한 줄 호출만으로 플러그인 타입이 `_subclass_registry`에 등록됨. Phase 0의 DeviceRegistry에서 자연스럽게 포함. Phase 3은 "플러그인 작성 가이드" 및 "설치/관리 UI"에 집중.

- [x] **Q8**: CLI 엔트리포인트를 어느 시점부터 새 방식으로 전환할 것인가?
  - **→ Phase 1에서 전환 (command_builders.py 리팩터링 시)**
  - 근거: Phase 0에서는 레지스트리 탐색만 하고 기존 커맨드 빌더를 유지. Phase 1에서 GenericCommandBuilder로 교체 시 새 엔트리포인트(`lerobot-teleoperate` 등) 사용.

---

## 8. 수익화 및 사업화 분석 (Monetization Strategy)

### 8.1 시장 포지셔닝

lestudio가 LeRobot 생태계의 **표준 관리 도구**로 자리잡으면, 로봇 하드웨어 시장의 성장에 따라 자연스러운 수익화 기회가 생긴다.

**현재 시장 상황:**
- 저가 매니퓰레이터 시장이 급성장 중 (SO-100/101, Aloha, GELLO 등)
- LeRobot이 사실상의 표준 프레임워크로 부상
- 하드웨어 키트는 늘어나지만, **통합 관리 소프트웨어는 부재**
- 교육기관, 연구실, 스타트업이 쉬운 설정/관리 도구를 절실히 필요로 함

**전략적 목표:** "생태계 표준 도구" 자리를 먼저 확보 → 수익화는 사용자 기반 확보 후.

### 8.2 수익 모델 후보

#### 모델 A: Open Core (무료 기본 + 유료 프리미엄)

| 구분 | 무료 (Community) | 유료 (Pro/Team) |
|------|-----------------|-----------------|
| 로봇 관리 | ✅ 전체 로봇 타입 지원 | ✅ |
| 텔레옵 / 녹화 | ✅ 기본 기능 | ✅ |
| 캘리브레이션 | ✅ | ✅ |
| 모델 학습 관리 | ✅ 로컬만 | ✅ 클라우드 학습 연동 |
| 다중 로봇 동시 관리 | ❌ | ✅ Fleet 대시보드 |
| 원격 모니터링 | ❌ | ✅ 클라우드 대시보드 |
| 데이터셋 관리 | ✅ 로컬 | ✅ HF Hub 통합 + 팀 공유 |
| 기술 지원 | 커뮤니티 | 이메일/슬랙 우선 지원 |

**핵심:** 무료 버전만으로도 개인 사용자에게 완전한 가치를 제공해야 한다. 유료는 "팀/조직" 기능.

#### 모델 B: 로봇 벤더 파트너십 (B2B)

로봇 하드웨어 제조사와의 파트너십:

| 형태 | 설명 |
|------|------|
| OEM 통합 | 벤더가 Studio를 공식 관리 도구로 채택 → 벤더에게 커스텀 브랜딩/기능 제공 |
| 하드웨어 인증 프로그램 | "Certified for LeStudio" 뱃지 → 벤더로부터 인증비 수취 |
| 커스텀 플러그인 개발 | 벤더 특화 기능을 유료로 개발 |

**대상 벤더 후보:** XLeRobot (Vector-Wangel), Trossen Robotics (Aloha), 기타 SO-100/101 킷 판매자

#### 모델 C: 교육기관 라이선스

| 형태 | 설명 |
|------|------|
| 대학/연구실 사이트 라이선스 | 다중 로봇 Fleet 관리 + 학생 계정 + 실습 모드 |
| 교육 콘텐츠 번들 | Studio + 실습 커리큘럼 + 비디오 교재 |
| LMS 연동 | 학생 진행 상황 트래킹, 과제 자동 평가 |

### 8.3 수익 모델 우선순위 (권장)

```
1순위: Open Core        ← Phase 0-2 완료 후 자연스럽게 진입 가능
2순위: 벤더 파트너십     ← 생태계 표준 지위 확보 후 협상력 확보
3순위: 교육기관 라이선스  ← 시장 규모가 커지면 진입
```

### 8.4 수익화 타임라인

| 시점 | 마일스톤 | 수익화 활동 |
|------|---------|------------|
| Phase 0-1 완료 | 범용 Studio MVP | ❌ 수익화 없음 — 사용자 기반 확보 집중 |
| Phase 2 완료 | 전체 로봇 UI 지원 | 🟡 Pro 기능 분리 시작 (Fleet 관리, 클라우드) |
| OSS 공개 | 커뮤니티 형성 | 🟡 GitHub Sponsors, 벤더 접촉 시작 |
| 사용자 1,000+ | 생태계 표준 확보 | ✅ Open Core 출시, 벤더 파트너십 체결 |
| 사용자 5,000+ | 시장 지배력 | ✅ 교육기관 라이선스, 엔터프라이즈 기능 |

### 8.5 경쟁 환경 및 차별점

| 대안 | 약점 | Studio 차별점 |
|------|------|-------------|
| 터미널 CLI (LeRobot 기본) | 진입장벽 높음, 비개발자 사용 불가 | GUI 기반, 원클릭 설정 |
| ROS2 도구들 (RViz, rqt) | 과도하게 복잡, LeRobot 특화 아님 | LeRobot 네이티브, 경량 |
| 벤더별 자체 도구 | 특정 하드웨어만 지원 | 생태계 전체 지원 범용 도구 |
| 없음 (수동 관리) | 비효율적, 에러 빈발 | 자동화된 워크플로 |

**핵심 차별점:** LeRobot 생태계 전체를 하나의 도구로 관리하는 유일한 솔루션.

### 8.6 사업화 리스크

| 리스크 | 영향 | 완화 방안 |
|--------|------|----------|
| HuggingFace가 공식 Studio를 만들 경우 | 시장 잠식 | 먼저 생태계 표준 확보 + 커뮤니티 충성도 → HF가 인수/제휴 제안 가능 |
| 저가 로봇 시장 성장 둔화 | 사용자 기반 한계 | 교육/연구 시장은 경기 비탄력적, 다각화 |
| 오픈소스 포크 경쟁 | 기능 복제 | Pro 기능 차별화 + 벤더 독점 파트너십 + 개발 속도 우위 |
| LeRobot 프레임워크 방향 전환 | 호환성 깨짐 | 어댑터 패턴 격리 (이미 설계에 반영) |

---

## 9. 참고 자료

### 9.1 코드 위치

| 항목 | 경로 |
|------|------|
| lestudio | `/home/jinhyuk2me/dev_ws/lerobot_ws/lestudio/` |
| LeRobot (공식) | `/home/jinhyuk2me/dev_ws/lerobot_ws/lerobot/` |
| XLeRobot | `/home/jinhyuk2me/dev_ws/lerobot_ws/XLeRobot/` |
| XLeRobot 소프트웨어 | `XLeRobot/software/src/robots/xlerobot/` |

### 9.2 LeRobot 핵심 소스 (분석 완료)

| 항목 | 경로 |
|------|------|
| RobotConfig base | `lerobot/src/lerobot/robots/config.py` |
| TeleoperatorConfig base | `lerobot/src/lerobot/teleoperators/config.py` |
| CameraConfig base | `lerobot/src/lerobot/cameras/configs.py` |
| make_robot_from_config() | `lerobot/src/lerobot/robots/utils.py` |
| register_third_party_plugins() | `lerobot/src/lerobot/utils/import_utils.py` |
| CLI parser (draccus) | `lerobot/src/lerobot/configs/parser.py` |
| SO follower config | `lerobot/src/lerobot/robots/so_follower/config_so_follower.py` |
| LeKiwi config | `lerobot/src/lerobot/robots/lekiwi/config_lekiwi.py` |
| Unitree G1 config | `lerobot/src/lerobot/robots/unitree_g1/config_unitree_g1.py` |
| EarthRover config | `lerobot/src/lerobot/robots/earthrover_mini_plus/config_earthrover_mini_plus.py` |
| OpenArm config | `lerobot/src/lerobot/robots/openarm_follower/config_openarm_follower.py` |
| OMX config | `lerobot/src/lerobot/robots/omx_follower/config_omx_follower.py` |

### 9.3 외부 참고

| 항목 | URL |
|------|-----|
| LeRobot GitHub | https://github.com/huggingface/lerobot |
| LeRobot 공식 문서 | https://huggingface.co/docs/lerobot/index |
| Getting Started (실물 로봇) | https://huggingface.co/docs/lerobot/main/en/getting_started_real_world_robot |
| Bring Your Own Hardware | https://huggingface.co/docs/lerobot/main/en/integrate_hardware |
| Cameras 가이드 | https://huggingface.co/docs/lerobot/main/en/cameras |
| Processor Pipeline | https://huggingface.co/docs/lerobot/main/en/introduction_processors |
| Processors for Robots | https://huggingface.co/docs/lerobot/main/en/processors_robots_teleop |
| Phone Teleop | https://huggingface.co/docs/lerobot/en/phone_teleop |
| SO-101 가이드 | https://huggingface.co/docs/lerobot/en/so101 |
| SO-100 가이드 | https://huggingface.co/docs/lerobot/en/so100 |
| LeKiwi 가이드 | https://huggingface.co/docs/lerobot/main/en/lekiwi |
| Hope Jr 가이드 | https://huggingface.co/docs/lerobot/main/en/hope_jr |
| OMX 가이드 | https://huggingface.co/docs/lerobot/main/en/omx |
| OpenArm 가이드 | https://huggingface.co/docs/lerobot/main/en/openarm |
| Unitree G1 가이드 | https://huggingface.co/docs/lerobot/main/en/unitree_g1 |
| EarthRover 가이드 | https://huggingface.co/docs/lerobot/main/en/earthrover_mini_plus |
| IL for Robots | https://huggingface.co/docs/lerobot/main/en/il_robots |
| Installation | https://huggingface.co/docs/lerobot/main/en/installation |
| XLeRobot | https://github.com/Vector-Wangel/XLeRobot |
| XLeRobot Docs | https://xlerobot.readthedocs.io/ |
