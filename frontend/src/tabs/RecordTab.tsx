import { useEffect, useMemo, useRef, useState } from 'react'
import { formatRobotType } from '../lib/format'
import { MappedCameraRows } from '../components/shared/MappedCameraRows'
import { RobotCapabilitiesCard } from '../components/shared/RobotCapabilitiesCard'
import { useConfig } from '../hooks/useConfig'
import { useMappedCameras } from '../hooks/useMappedCameras'
import { useProcess } from '../hooks/useProcess'
import { apiGet, apiPost } from '../lib/api'
import { useLeStudioStore } from '../store'
import type { LogLine, RobotDetail, RobotsResponse, TeleopsResponse } from '../lib/types'
import { getProcessConflict } from '../lib/processConflicts'


interface RecordTabProps {
  active: boolean
}

const EMPTY_RECORD_LINES: LogLine[] = []

const REPO_ID_REGEX = /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/
const DEFAULT_FOLLOWER_PORTS = ['/dev/follower_arm_1', '/dev/follower_arm_2']
const DEFAULT_LEADER_PORTS = ['/dev/leader_arm_1', '/dev/leader_arm_2']

function buildSelectOptions(preferred: string[], values: string[], current: string): string[] {
  const seen = new Set<string>()
  const options: string[] = []
  ;[...preferred, ...values, current].forEach((value) => {
    const normalized = String(value ?? '').trim()
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    options.push(normalized)
  })
  return options
}
type LegacyCalibrationListResponse = {
  files?: Array<{ id: string; guessed_type?: string }>
}

type CameraStatsResponse = {
  cameras?: Record<string, { fps?: number | string; mbps?: number | string }>
}

const uniq = (items: string[]) => [...new Set(items.map((s) => s.trim()).filter(Boolean))]

