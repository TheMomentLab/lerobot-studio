import { useEffect, useRef } from 'react'
import { swallow } from '../lib/errors'
import type { WsMessage } from '../lib/types'
import { useLeStudioStore } from '../store'

export const useWebSocket = () => {
  const appendLog = useLeStudioStore((s) => s.appendLog)
  const setProcStatus = useLeStudioStore((s) => s.setProcStatus)
  const setWsReady = useLeStudioStore((s) => s.setWsReady)
  const setApiHealth = useLeStudioStore((s) => s.setApiHealth)
  const setApiSupport = useLeStudioStore((s) => s.setApiSupport)
  const lastErrorAtRef = useRef<Record<string, number>>({})
  const prevRunningRef = useRef<Record<string, boolean>>({})
  const notifyCooldownRef = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    let ws: WebSocket | null = null
    let reconnectTimer: number | undefined
    let closed = false

    const normalizeProcessName = (processName: string) => {
      return processName === 'train_install' ? 'train' : processName
    }

    const isRunning = (processName: string, procs: Record<string, boolean>) => {
      if (processName === 'train') {
        return !!(procs.train || procs.train_install)
      }
      return !!procs[processName]
    }

    const notify = (title: string, body: string, tag = '') => {
      if (!(typeof window !== 'undefined' && 'Notification' in window)) return
      if (Notification.permission !== 'granted') return
      const key = `${title}|${body}|${tag}`
      const now = Date.now()
      const prev = notifyCooldownRef.current.get(key) ?? 0
      if (now - prev < 5000) return
      notifyCooldownRef.current.set(key, now)
      try {
        const notice = new Notification(title, { body, tag: tag || undefined, silent: false })
        notice.onclick = () => window.focus()
      } catch {
        return
      }
    }

    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(swallow)
    }

    const connect = () => {
      ws = new WebSocket(`ws://${location.host}/ws`)

      ws.onopen = () => {
        setWsReady(true)
      }

      ws.onclose = () => {
        setWsReady(false)
        if (!closed) {
          reconnectTimer = window.setTimeout(connect, 3000)
        }
      }

      ws.onmessage = (evt) => {
        const msg = JSON.parse(evt.data) as WsMessage
        if (msg.type === 'output') {
          if (!msg.process) return
          const text = msg.text ?? msg.line ?? ''
          const kind = msg.kind ?? 'stdout'
          appendLog(msg.process, text, kind)

          if (kind === 'error' || /\[ERROR\]|Traceback|RuntimeError|Exception|failed/i.test(text)) {
            const processName = normalizeProcessName(msg.process)
            lastErrorAtRef.current[processName] = Date.now()
            if (msg.process === 'train_install') {
              lastErrorAtRef.current.train_install = Date.now()
            }
          }

          if (msg.process === 'train_install') {
            appendLog('train', text, kind)
          }
        }
        if (msg.type === 'status') {
          if (msg.processes) {
            const next = msg.processes
            const tracked = ['teleop', 'record', 'calibrate', 'motor_setup', 'train', 'eval']
            const now = Date.now()

            tracked.forEach((processName) => {
              const wasRunning = prevRunningRef.current[processName] ?? false
              const runningNow = isRunning(processName, next)
              if (wasRunning && !runningNow) {
                const errAt = Math.max(
                  lastErrorAtRef.current[processName] ?? 0,
                  processName === 'train' ? (lastErrorAtRef.current.train_install ?? 0) : 0,
                )
                const abnormal = now - errAt < 120000
                if (abnormal) {
                  notify('LeStudio', `${processName} ended with error. Check logs.`, `proc-${processName}-error`)
                } else if (processName === 'train') {
                  notify('LeStudio', 'Training completed.', 'proc-train-complete')
                } else if (processName === 'record') {
                  notify('LeStudio', 'Recording session ended.', 'proc-record-end')
                }
              }
              prevRunningRef.current[processName] = runningNow
            })

            setProcStatus(next)
          }
        }
        if (msg.type === 'api_health') {
          if (msg.key && typeof msg.value === 'boolean') setApiHealth(msg.key, msg.value)
        }
        if (msg.type === 'api_support') {
          if (msg.key && typeof msg.value === 'boolean') setApiSupport(msg.key, msg.value)
        }
        if (msg.type === 'metric' && msg.process === 'train' && msg.metric) {
          const parts: string[] = []
          const step = Number(msg.metric.step)
          const total = Number(msg.metric.total)
          const loss = Number(msg.metric.loss)
          const lr = Number(msg.metric.lr)
          if (Number.isFinite(step)) parts.push(`step=${Math.floor(step)}`)
          if (Number.isFinite(total)) parts.push(`cfg.steps=${Math.floor(total)}`)
          if (Number.isFinite(loss)) parts.push(`loss=${loss}`)
          if (Number.isFinite(lr)) parts.push(`lr=${lr}`)
          if (parts.length > 0) appendLog('train', parts.join(' '), 'info')
        }
      }
    }

    connect()
    return () => {
      closed = true
      setWsReady(false)
      if (reconnectTimer) window.clearTimeout(reconnectTimer)
      ws?.close()
    }
  }, [appendLog, setApiHealth, setApiSupport, setProcStatus, setWsReady])
}
