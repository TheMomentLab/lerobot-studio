import type { EpisodeReward, EvalProgressStatus } from '../../hooks/useEvalProgress'
import { formatClock, formatElapsed, formatReward, formatSuccess } from '../../hooks/useEvalProgress'

interface EvalProgressPanelProps {
  progressStatus: EvalProgressStatus
  progressStatusStyle: { label: string; bg: string; color: string }
  progressPct: number
  showProgressDetails: boolean
  doneEpisodes: number
  progressTotal: number | null
  meanReward: number | null
  successRate: number | null
  startedAtMs: number | null
  endedAtMs: number | null
  elapsedTick: number
  lastMetricUpdateMs: number | null
  finalReward: number | null
  finalSuccess: number | null
  bestEpisode: EpisodeReward | null
  worstEpisode: EpisodeReward | null
  running: boolean
  evalReady: boolean
  onQuickRerun: () => void
  onGoTrain: () => void
  onGoRecord: () => void
}

export function EvalProgressPanel({
  progressStatus,
  progressStatusStyle,
  progressPct,
  showProgressDetails,
  doneEpisodes,
  progressTotal,
  meanReward,
  successRate,
  startedAtMs,
  endedAtMs,
  elapsedTick,
  lastMetricUpdateMs,
  finalReward,
  finalSuccess,
  bestEpisode,
  worstEpisode,
  running,
  evalReady,
  onQuickRerun,
  onGoTrain,
  onGoRecord,
}: EvalProgressPanelProps) {
  void elapsedTick

  return (
    <>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--text2)' }}>Evaluation Progress</span>
          <span
            id="eval-progress-status"
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: 999,
              background: progressStatusStyle.bg,
              color: progressStatusStyle.color,
            }}
          >
            {progressStatusStyle.label}
          </span>
        </div>
        <div className="usb-bus-bar-track">
          <div
            id="eval-progress-fill"
            className="usb-bar-fill good"
            style={{ width: `${progressPct}%` }}
            role="progressbar"
            aria-label="Evaluation progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progressPct)}
            aria-valuetext={`${Math.round(progressPct)} percent`}
          />
        </div>
        {showProgressDetails ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 12, color: 'var(--text2)', gap: 10, flexWrap: 'wrap' }}>
            <span id="eval-progress-episodes">Episodes: {doneEpisodes || '--'} / {progressTotal || '--'}</span>
            <span id="eval-progress-reward">Reward: {formatReward(meanReward)}</span>
            <span id="eval-progress-success">Success: {formatSuccess(successRate)}</span>
          </div>
        ) : (
          <div className="field-help" style={{ marginTop: 8 }}>Start evaluation to populate episode/reward/success metrics.</div>
        )}
      </div>

      {progressStatus !== 'idle' ? (
        <div className="card">
          <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 8 }}>Evaluation Summary</div>
          <div style={{ marginBottom: 8, fontSize: 11, color: 'var(--text2)' }}>
            <span id="eval-summary-confidence" className="dbadge" style={{ display: 'none' }} />
            <div id="eval-summary-time" className="eval-summary-time">
              <span>Start {formatClock(startedAtMs)}</span>
              <span>Elapsed {formatElapsed(startedAtMs, endedAtMs)}</span>
              <span>End {formatClock(endedAtMs)}</span>
              <span>Update {formatClock(lastMetricUpdateMs)}</span>
            </div>
          </div>
          <div className="eval-summary-grid" style={{ fontSize: 12, color: 'var(--text2)' }}>
            <div id="eval-summary-final-reward">Final Reward: {formatReward(finalReward)}</div>
            <div id="eval-summary-final-success">Final Success: {formatSuccess(finalSuccess)}</div>
            <div id="eval-summary-best">Best Episode: {bestEpisode ? `#${bestEpisode.ep} (${bestEpisode.reward.toFixed(4)})` : '--'}</div>
            <div id="eval-summary-worst">Worst Episode: {worstEpisode ? `#${worstEpisode.ep} (${worstEpisode.reward.toFixed(4)})` : '--'}</div>
          </div>
          <div style={{ marginTop: 10, display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button className="btn-xs" onClick={onQuickRerun} disabled={running || !evalReady}>Re-run 3 Episodes</button>
            <button className="btn-xs" onClick={onGoTrain}>Go to Train</button>
            {progressStatus === 'completed' || progressStatus === 'stopped' ? (
              <button className="btn-xs" onClick={onGoRecord}>↻ Record New Data</button>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  )
}
