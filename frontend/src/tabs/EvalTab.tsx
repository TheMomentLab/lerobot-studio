import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ProcessButtons } from '../components/shared/ProcessButtons'
import { getProcessConflict } from '../lib/processConflicts'
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
}

type EvalProgressStatus = 'idle' | 'starting' | 'running' | 'stopped' | 'completed' | 'error'

interface EpisodeReward {
  ep: number
  reward: number
}

const COMPLETE_MARKER = /evaluation complete|end of evaluation|eval complete/i
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
  const [checkpoints, setCheckpoints] = useState<CheckpointItem[]>([])
  const [policySource, setPolicySource] = useState<'local' | 'hf'>('local')
  const [datasetSource, setDatasetSource] = useState<'local' | 'hf'>('local')
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
  const localDatasetId = useMemo(() => {
    const configured = (config.eval_repo_id as string) ?? ''
    if (configured && datasets.some((ds) => ds.id === configured)) return configured
    return datasets[0]?.id ?? '__none__'
  }, [config.eval_repo_id, datasets])
  const repoId = datasetSource === 'local' ? localDatasetId : ((config.eval_repo_id as string) ?? '')
  const repoError = useMemo(() => {
    if (datasetSource === 'local') return ''
    const repo = repoId.trim()
    if (!repo) return 'Dataset Repo ID is required'
    if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo)) return 'Dataset Repo ID must be username/dataset format.'
    return ''
  }, [repoId, datasetSource])
  const noLocalCheckpoint = policySource === 'local' && !(config.eval_policy_path as string)
  const noLocalDataset = datasetSource === 'local' && localDatasetId === '__none__'
  const evalReady = preflightOk && !repoError && !conflictReason && !noLocalCheckpoint && !noLocalDataset
  const preflightFixLabel = preflightAction === 'install_python_dep' ? 'Install Missing Python Packages' : 'Run Fix'
  const evalBlockers = useMemo(() => {
    const blockers: string[] = []
    if (!preflightOk) blockers.push(preflightReason || 'Device preflight failed')
    if (repoError) blockers.push(repoError)
    if (noLocalCheckpoint) blockers.push('No checkpoint selected')
    if (noLocalDataset) blockers.push('No local dataset selected')
    if (conflictReason) blockers.push(`${conflictReason} process running`)
    return blockers
  }, [preflightOk, preflightReason, repoError, noLocalCheckpoint, noLocalDataset, conflictReason])
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

  const refreshDatasets = useCallback(async () => {
    const res = await apiGet<{ datasets: DatasetListItem[] }>('/api/datasets')
    setDatasets(res.datasets ?? [])
  }, [])

  const loadCheckpoints = async () => {
    const res = await apiGet<{ ok: boolean; checkpoints: CheckpointItem[] }>('/api/checkpoints')
    if (res.ok) {
      const list = res.checkpoints ?? []
      setCheckpoints(list)
      if (policySource === 'local' && !(config.eval_policy_path as string) && list.length > 0) {
        void buildConfig({ eval_policy_path: list[0].path })
      }
    }
  }

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
        void buildConfig({ eval_repo_id: datasets[0]?.id ?? '' })
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
  }, [active, refreshDatasets, refreshPreflight])

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

  const start = async (episodesOverride?: number) => {
    const cfg = {
      eval_policy_path: (config.eval_policy_path as string) ?? 'outputs/train/checkpoints/last/pretrained_model',
      eval_repo_id: repoId,
      eval_episodes: Number(episodesOverride ?? Number(config.eval_episodes ?? 10)),
      eval_device: (config.eval_device as string) ?? 'cuda',
      eval_task: (config.eval_task as string) ?? '',
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

    const res = await apiPost<{ ok: boolean; error?: string; auto_install_started?: boolean }>('/api/eval/start', cfg)
    if (!res.ok) {
      if (res.auto_install_started) {
        appendLog('eval', `[INFO] ${res.error ?? 'Auto-install started. Retry evaluation after installer finishes.'}`, 'info')
        addToast('Auto-fix started in background', 'info')
        await refreshPreflight()
        setProgressStatus('idle')
        setEndedAtMs(Date.now())
        return
      }
      appendLog('eval', `[ERROR] ${res.error ?? 'failed to start eval'}`, 'error')
      setHadError(true)
      setProgressStatus('error')
      setEndedAtMs(Date.now())
      return
    }
    setProgressStatus('running')
    addToast('Eval started', 'success')
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

      <div className="quick-guide">
        <h3>Evaluation Guide</h3>
        <p>Select a <strong>trained checkpoint</strong> or enter a custom path. Match the <strong>Dataset Repo ID</strong> to the dataset used during training. Switch <strong>Compute Device</strong> to CPU/MPS if CUDA is unavailable. Start with <strong>3–5 episodes</strong> for a quick sanity check. Logs and detailed metrics appear in the <strong>global console drawer</strong>.</p>
      </div>

      <div>
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
                onChange={(e) => buildConfig({ eval_policy_path: e.target.value })}
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
          <label>Dataset Source</label>
          <div className="mode-toggle" style={{ marginLeft: 0, marginBottom: 8 }}>
            <button className={`toggle ${datasetSource === 'local' ? 'active' : ''}`} onClick={() => handleSetDatasetSource('local')}>
              Local
            </button>
            <button className={`toggle ${datasetSource === 'hf' ? 'active' : ''}`} onClick={() => handleSetDatasetSource('hf')}>
              Hugging Face
            </button>
          </div>
          {datasetSource === 'local' ? (
            <>
              <label>Local Dataset</label>
              {datasets.length === 0 && (
                <div className="field-help" style={{ marginBottom: 8, color: 'var(--yellow)' }}>No local datasets found. Record episodes first.</div>
              )}
              <select
                value={localDatasetId}
                onChange={(e) => buildConfig({ eval_repo_id: e.target.value })}
              >
                {datasets.length === 0 ? <option value="__none__">No local datasets — record first</option> : null}
                {datasets.map((ds) => (
                  <option key={ds.id} value={ds.id}>{ds.id}</option>
                ))}
              </select>
              <div className="field-help">Choose a dataset from local cache (`~/.cache/huggingface/lerobot`).</div>
            </>
          ) : (
            <>
              <label>Dataset Repo ID</label>
              <input
                type="text"
                value={(config.eval_repo_id as string) ?? ''}
                placeholder={hfUsername ? `${hfUsername}/my-dataset` : 'username/dataset'}
                onChange={(e) => buildConfig({ eval_repo_id: e.target.value })}
                style={repoError ? { borderColor: 'var(--red)' } : undefined}
              />
              {repoError ? <div className="ep-guard-hint" style={{ marginTop: 4 }}>{repoError}</div> : null}
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
          <label>Task (Optional)</label>
          <input
            type="text"
            value={(config.eval_task as string) ?? ''}
            placeholder="Optional env task override"
            onChange={(e) => buildConfig({ eval_task: e.target.value })}
          />

          <div style={{ marginTop: 10, padding: 10, border: '1px solid var(--border)', borderRadius: 8, background: 'rgba(255,255,255,0.02)' }}>
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
            <div style={{ marginTop: 10, padding: 10, border: '1px solid var(--border)', borderRadius: 8, background: 'rgba(255,255,255,0.02)' }}>
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

      <ProcessButtons running={running} onStart={() => void start()} onStop={stop} startLabel="▶ Start Eval" disabled={!evalReady} conflictReason={conflictReason} />
    </section>
  )
}
