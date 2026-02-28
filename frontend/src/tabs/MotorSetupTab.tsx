import { useCallback, useEffect, useRef, useState } from 'react'
import { Badge, Box, Button, Group, NativeSelect, NumberInput, Paper, Text, Title } from '@mantine/core'
import { ProcessButtons } from '../components/shared/ProcessButtons'
import { getProcessConflict } from '../lib/processConflicts'
import { useProcess } from '../hooks/useProcess'
import { apiGet, apiPost } from '../lib/api'
import { useLeStudioStore } from '../store'
import type { RobotsResponse } from '../lib/types'

interface MotorSetupTabProps {
  active: boolean
}

interface MotorData {
  position: number | null
  load: number | null
  current: number | null
  collision: boolean
}

interface MotorPositionsResponse {
  ok: boolean
  connected: boolean
  positions: Record<string, number | null>
  motors?: Record<string, MotorData>
  freewheel?: boolean
}

interface MotorConnectResponse {
  ok: boolean
  connected_ids?: number[]
  error?: string
}

// Load/Current 임계값 (CheckFeetechMotors 기준)
const LOAD_WARN = 700
const LOAD_DANGER = 1023
const CURRENT_WARN = 560
const CURRENT_DANGER = 800

function loadClass(val: number | null): string {
  if (val === null) return ''
  if (val >= LOAD_DANGER) return 'mon-val-danger'
  if (val >= LOAD_WARN) return 'mon-val-warn'
  return 'mon-val-ok'
}

function currentClass(val: number | null): string {
  if (val === null) return ''
  if (val >= CURRENT_DANGER) return 'mon-val-danger'
  if (val >= CURRENT_WARN) return 'mon-val-warn'
  return 'mon-val-ok'
}

