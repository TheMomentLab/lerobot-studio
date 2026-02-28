# Phase 1 Design: Generic Command Builder & Dynamic UI

> Status: Design (pre-implementation)  
> Depends on: Phase 0 완료

---

## 구현 반영 상태 (읽기 가이드)

- 이 문서는 **Phase 1 목표 설계 문서**이며, 구현 완료 상태를 직접 보증하지 않는다.
- 최신 구현 상태는 [`private/roadmap.md`](./private/roadmap.md)에서 확인한다.
- 문서 내용과 실제 코드가 다르면 코드와 로드맵을 기준으로 해석한다.

---

## 현재 상태 (Phase 0 이후)

```
Frontend: buildConfig() → { robot_type, teleop_type, follower_port, leader_port, ... }
Server:   /api/teleop/start  → data["robot_type"] 읽음
          /api/record/start  → 동일 흐름
          /api/eval/start    → env_type / task 자동 추론 + camera config 생성
Builder:  build_teleop_args()  → robot_mode=="bi" 분기만, so101 하드코딩 (미개선)
          build_record_args()  → 동일 (미개선)
          build_eval_args()   → ✅ 전면 재작성 완료 (env_type/task 추론, gym_manipulator 카메라)
```

**Phase 0 → Phase 1 갭 요약**:
- `build_teleop_args()` / `build_record_args()` 는 여전히 SO-101 하드코딩. Phase 1a 대상.
- `build_eval_args()` 는 Phase 0에서 전면 재작성됨 (env_type 추론, camera config 자동 생성, checkpoint 경로 유효성 검증 포함). 이 패턴을 Phase 1a에서 teleop/record에도 확산 예정.
- `GenericCommandBuilder` 클래스 설계는 아직 미구현. 현재는 함수 기반 빌더 유지.
---

## Phase 1 범위

### Phase 1a — Backend Command Builder 리팩터 (낮은 리스크)
> `command_builders.py`, `device_registry.py` 수정만. UI 변경 없음.

**결과**: SO-100, Koch, OMX, OpenArm 등 모든 serial arm 로봇이 즉시 동작.

### Phase 1b — Frontend 동적 필드 (중간 리스크)
> `frontend/src/tabs/TeleopTab.tsx`, `frontend/src/tabs/RecordTab.tsx` 및 관련 컴포넌트 수정.

**결과**: LeKiwi (remote_ip), keyboard/gamepad (포트 없음) 등 비-serial 로봇 지원.

---

## Robot Family 분류

### Robot Families

| Family | Robot Types | 필요 CLI 필드 |
|--------|-------------|---------------|
| `single_arm` | so101_follower, so100_follower, koch_follower, omx_follower, openarm_follower, hope_jr_arm, hope_jr_hand | `--robot.type`, `--robot.port`, `--robot.id` |
| `bi_arm` | bi_so_follower, bi_openarm_follower | `--robot.type`, `--robot.left_arm_config.port`, `--robot.right_arm_config.port` |
| `mobile_server` | lekiwi | `--robot.type`, `--robot.id` (로봇 자체에서 실행) |
| `mobile_client` | lekiwi_client | `--robot.type`, `--robot.remote_ip` |
| `full_body` | unitree_g1, reachy2 | `--robot.type`, `--robot.id` (SDK 자체 연결) |
| `mobile_ground` | earthrover_mini_plus | `--robot.type` (미정) |

### Teleop Families

| Family | Teleop Types | 필요 CLI 필드 |
|--------|--------------|---------------|
| `single_arm_leader` | so101_leader, so100_leader, koch_leader, omx_leader, openarm_leader, homunculus_glove, homunculus_arm | `--teleop.type`, `--teleop.port`, `--teleop.id` |
| `bi_arm_leader` | bi_so_leader, bi_openarm_leader | `--teleop.type`, `--teleop.left_arm_config.port`, `--teleop.right_arm_config.port` |
| `input_device` | keyboard, keyboard_ee, keyboard_rover, gamepad, phone | `--teleop.type` (포트 없음) |
| `full_body_teleop` | reachy2_teleoperator, unitree_g1 | `--teleop.type` |

---

## Phase 1a: Backend 설계

### 1. `device_registry.py` 추가

