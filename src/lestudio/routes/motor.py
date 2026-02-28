"""Motor monitor routes.

포트에 직접 연결해 모터 위치/부하/전류를 실시간으로 읽고,
목표 위치 이동 / 긴급 정지 / 충돌 해제 / 프리휘 모드 / 연결 해제를 제공한다.

모든 핸들러는 blocking serial I/O 때문에 동기(def)로 작성한다.
FastAPI는 sync 핸들러를 자동으로 스레드풀에서 실행한다.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter

from lestudio.motor_monitor_bridge import get_bridge
from lestudio.routes._state import AppState

logger = logging.getLogger(__name__)

# 포트를 점유하는 프로세스 목록 — 모터 모니터 연결 전 충돌 검사에 사용
_ARM_PROCESSES = ("teleop", "record", "calibrate", "motor_setup")


def create_router(state: AppState) -> APIRouter:
    router = APIRouter(prefix="/api/motor", tags=["motor"])
    bridge = get_bridge()

    # ── 연결 ─────────────────────────────────────────────────────────────

    @router.post("/connect")
    def api_motor_connect(data: dict):
        """포트에 연결하고 모터를 초기화한다.

        body: { port, motor_ids?, model? }
          - motor_ids: 시도할 ID 리스트 (기본값: [1,2,3,4,5,6])
          - model: 모터 모델명 (기본값: "sts3215")
        response: { ok, connected_ids } or { ok, error }
        """
        port = data.get("port", "")
        if not port:
            return {"ok": False, "error": "port is required"}

        motor_ids: list[int] = data.get("motor_ids") or list(range(1, 7))
        model: str = data.get("model") or "sts3215"

        # 팔 포트를 점유하는 프로세스가 실행 중이면 거부
        running = [p for p in _ARM_PROCESSES if state.proc_mgr.is_running(p)]
        if running:
            return {
                "ok": False,
                "error": f"포트를 사용 중인 프로세스가 있습니다: {', '.join(running)}. 먼저 중지하세요.",
            }

        return bridge.connect(port, motor_ids, model)

    # ── 위치 폴링 ─────────────────────────────────────────────────────────

    @router.get("/positions")
    def api_motor_positions():
        """연결된 모든 모터의 현재 위치를 반환한다.

        프론트엔드에서 ~300 ms 간격으로 폴링한다.
        response: { ok, connected, positions: { motor_id: position | null } }
        """
        return bridge.read_positions()

    # ── 모터 이동 ─────────────────────────────────────────────────────────

    @router.post("/{motor_id}/move")
    def api_motor_move(motor_id: int, data: dict):
        """지정 모터를 목표 위치로 이동한다.

        body: { position: 0-4095 }
        response: { ok } or { ok, error }
        """
        raw = data.get("position")
        if raw is None:
            return {"ok": False, "error": "position is required"}
        position = max(0, min(int(raw), 4095))
        return bridge.move_motor(motor_id, position)

    # ── 긴급 정지 ─────────────────────────────────────────────────────────

    @router.post("/torque_off")
    def api_motor_torque_off():
        """모든 모터의 토크를 즉시 OFF한다 (긴급 정지).

        response: { ok } or { ok, error }
        """
        return bridge.torque_off()

    # ── 충돌 해제 ────────────────────────────────────────────────

    @router.post("/{motor_id}/clear_collision")
    def api_motor_clear_collision(motor_id: int):
        """지정 모터의 충돌 상태를 초기화하고 토크를 다시 켠다.

        response: { ok } or { ok, error }
        """
        return bridge.clear_collision(motor_id)

    # ── 프리휘 모드 ───────────────────────────────────────────────

    @router.post("/freewheel/enter")
    def api_motor_freewheel_enter():
        """프리휠 모드 진입: 전 축 토크 OFF, 손으로 자유 이동 가능.

        response: { ok } or { ok, error }
        """
        return bridge.freewheel_enter()

    @router.post("/freewheel/exit")
    def api_motor_freewheel_exit():
        """프리휠 모드 종료: 이전 토크 상태로 복구.

        response: { ok } or { ok, error }
        """
        return bridge.freewheel_exit()

    # ── 연결 해제 ───────────────────────────────────────────────

    @router.post("/disconnect")
    def api_motor_disconnect():
        """모터 연결을 해제하고 포트를 반환한다.

        response: { ok }
        """
        return bridge.disconnect()

    return router
