# Phase 0~1 개요 설계 (Overview Design)

최종 갱신: 2026-02-23
상태: 초안 (Draft)
상위 문서: [`ecosystem-integration-plan.md`](ecosystem-integration-plan.md)

---

## 1. 모듈 책임 맵

### 1.1 신규 모듈

```
src/lestudio/
├── device_registry.py    (Phase 0) ← LeRobot 접점 #4
├── connection.py          (Phase 1)
├── command_builders.py    (Phase 1 — 기존 파일 리팩터링)
├── server.py              (Phase 0+1 — API 추가, 하드코딩 제거)
└── static/                (Phase 0+1 — 선택기 UI 추가)
```

| 모듈 | Phase | 책임 | LeRobot import |
|------|-------|------|:--------------:|
| `device_registry.py` | 0 | 3-Registry 쿼리, config schema 추출, capabilities 추론, 호환 teleop 매핑 | ✅ (격리) |
| `server.py` (API 추가) | 0 | `/api/robots`, `/api/teleops`, `/api/cameras` 엔드포인트, ROBOT_TYPES 동적화 | ❌ |
| `static/` (선택기) | 0 | Robot/Teleoperator 분리 선택 드롭다운, 정보 카드 | ❌ |
| `command_builders.py` | 1 | GenericCommandBuilder — config dict → CLI args, 새 엔트리포인트 | ❌ |
| `connection.py` | 1 | Serial/CAN/ZMQ/Cloud 연결 확인, 디바이스 탐색 | ❌ |

### 1.2 기존 모듈 변경 범위

| 기존 모듈 | Phase | 변경 내용 |
|----------|-------|----------|
| `server.py` | 0 | `ROBOT_TYPES` → `registry.get_robot_types()`, 신규 API 3개 추가, `check_calibration()` 동적화 |
| `server.py` | 1 | `get_arms()` → `connection.discover_devices()`, preflight 동적화 |
| `command_builders.py` | 1 | 4개 빌더 함수 → `GenericCommandBuilder` 클래스로 통합 |
| `static/workbench_teleop.js` | 0 | 로봇/텔레옵 타입 하드코딩 → API에서 동적 로드 |
| `static/workbench_record.js` | 0 | 동일 |

---

## 2. 데이터 흐름

### 2.1 Phase 0: 로봇 타입 탐색 → UI 렌더링

```
                                                    LeRobot Framework
                                                    ┌─────────────────┐
                                                    │ RobotConfig     │
                                                    │  ._subclass_    │
                                                    │   registry      │
                                                    │ TeleoperatorCfg │
                                                    │  ._subclass_    │
                                                    │   registry      │
                                                    │ CameraCfg       │
                                                    │  ._subclass_    │
                                                    │   registry      │
                                                    └───────┬─────────┘
                                                            │
 Browser                    FastAPI                device_registry.py
┌──────────┐          ┌──────────────┐           ┌──────────┴──────────┐
│          │          │              │           │                     │
│ 1. 페이지 │─GET ────→│ /api/robots  │──────────→│ get_robot_types()   │
│    로드   │  /api/   │              │           │ + get_capabilities()│
│          │ robots   │              │           │ + compatible_teleops│
│          │←─JSON────│              │←──────────│                     │
│          │          │              │           └─────────────────────┘
│ 2. Robot │          │              │
│    선택   │─GET ────→│ /api/robots/ │──────────→ get_config_schema(
│          │  {type}/ │  {type}/     │             "robot", type)
│          │  schema  │  schema      │
│          │←─JSON────│              │←────────── JSON Schema
│          │          │              │
│ 3. Teleop│─GET ────→│ /api/teleops │──────────→ get_teleop_types()
│    선택   │          │              │             filtered by robot
│          │←─JSON────│              │←──────────
│          │          │              │
│ 4. 설정  │          │              │
│    폼 렌더│ (schema  │              │
│    링    │  기반)   │              │
│          │          │              │
│ 5. 실행  │─POST ───→│ /api/teleop  │──────────→ CommandBuilder
│ (teleop) │ config   │ /api/record  │             .build_args()
│          │          │              │──────────→ subprocess.run()
└──────────┘          └──────────────┘
```

### 2.2 Phase 1: 디바이스 탐색 + CLI 실행

