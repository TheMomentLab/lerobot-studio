import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ProcessButtons } from '../components/shared/ProcessButtons'
import { getProcessConflict } from '../lib/processConflicts'
import { useMappedCameras } from '../hooks/useMappedCameras'
import { useConfig } from '../hooks/useConfig'
import { useProcess } from '../hooks/useProcess'
import { apiGet, apiPost } from '../lib/api'
import { useLeStudioStore } from '../store'

import type { DatasetListItem, LogLine } from '../lib/types'

const EMPTY_EVAL_LINES: LogLine[] = []

interface EvalTabProps {
  active: boolean
}

interface CheckpointItem {
  name: string
  path: string
  display?: string
  step?: number | null
  env_type?: string | null
  env_task?: string | null
  image_keys?: string[]
}

interface EnvTypeItem {
  type: string
  label: string
  module: string
  installed: boolean
}

type EvalProgressStatus = 'idle' | 'starting' | 'running' | 'stopped' | 'completed' | 'error'

interface EpisodeReward {
  ep: number
  reward: number
}

const COMPLETE_MARKER = /evaluation complete|end of evaluation|eval complete|end of eval/i
const END_MARKER = /\[eval process ended\]/i
const ERROR_MARKER = /\[ERROR\]|Traceback|RuntimeError|Exception|failed/i

function formatReward(value: number | null) {
  return Number.isFinite(value) ? Number(value).toFixed(4) : '--'
}

function formatSuccess(value: number | null) {
  return Number.isFinite(value) ? `${Number(value).toFixed(1)}%` : '--'
}

function formatClock(ms: number | null) {
  if (!ms) return '--'
  return new Date(ms).toLocaleTimeString()
}

