import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLeStudioStore } from '../../store'
import { useProcess } from '../../hooks/useProcess'
import type { LogLine } from '../../lib/types'

const PROCESSES = ['teleop', 'record', 'calibrate', 'motor_setup', 'train', 'eval'] as const
const TAB_TO_PROCESS: Record<string, string> = {
  teleop: 'teleop',
  record: 'record',
  calibrate: 'calibrate',
  'motor-setup': 'motor_setup',
  train: 'train',
  eval: 'eval',
}

const PROCESS_TO_TAB: Record<string, string> = {
  teleop: 'teleop',
  record: 'record',
  calibrate: 'calibrate',
  motor_setup: 'motor-setup',
  train: 'train',
  eval: 'eval',
}

const PROCESS_ICONS: Record<string, string> = {
  teleop: '🎮',
  record: '🔴',
  calibrate: '🎯',
  motor_setup: '⚙️',
  train: '🧠',
  eval: '📈',
}

const PROCESS_LABELS: Record<string, string> = {
  teleop: 'Teleop',
  record: 'Record',
  calibrate: 'Calibrate',
  motor_setup: 'Motor Setup',
  train: 'Train',
  eval: 'Eval',
}

const EMPTY_LINES: LogLine[] = []

const MIN_HEIGHT = 120
const MAX_HEIGHT_RATIO = 0.6
const DEFAULT_HEIGHT = 170

/* ── Lightweight log parsers for running bar ── */

const TRAIN_STEP_RE = /\bstep\s*[:=]\s*([0-9]+(?:\.[0-9]+)?[KMBTQ]?)/i
const TRAIN_LOSS_RE = /\bloss\s*[:=]\s*([+-]?[0-9]*\.?[0-9]+(?:e[+-]?[0-9]+)?)/i
const TRAIN_TOTAL_RE = /cfg\.steps=([0-9_,]+)/i

const EVAL_DONE_RE = /episode\s*([0-9]+)\s*\/\s*([0-9]+)/i
const EVAL_REWARD_RE = /\b(?:mean[_\s-]?reward|avg[_\s-]?reward|episode[_\s-]?reward)\s*[:=]\s*([+-]?[0-9]*\.?[0-9]+(?:e[+-]?[0-9]+)?)/i

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

function formatEta(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return null
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${Math.ceil(seconds)}s`
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`
  return n.toLocaleString()
}

interface RunningBarInfo {
  process: string
  pct: number | null
  text: string
}

