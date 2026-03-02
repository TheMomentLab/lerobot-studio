type ToastKind = 'success' | 'info' | 'warn' | 'error'

type ToastSink = (message: string, kind: ToastKind) => void

export function swallow(_err: unknown): void {
  return
}

export function logError(context: string): (err: unknown) => void {
  return (err: unknown) => {
    console.error(`[${context}]`, err)
  }
}

export function toastError(
  addToast: ToastSink,
  context: string,
  fallbackMessage: string,
): (err: unknown) => void {
  return (err: unknown) => {
    const message = err instanceof Error && err.message ? err.message : fallbackMessage
    addToast(`${context}: ${message}`, 'error')
    console.error(`[${context}]`, err)
  }
}