```
 Browser                    FastAPI              connection.py       command_builders.py
┌──────────┐          ┌──────────────┐       ┌───────────────┐    ┌──────────────────┐
│          │          │              │       │               │    │                  │
│ 디바이스  │─GET ────→│/api/devices  │──────→│ discover_     │    │                  │
│ 탐색     │          │              │       │  devices()    │    │                  │
│          │←─JSON────│              │←──────│ [Serial,CAN,  │    │                  │
│          │          │              │       │  ZMQ,Cloud]   │    │                  │
│          │          │              │       └───────────────┘    │                  │
│          │          │              │                            │                  │
│ Preflight│─POST ───→│/api/preflight│──────→ check_connection() │                  │
│ 체크     │          │              │       + get_preflight_     │                  │
│          │←─JSON────│              │         checks()          │                  │
│          │          │              │                            │                  │
│          │          │              │                            │                  │
│ 실행     │─POST ───→│/api/teleop   │───────────────────────────→│ build_args(      │
│ (teleop) │  {robot_ │              │                            │   action,        │
│          │   config,│              │                            │   robot_config,  │
│          │   teleop_│              │                            │   teleop_config) │
│          │   config}│              │←───────────────────────────│ → ["lerobot-     │
│          │          │              │  args list                 │    teleoperate", │
│          │          │              │──→ subprocess.Popen(args)  │    "--robot.type  │
│          │          │              │                            │     =so101_..."] │
└──────────┘          └──────────────┘                            └──────────────────┘
```

---

## 3. 핵심 인터페이스

### 3.1 DeviceRegistry (Phase 0)

```python
from dataclasses import dataclass

@dataclass
class RobotCapabilities:
    has_arms: bool = False
    has_wheels: bool = False
    is_remote: bool = False        # ZMQ/Cloud — 네트워크 연결 필요
    is_dual_arm: bool = False
    has_cameras: bool = False
    has_keyboard_teleop: bool = False
    protocol: str = "serial"       # "serial" | "can" | "zmq" | "cloud" | "sdk"

@dataclass
class DeviceTypeInfo:
    name: str                      # 등록된 type 문자열 (e.g., "so101_follower")
    category: str                  # "robot" | "teleop" | "camera"
    config_class_name: str         # "SOFollowerRobotConfig"
    is_plugin: bool                # 서드파티 플러그인 여부

class DeviceRegistry:
    """싱글톤. 앱 시작 시 한 번 초기화."""

    # --- 초기화 ---
    def initialize(self) -> bool:
        """LeRobot 레지스트리를 import하고 캐시.
        Returns: True=정상 로드, False=폴백 사용 중
        """

    @property
    def is_fallback(self) -> bool:
        """폴백 모드 여부 (LeRobot import 실패)"""

    # --- 타입 목록 조회 ---
    def get_robot_types(self) -> list[DeviceTypeInfo]: ...
    def get_teleop_types(self) -> list[DeviceTypeInfo]: ...
    def get_camera_types(self) -> list[DeviceTypeInfo]: ...

    # --- 상세 정보 ---
    def get_config_schema(self, category: str, type_name: str) -> dict:
        """dataclass fields → JSON Schema 변환.
        {
            "port": {"type": "string", "required": true, "default": null, "description": "Serial port"},
            "cameras": {"type": "camera_dict", "required": false, "default": {}},
            "id": {"type": "string", "required": false, "default": null},
            ...
        }
        """

    def get_capabilities(self, robot_type: str) -> RobotCapabilities:
        """capabilities 추론 (하이브리드 방식 — 아래 3.2 참조)"""

    def get_compatible_teleops(self, robot_type: str) -> list[str]:
        """호환 teleop 목록 (정적 매핑 — 아래 3.3 참조)"""

    def get_default_config(self, category: str, type_name: str) -> dict:
        """해당 타입의 기본 config 값을 dict로 반환.
        dataclass 인스턴스를 기본값으로 생성 → asdict()
        """
```

### 3.2 Capabilities 추론 전략 (하이브리드)