function useRunningProcesses(): RunningBarInfo[] {
  const procStatus = useLeStudioStore((s) => s.procStatus)
  const allLogLines = useLeStudioStore((s) => s.logLines)
  const config = useLeStudioStore((s) => s.config)
  const [elapsed, setElapsed] = useState<Record<string, number>>({})
  const startTimesRef = useRef<Record<string, number>>({})

  // Track start times
  useEffect(() => {
    for (const p of PROCESSES) {
      const isRunning = p === 'train' ? !!(procStatus.train || procStatus.train_install) : !!procStatus[p]
      if (isRunning && !startTimesRef.current[p]) {
        startTimesRef.current[p] = Date.now()
      } else if (!isRunning) {
        delete startTimesRef.current[p]
      }
    }
  }, [procStatus])

  // Tick elapsed every second
  useEffect(() => {
    const hasRunning = PROCESSES.some((p) =>
      p === 'train' ? !!(procStatus.train || procStatus.train_install) : !!procStatus[p],
    )
    if (!hasRunning) return

    const id = setInterval(() => {
      const now = Date.now()
      const next: Record<string, number> = {}
      for (const [p, start] of Object.entries(startTimesRef.current)) {
        next[p] = Math.floor((now - start) / 1000)
      }
      setElapsed(next)
    }, 1000)

    return () => clearInterval(id)
  }, [procStatus])

  return useMemo(() => {
    const results: RunningBarInfo[] = []

    for (const p of PROCESSES) {
      const isRunning = p === 'train' ? !!(procStatus.train || procStatus.train_install) : !!procStatus[p]
      if (!isRunning) continue

      const logs = allLogLines[p] ?? EMPTY_LINES

      if (p === 'train') {
        let step: number | null = null
        let total: number | null = Number(config.train_steps ?? 100000) || null
        let loss: number | null = null
        let firstTs: number | null = null
        let firstStep: number | null = null
        let lastTs: number | null = null
        let lastStep: number | null = null

        for (const line of logs) {
          const totalMatch = line.text.match(TRAIN_TOTAL_RE)
          if (totalMatch) {
            const parsed = Number(totalMatch[1].replace(/[,_]/g, ''))
            if (Number.isFinite(parsed) && parsed > 0) total = parsed
          }
          const stepMatch = line.text.match(TRAIN_STEP_RE)
          if (stepMatch) {
            const parsed = parseCompactNumber(stepMatch[1])
            if (parsed !== null) {
              step = parsed
              if (firstTs === null) { firstTs = line.ts; firstStep = parsed }
              lastTs = line.ts; lastStep = parsed
            }
          }
          const lossMatch = line.text.match(TRAIN_LOSS_RE)
          if (lossMatch) {
            const parsed = Number(lossMatch[1])
            if (Number.isFinite(parsed)) loss = parsed
          }
        }

        const pct = step !== null && total ? Math.min(100, Math.max(0, (step / total) * 100)) : null
        let eta: string | null = null
        if (step !== null && total && total > step && firstTs !== null && firstStep !== null && lastTs !== null && lastStep !== null) {
          const elapsedSec = (lastTs - firstTs) / 1000
          const progressed = lastStep - firstStep
          if (elapsedSec > 0 && progressed > 0) {
            eta = formatEta((total - step) / (progressed / elapsedSec))
          }
        }

        const parts: string[] = []
        if (step !== null && total) parts.push(`${formatNumber(step)} / ${formatNumber(total)}`)
        if (loss !== null) parts.push(`Loss ${loss.toFixed(4)}`)
        if (eta) parts.push(`ETA ${eta}`)
        if (!parts.length) parts.push('Starting…')

        results.push({ process: p, pct, text: parts.join(' · ') })
      } else if (p === 'eval') {
        let done = 0
        let total: number | null = null
        let reward: number | null = null

        for (const line of logs) {
          const doneMatch = line.text.match(EVAL_DONE_RE)
          if (doneMatch) {
            const d = parseInt(doneMatch[1], 10)
            if (Number.isFinite(d) && d > done) done = d
            const t = parseInt(doneMatch[2], 10)
            if (Number.isFinite(t) && t > 0) total = t
          }
          const rewardMatch = line.text.match(EVAL_REWARD_RE)
          if (rewardMatch) {
            const r = Number(rewardMatch[1])
            if (Number.isFinite(r)) reward = r
          }
        }

        const pct = total && total > 0 ? Math.min(100, Math.max(0, (done / total) * 100)) : null
        const parts: string[] = []
        if (total) parts.push(`${done} / ${total} episodes`)
        if (reward !== null) parts.push(`Reward ${reward.toFixed(4)}`)
        if (!parts.length) parts.push('Starting…')

        results.push({ process: p, pct, text: parts.join(' · ') })
      } else if (p === 'record') {
        let episode = 0
        for (const line of logs) {
          const m = line.text.match(/episode\s*([0-9]+)/i)
          if (m) {
            const n = parseInt(m[1], 10)
            if (Number.isFinite(n) && n > episode) episode = n
          }
        }
        const elapsedSec = elapsed[p] ?? 0
        const parts: string[] = []
        if (episode > 0) parts.push(`Episode ${episode}`)
        parts.push(elapsedSec > 0 ? `Recording ${formatElapsed(elapsedSec)}` : 'Recording…')
        results.push({ process: p, pct: null, text: parts.join(' · ') })
      } else {
        // teleop, calibrate, motor_setup — no progress bar, just elapsed
        const elapsedSec = elapsed[p] ?? 0
        const text = elapsedSec > 0 ? `Running ${formatElapsed(elapsedSec)}` : 'Running…'
        results.push({ process: p, pct: null, text })
      }
    }

    return results
  }, [procStatus, allLogLines, config.train_steps, elapsed])
}

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

