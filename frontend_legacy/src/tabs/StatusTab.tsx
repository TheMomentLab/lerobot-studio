import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiGet, apiPost } from '../lib/api'
import type { ArmDevice, CameraDevice, DevicesResponse } from '../lib/types'
import { useLeStudioStore } from '../store'

interface StatusTabProps {
  active: boolean
}

interface HistoryEntry {
  type: string
  ts: string
  meta?: Record<string, unknown>
}

interface ResourcesResponse {
  ok?: boolean
  cpu_percent?: number
  memory_percent?: number
  ram_percent?: number
  ram_used_mb?: number
  ram_total_mb?: number
  disk_percent?: number
  disk_used_gb?: number
  disk_total_gb?: number
  lerobot_cache_mb?: number | null
  cache_size_mb?: number | null
}

function asNumber(value: unknown): number | null {
  if (typeof value !== 'number' || Number.isNaN(value)) return null
  return value
}

function clampPercent(value: number | null): number {
  if (value === null) return 0
  return Math.max(0, Math.min(100, value))
}

function pctText(value: number | null): string {
  return value === null ? '--%' : `${value.toFixed(1)}%`
}

function fmtSizeFromMb(value: number | null): string {
  if (value === null) return '--'
  if (value >= 1024) return `${(value / 1024).toFixed(1)} GB`
  return `${value.toFixed(1)} MB`
}

function barSeverityClass(value: number | null): string {
  if (value === null) return ''
  if (value >= 90) return 'danger'
  if (value >= 75) return 'warn'
  return ''
}

function cameraSubtitle(camera: CameraDevice): string {
  const port = camera.kernels?.trim() || '?'
  const model = camera.model?.trim() || 'unknown model'
  return `/dev/${camera.device ?? '?'} · port ${port} · ${model}`
}

function armSubtitle(arm: ArmDevice): string {
  return `/dev/${arm.device ?? '?'}`
}