```python
# 전략: 알려진 타입은 정적 메타데이터, 미지 타입은 config 필드에서 추론

# 1단계: 알려진 타입의 정적 메타데이터
KNOWN_CAPABILITIES: dict[str, RobotCapabilities] = {
    "so101_follower": RobotCapabilities(has_arms=True, has_cameras=True, protocol="serial"),
    "so100_follower": RobotCapabilities(has_arms=True, has_cameras=True, protocol="serial"),
    "lekiwi_client":  RobotCapabilities(has_arms=True, has_wheels=True, is_remote=True,
                                         has_cameras=True, has_keyboard_teleop=True, protocol="zmq"),
    "unitree_g1":     RobotCapabilities(has_arms=True, has_wheels=True, is_remote=True,
                                         has_cameras=True, is_dual_arm=True, protocol="zmq"),
    "earthrover_mini_plus": RobotCapabilities(has_wheels=True, has_cameras=True, protocol="cloud"),
    # ... 14종 전부
}

# 2단계: 미지 타입 (플러그인 등) — config 필드에서 추론
def _infer_capabilities(config_cls) -> RobotCapabilities:
    field_names = {f.name for f in dataclasses.fields(config_cls)}
    return RobotCapabilities(
        has_arms="port" in field_names,
        has_wheels="teleop_keys" in field_names,
        is_remote="remote_ip" in field_names,
        is_dual_arm="port2" in field_names or "bi_" in config_cls.__name__.lower(),
        has_cameras="cameras" in field_names,
        has_keyboard_teleop="teleop_keys" in field_names,
        protocol="zmq" if "remote_ip" in field_names else "serial",
    )

# 조회 시:
def get_capabilities(self, robot_type: str) -> RobotCapabilities:
    if robot_type in KNOWN_CAPABILITIES:
        return KNOWN_CAPABILITIES[robot_type]
    config_cls = self._robot_types.get(robot_type)
    if config_cls:
        return _infer_capabilities(config_cls)
    return RobotCapabilities()  # 전부 False
```

**트레이드오프**: 정적 메타데이터는 정확하지만 새 로봇 추가 시 업데이트 필요. 추론은 자동이지만 부정확할 수 있음. 하이브리드가 최선의 균형점.

### 3.3 호환 Teleoperator 매핑 (정적)

```python
# LeRobot에 프로그래밍적 매핑이 없음 → 정적 유지 필수
COMPATIBLE_TELEOPS: dict[str, list[str]] = {
    "so101_follower":       ["so101_leader", "keyboard", "keyboard_ee", "gamepad", "phone"],
    "so100_follower":       ["so100_leader", "keyboard", "keyboard_ee", "gamepad", "phone"],
    "bi_so_follower":       ["bi_so_leader"],
    "lekiwi_client":        ["so101_leader", "keyboard"],
    "koch_follower":        ["koch_leader", "keyboard", "keyboard_ee", "gamepad"],
    "omx_follower":         ["omx_leader", "keyboard", "keyboard_ee", "gamepad"],
    "openarm_follower":     ["openarm_leader"],
    "bi_openarm_follower":  ["bi_openarm_leader"],
    "hope_jr_hand":         ["homunculus_glove"],
    "hope_jr_arm":          ["homunculus_arm"],
    "unitree_g1":           ["unitree_g1"],
    "reachy2":              ["reachy2_teleoperator"],
    "earthrover_mini_plus": ["keyboard_rover"],
}

# 미지 Robot 타입 → 범용 teleop만 제안
DEFAULT_TELEOPS = ["keyboard", "keyboard_ee", "gamepad"]
```

### 3.4 GenericCommandBuilder (Phase 1)