/* ── Running Bar Component ── */

function RunningBar({ info, onStop, onOpen }: { info: RunningBarInfo; onStop: () => void; onOpen: () => void }) {
  return (
    <div className="console-running-bar">
      <div className="running-indicator">
        <span className="pulse-dot" />
        {PROCESS_ICONS[info.process]} {PROCESS_LABELS[info.process]}
      </div>
      <div className="running-progress">
        {info.pct !== null && (
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${info.pct}%` }} />
          </div>
        )}
        <span className="progress-text">{info.text}</span>
      </div>
      <button className="btn-goto" onClick={onOpen} title={`${PROCESS_LABELS[info.process]} 탭으로 이동`}>
        Open ↗
      </button>
      <button className="btn-stop" onClick={onStop}>
        ■ Stop
      </button>
    </div>
  )
}

/* ── Main ConsoleDrawer ── */

export function ConsoleDrawer() {
  const [collapsed, setCollapsed] = useState(true)
  const [selectedProcess, setSelectedProcess] = useState<string>('teleop')
  const [stdinValue, setStdinValue] = useState('')
  const logRef = useRef<HTMLDivElement>(null)
  const prevRunningByProcessRef = useRef<Record<string, boolean>>({})
  const draggingRef = useRef(false)

  const consoleHeight = useLeStudioStore((s) => s.consoleHeight)
  const setConsoleHeight = useLeStudioStore((s) => s.setConsoleHeight)
  const lines = useLeStudioStore((s) => s.logLines[selectedProcess] ?? EMPTY_LINES)
  const procStatus = useLeStudioStore((s) => s.procStatus)
  const activeTab = useLeStudioStore((s) => s.activeTab)
  const clearLog = useLeStudioStore((s) => s.clearLog)
  const addToast = useLeStudioStore((s) => s.addToast)
  const setActiveTab = useLeStudioStore((s) => s.setActiveTab)
  const { sendProcessInput, runProcessCommand, stopProcess } = useProcess()
  const runningProcesses = useRunningProcesses()
  // Hide Running Bar for the process matching the current tab (avoids duplicate Stop button)
  const visibleRunning = useMemo(
    () => runningProcesses.filter((info) => info.process !== TAB_TO_PROCESS[activeTab]),
    [runningProcesses, activeTab],
  )

  const isProcessRunning = useCallback(
    (processName: string) => {
      if (processName === 'train') return !!(procStatus.train || procStatus.train_install)
      return !!procStatus[processName]
    },
    [procStatus],
  )

  const running = isProcessRunning(selectedProcess)
  const processState = running ? 'RUNNING' : 'IDLE'
  const stateBadgeClass = running ? 'badge-run' : 'badge-idle'

  /* auto-scroll to bottom */
  useEffect(() => {
    if (logRef.current && !collapsed) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [lines, collapsed])

  useEffect(() => {
    const mapped = TAB_TO_PROCESS[activeTab]
    if (!mapped) return
    setSelectedProcess((prev) => (prev === mapped ? prev : mapped))
  }, [activeTab])

  useEffect(() => {
    let startedProcess: string | null = null

    for (const processName of PROCESSES) {
      const runningNow = isProcessRunning(processName)
      const wasRunning = !!prevRunningByProcessRef.current[processName]

      if (!wasRunning && runningNow && startedProcess === null) {
        startedProcess = processName
      }

      prevRunningByProcessRef.current[processName] = runningNow
    }

    if (startedProcess) {
      setSelectedProcess(startedProcess)
      setCollapsed(false)
    }
  }, [isProcessRunning])

  /* ── drag-to-resize ── */
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    draggingRef.current = true
    const startY = e.clientY
    const startH = consoleHeight
    const maxH = window.innerHeight * MAX_HEIGHT_RATIO

    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return
      const delta = startY - ev.clientY
      const next = Math.min(maxH, Math.max(MIN_HEIGHT, startH + delta))
      setConsoleHeight(next)
    }

    const onUp = () => {
      draggingRef.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }

    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'ns-resize'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [consoleHeight, setConsoleHeight])

  const handleResizeDoubleClick = useCallback(() => {
    setConsoleHeight(DEFAULT_HEIGHT)
  }, [setConsoleHeight])

  const sendInput = useCallback(async () => {
    const input = running ? stdinValue : stdinValue.trim()
    if (!running && !input) return

    try {
      if (running) {
        const res = await sendProcessInput(selectedProcess, input)
        if (!res.ok) {
          throw new Error(res.error ?? 'Failed to send input')
        }
      } else {
        const res = await runProcessCommand(selectedProcess, input)
        if (!res.ok) {
          throw new Error(res.error ?? 'Failed to run command')
        }
        addToast(`Started command on ${selectedProcess}: ${res.command ?? input}`, 'info')
      }

      setStdinValue('')
    } catch (err) {
      addToast(`Console action failed: ${String(err)}`, 'error')
    }
  }, [addToast, runProcessCommand, running, selectedProcess, sendProcessInput, stdinValue])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      sendInput()
    }
  }

  const handleStopProcess = useCallback(
    async (processName: string) => {
      try {
        await stopProcess(processName)
      } catch (err) {
        addToast(`Failed to stop ${processName}: ${String(err)}`, 'error')
      }
    },
    [stopProcess, addToast],
  )

  const handleOpenTab = useCallback(
    (processName: string) => {
      const tab = PROCESS_TO_TAB[processName]
      if (tab) setActiveTab(tab)
    },
    [setActiveTab],
  )

  return (
    <section
      id="console-drawer"
      className={`console-drawer ${collapsed ? 'collapsed' : ''}`}
      aria-label="Global Console Drawer"
    >
      {!collapsed && (
        <div
          className="console-resize-handle"
          onMouseDown={handleResizeStart}
          onDoubleClick={handleResizeDoubleClick}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize console"
        />
      )}
      {visibleRunning.length > 0 && (
        <div className={visibleRunning.length > 1 ? 'running-multi-bar' : ''}>
          {visibleRunning.map((info) => (
            <RunningBar
              key={info.process}
              info={info}
              onStop={() => handleStopProcess(info.process)}
              onOpen={() => handleOpenTab(info.process)}
            />
          ))}
        </div>
      )}
      <div className="console-drawer-header">
        <div
          className="console-controls"
          onClick={() => setCollapsed(!collapsed)}
          style={{ cursor: 'pointer' }}
        >
          <span className="console-title">Console</span>
          <span className="console-chevron">▼</span>
          <select
            className="console-process-select"
            value={selectedProcess}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setSelectedProcess(e.target.value)}
          >
            {PROCESSES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <span className={`dbadge ${stateBadgeClass}`}>{processState}</span>
        </div>
        <div className="console-actions">
          <button
            className="btn-xs"
            onClick={(e) => {
              e.stopPropagation()
              clearLog(selectedProcess)
            }}
          >
            Clear
          </button>
        </div>
      </div>
      {!collapsed && (
        <div className="console-drawer-body">
          <div id="console-log" className="terminal" ref={logRef} style={{ height: consoleHeight }}>
            {lines.map((line) => (
              <div
                key={line.id}
                className={
                  line.kind === 'stderr' || line.kind === 'error'
                    ? 'line-error'
                    : line.kind === 'translation'
                      ? 'line-translation'
                    : line.kind === 'info'
                      ? 'line-info'
                      : 'line-stdout'
                }
              >
                {line.text}
              </div>
            ))}
            {lines.length === 0 && (
              <div className="line-stdout" style={{ opacity: 0.5 }}>
                No output yet. Start a process to see logs here.
              </div>
            )}
          </div>
          <div className="stdin-row">
            <input
              type="text"
              placeholder={running ? 'Send stdin (empty Enter sends newline/default)' : 'Run command in selected process environment'}
              value={stdinValue}
              onChange={(e) => setStdinValue(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button className="btn-sm" onClick={sendInput}>
              Send ↵
            </button>
            {running ? (
              <button className="btn-sm" onClick={() => void handleStopProcess(selectedProcess)}>
                Ctrl+C (Stop)
              </button>
            ) : null}
          </div>
        </div>
      )}
    </section>
  )
}
