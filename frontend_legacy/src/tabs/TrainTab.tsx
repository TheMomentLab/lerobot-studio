import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ProcessButtons } from '../components/shared/ProcessButtons'
import { getProcessConflict } from '../lib/processConflicts'
import { useConfig } from '../hooks/useConfig'
import { useProcess } from '../hooks/useProcess'
import { apiGet, apiPost } from '../lib/api'
import type { DatasetListItem, LogLine } from '../lib/types'
import { useLeStudioStore } from '../store'

const EMPTY_TRAIN_LINES: LogLine[] = []

interface TrainTabProps {
  active: boolean
}

interface GpuStatusResponse {
  exists: boolean
  utilization?: number
  memory_used?: number
  memory_total?: number
  memory_percent?: number
  error?: string
}

interface CheckpointItem {
  name: string
  path: string
  display?: string
  step?: number | null
  policy?: string | null
  size_mb?: number | null
}

interface ColabConfigResponse {
  ok: boolean
  error?: string
  repo_id?: string
  config_path?: string
  colab_link?: string
  manual_run_required?: boolean
  session_limit_note?: string
}

interface ColabLinkResponse {
  ok: boolean
  error?: string
  url?: string
  session_limit_note?: string
}

const DEFAULT_COLAB_NOTEBOOK_URL = 'https://colab.research.google.com/github/TheMomentLab/lerobot-studio/blob/dev/notebooks/lerobot_train.ipynb'

function buildColabSnippet(repoId: string, configPath: string): string {
  return [
    `repo_id = "${repoId}"  #@param {type:"string"}`,
    `config_path = "${configPath}"  #@param {type:"string"}`,
    '',
    '# If your shared notebook defines `lestudio_load_config`, this uses it first.',
    'if "lestudio_load_config" in globals():',
    '    cfg = lestudio_load_config(repo_id=repo_id, config_path=config_path)',
    'else:',
    '    import json, os',
    '    from huggingface_hub import hf_hub_download',
    '    cfg_file = hf_hub_download(',
    '        repo_id=repo_id,',
    '        filename=config_path,',
    '        repo_type="dataset",',
    '        token=os.getenv("HF_TOKEN") or os.getenv("HUGGINGFACE_HUB_TOKEN"),',
    '    )',
    '    with open(cfg_file, "r", encoding="utf-8") as f:',
    '        cfg = json.load(f)',
    'print("LeStudio config loaded:", cfg.get("dataset_repo"), cfg.get("policy"), cfg.get("steps"))',
  ].join('\n')
}

const TRAIN_STEP_RE = /\bstep\s*[:=]\s*([0-9]+(?:\.[0-9]+)?[KMBTQ]?)/i
const TRAIN_LOSS_RE = /\bloss\s*[:=]\s*([+-]?[0-9]*\.?[0-9]+(?:e[+-]?[0-9]+)?)/i
const TRAIN_TOTAL_RE = /cfg\.steps=([0-9_,]+)/i

function parseCompactNumber(token: string): number | null {
  const raw = token.trim().toUpperCase()
  const match = raw.match(/^([0-9]+(?:\.[0-9]+)?)([KMBTQ]?)$/)
  if (!match) {
    const value = Number(raw.replace(/,/g, ''))
    return Number.isFinite(value) ? Math.floor(value) : null
  }
  const value = Number(match[1])
  if (!Number.isFinite(value)) return null
  const unit = match[2]
  const mult = unit === 'K' ? 1_000 : unit === 'M' ? 1_000_000 : unit === 'B' ? 1_000_000_000 : unit === 'T' ? 1_000_000_000_000 : unit === 'Q' ? 1_000_000_000_000_000 : 1
  return Math.floor(value * mult)
}

