import { useEffect, useRef, useState } from 'react'
import { useLeStudioStore } from '../../store'

const TOAST_DURATION_MS = 5000

export function ToastLayer() {
  const toasts = useLeStudioStore((s) => s.toasts)
  const removeToast = useLeStudioStore((s) => s.removeToast)
  const timersRef = useRef<Record<string, number>>({})
  const [paused, setPaused] = useState<Record<string, boolean>>({})

  useEffect(() => {
    const visibleIds = new Set(toasts.map((toast) => toast.id))

    Object.entries(timersRef.current).forEach(([id, timer]) => {
      if (!visibleIds.has(id) || paused[id]) {
        window.clearTimeout(timer)
        delete timersRef.current[id]
      }
    })

    toasts.forEach((toast) => {
      if (paused[toast.id]) return
      if (timersRef.current[toast.id]) return
      timersRef.current[toast.id] = window.setTimeout(() => {
        removeToast(toast.id)
        delete timersRef.current[toast.id]
      }, TOAST_DURATION_MS)
    })
  }, [paused, removeToast, toasts])

  const pauseToast = (id: string) => {
    setPaused((prev) => ({ ...prev, [id]: true }))
  }

  const resumeToast = (id: string) => {
    setPaused((prev) => {
      if (!prev[id]) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  return (
    <div id="toast-root" className="toast-root" aria-live="polite" aria-atomic="true">
      {toasts.map((toast) => (
        <div
          className={`toast show ${toast.kind}`}
          key={toast.id}
          onMouseEnter={() => pauseToast(toast.id)}
          onMouseLeave={() => resumeToast(toast.id)}
        >
          <div className="toast-message">{toast.message}</div>
          <button
            type="button"
            className="toast-close"
            aria-label="Dismiss notification"
            onFocus={() => pauseToast(toast.id)}
            onBlur={() => resumeToast(toast.id)}
            onClick={() => removeToast(toast.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
