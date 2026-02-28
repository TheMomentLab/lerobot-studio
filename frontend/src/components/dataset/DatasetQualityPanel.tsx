/**
 * DatasetQualityPanel
 *
 * Renders the Quality Inspector card: score badge, episode/frame stats line,
 * and per-check result list.
 *
 * Extracted from DatasetTab.tsx to reduce that file's size.
 * Shown only when `quality` is non-null.
 */
import { useMemo } from 'react'

// ─── Types ───────────────────────────────────────────────────────────────────

interface QualityCheck {
  level: string
  name: string
  message: string
}

export interface QualityResponse {
  ok: boolean
  score: number
  checks: QualityCheck[]
  stats?: {
    total_detected_episodes?: number
    total_expected_episodes?: number
    total_frames?: number
    fps?: number
    zero_byte_videos?: number
    camera_file_counts?: Record<string, number>
  }
  score_breakdown?: Record<string, number>
  error?: string
}

interface Props {
  quality: QualityResponse
}

// ─── Component ───────────────────────────────────────────────────────────────

export function DatasetQualityPanel({ quality }: Props) {
  const badgeClass =
    quality.score >= 80 ? 'badge-ok' : quality.score >= 60 ? 'badge-warn' : 'badge-err'

  const statsText = useMemo(() => {
    if (!quality.stats) return ''
    const stats = quality.stats
    const cameraCounts = stats.camera_file_counts ?? {}
    const cameraSummary =
      Object.keys(cameraCounts).length > 0
        ? Object.entries(cameraCounts)
            .map(([key, value]) => `${key}:${value}`)
            .join(' · ')
        : '--'
    return [
      `Episodes ${stats.total_detected_episodes ?? '--'} (expected ${stats.total_expected_episodes ?? '--'})`,
      `Frames ${stats.total_frames ?? '--'}`,
      `FPS ${stats.fps ?? '--'}`,
      `Zero-byte videos ${stats.zero_byte_videos ?? '--'}`,
      `Camera files ${cameraSummary}`,
    ].join(' · ')
  }, [quality])

  return (
    <div
      id="ds-quality-panel"
      style={{
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: 10,
        background: 'var(--bg3)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
        }}
      >
        <strong>Quality Inspector</strong>
        <span id="ds-quality-score" className={`dbadge ${badgeClass}`}>
          Score: {quality.score}
        </span>
      </div>
      <div id="ds-quality-stats" className="muted" style={{ fontSize: 11, marginBottom: 8 }}>
        {statsText}
      </div>
      <div id="ds-quality-checks" className="device-list">
        {quality.checks.map((check, idx) => {
          const level = check.level || 'ok'
          const cls =
            level === 'error' ? 'badge-err' : level === 'warn' ? 'badge-warn' : 'badge-ok'
          return (
            <div
              key={`${check.name}-${idx}`}
              className="device-item"
              style={{ alignItems: 'flex-start' }}
            >
              <span className={`dbadge ${cls}`} style={{ marginTop: 2 }}>
                {String(level).toUpperCase()}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="dname">{check.name || 'check'}</div>
                <div className="dsub" style={{ whiteSpace: 'normal', lineHeight: 1.45 }}>
                  {check.message || ''}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
