"""Motor Monitor Bridge — 5번째 lerobot 결합 경계 파일.

FeetechMotorsBus를 FastAPI 프로세스 내에서 직접 래핑하여
모터 위치/부하/전류 실시간 읽기 / 이동 / 긴급 정지 / 프리휠을 REST API로 노출한다.

subprocess를 쓰지 않으므로 포트 점유 상태를 동일 프로세스에서 관리할 수 있고,
teleop/record/calibrate 시작 시 명시적으로 disconnect()를 호출해 포트를 반환한다.
"""
from __future__ import annotations

import logging
import threading
from typing import Optional

logger = logging.getLogger(__name__)

try:
    from lerobot.motors.feetech import FeetechMotorsBus, TorqueMode
    from lerobot.motors.motors_bus import Motor, MotorNormMode

    _LEROBOT_AVAILABLE = True
except ImportError:
    FeetechMotorsBus = None  # type: ignore[assignment,misc]
    TorqueMode = None  # type: ignore[assignment]
    Motor = None  # type: ignore[assignment]
    MotorNormMode = None  # type: ignore[assignment]
    _LEROBOT_AVAILABLE = False

# 충돌 감지 기본 임계값 (CheckFeetechMotors 기준)
DEFAULT_LOAD_THRESHOLD = 1023     # Present_Load (0~1023)
DEFAULT_CURRENT_THRESHOLD = 800   # Present_Current (mA)


