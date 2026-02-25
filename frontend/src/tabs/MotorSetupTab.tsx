import { useEffect, useState } from 'react'
import { ProcessButtons } from '../components/shared/ProcessButtons'
import { getProcessConflict } from '../lib/processConflicts'
import { useProcess } from '../hooks/useProcess'
import { apiGet, apiPost } from '../lib/api'
import { useLeStudioStore } from '../store'
import type { RobotsResponse } from '../lib/types'

interface MotorSetupTabProps {
  active: boolean
}

export function MotorSetupTab({ active }: MotorSetupTabProps) {
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

  return (
    <section id="tab-motor-setup" className={`tab ${active ? 'active' : ''}`}>
      <div className="section-header">
        <h2>Motor Setup</h2>
        <span className={`status-verdict ${running ? 'ready' : !conflictReason && devices.arms.length > 0 ? 'ready' : 'warn'}`}>
          {running ? 'Running' : !conflictReason && devices.arms.length > 0 ? 'Ready' : 'Action Needed'}
        </span>
      </div>
      {!running && conflictReason ? (
        <div className="motor-setup-blocker-card">
          <div className="dsub" style={{ marginBottom: 6 }}>Setup blocked:</div>
          <div className="motor-setup-blocker-chip-row">
            <span className="dbadge badge-warn">{conflictReason} process running</span>
          </div>
        </div>
      ) : null}
      <div className="quick-guide">
        <h3>Motor Setup Guide</h3>
        <p>Assigns unique IDs to each servo motor. Run once per arm — results are saved permanently to the firmware. If the console asks for keyboard input, type in the <strong>global console drawer</strong> at the bottom. After setup, proceed to <strong>Calibration</strong>.</p>
      </div>
      <div className="two-col">
        <div className="card">
          <h3>Step 1: Connect Arm</h3>
          <label htmlFor="motor-role-type">Arm Role Type</label>
          <select id="motor-role-type" value={type} onChange={(e) => setType(e.target.value)}>
            {armTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <label htmlFor="motor-port">Arm Port</label>
          <select id="motor-port" value={port} onChange={(e) => setPort(e.target.value)}>
            {devices.arms.length === 0 ? (
              <option value={port}>{port}</option>
            ) : (
              devices.arms.map((arm, idx) => {
                const p = arm.path ?? `/dev/${arm.device ?? 'ttyUSB' + idx}`
                return <option key={p} value={p}>{arm.symlink ?? p}</option>
              })
            )}
          </select>
          {!port && devices.arms.length === 0 && <p style={{ color: 'var(--color-warn)', fontSize: '0.85rem', margin: '4px 0 8px' }}>No arm port detected. Connect an arm to begin.</p>}
          <div className="spacer" />
          <ProcessButtons running={running} onStart={start} onStop={stop} startLabel="▶ Start Setup" conflictReason={conflictReason} />
        </div>
        <div className="card">
          <h3>Connected Arms</h3>
          <div className="device-list">
            {devices.arms.length === 0 ? (
              <div className="device-empty-state">
                <span>No arms detected. Connect a USB arm and click Refresh.</span>
                <div className="device-empty-actions">
                  <button type="button" className="link-btn" onClick={() => setActiveTab('device-setup')}>→ Open Mapping</button>
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
        </div>
      </div>
      {!running && hasRun && (
        <div className="card" style={{ marginTop: 12, textAlign: 'center' }}>
          <p style={{ margin: '0 0 8px', color: 'var(--color-text-secondary)' }}>Motor setup complete? Continue to calibration.</p>
          <button type="button" className="link-btn" onClick={() => setActiveTab('calibrate')}>→ Proceed to Calibration</button>
        </div>
      )}
    </section>
  )
}