```python
# 추가할 상수
ROBOT_FAMILY_MAP: dict[str, str] = {
    "so101_follower":        "single_arm",
    "so100_follower":        "single_arm",
    "koch_follower":         "single_arm",
    "omx_follower":          "single_arm",
    "openarm_follower":      "single_arm",
    "hope_jr_arm":           "single_arm",
    "hope_jr_hand":          "single_arm",
    "bi_so_follower":        "bi_arm",
    "bi_openarm_follower":   "bi_arm",
    "lekiwi":                "mobile_server",
    "lekiwi_client":         "mobile_client",
    "unitree_g1":            "full_body",
    "reachy2":               "full_body",
    "earthrover_mini_plus":  "mobile_ground",
}

TELEOP_FAMILY_MAP: dict[str, str] = {
    "so101_leader":          "single_arm_leader",
    "so100_leader":          "single_arm_leader",
    "koch_leader":           "single_arm_leader",
    "omx_leader":            "single_arm_leader",
    "openarm_leader":        "single_arm_leader",
    "bi_openarm_leader":     "single_arm_leader",  # single port variant
    "homunculus_glove":      "single_arm_leader",
    "homunculus_arm":        "single_arm_leader",
    "bi_so_leader":          "bi_arm_leader",
    "keyboard":              "input_device",
    "keyboard_ee":           "input_device",
    "keyboard_rover":        "input_device",
    "gamepad":               "input_device",
    "phone":                 "input_device",
    "reachy2_teleoperator":  "full_body_teleop",
    "unitree_g1":            "full_body_teleop",
}

# 추가할 함수
def get_robot_family(robot_type: str) -> str:
    return ROBOT_FAMILY_MAP.get(robot_type, "single_arm")  # unknown → single_arm fallback

def get_teleop_family(teleop_type: str) -> str:
    return TELEOP_FAMILY_MAP.get(teleop_type, "single_arm_leader")  # unknown → single_arm_leader fallback
```

### 2. `command_builders.py` 리팩터

현재 구조:
```
build_teleop_args(python_exe, cfg)
  └─ if robot_mode == "bi" → bi_so_follower 하드코딩
  └─ else → so101_follower 하드코딩
```

신규 구조:
```
build_teleop_args(python_exe, cfg)
  ├─ robot_type = cfg["robot_type"]  (또는 fallback so101)
  ├─ teleop_type = cfg["teleop_type"] (또는 fallback so101_leader)
  ├─ _build_robot_cli_args(robot_type, cfg)
  │    ├─ single_arm   → --robot.type=X --robot.port=P --robot.id=I
  │    ├─ bi_arm       → --robot.type=X --robot.left_arm_config.port=P ...
  │    ├─ mobile_client → --robot.type=X --robot.remote_ip=IP
  │    ├─ mobile_server → --robot.type=X --robot.id=I
  │    └─ full_body    → --robot.type=X --robot.id=I (optional)
  └─ _build_teleop_cli_args(teleop_type, cfg)
       ├─ single_arm_leader → --teleop.type=X --teleop.port=P --teleop.id=I
       ├─ bi_arm_leader     → --teleop.type=X --teleop.left_arm_config.port=P ...
       └─ input_device      → --teleop.type=X (포트 없음)
```

**구체적인 코드:**

