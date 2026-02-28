import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Accordion, Badge, Box, Button, Group, NativeSelect, Paper, Table, Text, Title } from '@mantine/core'
import { apiGet, apiPost } from '../lib/api'
import type { DevicesResponse } from '../lib/types'
import { useLeStudioStore } from '../store'

interface DeviceSetupTabProps {
  active: boolean
}

interface RulesStatusResponse {
  rules_path?: string
  rules_installed: boolean
  install_needed?: boolean
  needs_root_for_install: boolean
  fallback_rules_path?: string
  fallback_rules_exists?: boolean
  sudo_noninteractive: boolean
  pkexec_available?: boolean
  graphical_session?: boolean
  gui_auth_available?: boolean
  manual_commands?: string[]
}

interface UdevRuleEntry {
  kernel?: string
  serial?: string
  symlink?: string
  mode?: string
  exists?: boolean | null
}

interface UdevRulesResponse {
  content?: string
  camera_rules?: UdevRuleEntry[]
  arm_rules?: UdevRuleEntry[]
}

const CAMERA_ROLE_OPTIONS = [
  { value: '(none)', label: 'Not used' },
  { value: 'top_cam_1', label: 'Top Camera 1' },
  { value: 'top_cam_2', label: 'Top Camera 2' },
  { value: 'top_cam_3', label: 'Top Camera 3' },
  { value: 'wrist_cam_1', label: 'Wrist Camera 1' },
  { value: 'wrist_cam_2', label: 'Wrist Camera 2' },
]

const ARM_ROLE_OPTIONS = [
  { value: '(none)', label: 'Not used' },
  { value: 'follower_arm_1', label: 'Follower Arm 1' },
  { value: 'follower_arm_2', label: 'Follower Arm 2' },
  { value: 'leader_arm_1', label: 'Leader Arm 1' },
  { value: 'leader_arm_2', label: 'Leader Arm 2' },
]

const DEFAULT_IDENTIFY_MESSAGE = 'Disconnect one arm, then click Start to begin identification.'

function parseRulesFromText(content: string): { cameraRules: UdevRuleEntry[]; armRules: UdevRuleEntry[] } {
  const cameraRules: UdevRuleEntry[] = []
  const armRules: UdevRuleEntry[] = []
  const seenCamera = new Set<string>()
  const seenArm = new Set<string>()
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))

  for (const line of lines) {
    if (line.includes('SUBSYSTEM=="video4linux"')) {
      const kernel = line.match(/KERNELS=="([^"]+)"/)?.[1] ?? '?'
      const symlink = line.match(/SYMLINK\+="([^"]+)"/)?.[1] ?? '?'
      const mode = line.match(/MODE="([^"]+)"/)?.[1] ?? '?'
      const key = `${kernel}:${symlink}`
      if (!seenCamera.has(key)) {
        seenCamera.add(key)
        cameraRules.push({ kernel, symlink, mode, exists: null })
      }
      continue
    }

    if (line.includes('SUBSYSTEM=="tty"')) {
      const serial = line.match(/ATTRS\{serial\}=="([^"]+)"/)?.[1] ?? '?'
      const symlink = line.match(/SYMLINK\+="([^"]+)"/)?.[1] ?? '?'
      const mode = line.match(/MODE="([^"]+)"/)?.[1] ?? '?'
      const key = `${serial}:${symlink}`
      if (!seenArm.has(key)) {
        seenArm.add(key)
        armRules.push({ serial, symlink, mode, exists: null })
      }
    }
  }

  return { cameraRules, armRules }
}

function cameraPreviewSrc(camPath: string, _useFallback?: boolean): string {
  void _useFallback
  const videoName = camPath.replace('/dev/', '')
  return `/stream/${encodeURIComponent(videoName)}?preview=1`
}

function statusBadge(exists: boolean | null | undefined) {
  if (exists === true) {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          border: '1px solid color-mix(in srgb, var(--green) 35%, transparent)',
          background: 'color-mix(in srgb, var(--green) 12%, transparent)',
          color: 'var(--green)',
          borderRadius: 999,
          padding: '2px 8px',
          fontSize: 11,
          fontWeight: 600,
        }}
      >
        Active
      </span>
    )
  }

  if (exists === false) {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          border: '1px solid color-mix(in srgb, var(--yellow) 35%, transparent)',
          background: 'color-mix(in srgb, var(--yellow) 12%, transparent)',
          color: 'var(--yellow)',
          borderRadius: 999,
          padding: '2px 8px',
          fontSize: 11,
          fontWeight: 600,
        }}
      >
        Inactive
      </span>
    )
  }

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        border: '1px solid var(--border)',
        background: 'var(--bg)',
        color: 'var(--text2)',
        borderRadius: 999,
        padding: '2px 8px',
        fontSize: 11,
      }}
    >
      Unknown
    </span>
  )
}

function formatModeDisplay(mode: string): string {
  if (mode === '0666') {
    return '✅ r/w'
  }
  return mode
}

