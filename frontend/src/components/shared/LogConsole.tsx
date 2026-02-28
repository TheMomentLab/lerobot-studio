import { useEffect, useRef } from 'react'
import { Paper, ScrollArea, Text } from '@mantine/core'
import type { LogLine } from '../../lib/types'
import { useLeStudioStore } from '../../store'

interface LogConsoleProps {
  processName: string
}

const EMPTY_LINES: LogLine[] = []

export function LogConsole({ processName }: LogConsoleProps) {
  const lines = useLeStudioStore((s) => s.logLines[processName] ?? EMPTY_LINES)
  const viewportRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [lines])

  return (
    <Paper withBorder p="xs" radius="md">
      <ScrollArea viewportRef={viewportRef} h={220} className="terminal">
        {lines.map((line) => (
          <Text key={line.id} ff="monospace" size="xs" className={`line-${line.kind}`}>
            {line.text}
          </Text>
        ))}
      </ScrollArea>
    </Paper>
  )
}
