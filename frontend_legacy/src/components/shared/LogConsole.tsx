import { useEffect, useRef } from 'react'
import type { LogLine } from '../../lib/types'
import { useLeStudioStore } from '../../store'

interface LogConsoleProps {
  processName: string
}

const EMPTY_LINES: LogLine[] = []

export function LogConsole({ processName }: LogConsoleProps) {
  const lines = useLeStudioStore((s) => s.logLines[processName] ?? EMPTY_LINES)
  const elRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = elRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [lines])

  return (
    <div className="terminal" ref={elRef}>
      {lines.map((line) => (
        <div key={line.id} className={`line-${line.kind}`}>
          {line.text}
        </div>
      ))}
    </div>
  )
}