function formatEta(seconds: number | null): string {
  if (!Number.isFinite(seconds) || seconds === null || seconds < 0) return '--'
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${ss}s`
  return `${ss}s`
}

export function TrainTab({ active }: TrainTabProps) {
  const running = useLeStudioStore((s) => !!s.procStatus.train || !!s.procStatus.train_install)
  const installing = useLeStudioStore((s) => !!s.procStatus.train_install)
  const procStatus = useLeStudioStore((s) => s.procStatus)
  const conflictReason = getProcessConflict('train', procStatus)
  const prevInstallingRef = useRef(false)
  const autoInstallCommandRef = useRef('')

  const trainLogs = useLeStudioStore((s) => s.logLines.train ?? EMPTY_TRAIN_LINES)
  const { config, buildConfig } = useConfig()
  const { stopProcess } = useProcess()
  const appendLog = useLeStudioStore((s) => s.appendLog)
  const addToast = useLeStudioStore((s) => s.addToast)
  const setSidebarSignals = useLeStudioStore((s) => s.setSidebarSignals)
  const setActiveTab = useLeStudioStore((s) => s.setActiveTab)
  const hfUsername = useLeStudioStore((s) => s.hfUsername)
  const defaultRepoId = `${hfUsername ?? 'user'}/my-dataset`
  const [source, setSource] = useState<'local' | 'hf'>('local')
  const [datasets, setDatasets] = useState<DatasetListItem[]>([])
  const [gpuStatus, setGpuStatus] = useState<GpuStatusResponse | null>(null)
  const [checkpoints, setCheckpoints] = useState<CheckpointItem[]>([])
  const [checkpointsLoading, setCheckpointsLoading] = useState(false)
  const [gpuTimedOut, setGpuTimedOut] = useState(false)
  const [checkpointsTimedOut, setCheckpointsTimedOut] = useState(false)
  const [preflightAction, setPreflightAction] = useState('')
  const [preflightReason, setPreflightReason] = useState('')
  const [preflightOk, setPreflightOk] = useState(true)
  const [preflightCommand, setPreflightCommand] = useState('')
  const [oomDetected, setOomDetected] = useState(false)
  const retryPendingRef = useRef(false)
  const [starting, setStarting] = useState(false)
  const [colabStarting, setColabStarting] = useState(false)

  const [copyingColab, setCopyingColab] = useState(false)
  const lossCanvasRef = useRef<HTMLCanvasElement | null>(null)

  const trainSteps = Number(config.train_steps ?? 100000)
  const colabOpenUrl = DEFAULT_COLAB_NOTEBOOK_URL
  const trainBatchSize = useMemo(() => {
    const parsed = Number(config.train_batch_size)
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed)
    return 8
  }, [config.train_batch_size])
  const localRepoId = useMemo(() => {
    const configured = config.train_repo_id ?? ''
    if (configured && datasets.some((ds) => ds.id === configured)) return configured
    return datasets[0]?.id ?? '__none__'
  }, [config.train_repo_id, datasets])

  const progress = useMemo(() => {
    let total = trainSteps > 0 ? trainSteps : null
    let current: number | null = null
    let latestLoss: number | null = null
    let firstStepTs: number | null = null
    let firstStepVal: number | null = null
    let lastStepTs: number | null = null
    let lastStepVal: number | null = null
    const lossSeries: number[] = []

    for (const line of trainLogs) {
      const totalMatch = line.text.match(TRAIN_TOTAL_RE)
      if (totalMatch) {
        const parsed = Number(totalMatch[1].replace(/[,_]/g, ''))
        if (Number.isFinite(parsed) && parsed > 0) total = parsed
      }

      const stepMatch = line.text.match(TRAIN_STEP_RE)
      if (stepMatch) {
        const parsedStep = parseCompactNumber(stepMatch[1])
        if (parsedStep !== null && parsedStep >= 0) {
          current = parsedStep
          if (firstStepTs === null || firstStepVal === null) {
            firstStepTs = line.ts
            firstStepVal = parsedStep
          }
          lastStepTs = line.ts
          lastStepVal = parsedStep
        }
      }

      const lossMatch = line.text.match(TRAIN_LOSS_RE)
      if (lossMatch) {
        const parsedLoss = Number(lossMatch[1])
        if (Number.isFinite(parsedLoss)) {
          latestLoss = parsedLoss
          lossSeries.push(parsedLoss)
        }
      }
    }

    const pct = Math.max(0, Math.min(100, current !== null && total && total > 0 ? (current / total) * 100 : 0))
    let etaSeconds: number | null = null
    if (running && current !== null && total && total > current && firstStepTs !== null && firstStepVal !== null && lastStepTs !== null && lastStepVal !== null) {
      const elapsedSeconds = Math.max(0, (lastStepTs - firstStepTs) / 1000)
      const progressed = Math.max(0, lastStepVal - firstStepVal)
      if (elapsedSeconds > 0 && progressed > 0) {
        const stepsPerSecond = progressed / elapsedSeconds
        if (stepsPerSecond > 0) etaSeconds = (total - current) / stepsPerSecond
      }
    }

    return {
      totalSteps: total,
      currentStep: current,
      latestLoss,
      etaText: formatEta(etaSeconds),
      progressPct: pct,
      lossSeries: lossSeries.slice(-300),
    }
  }, [running, trainLogs, trainSteps])

  const refreshDatasets = useCallback(async () => {
    const res = await apiGet<{ datasets: DatasetListItem[] }>('/api/datasets')
    setDatasets(res.datasets ?? [])
  }, [])

  const refreshGpu = useCallback(async () => {
    try {
      const res = await apiGet<GpuStatusResponse>('/api/gpu/status')
      setGpuStatus(res)
      setGpuTimedOut(false)
    } catch { /* GPU unavailable */ }
  }, [])

  const refreshCheckpoints = useCallback(async () => {
    setCheckpointsLoading(true)
    try {
      const res = await apiGet<{ ok?: boolean; checkpoints?: CheckpointItem[] }>('/api/checkpoints')
      setCheckpoints(res.checkpoints ?? [])
    } finally {
      setCheckpointsLoading(false)
      setCheckpointsTimedOut(false)
    }
  }, [])

  const refreshPreflight = useCallback(async () => {
    const device = config.train_device ?? 'cuda'
    const res = await apiGet<{ ok: boolean; reason?: string; action?: string; command?: string }>(`/api/train/preflight?device=${encodeURIComponent(device)}`)
    const next = {
      ok: !!res.ok,
      action: res.action ?? '',
      reason: res.reason ?? '',
      command: res.command ?? '',
    }
    setPreflightOk(next.ok)
    setPreflightAction(next.action)
    setPreflightReason(next.reason)
    setPreflightCommand(next.command)
    setSidebarSignals({ trainMissingDep: !next.ok })
    return next
  }, [config.train_device, setSidebarSignals])

  const installCudaTorch = async () => {
    appendLog('train', '[INFO] Starting PyTorch CUDA installer from GUI...', 'info')
    try {
      const res = await apiPost<{ ok: boolean; error?: string }>('/api/train/install_pytorch', { nightly: true, cuda_tag: 'cu128' })
      if (!res.ok) {
        appendLog('train', `[ERROR] ${res.error ?? 'Failed to start CUDA installer.'}`, 'error')
        return
      }
      addToast('CUDA PyTorch install started', 'info')
    } catch (e) {
      appendLog('train', `[ERROR] ${e instanceof Error ? e.message : 'Installer request failed.'}`, 'error')
    }
  }

  const runPreflightFix = useCallback(async (opts?: { auto?: boolean }) => {
    if (!preflightCommand) return
    const isAuto = !!opts?.auto
    if (isAuto && preflightAction === 'install_python_dep') {
      appendLog('train', '[INFO] Auto-installing missing Python packages in background...', 'info')
    } else {
      appendLog('train', `[INFO] Running: ${preflightCommand}`, 'info')
    }
    try {
      const res = await apiPost<{ ok: boolean; error?: string }>('/api/train/install_torchcodec_fix', { command: preflightCommand })
      if (!res.ok) {
        appendLog('train', `[ERROR] ${res.error ?? 'Failed to start installer.'}`, 'error')
        return
      }
      if (isAuto && preflightAction === 'install_python_dep') {
        addToast('Auto-install started — check console for progress', 'info')
      } else {
        addToast('Fix installer started — check console for progress', 'info')
      }
    } catch (e) {
      appendLog('train', `[ERROR] ${e instanceof Error ? e.message : 'Installer request failed.'}`, 'error')
    }
  }, [addToast, appendLog, preflightAction, preflightCommand])

  useEffect(() => {
    if (!active) return
    const nextSource = config.train_dataset_source === 'hf' ? 'hf' : 'local'
    setSource(nextSource)
    refreshDatasets()
    refreshGpu()
    refreshCheckpoints()
    refreshPreflight()
  }, [active, config.train_dataset_source, refreshCheckpoints, refreshDatasets, refreshGpu, refreshPreflight])

  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => {
      refreshGpu()
    }, 5000)
    return () => window.clearInterval(timer)
  }, [active, refreshGpu])

  // preflight 실패 시 주기적 재체크 (설치 완료 자동 감지)
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

  // OOM 감지: 로그에서 OutOfMemoryError 패턴 매칭
  useEffect(() => {
    if (running) { setOomDetected(false); return }
    const last20 = trainLogs.slice(-20)
    const hasOom = last20.some((l) => /OutOfMemoryError|CUDA out of memory/i.test(l.text))
    if (hasOom) setOomDetected(true)
  }, [trainLogs, running])

  useEffect(() => {
    if (!active || gpuStatus !== null) return
    const timer = window.setTimeout(() => {
      setGpuTimedOut(true)
    }, 10000)
    return () => window.clearTimeout(timer)
  }, [active, gpuStatus])

  useEffect(() => {
    if (!active || !checkpointsLoading) return
    const timer = window.setTimeout(() => {
      setCheckpointsTimedOut(true)
    }, 10000)
    return () => window.clearTimeout(timer)
  }, [active, checkpointsLoading])

  useEffect(() => {
    if (prevInstallingRef.current && !installing) {
      refreshPreflight()
    }
    prevInstallingRef.current = installing
  }, [installing, refreshPreflight])


  useEffect(() => {
    const canvas = lossCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const width = Math.max(1, Math.floor(canvas.clientWidth || canvas.width || 560))
    const height = Math.max(1, Math.floor(canvas.clientHeight || canvas.height || 200))
    const dpr = Math.max(1, window.devicePixelRatio || 1)

    if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    const values = progress.lossSeries
    if (values.length === 0) return

    const padL = 40
    const padR = 14
    const padT = 14
    const padB = 20
    const innerW = width - padL - padR
    const innerH = height - padT - padB
    if (innerW < 10 || innerH < 10) return

    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    for (const v of values) {
      if (v < min) min = v
      if (v > max) max = v
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return
    const span = max - min || 1
    min -= span * 0.08
    max += span * 0.08

    ctx.strokeStyle = 'rgba(148,163,184,0.12)'
    ctx.lineWidth = 1
    for (let i = 0; i <= 4; i += 1) {
      const y = padT + (i / 4) * innerH
      ctx.beginPath()
      ctx.moveTo(padL, y)
      ctx.lineTo(padL + innerW, y)
      ctx.stroke()
    }

    const yFor = (value: number) => padT + innerH - ((value - min) / (max - min)) * innerH
    const xFor = (index: number) => padL + (index / Math.max(1, values.length - 1)) * innerW

    ctx.beginPath()
    for (let i = 0; i < values.length; i += 1) {
      const x = xFor(i)
      const y = yFor(values[i])
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = '#86efac'
    ctx.lineWidth = 2
    ctx.stroke()

    ctx.strokeStyle = 'rgba(148,163,184,0.18)'
    ctx.lineWidth = 1
    ctx.strokeRect(padL, padT, innerW, innerH)
  }, [progress.lossSeries])

  const repoId = source === 'local' ? localRepoId : (config.train_repo_id ?? defaultRepoId)
  const noLocalDataset = source === 'local' && localRepoId === '__none__'
  const trainReady = preflightOk && !noLocalDataset && !conflictReason
  const preflightFixLabel = preflightAction === 'install_python_dep' ? 'Install Missing Python Packages' : 'Run Fix'
  const startDisabled = starting || !trainReady
  const trainBlockers = useMemo(() => {
    const blockers: string[] = []
    if (!preflightOk) blockers.push(preflightReason || 'Device preflight failed')
    if (noLocalDataset) blockers.push('No local dataset selected')
    if (conflictReason) blockers.push(`${conflictReason} process running`)
    return blockers
  }, [preflightOk, preflightReason, noLocalDataset, conflictReason])

  const reduceAndRetry = async () => {
    const current = trainBatchSize
    const next = Math.max(1, Math.floor(current / 2))
    await buildConfig({ train_batch_size: next })
    setOomDetected(false)
    appendLog('train', `[INFO] Batch size reduced: ${current} → ${next}. Retrying...`, 'info')
    retryPendingRef.current = true
  }

  const start = async () => {
    if (source === 'local' && repoId === '__none__') {
      appendLog('train', '[ERROR] No local dataset found. Switch to Hugging Face or create a local dataset first.', 'error')
      return
    }
    setStarting(true)
    try {
      const cfg = {
        train_policy: config.train_policy ?? 'act',
        train_repo_id: repoId,
        train_steps: Number(config.train_steps ?? 100000),
        train_device: config.train_device ?? 'cuda',
        train_batch_size: trainBatchSize,
        train_lr: (config.train_lr as string | undefined) || undefined,
      }
      await buildConfig({ ...cfg, train_dataset_source: source })
      const preflight = await refreshPreflight()
      if (!preflight.ok) {
        appendLog('train', `[ERROR] ${preflight.reason || 'Device compatibility check failed.'}`, 'error')
        if (preflight.command) {
          appendLog('train', `[INFO] Run Fix command: ${preflight.command}`, 'info')
        }
        return
      }
      const res = await apiPost<{ ok: boolean; error?: string; auto_install_started?: boolean }>('/api/train/start', cfg)
      if (!res.ok) {
        if (res.auto_install_started) {
          appendLog('train', `[INFO] ${res.error ?? 'Auto-install started. Retry training after installer finishes.'}`, 'info')
          addToast('Auto-fix started in background', 'info')
          await refreshPreflight()
          return
        }
        appendLog('train', `[ERROR] ${res.error ?? 'failed to start train'}`, 'error')
        return
      }
      addToast('Training started', 'success')
      refreshCheckpoints()
    } finally {
      setStarting(false)
    }
  }

  const stop = async () => {
    await stopProcess('train')
    addToast('Training stop requested', 'info')
  }

  const copyColabSnippet = useCallback(async (targetRepoId: string, targetConfigPath: string): Promise<boolean> => {
    const snippet = buildColabSnippet(targetRepoId, targetConfigPath)
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
      appendLog('train', '[WARN] Clipboard API is unavailable. Copy repo_id/config_path manually.', 'info')
      return false
    }
    try {
      await navigator.clipboard.writeText(snippet)
      appendLog('train', '[INFO] Colab snippet copied. Paste it into the first Colab cell.', 'info')
      addToast('Colab snippet copied', 'success')
      return true
    } catch (e) {
      appendLog('train', `[WARN] Failed to copy Colab snippet: ${e instanceof Error ? e.message : 'clipboard denied'}`, 'info')
      return false
    }
  }, [addToast, appendLog])

  const copyColabSnippetFromForm = async () => {
    if (!repoId || repoId === '__none__' || !repoId.includes('/')) {
      addToast('Select a valid dataset repo first', 'info')
      return
    }
    setCopyingColab(true)
    try {
      await copyColabSnippet(repoId, 'lestudio_train_config.json')
    } finally {
      setCopyingColab(false)
    }
  }

  const startOnColab = async () => {
    if (source === 'local' && repoId === '__none__') {
      appendLog('train', '[ERROR] No local dataset found. Switch to Hugging Face or create a local dataset first.', 'error')
      return
    }

    const popup = window.open(colabOpenUrl, '_blank')
    setColabStarting(true)
    try {
      const selectedDevice = ((config.train_device as string | undefined) ?? 'cuda').toLowerCase()
      const colabDevice = selectedDevice === 'cpu' ? 'cpu' : 'cuda'
      if (selectedDevice === 'mps') {
        appendLog('train', '[WARN] Colab does not support MPS. Using CUDA for Colab config.', 'info')
      }

      const cfg = {
        train_policy: config.train_policy ?? 'act',
        train_repo_id: repoId,
        train_steps: Number(config.train_steps ?? 100000),
        train_device: colabDevice,
        train_batch_size: trainBatchSize,
        train_lr: (config.train_lr as string | undefined) || undefined,
        train_output_repo: ((config.train_output_repo as string | undefined) ?? '').trim() || undefined,
      }
      await buildConfig({ ...cfg, train_dataset_source: source })

      const upload = await apiPost<ColabConfigResponse>('/api/train/colab/config', {
        ...cfg,
        train_dataset_source: source,
        colab_notebook_url: colabOpenUrl,
      })
      if (!upload.ok) {
        if (popup && !popup.closed) popup.close()
        appendLog('train', `[ERROR] ${upload.error ?? 'Failed to upload Colab config.'}`, 'error')
        return
      }

      const uploadedRepoId = (upload.repo_id ?? repoId).trim()
      const uploadedConfigPath = (upload.config_path ?? 'lestudio_train_config.json').trim() || 'lestudio_train_config.json'
      await copyColabSnippet(uploadedRepoId, uploadedConfigPath)

      let link = (upload.colab_link ?? '').trim()
      if (!link && upload.repo_id) {
        const query = new URLSearchParams({
          repo_id: upload.repo_id,
          config_path: upload.config_path ?? 'lestudio_train_config.json',
        })
        query.set('notebook_url', colabOpenUrl)
        const fetched = await apiGet<ColabLinkResponse>(`/api/train/colab/link?${query.toString()}`)
        if (!fetched.ok) {
          appendLog('train', `[WARN] ${fetched.error ?? 'Colab link is not configured.'}`, 'info')
        } else {
          link = (fetched.url ?? '').trim()
          if (fetched.session_limit_note) {
            appendLog('train', `[WARN] ${fetched.session_limit_note}`, 'info')
          }
        }
      }

      if (!link) {
        appendLog('train', '[WARN] Config uploaded to Hub, but deep link was not generated.', 'info')
        appendLog('train', '[INFO] Opened starter Colab notebook. Paste the copied snippet into the first cell.', 'info')
        addToast('Config uploaded. Opened starter Colab notebook.', 'info')
        return
      }

      try {
        if (popup && !popup.closed) popup.location.href = link
        else window.open(link, '_blank')
      } catch {
        window.open(link, '_blank')
      }
      appendLog('train', '[INFO] Colab notebook opened. Complete HF login there and run all cells.', 'info')
      if (upload.session_limit_note) {
        appendLog('train', `[WARN] ${upload.session_limit_note}`, 'info')
      }
      addToast('Colab flow started (manual Run all required)', 'success')
    } catch (e) {
      if (popup && !popup.closed) popup.close()
      appendLog('train', `[ERROR] ${e instanceof Error ? e.message : 'Colab request failed.'}`, 'error')
    } finally {
      setColabStarting(false)
    }
  }



  // OOM reduce & retry: config 반영 후 자동 재시작
  useEffect(() => {
    if (retryPendingRef.current && !running) {
      retryPendingRef.current = false
      start()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.train_batch_size])

  const applyPreset = (preset: 'quick' | 'standard' | 'full') => {
    const steps = preset === 'quick' ? 1000 : preset === 'standard' ? 50000 : 100000
    buildConfig({ train_steps: steps })
  }

  return (
    <section id="tab-train" className={`tab ${active ? 'active' : ''}`}>
      <div className="section-header">
        <h2>Train Policy</h2>
        <span className={`status-verdict ${running || trainReady ? 'ready' : 'warn'}`}>
          {running ? 'Running' : trainReady ? 'Ready to Start' : 'Action Needed'}
        </span>
      </div>

      {!running && !trainReady ? (
        <div className="train-blocker-card">
          <div className="dsub" style={{ marginBottom: 6 }}>Training blocked:</div>
          <div className="train-blocker-chip-row">
            {trainBlockers.map((blocker) => (
              <span key={blocker} className="dbadge badge-warn">{blocker}</span>
            ))}
          </div>
          <div className="train-blocker-actions">
            {!preflightOk ? (
              <button type="button" className="link-btn" onClick={() => buildConfig({ train_device: 'cpu' })}>→ Switch to CPU</button>
            ) : null}
            {!preflightOk && preflightAction === 'install_python_dep' && preflightCommand ? (
              <button type="button" className="link-btn" onClick={() => { void runPreflightFix() }}>→ Install Missing Python Packages</button>
            ) : null}
            <button type="button" className="link-btn" onClick={() => setActiveTab('dataset')}>→ Open Dataset</button>
            <button type="button" className="link-btn" onClick={() => setActiveTab('record')}>→ Go to Record</button>
          </div>
        </div>
      ) : null}


      <div className="train-content">
        <div className="quick-guide">
          <h3>Training Guide</h3>
          <p>Training can take <strong>hours to days</strong> depending on hardware and dataset size. Closing the GUI or restarting the server will <strong>terminate the process</strong>. Monitor real-time progress and loss values in the <strong>global console drawer</strong>.</p>
          <p className="field-help" style={{ marginTop: 8 }}>Colab runs are also not permanent: idle sessions can disconnect, and free-tier runtime length is limited. Push checkpoints frequently to avoid losing progress.</p>
        </div>

        <div className="train-main-grid">
        <div className="card">
          <h3>Configuration</h3>
          <label>Policy Type</label>
          <select value={config.train_policy ?? 'act'} onChange={(e) => buildConfig({ train_policy: e.target.value })}>
            <option value="act">ACT (Action Chunking with Transformers)</option>
            <option value="diffusion">Diffusion Policy</option>
            <option value="tdmpc2">TD-MPC2</option>
          </select>
          <label>Dataset Source</label>
          <div className="mode-toggle" style={{ marginLeft: 0, marginBottom: 8 }}>
            <button className={`toggle ${source === 'local' ? 'active' : ''}`} onClick={() => setSource('local')}>
              Local
            </button>
            <button className={`toggle ${source === 'hf' ? 'active' : ''}`} onClick={() => setSource('hf')}>
              Hugging Face
            </button>
          </div>
          {source === 'local' ? (
            <>
              {datasets.length === 0 && (
                <div className="info-banner warn" style={{ marginBottom: 8, padding: '10px 14px', borderRadius: 8, background: 'color-mix(in srgb, var(--yellow) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--yellow) 30%, transparent)', fontSize: 12, color: 'var(--yellow)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 16 }}>⚠️</span>
                  <span>No local datasets found. Record episodes in the <strong>Record</strong> tab first, or switch to <strong>Hugging Face</strong> source above.</span>
                  <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', flexWrap: 'wrap' }}>
                    <button type="button" className="btn-xs" onClick={() => setActiveTab('record')}>Go to Record</button>
                    <button type="button" className="btn-xs" onClick={() => setActiveTab('dataset')}>Open Dataset</button>
                    <button type="button" className="btn-xs" onClick={() => { setSource('hf'); buildConfig({ train_dataset_source: 'hf' }) }}>Use Hugging Face</button>
                  </div>
                </div>
              )}
              <label>Local Dataset</label>
              <select value={repoId} onChange={(e) => buildConfig({ train_repo_id: e.target.value })}>
                {datasets.length === 0 ? <option value="__none__">No local datasets — record in Record tab first</option> : null}
                {datasets.map((ds) => (
                  <option key={ds.id} value={ds.id}>
                    {ds.id}
                  </option>
                ))}
              </select>
              <div className="field-help" style={{ marginTop: 4 }}>Choose a dataset from local cache (`~/.cache/huggingface/lerobot`).</div>
            </>
          ) : (
            <>
              <label>Dataset Repo ID</label>
              <input type="text" value={config.train_repo_id ?? defaultRepoId} onChange={(e) => buildConfig({ train_repo_id: e.target.value })} />
            </>
          )}
          <div className="train-steps-row">
            <label style={{ margin: 0 }}>Training Steps</label>
            <div className="train-step-presets">
              <button className={`btn-xs${trainSteps === 1000 ? ' active' : ''}`} onClick={() => applyPreset('quick')}>
                Quick (1K)
              </button>
              <button className={`btn-xs${trainSteps === 50000 ? ' active' : ''}`} onClick={() => applyPreset('standard')}>
                Standard (50K)
              </button>
              <button className={`btn-xs${trainSteps === 100000 ? ' active' : ''}`} onClick={() => applyPreset('full')}>
                Full (100K)
              </button>
            </div>
          </div>
          <input type="number" value={trainSteps} onChange={(e) => buildConfig({ train_steps: Number(e.target.value) })} />
          <label>Batch Size</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="number"
              min={1}
              step={1}
              value={trainBatchSize}
              onChange={(e) => {
                const raw = e.target.value.trim()
                if (!raw) return
                const next = Number(raw)
                if (!Number.isFinite(next) || next <= 0) return
                buildConfig({ train_batch_size: Math.floor(next) })
              }}
              style={{ maxWidth: 160 }}
            />
          </div>
          <div className="field-help" style={{ marginTop: 4 }}>Set any positive integer. If OOM occurs, lower this value and retry. This value is applied immediately when training starts.</div>
          <details className="advanced-panel advanced-panel-clickable" style={{ marginTop: 8 }}>
            <summary>Advanced Params</summary>
            <div style={{ marginTop: 8, padding: 10, border: '1px solid var(--border)', borderRadius: 6, background: 'color-mix(in srgb, var(--bg3) 60%, transparent)' }}>
              <div className="train-advanced-grid">
                <div>
                  <label style={{ marginBottom: 3 }}>Learning Rate</label>
                  <input
                    type="text"
                    placeholder="default (1e-4)"
                    value={(config.train_lr as string | undefined) ?? ''}
                    onChange={(e) => buildConfig({ train_lr: e.target.value })}
                  />
                  <div className="field-help">e.g. 1e-4, 0.0001</div>
                </div>
                <div>
                  <label style={{ marginBottom: 3 }}>Model Output Repo (Optional)</label>
                  <input
                    type="text"
                    placeholder="user/my-policy"
                    value={(config.train_output_repo as string | undefined) ?? ''}
                    onChange={(e) => buildConfig({ train_output_repo: e.target.value })}
                  />
                  <div className="field-help">Used by Colab flow to choose where trained checkpoints are uploaded.</div>
                </div>
              </div>
            </div>
          </details>
          <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>

            <button
              type="button"
              className="btn-xs"
              onClick={() => { void copyColabSnippetFromForm() }}
              disabled={copyingColab || !repoId.includes('/')}
              title={repoId.includes('/') ? 'Copy Colab snippet with repo_id/config_path' : 'Select a valid dataset repo first'}
            >
              {copyingColab ? 'Copying snippet...' : 'Copy Colab Snippet'}
            </button>
          </div>
          <div className="field-help" style={{ marginTop: 4 }}>
            Use <strong>Train on Colab</strong> to upload your config and open the notebook in one step. Use <strong>Copy Colab Snippet</strong> to re-copy the load command and paste it into the first cell.
          </div>
          <label>Compute Device</label>
          <select value={config.train_device ?? 'cuda'} onChange={(e) => buildConfig({ train_device: e.target.value })}>
            <option value="cuda">CUDA (GPU)</option>
            <option value="cpu">CPU</option>
            <option value="mps">MPS (Apple Silicon)</option>
          </select>
          <div className="field-help" style={{ marginTop: 4 }}>
            For Colab, device is limited to CUDA/CPU. If MPS is selected, Colab flow automatically uses CUDA.
          </div>
          {!preflightOk ? (
            <div id="train-device-warning" className="train-device-warning">
              {preflightReason || 'Device preflight failed. Training is blocked.'}
            </div>
          ) : null}
          {!preflightOk && preflightAction === 'install_torch_cuda' ? (
            <div id="train-device-actions" className="recovery-action" style={{ marginTop: 8 }}>
              <div className="field-help" style={{ marginBottom: 6 }}>Recommended next step to unblock training:</div>
              <button id="train-install-btn" className="btn-primary" onClick={installCudaTorch}>
                Install CUDA PyTorch (Nightly)
              </button>
            </div>
          ) : null}
          {!preflightOk && preflightCommand && preflightAction !== 'install_torch_cuda' ? (
            <div id="train-device-actions" className="recovery-action" style={{ marginTop: 8 }}>
              <div className="field-help" style={{ marginBottom: 6 }}>
                {preflightAction === 'install_python_dep'
                  ? 'Missing Python packages detected. Auto-install starts automatically.'
                  : 'Recommended next step to unblock training:'}
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
          <div style={{ marginTop: 10, padding: 10, border: '1px solid var(--border)', borderRadius: 8, background: 'rgba(255,255,255,0.02)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--text2)' }}>Training Progress</span>
              <span id="train-progress-status" style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: running ? 'rgba(34,197,94,0.18)' : !preflightOk ? 'rgba(248,81,73,0.18)' : 'rgba(148,163,184,0.18)', color: running ? '#86efac' : !preflightOk ? '#fca5a5' : 'var(--text2)' }}>
                {running ? 'RUNNING' : !preflightOk ? 'BLOCKED' : 'IDLE'}
              </span>
            </div>
            <div className="usb-bus-bar-track">
              <div
                id="train-progress-fill"
                className="usb-bar-fill good"
                style={{ width: `${progress.progressPct}%` }}
                role="progressbar"
                aria-label="Training progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress.progressPct)}
                aria-valuetext={`${Math.round(progress.progressPct)} percent`}
              />
            </div>
            {running || progress.currentStep !== null || progress.latestLoss !== null ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 12, color: 'var(--text2)', gap: 10, flexWrap: 'wrap' }}>
                <span>
                  Step: {progress.currentStep !== null ? progress.currentStep.toLocaleString() : '--'} / {progress.currentStep !== null && progress.totalSteps !== null ? (progress.totalSteps ?? trainSteps).toLocaleString() : '--'}
                </span>
                <span>Loss: {progress.latestLoss !== null ? progress.latestLoss.toFixed(4) : '--'}</span>
                <span>ETA: {progress.etaText}</span>
              </div>
            ) : (
              <div className="field-help" style={{ marginTop: 8 }}>No training signal yet. Start training to see step/loss/ETA metrics.</div>
            )}
            {running && (
              <div style={{ marginTop: 8, border: '1px solid var(--border)', borderRadius: 6, padding: 8, background: 'var(--bg3)' }}>
                <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 6 }}>Loss Trend</div>
                <div style={{ position: 'relative' }}>
                  <canvas ref={lossCanvasRef} id="train-loss-canvas" width={560} height={200} style={{ width: '100%', height: 200, display: 'block' }} />
                  {progress.lossSeries.length === 0 && (
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text2)', fontSize: 12 }}>
                      No data yet — loss values will appear here during training.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
          <div className="train-info-stack">
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>Checkpoints</h3>
              <button className="btn-xs" onClick={refreshCheckpoints}>
                ↺ Refresh
              </button>
            </div>
            <div id="train-checkpoints-list" className="device-list">
              {checkpointsLoading ? (
              checkpointsTimedOut ? (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="muted">Couldn't load checkpoints</span>
                  <button className="btn-xs" onClick={refreshCheckpoints}>Retry</button>
                </div>
              ) : (
                <div className="muted">Loading checkpoints...</div>
              )
            ) : null}
              {!checkpointsLoading && checkpoints.length === 0 ? <div className="muted">No checkpoints found. Train a model first.</div> : null}
              {!checkpointsLoading && checkpoints.length > 0
                ? checkpoints.map((cp) => (
                    <div key={cp.path} style={{ padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg3)', marginBottom: 6 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{cp.display ?? cp.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>{cp.path}</div>
                    </div>
                  ))
                : null}
            </div>
          </div>

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>GPU Status</h3>
              <button onClick={refreshGpu} className="btn-xs">
                ↺ Refresh
              </button>
            </div>
            <div id="train-gpu-status" className="device-list">
              {!gpuStatus ? (
                gpuTimedOut ? (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="muted">Couldn't load GPU info</span>
                    <button className="btn-xs" onClick={refreshGpu}>Retry</button>
                  </div>
                ) : (
                  <div className="muted">Loading GPU info...</div>
                )
              ) : null}
              {gpuStatus && !gpuStatus.exists ? <div className="muted">NVIDIA GPU info unavailable: {gpuStatus.error ?? 'Check nvidia-smi'}</div> : null}
              {gpuStatus?.exists ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>GPU Utilization</span>
                    <span style={{ fontFamily: 'var(--mono)', fontWeight: 700 }}>{Math.round(gpuStatus.utilization ?? 0)}%</span>
                  </div>
                  <div className="usb-bus-bar-track">
                    <div
                      className={`usb-bar-fill ${(gpuStatus.utilization ?? 0) > 80 ? 'danger' : (gpuStatus.utilization ?? 0) > 50 ? 'warn' : 'good'}`}
                      style={{ width: `${Math.max(0, Math.min(100, gpuStatus.utilization ?? 0))}%` }}
                    />
                  </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                    <span>VRAM Usage</span>
                    <span style={{ fontFamily: 'var(--mono)' }}>
                      {Math.round(gpuStatus.memory_used ?? 0)}MB / {Math.round(gpuStatus.memory_total ?? 0)}MB
                    </span>
                  </div>
                  <div className="usb-bus-bar-track">
                    <div
                      className={`usb-bar-fill ${(gpuStatus.memory_percent ?? 0) > 85 ? 'danger' : (gpuStatus.memory_percent ?? 0) > 70 ? 'warn' : 'good'}`}
                      style={{ width: `${Math.max(0, Math.min(100, gpuStatus.memory_percent ?? 0))}%` }}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </div>
          </div>
        </div>
        {oomDetected && !running ? (
          <div className="train-device-warning" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, width: '100%', maxWidth: 600 }}>
            <span>GPU out of memory. Current batch size: {trainBatchSize}. Reduce to {Math.max(1, Math.floor(trainBatchSize / 2))} and retry?</span>
            <button className="btn-sm" style={{ flexShrink: 0 }} onClick={reduceAndRetry}>
              Reduce &amp; Retry
            </button>
          </div>
        ) : null}
        {!running && checkpoints.length > 0 && (
          <div className="workflow-cta" style={{ marginTop: 12 }}>
            <button className="btn-sm" onClick={() => setActiveTab('eval')}>→ Proceed to Eval</button>
          </div>
        )}
      </div>
      <div className="train-sticky-controls">
        <div className="train-run-summary">
          <span className={`dbadge ${running || starting ? 'badge-run' : trainReady ? 'badge-ok' : 'badge-err'}`}>
            {starting ? 'STARTING' : running ? 'RUNNING' : trainReady ? 'READY' : 'BLOCKED'}
          </span>
          <span className="train-run-text">
            {running || starting
              ? `Step ${progress.currentStep !== null ? progress.currentStep.toLocaleString() : '--'} / ${progress.currentStep !== null && progress.totalSteps !== null ? (progress.totalSteps ?? trainSteps).toLocaleString() : '--'}`
              : trainReady
                ? 'Ready to start training'
                : trainBlockers[0] ?? 'Resolve blockers before starting'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            className="btn-sm"
            onClick={() => { void startOnColab() }}
            disabled={colabStarting || running || starting || noLocalDataset}
            title={noLocalDataset ? 'Record/download a dataset first' : 'Upload config and open Colab notebook'}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <img src="/colab-logo.png" alt="" aria-hidden="true" style={{ width: 14, height: 14, objectFit: 'contain' }} />
              {colabStarting ? 'Preparing Colab...' : 'Train on Colab'}
            </span>
          </button>
          <ProcessButtons running={running || starting} onStart={start} onStop={stop} startLabel={starting ? '⏳ Starting...' : '▶ Start Training'} disabled={startDisabled} conflictReason={conflictReason} />
        </div>
      </div>
    </section>
  )
}
