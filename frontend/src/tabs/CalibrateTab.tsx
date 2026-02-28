import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActionIcon, Badge, Box, Button, Group, NativeSelect, Paper, Text, TextInput, Title } from '@mantine/core'
import { formatRobotType } from '../lib/format'
import { ProcessButtons } from '../components/shared/ProcessButtons'
import { getProcessConflict } from '../lib/processConflicts'
import { useProcess } from '../hooks/useProcess'
import { apiDelete, apiGet, apiPost } from '../lib/api'
import { logError } from '../lib/errors'
import { useLeStudioStore } from '../store'
import type { ArmDevice, LogLine, RobotsResponse, TeleopsResponse } from '../lib/types'

interface CalibrateTabProps {
  active: boolean
}

interface CalibrationFileItem {
  id: string
  guessed_type: string
  modified?: string
}

const DEFAULT_ARM_TYPES = ['so101_follower', 'so100_follower', 'so101_leader', 'so100_leader']

const IDENTIFY_DEFAULT_MSG = 'Disconnect one arm, then click Start to begin identification.'
const EMPTY_CAL_LINES: LogLine[] = []
const MOTOR_ROW_RE = /^([a-zA-Z0-9_]+)\s+\|\s+(-?\d+)\s+\|\s+(-?\d+)\s+\|\s+(-?\d+)\s*$/
const MOTOR_HEADER_RE = /^NAME\s+\|\s+MIN\s+\|\s+POS/i
const MOTOR_SEPARATOR_RE = /^-{8,}\s*$/