```python
class GenericCommandBuilder:
    """config dict → CLI 인자 리스트"""

    ENTRY_POINTS = {
        "teleop":      "lerobot-teleoperate",
        "record":      "lerobot-record",
        "calibrate":   "lerobot-calibrate",
        "motor_setup": "lerobot-setup-motors",
        "train":       "lerobot-train",
        "eval":        "lerobot-eval",
    }

    def build_args(
        self,
        action: str,
        robot_config: dict,                    # {"type": "so101_follower", "port": "...", ...}
        teleop_config: dict | None = None,     # {"type": "so101_leader", "port": "...", ...}
        dataset_config: dict | None = None,    # {"repo_id": "...", "num_episodes": 2, ...}
        extra_args: dict | None = None,        # {"display_data": "true", ...}
    ) -> list[str]:
        args = [self.ENTRY_POINTS[action]]

        # --robot.{key}={value}
        args.extend(self._flatten_config("robot", robot_config))

        # --teleop.{key}={value}
        if teleop_config:
            args.extend(self._flatten_config("teleop", teleop_config))

        # --dataset.{key}={value}
        if dataset_config:
            args.extend(self._flatten_config("dataset", dataset_config))

        # --{key}={value}
        if extra_args:
            for k, v in extra_args.items():
                args.append(f"--{k}={v}")

        return args

    def _flatten_config(self, prefix: str, config: dict) -> list[str]:
        """config dict를 --prefix.key=value 인자들로 변환.
        cameras dict는 인라인 YAML로 직렬화.
        """
        args = []
        for key, value in config.items():
            if key == "cameras" and isinstance(value, dict):
                args.append(f"--{prefix}.cameras={self._cameras_to_yaml(value)}")
            elif value is not None:
                args.append(f"--{prefix}.{key}={value}")
        return args

    def _cameras_to_yaml(self, cameras: dict) -> str:
        """{"front": {"type": "opencv", "index_or_path": 0, ...}}
        → '{ front: {type: opencv, index_or_path: 0, ...}}'
        """
        ...
```

### 3.5 ConnectionAdapter (Phase 1)

```python
from enum import Enum

class ConnectionStatus(Enum):
    CONNECTED = "connected"
    UNREACHABLE = "unreachable"
    PERMISSION_DENIED = "permission_denied"
    NOT_FOUND = "not_found"

@dataclass
class DeviceInfo:
    path: str                    # "/dev/ttyUSB0" or "192.168.1.100:5555"
    protocol: str                # "serial" | "can" | "zmq" | "cloud"
    description: str             # "USB Serial Device (cp210x)"
    metadata: dict = field(default_factory=dict)  # vendor_id, product_id, etc.

class ConnectionAdapter(ABC):
    @abstractmethod
    def discover_devices(self) -> list[DeviceInfo]: ...

    @abstractmethod
    def check_connection(self, config: dict) -> ConnectionStatus: ...

    @abstractmethod
    def get_preflight_checks(self, config: dict) -> list[PreflightCheck]: ...

# --- 구현체 ---

class SerialConnectionAdapter(ConnectionAdapter):
    """SO-100/101, Koch, OMX, Hope Jr 등 — /dev/ttyUSB*, /dev/ttyACM* 탐색"""

    def discover_devices(self) -> list[DeviceInfo]:
        # 기존 server.py의 get_arms() 로직 래핑
        # + lerobot-find-port 연동 (선택)
        ...

    def check_connection(self, config: dict) -> ConnectionStatus:
        port = config.get("port")
        if not port:
            return ConnectionStatus.NOT_FOUND
        if not Path(port).exists():
            return ConnectionStatus.NOT_FOUND
        if not os.access(port, os.R_OK | os.W_OK):
            return ConnectionStatus.PERMISSION_DENIED
        return ConnectionStatus.CONNECTED

class CANConnectionAdapter(ConnectionAdapter):
    """OpenArm — CAN 인터페이스 탐색"""
    # ip link show type can + lerobot-setup-can 연동
    ...

class ZMQConnectionAdapter(ConnectionAdapter):
    """LeKiwi, XLeRobot, Unitree G1 — IP:port 연결 확인"""

    def discover_devices(self) -> list[DeviceInfo]:
        return []  # 수동 IP 입력 (Phase 0 결정)

    def check_connection(self, config: dict) -> ConnectionStatus:
        ip = config.get("remote_ip")
        port = config.get("port_zmq_cmd", 5555)
        # Quick TCP connect test (zmq or raw socket)
        ...

class CloudConnectionAdapter(ConnectionAdapter):
    """EarthRover — API 키 검증"""
    ...

# --- 팩토리 ---

def get_adapter(protocol: str) -> ConnectionAdapter:
    return {
        "serial": SerialConnectionAdapter(),
        "can":    CANConnectionAdapter(),
        "zmq":    ZMQConnectionAdapter(),
        "cloud":  CloudConnectionAdapter(),
    }.get(protocol, SerialConnectionAdapter())
```

---

## 4. API Contract

