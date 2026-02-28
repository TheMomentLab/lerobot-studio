import { Button, Group, Text } from '@mantine/core'

interface ProcessButtonsProps {
  running: boolean
  onStart: () => void
  onStop: () => void
  startLabel: string
  disabled?: boolean
  conflictReason?: string | null
}

export function ProcessButtons({ running, onStart, onStop, startLabel, disabled, conflictReason }: ProcessButtonsProps) {
  const isBlocked = disabled || !!conflictReason
  return (
    <Group className="btn-row" gap="xs" align="center">
      {!running ? (
        <>
          <Button color="blue" variant="light" size="sm" onClick={onStart} disabled={isBlocked}>
            {startLabel}
          </Button>
          {conflictReason && (
            <Text size="sm" c="dimmed" className="conflict-hint">
              {conflictReason} is running
            </Text>
          )}
        </>
      ) : (
        <Button color="red" variant="light" size="sm" onClick={onStop}>
          ■ Stop
        </Button>
      )}
    </Group>
  )
}