class MotorMonitorBridge:
    """FeetechMotorsBus를 래핑하는 싱글턴 모터 모니터 브리지.

    FastAPI 프로세스 내에서 연결 상태를 유지하며,
    threading.Lock으로 시리얼 버스 접근을 직렬화한다.

    기능:
    - 실시간 위치/부하/전류 읽기
    - 충돌 감지: 부하 또는 전류가 임계값 초과 시 해당 모터 토크 자동 OFF
    - 프리휠 모드: 전 축 토크 OFF → 손으로 자유 이동 → 종료 시 이전 상태 복구
    """

    def __init__(self) -> None:
        self._bus: Optional[object] = None
        self._motor_ids: list[int] = []
        self._lock = threading.Lock()
        self._connected = False
        self._port: str = ""
        self._model: str = "sts3215"

        # 충돌 감지
        self._load_threshold: int = DEFAULT_LOAD_THRESHOLD
        self._current_threshold: int = DEFAULT_CURRENT_THRESHOLD
        self._collision_detected: dict[int, bool] = {}

        # 프리휠 모드
        self._freewheel: bool = False
        self._prev_torque: dict[int, int] = {}

        # Load/Current 음펬 최적화
        # Position은 매 폴링, Load/Current는 _aux_read_every번에 1번만 읽음
        self._aux_read_counter: int = 0
        self._aux_read_every: int = 5
        self._cached_aux: dict[int, dict] = {}
    # ── 읽기 전용 프로퍼티 ──────────────────────────────────────────────────

    @property
    def connected(self) -> bool:
        return self._connected

    @property
    def port(self) -> str:
        return self._port

    @property
    def motor_ids(self) -> list[int]:
        return list(self._motor_ids)

    @property
    def freewheel(self) -> bool:
        return self._freewheel

    # ── 연결 ───────────────────────────────────────────────────────────────

    def connect(self, port: str, motor_ids: list[int], model: str = "sts3215") -> dict:
        """포트에 연결하고 지정된 모터 ID들을 position 모드로 초기화한다.

        응답한 모터 ID만 connected_ids에 포함된다.
        """
        if not _LEROBOT_AVAILABLE:
            return {"ok": False, "error": "lerobot 라이브러리를 찾을 수 없습니다."}

        with self._lock:
            if self._connected:
                return {
                    "ok": False,
                    "error": f"이미 {self._port}에 연결되어 있습니다. 먼저 연결을 해제하세요.",
                }

            try:
                motors = {
                    f"joint_{mid}": Motor(
                        id=mid,
                        model=model,
                        norm_mode=MotorNormMode.RANGE_0_100,
                    )
                    for mid in motor_ids
                }
                bus = FeetechMotorsBus(port=port, motors=motors)
                bus.connect()

                # 각 모터 초기화; 응답 실패한 ID는 목록에서 제외
                ok_ids: list[int] = []
                for mid in motor_ids:
                    name = f"joint_{mid}"
                    try:
                        self._setup_motor(bus, name)
                        ok_ids.append(mid)
                    except Exception as exc:
                        logger.warning("Motor %d setup failed (skipping): %s", mid, exc)

                if not ok_ids:
                    try:
                        bus.disconnect()
                    except Exception:
                        pass
                    return {"ok": False, "error": "연결된 모터를 찾을 수 없습니다. 전원과 포트를 확인하세요."}

                self._bus = bus
                self._motor_ids = ok_ids
                self._port = port
                self._model = model
                self._connected = True
                self._collision_detected = {mid: False for mid in ok_ids}
                self._freewheel = False
                self._prev_torque = {}
                self._aux_read_counter = 0
                self._cached_aux = {mid: {"load": None, "current": None} for mid in ok_ids}

                return {"ok": True, "connected_ids": ok_ids}

            except Exception as exc:
                return {"ok": False, "error": str(exc)}

    def _setup_motor(self, bus: object, motor_name: str) -> None:
        """모터를 position 모드로 초기화한다.

        motorcheckgui + CheckFeetechMotors의 _setup_motor_runtime() 시퀀스:
          Torque OFF → Lock 해제 → Operating Mode 설정 → 위치 제한 →
          토크 제한 → Minimum_Startup_Force → Profile → Lock → Torque ON
        """
        # 1. 토크 OFF + 잠금 해제
        try:
            bus.write("Torque_Enable", motor_name, TorqueMode.DISABLED.value, normalize=False)
            bus.write("Lock", motor_name, 0, normalize=False)
        except Exception:
            pass

        # 2. 최대 위치 확인
        try:
            model = bus.motors[motor_name].model
            max_pos = bus.model_resolution_table.get(model, 4096) - 1
        except Exception:
            max_pos = 4094

        # 3. Position 모드 설정 + 범위/토크 제한
        try:
            bus.write("Operating_Mode", motor_name, 0, normalize=False)
            bus.write("Min_Position_Limit", motor_name, 0, normalize=False)
            bus.write("Max_Position_Limit", motor_name, max_pos, normalize=False)
            bus.write("Max_Torque_Limit", motor_name, 1023, normalize=False)
            bus.write("Minimum_Startup_Force", motor_name, 50, normalize=False)
        except Exception:
            pass

        # 4. 모션 스무딩 (미지원 모델은 무시)
        try:
            bus.write("Profile_Velocity", motor_name, 300, normalize=False)
            bus.write("Profile_Acceleration", motor_name, 50, normalize=False)
        except Exception:
            pass

        # 5. 잠금 + 토크 ON
        try:
            bus.write("Lock", motor_name, 1, normalize=False)
        except Exception:
            pass
        try:
            bus.write("Torque_Enable", motor_name, TorqueMode.ENABLED.value, normalize=False)
        except Exception:
            pass

    # ── 위치/부하/전류 읽기 + 충돌 감지 ────────────────────────────────────

    def read_positions(self) -> dict:
        """연결된 모든 모터의 위치/부하/전류를 읽고 충돌을 감지한다.

        Position은 매 호출마다 읽고, Load/Current는 _aux_read_every번에 1번만 읽어
        시리얼 트래픽을 줄이고 폴링 주기를 빠르게 유지한다.
        """
        with self._lock:
            if not self._connected or self._bus is None:
                return {"ok": False, "connected": False, "positions": {}, "motors": {}}

            # Load/Current 읽을 차례인지 결정
            self._aux_read_counter += 1
            read_aux = (self._aux_read_counter % self._aux_read_every == 0)

            motors_data: dict[int, dict] = {}
            for mid in self._motor_ids:
                name = f"joint_{mid}"
                cached = self._cached_aux.get(mid, {"load": None, "current": None})
                entry: dict = {
                    "position": None,
                    "load": cached["load"],
                    "current": cached["current"],
                    "collision": self._collision_detected.get(mid, False),
                }

                # 위치 (매 폴링)
                try:
                    entry["position"] = int(self._bus.read("Present_Position", name, normalize=False))
                except Exception as exc:
                    logger.debug("Failed to read position motor %d: %s", mid, exc)

                # 부하/전류 (N번에 1번)
                if read_aux:
                    try:
                        entry["load"] = int(abs(self._bus.read("Present_Load", name, normalize=False)))
                    except Exception:
                        pass
                    try:
                        entry["current"] = int(abs(self._bus.read("Present_Current", name, normalize=False)))
                    except Exception:
                        pass
                    self._cached_aux[mid] = {"load": entry["load"], "current": entry["current"]}

                # 충돌 감지 (프리휠 중에는 스킵, aux 읽은 경우에만 체크)
                if read_aux and not self._freewheel and not self._collision_detected.get(mid, False):
                    load_val = entry["load"] or 0
                    current_val = entry["current"] or 0
                    if load_val > self._load_threshold or current_val > self._current_threshold:
                        logger.warning(
                            "Collision detected on motor %d (load=%d, current=%d)",
                            mid, load_val, current_val,
                        )
                        try:
                            self._bus.write("Torque_Enable", name, TorqueMode.DISABLED.value, normalize=False)
                        except Exception:
                            pass
                        self._collision_detected[mid] = True
                        entry["collision"] = True

                motors_data[mid] = entry

            # 하위 호환: positions 필드도 유지
            positions = {mid: d["position"] for mid, d in motors_data.items()}
            return {
                "ok": True,
                "connected": True,
                "positions": positions,
                "motors": motors_data,
                "freewheel": self._freewheel,
            }

    def set_thresholds(self, load: int, current: int) -> dict:
        """충돌 감지 임계값을 변경한다."""
        self._load_threshold = max(0, load)
        self._current_threshold = max(0, current)
        return {"ok": True, "load_threshold": self._load_threshold, "current_threshold": self._current_threshold}

    def clear_collision(self, motor_id: int) -> dict:
        """지정 모터의 충돌 상태를 초기화하고 토크를 다시 켠다."""
        with self._lock:
            if not self._connected or self._bus is None:
                return {"ok": False, "error": "모터가 연결되어 있지 않습니다."}
            if motor_id not in self._motor_ids:
                return {"ok": False, "error": f"Motor ID {motor_id}가 등록되어 있지 않습니다."}

            self._collision_detected[motor_id] = False
            name = f"joint_{motor_id}"
            try:
                self._bus.write("Torque_Enable", name, TorqueMode.ENABLED.value, normalize=False)
            except Exception as exc:
                return {"ok": False, "error": str(exc)}
            return {"ok": True}

    # ── 프리휠 모드 ─────────────────────────────────────────────────────────

    def freewheel_enter(self) -> dict:
        """프리휠 모드 진입: 이전 토크 상태를 저장하고 전 축 토크 OFF.

        손으로 모터를 자유롭게 이동할 수 있다.
        위치 폴링은 계속 동작한다.
        """
        with self._lock:
            if not self._connected or self._bus is None:
                return {"ok": False, "error": "모터가 연결되어 있지 않습니다."}
            if self._freewheel:
                return {"ok": True, "message": "이미 프리휠 모드입니다."}

            # 현재 토크 상태 저장
            prev: dict[int, int] = {}
            for mid in self._motor_ids:
                name = f"joint_{mid}"
                try:
                    val = int(self._bus.read("Torque_Enable", name, normalize=False))
                    prev[mid] = val
                except Exception:
                    prev[mid] = 1  # 읽기 실패 시 ON 가정

            # 전 축 토크 OFF
            for mid in self._motor_ids:
                name = f"joint_{mid}"
                try:
                    self._bus.write("Torque_Enable", name, TorqueMode.DISABLED.value, normalize=False)
                except Exception:
                    pass

            self._prev_torque = prev
            self._freewheel = True
            return {"ok": True}

    def freewheel_exit(self) -> dict:
        """프리휠 모드 종료: 이전 토크 상태로 복구한다."""
        with self._lock:
            if not self._connected or self._bus is None:
                return {"ok": False, "error": "모터가 연결되어 있지 않습니다."}
            if not self._freewheel:
                return {"ok": True, "message": "프리휠 모드가 아닙니다."}

            for mid in self._motor_ids:
                name = f"joint_{mid}"
                torque_val = self._prev_torque.get(mid, TorqueMode.ENABLED.value)
                try:
                    self._bus.write("Torque_Enable", name, torque_val, normalize=False)
                except Exception:
                    pass

            self._freewheel = False
            self._prev_torque = {}
            return {"ok": True}

    # ── 모터 이동 ──────────────────────────────────────────────────────────

    def move_motor(self, motor_id: int, target_position: int) -> dict:
        """지정 모터를 목표 위치(Goal_Position)로 이동한다.

        충돌 상태이거나 프리휠 중이면 거부한다.
        """
        with self._lock:
            if not self._connected or self._bus is None:
                return {"ok": False, "error": "모터가 연결되어 있지 않습니다."}
            if motor_id not in self._motor_ids:
                return {"ok": False, "error": f"Motor ID {motor_id}가 등록되어 있지 않습니다."}
            if self._freewheel:
                return {"ok": False, "error": "프리휠 모드 중에는 이동 명령을 보낼 수 없습니다."}
            if self._collision_detected.get(motor_id, False):
                return {"ok": False, "error": f"Motor {motor_id}가 충돌 상태입니다. 충돌을 해제한 후 이동하세요."}

            name = f"joint_{motor_id}"
            try:
                self._bus.write("Torque_Enable", name, TorqueMode.ENABLED.value, normalize=False)
                self._bus.write("Goal_Position", name, target_position, normalize=False)
                return {"ok": True}
            except Exception as exc:
                return {"ok": False, "error": str(exc)}

    # ── 긴급 정지 ──────────────────────────────────────────────────────────

    def torque_off(self) -> dict:
        """모든 모터의 토크를 즉시 OFF한다 (긴급 정지).

        프리휠 모드도 함께 해제한다.
        """
        with self._lock:
            if not self._connected or self._bus is None:
                return {"ok": False, "error": "모터가 연결되어 있지 않습니다."}

            self._freewheel = False
            self._prev_torque = {}

            errors: list[str] = []
            for mid in self._motor_ids:
                name = f"joint_{mid}"
                try:
                    self._bus.write("Torque_Enable", name, TorqueMode.DISABLED.value, normalize=False)
                except Exception as exc:
                    errors.append(f"Motor {mid}: {exc}")

            if errors:
                return {"ok": False, "error": "; ".join(errors)}
            return {"ok": True}

    # ── 연결 해제 ──────────────────────────────────────────────────────────

    def disconnect(self) -> dict:
        """모터 연결을 안전하게 해제한다.

        teleop/record/calibrate 시작 시 호출하여 포트를 반환한다.
        이미 연결되어 있지 않으면 no-op으로 처리한다.
        """
        with self._lock:
            if not self._connected or self._bus is None:
                self._connected = False
                return {"ok": True}

            try:
                for mid in self._motor_ids:
                    try:
                        self._bus.write(
                            "Torque_Enable",
                            f"joint_{mid}",
                            TorqueMode.DISABLED.value,
                            normalize=False,
                        )
                    except Exception:
                        pass
                self._bus.disconnect()
            except Exception as exc:
                logger.warning("Motor bridge disconnect error: %s", exc)
            finally:
                self._bus = None
                self._connected = False
                self._motor_ids = []
                self._port = ""
                self._freewheel = False
                self._prev_torque = {}
                self._collision_detected = {}
                self._aux_read_counter = 0
                self._cached_aux = {}

        return {"ok": True}


# ── 모듈 레벨 싱글턴 (_streaming.py의 _streamers 패턴과 동일) ─────────────
_motor_bridge = MotorMonitorBridge()


def get_bridge() -> MotorMonitorBridge:
    """모터 모니터 브리지 싱글턴을 반환한다."""
    return _motor_bridge