function truncatePath(fullPath: string): string {
  const homeMatch = fullPath.match(/^\/home\/[^/]+\//)
  if (homeMatch) return fullPath.replace(homeMatch[0], '~/')
  return fullPath
}

function lastNumberToken(input: string): number | null {
  const match = input.match(/(\d+)(?!.*\d)/)
  if (!match) return null
  const parsed = Number(match[1])
  return Number.isFinite(parsed) ? parsed : null
}

function pickBestCalibrationId(options: {
  files: CalibrationFileItem[]
  robotType: string
  port: string
  preferredId: string
}): string | null {
  const { files, robotType, port, preferredId } = options
  if (files.length === 0) return preferredId || null

  const role = robotType.toLowerCase().includes('leader') ? 'leader' : 'follower'
  const roleFiles = files.filter((f) => f.guessed_type.toLowerCase().includes(role))
  if (roleFiles.length === 0) return preferredId || null

  const portIndex = lastNumberToken(port)
  const ranked = [...roleFiles].sort((a, b) => {
    const score = (file: CalibrationFileItem) => {
      let value = 0
      if (file.id === preferredId) value += 100
      if (file.guessed_type === robotType) value += 30
      if (file.id.toLowerCase().includes(role)) value += 20
      const idIndex = lastNumberToken(file.id)
      if (portIndex !== null && idIndex === portIndex) value += 50
      return value
    }

    const diff = score(b) - score(a)
    if (diff !== 0) return diff
    return a.id.localeCompare(b.id)
  })

  const best = ranked[0]?.id
  if (best) return best
  return preferredId || null
}

function armPath(arm: ArmDevice, fallbackIndex: number): string {
  return arm.path || `/dev/${arm.device || `ttyUSB${fallbackIndex}`}`
}

function getPortLabel(arms: ArmDevice[], selectedPort: string): string {
  const matched = arms.find((arm, idx) => armPath(arm, idx) === selectedPort)
  return matched?.symlink || selectedPort
}

function getPortIndex(arms: ArmDevice[], selectedPort: string): number | null {
  const matched = arms.find((arm, idx) => armPath(arm, idx) === selectedPort)
  if (!matched) return lastNumberToken(selectedPort)
  const labelIndex = lastNumberToken(matched.symlink || '')
  if (labelIndex !== null) return labelIndex
  const pathIndex = lastNumberToken(matched.path || '')
  if (pathIndex !== null) return pathIndex
  return lastNumberToken(selectedPort)
}

function inferPortRole(portLabel: string, portPath: string): 'leader' | 'follower' | null {
  const text = `${portLabel} ${portPath}`.toLowerCase()
  if (text.includes('leader')) return 'leader'
  if (text.includes('follower')) return 'follower'
  return null
}

function inferIdRole(id: string): 'leader' | 'follower' | null {
  const text = id.toLowerCase()
  if (text.includes('leader')) return 'leader'
  if (text.includes('follower')) return 'follower'
  return null
}

function swapRoleInType(type: string, targetRole: 'leader' | 'follower'): string {
  if (targetRole === 'leader' && /follower/i.test(type)) return type.replace(/follower/i, 'leader')
  if (targetRole === 'follower' && /leader/i.test(type)) return type.replace(/leader/i, 'follower')
  return type
}

function fileHasMatchingArm(file: CalibrationFileItem, arms: ArmDevice[]): boolean {
  const fileRole = file.guessed_type.toLowerCase().includes('leader') ? 'leader' : 'follower'
  const fileIndex = lastNumberToken(file.id)
  return arms.some((arm, idx) => {
    const label = arm.symlink || armPath(arm, idx)
    const labelLower = label.toLowerCase()
    const labelRole = labelLower.includes('leader') ? 'leader' : labelLower.includes('follower') ? 'follower' : null
    if (labelRole !== fileRole) return false
    if (fileIndex === null) return true
    const armIndex = lastNumberToken(label) ?? lastNumberToken(armPath(arm, idx))
    return armIndex === fileIndex
  })
}

function pickBestPortForId(options: {
  arms: ArmDevice[]
  robotType: string
  selectedId: string
  currentPort: string
}): string | null {
  const { arms, robotType, selectedId, currentPort } = options
  if (arms.length === 0) return null

  const role = robotType.toLowerCase().includes('leader') ? 'leader' : 'follower'
  const roleArms = arms
    .map((arm, idx) => ({
      arm,
      path: armPath(arm, idx),
      label: arm.symlink || armPath(arm, idx),
    }))
    .filter((entry) => entry.label.toLowerCase().includes(role) || entry.path.toLowerCase().includes(role))

  if (roleArms.length === 0) return null

  const idIndex = lastNumberToken(selectedId)
  if (idIndex !== null) {
    const indexed = roleArms.filter((entry) => {
      const portIndex = lastNumberToken(entry.label) ?? lastNumberToken(entry.path)
      return portIndex === idIndex
    })
    if (indexed.length === 0) return null
    indexed.sort((a, b) => {
      if (a.path === currentPort && b.path !== currentPort) return -1
      if (b.path === currentPort && a.path !== currentPort) return 1
      return a.path.localeCompare(b.path)
    })
    return indexed[0]?.path ?? null
  }

  const ranked = [...roleArms].sort((a, b) => {
    if (a.path === currentPort && b.path !== currentPort) return -1
    if (b.path === currentPort && a.path !== currentPort) return 1
    return a.path.localeCompare(b.path)
  })
  return ranked[0]?.path ?? null
}



export function CalibrateTab({ active }: CalibrateTabProps) {
  const running = useLeStudioStore((s) => !!s.procStatus.calibrate)
  const procStatus = useLeStudioStore((s) => s.procStatus)
  const config = useLeStudioStore((s) => s.config)
  const conflictReason = getProcessConflict('calibrate', procStatus)
  const addToast = useLeStudioStore((s) => s.addToast)
  const appendLog = useLeStudioStore((s) => s.appendLog)
  const clearLog = useLeStudioStore((s) => s.clearLog)
  const devices = useLeStudioStore((s) => s.devices)
  const calibrateLines = useLeStudioStore((s) => s.logLines.calibrate ?? EMPTY_CAL_LINES)
  const setActiveTab = useLeStudioStore((s) => s.setActiveTab)
  const { stopProcess } = useProcess()
  const [type, setType] = useState('so101_follower')
  const [id, setId] = useState('my_arm_1')
  const [port, setPort] = useState('/dev/follower_arm_1')
  const [fileStatus, setFileStatus] = useState('')
  const [fileMeta, setFileMeta] = useState('')
  const [files, setFiles] = useState<CalibrationFileItem[]>([])
  const [fileFilter, setFileFilter] = useState<string>('all')
  const [showIdentifyPanel, setShowIdentifyPanel] = useState(false)
  const [identifyRunning, setIdentifyRunning] = useState(false)
  const [identifyMessage, setIdentifyMessage] = useState(IDENTIFY_DEFAULT_MSG)
  const [identifyResult, setIdentifyResult] = useState('')
  const [matchWarning, setMatchWarning] = useState('')
  const identifyPollTimer = useRef<number | null>(null)
  const identifySnapshot = useRef<Set<string> | null>(null)
  const identifyAutoOpenedRef = useRef(false)
  const autoMatchTriggerRef = useRef<'type' | 'id' | 'port' | ''>('type')
  const [isBiArm, setIsBiArm] = useState(() => config.robot_mode === 'bi')
  const [biType, setBiType] = useState('bi_so_follower')
  const [biId, setBiId] = useState('bimanual_follower')
  const [biLeftPort, setBiLeftPort] = useState('/dev/follower_arm_1')
  const [biRightPort, setBiRightPort] = useState('/dev/follower_arm_2')
  const filteredFiles = fileFilter === 'all' ? files : files.filter((f) => f.guessed_type === fileFilter)
  const [armTypes, setArmTypes] = useState<string[]>(DEFAULT_ARM_TYPES)
  const singleArmTypes = useMemo(() => armTypes.filter((t) => !t.startsWith('bi_')), [armTypes])
  const calibrateBlockers = useMemo(() => {
    const blockers: string[] = []
    if (devices.arms.length === 0) blockers.push('No arms detected')
    if (conflictReason) blockers.push(`${conflictReason} process running`)
    return blockers
  }, [devices.arms.length, conflictReason])

  useEffect(() => {
    if (!active) return

    let trigger = autoMatchTriggerRef.current
    if (!trigger && id === 'my_arm_1') {
      trigger = 'type'
    }
    if (!trigger) {
      setMatchWarning('')
      return
    }

    const role = type.toLowerCase().includes('leader') ? 'leader' : 'follower'
    const roleFiles = files.filter((f) => f.guessed_type.toLowerCase().includes(role))
    const roleArms = devices.arms
      .map((arm, idx) => ({ path: armPath(arm, idx), label: arm.symlink || armPath(arm, idx) }))
      .filter((entry) => entry.label.toLowerCase().includes(role) || entry.path.toLowerCase().includes(role))

    const preferredId = ((role === 'leader' ? config.teleop_id : config.robot_id) as string) ?? ''
    const defaultPort = role === 'leader' ? '/dev/leader_arm_1' : '/dev/follower_arm_1'

    let nextPort = port
    let nextId = id
    let warning = ''

    if (trigger === 'type') {
      const seedId = preferredId || nextId
      const matchedPort = pickBestPortForId({ arms: devices.arms, robotType: type, selectedId: seedId, currentPort: nextPort })
      if (matchedPort) {
        nextPort = matchedPort
      } else if (roleArms.length > 0) {
        nextPort = roleArms[0].path
      } else {
        nextPort = defaultPort
      }
      const matchedId = pickBestCalibrationId({ files: roleFiles, robotType: type, port: nextPort, preferredId: seedId })
      if (matchedId) nextId = matchedId
    }

    const nextPortLabel = getPortLabel(devices.arms, nextPort)
    const nextPortRole = inferPortRole(nextPortLabel, nextPort)
    const nextPortIndex = getPortIndex(devices.arms, nextPort)
    const nextIdIndex = lastNumberToken(nextId)
    const nextIdRole = inferIdRole(nextId)

    if (trigger === 'port') {
      if (nextPortRole && nextPortRole !== role) {
        warning = `Selected port ${nextPortLabel} looks like ${nextPortRole}, but role is ${role}.`
      } else {
        const matchedId = pickBestCalibrationId({ files: roleFiles, robotType: type, port: nextPort, preferredId: '' })
        if (matchedId) {
          nextId = matchedId
        } else if (roleFiles.length === 0) {
          warning = `No ${role} calibration profiles found. A new file will be created.`
        } else {
          warning = `No existing ${role} calibration profile matches ${nextPortLabel}.`
        }
      }
    }

    if (!warning && trigger === 'type' && roleFiles.length === 0) {
      warning = `No ${role} calibration profiles found. A new file will be created.`
    }

    if (!warning && trigger === 'id' && nextIdIndex !== null && roleArms.length > 0) {
      const hasIndexedPort = roleArms.some((entry) => {
        const idx = lastNumberToken(entry.label) ?? lastNumberToken(entry.path)
        return idx === nextIdIndex
      })
      if (!hasIndexedPort) {
        warning = `No detected ${role} arm port matches ID ${nextId}.`
      }
    }

    if (!warning && trigger === 'id' && nextIdRole && nextIdRole !== role) {
      warning = `Selected ID ${nextId} looks like ${nextIdRole}, but role is ${role}.`
    }

    if (!warning && nextPortRole && nextPortRole !== role) {
      warning = `Selected port ${nextPortLabel} looks like ${nextPortRole}, but role is ${role}.`
    }

    if (!warning && nextPortIndex !== null && nextIdIndex !== null && nextPortIndex !== nextIdIndex) {
      warning = `ID ${nextId} and port ${nextPortLabel} look mismatched.`
    }

    if (nextPort !== port) setPort(nextPort)
    if (nextId !== id) setId(nextId)
    setMatchWarning(warning)
    autoMatchTriggerRef.current = ''
  }, [active, config.robot_id, config.teleop_id, devices.arms, files, id, port, type])


  const motorRows = useMemo(() => {
    const rows: Array<{ name: string; min: number; pos: number; max: number }> = []
    const byName = new Map<string, number>()

    for (const lineItem of calibrateLines) {
      const line = lineItem.text ?? ''
      if (!line || MOTOR_HEADER_RE.test(line) || MOTOR_SEPARATOR_RE.test(line)) continue

      const match = line.match(MOTOR_ROW_RE)
      if (!match) continue

      const parsed = {
        name: match[1],
        min: Number(match[2]),
        pos: Number(match[3]),
        max: Number(match[4]),
      }
      if (!Number.isFinite(parsed.min) || !Number.isFinite(parsed.pos) || !Number.isFinite(parsed.max)) continue

      const index = byName.get(parsed.name)
      if (index === undefined) {
        byName.set(parsed.name, rows.length)
        rows.push(parsed)
      } else {
        rows[index] = parsed
      }
    }

    return rows
  }, [calibrateLines])

  const stopIdentify = useCallback(() => {
    if (identifyPollTimer.current !== null) {
      window.clearInterval(identifyPollTimer.current)
      identifyPollTimer.current = null
    }
    identifySnapshot.current = null
    setIdentifyRunning(false)
    setIdentifyMessage(IDENTIFY_DEFAULT_MSG)
    setIdentifyResult('')
  }, [])

  const startIdentify = () => {
    identifySnapshot.current = new Set((devices.arms ?? []).map((arm) => arm.device).filter((device): device is string => !!device))
    setIdentifyRunning(true)
    setIdentifyMessage('Reconnect the arm now... Waiting for changes...')
    setIdentifyResult('')

    if (identifyPollTimer.current !== null) {
      window.clearInterval(identifyPollTimer.current)
    }

    identifyPollTimer.current = window.setInterval(async () => {
      try {
        const data = await apiGet<{ arms?: Array<{ device?: string; path?: string; serial?: string; kernels?: string }> }>('/api/devices')
        const oldDevices = identifySnapshot.current
        if (!oldDevices) return

        const detected = (data.arms ?? []).find((arm) => !!arm.device && !oldDevices.has(arm.device))
        if (!detected || !detected.device) return

        if (identifyPollTimer.current !== null) {
          window.clearInterval(identifyPollTimer.current)
          identifyPollTimer.current = null
        }
        identifySnapshot.current = null
        setIdentifyRunning(false)
        setIdentifyMessage('Arm detected!')
        setIdentifyResult(
          `${detected.path ?? `/dev/${detected.device}`}${detected.serial ? ` · serial: ${detected.serial}` : ''}${detected.kernels ? ` · kernels: ${detected.kernels}` : ''}`,
        )
      } catch (error) {
        void error
      }
    }, 1500)
  }

  const checkFile = useCallback(async () => {
    const res = await apiGet<{ exists: boolean; path: string; modified?: string; size?: number }>(`/api/calibrate/file?robot_type=${encodeURIComponent(type)}&robot_id=${encodeURIComponent(id)}`)
    if (res.exists) {
      setFileStatus('Found')
      setFileMeta(`${truncatePath(res.path)}\nModified: ${res.modified ?? ''} (${res.size ?? ''} bytes)`)
      return
    }
    setFileStatus('Missing')
    setFileMeta(`Will create new file:\n${truncatePath(res.path)}`)
  }, [id, type])

  const refreshFiles = useCallback(async () => {
    const res = await apiGet<{ files: CalibrationFileItem[] }>('/api/calibrate/list')
    setFiles(res.files ?? [])
  }, [])

  const deleteFile = async (fileId: string, guessedType: string, modified?: string) => {
    const confirmed = window.confirm(
      `Delete calibration file?\n\nFile: ${fileId}\nType: ${guessedType}\nLast modified: ${modified ?? 'unknown'}\n\nThis cannot be undone. You will need to recalibrate.`,
    )
    if (!confirmed) return

    const res = await apiDelete<{ ok: boolean; error?: string }>(
      `/api/calibrate/file?robot_type=${encodeURIComponent(guessedType)}&robot_id=${encodeURIComponent(fileId)}`,
    )

    if (!res.ok) {
      addToast(res.error ?? 'Failed to delete calibration file', 'error')
      return
    }

    addToast('Calibration file deleted', 'success')
    await refreshFiles()
    await checkFile()
  }

  // refreshFiles는 tab 활성화 시 한 번만 (checkFile 재생성에 끌려가지 않도록 분리)
  useEffect(() => {
    if (!active) return
    refreshFiles()
  }, [active, refreshFiles])

  // checkFile은 id/type 변경 시마다 (파라미터 바뀔 때 재확인)
  useEffect(() => {
    if (!active) return
    checkFile()
  }, [active, checkFile])

  useEffect(() => {
    if (!active) {
      identifyAutoOpenedRef.current = false
      return
    }
    if (identifyAutoOpenedRef.current) return
    if (devices.arms.length > 1) {
      setShowIdentifyPanel(true)
      identifyAutoOpenedRef.current = true
    }
  }, [active, devices.arms.length])


  useEffect(() => {
    if (!active) return
    Promise.all([
      apiGet<RobotsResponse>('/api/robots'),
      apiGet<TeleopsResponse>('/api/teleops'),
    ])
      .then(([robots, teleops]) => {
        const merged = [
          ...(robots.types ?? []),
          ...(teleops.types ?? []),
        ]
        const types = Array.from(new Set(merged.length > 0 ? merged : DEFAULT_ARM_TYPES))
        if (type && !types.includes(type)) types.push(type)
        if (types.length > 0) setArmTypes(types)
      })
      .catch((err) => {
        logError('CalibrateTab.armTypes')(err)
        const fallback = Array.from(new Set([...DEFAULT_ARM_TYPES, type]))
        setArmTypes(fallback)
      })
  }, [active, type])

  useEffect(() => {
    if (active) return
    stopIdentify()
  }, [active, stopIdentify])

  useEffect(
    () => () => {
      stopIdentify()
    },
    [stopIdentify],
  )

  const start = async () => {
    clearLog('calibrate')
    const payload = isBiArm
      ? { robot_mode: 'bi', bi_type: biType, left_port: biLeftPort, right_port: biRightPort, robot_id: biId }
      : { robot_type: type, robot_id: id, port }
    const res = await apiPost<{ ok: boolean; error?: string }>('/api/calibrate/start', payload)
    if (!res.ok) {
      appendLog('calibrate', `[ERROR] ${res.error ?? 'failed to start calibration'}`, 'error')
      return
    }
    addToast('Calibration started', 'success')
  }

  const stop = async () => {
    await stopProcess('calibrate')
    addToast('Calibration stop requested', 'info')
    await refreshFiles()
    await checkFile()
  }

  return (
    <Box id="tab-calibrate" className={`tab ${active ? 'active' : ''}`} style={{ display: active ? 'block' : 'none' }}>
      <Group className="section-header" mb="md" align="center">
        <Title order={2}>Calibration</Title>
        <Badge variant="light" color={running || (!conflictReason && devices.arms.length > 0) ? 'green' : 'yellow'}>
          {running ? 'Running' : !conflictReason && devices.arms.length > 0 ? 'Ready' : 'Action Needed'}
        </Badge>
        <div className="mode-toggle">
          <Button className={`toggle${!isBiArm ? ' active' : ''}`} size="compact-xs" variant="light" onClick={() => setIsBiArm(false)}>Single</Button>
          <Button className={`toggle${isBiArm ? ' active' : ''}`} size="compact-xs" variant="light" onClick={() => setIsBiArm(true)}>Bi-Arm</Button>
        </div>
      </Group>
      {!running && calibrateBlockers.length > 0 ? (
        <div className="calibrate-blocker-card">
          <div className="dsub" style={{ marginBottom: 6 }}>Calibration blocked:</div>
          <div className="calibrate-blocker-chip-row">
            {calibrateBlockers.map((blocker) => (
              <span key={blocker} className="dbadge badge-warn">{blocker}</span>
            ))}
          </div>
          <div className="calibrate-blocker-actions">
            {devices.arms.length === 0 ? (
              <Button type="button" className="link-btn" variant="subtle" size="compact-xs" onClick={() => setActiveTab('device-setup')}>→ Open Mapping</Button>
            ) : null}
            <Button type="button" className="link-btn" variant="subtle" size="compact-xs" onClick={() => setActiveTab('motor-setup')}>→ Open Motor Setup</Button>
          </div>
        </div>
      ) : null}
      <div className="two-col">
        <Paper withBorder p="md" mb="md" className="card">
          {isBiArm ? (
            <>
              <Text size="sm" fw={600} c="dimmed" mb="xs">Bi-Arm Configuration</Text>
              <NativeSelect value={biType} onChange={(e) => {
                const t = e.target.value
                setBiType(t)
                setBiId(t.includes('leader') ? 'bimanual_leader' : 'bimanual_follower')
              }} data={[{ value: 'bi_so_follower', label: 'Bi SO-101/100 Follower' }, { value: 'bi_so_leader', label: 'Bi SO-101/100 Leader' }]} label="Device Type" />
              <TextInput value={biId} onChange={(e) => setBiId(e.target.value)} placeholder="e.g. bimanual_follower" label="Combined Arm ID" />
              <div className="field-help">Both arms share this ID as their calibration profile name.</div>
              <NativeSelect value={biLeftPort} onChange={(e) => setBiLeftPort(e.target.value)} data={devices.arms.length === 0 ? [{ value: biLeftPort, label: biLeftPort }] : devices.arms.map((arm, idx) => { const p = arm.path ?? `/dev/${arm.device ?? 'ttyUSB' + idx}`; return { value: p, label: arm.symlink ?? p } })} label="Left Arm Port" />
              <NativeSelect value={biRightPort} onChange={(e) => setBiRightPort(e.target.value)} data={devices.arms.length === 0 ? [{ value: biRightPort, label: biRightPort }] : devices.arms.map((arm, idx) => { const p = arm.path ?? `/dev/${arm.device ?? 'ttyUSB' + idx}`; return { value: p, label: arm.symlink ?? p } })} label="Right Arm Port" />
              <div className="field-help" style={{ marginTop: 8 }}>Both arms are calibrated sequentially in a single run.</div>
              <div className="spacer" />
              <div className="calibrate-inline-controls">
                <ProcessButtons running={running} onStart={start} onStop={stop} startLabel="▶ Start Calibration" conflictReason={conflictReason} />
              </div>
            </>
          ) : (
            <>
              <Text size="sm" fw={600} c="dimmed" mb="xs">Step 1: Arm Selection</Text>
              <NativeSelect value={type} onChange={(e) => { autoMatchTriggerRef.current = 'type'; setType(e.target.value) }} data={singleArmTypes.map((t) => ({ value: t, label: formatRobotType(t) }))} label="Arm Role Type" />
              <NativeSelect value={port} onChange={(e) => {
                const nextPort = e.target.value
                autoMatchTriggerRef.current = 'port'
                setPort(nextPort)
                const inferredRole = inferPortRole(getPortLabel(devices.arms, nextPort), nextPort)
                if (!inferredRole) return
                const currentRole = type.toLowerCase().includes('leader') ? 'leader' : 'follower'
                if (inferredRole === currentRole) return
                const candidateType = swapRoleInType(type, inferredRole)
                if (candidateType !== type && singleArmTypes.includes(candidateType)) {
                  setType(candidateType)
                }
              }} data={devices.arms.length === 0 ? [{ value: port, label: port }] : devices.arms.map((arm, idx) => { const p = arm.path ?? `/dev/${arm.device ?? 'ttyUSB' + idx}`; return { value: p, label: arm.symlink ?? p } })} label="Arm Port" />
              <NativeSelect value={id} onChange={(e) => {
                const nextId = e.target.value
                autoMatchTriggerRef.current = 'id'
                setId(nextId)
                const inferredRole = inferIdRole(nextId)
                if (!inferredRole) return
                const currentRole = type.toLowerCase().includes('leader') ? 'leader' : 'follower'
                if (inferredRole === currentRole) return
                const candidateType = swapRoleInType(type, inferredRole)
                if (candidateType !== type && armTypes.includes(candidateType)) {
                  setType(candidateType)
                }
              }} data={files.length === 0 ? [{ value: id, label: id }] : Array.from(new Set(files.map((f) => f.id))).map((item) => ({ value: item, label: item }))} label="Arm ID" />
              <div className="field-help" style={{ marginTop: 6 }}>
                Not sure which arm this port belongs to?{' '}
                <Button
                  type="button"
                  className="link-btn"
                  variant="subtle"
                  size="compact-xs"
                  onClick={() => {
                    setShowIdentifyPanel(true)
                    const panel = document.getElementById('arm-identify-panel')
                    panel?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                  }}
                >
                  Open Identify Wizard
                </Button>
              </div>
              {matchWarning ? (
                <div className="field-help" style={{ marginTop: 6, color: 'var(--yellow)' }}>
                  {matchWarning}
                </div>
              ) : null}
              <div className="info-box" style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontWeight: 600, color: 'var(--text)' }}>Calibration File</span>
                  <span id="cal-file-status" className={`dbadge ${fileStatus === 'Found' ? 'badge-ok' : fileStatus === '' ? 'badge-idle' : 'badge-err'}`}>
                    {fileStatus === '' ? 'Checking…' : fileStatus}
                  </span>
                </div>
                <div id="cal-file-meta" style={{ fontFamily: 'var(--mono)', fontSize: 10, opacity: 0.8, wordBreak: 'break-all', whiteSpace: 'pre-line' }}>
                  {fileMeta}
                </div>
              </div>
              {fileStatus === 'Found' && !running ? (
                <div className="field-help" style={{ marginTop: 8 }}>
                  Calibration file exists.{' '}
                  <Button type="button" className="link-btn" variant="subtle" size="compact-xs" onClick={() => setActiveTab('teleop')}>→ Proceed to Teleop</Button>
                </div>
              ) : null}
              <div className="spacer" />
              <div className="calibrate-inline-controls">
                <ProcessButtons running={running} onStart={start} onStop={stop} startLabel="▶ Start Calibration" conflictReason={conflictReason} />
              </div>
            </>
          )}
        </Paper>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Paper withBorder p="md" mb="md" className="card" style={{ marginBottom: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <Text size="sm" fw={600} c="dimmed" mb="xs" style={{ marginBottom: 0 }}>Connected Arms</Text>
              <Button
                type="button"
                className=""
                size="compact-xs"
                variant="light"
                onClick={() => {
                  setShowIdentifyPanel((prev) => {
                    if (prev) stopIdentify()
                    return !prev
                  })
                }}
              >
                {showIdentifyPanel ? 'Hide Identify' : '🔍 Identify Arm'}
              </Button>
            </div>
            {!showIdentifyPanel && devices.arms.length > 1 ? (
              <div className="field-help" style={{ marginBottom: 10 }}>
                Multiple arms detected. Run Identify Wizard to map the correct arm before calibration.
              </div>
            ) : null}
            <div
              id="arm-identify-panel"
              style={{
                display: showIdentifyPanel ? 'block' : 'none',
                marginBottom: 14,
                padding: 14,
                background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
                border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)',
                borderRadius: 8,
              }}
            >
              <div style={{ fontSize: 12, color: 'var(--text2)' }}>
                This helps identify which arm appears after reconnecting it.
              </div>
              <div id="arm-identify-msg" style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>
                {identifyMessage}
              </div>
              <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
                <Button
                  id="arm-identify-start-btn"
                  type="button"
                  variant="light"
                  style={{ display: identifyRunning ? 'none' : 'inline-flex' }}
                  onClick={startIdentify}
                >
                  Start Identify
                </Button>
                <Button
                  id="arm-identify-stop-btn"
                  type="button"
                  className="btn-danger"
                  variant="light"
                  style={{ display: identifyRunning ? 'inline-flex' : 'none' }}
                  onClick={stopIdentify}
                >
                  Cancel
                </Button>
              </div>
              <div
                id="arm-identify-result"
                style={{
                  display: identifyResult ? 'block' : 'none',
                  marginTop: 10,
                  fontFamily: 'var(--mono)',
                  fontSize: 11,
                  wordBreak: 'break-all',
                }}
              >
                {identifyResult}
              </div>
            </div>
            <div className="device-list">
              {devices.arms.length === 0 ? (
                <div className="device-empty-state">
                  <span className="dsub">No arms detected. Connect a USB arm to see it here.</span>
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

          <Paper withBorder p="md" mb="md" className="card" style={{ marginBottom: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text size="sm" fw={600} c="dimmed" mb="xs" style={{ marginBottom: 0 }}>Existing Files</Text>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <NativeSelect
                  className=""
                  style={{ padding: '4px 8px', fontSize: 11 }}
                  value={fileFilter}
                  onChange={(e) => setFileFilter(e.target.value)}
                  data={[{ value: 'all', label: 'All Types' }, ...armTypes.map((t) => ({ value: t, label: t }))]}
                />
                <ActionIcon
                  type="button"
                  variant="light"
                  style={{ padding: '4px 6px' }}
                  aria-label="Refresh calibration files"
                  onClick={refreshFiles}
                >
                  ↺
                </ActionIcon>
              </div>
            </div>
            <div className="device-list">
              {filteredFiles.length === 0
                ? 'No calibration files found'
                : fileFilter === 'all' ? (
                  <>
                    {Object.entries(
                      filteredFiles.reduce<Record<string, typeof filteredFiles>>((acc, f) => {
                        const key = f.guessed_type
                        if (!acc[key]) acc[key] = []
                        acc[key].push(f)
                        return acc
                      }, {})
                    ).map(([gtype, gfiles]) => (
                      <div key={gtype}>
                        <div style={{ fontSize: 10, color: 'var(--text2)', margin: '12px 0 6px 4px', textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 600 }}>{gtype}</div>
                        {gfiles.map((f) => (
                          <div key={`${f.id}-${f.guessed_type}`} className={`device-item${f.id === id ? ' selected' : ''}`} style={{ cursor: 'pointer', marginBottom: 4 }} onClick={() => {
                            autoMatchTriggerRef.current = 'type'
                            setId(f.id)
                            if (armTypes.includes(f.guessed_type)) setType(f.guessed_type)
                          }}>
                            <span className={`dot ${fileHasMatchingArm(f, devices.arms) ? 'green' : 'gray'}`} />
                            <div style={{ flex: 1 }}>
                              <div className="dname">{f.id}</div>
                              <div className="dsub">{f.modified ?? ''}</div>
                            </div>
                            <Button type="button" size="compact-xs" variant="light" style={{ color: 'var(--red)', border: '1px solid rgba(248,81,73,0.3)' }} onClick={(e) => { e.stopPropagation(); deleteFile(f.id, f.guessed_type, f.modified) }}>Delete…</Button>
                          </div>
                        ))}
                      </div>
                    ))}
                  </>
                ) : filteredFiles.map((f) => (
                    <div key={`${f.id}-${f.guessed_type}`} className={`device-item${f.id === id ? ' selected' : ''}`} style={{ cursor: 'pointer', marginBottom: 4 }} onClick={() => {
                      autoMatchTriggerRef.current = 'type'
                      setId(f.id)
                      if (armTypes.includes(f.guessed_type)) setType(f.guessed_type)
                    }}>
                      <span className={`dot ${fileHasMatchingArm(f, devices.arms) ? 'green' : 'gray'}`} />
                      <div style={{ flex: 1 }}>
                        <div className="dname">{f.id}</div>
                        <div className="dsub">{f.modified ?? ''}</div>
                      </div>
                      <Button type="button" size="compact-xs" variant="light" style={{ color: 'var(--red)', border: '1px solid rgba(248,81,73,0.3)' }} onClick={(e) => { e.stopPropagation(); deleteFile(f.id, f.guessed_type, f.modified) }}>Delete…</Button>
                    </div>
                  ))}
            </div>
          </Paper>
        </div>
      </div>

      <div className="calibrate-mobile-controls" role="group" aria-label="Calibration controls">
        <ProcessButtons running={running} onStart={start} onStop={stop} startLabel="▶ Start Calibration" conflictReason={conflictReason} />
      </div>

      <Paper withBorder p="md" mb="md" className="card" id="cal-live-table">
        <Text size="sm" fw={600} c="dimmed" mb="xs">Live Motor Ranges</Text>
        {motorRows.length === 0 ? (
          <div id="cal-motor-placeholder" className="muted" style={{ textAlign: 'center', padding: '14px 0' }}>
            Waiting for calibration…<br />Start process to see live ranges.
          </div>
        ) : (
          <div id="cal-motor-list" className="motor-list">
            {motorRows.map((row) => {
              const maxVal = 4095
              const clamp = (value: number) => Math.max(0, Math.min(maxVal, value))
              const cMin = clamp(row.min)
              const cPos = clamp(row.pos)
              const cMax = clamp(row.max)
              const leftPct = (cMin / maxVal) * 100
              const widthPct = Math.max(0, ((cMax - cMin) / maxVal) * 100)
              const posPct = (cPos / maxVal) * 100

              return (
                <div className="motor-row" id={`motor-row-${row.name}`} key={row.name}>
                  <div className="motor-name">{row.name}</div>
                  <div className="motor-track-wrap">
                    <div className="motor-track">
                      <div className="motor-range" id={`motor-range-${row.name}`} style={{ left: `${leftPct}%`, width: `${widthPct}%` }} />
                      <div className="motor-pos" id={`motor-pos-${row.name}`} style={{ left: `${posPct}%` }} />
                    </div>
                  </div>
                  <div className="motor-vals">
                    <div>
                      <span className="lbl">MIN</span>
                      <span className="val-min" id={`motor-vmin-${row.name}`}>{row.min}</span>
                    </div>
                    <div>
                      <span className="lbl">POS</span>
                      <span className="val-pos" id={`motor-vpos-${row.name}`}>{row.pos}</span>
                    </div>
                    <div>
                      <span className="lbl">MAX</span>
                      <span className="val-max" id={`motor-vmax-${row.name}`}>{row.max}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Paper>
    </Box>
  )
}