```python
from lestudio import device_registry

def _build_robot_cli_args(robot_type: str, cfg: dict) -> list[str]:
    family = device_registry.get_robot_family(robot_type)
    if family == "bi_arm":
        return [
            f"--robot.type={robot_type}",
            f"--robot.left_arm_config.port={cfg.get('left_follower_port', '')}",
            f"--robot.right_arm_config.port={cfg.get('right_follower_port', '')}",
        ]
    if family == "mobile_client":
        return [
            f"--robot.type={robot_type}",
            f"--robot.remote_ip={cfg.get('remote_ip', '')}",
        ]
    if family in ("mobile_server", "full_body", "mobile_ground"):
        args = [f"--robot.type={robot_type}"]
        if cfg.get("robot_id"):
            args.append(f"--robot.id={cfg['robot_id']}")
        return args
    # single_arm (default)
    args = [
        f"--robot.type={robot_type}",
        f"--robot.port={cfg.get('follower_port', '')}",
    ]
    if cfg.get("robot_id"):
        args.append(f"--robot.id={cfg['robot_id']}")
    return args


def _build_teleop_cli_args(teleop_type: str, cfg: dict) -> list[str]:
    family = device_registry.get_teleop_family(teleop_type)
    if family == "input_device":
        return [f"--teleop.type={teleop_type}"]
    if family == "bi_arm_leader":
        return [
            f"--teleop.type={teleop_type}",
            f"--teleop.left_arm_config.port={cfg.get('left_leader_port', '')}",
            f"--teleop.right_arm_config.port={cfg.get('right_leader_port', '')}",
        ]
    if family == "full_body_teleop":
        return [f"--teleop.type={teleop_type}"]
    # single_arm_leader (default)
    args = [
        f"--teleop.type={teleop_type}",
        f"--teleop.port={cfg.get('leader_port', '')}",
    ]
    if cfg.get("teleop_id"):
        args.append(f"--teleop.id={cfg['teleop_id']}")
    return args


def build_teleop_args(python_exe: str, cfg: dict) -> list[str]:
    robot_type  = cfg.get("robot_type",  "so101_follower")
    teleop_type = cfg.get("teleop_type", "so101_leader")
    return (
        [python_exe, "-m", "lestudio.teleop_bridge", "--display_data=false"]
        + _build_robot_cli_args(robot_type, cfg)
        + _build_teleop_cli_args(teleop_type, cfg)
    )


def build_record_args(python_exe: str, cfg: dict, resume_enabled: bool) -> list[str]:
    robot_type  = cfg.get("robot_type",  "so101_follower")
    teleop_type = cfg.get("teleop_type", "so101_leader")
    family = device_registry.get_robot_family(robot_type)

    base = [
        f'--dataset.repo_id={cfg.get("record_repo_id", "user/dataset")}',
        f'--dataset.num_episodes={cfg.get("record_episodes", 50)}',
        f'--dataset.single_task={cfg.get("record_task", "task")}',
        "--display_data=false",
        "--dataset.vcodec=h264",
    ]
    if resume_enabled:
        base.append("--resume=true")

    # 카메라: bi_arm 계열은 left_arm_config에 붙임
    cameras = _build_camera_args(cfg, family)
    base.extend(cameras)

    return (
        [python_exe, "-m", "lestudio.record_bridge"]
        + _build_robot_cli_args(robot_type, cfg)
        + _build_teleop_cli_args(teleop_type, cfg)
        + base
    )
```

### 3. `server.py` 변경 (최소)

현재 line 1028-1045의 `robot_mode` 기반 검증을 `robot_type` family 기반으로 교체.

```python
# Before
mode = data.get("robot_mode", "single")
if mode == "bi":
    check_calibration(...)  # bi arm 검증

# After
robot_type  = data.get("robot_type", "so101_follower")
teleop_type = data.get("teleop_type", "so101_leader")
family = device_registry.get_robot_family(robot_type)
if family == "bi_arm":
    check_calibration(robot_type, data.get("left_robot_id", ""), "Left follower calibration")
    check_calibration(robot_type, data.get("right_robot_id", ""), "Right follower calibration")
    check_calibration(teleop_type, data.get("left_teleop_id", ""), "Left leader calibration")
    check_calibration(teleop_type, data.get("right_teleop_id", ""), "Right leader calibration")
elif family == "single_arm":
    check_calibration(robot_type, data.get("robot_id", ""), "Follower calibration")
    check_calibration(teleop_type, data.get("teleop_id", ""), "Leader calibration")
# mobile_client, full_body 등은 calibration 불필요 → skip
```

---

## Phase 1b: Frontend 동적 필드 설계 (React 컴포넌트)

### 추가 필드 (TeleopTab.tsx 조건부 렌더링)
```tsx
{/* LeKiwi, mobile_client 전용 — capabilities 기반 조건부 렌더링 */}
{family === 'mobile_client' && (
  <div className="field-group">
    <label htmlFor="remote-ip">Remote IP</label>
    <input id="remote-ip" value={config.remoteIp} onChange={...} placeholder="192.168.1.100" />
  </div>
)}
```

### 필드 가시성 로직 (React 조건부 렌더링)