function summarizeHistoryMeta(meta?: Record<string, unknown>): string {
  if (!meta) return ''
  const parts = Object.entries(meta)
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '')
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${String(value)}`)
  return parts.join(' · ')
}

const HISTORY_TYPE_MAP: Record<string, string> = {
  teleop_start: 'Teleop Started',
  teleop_end: 'Teleop Ended',
  record_start: 'Recording Started',
  record_end: 'Recording Ended',
  calibrate_start: 'Calibration Started',
  calibrate_end: 'Calibration Ended',
  train_start: 'Training Started',
  train_end: 'Training Ended',
  eval_start: 'Eval Started',
  eval_end: 'Eval Ended',
  motor_setup_start: 'Motor Setup Started',
  motor_setup_end: 'Motor Setup Ended',
}

function formatHistoryType(raw: string): string {
  return HISTORY_TYPE_MAP[raw] ?? raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatHistoryTs(raw: string): string {
  try {
    const d = new Date(raw)
    if (Number.isNaN(d.getTime())) return raw
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  } catch { return raw }
}

export function StatusTab({ active }: StatusTabProps) {
  const devices = useLeStudioStore((s) => s.devices)
  const setDevices = useLeStudioStore((s) => s.setDevices)
  const procStatus = useLeStudioStore((s) => s.procStatus)
  const hfUsername = useLeStudioStore((s) => s.hfUsername)
  const addToast = useLeStudioStore((s) => s.addToast)
  const setActiveTab = useLeStudioStore((s) => s.setActiveTab)
  const [resources, setResources] = useState<ResourcesResponse | null>(null)
  const [resourcesError, setResourcesError] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [lastUpdate, setLastUpdate] = useState('')
  const [resourceUpdatedAt, setResourceUpdatedAt] = useState('')
  const [historyExpanded, setHistoryExpanded] = useState(false)

  const refresh = useCallback(async () => {
    const data = await apiGet<DevicesResponse>('/api/devices')
    setDevices({ cameras: data.cameras ?? [], arms: data.arms ?? [] })
    setLastUpdate(new Date().toLocaleTimeString())
  }, [setDevices])

  const refreshResources = useCallback(async () => {
    try {
      const data = await apiGet<ResourcesResponse>('/api/system/resources')
      setResources(data)
      setResourcesError(false)
      setResourceUpdatedAt(new Date().toLocaleTimeString())
    } catch {
      setResourcesError(true)
    }
  }, [])

  const refreshHistory = useCallback(async () => {
    const data = await apiGet<{ ok: boolean; entries: HistoryEntry[] }>('/api/history?limit=50')
    setHistory(Array.isArray(data.entries) ? data.entries : [])
  }, [])

  const refreshAll = useCallback(async () => {
    await Promise.allSettled([refresh(), refreshResources(), refreshHistory()])
  }, [refresh, refreshHistory, refreshResources])

  const clearHistory = useCallback(async () => {
    const confirmed = window.confirm('Clear all session history entries? This cannot be undone.')
    if (!confirmed) return
    await apiPost('/api/history/clear', {})
    addToast('History cleared', 'info')
    await refreshHistory()
  }, [addToast, refreshHistory])

  const runningProcess = useMemo(() => {
    const processOrder: Array<{ key: string; label: string; tab: string }> = [
      { key: 'teleop', label: 'Teleop', tab: 'teleop' },
      { key: 'record', label: 'Record', tab: 'record' },
      { key: 'calibrate', label: 'Calibrate', tab: 'calibrate' },
      { key: 'motor_setup', label: 'Motor Setup', tab: 'motor-setup' },
      { key: 'train', label: 'Train', tab: 'train' },
      { key: 'eval', label: 'Eval', tab: 'eval' },
    ]
    return processOrder.find((proc) => !!procStatus[proc.key]) ?? null
  }, [procStatus])

  const readinessIssues = useMemo(() => {
    const issues: Array<{ id: 'camera' | 'arm' | 'resources' | 'process'; text: string }> = []
    if (devices.cameras.length === 0) issues.push({ id: 'camera', text: 'No camera detected' })
    if (devices.arms.length === 0) issues.push({ id: 'arm', text: 'No arm port detected' })
    if (resourcesError) issues.push({ id: 'resources', text: 'System resources unavailable' })
    if (runningProcess) issues.push({ id: 'process', text: `${runningProcess.label} is running` })
    return issues
  }, [devices.arms.length, devices.cameras.length, resourcesError, runningProcess])

  const readyForOperation = readinessIssues.length === 0

  useEffect(() => {
    if (!active) return
    refreshAll()
    const rId = window.setInterval(refreshResources, 5000)
    const hId = window.setInterval(refreshHistory, 30000)
    return () => {
      window.clearInterval(rId)
      window.clearInterval(hId)
    }
  }, [active, refreshAll, refreshHistory, refreshResources])

  useEffect(() => {
    if (!active || resources !== null) return
    const timeoutId = window.setTimeout(() => {
      setResourcesError(true)
    }, 10000)
    return () => window.clearTimeout(timeoutId)
  }, [active, resources])

  return (
    <section id="tab-status" className={`tab ${active ? 'active' : ''}`}>
      <div className="section-header">
        <h2>System Status</h2>
        <span className={`status-verdict ${readyForOperation ? 'ready' : 'warn'}`}>
          {readyForOperation ? 'Ready' : 'Action Needed'}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <span id="status-last-update" style={{ fontSize: 11, color: 'var(--text2)' }}>
            {lastUpdate ? `Last updated: ${lastUpdate}` : ''}
          </span>
          <button id="status-refresh-btn" onClick={refreshAll} className="btn-sm">
            ↺ Refresh All
          </button>
        </div>
      </div>

      {!readyForOperation ? (
        <div className="status-issues">
          <div className="status-issues-list">
            {readinessIssues.map((issue) => (
              <span key={issue.id} className="status-issue-chip">{issue.text}</span>
            ))}
          </div>
          <div className="status-issues-actions">
            {(devices.cameras.length === 0 || devices.arms.length === 0) ? (
              <button type="button" className="link-btn" onClick={() => setActiveTab('device-setup')}>
                → Open Mapping
              </button>
            ) : null}
            {runningProcess ? (
              <button type="button" className="link-btn" onClick={() => setActiveTab(runningProcess.tab)}>
                → Open {runningProcess.label}
              </button>
            ) : null}
            {resourcesError ? (
              <button type="button" className="link-btn" onClick={() => void refreshResources()}>
                → Retry Resources
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {readyForOperation ? (
        <div className="status-ready-banner">
          <div className="dsub">All core checks passed. Continue with device mapping verification or start teleop.</div>
          <div className="status-ready-actions">
            <button type="button" className="link-btn" onClick={() => setActiveTab('device-setup')}>→ Open Mapping</button>
            <button type="button" className="link-btn" onClick={() => setActiveTab('teleop')}>→ Proceed to Teleop</button>
          </div>
        </div>
      ) : null}

      <div className="status-grid">
        <div className="card">
          <h3>🤗 Hugging Face Auth</h3>
          <div className="device-list">
            <div className="device-item" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div className="dname">Hub Login</div>
                <div className="dsub">Required for Hub push/download in Dataset tab</div>
              </div>
              <span className={`dbadge ${hfUsername ? 'badge-ok' : 'badge-warn'}`}>
                {hfUsername ? hfUsername : 'Not Logged In'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" className="link-btn" onClick={() => setActiveTab('dataset')}>
                → Open Dataset Auth
              </button>
            </div>
          </div>
        </div>

        <div className="card">
          <h3>📷 Cameras</h3>
          <div id="status-cameras" className="device-list">
            {devices.cameras.length === 0 ? (
              <div className="device-empty-note">
                <span>No cameras detected. Connect a USB camera and click <strong>Refresh</strong>. Then map it in the Mapping tab.</span>
              </div>
            ) : (
              devices.cameras.map((camera, idx) => (
                <div className="device-item" key={`${camera.device ?? 'cam'}-${idx}`}>
                  <span className={`dot ${camera.symlink ? 'green' : 'yellow'}`} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="dname">{camera.symlink ?? camera.device ?? 'unknown'}</div>
                    <div className="dsub">{cameraSubtitle(camera)}</div>
                  </div>
                  <span className={`dbadge ${camera.symlink ? 'badge-ok' : 'badge-warn'}`}>
                    {camera.symlink ? 'linked' : 'no link'}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="card">
          <h3>🦾 Arm Ports</h3>
          <div id="status-arms" className="device-list">
            {devices.arms.length === 0 ? (
              <div className="device-empty-note">
                <span>No arm ports detected. Connect an arm via USB and click <strong>Refresh</strong>. Then map it in the Mapping tab.</span>
              </div>
            ) : (
              devices.arms.map((arm, idx) => (
                <div className="device-item" key={`${arm.device ?? 'arm'}-${idx}`}>
                  <span className={`dot ${arm.symlink ? 'green' : 'yellow'}`} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="dname">{arm.symlink ?? arm.device ?? 'unknown'}</div>
                    <div className="dsub">{armSubtitle(arm)}</div>
                  </div>
                  <span className={`dbadge ${arm.symlink ? 'badge-ok' : 'badge-warn'}`}>
                    {arm.symlink ? 'linked' : 'no link'}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="card">
          <h3>⚡ Processes</h3>
          <div id="status-procs" className="device-list">
            {[
              { key: 'teleop', label: 'Teleop' },
              { key: 'record', label: 'Record' },
              { key: 'calibrate', label: 'Calibrate' },
              { key: 'motor_setup', label: 'Motor Setup' },
              { key: 'train', label: 'Train' },
              { key: 'eval', label: 'Eval' },
            ].map(({ key, label }) => {
              const running = !!procStatus[key]
              return (
                <div className="device-item" key={key}>
                  <span className={`dot ${running ? 'green pulse' : 'gray'}`} />
                  <div className="dname">{label}</div>
                  <span className={`dbadge ${running ? 'badge-run' : 'badge-idle'}`}>{running ? 'running' : 'idle'}</span>
                </div>
              )
            })}
          </div>
        </div>

        <div className="card">
          <h3>🖥️ System Resources</h3>
          {resourceUpdatedAt ? <div className="dsub" style={{ marginBottom: 6 }}>Updated: {resourceUpdatedAt}</div> : null}
          <div id="status-resources" className="device-list">
            {!resources ? (
              resourcesError ? (
                <div className="device-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'var(--red)', fontSize: 12 }}>Failed to load system resources</span>
                  <button className="btn-xs" onClick={refreshResources}>Retry</button>
                </div>
              ) : (
                <div className="device-item">Loading…</div>
              )
            ) : (
              <>
                <div className="device-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 2 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="dname">CPU</span>
                    <span className="dsub">{pctText(asNumber(resources.cpu_percent))}</span>
                  </div>
                  <div className="usb-bus-bar-track">
                    <div
                      className={`usb-bar-fill ${barSeverityClass(asNumber(resources.cpu_percent))}`.trim()}
                      style={{ width: `${clampPercent(asNumber(resources.cpu_percent))}%` }}
                      role="progressbar"
                      aria-label="CPU usage"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={asNumber(resources.cpu_percent) ?? undefined}
                      aria-valuetext={pctText(asNumber(resources.cpu_percent))}
                      title={`CPU ${pctText(asNumber(resources.cpu_percent))}`}
                    />
                  </div>
                </div>

                <div className="device-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 2 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="dname">RAM</span>
                    <span className="dsub">{(() => {
                      const usedMb = asNumber(resources.ram_used_mb)
                      const totalMb = asNumber(resources.ram_total_mb)
                      if (usedMb !== null && totalMb !== null) return `${fmtSizeFromMb(usedMb)} / ${fmtSizeFromMb(totalMb)}`
                      return pctText(asNumber(resources.memory_percent ?? resources.ram_percent))
                    })()}</span>
                  </div>
                  <div className="usb-bus-bar-track">
                    <div
                      className={`usb-bar-fill ${barSeverityClass(asNumber(resources.memory_percent ?? resources.ram_percent))}`.trim()}
                      style={{ width: `${clampPercent(asNumber(resources.memory_percent ?? resources.ram_percent))}%` }}
                      role="progressbar"
                      aria-label="RAM usage"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={asNumber(resources.memory_percent ?? resources.ram_percent) ?? undefined}
                      aria-valuetext={pctText(asNumber(resources.memory_percent ?? resources.ram_percent))}
                      title={`RAM ${pctText(asNumber(resources.memory_percent ?? resources.ram_percent))}`}
                    />
                  </div>
                </div>

                <div className="device-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 2 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="dname">Disk (home)</span>
                    <span className="dsub">{`${String(resources.disk_used_gb ?? '--')} / ${String(resources.disk_total_gb ?? '--')} GB`}</span>
                  </div>
                  <div className="usb-bus-bar-track">
                    <div
                      className={`usb-bar-fill ${barSeverityClass(asNumber(resources.disk_percent))}`.trim()}
                      style={{ width: `${clampPercent(asNumber(resources.disk_percent))}%` }}
                      role="progressbar"
                      aria-label="Disk usage"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={asNumber(resources.disk_percent) ?? undefined}
                      aria-valuetext={pctText(asNumber(resources.disk_percent))}
                      title={`Disk ${pctText(asNumber(resources.disk_percent))}`}
                    />
                  </div>
                </div>

                <div className="device-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div className="dname">LeRobot Cache</div>
                    <div className="dsub">~/.cache/huggingface/lerobot</div>
                  </div>
                  <span className="dsub">{fmtSizeFromMb(asNumber(resources.lerobot_cache_mb ?? resources.cache_size_mb ?? null))}</span>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <h3 style={{ margin: 0 }}>📋 Session History</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button className="btn-xs" onClick={() => setHistoryExpanded((prev) => !prev)}>{historyExpanded ? 'Collapse' : 'Expand'}</button>
              <button className="btn-sm" onClick={clearHistory} style={{ fontSize: 10, color: 'var(--red)', borderColor: 'color-mix(in srgb, var(--red) 40%, var(--border))' }}>
                Clear
              </button>
            </div>
          </div>
          <div id="status-history" className="device-list" style={{ maxHeight: historyExpanded ? 420 : 220, overflowY: 'auto' }}>
            {history.length === 0 ? (
              <div className="device-item">No session events yet. Start calibration, recording, training, or eval to see history here.</div>
            ) : (
              [...history].reverse().map((entry, idx) => {
                const metaSummary = summarizeHistoryMeta(entry.meta)
                return (
                  <div className="device-item" key={`${entry.ts}-${idx}`}>
                    <div>
                      <div className="dname">{formatHistoryType(entry.type)}</div>
                      <div className="dsub">{formatHistoryTs(entry.ts)}</div>
                      {metaSummary ? <div className="dsub">{metaSummary}</div> : null}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