function hasDuplicateRole(values: Record<string, string>): boolean {
  const seen = new Set<string>()
  for (const role of Object.values(values)) {
    if (!role || role === '(none)') continue
    if (seen.has(role)) return true
    seen.add(role)
  }
  return false
}

export function DeviceSetupTab({ active }: DeviceSetupTabProps) {
  const devices = useLeStudioStore((s) => s.devices)
  const setDevices = useLeStudioStore((s) => s.setDevices)
  const addToast = useLeStudioStore((s) => s.addToast)
  const setSidebarSignals = useLeStudioStore((s) => s.setSidebarSignals)
  const setActiveTab = useLeStudioStore((s) => s.setActiveTab)
  const [rulesStatus, setRulesStatus] = useState<RulesStatusResponse | null>(null)
  const [rulesReadable, setRulesReadable] = useState<UdevRulesResponse | null>(null)
  const [cameraAssignments, setCameraAssignments] = useState<Record<string, string>>({})
  const [armAssignments, setArmAssignments] = useState<Record<string, string>>({})
  const [previewEnabled, setPreviewEnabled] = useState<Record<string, boolean>>({})
  const [previewFallback, setPreviewFallback] = useState<Record<string, boolean>>({})
  const [identifyPanelOpen, setIdentifyPanelOpen] = useState(false)
  const [identifyRunning, setIdentifyRunning] = useState(false)
  const [identifyMessage, setIdentifyMessage] = useState(DEFAULT_IDENTIFY_MESSAGE)
  const [identifiedArmSerial, setIdentifiedArmSerial] = useState('')
  const [identifiedArmDevice, setIdentifiedArmDevice] = useState('')
  const [identifiedArmKernel, setIdentifiedArmKernel] = useState('')
  const [identifyRole, setIdentifyRole] = useState('follower_arm_1')
  const [rulesPanelOpen, setRulesPanelOpen] = useState(false)
  const [applyState, setApplyState] = useState<'idle' | 'applying' | 'applied' | 'error'>('idle')
  const [applyNote, setApplyNote] = useState('')
  const identifySnapshotRef = useRef<Array<{ device: string; serial: string; kernels: string }>>([])
  const identifyTimerRef = useRef<number | null>(null)
  const rulesApplyTimerRef = useRef<number | null>(null)
  const autoApplyReadyRef = useRef(false)

  const fetchRulesStatus = useCallback(async (): Promise<RulesStatusResponse> => {
    return await apiGet<RulesStatusResponse>('/api/rules/status')
  }, [])

  const fetchRulesReadable = useCallback(async (): Promise<UdevRulesResponse> => {
    return await apiGet<UdevRulesResponse>('/api/udev/rules')
  }, [])

  const clearRulesApplyTimer = useCallback(() => {
    if (rulesApplyTimerRef.current !== null) {
      window.clearTimeout(rulesApplyTimerRef.current)
      rulesApplyTimerRef.current = null
    }
  }, [])

  const applyRules = useCallback(
    async (nextCameraAssignments: Record<string, string>, nextArmAssignments: Record<string, string>, silent = true) => {
      if (hasDuplicateRole(nextCameraAssignments) || hasDuplicateRole(nextArmAssignments)) {
        if (!silent) addToast('Duplicate role assignments detected. Please use unique roles.', 'error')
        return false
      }

      try {
        setApplyState('applying')
        setApplyNote('Applying mapping...')
        const res = await apiPost<{ ok: boolean; error?: string }>('/api/rules/apply', {
          assignments: nextCameraAssignments,
          arm_assignments: nextArmAssignments,
        })
        if (!res.ok) {
          setApplyState('error')
          setApplyNote(res.error ?? 'Failed to apply mapping')
          if (!silent) addToast(`Failed to apply mapping: ${res.error ?? 'unknown error'}`, 'error')
          return false
        }
        setApplyState('applied')
        setApplyNote('Mapping applied')
        if (!silent) addToast('Mapping rules applied.', 'success')
        return true
      } catch (err) {
        setApplyState('error')
        setApplyNote(String(err))
        if (!silent) addToast(`Failed to apply mapping: ${String(err)}`, 'error')
        return false
      }
    },
    [addToast],
  )

  const scheduleRulesApply = useCallback(
    (nextCameraAssignments: Record<string, string>, nextArmAssignments: Record<string, string>, delay = 250) => {
      if (!autoApplyReadyRef.current) return
      clearRulesApplyTimer()
      rulesApplyTimerRef.current = window.setTimeout(() => {
        rulesApplyTimerRef.current = null
        void applyRules(nextCameraAssignments, nextArmAssignments, false)
      }, delay)
    },
    [applyRules, clearRulesApplyTimer],
  )

  const stopArmIdentify = useCallback(() => {
    if (identifyTimerRef.current !== null) {
      window.clearInterval(identifyTimerRef.current)
      identifyTimerRef.current = null
    }
    identifySnapshotRef.current = []
    setIdentifyRunning(false)
    setIdentifyMessage(DEFAULT_IDENTIFY_MESSAGE)
  }, [])

  const startArmIdentify = () => {
    stopArmIdentify()
    identifySnapshotRef.current = (devices.arms ?? []).map((arm) => ({
      device: arm.device ?? '',
      serial: arm.serial ?? '',
      kernels: arm.kernels ?? '',
    }))
    setIdentifyRunning(true)
    setIdentifyMessage('Reconnect the arm now... Waiting for changes...')
    setIdentifiedArmSerial('')
    setIdentifiedArmDevice('')
    setIdentifiedArmKernel('')

    identifyTimerRef.current = window.setInterval(async () => {
      try {
        const latest = await apiGet<DevicesResponse>('/api/devices')
        const oldDevices = new Set(identifySnapshotRef.current.map((item) => item.device))
        const appeared = (latest.arms ?? []).find((arm) => !oldDevices.has(arm.device ?? ''))
        if (!appeared) return

        stopArmIdentify()
        setIdentifyMessage('Arm detected! Assign a role below.')
        setIdentifiedArmSerial(appeared.serial ?? '')
        setIdentifiedArmDevice(appeared.device ?? '')
        setIdentifiedArmKernel(appeared.kernels ?? '')
        await refresh()
      } catch {
        return
      }
    }, 1500)
  }

  const assignIdentifiedArm = async () => {
    if (!identifiedArmSerial) {
      addToast('No serial number found. Use manual mapping above.', 'error')
      return
    }
    if (!identifyRole || identifyRole === '(none)') {
      addToast('Select a role before assigning.', 'error')
      return
    }

    const conflictEntry = Object.entries(armAssignments).find(
      ([serial, val]) => val === identifyRole && serial !== identifiedArmSerial,
    )
    let nextArmAssignments: Record<string, string>

    if (conflictEntry) {
      const [conflictSerial] = conflictEntry
      const conflictArm = devices.arms.find((a) => a.serial === conflictSerial)
      const conflictDevice = conflictArm?.device ?? conflictSerial
      const roleLabel = ARM_ROLE_OPTIONS.find((o) => o.value === identifyRole)?.label ?? identifyRole
      const oldRole = armAssignments[identifiedArmSerial] ?? '(none)'
      const oldLabel = ARM_ROLE_OPTIONS.find((o) => o.value === oldRole)?.label ?? oldRole

      const confirmed = window.confirm(
        `"${roleLabel}" is already assigned to /dev/${conflictDevice}.\n\nSwap roles?\n  /dev/${identifiedArmDevice}: ${oldLabel} \u2192 ${roleLabel}\n  /dev/${conflictDevice}: ${roleLabel} \u2192 ${oldLabel}`,
      )
      if (!confirmed) return

      nextArmAssignments = { ...armAssignments, [identifiedArmSerial]: identifyRole, [conflictSerial]: oldRole }
    } else {
      nextArmAssignments = { ...armAssignments, [identifiedArmSerial]: identifyRole }
    }

    setArmAssignments(nextArmAssignments)

    try {
      const res = await apiPost<{ ok: boolean; error?: string }>('/api/rules/apply', {
        assignments: cameraAssignments,
        arm_assignments: nextArmAssignments,
      })
      if (!res.ok) {
        addToast(`Assigned in UI but apply failed: ${res.error ?? 'unknown error'}`, 'error')
      } else {
        addToast(`Assigned serial ${identifiedArmSerial} -> ${identifyRole}`, 'success')
        await refresh()
      }
    } catch (err) {
      addToast(`Assigned in UI but apply request failed: ${String(err)}`, 'error')
    }
  }

  const refresh = useCallback(async () => {
    autoApplyReadyRef.current = false
    const [data, rs, rulesData] = await Promise.all([apiGet<DevicesResponse>('/api/devices'), fetchRulesStatus(), fetchRulesReadable()])
    setDevices({ cameras: data.cameras ?? [], arms: data.arms ?? [] })
    setRulesStatus(rs)
    setRulesReadable(rulesData)
    setRulesPanelOpen(!rs.rules_installed)
    setSidebarSignals({
      rulesNeedsInstall: !rs.rules_installed,
      rulesNeedsRoot: rs.needs_root_for_install,
      hasCameras: (data.cameras ?? []).length > 0,
      hasArms: (data.arms ?? []).length > 0,
    })
    const nextCameraMap: Record<string, string> = {}
    ;(data.cameras ?? []).forEach((camera) => {
      const kernels = camera.kernels ?? ''
      if (kernels) nextCameraMap[kernels] = camera.symlink ?? '(none)'
    })
    setCameraAssignments(nextCameraMap)

    const nextArmMap: Record<string, string> = {}
    ;(data.arms ?? []).forEach((arm) => {
      const serial = arm.serial ?? ''
      if (serial) nextArmMap[serial] = arm.symlink ?? '(none)'
    })
    setArmAssignments(nextArmMap)
    setApplyState('idle')
    setApplyNote('')
    autoApplyReadyRef.current = true
  }, [fetchRulesReadable, fetchRulesStatus, setDevices, setSidebarSignals])

  useEffect(() => {
    if (!active) return
    refresh()
  }, [active, refresh])

  useEffect(() => {
    if (active) return
    clearRulesApplyTimer()
    setPreviewEnabled({})
    setPreviewFallback({})
    stopArmIdentify()
  }, [active, clearRulesApplyTimer, stopArmIdentify])

  useEffect(() => {
    return () => {
      clearRulesApplyTimer()
      stopArmIdentify()
    }
  }, [clearRulesApplyTimer, stopArmIdentify])


  const { cameraRules, armRules } = useMemo(() => {
    const fromApiCamera = (rulesReadable?.camera_rules ?? []).map((row) => ({
      kernel: row.kernel ?? '?',
      symlink: row.symlink ?? '?',
      mode: row.mode ?? '?',
      exists: typeof row.exists === 'boolean' ? row.exists : null,
    }))
    const fromApiArm = (rulesReadable?.arm_rules ?? []).map((row) => ({
      serial: row.serial ?? '?',
      symlink: row.symlink ?? '?',
      mode: row.mode ?? '?',
      exists: typeof row.exists === 'boolean' ? row.exists : null,
    }))

    // Deduplicate by serial:symlink key to prevent duplicate rows from server
    const deduplicatedArm = fromApiArm.filter((row, idx, arr) => {
      const key = `${row.serial}:${row.symlink}`
      return arr.findIndex((r) => `${r.serial}:${r.symlink}` === key) === idx
    })
    const deduplicatedCamera = fromApiCamera.filter((row, idx, arr) => {
      const key = `${row.kernel}:${row.symlink}`
      return arr.findIndex((r) => `${r.kernel}:${r.symlink}` === key) === idx
    })

    if (deduplicatedCamera.length > 0 || deduplicatedArm.length > 0) {
      return { cameraRules: deduplicatedCamera, armRules: deduplicatedArm }
    }
    return parseRulesFromText(rulesReadable?.content ?? '')
  }, [rulesReadable])

  const cameraMappable = useMemo(
    () => devices.cameras.filter((camera) => !!camera.kernels),
    [devices.cameras],
  )

  const armMappable = useMemo(
    () => devices.arms.filter((arm) => !!arm.serial),
    [devices.arms],
  )

  const cameraAssignedCount = useMemo(
    () => cameraMappable.filter((camera) => {
      const key = camera.kernels ?? ''
      const role = cameraAssignments[key] ?? '(none)'
      return role !== '(none)'
    }).length,
    [cameraAssignments, cameraMappable],
  )

  const armAssignedCount = useMemo(
    () => armMappable.filter((arm) => {
      const key = arm.serial ?? ''
      const role = armAssignments[key] ?? '(none)'
      return role !== '(none)'
    }).length,
    [armAssignments, armMappable],
  )

  const hasCameraDuplicates = useMemo(
    () => hasDuplicateRole(cameraAssignments),
    [cameraAssignments],
  )

  const hasArmDuplicates = useMemo(
    () => hasDuplicateRole(armAssignments),
    [armAssignments],
  )

  const cameraRolesReady = cameraMappable.length === 0 || cameraAssignedCount === cameraMappable.length
  const armRolesReady = armMappable.length === 0 || armAssignedCount === armMappable.length

  const mappingBlockers = useMemo(() => {
    const blockers: string[] = []
    if (rulesStatus && !rulesStatus.rules_installed) blockers.push('udev rules not installed')
    if (!cameraRolesReady) blockers.push(`Unassigned camera roles (${cameraMappable.length - cameraAssignedCount})`)
    if (!armRolesReady) blockers.push(`Unassigned arm roles (${armMappable.length - armAssignedCount})`)
    if (hasCameraDuplicates || hasArmDuplicates) blockers.push('Duplicate role assignments found')
    if (devices.arms.length === 0) blockers.push('No arms detected')
    return blockers
  }, [
    rulesStatus,
    cameraRolesReady,
    cameraMappable.length,
    cameraAssignedCount,
    armRolesReady,
    armMappable.length,
    armAssignedCount,
    hasCameraDuplicates,
    hasArmDuplicates,
    devices.arms.length,
  ])

  const mappingComplete =
    (cameraMappable.length === 0 || cameraAssignedCount === cameraMappable.length) &&
    (armMappable.length === 0 || armAssignedCount === armMappable.length) &&
    !hasCameraDuplicates &&
    !hasArmDuplicates

  const canOneClickInstall = !!(
    rulesStatus
    && !rulesStatus.rules_installed
    && (rulesStatus.sudo_noninteractive || rulesStatus.gui_auth_available)
  )

  const renderRulesTable = (title: string, portHeader: string, rows: Array<{ port: string; symlink: string; mode: string; exists?: boolean | null }>) => {
    const symlinkCounts: Record<string, number> = {}
    for (const row of rows) {
      if (row.symlink && row.symlink !== '?') {
        symlinkCounts[row.symlink] = (symlinkCounts[row.symlink] ?? 0) + 1
      }
    }
    return (
      <div className="rules-section">
        <div className="rules-section-title">{title}</div>
        {rows.length === 0 ? (
          <div className="rules-empty">No {title.toLowerCase()} found.</div>
        ) : (
          <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg2)' }}>
            <Table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 12 }}>
              <Table.Thead>
                <Table.Tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg3)' }}>
                  <Table.Th style={{ padding: '8px 12px', color: 'var(--text2)', fontWeight: 600 }}>{portHeader}</Table.Th>
                  <Table.Th style={{ padding: '8px 12px', color: 'var(--text2)', fontWeight: 600 }}>SYMLINK</Table.Th>
                  <Table.Th style={{ padding: '8px 12px', color: 'var(--text2)', fontWeight: 600 }}>MODE</Table.Th>
                  <Table.Th style={{ padding: '8px 12px', color: 'var(--text2)', fontWeight: 600 }}>STATUS</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((row, index) => (
                  <Table.Tr
                    key={`${title}-${row.port}-${row.symlink}-${index}`}
                    style={{
                      borderBottom: index !== rows.length - 1 ? '1px solid var(--border)' : undefined,
                      opacity: row.exists === false ? 0.6 : 1,
                    }}
                  >
                    <Table.Td style={{ padding: '8px 12px', fontFamily: 'var(--mono)' }}>{row.port}</Table.Td>
                    <Table.Td style={{ padding: '8px 12px', fontFamily: 'var(--mono)', color: 'var(--text)', fontWeight: 600 }}>
                      {row.symlink}
                      {(symlinkCounts[row.symlink] ?? 0) > 1 && (
                        <span style={{ marginLeft: 6, fontSize: 10, fontFamily: 'sans-serif', padding: '1px 6px', borderRadius: 999, background: 'color-mix(in srgb, var(--yellow) 15%, transparent)', color: 'var(--yellow)', border: '1px solid color-mix(in srgb, var(--yellow) 35%, transparent)', fontWeight: 600 }}>
                          ⚠ Duplicate
                        </span>
                      )}
                    </Table.Td>
                    <Table.Td style={{ padding: '8px 12px', fontFamily: 'var(--mono)' }}>{formatModeDisplay(row.mode)}</Table.Td>
                    <Table.Td style={{ padding: '8px 12px' }}>{statusBadge(row.exists)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </div>
        )}
      </div>
    )
  }

  return (
    <Box id="tab-device-setup" className={`tab ${active ? 'active' : ''}`} style={{ display: active ? 'block' : 'none' }}>
      <Group className="section-header" mb="md" align="center">
        <Title order={2}>Device Mapping</Title>
        <Badge variant="light" color={mappingComplete ? 'green' : 'yellow'}>
          {mappingComplete ? 'Mapping Ready' : 'Mapping Incomplete'}
        </Badge>
        <Button onClick={refresh} size="xs" variant="light">
          ↺ Refresh
        </Button>
      </Group>

      {!mappingComplete ? (
        <div className="mapping-blocker-card">
          <div className="dsub" style={{ marginBottom: 6 }}>Mapping blocked:</div>
          <div className="mapping-blocker-chip-row">
            {mappingBlockers.map((blocker) => (
              <span key={blocker} className="dbadge badge-warn">{blocker}</span>
            ))}
          </div>
          <div className="mapping-blocker-actions">
            {rulesStatus && !rulesStatus.rules_installed ? (
              <Button type="button" className="link-btn" variant="subtle" size="compact-xs" onClick={() => setRulesPanelOpen(true)}>→ Open Rules Details</Button>
            ) : null}
            <Button type="button" className="link-btn" variant="subtle" size="compact-xs" onClick={() => setActiveTab('motor-setup')}>→ Open Motor Setup</Button>
            <Button type="button" className="link-btn" variant="subtle" size="compact-xs" onClick={() => setActiveTab('calibrate')}>→ Go to Calibration</Button>
          </div>
        </div>
      ) : null}

      <Paper withBorder p="md" mb="md" className="card" id="rules-card">
        <Text size="sm" fw={600} c="dimmed" mb="xs">udev Rules</Text>
        <div id="rules-install-status">
          {rulesStatus ? (
            rulesStatus.rules_installed ? (
              <span>
                <span style={{ color: 'var(--green)', fontWeight: 600 }}>✓</span> udev rules installed at{' '}
                <code style={{ fontFamily: 'var(--mono)', fontSize: 11, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 6px' }}>
                  {rulesStatus.rules_path ?? '(unknown path)'}
                </code>
              </span>
            ) : canOneClickInstall ? (
              <span>
                <span style={{ color: 'var(--yellow)', fontWeight: 600 }}>⚠</span> udev rules are not installed yet. One-click install is available in this tab.{' '}
                {rulesStatus.gui_auth_available ? 'A desktop authentication popup may appear.' : 'No terminal required when non-interactive sudo is configured.'}
              </span>
            ) : rulesStatus.needs_root_for_install ? (
              <span>
                <span style={{ color: 'var(--yellow)', fontWeight: 600 }}>⚠</span> udev rules are not installed. Root permission required. Run:{' '}
                <code style={{ fontFamily: 'var(--mono)', fontSize: 11, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 6px' }}>
                  lestudio install-udev
                </code>
              </span>
            ) : (
              <span>⏳ checking udev install status…</span>
            )
          ) : (
            'Checking udev install status...'
          )}
        </div>

        {/* Install Details — only shown when rules are NOT installed (needs root) */}
        {rulesStatus && !rulesStatus.rules_installed && rulesStatus.needs_root_for_install && (
          <div id="rules-detail" style={{ marginTop: 10 }}>
            <div className="rules-readable">
              <div className="rules-section">
                <div className="rules-section-title">Install Details</div>
                <div className="rules-item">
                  <div className="rules-item-key">Install Path</div>
                  <div className="rules-item-value">{rulesStatus?.rules_path ?? '(checking...)'}</div>
                </div>
                <div className="rules-item">
                  <div className="rules-item-key">Fallback Path</div>
                  <div className="rules-item-value">{rulesStatus?.fallback_rules_path ?? '(unknown)'}</div>
                </div>
                <div className="rules-item">
                  <div className="rules-item-key">Recommended</div>
                  <div className="rules-item-value">
                    <code style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>lestudio install-udev</code>
                  </div>
                </div>
                {canOneClickInstall && (
                  <div className="rules-item">
                    <div className="rules-item-key">One-click</div>
                    <div className="rules-item-value">
                      <Button
                        type="button"
                        variant="light"
                        disabled={applyState === 'applying'}
                        onClick={() => {
                          void applyRules(cameraAssignments, armAssignments, false)
                        }}
                      >
                        {applyState === 'applying' ? 'Installing...' : 'Install Rules Now'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <Accordion
          variant="contained"
          className="advanced-panel"
          id="rules-advanced-panel"
          style={{ marginTop: 16, padding: 0 }}
          value={rulesPanelOpen ? 'advanced' : null}
          onChange={(val) => setRulesPanelOpen(val === 'advanced')}
        >
          <Accordion.Item value="advanced">
            <Accordion.Control>
              <span className="rules-summary-title">
                <span>Current Active Rules</span>
                <span className="rules-summary-caret" aria-hidden="true">{rulesPanelOpen ? '▾' : '▸'}</span>
              </span>
              <span className="rules-summary-meta">{rulesPanelOpen ? 'Hide details' : 'Show details'}</span>
            </Accordion.Control>
            <Accordion.Panel>
              {rulesPanelOpen ? (
                <div className="rules-readable" style={{ marginTop: 10 }}>
                  <div className="mapping-rules-grid">
                    {renderRulesTable(
                      'Camera Rules',
                      'USB PORT (KERNELS)',
                      cameraRules.map((row) => ({
                        port: row.kernel ?? '?',
                        symlink: row.symlink ?? '?',
                        mode: row.mode ?? '?',
                        exists: row.exists,
                      })),
                    )}
                    {renderRulesTable(
                      'ARM Rules',
                      'SERIAL',
                      armRules.map((row) => ({
                        port: row.serial ?? '?',
                        symlink: row.symlink ?? '?',
                        mode: row.mode ?? '?',
                        exists: row.exists,
                      })),
                    )}
                  </div>
                </div>
              ) : null}
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      </Paper>

      <Paper withBorder p="md" mb="md" className="card" style={{ marginTop: 0 }}>
        <Text size="sm" fw={600} c="dimmed" mb="xs">Mapping Checklist</Text>
        <div className="device-list">
          <div className="device-item" style={{ justifyContent: 'space-between' }}>
            <div className="dname">Camera roles</div>
            <span className={`dbadge ${cameraMappable.length === 0 ? 'badge-idle' : cameraRolesReady ? 'badge-ok' : 'badge-warn'}`}>
              {cameraAssignedCount}/{cameraMappable.length || 0}
            </span>
          </div>
          <div className="device-item" style={{ justifyContent: 'space-between' }}>
            <div className="dname">Arm roles</div>
            <span className={`dbadge ${armMappable.length === 0 ? 'badge-idle' : armRolesReady ? 'badge-ok' : 'badge-warn'}`}>
              {armAssignedCount}/{armMappable.length || 0}
            </span>
          </div>
          <div className="device-item" style={{ justifyContent: 'space-between' }}>
            <div className="dname">Duplicate roles</div>
            <span className={`dbadge ${(!hasCameraDuplicates && !hasArmDuplicates) ? 'badge-ok' : 'badge-err'}`}>
              {(!hasCameraDuplicates && !hasArmDuplicates) ? 'none' : 'found'}
            </span>
          </div>
          <div className="device-item" style={{ justifyContent: 'space-between' }}>
            <div className="dname">Apply status</div>
            <span className={`dbadge ${applyState === 'error' ? 'badge-err' : applyState === 'applied' ? 'badge-ok' : applyState === 'applying' ? 'badge-run' : 'badge-idle'}`}>
              {applyState.toUpperCase()}
            </span>
          </div>
          {applyNote ? <div className="dsub">{applyNote}</div> : null}
          {mappingComplete && (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
              {armMappable.length === 0 ? (
                <Button type="button" className="link-btn" variant="subtle" size="compact-xs" onClick={() => setActiveTab('motor-setup')}>→ Open Motor Setup</Button>
              ) : (
                <>
                  <Button type="button" className="link-btn" variant="subtle" size="compact-xs" onClick={() => setActiveTab('teleop')}>→ Proceed to Teleop</Button>
                  <Button type="button" className="link-btn" variant="subtle" size="compact-xs" onClick={() => setActiveTab('record')}>→ Proceed to Record</Button>
                </>
              )}
            </div>
          )}
        </div>
      </Paper>

      <Paper withBorder p="md" mb="md" className="card">
        <Text size="sm" fw={600} c="dimmed" mb="xs">Arm Port Mapping</Text>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div className="field-help" style={{ marginBottom: 0 }}>
            Assign stable symlink names to each detected arm by serial number.
          </div>
          {devices.arms.length > 0 ? (
            <Button size="compact-xs" variant="light" onClick={() => setIdentifyPanelOpen((prev) => !prev)}>
              🔍 Identify Arm
            </Button>
          ) : null}
        </div>

        {identifyPanelOpen && devices.arms.length > 0 && (
          <div id="arm-identify-panel" style={{ marginBottom: 14, padding: 14, background: 'color-mix(in srgb, var(--accent) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)', borderRadius: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 10, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text1)' }}>🔍 Arm Identify Wizard</div>
                <div id="arm-identify-msg" style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>
                  {identifyMessage}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {!identifyRunning ? (
                  <Button id="arm-identify-start-btn" variant="light" onClick={startArmIdentify}>
                    Start Identify
                  </Button>
                ) : (
                  <Button id="arm-identify-stop-btn" size="compact-xs" variant="light" onClick={stopArmIdentify}>
                    Cancel
                  </Button>
                )}
              </div>
            </div>

            {identifiedArmDevice ? (
              <div id="arm-identify-result" style={{ display: 'block' }}>
                <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, padding: 14, marginTop: 10 }}>
                  <div style={{ fontWeight: 600, marginBottom: 8, color: 'var(--green)' }}>✓ Identified: /dev/{identifiedArmDevice}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: 12, marginBottom: 12 }}>
                    <span style={{ color: 'var(--text2)' }}>Serial:</span>
                    <code>{identifiedArmSerial || 'N/A'}</code>
                    <span style={{ color: 'var(--text2)' }}>Kernels:</span>
                    <code>{identifiedArmKernel || 'N/A'}</code>
                    <span style={{ color: 'var(--text2)' }}>Path:</span>
                    <code>/dev/{identifiedArmDevice}</code>
                  </div>

                  {identifiedArmSerial ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <NativeSelect id="arm-identify-role" style={{ flex: 1 }} value={identifyRole} onChange={(e) => setIdentifyRole(e.target.value)} data={ARM_ROLE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))} />
                      <Button variant="light" onClick={assignIdentifiedArm}>
                        Assign
                      </Button>
                    </div>
                  ) : (
                    <div style={{ color: 'var(--yellow)', fontSize: 12 }}>⚠ No serial number - cannot auto-assign. Use manual mapping below.</div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        )}

        <div id="device-arms-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20 }}>
          {devices.arms.length === 0
            ? (
              <div className="mapping-arms-empty-state">
                <span>No arms detected. Connect a USB arm and click Refresh.</span>
                <div className="mapping-arms-empty-actions">
                  <Button type="button" className="link-btn" variant="subtle" size="compact-xs" onClick={() => setActiveTab('motor-setup')}>→ Open Motor Setup</Button>
                  <Button type="button" className="link-btn" variant="subtle" size="compact-xs" onClick={() => setActiveTab('calibrate')}>→ Go to Calibration</Button>
                </div>
              </div>
            )
            : devices.arms.map((arm, idx) => (
                <div className="arm-card" key={`${arm.device ?? 'arm'}-${idx}`} style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.2)', border: '1px solid var(--border)', borderRadius: 8, padding: 14, background: 'var(--bg-card)' }}>
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>/dev/{arm.device ?? '?'}</div>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
                    Serial: <code>{arm.serial ?? 'N/A'}</code>
                  </div>
                  <NativeSelect
                    disabled={!arm.serial}
                    value={(arm.serial && armAssignments[arm.serial]) ?? '(none)'}
                    onChange={(e) => {
                      if (!arm.serial) return
                      const newRole = e.target.value
                      const oldRole = armAssignments[arm.serial] ?? '(none)'

                      if (newRole !== '(none)') {
                        const conflictEntry = Object.entries(armAssignments).find(
                          ([serial, val]) => val === newRole && serial !== arm.serial,
                        )
                        if (conflictEntry) {
                          const [conflictSerial] = conflictEntry
                          const conflictArm = devices.arms.find((a) => a.serial === conflictSerial)
                          const conflictDevice = conflictArm?.device ?? conflictSerial
                          const newLabel = ARM_ROLE_OPTIONS.find((o) => o.value === newRole)?.label ?? newRole
                          const oldLabel = ARM_ROLE_OPTIONS.find((o) => o.value === oldRole)?.label ?? oldRole

                          const confirmed = window.confirm(
                            `"${newLabel}" is already assigned to /dev/${conflictDevice}.\n\nSwap roles?\n  /dev/${arm.device ?? '?'}: ${oldLabel} \u2192 ${newLabel}\n  /dev/${conflictDevice}: ${newLabel} \u2192 ${oldLabel}`,
                          )
                          if (!confirmed) return

                          const nextArmAssignments = { ...armAssignments, [arm.serial]: newRole, [conflictSerial]: oldRole }
                          setArmAssignments(nextArmAssignments)
                          scheduleRulesApply(cameraAssignments, nextArmAssignments)
                          return
                        }
                      }

                      const nextArmAssignments = { ...armAssignments, [arm.serial]: newRole }
                      setArmAssignments(nextArmAssignments)
                      scheduleRulesApply(cameraAssignments, nextArmAssignments)
                    }}
                    data={ARM_ROLE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                  />
                </div>
              ))}
        </div>
      </Paper>

      <Paper withBorder p="md" mb="md" className="card">
        <Text size="sm" fw={600} c="dimmed" mb="xs">Camera Mapping</Text>
        <div
          style={{
            background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
            border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)',
            borderRadius: 6,
            padding: '8px 12px',
            fontSize: 12,
            color: 'var(--accent)',
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            lineHeight: 1.5,
            marginBottom: 14,
          }}
        >
          <span style={{ flexShrink: 0 }}>ℹ️</span>
          <span>Previews run in bandwidth-safe mode (fixed 144p @ 5fps) to keep multi-camera mapping stable.</span>
        </div>
        <div id="device-cameras-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20 }}>
          {devices.cameras.length === 0
            ? 'Loading…'
            : devices.cameras.map((camera, idx) => (
                <div className="cam-card" key={`${camera.device ?? 'cam'}-${idx}`}>
                  <div
                    className="cam-preview-wrap"
                    onClick={() => {
                      const key = `${camera.device ?? ''}:${camera.kernels ?? idx}`
                      setPreviewEnabled((prev) => {
                        const nextEnabled = !prev[key]
                        if (!nextEnabled) {
                          setPreviewFallback((prevFallback) => ({ ...prevFallback, [key]: false }))
                        }
                        return { ...prev, [key]: nextEnabled }
                      })
                    }}
                  >
                    <div style={{ position: 'absolute', top: 8, left: 8, padding: '3px 8px', borderRadius: 999, background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 11, fontWeight: 600, letterSpacing: 0.2 }}>
                      Preview 144p · 5fps
                    </div>
                    {previewEnabled[`${camera.device ?? ''}:${camera.kernels ?? idx}`] ? (
                      <img
                        src={cameraPreviewSrc(camera.path ?? `/dev/${camera.device ?? ''}`, previewFallback[`${camera.device ?? ''}:${camera.kernels ?? idx}`] === true)}
                        alt={`/dev/${camera.device ?? '?'}`}
                        onError={() => {
                          const key = `${camera.device ?? ''}:${camera.kernels ?? idx}`
                          setPreviewFallback((prev) => ({ ...prev, [key]: true }))
                        }}
                      />
                    ) : (
                      <Button variant="light" style={{ opacity: 0.9, padding: '10px 20px', fontSize: 14, borderRadius: 20, pointerEvents: 'none' }}>
                        ▶ View Preview
                      </Button>
                    )}
                  </div>
                  <div className="cam-info">
                    <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6, color: 'var(--text1)' }}>Where is this camera?</div>
                    <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 10 }}>If this camera is not needed, choose "Not used".</div>
                    <NativeSelect
                      value={cameraAssignments[camera.kernels ?? ''] ?? '(none)'}
                      disabled={!camera.kernels}
                      onChange={(e) => {
                        const key = camera.kernels ?? ''
                        if (!key) return
                        const nextCameraAssignments = { ...cameraAssignments, [key]: e.target.value }
                        setCameraAssignments(nextCameraAssignments)
                        scheduleRulesApply(nextCameraAssignments, armAssignments)
                      }}
                      data={CAMERA_ROLE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                    />


                    <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text2)', background: 'var(--bg-app)', padding: 8, borderRadius: 4, border: '1px solid var(--border)' }}>
                      <span title="USB Port ID">
                        🔌 Port: <strong style={{ color: 'var(--text1)' }}>{camera.kernels ?? '?'}</strong>
                      </span>
                      <span className="cam-name">/dev/{camera.device ?? '?'}</span>
                    </div>
                    <div className="cam-meta" style={{ marginTop: 8 }}>
                      Path: {camera.path ?? `/dev/${camera.device ?? '?'}`}
                    </div>
                  </div>
                </div>
              ))}
        </div>
      </Paper>
    </Box>
  )
}
