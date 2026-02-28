import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Box, Button, Group, Text, Title } from '@mantine/core'
import { ProcessButtons } from '../components/shared/ProcessButtons'
import { EvalConfigPanel } from '../components/eval/EvalConfigPanel'
import { EvalProgressPanel } from '../components/eval/EvalProgressPanel'
import { getProcessConflict } from '../lib/processConflicts'
import { useMappedCameras } from '../hooks/useMappedCameras'
import { useConfig } from '../hooks/useConfig'
import { useProcess } from '../hooks/useProcess'
import { useEvalCheckpoint } from '../hooks/useEvalCheckpoint'
import { useEvalProgress } from '../hooks/useEvalProgress'
import { apiGet, apiPost } from '../lib/api'
import { useLeStudioStore } from '../store'
import type { DatasetListItem, LogLine } from '../lib/types'

const EMPTY_EVAL_LINES: LogLine[] = []

interface EvalTabProps {
  active: boolean
}

export function EvalTab({ active }: EvalTabProps) {
  const running = useLeStudioStore((s) => !!s.procStatus.eval)
  const installing = useLeStudioStore((s) => !!s.procStatus.train_install)
  const procStatus = useLeStudioStore((s) => s.procStatus)
  const evalLogLines = useLeStudioStore((s) => s.logLines.eval ?? EMPTY_EVAL_LINES)
  const appendLog = useLeStudioStore((s) => s.appendLog)
  const addToast = useLeStudioStore((s) => s.addToast)
  const setActiveTab = useLeStudioStore((s) => s.setActiveTab)
  const hfUsername = useLeStudioStore((s) => s.hfUsername)

  const { config, buildConfig } = useConfig()
  const { stopProcess } = useProcess()
  const { mappedCameras } = useMappedCameras()
  const mappedCamEntries = useMemo(() => Object.entries(mappedCameras), [mappedCameras])
  const conflictReason = getProcessConflict('eval', procStatus)

  const [cameraMapping, setCameraMapping] = useState<Record<string, string>>({})
  const [policySource, setPolicySource] = useState<'local' | 'hf'>('local')
  const [datasetSource, setDatasetSource] = useState<'local' | 'hf'>('hf')
  const [datasets, setDatasets] = useState<DatasetListItem[]>([])

  const [preflightOk, setPreflightOk] = useState(true)
  const [preflightReason, setPreflightReason] = useState('')
  const [preflightAction, setPreflightAction] = useState('')
  const [preflightCommand, setPreflightCommand] = useState('')
  const autoInstallCommandRef = useRef('')

  const [gymInstallCommand, setGymInstallCommand] = useState('')
  const [gymModuleName, setGymModuleName] = useState('')

  const { checkpoints, envTypes, envTypeFromCheckpoint, envTaskFromCheckpoint, imageKeysFromCheckpoint, applyCheckpointEnv, loadCheckpoints } = useEvalCheckpoint({ active, policySource, config, buildConfig })
  const { progressStatus, setProgressStatus, doneEpisodes, meanReward, successRate, finalReward, finalSuccess, bestEpisode, worstEpisode, startedAtMs, endedAtMs, setEndedAtMs, elapsedTick, lastMetricUpdateMs, progressTotal, progressPct, showProgressDetails, progressStatusStyle, beginEval, markError } = useEvalProgress({ evalLogLines, running })

  const refreshPreflight = useCallback(async () => {
    const device = config.eval_device ?? 'cuda'
    const res = await apiGet<{ ok: boolean; reason?: string; action?: string; command?: string }>(`/api/train/preflight?device=${encodeURIComponent(device)}`)
    const next = { ok: !!res.ok, reason: res.reason ?? '', action: res.action ?? '', command: res.command ?? '' }
    setPreflightOk(next.ok)
    setPreflightReason(next.reason)
    setPreflightAction(next.action)
    setPreflightCommand(next.command)
    return next
  }, [config.eval_device])

  const refreshDatasets = useCallback(async () => {
    const res = await apiGet<{ datasets: DatasetListItem[] }>('/api/datasets')
    setDatasets(res.datasets ?? [])
  }, [])

  const installCudaTorch = useCallback(async () => {
    appendLog('eval', '[INFO] Starting PyTorch CUDA installer from GUI...', 'info')
    try {
      const res = await apiPost<{ ok: boolean; error?: string }>('/api/train/install_pytorch', { nightly: true, cuda_tag: 'cu128' })
      if (!res.ok) return appendLog('eval', `[ERROR] ${res.error ?? 'Failed to start CUDA installer.'}`, 'error')
      addToast('CUDA PyTorch install started', 'info')
    } catch (e) {
      appendLog('eval', `[ERROR] ${e instanceof Error ? e.message : 'Installer request failed.'}`, 'error')
    }
  }, [addToast, appendLog])

  const installGymPlugin = useCallback(async () => {
    if (!gymInstallCommand) return
    appendLog('eval', `[INFO] Installing ${gymModuleName}: ${gymInstallCommand}`, 'info')
    try {
      const res = await apiPost<{ ok: boolean; error?: string }>('/api/train/install_torchcodec_fix', { command: gymInstallCommand })
      if (!res.ok) return appendLog('eval', `[ERROR] ${res.error ?? 'Failed to start gym plugin installer.'}`, 'error')
      addToast(`Installing ${gymModuleName} — check console`, 'info')
    } catch (e) {
      appendLog('eval', `[ERROR] ${e instanceof Error ? e.message : 'Installer request failed.'}`, 'error')
    }
  }, [addToast, appendLog, gymInstallCommand, gymModuleName])

  const runPreflightFix = useCallback(async (opts?: { auto?: boolean }) => {
    if (!preflightCommand) return
    const isAuto = !!opts?.auto
    appendLog('eval', isAuto && preflightAction === 'install_python_dep' ? '[INFO] Auto-installing missing Python packages in background...' : `[INFO] Running: ${preflightCommand}`, 'info')
    try {
      const res = await apiPost<{ ok: boolean; error?: string }>('/api/train/install_torchcodec_fix', { command: preflightCommand })
      if (!res.ok) return appendLog('eval', `[ERROR] ${res.error ?? 'Failed to start installer.'}`, 'error')
      addToast(isAuto && preflightAction === 'install_python_dep' ? 'Auto-install started — check console for progress' : 'Fix installer started — check console for progress', 'info')
    } catch (e) { appendLog('eval', `[ERROR] ${e instanceof Error ? e.message : 'Installer request failed.'}`, 'error') }
  }, [addToast, appendLog, preflightAction, preflightCommand])

  const totalEpisodes = Number(config.eval_episodes ?? 10)
  const configuredDatasetId = useMemo(() => {
    const configured = (config.eval_repo_id ?? '').trim()
    return configured === 'user/my-dataset' || configured === '__none__' ? '' : configured
  }, [config.eval_repo_id])
  const localDatasetId = useMemo(() => {
    if (configuredDatasetId && datasets.some((ds) => ds.id === configuredDatasetId)) return configuredDatasetId
    return '__none__'
  }, [configuredDatasetId, datasets])
  const repoId = datasetSource === 'local' ? (localDatasetId === '__none__' ? '' : localDatasetId) : configuredDatasetId
  const repoError = useMemo(() => {
    const repo = repoId.trim()
    if (!repo) return ''
    return /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo) ? '' : 'Dataset Repo ID must be username/dataset format.'
  }, [repoId])

  const envTypeValue = (config.eval_env_type ?? '').trim()
  const envTaskValue = config.eval_task ?? ''
  const envTypeMissing = !envTypeValue && !envTypeFromCheckpoint
  const envTaskMissing = !envTaskValue && !envTaskFromCheckpoint
  const noLocalCheckpoint = policySource === 'local' && !config.eval_policy_path
  const evalReady = preflightOk && !repoError && !conflictReason && !noLocalCheckpoint && !envTypeMissing && !envTaskMissing
  const preflightFixLabel = preflightAction === 'install_python_dep' ? 'Install Missing Python Packages' : 'Run Fix'
  const evalBlockers = useMemo(() => {
    const blockers: string[] = []
    if (!preflightOk) blockers.push(preflightReason || 'Device preflight failed')
    if (repoError) blockers.push(repoError)
    if (noLocalCheckpoint) blockers.push('No checkpoint selected')
    if (envTypeMissing) blockers.push('Env Type is required')
    if (envTaskMissing) blockers.push('Task is required')
    if (conflictReason) blockers.push(`${conflictReason} process running`)
    return blockers
  }, [conflictReason, envTaskMissing, envTypeMissing, noLocalCheckpoint, preflightOk, preflightReason, repoError])

  const handleSetPolicySource = (newSource: 'local' | 'hf') => {
    setPolicySource(newSource)
    if (newSource === 'local') {
      const currentPath = config.eval_policy_path ?? ''
      if (!checkpoints.some((cp) => cp.path === currentPath)) void buildConfig({ eval_policy_path: checkpoints[0]?.path ?? '' })
    } else {
      void buildConfig({ eval_policy_path: '' })
    }
  }

  const handleSetDatasetSource = (newSource: 'local' | 'hf') => {
    setDatasetSource(newSource)
    if (newSource === 'local') {
      const currentId = config.eval_repo_id ?? ''
      if (!datasets.some((ds) => ds.id === currentId)) void buildConfig({ eval_repo_id: '' })
    } else {
      void buildConfig({ eval_repo_id: '' })
    }
  }

  useEffect(() => {
    if (!active) return
    void loadCheckpoints()
    void refreshDatasets()
    void refreshPreflight()
  }, [active, loadCheckpoints, refreshDatasets, refreshPreflight])

  useEffect(() => {
    if (!active || preflightOk) return
    const timer = window.setInterval(() => { void refreshPreflight() }, 5000)
    return () => window.clearInterval(timer)
  }, [active, preflightOk, refreshPreflight])

  useEffect(() => {
    if (preflightOk) {
      autoInstallCommandRef.current = ''
      return
    }
    if (!active || installing || preflightAction !== 'install_python_dep' || !preflightCommand) return
    if (autoInstallCommandRef.current === preflightCommand) return
    autoInstallCommandRef.current = preflightCommand
    void runPreflightFix({ auto: true })
  }, [active, installing, preflightAction, preflightCommand, preflightOk, runPreflightFix])

  useEffect(() => {
    if (!imageKeysFromCheckpoint.length) return setCameraMapping({})
    setCameraMapping((prev) => {
      const next: Record<string, string> = {}
      for (const key of imageKeysFromCheckpoint) {
        if (prev[key] && mappedCamEntries.some(([sym]) => sym === prev[key])) next[key] = prev[key]
        else next[key] = mappedCamEntries.find(([sym]) => sym === key)?.[0] ?? (mappedCamEntries[0]?.[0] ?? '')
      }
      return next
    })
  }, [imageKeysFromCheckpoint, mappedCamEntries])

  const start = async (episodesOverride?: number) => {
    try {
      const cfg = {
        eval_policy_path: config.eval_policy_path ?? 'outputs/train/checkpoints/last/pretrained_model',
        eval_repo_id: repoId,
        eval_env_type: config.eval_env_type ?? '',
        eval_episodes: Number(episodesOverride ?? Number(config.eval_episodes ?? 10)),
        eval_device: config.eval_device ?? 'cuda',
        eval_task: config.eval_task ?? '',
        eval_robot_type: config.eval_robot_type ?? 'so101_follower',
        eval_teleop_type: config.eval_teleop_type ?? 'so101_leader',
        follower_port: config.follower_port ?? '/dev/follower_arm_1',
        leader_port: config.leader_port ?? '/dev/leader_arm_1',
        robot_id: config.robot_id ?? 'my_so101_follower_1',
        teleop_id: config.teleop_id ?? 'my_so101_leader_1',
        cameras: Object.fromEntries(Object.entries(cameraMapping).filter(([, sym]) => sym && mappedCameras[sym]).map(([imageKey, sym]) => [imageKey, mappedCameras[sym]])),
        record_cam_width: config.record_cam_width ?? 640,
        record_cam_height: config.record_cam_height ?? 480,
        record_cam_fps: config.record_cam_fps ?? 30,
      }

      if (!cfg.eval_policy_path) return appendLog('eval', '[ERROR] Policy path is required.', 'error')
      if (repoError) return appendLog('eval', `[ERROR] ${repoError}`, 'error')

      beginEval(cfg.eval_episodes, evalLogLines.length)
      await buildConfig(cfg)

      const preflight = await refreshPreflight()
      if (!preflight.ok) {
        appendLog('eval', `[ERROR] ${preflight.reason || 'Device compatibility check failed.'}`, 'error')
        if (preflight.command) appendLog('eval', `[INFO] Run Fix command: ${preflight.command}`, 'info')
        markError()
        setEndedAtMs(Date.now())
        return
      }

      const res = await apiPost<{ ok: boolean; error?: string; auto_install_started?: boolean; action?: string; command?: string; module_name?: string }>('/api/eval/start', cfg)
      if (!res.ok) {
        if (res.auto_install_started) {
          appendLog('eval', `[INFO] ${res.error ?? 'Auto-install started. Retry evaluation after installer finishes.'}`, 'info')
          addToast('Auto-fix started in background', 'info')
          await refreshPreflight()
          setProgressStatus('idle')
          setEndedAtMs(Date.now())
          return
        }
        if (res.action === 'install_gym_plugin' && res.command) {
          setGymInstallCommand(res.command)
          setGymModuleName(res.module_name ?? res.command)
          appendLog('eval', `[ERROR] ${res.error ?? 'Missing gym plugin.'}`, 'error')
          appendLog('eval', `[INFO] Install command: ${res.command}`, 'info')
          addToast(`${res.module_name ?? 'Gym plugin'} not installed`, 'warning')
        } else {
          appendLog('eval', `[ERROR] ${res.error ?? 'failed to start eval'}`, 'error')
        }
        markError()
        setEndedAtMs(Date.now())
        return
      }

      setProgressStatus('running')
      setGymInstallCommand('')
      setGymModuleName('')
      addToast('Eval started', 'success')
    } catch (e) {
      appendLog('eval', `[ERROR] ${e instanceof Error ? e.message : 'Unexpected error starting eval.'}`, 'error')
      markError()
      setEndedAtMs(Date.now())
    }
  }

  const rerunQuickEval = async () => {
    if (running) return
    await buildConfig({ eval_episodes: 3 })
    await start(3)
  }

  const stop = async () => {
    await stopProcess('eval')
    setEndedAtMs(Date.now())
    setProgressStatus((prev) => (prev === 'error' ? 'error' : doneEpisodes > 0 ? 'stopped' : 'idle'))
    addToast('Eval stop requested', 'info')
  }

  return (
    <Box id="tab-eval" className={`tab ${active ? 'active' : ''}`} style={{ display: active ? 'block' : 'none' }}>
      <Group className="section-header" mb="md" align="center">
        <Title order={2}>Evaluate Policy</Title>
        <Badge variant="light" color={running || evalReady ? 'green' : 'yellow'}>
          {running ? 'Running' : evalReady ? 'Ready to Start' : 'Action Needed'}
        </Badge>
      </Group>

      {!running && !evalReady ? (
        <div className="eval-blocker-card">
          <div className="dsub" style={{ marginBottom: 6 }}>Evaluation blocked:</div>
          <div className="eval-blocker-chip-row">{evalBlockers.map((blocker) => <span key={blocker} className="dbadge badge-warn">{blocker}</span>)}</div>
          <div className="eval-blocker-actions">
            {!preflightOk ? <Button type="button" className="link-btn" variant="subtle" size="compact-xs" onClick={() => { void buildConfig({ eval_device: 'cpu' }) }}>→ Switch to CPU</Button> : null}
            {!preflightOk && preflightAction === 'install_python_dep' && preflightCommand ? <Button type="button" className="link-btn" variant="subtle" size="compact-xs" onClick={() => { void runPreflightFix() }}>→ Install Missing Python Packages</Button> : null}
            <Button type="button" className="link-btn" variant="subtle" size="compact-xs" onClick={() => setActiveTab('dataset')}>→ Open Dataset</Button>
            <Button type="button" className="link-btn" variant="subtle" size="compact-xs" onClick={() => setActiveTab('train')}>→ Go to Train</Button>
          </div>
        </div>
      ) : null}

      <div className="eval-content">
        <div className="quick-guide">
          <Text size="sm" fw={600} c="dimmed" mb="xs">Evaluation Guide</Text>
          <p>Select a <strong>trained checkpoint</strong> or enter a custom path. Match the <strong>Dataset Repo ID</strong> to the dataset used during training. Switch <strong>Compute Device</strong> to CPU/MPS if CUDA is unavailable. Start with <strong>3–5 episodes</strong> for a quick sanity check. Logs and detailed metrics appear in the <strong>global console drawer</strong>.</p>
        </div>

        <div className="eval-main-grid">
          <EvalConfigPanel policySource={policySource} onSetPolicySource={handleSetPolicySource} checkpoints={checkpoints} config={config} buildConfig={buildConfig} applyCheckpointEnv={applyCheckpointEnv} totalEpisodes={totalEpisodes} preflightOk={preflightOk} preflightReason={preflightReason} preflightAction={preflightAction} preflightCommand={preflightCommand} preflightFixLabel={preflightFixLabel} installCudaTorch={installCudaTorch} runPreflightFix={() => { void runPreflightFix() }} installing={installing} stopInstallProcess={() => { void stopProcess('train') }} gymInstallCommand={gymInstallCommand} gymModuleName={gymModuleName} installGymPlugin={() => { void installGymPlugin() }} envTypeFromCheckpoint={envTypeFromCheckpoint} envTaskFromCheckpoint={envTaskFromCheckpoint} envTypeValue={envTypeValue} envTaskValue={envTaskValue} envTypeMissing={envTypeMissing} envTaskMissing={envTaskMissing} envTypes={envTypes} imageKeysFromCheckpoint={imageKeysFromCheckpoint} mappedCamEntries={mappedCamEntries} cameraMapping={cameraMapping} setCameraMapping={setCameraMapping} datasetOverrideActive={repoId.trim().length > 0} datasetSource={datasetSource} onSetDatasetSource={handleSetDatasetSource} datasets={datasets} localDatasetId={localDatasetId} configuredDatasetId={configuredDatasetId} repoError={repoError} hfUsername={hfUsername} />
          <div className="eval-side-stack">
            <EvalProgressPanel progressStatus={progressStatus} progressStatusStyle={progressStatusStyle} progressPct={progressPct} showProgressDetails={showProgressDetails} doneEpisodes={doneEpisodes} progressTotal={progressTotal} meanReward={meanReward} successRate={successRate} startedAtMs={startedAtMs} endedAtMs={endedAtMs} elapsedTick={elapsedTick} lastMetricUpdateMs={lastMetricUpdateMs} finalReward={finalReward} finalSuccess={finalSuccess} bestEpisode={bestEpisode} worstEpisode={worstEpisode} running={running} evalReady={evalReady} onQuickRerun={() => { void rerunQuickEval() }} onGoTrain={() => setActiveTab('train')} onGoRecord={() => setActiveTab('record')} />
          </div>
        </div>
      </div>

      <div className="eval-sticky-controls">
        <div className="eval-run-summary">
          <span className={`dbadge ${running ? 'badge-run' : evalReady ? 'badge-ok' : 'badge-err'}`}>{running ? 'RUNNING' : evalReady ? 'READY' : 'BLOCKED'}</span>
          <span className="eval-run-text">{running ? `${doneEpisodes}/${progressTotal ?? totalEpisodes} episodes` : evalReady ? 'Ready to start evaluation' : evalBlockers[0] ?? 'Resolve blockers before starting'}</span>
        </div>
        <ProcessButtons running={running} onStart={() => { void start() }} onStop={stop} startLabel="▶ Start Eval" disabled={!evalReady} conflictReason={conflictReason} />
      </div>
    </Box>
  )
}