### 4.1 GET `/api/robots` (Phase 0)

```json
{
    "registry_available": true,
    "types": [
        {
            "name": "so101_follower",
            "config_class": "SOFollowerRobotConfig",
            "is_plugin": false,
            "capabilities": {
                "has_arms": true,
                "has_wheels": false,
                "is_remote": false,
                "is_dual_arm": false,
                "has_cameras": true,
                "has_keyboard_teleop": false,
                "protocol": "serial"
            },
            "compatible_teleops": ["so101_leader", "keyboard", "keyboard_ee", "gamepad", "phone"],
            "config_schema": {
                "type":    {"py_type": "str",  "required": false, "default": "so101_follower"},
                "port":    {"py_type": "str",  "required": true,  "default": null},
                "id":      {"py_type": "str",  "required": false, "default": null},
                "cameras": {"py_type": "dict", "required": false, "default": {}},
                "use_degrees": {"py_type": "bool", "required": false, "default": true}
            }
        },
        {
            "name": "lekiwi_client",
            "config_class": "LeKiwiClientConfig",
            "is_plugin": false,
            "capabilities": {
                "has_arms": true,
                "has_wheels": true,
                "is_remote": true,
                "is_dual_arm": false,
                "has_cameras": true,
                "has_keyboard_teleop": true,
                "protocol": "zmq"
            },
            "compatible_teleops": ["so101_leader", "keyboard"],
            "config_schema": {
                "remote_ip": {"py_type": "str", "required": true, "default": null},
                "port_zmq_cmd": {"py_type": "int", "required": false, "default": 5555},
                "port_zmq_observations": {"py_type": "int", "required": false, "default": 5556},
                "id": {"py_type": "str", "required": false, "default": null},
                "teleop_keys": {"py_type": "dict", "required": false, "default": {"forward":"w","backward":"s"}}
            }
        }
    ]
}
```

### 4.2 GET `/api/teleops` (Phase 0)

```json
{
    "types": [
        {
            "name": "so101_leader",
            "config_class": "SOLeaderTeleoperatorConfig",
            "is_plugin": false,
            "input_type": "physical_arm",
            "config_schema": {
                "port": {"py_type": "str", "required": true, "default": null},
                "id":   {"py_type": "str", "required": false, "default": null}
            }
        },
        {
            "name": "keyboard",
            "config_class": "KeyboardConfig",
            "is_plugin": false,
            "input_type": "keyboard",
            "config_schema": {}
        }
    ]
}
```

### 4.3 GET `/api/cameras` (Phase 0)

```json
{
    "types": [
        {
            "name": "opencv",
            "config_class": "OpenCVCameraConfig",
            "config_schema": {
                "index_or_path": {"py_type": "int|path", "required": true, "default": null},
                "fps": {"py_type": "int", "required": false, "default": null},
                "width": {"py_type": "int", "required": false, "default": null},
                "height": {"py_type": "int", "required": false, "default": null},
                "rotation": {"py_type": "enum", "required": false, "default": 0,
                              "options": [0, 90, 180, -90]}
            }
        }
    ]
}
```

### 4.4 GET `/api/devices` (Phase 1)

```json
{
    "serial": [
        {"path": "/dev/ttyUSB0", "description": "CP210x UART Bridge", "metadata": {"vendor_id": "10c4"}},
        {"path": "/dev/ttyACM0", "description": "STM32 Virtual COM Port", "metadata": {}}
    ],
    "can": [],
    "zmq": [],
    "cloud": []
}
```

### 4.5 POST `/api/teleop` (Phase 1 리팩터링)

```json
// Request
{
    "robot_config": {
        "type": "so101_follower",
        "port": "/dev/ttyUSB0",
        "id": "my_robot",
        "cameras": {
            "front": {"type": "opencv", "index_or_path": 0, "fps": 30, "width": 640, "height": 480}
        }
    },
    "teleop_config": {
        "type": "so101_leader",
        "port": "/dev/ttyUSB1",
        "id": "my_leader"
    },
    "extra_args": {
        "display_data": "true"
    }
}

// → GenericCommandBuilder가 생성하는 CLI:
// lerobot-teleoperate \
//   --robot.type=so101_follower --robot.port=/dev/ttyUSB0 --robot.id=my_robot \
//   --robot.cameras="{ front: {type: opencv, index_or_path: 0, fps: 30, ...}}" \
//   --teleop.type=so101_leader --teleop.port=/dev/ttyUSB1 --teleop.id=my_leader \
//   --display_data=true
```