`robot_type` 변경 시 Zustand 스토어 업데이트 → 컴포넌트 리렌더링:
1. `useConfig` 훅에서 `/api/robots/{robot_type}/family` 호출
2. family 값에 따라 JSX 조건부 렌더링

```tsx
// TeleopTab.tsx 내부
const { config, setConfig } = useStore();
const [family, setFamily] = useState('single_arm');

useEffect(() => {
  fetch(`/api/robots/${config.robotType}/family`)
    .then(r => r.json())
    .then(data => setFamily(data.family || 'single_arm'));
}, [config.robotType]);

return (
  <>
    {family === 'single_arm' && <SingleArmFields />}
    {family === 'bi_arm' && <BiArmFields />}
    {family === 'mobile_client' && <RemoteIpField />}
    <TeleopTypeSelector robotType={config.robotType} />
  </>
);
```

### 검증 업데이트 (React + useProcess 훅)

`useProcess` 훅에서 실행 전 validation을 family 기반으로 수행:
```tsx
// hooks/useProcess.ts 내부 validateConfig()
function validateConfig(config: TeleopConfig, family: string): string[] {
  const errors: string[] = [];
  if (family === 'single_arm') {
    if (!config.followerPort?.startsWith('/dev/')) errors.push('Follower port required');
    if (!config.leaderPort?.startsWith('/dev/'))   errors.push('Leader port required');
  } else if (family === 'bi_arm') {
    // bi arm 포트 검증
  } else if (family === 'mobile_client') {
    if (!config.remoteIp) errors.push('Remote IP is required');
  }
  return errors;
}
```

### 신규 API 엔드포인트 (server.py)
```
GET /api/robots/{robot_type}/family
→ { "family": "single_arm" }
```

---

## 하위 호환성 보장

| 시나리오 | 동작 |
|---------|------|
| cfg에 robot_type 없음 | `"so101_follower"` fallback |
| cfg에 teleop_type 없음 | `"so101_leader"` fallback |
| 알 수 없는 robot_type | `"single_arm"` family fallback |
| robot_mode="bi" (구 방식) | Phase 1a에서는 아직 허용 (Phase 1b에서 제거) |

---

## 구현 순서

```
Phase 1a (Backend only):
  1. device_registry.py: ROBOT_FAMILY_MAP, TELEOP_FAMILY_MAP, get_robot_family(), get_teleop_family() 추가
  2. command_builders.py: build_teleop_args(), build_record_args() 리팩터
  3. server.py: teleop preflight 검증을 family 기반으로 교체
  ─────────────────────────────────────────────────
  검증: SO-101 teleop/record 기존 동작 유지 확인

Phase 1b (Frontend dynamic fields — React 컴포넌트):
  4. server.py: GET /api/robots/{robot_type}/family 엔드포인트 추가
  5. frontend/src/tabs/TeleopTab.tsx: family 기반 조건부 렌더링 + 검증
  6. frontend/src/tabs/RecordTab.tsx: 동일 패턴
  7. frontend/src/components/shared/: 공유 필드 컴포넌트 (RemoteIpField, BiArmFields 등)
  ─────────────────────────────────────────────────
  검증: LeKiwi remote_ip 필드 표시, keyboard teleop 포트 필드 숨김
```

---

## 파일별 변경 요약

| 파일 | Phase 1a | Phase 1b |
|------|----------|----------|
| `device_registry.py` | FAMILY_MAP + 2 함수 추가 | - |
| `command_builders.py` | `build_teleop_args`, `build_record_args` 전면 재작성 | - |
| `server.py` | preflight 검증 교체 | `/family` 엔드포인트 추가 |
| `frontend/src/tabs/TeleopTab.tsx` | - | family 기반 조건부 렌더링, validation 교체 |
| `frontend/src/tabs/RecordTab.tsx` | - | 동일 패턴 |
| `frontend/src/components/shared/` | - | RemoteIpField, BiArmFields 등 공유 컴포넌트 |

---

## Phase 2 경계

Phase 1에서 다루지 않는 것 (Phase 2로):
- LeKiwi 서버 사이드 실행 (lekiwi 타입은 로봇에서 직접 실행)
- Unitree G1 / Reachy2 전용 연결 관리 (SDK 레이어)
- EarthRover 지원 (스펙 미확정)
 React 전환 완료 — 추가 프레임워크 전환 불필요
