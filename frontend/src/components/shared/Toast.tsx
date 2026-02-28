import { useEffect, useRef } from 'react'
import { notifications } from '@mantine/notifications'
import { useLeStudioStore } from '../../store'

const TOAST_DURATION_MS = 5000

const TOAST_COLORS: Record<string, string> = {
  success: 'green',
  error: 'red',
  warn: 'yellow',
  info: 'blue',
}

export function ToastLayer() {
  const toasts = useLeStudioStore((s) => s.toasts)
  const removeToast = useLeStudioStore((s) => s.removeToast)
  const shownIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const visibleIds = new Set<string>(toasts.map((toast) => toast.id))

    toasts.forEach((toast) => {
      if (shownIdsRef.current.has(toast.id)) return
      shownIdsRef.current.add(toast.id)
      notifications.show({
        id: toast.id,
        message: toast.message,
        color: TOAST_COLORS[toast.kind] ?? 'gray',
        autoClose: TOAST_DURATION_MS,
        withCloseButton: true,
        onClose: () => {
          shownIdsRef.current.delete(toast.id)
          removeToast(toast.id)
        },
      })
    })

    Array.from(shownIdsRef.current).forEach((id) => {
      if (!visibleIds.has(id)) {
        notifications.hide(id)
        shownIdsRef.current.delete(id)
      }
    })
  }, [removeToast, toasts])

  return null
}
