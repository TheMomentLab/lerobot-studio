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
    <div className="btn-row">
      {!running ? (
        <>
          <button className="btn-primary" onClick={onStart} disabled={isBlocked}>
            {startLabel}
          </button>
          {conflictReason && (
            <span className="conflict-hint">{conflictReason} is running</span>
          )}
        </>
      ) : (
        <button className="btn-danger" onClick={onStop}>
          ■ Stop
        </button>
      )}
    </div>
  )
}