---

## 5. 마이그레이션 전략 (SO-101 호환성)

### 5.1 원칙

> Phase 0~1 완료 후에도 **기존 SO-101 사용자는 아무것도 바뀌지 않은 것처럼** 사용할 수 있어야 한다.

### 5.2 기본값 유지

```python
# server.py
DEFAULT_ROBOT_TYPE = "so101_follower"
DEFAULT_TELEOP_TYPE = "so101_leader"

# 로봇 타입 미선택 시 → so101_follower
# 텔레옵 타입 미선택 시 → so101_leader
```

### 5.3 기존 프로필 JSON 호환

기존 프로필 JSON 형식:
```json
{
    "follower_port": "/dev/ttyUSB0",
    "leader_port": "/dev/ttyUSB1",
    "single_arm_mode": true,
    "cameras": { ... }
}
```

마이그레이션 전략:
```python
def load_profile(profile_data: dict) -> tuple[dict, dict]:
    """기존 프로필 → (robot_config, teleop_config) 변환"""

    # 새 형식 (robot_config + teleop_config 분리)
    if "robot_config" in profile_data:
        return profile_data["robot_config"], profile_data.get("teleop_config")

    # 기존 형식 → 자동 변환
    robot_config = {
        "type": profile_data.get("robot_type", "so101_follower"),
        "port": profile_data.get("follower_port"),
        "cameras": profile_data.get("cameras", {}),
    }
    teleop_config = {
        "type": profile_data.get("teleop_type", "so101_leader"),
        "port": profile_data.get("leader_port"),
    }
    return robot_config, teleop_config
```

### 5.4 UI 마이그레이션

```
기존 UI:                              신규 UI:
┌─────────────────────┐               ┌─────────────────────┐
│ Robot: [SO-101 ▼]   │               │ Robot: [SO-101 ▼]   │  ← 기본값 유지
│ Port:  [/dev/...]   │               │ Port:  [/dev/...]   │
│                     │               │                     │
│ Leader Port: [...]  │    →          │ Teleop: [SO-101 ▼]  │  ← 새로 분리됨
│                     │               │ Port:   [/dev/...]  │
│                     │               │                     │
│ Single Arm Mode [✓] │               │ (capabilities 패널)  │  ← 점진적 추가
└─────────────────────┘               └─────────────────────┘
```

- SO-101 사용자에게는 "Teleop" 드롭다운이 추가된 것만 시각적 차이
- 기본값이 `so101_leader`로 설정되어 있으므로 추가 조작 불필요

### 5.5 Calibration 경로 호환

```python
# 기존: 하드코딩
check_calibration("so_follower", robot_id)  # ~/.cache/.../calibration/robots/so_follower/{id}.json

# 신규: 동적 (LeRobot 표준 경로)
check_calibration(robot_type, robot_id)     # ~/.cache/.../calibration/robots/{type}/{id}.json
check_calibration(teleop_type, teleop_id)   # ~/.cache/.../calibration/teleoperators/{type}/{id}.json
```

기존 SO-101 캘리브레이션 파일 경로가 `so_follower/`에 있으므로,
`so101_follower` → `so_follower` 경로 매핑 호환 레이어 필요 (또는 LeRobot이 내부적으로 처리하는지 확인).

---

## 6. 열린 설계 질문

### Q9: Config Schema에서 복합 타입을 어떻게 처리할 것인가?

LeRobot config에는 `dict[str, CameraConfig]`, `str | None`, `float | dict[str, float]` 같은 복합 타입이 있다.

**선택지:**
- **A: 핵심 필드만 노출** — `port`, `id`, `cameras`, `remote_ip` 등 "사용자가 반드시 설정해야 하는" 필드만 UI에 노출. 나머지는 Advanced 패널 또는 raw JSON 편집.
- **B: 전체 필드를 JSON Schema로 변환** — 모든 타입을 JSON Schema로 정확히 매핑. 구현 복잡도 높음.

### Q10: capabilities의 진실의 원천은?