export function RecordTab({ active }: RecordTabProps) {
  const { config, buildConfig } = useConfig()
  const buildConfigRef = useRef(buildConfig)
  const { mappedCameras, refreshDevices } = useMappedCameras()
  const { runPreflight, stopProcess, sendProcessInput } = useProcess()
  const running = useLeStudioStore((s) => !!s.procStatus.record)
  const procStatus = useLeStudioStore((s) => s.procStatus)
  const conflictReason = getProcessConflict('record', procStatus)
  const clearLog = useLeStudioStore((s) => s.clearLog)
  const appendLog = useLeStudioStore((s) => s.appendLog)
  const addToast = useLeStudioStore((s) => s.addToast)
  const hfUsername = useLeStudioStore((s) => s.hfUsername)
  const defaultRepoId = `${hfUsername ?? 'user'}/my-dataset`
  const [mode, setMode] = useState<'single' | 'bi'>('single')
  const [episodesDone, setEpisodesDone] = useState(0)
  const [followerArmIds, setFollowerArmIds] = useState<string[]>(['my_so101_follower_1'])
  const [leaderArmIds, setLeaderArmIds] = useState<string[]>(['my_so101_leader_1'])
  const [streamCodec, setStreamCodec] = useState('MJPG')
  const [streamResolution, setStreamResolution] = useState('640x480')
  const [streamFps, setStreamFps] = useState('30')
  const [streamQuality, setStreamQuality] = useState(70)
  const [cameraStats, setCameraStats] = useState<Record<string, { fps: number; mbps: number }>>({})
  const [pausedFeeds, setPausedFeeds] = useState<Record<string, boolean>>({})
  const [robotTypes, setRobotTypes] = useState<string[]>(['so101_follower'])
  const [teleopTypes, setTeleopTypes] = useState<string[]>(['so101_leader'])
  const [robotDetails, setRobotDetails] = useState<Record<string, RobotDetail>>({})

  useEffect(() => {
    buildConfigRef.current = buildConfig
  }, [buildConfig])

  const devices = useLeStudioStore((s) => s.devices)
  const setActiveTab = useLeStudioStore((s) => s.setActiveTab)
  const armPaths = useMemo(() => {
    const all = new Set<string>()
    devices.arms.forEach((arm) => {
      if (arm.symlink) all.add(`/dev/${arm.symlink}`)
      if (arm.path) all.add(arm.path)
    })
    return [...all]
  }, [devices])

  const followerPortOpts = useMemo(
    () => buildSelectOptions(DEFAULT_FOLLOWER_PORTS, armPaths, (config.follower_port as string) ?? '/dev/follower_arm_1'),
    [armPaths, config.follower_port],
  )
  const leaderPortOpts = useMemo(
    () => buildSelectOptions(DEFAULT_LEADER_PORTS, armPaths, (config.leader_port as string) ?? '/dev/leader_arm_1'),
    [armPaths, config.leader_port],
  )
  const leftFollowerPortOpts = useMemo(
    () => buildSelectOptions(DEFAULT_FOLLOWER_PORTS, armPaths, (config.left_follower_port as string) ?? '/dev/follower_arm_1'),
    [armPaths, config.left_follower_port],
  )
  const rightFollowerPortOpts = useMemo(
    () => buildSelectOptions(['/dev/follower_arm_2', '/dev/follower_arm_1'], armPaths, (config.right_follower_port as string) ?? '/dev/follower_arm_2'),
    [armPaths, config.right_follower_port],
  )
  const leftLeaderPortOpts = useMemo(
    () => buildSelectOptions(DEFAULT_LEADER_PORTS, armPaths, (config.left_leader_port as string) ?? '/dev/leader_arm_1'),
    [armPaths, config.left_leader_port],
  )
  const rightLeaderPortOpts = useMemo(
    () => buildSelectOptions(['/dev/leader_arm_2', '/dev/leader_arm_1'], armPaths, (config.right_leader_port as string) ?? '/dev/leader_arm_2'),
    [armPaths, config.right_leader_port],
  )

  useEffect(() => {
    if (!active) return
    setMode('single')
    buildConfigRef.current({ robot_mode: 'single' })
    refreshDevices()
    const loadCalibrationFiles = async () => {
      try {
        const res = await apiGet<LegacyCalibrationListResponse>('/api/calibrate/list')
        const files = res.files ?? []
        const follower = uniq(
          files.filter((f) => String(f.guessed_type ?? '').includes('follower')).map((f) => f.id),
        )
        const leader = uniq(
          files.filter((f) => String(f.guessed_type ?? '').includes('leader')).map((f) => f.id),
        )
        if (follower.length > 0) setFollowerArmIds(follower)
        if (leader.length > 0) setLeaderArmIds(leader)
      } catch {
        return
      }
    }

    loadCalibrationFiles().catch(() => undefined)
  }, [active, refreshDevices])


  useEffect(() => {
    if (!active) return
    apiGet<RobotsResponse>('/api/robots').then((r) => {
      setRobotTypes(r.types ?? ['so101_follower'])
      setRobotDetails(r.details ?? {})
    })
    const currentRobotType = (config.robot_type as string) || 'so101_follower'
    apiGet<TeleopsResponse>(`/api/teleops?robot_type=${encodeURIComponent(currentRobotType)}`).then((r) => setTeleopTypes(r.types ?? ['so101_leader']))
  }, [active, config.robot_type])

  useEffect(() => {
    if (!active) return

    let cancelled = false

    const pollStats = async () => {
      try {
        const data = await apiGet<CameraStatsResponse>('/api/camera/stats')
        if (cancelled) return
        const next: Record<string, { fps: number; mbps: number }> = {}
        Object.entries(data.cameras ?? {}).forEach(([cam, stat]) => {
          const fps = Number(stat.fps ?? 0)
          const mbps = Number(stat.mbps ?? 0)
          next[cam] = {
            fps: Number.isFinite(fps) ? fps : 0,
            mbps: Number.isFinite(mbps) ? mbps : 0,
          }
        })
        setCameraStats(next)
      } catch {
        if (!cancelled) setCameraStats({})
      }
    }

    pollStats().catch(() => undefined)
    const timer = window.setInterval(() => {
      pollStats().catch(() => undefined)
    }, 2000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [active])

  useEffect(() => {
    const robotMode = (config.robot_mode as string) ?? 'single'
    setMode(robotMode === 'bi' ? 'bi' : 'single')
  }, [config.robot_mode])


  const selectedRobotType = (() => { const v = (config.robot_type as string) ?? ''; return (v && robotTypes.includes(v)) ? v : (robotTypes[0] ?? 'so101_follower') })()
  const selectedTeleopType = (() => { const v = (config.teleop_type as string) ?? ''; return (v && teleopTypes.includes(v)) ? v : (teleopTypes[0] ?? 'so101_leader') })()

  useEffect(() => {
    if (!active) return
    apiGet<TeleopsResponse>(`/api/teleops?robot_type=${encodeURIComponent(selectedRobotType)}`)
      .then((r) => {
        const types = r.types ?? ['so101_leader']
        setTeleopTypes(types)
        const currentTeleop = (config.teleop_type as string) ?? ''
        if (currentTeleop && !types.includes(currentTeleop) && types.length > 0) {
          buildConfigRef.current({ teleop_type: types[0] })
        }
      })
      .catch(() => setTeleopTypes(['so101_leader']))
  }, [active, config.teleop_type, selectedRobotType])

  const selectedRobotDetail = robotDetails[selectedRobotType] ?? null

  const recordLines: LogLine[] = useLeStudioStore((s) => s.logLines.record ?? EMPTY_RECORD_LINES)
  useEffect(() => {
    if (!active) return
    const latest = recordLines.at(-1)?.text ?? ''
    const match = latest.match(/[Ee]pisode[\s_](?:index=)?(\d+)/)
    if (match) setEpisodesDone(Number(match[1]))
  }, [active, recordLines])

  const update = (key: string, value: string | number | boolean) => {
    buildConfig({ [key]: value })
  }

  const getCfg = () => ({
    robot_mode: mode,
    robot_type: selectedRobotType,
    teleop_type: selectedTeleopType,
    follower_port: (config.follower_port as string) ?? '/dev/follower_arm_1',
    robot_id: (config.robot_id as string) ?? 'my_so101_follower_1',
    leader_port: (config.leader_port as string) ?? '/dev/leader_arm_1',
    teleop_id: (config.teleop_id as string) ?? 'my_so101_leader_1',
    left_follower_port: (config.left_follower_port as string) ?? '/dev/follower_arm_1',
    right_follower_port: (config.right_follower_port as string) ?? '/dev/follower_arm_2',
    left_leader_port: (config.left_leader_port as string) ?? '/dev/leader_arm_1',
    right_leader_port: (config.right_leader_port as string) ?? '/dev/leader_arm_2',
    left_robot_id: (config.left_robot_id as string) ?? 'my_so101_follower_1',
    right_robot_id: (config.right_robot_id as string) ?? 'my_so101_follower_2',
    left_teleop_id: (config.left_teleop_id as string) ?? 'my_so101_leader_1',
    right_teleop_id: (config.right_teleop_id as string) ?? 'my_so101_leader_2',
    record_task: (config.record_task as string) ?? '',
    record_episodes: Number(config.record_episodes ?? 50),
    record_repo_id: (config.record_repo_id as string) ?? defaultRepoId,
    record_resume: Boolean(config.record_resume),
    cameras: mappedCameras,
  })

  const streamDims = useMemo(() => {
    const [widthRaw, heightRaw] = streamResolution.split('x')
    const width = Number(widthRaw)
    const height = Number(heightRaw)
    return {
      width: Number.isFinite(width) && width > 0 ? width : 640,
      height: Number.isFinite(height) && height > 0 ? height : 480,
    }
  }, [streamResolution])

  const repoId = (config.record_repo_id as string) ?? defaultRepoId
  const repoError = useMemo(() => {
    const repo = repoId.trim()
    if (!repo) return 'Repo ID is required'
    if (!REPO_ID_REGEX.test(repo)) return 'Must be "user/dataset" format (e.g. yourname/my-dataset)'
    return ''
  }, [repoId])

  const followerIdOptions = useMemo(() => uniq(['my_so101_follower_1', ...(config.robot_id ? [String(config.robot_id)] : []), ...followerArmIds]), [
    config.robot_id,
    followerArmIds,
  ])
  const leaderIdOptions = useMemo(() => uniq(['my_so101_leader_1', ...(config.teleop_id ? [String(config.teleop_id)] : []), ...leaderArmIds]), [
    config.teleop_id,
    leaderArmIds,
  ])
  const leftFollowerIdOptions = useMemo(() => uniq(['my_so101_follower_1', ...(config.left_robot_id ? [String(config.left_robot_id)] : []), ...followerArmIds]), [config.left_robot_id, followerArmIds])
  const rightFollowerIdOptions = useMemo(() => uniq(['my_so101_follower_2', ...(config.right_robot_id ? [String(config.right_robot_id)] : []), ...followerArmIds]), [config.right_robot_id, followerArmIds])
  const leftLeaderIdOptions = useMemo(() => uniq(['my_so101_leader_1', ...(config.left_teleop_id ? [String(config.left_teleop_id)] : []), ...leaderArmIds]), [config.left_teleop_id, leaderArmIds])
  const rightLeaderIdOptions = useMemo(() => uniq(['my_so101_leader_2', ...(config.right_teleop_id ? [String(config.right_teleop_id)] : []), ...leaderArmIds]), [config.right_teleop_id, leaderArmIds])

  const feedCameras = useMemo(
    () =>
      Object.entries(mappedCameras)
        .map(([name, path]) => {
          const cam = path.startsWith('/dev/') ? path.slice('/dev/'.length) : name
          return { name, path, cam }
        })
        .filter((c) => c.path),
    [mappedCameras],
  )

  useEffect(() => {
    if (active) return
    setPausedFeeds({})
  }, [active])

  useEffect(() => {
    setPausedFeeds((prev) => {
      const next: Record<string, boolean> = {}
      feedCameras.forEach((camera) => {
        if (prev[camera.cam]) next[camera.cam] = true
      })
      return next
    })
  }, [feedCameras])

  const start = async () => {
    clearLog('record')
    const cfg = getCfg()
    await buildConfig(cfg)
    if (!REPO_ID_REGEX.test(cfg.record_repo_id)) {
      appendLog('record', '[ERROR] Repo ID must be in "user/dataset" format', 'error')
      return
    }
    const ok = await runPreflight(cfg, 'record')
    if (!ok) return
    setEpisodesDone(0)
    const res = await apiPost<{ ok: boolean; error?: string; resume_requested?: boolean; resume_enabled?: boolean }>('/api/record/start', cfg)
    if (!res.ok) {
      appendLog('record', `[ERROR] ${res.error ?? 'failed to start'}`, 'error')
      return
    }
    if (res.resume_requested && !res.resume_enabled) {
      appendLog('record', '[INFO] Resume disabled because target dataset does not exist yet.', 'info')
    }
    addToast('Recording started', 'success')
  }

  const stop = async () => {
    await stopProcess('record')
    addToast('Recording stop requested', 'info')
  }

  const sendKey = async (key: 'right' | 'left' | 'escape') => {
    const res = await sendProcessInput('record', key)
    if (!res.ok) {
      addToast('Failed to send capture command', 'error')
      return
    }
    if (key === 'right') addToast('Episode saved', 'success')
    if (key === 'left') addToast('Episode discarded', 'error')
    if (key === 'escape') addToast('Recording ended', 'info')
  }

  const totalEpisodes = Number(config.record_episodes ?? 50)
  const pct = Math.max(0, Math.min(100, totalEpisodes > 0 ? (episodesDone / totalEpisodes) * 100 : 0))

  const mappedCameraCount = useMemo(
    () => Object.values(mappedCameras).filter((path) => String(path ?? '').trim().length > 0).length,
    [mappedCameras],
  )

  const requiredArmPorts = useMemo(
    () =>
      mode === 'single'
        ? [
            (config.follower_port as string) ?? '/dev/follower_arm_1',
            (config.leader_port as string) ?? '/dev/leader_arm_1',
          ]
        : [
            (config.left_follower_port as string) ?? '/dev/follower_arm_1',
            (config.right_follower_port as string) ?? '/dev/follower_arm_2',
            (config.left_leader_port as string) ?? '/dev/leader_arm_1',
            (config.right_leader_port as string) ?? '/dev/leader_arm_2',
          ],
    [
      config.follower_port,
      config.leader_port,
      config.left_follower_port,
      config.right_follower_port,
      config.left_leader_port,
      config.right_leader_port,
      mode,
    ],
  )

  const connectedArmPortSet = useMemo(() => new Set(armPaths), [armPaths])

  const missingArmPorts = useMemo(
    () => requiredArmPorts.filter((port) => !connectedArmPortSet.has(port)),
    [connectedArmPortSet, requiredArmPorts],
  )

  const armsReady = missingArmPorts.length === 0
  const camerasReady = mappedCameraCount > 0
  const planReady = !repoError && totalEpisodes > 0
  const recordReady = planReady && camerasReady && armsReady && !conflictReason
  const recordBlockers = useMemo(() => {
    const blockers: string[] = []
    if (!planReady) blockers.push(repoError || 'Plan is incomplete')
    if (!camerasReady) blockers.push(mappedCameraCount === 0 ? 'No mapped cameras' : 'Mapped camera path unavailable')
    if (!armsReady) blockers.push(`Missing arm ports (${missingArmPorts.length})`)
    if (conflictReason) blockers.push(`${conflictReason} process running`)
    return blockers
  }, [planReady, repoError, camerasReady, mappedCameraCount, armsReady, missingArmPorts.length, conflictReason])

  const guardHint = conflictReason
    ? `${conflictReason} is running`
    : repoError
      ? repoError
      : !camerasReady
        ? 'Map at least one camera in Mapping before recording.'
        : !armsReady
          ? `Connect required arm ports: ${missingArmPorts.join(', ')}`
          : ''

  const latestRecordEvent = useMemo(() => {
    for (let i = recordLines.length - 1; i >= 0; i -= 1) {
      const text = String(recordLines[i]?.text ?? '').replace(/\s+/g, ' ').trim()
      if (!text) continue
      return text.length > 140 ? `${text.slice(0, 140)}...` : text
    }
    return ''
  }, [recordLines])

  return (
    <section id="tab-record" className={`tab ${active ? 'active' : ''}`}>
      <div className="section-header">
        <h2>Record Dataset</h2>
        <span className={`status-verdict ${running || recordReady ? 'ready' : 'warn'}`}>
          {running ? 'Recording' : recordReady ? 'Ready to Start' : 'Action Needed'}
        </span>
        <div className="mode-toggle">
          <label>Recording Mode:</label>
          <button id="record-mode-single" className={`toggle ${mode === 'single' ? 'active' : ''}`} onClick={() => { setMode('single'); buildConfig({ robot_mode: 'single' }) }}>
            Single
          </button>
          <button id="record-mode-bi" className={`toggle ${mode === 'bi' ? 'active' : ''}`} onClick={() => { setMode('bi'); buildConfig({ robot_mode: 'bi' }) }}>
            Bi-Arm
          </button>
        </div>
      </div>

      {!running && !recordReady ? (
        <div className="record-blocker-card">
          <div className="dsub" style={{ marginBottom: 6 }}>Recording blocked:</div>
          <div className="record-blocker-chip-row">
            {recordBlockers.map((blocker) => (
              <span key={blocker} className="dbadge badge-warn">{blocker}</span>
            ))}
          </div>
          <div className="record-blocker-actions">
            <button type="button" className="link-btn" onClick={() => setActiveTab('device-setup')}>→ Open Mapping</button>
          </div>
        </div>
      ) : null}

      <div className="two-col">
        <div className="card">
          <h3>Step 1: Recording Plan</h3>
          <div className="device-list" style={{ marginBottom: 10 }}>
            <div className="device-item" style={{ justifyContent: 'space-between' }}>
              <span className="dname">Episode target</span>
              <span className={`dbadge ${totalEpisodes > 0 ? 'badge-ok' : 'badge-err'}`}>{Math.max(0, totalEpisodes)}</span>
            </div>
            <div className="device-item" style={{ justifyContent: 'space-between' }}>
              <span className="dname">Repo ID</span>
              <span className={`dbadge ${repoError ? 'badge-err' : 'badge-ok'}`}>{repoError ? 'invalid' : 'ok'}</span>
            </div>
          </div>
          <label>Number of Episodes</label>
          <input type="number" min={1} value={totalEpisodes} onChange={(e) => update('record_episodes', Number(e.target.value))} />
          <div className="field-help">Start with 20-50 for first test run.</div>
          <label>Dataset Repo ID (Hugging Face)</label>
          <input
            type="text"
            value={repoId}
            placeholder={hfUsername ? `${hfUsername}/my-dataset` : 'yourname/my-dataset'}
            onChange={(e) => update('record_repo_id', e.target.value)}
            style={repoError ? { borderColor: 'var(--red)' } : undefined}
          />
          <div
            id="record-repo-error"
            style={{
              display: repoError ? 'block' : 'none',
              color: 'var(--red)',
              fontSize: 11,
              marginTop: 4,
              padding: '4px 8px',
              background: 'rgba(248,81,73,0.1)',
              borderRadius: 4,
            }}
          >
            {repoError}
          </div>
          <div className="field-help" style={{ marginTop: 8, marginBottom: 0 }}>
            <label htmlFor="record-resume" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0, fontSize: 12, color: 'var(--text)' }}>
              <input
                id="record-resume"
                type="checkbox"
                checked={Boolean(config.record_resume)}
                onChange={(e) => update('record_resume', e.target.checked)}
                style={{ width: 'auto' }}
              />
              Resume existing dataset if it already exists
            </label>
            Prevents crash when the target dataset folder already exists.
          </div>
          <label>Task Description <span className="muted" style={{ fontSize: 11, fontWeight: 400 }}>(optional)</span></label>
          <input
            type="text"
            value={(config.record_task as string) ?? ''}
            onChange={(e) => update('record_task', e.target.value)}
            placeholder="Example: Pick up red block and place in left bin"
          />
          <div className="field-help">Annotates the dataset. If blank, defaults to "task".</div>
        </div>

        <div className="card">
          <h3>Step 2: Device Setup</h3>
          <label>Robot Type</label>
          <select value={selectedRobotType} onChange={(e) => update('robot_type', e.target.value)}>
            {robotTypes.map((t) => (
              <option key={t} value={t}>
                {formatRobotType(t)}
              </option>
            ))}
          </select>
          <label>Teleoperator Type</label>
          <select value={selectedTeleopType} onChange={(e) => update('teleop_type', e.target.value)}>
            {teleopTypes.map((t) => (
              <option key={t} value={t}>
                {formatRobotType(t)}
              </option>
            ))}
          </select>
          <RobotCapabilitiesCard
            capabilities={selectedRobotDetail?.capabilities ?? null}
            compatibleTeleops={selectedRobotDetail?.compatible_teleops ?? []}
          />
          {mode === 'single' ? (
            <>
              <label>Follower Arm Port</label>
              <select value={(config.follower_port as string) ?? '/dev/follower_arm_1'} onChange={(e) => update('follower_port', e.target.value)}>
                {followerPortOpts.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <label>Follower Arm ID</label>
              <select value={(config.robot_id as string) ?? 'my_so101_follower_1'} onChange={(e) => update('robot_id', e.target.value)}>
                {followerIdOptions.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
              <div className="field-help">Arm ID selects the calibration profile file name (without .json).</div>
              <label>Leader Arm Port</label>
              <select value={(config.leader_port as string) ?? '/dev/leader_arm_1'} onChange={(e) => update('leader_port', e.target.value)}>
                {leaderPortOpts.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <label>Leader Arm ID</label>
              <select value={(config.teleop_id as string) ?? 'my_so101_leader_1'} onChange={(e) => update('teleop_id', e.target.value)}>
                {leaderIdOptions.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
              <div className="field-help">Suggestions come from existing calibration files.</div>
            </>
          ) : (
            <>
              <label>Left Follower Port</label>
              <select value={(config.left_follower_port as string) ?? '/dev/follower_arm_1'} onChange={(e) => update('left_follower_port', e.target.value)}>
                {leftFollowerPortOpts.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <label>Left Follower ID</label>
              <select value={(config.left_robot_id as string) ?? 'my_so101_follower_1'} onChange={(e) => update('left_robot_id', e.target.value)}>
                {leftFollowerIdOptions.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
              <label>Right Follower Port</label>
              <select value={(config.right_follower_port as string) ?? '/dev/follower_arm_2'} onChange={(e) => update('right_follower_port', e.target.value)}>
                {rightFollowerPortOpts.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <label>Right Follower ID</label>
              <select value={(config.right_robot_id as string) ?? 'my_so101_follower_2'} onChange={(e) => update('right_robot_id', e.target.value)}>
                {rightFollowerIdOptions.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
              <label>Left Leader Port</label>
              <select value={(config.left_leader_port as string) ?? '/dev/leader_arm_1'} onChange={(e) => update('left_leader_port', e.target.value)}>
                {leftLeaderPortOpts.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <label>Left Leader ID</label>
              <select value={(config.left_teleop_id as string) ?? 'my_so101_leader_1'} onChange={(e) => update('left_teleop_id', e.target.value)}>
                {leftLeaderIdOptions.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
              <label>Right Leader Port</label>
              <select value={(config.right_leader_port as string) ?? '/dev/leader_arm_2'} onChange={(e) => update('right_leader_port', e.target.value)}>
                {rightLeaderPortOpts.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <label>Right Leader ID</label>
              <select value={(config.right_teleop_id as string) ?? 'my_so101_leader_2'} onChange={(e) => update('right_teleop_id', e.target.value)}>
                {rightLeaderIdOptions.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
              <div className="field-help">Arm ID selects the calibration profile for each arm.</div>
            </>
          )}
        </div>

        <div className="card">
          <h3>Step 3: Camera Feeds</h3>
        <div className="field-help" style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <span>Mapped cameras: {mappedCameraCount} · Feeds: {feedCameras.length}</span>
          {mappedCameraCount === 0 ? <button type="button" className="link-btn" onClick={() => setActiveTab('device-setup')}>→ Open Mapping</button> : null}
        </div>
          <MappedCameraRows mappedCameras={mappedCameras} />
          <details className="advanced-panel" style={{ marginTop: 12 }}>
            <summary>Advanced Stream Settings</summary>
            <div className="settings-grid" style={{ marginTop: 10 }}>
              <div className="setting-item">
                <label>Codec</label>
                <select value={streamCodec} onChange={(e) => setStreamCodec(e.target.value)}>
                  <option value="MJPG">MJPG (compressed)</option>
                  <option value="YUYV">YUYV (raw)</option>
                </select>
              </div>
              <div className="setting-item">
                <label>Resolution</label>
                <select value={streamResolution} onChange={(e) => setStreamResolution(e.target.value)}>
                  <option value="1280x720">1280 × 720 (720p)</option>
                  <option value="800x600">800 × 600</option>
                  <option value="640x480">640 × 480 (480p)</option>
                  <option value="320x240">320 × 240 (240p)</option>
                </select>
              </div>
              <div className="setting-item">
                <label>FPS</label>
                <select value={streamFps} onChange={(e) => setStreamFps(e.target.value)}>
                  <option value="30">30</option>
                </select>
              </div>
              <div className="setting-item">
                <label>
                  JPEG Quality <span className="muted">{streamQuality}%</span>
                </label>
                <input
                  type="range"
                  min={30}
                  max={95}
                  step={5}
                  value={streamQuality}
                  onChange={(e) => setStreamQuality(Number(e.target.value))}
                />
              </div>
            </div>
          </details>
        </div>

        <div className="episode-progress-card">
          <div className="ep-card-title">Episode Progress</div>
          <div id="record-feeds" className="feed-grid">
            {active && feedCameras.length > 0 ? feedCameras.map((camera) => {
              const streamSrc = `/stream/${camera.cam}?codec=${encodeURIComponent(streamCodec)}&width=${streamDims.width}&height=${streamDims.height}&fps=${encodeURIComponent(streamFps)}&quality=${streamQuality}`
              const stats = cameraStats[camera.cam]
              const fpsText = stats ? `${stats.fps.toFixed(1)} fps` : `${streamFps} fps`
              const statText = stats ? `${stats.fps.toFixed(1)}fps · ${stats.mbps.toFixed(1)}MB/s` : ''
              const paused = !!pausedFeeds[camera.cam]
              return (
                <div key={`${camera.cam}-${streamCodec}-${streamResolution}-${streamFps}-${streamQuality}`} className="feed-card" data-vid={camera.cam}>
                  <img src={paused ? undefined : streamSrc} alt={camera.name} />
                  <div className={`feed-live-badge ${paused ? '' : 'visible'}`}>
                    <div className="feed-live-dot" />LIVE
                  </div>
                  <div className={`feed-fps-badge ${paused ? '' : 'visible'}`}>{fpsText}</div>
                  <button className="feed-close-btn" title="Pause this feed" onClick={() => setPausedFeeds((prev) => ({ ...prev, [camera.cam]: true }))}>×</button>
                  {paused ? (
                    <div className="feed-paused-ov">
                      <span style={{ fontSize: 20, opacity: 0.4 }}>⏸</span>
                      <span className="feed-paused-text">{camera.name} — paused</span>
                      <button className="btn-xs feed-overlay-btn" onClick={() => setPausedFeeds((prev) => ({ ...prev, [camera.cam]: false }))}>
                        ▶ Resume
                      </button>
                    </div>
                  ) : null}
                  <div className="feed-label">
                    <span>
                      {camera.name} — {camera.path}
                    </span>
                    <span className="feed-stat">{statText}</span>
                  </div>
                </div>
              )
            }) : (
              <div className="no-cameras-empty">
                <div className="no-cam-text">
                  No cameras detected.
                  <br />
                  Connect a camera and refresh.
                </div>
                <button type="button" className="link-btn" onClick={() => setActiveTab('device-setup')}>→ Open Mapping</button>
              </div>
            )}
          </div>
          {running || episodesDone > 0 ? (
            <div className="episode-status">
              <div className="ep-label">Episodes</div>
              <div className="ep-bar-wrap">
                <div className="ep-bar" id="record-ep-bar" style={{ width: `${pct}%` }} />
              </div>
              <div className="ep-status-row">
                <div className="ep-num">
                  <span id="record-ep-current">{running ? episodesDone : episodesDone}</span>
                  <span className="ep-sep"> / </span>
                  <span id="record-ep-total">{totalEpisodes}</span>
                </div>
                <div id="record-state-pill" className={`ep-state-pill ${running ? 'running' : 'idle'}`}>
                  {running ? 'Recording' : 'Idle'}
                </div>
              </div>
            </div>
          ) : (
            <div className="field-help" style={{ marginTop: 4 }}>No episodes yet. Start recording to begin progress tracking.</div>
          )}
        </div>
      </div>
      <div className="record-sticky-controls">
        <div className="record-run-summary">
          <span className={`dbadge ${running ? 'badge-run' : recordReady ? 'badge-ok' : 'badge-err'}`}>
            {running ? 'RECORDING' : recordReady ? 'READY' : 'BLOCKED'}
          </span>
          <span className="record-run-text">
            {running ? `${episodesDone}/${totalEpisodes} episodes` : guardHint || 'Ready to start recording'}
          </span>
          {latestRecordEvent ? <span className="record-run-last">Last: {latestRecordEvent}</span> : null}
          {!running && episodesDone > 0 && (
            <button type="button" className="link-btn" onClick={() => setActiveTab('dataset')}>→ Go to Dataset</button>
          )}
        </div>
        <div className="ep-controls-row" id="record-ep-controls">
          {!running && (
            <>
              <button className="btn-primary" onClick={start} disabled={!recordReady}>▶ Start Recording</button>
            </>
          )}
          {running && (
            <button className="btn-danger" onClick={stop}>■ Force Stop</button>
          )}
          {running && (
            <>
              <button className="btn-sm record-ep-action" onClick={() => sendKey('right')}>
                ✓ Save →
              </button>
              <button className="btn-sm record-ep-action record-ep-discard" onClick={() => sendKey('left')}>
                ✗ Discard ←
              </button>
              <button className="btn-sm record-ep-action record-ep-end" onClick={() => sendKey('escape')}>
                ⏹ End (Esc)
              </button>
            </>
          )}
        </div>
      </div>
      </section>
  )
}