function formatElapsed(startedAtMs: number | null, endedAtMs: number | null, tick: number) {
  if (!startedAtMs) return '--'
  const endMs = endedAtMs ?? Date.now()
  void tick
  const sec = Math.max(0, Math.floor((endMs - startedAtMs) / 1000))
  const mm = String(Math.floor(sec / 60)).padStart(2, '0')
  const ss = String(sec % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

function parseSuccess(rawValue: string) {
  const raw = Number(rawValue)
  if (!Number.isFinite(raw)) return null
  return raw > 1 ? Math.min(100, raw) : Math.max(0, raw * 100)
}

export function EvalTab({ active }: EvalTabProps) {
  const running = useLeStudioStore((s) => !!s.procStatus.eval)
  const installing = useLeStudioStore((s) => !!s.procStatus.train_install)
  const procStatus = useLeStudioStore((s) => s.procStatus)
  const conflictReason = getProcessConflict('eval', procStatus)
  const evalLogLines = useLeStudioStore((s) => s.logLines.eval ?? EMPTY_EVAL_LINES)
  const { config, buildConfig } = useConfig()
  const { stopProcess } = useProcess()
  const appendLog = useLeStudioStore((s) => s.appendLog)
  const addToast = useLeStudioStore((s) => s.addToast)
  const setActiveTab = useLeStudioStore((s) => s.setActiveTab)
  const hfUsername = useLeStudioStore((s) => s.hfUsername)
  const { mappedCameras } = useMappedCameras()
  const mappedCamEntries = useMemo(() => Object.entries(mappedCameras), [mappedCameras])
  // Camera mapping: checkpoint image_key → mapped camera symlink
  const [cameraMapping, setCameraMapping] = useState<Record<string, string>>({})
  const [checkpoints, setCheckpoints] = useState<CheckpointItem[]>([])
  const [policySource, setPolicySource] = useState<'local' | 'hf'>('local')
  const [datasetSource, setDatasetSource] = useState<'local' | 'hf'>('hf')
  const [datasets, setDatasets] = useState<DatasetListItem[]>([])
  const [progressStatus, setProgressStatus] = useState<EvalProgressStatus>('idle')
  const [doneEpisodes, setDoneEpisodes] = useState(0)
  const [targetEpisodes, setTargetEpisodes] = useState<number | null>(null)
  const [meanReward, setMeanReward] = useState<number | null>(null)
  const [successRate, setSuccessRate] = useState<number | null>(null)
  const [finalReward, setFinalReward] = useState<number | null>(null)
  const [finalSuccess, setFinalSuccess] = useState<number | null>(null)
  const [bestEpisode, setBestEpisode] = useState<EpisodeReward | null>(null)
  const [worstEpisode, setWorstEpisode] = useState<EpisodeReward | null>(null)
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null)
  const [endedAtMs, setEndedAtMs] = useState<number | null>(null)
  const [hadError, setHadError] = useState(false)
  const [elapsedTick, setElapsedTick] = useState(0)
  const processedLogsRef = useRef(0)
  const perEpisodeRewardRef = useRef<Record<number, number>>({})
  const autoInstallCommandRef = useRef('')
  const [preflightOk, setPreflightOk] = useState(true)
  const [gymInstallCommand, setGymInstallCommand] = useState('')
  const [gymModuleName, setGymModuleName] = useState('')
  const [envTypes, setEnvTypes] = useState<EnvTypeItem[]>([])

  const [preflightReason, setPreflightReason] = useState('')
  const [preflightAction, setPreflightAction] = useState('')
  const [preflightCommand, setPreflightCommand] = useState('')
  const [lastMetricUpdateMs, setLastMetricUpdateMs] = useState<number | null>(null)

  const refreshPreflight = useCallback(async () => {
    const device = (config.eval_device as string) ?? 'cuda'
    const res = await apiGet<{ ok: boolean; reason?: string; action?: string; command?: string }>(`/api/train/preflight?device=${encodeURIComponent(device)}`)
    const next = {
      ok: !!res.ok,
      reason: res.reason ?? '',
      action: res.action ?? '',
      command: res.command ?? '',
    }
    setPreflightOk(next.ok)
    setPreflightReason(next.reason)
    setPreflightAction(next.action)
    setPreflightCommand(next.command)
    return next
  }, [config.eval_device])

  const installCudaTorch = async () => {
    appendLog('eval', '[INFO] Starting PyTorch CUDA installer from GUI...', 'info')
    try {
      const res = await apiPost<{ ok: boolean; error?: string }>('/api/train/install_pytorch', { nightly: true, cuda_tag: 'cu128' })
      if (!res.ok) {
        appendLog('eval', `[ERROR] ${res.error ?? 'Failed to start CUDA installer.'}`, 'error')
        return
      }
      addToast('CUDA PyTorch install started', 'info')
    } catch (e) {
      appendLog('eval', `[ERROR] ${e instanceof Error ? e.message : 'Installer request failed.'}`, 'error')
    }
  }

  const installGymPlugin = async () => {
    if (!gymInstallCommand) return
    appendLog('eval', `[INFO] Installing ${gymModuleName}: ${gymInstallCommand}`, 'info')
    try {
      const res = await apiPost<{ ok: boolean; error?: string }>('/api/train/install_torchcodec_fix', { command: gymInstallCommand })
      if (!res.ok) {
        appendLog('eval', `[ERROR] ${res.error ?? 'Failed to start gym plugin installer.'}`, 'error')
        return
      }
      addToast(`Installing ${gymModuleName} — check console`, 'info')
    } catch (e) {
      appendLog('eval', `[ERROR] ${e instanceof Error ? e.message : 'Installer request failed.'}`, 'error')
    }
  }

  const runPreflightFix = useCallback(async (opts?: { auto?: boolean }) => {
    if (!preflightCommand) return
    const isAuto = !!opts?.auto
    if (isAuto && preflightAction === 'install_python_dep') {
      appendLog('eval', '[INFO] Auto-installing missing Python packages in background...', 'info')
    } else {
      appendLog('eval', `[INFO] Running: ${preflightCommand}`, 'info')
    }
    try {
      const res = await apiPost<{ ok: boolean; error?: string }>('/api/train/install_torchcodec_fix', { command: preflightCommand })
      if (!res.ok) {
        appendLog('eval', `[ERROR] ${res.error ?? 'Failed to start installer.'}`, 'error')
        return
      }
      if (isAuto && preflightAction === 'install_python_dep') {
        addToast('Auto-install started — check console for progress', 'info')
      } else {
        addToast('Fix installer started — check console for progress', 'info')
      }
    } catch (e) {
      appendLog('eval', `[ERROR] ${e instanceof Error ? e.message : 'Installer request failed.'}`, 'error')
    }
  }, [addToast, appendLog, preflightAction, preflightCommand])

  const totalEpisodes = Number(config.eval_episodes ?? 10)
  const progressTotal = targetEpisodes && targetEpisodes > 0 ? targetEpisodes : null
  const progressPct = Math.max(0, Math.min(100, progressTotal ? (doneEpisodes / progressTotal) * 100 : 0))
  const configuredDatasetId = useMemo(() => {
    const configured = ((config.eval_repo_id as string) ?? '').trim()
    if (configured === 'user/my-dataset' || configured === '__none__') return ''
    return configured
  }, [config.eval_repo_id])
  const localDatasetId = useMemo(() => {
    const configured = configuredDatasetId
    if (configured && datasets.some((ds) => ds.id === configured)) return configured
    return '__none__'
  }, [configuredDatasetId, datasets])
  const repoId = datasetSource === 'local'
    ? (localDatasetId === '__none__' ? '' : localDatasetId)
    : configuredDatasetId
  const repoError = useMemo(() => {
    const repo = repoId.trim()
    if (!repo) return ''
    if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo)) return 'Dataset Repo ID must be username/dataset format.'
    return ''
  }, [repoId])
  const datasetOverrideValue = repoId.trim()
  const datasetOverrideActive = datasetOverrideValue.length > 0
  const noLocalCheckpoint = policySource === 'local' && !(config.eval_policy_path as string)
  const selectedCheckpoint = useMemo(() => {
    if (policySource !== 'local') return undefined
    const path = (config.eval_policy_path as string) ?? ''
    return checkpoints.find((cp) => cp.path === path)
  }, [checkpoints, config.eval_policy_path, policySource])
  const envTypeFromCheckpoint = selectedCheckpoint?.env_type ?? null
  const envTaskFromCheckpoint = selectedCheckpoint?.env_task ?? null
  const imageKeysFromCheckpoint = selectedCheckpoint?.image_keys ?? []
  const envTypeValue = ((config.eval_env_type as string) ?? '').trim()
  const envTaskValue = (config.eval_task as string) ?? ''
  const envTypeMissing = !envTypeValue && !envTypeFromCheckpoint
  const envTaskMissing = !envTaskValue && !envTaskFromCheckpoint
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
  }, [preflightOk, preflightReason, repoError, noLocalCheckpoint, envTypeMissing, envTaskMissing, conflictReason])
  const showProgressDetails = progressStatus === 'running' || progressStatus === 'completed' || progressStatus === 'stopped' || progressStatus === 'error' || doneEpisodes > 0

  const progressStatusStyle = useMemo(() => {
    const map: Record<EvalProgressStatus, { label: string; bg: string; color: string }> = {
      idle: { label: 'IDLE', bg: 'rgba(148,163,184,0.18)', color: 'var(--text2)' },
      starting: { label: 'STARTING', bg: 'rgba(59,130,246,0.18)', color: '#93c5fd' },
      running: { label: 'RUNNING', bg: 'rgba(34,197,94,0.18)', color: '#86efac' },
      stopped: { label: 'STOPPED', bg: 'rgba(148,163,184,0.18)', color: 'var(--text2)' },
      completed: { label: 'COMPLETED', bg: 'rgba(16,185,129,0.20)', color: '#6ee7b7' },
      error: { label: 'ERROR', bg: 'rgba(248,81,73,0.20)', color: '#fca5a5' },
    }
    return map[progressStatus]
  }, [progressStatus])

  const recomputeBestWorst = () => {
    const entries = Object.entries(perEpisodeRewardRef.current)
      .map(([ep, reward]) => ({ ep: Number(ep), reward: Number(reward) }))
      .filter((v) => Number.isFinite(v.ep) && Number.isFinite(v.reward))
    if (!entries.length) {
      setBestEpisode(null)
      setWorstEpisode(null)
      return
    }
    entries.sort((a, b) => a.reward - b.reward)
    setWorstEpisode(entries[0])
    setBestEpisode(entries[entries.length - 1])
  }

  const resetEvalState = (status: EvalProgressStatus) => {
    setProgressStatus(status)
    setDoneEpisodes(0)
    setMeanReward(null)
    setSuccessRate(null)
    setFinalReward(null)
    setFinalSuccess(null)
    setBestEpisode(null)
    setWorstEpisode(null)
    setHadError(false)
    setStartedAtMs(null)
    setEndedAtMs(null)
    perEpisodeRewardRef.current = {}
  }

  const loadEnvTypes = useCallback(async () => {
    const res = await apiGet<{ ok: boolean; env_types: EnvTypeItem[] }>('/api/eval/env-types')
    if (res.ok) setEnvTypes(res.env_types ?? [])
  }, [])

  const refreshDatasets = useCallback(async () => {
    const res = await apiGet<{ datasets: DatasetListItem[] }>('/api/datasets')
    setDatasets(res.datasets ?? [])
  }, [])

  const applyCheckpointEnv = useCallback((cp: CheckpointItem | undefined) => {
    if (!cp) return
    const updates: Record<string, string> = {}
    if (cp.env_type && !(config.eval_env_type as string)) updates.eval_env_type = cp.env_type
    if (cp.env_task && !(config.eval_task as string)) updates.eval_task = cp.env_task
    if (Object.keys(updates).length > 0) void buildConfig(updates)
  }, [buildConfig, config.eval_env_type, config.eval_task])

  const loadCheckpoints = useCallback(async () => {
    const res = await apiGet<{ ok: boolean; checkpoints: CheckpointItem[] }>('/api/checkpoints')
    if (res.ok) {
      const list = res.checkpoints ?? []
      setCheckpoints(list)
      if (policySource === 'local' && !(config.eval_policy_path as string) && list.length > 0) {
        void buildConfig({ eval_policy_path: list[0].path })
        applyCheckpointEnv(list[0])
      }
    }
  }, [applyCheckpointEnv, buildConfig, config.eval_policy_path, policySource])

  const handleSetPolicySource = (newSource: 'local' | 'hf') => {
    setPolicySource(newSource)
    if (newSource === 'local') {
      const currentPath = (config.eval_policy_path as string) ?? ''
      const isValidLocalPath = checkpoints.some((cp) => cp.path === currentPath)
      if (!isValidLocalPath) {
        void buildConfig({ eval_policy_path: checkpoints[0]?.path ?? '' })
      }
    } else {
      void buildConfig({ eval_policy_path: '' })
    }
  }

  const handleSetDatasetSource = (newSource: 'local' | 'hf') => {
    setDatasetSource(newSource)
    if (newSource === 'local') {
      const currentId = (config.eval_repo_id as string) ?? ''
      const isValidLocal = datasets.some((ds) => ds.id === currentId)
      if (!isValidLocal) {
        void buildConfig({ eval_repo_id: '' })
      }
    } else {
      void buildConfig({ eval_repo_id: '' })
    }
  }

  useEffect(() => {
    if (!active) return
    loadCheckpoints()
    refreshDatasets()
    refreshPreflight()
    loadEnvTypes()
  }, [active, loadCheckpoints, loadEnvTypes, refreshDatasets, refreshPreflight])

  useEffect(() => {
    if (!active || preflightOk) return
    const timer = window.setInterval(() => {
      refreshPreflight()
    }, 5000)
    return () => window.clearInterval(timer)
  }, [active, preflightOk, refreshPreflight])

  useEffect(() => {
    if (preflightOk) {
      autoInstallCommandRef.current = ''
      return
    }
    if (!active || installing) return
    if (preflightAction !== 'install_python_dep' || !preflightCommand) return
    if (autoInstallCommandRef.current === preflightCommand) return
    autoInstallCommandRef.current = preflightCommand
    void runPreflightFix({ auto: true })
  }, [active, installing, preflightAction, preflightCommand, preflightOk, runPreflightFix])

  useEffect(() => {
    if (!startedAtMs || endedAtMs) return
    const timer = window.setInterval(() => setElapsedTick((t) => t + 1), 1000)
    return () => window.clearInterval(timer)
  }, [startedAtMs, endedAtMs])

  useEffect(() => {
    if (evalLogLines.length < processedLogsRef.current) {
      processedLogsRef.current = 0
    }
    const nextLines = evalLogLines.slice(processedLogsRef.current)
    if (!nextLines.length) return

    for (const lineItem of nextLines) {
      const line = lineItem.text ?? ''
      if (!line) continue

      if (lineItem.kind === 'error' || ERROR_MARKER.test(line)) {
        setHadError(true)
        setProgressStatus('error')
      }

      setLastMetricUpdateMs(lineItem.ts ?? Date.now())

      const tqdmMatch = line.match(/Stepping through eval batches:\s*(\d+)%\|.*\|\s*(\d+)\/(\d+)/)
      if (tqdmMatch) {
        const pct = parseInt(tqdmMatch[1], 10)
        const done = parseInt(tqdmMatch[2], 10)
        const total = parseInt(tqdmMatch[3], 10)
        if (Number.isFinite(done)) setDoneEpisodes((prev) => Math.max(prev, done))
        if (Number.isFinite(total) && total > 0) setTargetEpisodes(total)
        if (!hadError && pct > 0) setProgressStatus('running')
      }

      const epTotalMatch = line.match(/(?:^|\s)(?:n_episodes|episodes)\s*[:=]\s*([0-9]+)/i)
        || line.match(/episode\s*\d+\s*\/\s*([0-9]+)/i)
        || line.match(/completed\s*episodes\s*[:=]\s*\d+\s*\/\s*([0-9]+)/i)
      if (epTotalMatch) {
        const total = parseInt(epTotalMatch[1], 10)
        if (Number.isFinite(total) && total > 0) setTargetEpisodes(total)
      }

      const doneMatch = line.match(/episode\s*([0-9]+)\s*\/\s*([0-9]+)/i)
        || line.match(/completed\s*episodes\s*[:=]\s*([0-9]+)\s*\/\s*([0-9]+)/i)
        || line.match(/\bepisode\s*[:#]\s*([0-9]+)\b/i)
      if (doneMatch) {
        const done = parseInt(doneMatch[1], 10)
        if (Number.isFinite(done) && done >= 0) {
          setDoneEpisodes((prev) => Math.max(prev, done))
          if (!hadError) setProgressStatus('running')
        }
        if (doneMatch[2]) {
          const total = parseInt(doneMatch[2], 10)
          if (Number.isFinite(total) && total > 0) setTargetEpisodes(total)
        }
      }

      const successMatch = line.match(/\bsuccess(?:[_\s-]?rate)?\s*[:=]\s*([0-9]*\.?[0-9]+)\s*%?/i)
      if (successMatch) {
        const parsed = parseSuccess(successMatch[1])
        if (parsed !== null) setSuccessRate(parsed)
      }

      const rewardMatch = line.match(/\b(?:mean[_\s-]?reward|avg[_\s-]?reward|episode[_\s-]?reward)\s*[:=]\s*([+-]?[0-9]*\.?[0-9]+(?:e[+-]?[0-9]+)?)/i)
      if (rewardMatch) {
        const reward = Number(rewardMatch[1])
        if (Number.isFinite(reward)) {
          setMeanReward(reward)
          const epForReward = line.match(/episode\s*([0-9]+)\b/i)
          if (epForReward) {
            const epIdx = parseInt(epForReward[1], 10)
            if (Number.isFinite(epIdx)) {
              perEpisodeRewardRef.current[epIdx] = reward
              recomputeBestWorst()
            }
          }
        }
      }

      const finalRewardMatch = line.match(/(?:final|overall|eval)\s*(?:mean[_\s-]?reward|avg[_\s-]?reward|reward)\s*[:=]\s*([+-]?[0-9]*\.?[0-9]+(?:e[+-]?[0-9]+)?)/i)
      if (finalRewardMatch) {
        const value = Number(finalRewardMatch[1])
        if (Number.isFinite(value)) setFinalReward(value)
      }

      const finalSuccessMatch = line.match(/(?:final|overall|eval)\s*(?:success(?:[_\s-]?rate)?)\s*[:=]\s*([0-9]*\.?[0-9]+)\s*%?/i)
      if (finalSuccessMatch) {
        const parsed = parseSuccess(finalSuccessMatch[1])
        if (parsed !== null) setFinalSuccess(parsed)
      }

      const aggregatedMatch = line.match(/['"](?:sum_reward|avg_reward|mean_reward)['"]\s*:\s*([+-]?\d*\.?\d+(?:e[+-]?\d+)?)/i)
      if (aggregatedMatch) {
        const val = Number(aggregatedMatch[1])
        if (Number.isFinite(val)) setFinalReward((prev) => prev ?? val)
      }
      const aggregatedSuccessMatch = line.match(/['"]pc_success['"]\s*:\s*([+-]?\d*\.?\d+(?:e[+-]?\d+)?)/i)
      if (aggregatedSuccessMatch) {
        const val = Number(aggregatedSuccessMatch[1])
        if (Number.isFinite(val)) setFinalSuccess((prev) => prev ?? (val > 1 ? val : val * 100))
      }

      if (COMPLETE_MARKER.test(line)) {
        setProgressStatus((prev) => (prev === 'error' ? 'error' : 'completed'))
        setEndedAtMs((prev) => prev ?? lineItem.ts ?? Date.now())
        setFinalReward((prev) => (Number.isFinite(prev) ? prev : meanReward))
        setFinalSuccess((prev) => (Number.isFinite(prev) ? prev : successRate))
      }

      if (END_MARKER.test(line)) {
        setEndedAtMs((prev) => prev ?? lineItem.ts ?? Date.now())
        setProgressStatus((prev) => {
          if (prev === 'error') return 'error'
          if (targetEpisodes && doneEpisodes >= targetEpisodes) return 'completed'
          return 'stopped'
        })
      }
    }

    processedLogsRef.current = evalLogLines.length
  }, [doneEpisodes, evalLogLines, hadError, meanReward, successRate, targetEpisodes])

  useEffect(() => {
    if (running) {
      setStartedAtMs((prev) => prev ?? Date.now())
      setEndedAtMs(null)
      setProgressStatus((prev) => (prev === 'starting' || prev === 'error' || prev === 'completed' ? prev : 'running'))
      return
    }
    if (!running && startedAtMs && !endedAtMs) {
      setEndedAtMs(Date.now())
      setProgressStatus((prev) => {
        if (prev === 'completed' || prev === 'error') return prev
        return doneEpisodes > 0 ? 'stopped' : 'idle'
      })
    }
  }, [running, startedAtMs, endedAtMs, doneEpisodes])

  // Auto-populate camera mapping when checkpoint or mapped cameras change
  useEffect(() => {
    if (!imageKeysFromCheckpoint.length) { setCameraMapping({}); return }
    setCameraMapping((prev) => {
      const next: Record<string, string> = {}
      for (const key of imageKeysFromCheckpoint) {
        if (prev[key] && mappedCamEntries.some(([sym]) => sym === prev[key])) {
          next[key] = prev[key]  // keep existing valid selection
        } else {
          // auto-match: exact symlink match or first available
          const exact = mappedCamEntries.find(([sym]) => sym === key)
          next[key] = exact ? exact[0] : (mappedCamEntries[0]?.[0] ?? '')
        }
      }
      return next
    })
  }, [imageKeysFromCheckpoint, mappedCamEntries])

  const start = async (episodesOverride?: number) => {
    try {
    const cfg = {
      eval_policy_path: (config.eval_policy_path as string) ?? 'outputs/train/checkpoints/last/pretrained_model',
      eval_repo_id: repoId,
      eval_env_type: (config.eval_env_type as string) ?? '',
      eval_episodes: Number(episodesOverride ?? Number(config.eval_episodes ?? 10)),
      eval_device: (config.eval_device as string) ?? 'cuda',
      eval_task: (config.eval_task as string) ?? '',
      eval_robot_type: (config.eval_robot_type as string) ?? 'so101_follower',
      eval_teleop_type: (config.eval_teleop_type as string) ?? 'so101_leader',
      // port/id forwarded from shared device config
      follower_port: (config.follower_port as string) ?? '/dev/follower_arm_1',
      leader_port: (config.leader_port as string) ?? '/dev/leader_arm_1',
      robot_id: (config.robot_id as string) ?? 'my_so101_follower_1',
      teleop_id: (config.teleop_id as string) ?? 'my_so101_leader_1',
      // camera config: use checkpoint image_key → camera mapping
      cameras: Object.fromEntries(
        Object.entries(cameraMapping)
          .filter(([, sym]) => sym && mappedCameras[sym])
          .map(([imageKey, sym]) => [imageKey, mappedCameras[sym]])
      ),
      record_cam_width: config.record_cam_width ?? 640,
      record_cam_height: config.record_cam_height ?? 480,
      record_cam_fps: config.record_cam_fps ?? 30,
    }
    if (!cfg.eval_policy_path) {
      appendLog('eval', '[ERROR] Policy path is required.', 'error')
      return
    }
    if (repoError) {
      appendLog('eval', `[ERROR] ${repoError}`, 'error')
      return
    }
    resetEvalState('starting')
    setStartedAtMs(Date.now())
    setTargetEpisodes(cfg.eval_episodes)
    processedLogsRef.current = evalLogLines.length
    await buildConfig(cfg)
    const preflight = await refreshPreflight()
    if (!preflight.ok) {
      appendLog('eval', `[ERROR] ${preflight.reason || 'Device compatibility check failed.'}`, 'error')
      if (preflight.command) {
        appendLog('eval', `[INFO] Run Fix command: ${preflight.command}`, 'info')
      }
      setHadError(true)
      setProgressStatus('error')
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
      setHadError(true)
      setProgressStatus('error')
      setEndedAtMs(Date.now())
      return
    }
    setProgressStatus('running')
    setGymInstallCommand('')
    setGymModuleName('')
    addToast('Eval started', 'success')
  } catch (e) {
    appendLog('eval', `[ERROR] ${e instanceof Error ? e.message : 'Unexpected error starting eval.'}`, 'error')
    setHadError(true)
    setProgressStatus('error')
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
    <section id="tab-eval" className={`tab ${active ? 'active' : ''}`}>
      <div className="section-header">
        <h2>Evaluate Policy</h2>
        <span className={`status-verdict ${running || evalReady ? 'ready' : 'warn'}`}>
          {running ? 'Running' : evalReady ? 'Ready to Start' : 'Action Needed'}
        </span>
      </div>

      {!running && !evalReady ? (
        <div className="eval-blocker-card">
          <div className="dsub" style={{ marginBottom: 6 }}>Evaluation blocked:</div>
          <div className="eval-blocker-chip-row">
            {evalBlockers.map((blocker) => (
              <span key={blocker} className="dbadge badge-warn">{blocker}</span>
            ))}
          </div>
          <div className="eval-blocker-actions">
            {!preflightOk ? (
              <button type="button" className="link-btn" onClick={() => buildConfig({ eval_device: 'cpu' })}>→ Switch to CPU</button>
            ) : null}
            {!preflightOk && preflightAction === 'install_python_dep' && preflightCommand ? (
              <button type="button" className="link-btn" onClick={() => { void runPreflightFix() }}>→ Install Missing Python Packages</button>
            ) : null}
            <button type="button" className="link-btn" onClick={() => setActiveTab('dataset')}>→ Open Dataset</button>
            <button type="button" className="link-btn" onClick={() => setActiveTab('train')}>→ Go to Train</button>
          </div>
        </div>
      ) : null}

      <div className="eval-content">
        <div className="quick-guide">
          <h3>Evaluation Guide</h3>
          <p>Select a <strong>trained checkpoint</strong> or enter a custom path. Match the <strong>Dataset Repo ID</strong> to the dataset used during training. Switch <strong>Compute Device</strong> to CPU/MPS if CUDA is unavailable. Start with <strong>3–5 episodes</strong> for a quick sanity check. Logs and detailed metrics appear in the <strong>global console drawer</strong>.</p>
        </div>

        <div className="eval-main-grid">
          <div className="card">
          <h3>Configuration</h3>
          <label>Policy Source</label>
          <div className="mode-toggle" style={{ marginLeft: 0, marginBottom: 8 }}>
            <button className={`toggle ${policySource === 'local' ? 'active' : ''}`} onClick={() => handleSetPolicySource('local')}>
              Local
            </button>
            <button className={`toggle ${policySource === 'hf' ? 'active' : ''}`} onClick={() => handleSetPolicySource('hf')}>
              Hugging Face
            </button>
          </div>
          {policySource === 'local' ? (
            <>
              <label>Checkpoint</label>
              {checkpoints.length === 0 && (
                <div className="field-help" style={{ marginBottom: 8, color: 'var(--yellow)' }}>No checkpoints found. Train a model first.</div>
              )}
              <select
                value={(config.eval_policy_path as string) ?? ''}
                onChange={(e) => {
                  const path = e.target.value
                  void buildConfig({ eval_policy_path: path, eval_env_type: '', eval_task: '' })
                  const cp = checkpoints.find((c) => c.path === path)
                  if (cp) applyCheckpointEnv(cp)
                }}
              >
                {checkpoints.length === 0 ? <option value="">No checkpoints — train first</option> : null}
                {checkpoints.map((cp) => (
                  <option key={cp.path} value={cp.path}>
                    {cp.display ?? (cp.step ? `${cp.name} (step ${cp.step.toLocaleString()})` : cp.name)}
                  </option>
                ))}
              </select>
              <div className="field-help">Choose from locally trained checkpoints.</div>
            </>
          ) : (
            <>
              <label>Policy Repo ID</label>
              <input
                type="text"
                value={(config.eval_policy_path as string) ?? ''}
                placeholder="e.g. lerobot/act_pusht_diffusion"
                onChange={(e) => buildConfig({ eval_policy_path: e.target.value })}
              />
              <div className="field-help">Hugging Face Hub model ID to evaluate.</div>
            </>
          )}
          <label>Episodes</label>
          <input type="number" min={1} value={totalEpisodes} onChange={(e) => buildConfig({ eval_episodes: Number(e.target.value) })} />
          <label>Compute Device</label>
          <select value={(config.eval_device as string) ?? 'cuda'} onChange={(e) => buildConfig({ eval_device: e.target.value })}>
            <option value="cuda">CUDA (GPU)</option>
            <option value="cpu">CPU</option>
            <option value="mps">MPS (Apple Silicon)</option>
          </select>
          {!preflightOk ? (
            <div id="eval-device-warning" className="train-device-warning">
              {preflightReason || 'Device preflight failed. Evaluation is blocked.'}
            </div>
          ) : null}
          {!preflightOk && preflightAction === 'install_torch_cuda' ? (
            <div id="eval-device-actions" className="recovery-action" style={{ marginTop: 8 }}>
              <div className="field-help" style={{ marginBottom: 6 }}>Recommended next step to unblock evaluation:</div>
              <button className="btn-primary" onClick={installCudaTorch}>
                Install CUDA PyTorch (Nightly)
              </button>
            </div>
          ) : null}
          {!preflightOk && preflightCommand && preflightAction !== 'install_torch_cuda' ? (
            <div id="eval-device-actions" className="recovery-action" style={{ marginTop: 8 }}>
              <div className="field-help" style={{ marginBottom: 6 }}>
                {preflightAction === 'install_python_dep'
                  ? 'Missing Python packages detected. Auto-install starts automatically.'
                  : 'Recommended next step to unblock evaluation:'}
              </div>
              {preflightAction !== 'install_python_dep' ? (
                <div className="field-help" style={{ marginBottom: 8, fontFamily: 'var(--mono)' }}>{preflightCommand}</div>
              ) : null}
              <button className="btn-primary" onClick={() => { void runPreflightFix() }} disabled={installing}>
                {installing ? 'Fix Running...' : preflightFixLabel}
              </button>
              {installing ? (
                <button className="btn-sm" style={{ marginLeft: 8 }} onClick={() => { void stopProcess('train') }}>
                  Stop Fix
                </button>
              ) : null}
            </div>
          ) : null}
          {gymInstallCommand ? (
            <div className="recovery-action" style={{ marginTop: 8 }}>
              <div className="field-help" style={{ marginBottom: 6 }}>
                Environment plugin <strong>{gymModuleName}</strong> is required but not installed.
              </div>
              <div className="field-help" style={{ marginBottom: 8, fontFamily: 'var(--mono)' }}>{gymInstallCommand}</div>
              <button className="btn-primary" onClick={() => { void installGymPlugin() }} disabled={installing}>
                {installing ? 'Installing...' : `Install ${gymModuleName}`}
              </button>
              {installing ? (
                <button className="btn-sm" style={{ marginLeft: 8 }} onClick={() => { void stopProcess('train') }}>
                  Stop Install
                </button>
              ) : null}
            </div>
          ) : null}
          <label>Env Type {envTypeFromCheckpoint ? <span className="dbadge" style={{ fontSize: 10, marginLeft: 4 }}>from checkpoint</span> : envTypeMissing ? <span style={{ color: 'var(--red)', fontSize: 11 }}>(required)</span> : null}</label>
          <select
            value={envTypeValue || envTypeFromCheckpoint || ''}
            onChange={(e) => buildConfig({ eval_env_type: e.target.value })}
            style={envTypeMissing ? { borderColor: 'var(--red)' } : undefined}
          >
            <option value="">— Select env type —</option>
            {envTypes.map((et) => (
              <option key={et.type} value={et.type}>
                {et.label}{et.installed ? '' : ' (not installed)'}
              </option>
            ))}
          </select>
          {envTypeMissing ? (
            <div className="field-help" style={{ color: 'var(--yellow)', marginBottom: 4 }}>No env metadata found. For Hugging Face or real-robot policies, select 'gym_manipulator'.</div>
          ) : (() => {
            const selected = envTypes.find((et) => et.type === (envTypeValue || envTypeFromCheckpoint))
            return selected && !selected.installed ? (
              <div className="field-help" style={{ color: 'var(--yellow)', marginBottom: 4 }}>
                <code>{selected.module}</code> is not installed. Click Install below or run: <code>{`pip install ${selected.module}`}</code>
              </div>
            ) : (
              <div className="field-help" style={{ marginBottom: 4 }}><code>{selected?.module || `gym_${envTypeValue || envTypeFromCheckpoint || '...'}`}</code> plugin will be used.</div>
            )
          })()}
          <label>Task {envTaskFromCheckpoint ? <span className="dbadge" style={{ fontSize: 10, marginLeft: 4 }}>from checkpoint</span> : envTaskMissing ? <span style={{ color: 'var(--red)', fontSize: 11 }}>(required)</span> : null}</label>
          <input
            type="text"
            value={envTaskValue || envTaskFromCheckpoint || ''}
            placeholder="e.g. Pick up the block"
            onChange={(e) => buildConfig({ eval_task: e.target.value })}
            style={envTaskMissing ? { borderColor: 'var(--red)' } : undefined}
          />
          {envTaskMissing ? (
            <div className="field-help" style={{ color: 'var(--yellow)', marginBottom: 4 }}>Checkpoint has no task metadata. Describe the evaluation task.</div>
          ) : null}
          {(envTypeValue || envTypeFromCheckpoint) === 'gym_manipulator' ? (
            <div style={{ marginTop: 8, padding: '10px 12px', background: 'var(--bg2)', borderRadius: 6, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 8, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Real Robot Config</div>
              <label style={{ fontSize: 12 }}>Robot Type</label>
              <select
                value={(config.eval_robot_type as string) || 'so101_follower'}
                onChange={(e) => buildConfig({ eval_robot_type: e.target.value })}
                style={{ marginBottom: 6 }}
              >
                <option value="so101_follower">SO-101 Follower</option>
                <option value="bi_so_follower">Bi-SO Follower (dual arm)</option>
              </select>
              <label style={{ fontSize: 12 }}>Teleop Type</label>
              <select
                value={(config.eval_teleop_type as string) || 'so101_leader'}
                onChange={(e) => buildConfig({ eval_teleop_type: e.target.value })}
              >
                <option value="so101_leader">SO-101 Leader</option>
                <option value="bi_so_leader">Bi-SO Leader (dual arm)</option>
              </select>
              <div className="field-help" style={{ marginTop: 6 }}>Uses port/ID settings from Device Setup. Robot must be connected.</div>
              {imageKeysFromCheckpoint.length > 0 ? (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 6, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Camera Mapping</div>
                  <div className="field-help" style={{ marginBottom: 6 }}>Assign each policy camera to a mapped device. Names must match what the policy was trained on.</div>
                  {imageKeysFromCheckpoint.map((imgKey) => (
                    <div key={imgKey} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <code style={{ flex: '0 0 auto', fontSize: 11, minWidth: 120 }}>{imgKey}</code>
                      <span style={{ fontSize: 11, color: 'var(--text2)' }}>&rarr;</span>
                      <select
                        style={{ flex: 1, fontSize: 12 }}
                        value={cameraMapping[imgKey] ?? ''}
                        onChange={(e) => setCameraMapping((prev) => ({ ...prev, [imgKey]: e.target.value }))}
                      >
                        <option value="">-- none --</option>
                        {mappedCamEntries.map(([sym, path]) => (
                          <option key={sym} value={sym}>{sym} ({path})</option>
                        ))}
                      </select>
                    </div>
                  ))}
                  {mappedCamEntries.length === 0 ? (
                    <div className="field-help" style={{ color: 'var(--yellow)', marginTop: 4 }}>No mapped cameras. Set up camera mappings in Device Setup first.</div>
                  ) : null}
                  {imageKeysFromCheckpoint.length > 0 && mappedCamEntries.length > 0 && Object.values(cameraMapping).filter(v => v).length < imageKeysFromCheckpoint.length ? (
                    <div className="field-help" style={{ color: 'var(--yellow)', marginTop: 4 }}>
                      {imageKeysFromCheckpoint.length - Object.values(cameraMapping).filter(v => v).length} camera(s) not mapped. Policy may fail without all camera inputs.
                    </div>
                  ) : null}
                </div>
              ) : mappedCamEntries.length > 0 ? (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 6, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Cameras</div>
                  <div className="field-help" style={{ marginBottom: 6 }}>Checkpoint has no image feature metadata. All mapped cameras will be used.</div>
                  {mappedCamEntries.map(([sym, path]) => (
                    <div key={sym} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <code style={{ fontSize: 11 }}>{sym}</code>
                      <span style={{ fontSize: 11, color: 'var(--text2)' }}>{path}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              <details style={{ marginTop: 8 }}>
                <summary style={{ fontSize: 11, color: 'var(--text2)', cursor: 'pointer' }}>Camera Settings</summary>
                <div className="settings-grid" style={{ marginTop: 6, gap: 6 }}>
                  <div className="setting-item">
                    <label style={{ fontSize: 11 }}>Resolution</label>
                    <select style={{ fontSize: 12 }} value={`${config.eval_cam_width ?? config.record_cam_width ?? 640}x${config.eval_cam_height ?? config.record_cam_height ?? 480}`} onChange={(e) => { const [w, h] = e.target.value.split('x'); buildConfig({ eval_cam_width: Number(w), eval_cam_height: Number(h) }) }}>
                      <option value="1280x720">1280 × 720</option>
                      <option value="640x480">640 × 480</option>
                      <option value="320x240">320 × 240</option>
                    </select>
                  </div>
                  <div className="setting-item">
                    <label style={{ fontSize: 11 }}>FPS</label>
                    <select style={{ fontSize: 12 }} value={String(config.eval_cam_fps ?? config.record_cam_fps ?? 30)} onChange={(e) => buildConfig({ eval_cam_fps: Number(e.target.value) })}>
                      <option value="30">30</option>
                      <option value="15">15</option>
                      <option value="10">10</option>
                    </select>
                  </div>
                </div>
              </details>
            </div>
          ) : null}
          <details className="advanced-panel advanced-panel-clickable" style={{ marginTop: 10 }}>
            <summary style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 1 }}>Advanced Overrides</span>
              <span
                className="dbadge"
                style={{
                  background: datasetOverrideActive ? 'rgba(34,197,94,0.18)' : 'rgba(148,163,184,0.18)',
                  color: datasetOverrideActive ? '#86efac' : 'var(--text2)',
                }}
              >
                {datasetOverrideActive ? 'Dataset override ON' : 'Dataset override OFF'}
              </span>
              {datasetOverrideActive ? (
                <button
                  type="button"
                  className="btn-xs"
                  onClick={(e) => { e.preventDefault(); void buildConfig({ eval_repo_id: '' }) }}
                >
                  Clear
                </button>
              ) : null}
            </summary>
            <div style={{ marginTop: 8 }}>
              <label>Dataset Source</label>
              <div className="mode-toggle" style={{ marginLeft: 0, marginBottom: 8 }}>
                <button type="button" className={`toggle ${datasetSource === 'local' ? 'active' : ''}`} onClick={() => handleSetDatasetSource('local')}>
                  Local
                </button>
                <button type="button" className={`toggle ${datasetSource === 'hf' ? 'active' : ''}`} onClick={() => handleSetDatasetSource('hf')}>
                  Hugging Face
                </button>
              </div>
              {datasetSource === 'local' ? (
                <>
                  <label>Local Dataset</label>
                  {datasets.length === 0 && (
                    <div className="field-help" style={{ marginBottom: 8, color: 'var(--yellow)' }}>No local datasets found. This field is optional for eval.</div>
                  )}
                  <select
                    value={localDatasetId}
                    onChange={(e) => buildConfig({ eval_repo_id: e.target.value === '__none__' ? '' : e.target.value })}
                  >
                    <option value="__none__">None (no override)</option>
                    {datasets.map((ds) => (
                      <option key={ds.id} value={ds.id}>{ds.id}</option>
                    ))}
                  </select>
                  <div className="field-help">Optional override. Leave empty to evaluate without dataset repo override.</div>
                </>
              ) : (
                <>
                  <label>Dataset Repo ID (Optional)</label>
                  <input
                    type="text"
                    value={configuredDatasetId}
                    placeholder={hfUsername ? `${hfUsername}/my-dataset` : 'username/dataset'}
                    onChange={(e) => buildConfig({ eval_repo_id: e.target.value })}
                    style={repoError ? { borderColor: 'var(--red)' } : undefined}
                  />
                  {repoError ? <div className="ep-guard-hint" style={{ marginTop: 4 }}>{repoError}</div> : null}
                </>
              )}
            </div>
          </details>
          </div>

          <div className="eval-side-stack">
            <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--text2)' }}>Evaluation Progress</span>
              <span
                id="eval-progress-status"
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: progressStatusStyle.bg,
                  color: progressStatusStyle.color,
                }}
              >
                {progressStatusStyle.label}
              </span>
            </div>
            <div className="usb-bus-bar-track">
              <div
                id="eval-progress-fill"
                className="usb-bar-fill good"
                style={{ width: `${progressPct}%` }}
                role="progressbar"
                aria-label="Evaluation progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progressPct)}
                aria-valuetext={`${Math.round(progressPct)} percent`}
              />
            </div>
            {showProgressDetails ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 12, color: 'var(--text2)', gap: 10, flexWrap: 'wrap' }}>
                <span id="eval-progress-episodes">Episodes: {doneEpisodes || '--'} / {progressTotal || '--'}</span>
                <span id="eval-progress-reward">Reward: {formatReward(meanReward)}</span>
                <span id="eval-progress-success">Success: {formatSuccess(successRate)}</span>
              </div>
            ) : (
              <div className="field-help" style={{ marginTop: 8 }}>Start evaluation to populate episode/reward/success metrics.</div>
            )}
            </div>

            {progressStatus !== 'idle' && (
              <div className="card">
              <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 8 }}>Evaluation Summary</div>
              <div style={{ marginBottom: 8, fontSize: 11, color: 'var(--text2)' }}>
                <span id="eval-summary-confidence" className="dbadge" style={{ display: 'none' }} />
                <div id="eval-summary-time" className="eval-summary-time">
                  <span>Start {formatClock(startedAtMs)}</span>
                  <span>Elapsed {formatElapsed(startedAtMs, endedAtMs, elapsedTick)}</span>
                  <span>End {formatClock(endedAtMs)}</span>
                  <span>Update {formatClock(lastMetricUpdateMs)}</span>
                </div>
              </div>
              <div className="eval-summary-grid" style={{ fontSize: 12, color: 'var(--text2)' }}>
                <div id="eval-summary-final-reward">Final Reward: {formatReward(finalReward)}</div>
                <div id="eval-summary-final-success">Final Success: {formatSuccess(finalSuccess)}</div>
                <div id="eval-summary-best">
                  Best Episode: {bestEpisode ? `#${bestEpisode.ep} (${bestEpisode.reward.toFixed(4)})` : '--'}
                </div>
                <div id="eval-summary-worst">
                  Worst Episode: {worstEpisode ? `#${worstEpisode.ep} (${worstEpisode.reward.toFixed(4)})` : '--'}
                </div>
              </div>
              <div style={{ marginTop: 10, display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button className="btn-xs" onClick={() => void rerunQuickEval()} disabled={running || !evalReady}>
                  Re-run 3 Episodes
                </button>
                <button className="btn-xs" onClick={() => setActiveTab('train')}>
                  Go to Train
                </button>
                {(progressStatus === 'completed' || progressStatus === 'stopped') && (
                  <button className="btn-xs" onClick={() => setActiveTab('record')}>
                    ↻ Record New Data
                  </button>
                )}
              </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="eval-sticky-controls">
        <div className="eval-run-summary">
          <span className={`dbadge ${running ? 'badge-run' : evalReady ? 'badge-ok' : 'badge-err'}`}>
            {running ? 'RUNNING' : evalReady ? 'READY' : 'BLOCKED'}
          </span>
          <span className="eval-run-text">
            {running
              ? `${doneEpisodes}/${progressTotal ?? totalEpisodes} episodes`
              : evalReady
                ? 'Ready to start evaluation'
                : evalBlockers[0] ?? 'Resolve blockers before starting'}
          </span>
        </div>
        <ProcessButtons running={running} onStart={() => void start()} onStop={stop} startLabel="▶ Start Eval" disabled={!evalReady} conflictReason={conflictReason} />
      </div>
    </section>
  )
}