**선택지:**
- **A: 정적 메타데이터 우선 (현재 설계)** — 알려진 14종은 정적, 플러그인은 추론. 정확하지만 유지보수 필요.
- **B: config 필드 추론만** — 전부 자동. 부정확할 수 있으나 유지보수 불필요.
- **C: LeRobot에 capabilities API 기여** — 가장 이상적이지만 upstream PR 필요.

### Q11: 기존 command_builders.py와의 공존 기간은?

Phase 1에서 GenericCommandBuilder로 전환할 때:
- **A: 빅뱅 교체** — 기존 4개 빌더 함수를 한 번에 제거하고 GenericCommandBuilder로 대체.
- **B: 병행 운영** — GenericCommandBuilder를 먼저 추가하고, 기존 빌더는 fallback으로 유지. 충분히 검증 후 제거.

### Q12: Frontend에서 config 폼을 어떻게 렌더링할 것인가?

**선택지:**
- **A: Schema-driven 동적 렌더링** — JSON Schema를 파싱하여 `<input>` 요소를 동적 생성. 완전히 범용이지만 UX가 다소 generic.
- **B: 타입별 템플릿 + 동적 fallback** — 알려진 타입(SO-101, LeKiwi 등)은 수동 제작한 예쁜 폼, 미지 타입은 Schema 기반 동적 폼. UX 최적이지만 유지보수 추가.

---

## 7. 구현 순서 제안

```
Phase 0 (7~10일 예상)
├── Step 0.1: device_registry.py 구현 (3일)
│   ├── 3-Registry 쿼리 + 플러그인 발견
│   ├── config schema 추출 (핵심 필드만)
│   ├── capabilities 정적 메타데이터 + 추론 fallback
│   ├── 호환 teleop 정적 매핑
│   └── import 실패 시 폴백 로직
│
├── Step 0.2: server.py API 추가 (2일)
│   ├── GET /api/robots, /api/teleops, /api/cameras
│   ├── ROBOT_TYPES 동적화
│   └── check_calibration() 동적화
│
└── Step 0.3: Frontend 선택기 (2~3일)
    ├── Robot 드롭다운 + 정보 카드
    ├── Teleoperator 드롭다운 (robot 선택 시 필터링)
    └── 기존 UI와 통합 (workbench_teleop.js, workbench_record.js)

Phase 1 (10~14일 예상)
├── Step 1.1: GenericCommandBuilder (3일)
│   ├── config dict → CLI args 변환
│   ├── cameras dict → YAML 직렬화
│   ├── 새 CLI 엔트리포인트 사용
│   └── 기존 빌더 함수와 병행 (fallback)
│
├── Step 1.2: ConnectionAdapter (4일)
│   ├── SerialConnectionAdapter (기존 get_arms() 래핑)
│   ├── ZMQConnectionAdapter (IP:port 연결 확인)
│   ├── CANConnectionAdapter (CAN 인터페이스 탐색)
│   ├── CloudConnectionAdapter (API 키 검증)
│   └── get_adapter() 팩토리
│
├── Step 1.3: server.py 통합 (2~3일)
│   ├── GET /api/devices (통합 디바이스 탐색)
│   ├── POST /api/teleop, /api/record 리팩터링
│   ├── preflight 일반화
│   └── calibration 경로 동적화
│
└── Step 1.4: 기존 빌더 deprecate + 테스트 (1~2일)
```

---

## 8. 파일별 변경 요약

| 파일 | Phase | 변경 유형 | 변경 내용 |
|------|-------|----------|----------|
| `device_registry.py` | 0 | **신규** | 3-Registry 쿼리, schema, capabilities, teleop 매핑 |
| `server.py` | 0 | 수정 | API 3개 추가, ROBOT_TYPES 동적화, calibration 동적화 |
| `static/workbench_teleop.js` | 0 | 수정 | Robot/Teleop 선택기 → API 연동 |
| `static/workbench_record.js` | 0 | 수정 | 동일 |
| `command_builders.py` | 1 | 수정 | GenericCommandBuilder 추가, 기존 함수 deprecate |
| `connection.py` | 1 | **신규** | 4종 ConnectionAdapter |
| `server.py` | 1 | 수정 | /api/devices, preflight 일반화, teleop/record API 리팩터링 |