export function MotorSetupTab({ active }: MotorSetupTabProps) {
  // ── Step 1: Motor Setup CLI ────────────────────────────────────────────
  const running = useLeStudioStore((s) => !!s.procStatus.motor_setup)
  const procStatus = useLeStudioStore((s) => s.procStatus)
  const conflictReason = getProcessConflict('motor_setup', procStatus)
  const devices = useLeStudioStore((s) => s.devices)
  const setActiveTab = useLeStudioStore((s) => s.setActiveTab)
  const addToast = useLeStudioStore((s) => s.addToast)
  const appendLog = useLeStudioStore((s) => s.appendLog)
  const clearLog = useLeStudioStore((s) => s.clearLog)
  const { stopProcess } = useProcess()
  const [type, setType] = useState('so101_follower')
  const [port, setPort] = useState('')
  const [hasRun, setHasRun] = useState(false)
  const [armTypes, setArmTypes] = useState<string[]>(['so101_follower', 'so100_follower', 'so101_leader', 'so100_leader'])

  // ── Step 2: Motor Monitor ──────────────────────────────────────────────
  const [monConnected, setMonConnected] = useState(false)
  const [monConnecting, setMonConnecting] = useState(false)
  const [monMotorIds, setMonMotorIds] = useState<number[]>([])
  const [monPositions, setMonPositions] = useState<Record<number, number | null>>({})
  const [monTargets, setMonTargets] = useState<Record<number, number>>({})
  const [monMotors, setMonMotors] = useState<Record<number, MotorData>>({})
  const [monFreewheel, setMonFreewheel] = useState(false)
  const [monError, setMonError] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Step 2 handlers (defined before useEffect that references them) ────
  const handleMonDisconnect = useCallback(async () => {
    await apiPost('/api/motor/disconnect', {})
    setMonConnected(false)
    setMonMotorIds([])
    setMonPositions({})
    setMonMotors({})
    setMonFreewheel(false)
    setMonError('')
  }, [])

  // Fetch available arm types on tab activation
  useEffect(() => {
    if (!active) return
    apiGet<RobotsResponse>('/api/robots').then((r) => {
      const types = r.types ?? ['so101_follower']
      if (types.length > 0) setArmTypes(types)
    })
  }, [active])

  // Auto-select port matching the current arm type keyword (follower/leader)
  useEffect(() => {
    if (devices.arms.length === 0) return
    const keyword = type.includes('follower') ? 'follower' : type.includes('leader') ? 'leader' : ''
    const match = keyword
      ? devices.arms.find((a) => (a.symlink ?? a.device ?? '').toLowerCase().includes(keyword))
      : undefined
    const best = match ?? devices.arms[0]
    setPort(best.path ?? `/dev/${best.device ?? 'ttyUSB0'}`)
  }, [devices.arms, type])

  // Poll motor positions while connected
  useEffect(() => {
    if (!monConnected) {
      if (pollRef.current) clearInterval(pollRef.current)
      return
    }
    pollRef.current = setInterval(async () => {
      const res = await apiGet<MotorPositionsResponse>('/api/motor/positions')
      if (!res.ok || !res.connected) {
        setMonConnected(false)
        setMonMotorIds([])
        setMonPositions({})
        setMonMotors({})
        setMonFreewheel(false)
        return
      }

      // positions (backward compat)
      const pos: Record<number, number | null> = {}
      for (const [id, val] of Object.entries(res.positions)) {
        pos[Number(id)] = val
      }
      setMonPositions(pos)

      // rich motor data (load / current / collision)
      if (res.motors) {
        const motors: Record<number, MotorData> = {}
        for (const [id, data] of Object.entries(res.motors)) {
          motors[Number(id)] = data
        }
        setMonMotors(motors)
      }

      if (res.freewheel !== undefined) setMonFreewheel(res.freewheel)
    }, 100)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [monConnected])

  // Disconnect monitor when tab goes inactive
  useEffect(() => {
    if (!active && monConnected) {
      handleMonDisconnect()
    }
  }, [active, monConnected, handleMonDisconnect])

  // ── Step 1 handlers ────────────────────────────────────────────────────
  const start = async () => {
    clearLog('motor_setup')
    if (!port.startsWith('/dev/')) {
      appendLog('motor_setup', '[ERROR] Port must start with /dev/', 'error')
      return
    }
    const res = await apiPost<{ ok: boolean; error?: string }>('/api/motor_setup/start', { robot_type: type, port })
    if (!res.ok) {
      appendLog('motor_setup', `[ERROR] ${res.error ?? 'failed to start motor setup'}`, 'error')
      return
    }
    addToast('Motor setup started', 'success')
    setHasRun(true)
  }

  const stop = async () => {
    await stopProcess('motor_setup')
    addToast('Motor setup stop requested', 'info')
  }

  // ── Step 2 handlers ────────────────────────────────────────────────────
  const handleMonConnect = async () => {
    if (!port) { setMonError('포트를 먼저 선택하세요.'); return }
    setMonConnecting(true)
    setMonError('')
    const res = await apiPost<MotorConnectResponse>('/api/motor/connect', { port })
    setMonConnecting(false)
    if (!res.ok) {
      setMonError(res.error ?? '연결 실패')
      return
    }
    const ids = res.connected_ids ?? []
    setMonMotorIds(ids)
    setMonTargets(Object.fromEntries(ids.map((id) => [id, 2048])))
    setMonPositions(Object.fromEntries(ids.map((id) => [id, null])))
    setMonMotors(Object.fromEntries(ids.map((id) => [id, { position: null, load: null, current: null, collision: false }])))
    setMonFreewheel(false)
    setMonConnected(true)
    addToast(`Motor monitor connected (${ids.length} motors)`, 'success')
  }

  const handleEmergencyStop = async () => {
    const res = await apiPost<{ ok: boolean; error?: string }>('/api/motor/torque_off', {})
    if (!res.ok) {
      addToast(`Emergency stop failed: ${res.error}`, 'error')
    } else {
      setMonFreewheel(false)
      addToast('Emergency stop — all torque OFF', 'warn')
    }
  }

  const handleFreewheelToggle = async () => {
    if (monFreewheel) {
      const res = await apiPost<{ ok: boolean; error?: string }>('/api/motor/freewheel/exit', {})
      if (!res.ok) { addToast(`Freewheel exit failed: ${res.error}`, 'error'); return }
      setMonFreewheel(false)
      addToast('Freewheel OFF — torque restored', 'info')
    } else {
      const res = await apiPost<{ ok: boolean; error?: string }>('/api/motor/freewheel/enter', {})
      if (!res.ok) { addToast(`Freewheel enter failed: ${res.error}`, 'error'); return }
      setMonFreewheel(true)
      addToast('Freewheel ON — move motors freely by hand', 'info')
    }
  }

  const handleClearCollision = async (id: number) => {
    const res = await apiPost<{ ok: boolean; error?: string }>(`/api/motor/${id}/clear_collision`, {})
    if (!res.ok) {
      addToast(`Clear collision failed: ${res.error}`, 'error')
    } else {
      setMonMotors((prev) => ({ ...prev, [id]: { ...prev[id], collision: false } }))
      addToast(`Motor ${id} collision cleared`, 'info')
    }
  }

  const adjustTarget = (id: number, delta: number) => {
    setMonTargets((prev) => ({
      ...prev,
      [id]: Math.max(0, Math.min(4095, (prev[id] ?? 2048) + delta)),
    }))
  }

  const moveMotor = async (id: number) => {
    const res = await apiPost<{ ok: boolean; error?: string }>(`/api/motor/${id}/move`, {
      position: monTargets[id] ?? 2048,
    })
    if (!res.ok) addToast(`Motor ${id} move failed: ${res.error}`, 'error')
  }

  // ── Render helpers ─────────────────────────────────────────────────────
  const monPortLabel = port
    ? (devices.arms.find((a) => a.path === port || `/dev/${a.device}` === port)?.symlink ?? port)
    : '—'

  return (
    <Box id="tab-motor-setup" className={`tab ${active ? 'active' : ''}`} style={{ display: active ? 'block' : 'none' }}>
      <Group className="section-header" mb="md" align="center">
        <Title order={2}>Motor Setup</Title>
        <Badge variant="light" color={running || (!conflictReason && devices.arms.length > 0) ? 'green' : 'yellow'}>
          {running ? 'Running' : !conflictReason && devices.arms.length > 0 ? 'Ready' : 'Action Needed'}
        </Badge>
      </Group>

      {/* Step 1 blocker */}
      {!running && conflictReason ? (
        <div className="motor-setup-blocker-card">
          <div className="dsub" style={{ marginBottom: 6 }}>Setup blocked:</div>
          <div className="motor-setup-blocker-chip-row">
            <span className="dbadge badge-warn">{conflictReason} process running</span>
          </div>
        </div>
      ) : null}

      <div className="quick-guide">
        <Text size="sm" fw={600} c="dimmed" mb="xs">Motor Setup Guide</Text>
        <p>Assigns unique IDs to each servo motor. Run once per arm — results are saved permanently to the firmware. If the console asks for keyboard input, type in the <strong>global console drawer</strong> at the bottom. After setup, use <strong>Step 2</strong> to verify each motor responds correctly before proceeding to <strong>Calibration</strong>.</p>
      </div>

      {/* ── Step 1: Run CLI ── */}
      <div className="two-col">
        <Paper withBorder p="md" mb="md" className="card">
          <Text size="sm" fw={600} c="dimmed" mb="xs">Step 1: Run Motor Setup</Text>
          <NativeSelect id="motor-role-type" label="Arm Role Type" value={type} onChange={(e) => setType(e.target.value)} data={armTypes.map((item) => ({ value: item, label: item }))} />
          <NativeSelect id="motor-port" label="Arm Port" value={port} onChange={(e) => setPort(e.target.value)} data={devices.arms.length === 0 ? [{ value: port, label: port }] : devices.arms.map((arm, idx) => { const p = arm.path ?? `/dev/${arm.device ?? 'ttyUSB' + idx}`; return { value: p, label: arm.symlink ?? p } })} />
          {!port && devices.arms.length === 0 && (
            <p style={{ color: 'var(--color-warn)', fontSize: '0.85rem', margin: '4px 0 8px' }}>
              No arm port detected. Connect an arm to begin.
            </p>
          )}
          <div className="spacer" />
          <ProcessButtons running={running} onStart={start} onStop={stop} startLabel="▶ Start Setup" conflictReason={conflictReason} />
        </Paper>

        <Paper withBorder p="md" mb="md" className="card">
          <Text size="sm" fw={600} c="dimmed" mb="xs">Connected Arms</Text>
          <div className="device-list">
            {devices.arms.length === 0 ? (
              <div className="device-empty-state">
                <span>No arms detected. Connect a USB arm and click Refresh.</span>
                <div className="device-empty-actions">
                  <Button type="button" className="link-btn" variant="subtle" size="compact-xs" onClick={() => setActiveTab('device-setup')}>→ Open Mapping</Button>
                </div>
              </div>
            ) : (
              devices.arms.map((arm, idx) => (
                <div className="device-item" key={`${arm.device ?? 'arm'}-${idx}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="dot green" />
                    <div className="dname">{arm.symlink ?? arm.device}</div>
                  </div>
                  <div className="dsub">{arm.path}</div>
                </div>
              ))
            )}
          </div>
        </Paper>
      </div>

      {/* ── Step 2: Verify Motors ── */}
      <div className="motor-mon-section">
        <Paper withBorder p="md" mb="md" className="card">
          <Text size="sm" fw={600} c="dimmed" mb="xs">Step 2: Verify Motors</Text>
          <p style={{ fontSize: '0.85rem', color: 'var(--text2)', margin: '0 0 12px' }}>
            Connect directly to the arm to read each motor's live position, load, and current. Use this after Motor Setup to confirm all IDs are correct.
          </p>

          {/* Connect bar */}
          <div className="motor-mon-connect-bar">
            <span style={{ fontSize: '0.85rem', color: 'var(--text2)', whiteSpace: 'nowrap' }}>Port:</span>
            <NativeSelect
              value={port}
              onChange={(e) => setPort(e.target.value)}
              disabled={monConnected || monConnecting}
              style={{ flex: 1, minWidth: 160, maxWidth: 300 }}
              data={devices.arms.length === 0 ? [{ value: port || '—', label: port || '—' }] : devices.arms.map((arm, idx) => { const p = arm.path ?? `/dev/${arm.device ?? 'ttyUSB' + idx}`; return { value: p, label: arm.symlink ?? p } })}
            />

            {!monConnected ? (
              <Button
                type="button"
                className=""
                variant="light"
                size="compact-xs"
                onClick={handleMonConnect}
                disabled={monConnecting || !port || running}
                title={running ? 'Motor Setup is running — stop it first' : ''}
              >
                {monConnecting ? 'Connecting…' : '⚡ Connect'}
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  className={monFreewheel ? 'btn-active' : ''}
                  variant="light"
                  size="compact-xs"
                  onClick={handleFreewheelToggle}
                  title="Freewheel: turn off all torque so you can move motors by hand"
                >
                  {monFreewheel ? '🔓 Freewheel ON' : '🔒 Freewheel'}
                </Button>
                <Button type="button" variant="light" size="compact-xs" onClick={handleMonDisconnect}>
                  Disconnect
                </Button>
                <Button type="button" className="motor-mon-emergency-btn" variant="light" size="compact-xs" onClick={handleEmergencyStop}>
                  ⛔ E-Stop
                </Button>
              </>
            )}

            {monConnected && (
              <div className="motor-mon-status">
                <span className="dot green" style={{ width: 8, height: 8 }} />
                <span>{monPortLabel} · {monMotorIds.length} motor{monMotorIds.length !== 1 ? 's' : ''}</span>
              </div>
            )}
          </div>

          {/* Freewheel mode banner */}
          {monFreewheel && (
            <div className="motor-mon-freewheel-banner">
              🔓 Freewheel mode — all torque OFF. Move motors freely by hand. Position is still live.
            </div>
          )}

          {/* Error */}
          {monError && (
            <p style={{ color: 'var(--red)', fontSize: '0.85rem', margin: '0 0 10px' }}>⚠ {monError}</p>
          )}

          {/* Motor cards */}
          {monConnected && monMotorIds.length > 0 && (
            <div className="motor-mon-cards">
              {monMotorIds.map((id) => {
                const pos = monPositions[id]
                const target = monTargets[id] ?? 2048
                const mdata = monMotors[id]
                const isCollision = mdata?.collision ?? false
                return (
                  <div key={id} className={`motor-mon-card${isCollision ? ' motor-mon-card-collision' : ''}`}>
                    <div className="motor-mon-card-header">
                      <span>Motor {id}</span>
                      {isCollision
                        ? <span className="motor-mon-collision-badge">⚠ Collision</span>
                        : <span className="dot green" style={{ width: 7, height: 7 }} />
                      }
                    </div>

                    {/* Current position */}
                    <div
                      className={`motor-mon-position${pos === null ? ' error' : ''}`}
                      title="Present_Position"
                    >
                      {pos !== null ? pos : 'err'}
                    </div>

                    {/* Load & Current */}
                    <div className="motor-mon-metrics">
                      <span className={`motor-mon-metric ${loadClass(mdata?.load ?? null)}`}>
                        Load: {mdata?.load !== null && mdata?.load !== undefined ? mdata.load : '—'}
                      </span>
                      <span className={`motor-mon-metric ${currentClass(mdata?.current ?? null)}`}>
                        Current: {mdata?.current !== null && mdata?.current !== undefined ? mdata.current : '—'} mA
                      </span>
                    </div>

                    {/* Collision clear button */}
                    {isCollision && (
                      <Button
                        type="button"
                        className="motor-mon-clear-collision-btn"
                        variant="light"
                        size="compact-xs"
                        onClick={() => handleClearCollision(id)}
                      >
                        ✓ Clear Collision
                      </Button>
                    )}

                    {/* Target input + ±10 + Move */}
                    <div className="motor-mon-target-row">
                      <Button
                        type="button"
                        className="motor-mon-step-btn"
                        variant="light"
                        size="compact-xs"
                        onClick={() => adjustTarget(id, -10)}
                        title="-10"
                      >▼</Button>
                      <NumberInput
                        label="Target"
                        min={0}
                        max={4095}
                        value={target}
                        onChange={(value) => {
                          const v = Math.max(0, Math.min(4095, Number(value)))
                          setMonTargets((prev) => ({ ...prev, [id]: v }))
                        }}
                      />
                      <Button
                        type="button"
                        className="motor-mon-step-btn"
                        variant="light"
                        size="compact-xs"
                        onClick={() => adjustTarget(id, 10)}
                        title="+10"
                      >▲</Button>
                    </div>
                    <Button
                      type="button"
                      className="motor-mon-move-btn"
                      variant="light"
                      size="compact-xs"
                      onClick={() => moveMotor(id)}
                      disabled={monFreewheel || isCollision}
                      title={monFreewheel ? 'Exit freewheel first' : isCollision ? 'Clear collision first' : ''}
                    >
                      Move →
                    </Button>
                  </div>
                )
              })}
            </div>
          )}

          {/* Hint when disconnected */}
          {!monConnected && !monConnecting && (
            <p style={{ fontSize: '0.82rem', color: 'var(--text2)', margin: 0 }}>
              {running
                ? '⚠ Motor Setup is running. Stop it before connecting the monitor.'
                : 'Click ⚡ Connect to open the motor monitor on the selected port.'}
            </p>
          )}
        </Paper>
      </div>

      {/* Step 1 completion prompt */}
      {!running && hasRun && (
        <Paper withBorder p="md" mb="md" className="card" style={{ marginTop: 12, textAlign: 'center' }}>
          <p style={{ margin: '0 0 8px', color: 'var(--color-text-secondary)' }}>Motor setup complete? Verify motors above, then continue to calibration.</p>
          <Button type="button" className="link-btn" variant="subtle" size="compact-xs" onClick={() => setActiveTab('calibrate')}>→ Proceed to Calibration</Button>
        </Paper>
      )}
    </Box>
  )
}
