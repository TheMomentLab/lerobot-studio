import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiGet, apiPost } from '../../lib/api'
import { useLeStudioStore } from '../../store'

interface EpisodeStat {
  episode_index: number
  frames: number
  duration_s: number
  movement: number
  jerk_score: number
  max_jerk: number
  jerk_ratio?: number
}

interface MetricSummary {
  min: number
  max: number
  p25: number
  p75: number
  median: number
}

interface DatasetSummary {
  frames: MetricSummary
  movement: MetricSummary
  jerk_score: MetricSummary
  jerk_ratio?: MetricSummary
}

interface StatsResponse {
  ok: boolean
  cached?: boolean
  episodes?: EpisodeStat[]
  dataset_summary?: DatasetSummary
  error?: string
}

interface StatsRecomputeResponse {
  ok: boolean
  status?: string
  cached?: boolean
  job_id?: string
  error?: string
}

interface StatsStatusResponse {
  ok: boolean
  status?: string
  phase?: string
  progress?: number
  error?: string
}

interface BulkTagsResponse {
  ok: boolean
  applied?: number
  error?: string
}

interface Props {
  datasetId: string
  totalEpisodes: number
  onTagsChanged?: () => void
}

type Preset = 'strict' | 'balanced' | 'lenient'

function fmtNum(n: number, decimals = 3): string {
  return Number.isFinite(n) ? n.toFixed(decimals) : '0.000'
}

function sliderMax(stat: MetricSummary | undefined, fallback: number): number {
  if (!stat) return fallback
  return stat.max > 0 ? Math.ceil(stat.max * 100) / 100 : fallback
}

export function DatasetAutoFlagPanel({ datasetId, totalEpisodes, onTagsChanged }: Props) {
  const addToast = useLeStudioStore((s) => s.addToast)

  const [stats, setStats] = useState<EpisodeStat[] | null>(null)
  const [summary, setSummary] = useState<DatasetSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [tagging, setTagging] = useState(false)

  const [statsJobId, setStatsJobId] = useState('')
  const [statsJobStatus, setStatsJobStatus] = useState('idle')
  const [statsJobPhase, setStatsJobPhase] = useState('')
  const [statsJobProgress, setStatsJobProgress] = useState(0)

  const [minFrames, setMinFrames] = useState<number>(0)
  const [minMovement, setMinMovement] = useState<number>(0)
  const [maxJerk, setMaxJerk] = useState<number>(Infinity)
  const [maxJerkRatio, setMaxJerkRatio] = useState<number>(Infinity)

  const [useMinFrames, setUseMinFrames] = useState(false)
  const [useMinMovement, setUseMinMovement] = useState(false)
  const [useMaxJerk, setUseMaxJerk] = useState(false)
  const [useMaxJerkRatio, setUseMaxJerkRatio] = useState(false)

  const [user, repo] = datasetId.split('/')

  const fetchStatsResult = useCallback(async () => {
    const res = await apiGet<StatsResponse>(
      `/api/datasets/${encodeURIComponent(user)}/${encodeURIComponent(repo)}/stats`,
    )
    if (!res.ok || !res.episodes) {
      addToast(`Stats error: ${res.error ?? 'unknown'}`, 'error')
      return
    }
    setStats(res.episodes)
    if (res.dataset_summary) {
      setSummary(res.dataset_summary)
      const s = res.dataset_summary
      setMinFrames(Math.max(1, Math.floor(s.frames.p25 * 0.5)))
      setMinMovement(0)
      setMaxJerk(s.jerk_score.max > 0 ? Math.ceil(s.jerk_score.p75 * 10) / 10 : Infinity)
      if (s.jerk_ratio && s.jerk_ratio.max > 0) {
        setMaxJerkRatio(Math.ceil(s.jerk_ratio.p75 * 10) / 10)
      } else {
        setMaxJerkRatio(Infinity)
      }
    }
    addToast(res.cached ? 'Stats loaded (cached)' : 'Stats computed', 'success')
  }, [user, repo, addToast])

  const requestStatsJob = useCallback(async (force: boolean) => {
    setLoading(true)
    try {
      const res = await apiPost<StatsRecomputeResponse>(
        `/api/datasets/${encodeURIComponent(user)}/${encodeURIComponent(repo)}/stats/recompute`,
        { force },
      )
      if (!res.ok) {
        addToast(`Stats error: ${res.error ?? 'unknown'}`, 'error')
        return
      }
      if (!res.job_id) {
        setStatsJobId('')
        setStatsJobStatus('success')
        setStatsJobPhase('completed')
        setStatsJobProgress(100)
        await fetchStatsResult()
        return
      }

      setStatsJobId(res.job_id)
      setStatsJobStatus('queued')
      setStatsJobPhase('queued')
      setStatsJobProgress(0)
    } finally {
      setLoading(false)
    }
  }, [user, repo, addToast, fetchStatsResult])

  useEffect(() => {
    if (!statsJobId) return
    const timer = window.setInterval(async () => {
      try {
        const s = await apiGet<StatsStatusResponse>(
          `/api/datasets/stats/status/${encodeURIComponent(statsJobId)}`,
        )
        if (!s.ok) {
          setStatsJobStatus('error')
          setStatsJobPhase('error')
          setStatsJobProgress(0)
          setStatsJobId('')
          addToast(`Stats job failed: ${s.error ?? 'unknown'}`, 'error')
          return
        }

        const status = s.status ?? 'running'
        setStatsJobStatus(status)
        setStatsJobPhase(s.phase ?? status)
        setStatsJobProgress(Math.max(0, Math.min(100, Number(s.progress ?? 0))))

        if (status === 'success') {
          setStatsJobId('')
          await fetchStatsResult()
        } else if (status === 'error') {
          setStatsJobId('')
          addToast(`Stats job failed: ${s.error ?? 'unknown'}`, 'error')
        } else if (status === 'cancelled') {
          setStatsJobId('')
          addToast('Stats job cancelled', 'info')
        }
      } catch (err) {
        setStatsJobStatus('error')
        setStatsJobPhase('error')
        setStatsJobProgress(0)
        setStatsJobId('')
        addToast(`Stats poll error: ${String(err)}`, 'error')
      }
    }, 1200)
    return () => window.clearInterval(timer)
  }, [statsJobId, addToast, fetchStatsResult])

  const cancelStatsJob = useCallback(async () => {
    if (!statsJobId) return
    try {
      await apiPost<{ ok: boolean; error?: string }>(
        `/api/datasets/stats/cancel/${encodeURIComponent(statsJobId)}`,
      )
    } catch (err) {
      addToast(`Cancel request failed: ${String(err)}`, 'error')
    }
  }, [statsJobId, addToast])

  const applyPreset = useCallback((preset: Preset) => {
    if (!summary) return
    if (preset === 'strict') {
      setUseMinFrames(true)
      setMinFrames(Math.max(1, Math.ceil(summary.frames.median)))
      setUseMinMovement(summary.movement.max > 0)
      setMinMovement(summary.movement.max > 0 ? summary.movement.median : 0)
      setUseMaxJerk(summary.jerk_score.max > 0)
      setMaxJerk(summary.jerk_score.max > 0 ? summary.jerk_score.median : Infinity)
      setUseMaxJerkRatio(Boolean(summary.jerk_ratio && summary.jerk_ratio.max > 0))
      if (summary.jerk_ratio && summary.jerk_ratio.max > 0) {
        setMaxJerkRatio(summary.jerk_ratio.median)
      }
      return
    }

    if (preset === 'balanced') {
      setUseMinFrames(true)
      setMinFrames(Math.max(1, Math.floor(summary.frames.p25)))
      setUseMinMovement(summary.movement.max > 0)
      setMinMovement(summary.movement.max > 0 ? summary.movement.p25 : 0)
      setUseMaxJerk(summary.jerk_score.max > 0)
      setMaxJerk(summary.jerk_score.max > 0 ? summary.jerk_score.p75 : Infinity)
      setUseMaxJerkRatio(Boolean(summary.jerk_ratio && summary.jerk_ratio.max > 0))
      if (summary.jerk_ratio && summary.jerk_ratio.max > 0) {
        setMaxJerkRatio(summary.jerk_ratio.p75)
      }
      return
    }

    setUseMinFrames(true)
    setMinFrames(Math.max(1, Math.floor(summary.frames.p25 * 0.5)))
    setUseMinMovement(false)
    setMinMovement(0)
    setUseMaxJerk(summary.jerk_score.max > 0)
    setMaxJerk(summary.jerk_score.max > 0 ? summary.jerk_score.max : Infinity)
    setUseMaxJerkRatio(false)
    setMaxJerkRatio(Infinity)
  }, [summary])

  const flaggedEpisodes = useMemo<EpisodeStat[]>(() => {
    if (!stats) return []
    return stats.filter((ep) => {
      if (useMinFrames && ep.frames < minFrames) return true
      if (useMinMovement && ep.movement < minMovement) return true
      if (useMaxJerk && isFinite(maxJerk) && ep.jerk_score > maxJerk) return true
      if (useMaxJerkRatio && isFinite(maxJerkRatio) && (ep.jerk_ratio ?? 0) > maxJerkRatio) return true
      return false
    })
  }, [stats, useMinFrames, minFrames, useMinMovement, minMovement, useMaxJerk, maxJerk, useMaxJerkRatio, maxJerkRatio])

  const tagFlagged = async () => {
    if (flaggedEpisodes.length === 0) return
    setTagging(true)
    try {
      const updates = flaggedEpisodes.map((ep) => ({ episode_index: ep.episode_index, tag: 'bad' as const }))
      const res = await apiPost<BulkTagsResponse>(
        `/api/datasets/${encodeURIComponent(user)}/${encodeURIComponent(repo)}/tags/bulk`,
        { updates },
      )
      if (!res.ok) {
        addToast(`Bulk tag failed: ${res.error ?? 'unknown'}`, 'error')
        return
      }
      addToast(`Tagged ${res.applied ?? flaggedEpisodes.length} episodes as bad`, 'success')
      onTagsChanged?.()
    } finally {
      setTagging(false)
    }
  }

  const activeCount =
    (useMinFrames ? 1 : 0)
    + (useMinMovement ? 1 : 0)
    + (useMaxJerk ? 1 : 0)
    + (useMaxJerkRatio ? 1 : 0)

  const isStatsRunning = !!statsJobId && statsJobStatus !== 'success' && statsJobStatus !== 'error' && statsJobStatus !== 'cancelled'
  const autoFlagSummaryText = stats ? `${flaggedEpisodes.length} / ${totalEpisodes} flagged` : 'not loaded'
  const autoFlagSummaryBadgeClass =
    !stats
      ? 'badge-idle'
      : flaggedEpisodes.length > 0
        ? 'badge-warn'
        : 'badge-ok'

  return (
    <details id="ds-autoflag-panel" className="advanced-panel advanced-panel-clickable dataset-collapsible-panel">
      <summary className="dataset-collapsible-summary">
        <span className="dataset-collapsible-title">Auto-Flag — Episode Quality</span>
        <span className={`dbadge dataset-collapsible-meta ${autoFlagSummaryBadgeClass}`}>
          {autoFlagSummaryText}
        </span>
      </summary>

      {!stats && (
        <div style={{ marginTop: 8 }}>
          <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>
            Compute episode stats in background, then auto-flag outliers by threshold presets.
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn-sm" onClick={() => void requestStatsJob(false)} disabled={loading || isStatsRunning} style={{ flex: 1 }}>
              {loading || isStatsRunning ? 'Computing…' : '⚡ Load Episode Stats'}
            </button>
            {isStatsRunning && (
              <button className="btn-xs" onClick={() => void cancelStatsJob()}>
                Cancel
              </button>
            )}
          </div>
          {(isStatsRunning || statsJobStatus === 'queued') && (
            <div style={{ marginTop: 8 }}>
              <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>
                {statsJobPhase || statsJobStatus} · {statsJobProgress}%
              </div>
              <div style={{ height: 6, borderRadius: 4, background: 'var(--border)', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${statsJobProgress}%`,
                    background: 'var(--green)',
                    transition: 'width 0.2s',
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {stats && (
        <>
          {summary && (
            <div className="muted" style={{ fontSize: 11, marginBottom: 8, marginTop: 6 }}>
              {stats.length} episodes · frames {summary.frames.min}–{summary.frames.max}
              {summary.movement.max > 0 && ` · movement 0–${fmtNum(summary.movement.max, 2)}`}
              {summary.jerk_score.max > 0 && ` · jerk 0–${fmtNum(summary.jerk_score.max, 2)}`}
              {summary.jerk_ratio && summary.jerk_ratio.max > 0 && ` · jerk ratio 0–${fmtNum(summary.jerk_ratio.max, 2)}`}
            </div>
          )}

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            <button className="btn-xs" onClick={() => applyPreset('strict')}>Preset: Strict</button>
            <button className="btn-xs" onClick={() => applyPreset('balanced')}>Preset: Balanced</button>
            <button className="btn-xs" onClick={() => applyPreset('lenient')}>Preset: Lenient</button>
            <button className="btn-xs" onClick={() => void requestStatsJob(true)} disabled={loading || isStatsRunning}>↻ Recompute</button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 10 }}>
            <div className="device-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', flex: 1 }}>
                  <input type="checkbox" checked={useMinFrames} onChange={(e) => setUseMinFrames(e.target.checked)} style={{ width: 'auto' }} />
                  <span style={{ fontSize: 12 }}>Min frames</span>
                </label>
                <span style={{ fontSize: 12, fontFamily: 'var(--mono)', minWidth: 36, textAlign: 'right' }}>{minFrames}</span>
              </div>
              {useMinFrames && (
                <input
                  type="range"
                  min={1}
                  max={summary ? summary.frames.max : 300}
                  step={1}
                  value={minFrames}
                  onChange={(e) => setMinFrames(Number(e.target.value))}
                  style={{ width: '100%' }}
                />
              )}
            </div>

            {summary && summary.movement.max > 0 && (
              <div className="device-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <label style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', flex: 1 }}>
                    <input type="checkbox" checked={useMinMovement} onChange={(e) => setUseMinMovement(e.target.checked)} style={{ width: 'auto' }} />
                    <span style={{ fontSize: 12 }}>Min movement</span>
                  </label>
                  <span style={{ fontSize: 12, fontFamily: 'var(--mono)', minWidth: 42, textAlign: 'right' }}>{fmtNum(minMovement, 3)}</span>
                </div>
                {useMinMovement && (
                  <input
                    type="range"
                    min={0}
                    max={sliderMax(summary.movement, 2)}
                    step={0.001}
                    value={minMovement}
                    onChange={(e) => setMinMovement(Number(e.target.value))}
                    style={{ width: '100%' }}
                  />
                )}
              </div>
            )}

            {summary && summary.jerk_score.max > 0 && (
              <div className="device-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <label style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', flex: 1 }}>
                    <input type="checkbox" checked={useMaxJerk} onChange={(e) => setUseMaxJerk(e.target.checked)} style={{ width: 'auto' }} />
                    <span style={{ fontSize: 12 }}>Max jerk</span>
                  </label>
                  <span style={{ fontSize: 12, fontFamily: 'var(--mono)', minWidth: 42, textAlign: 'right' }}>{isFinite(maxJerk) ? fmtNum(maxJerk, 3) : '∞'}</span>
                </div>
                {useMaxJerk && (
                  <input
                    type="range"
                    min={0}
                    max={sliderMax(summary.jerk_score, 1)}
                    step={0.001}
                    value={isFinite(maxJerk) ? maxJerk : sliderMax(summary.jerk_score, 1)}
                    onChange={(e) => setMaxJerk(Number(e.target.value))}
                    style={{ width: '100%' }}
                  />
                )}
              </div>
            )}

            {summary?.jerk_ratio && summary.jerk_ratio.max > 0 && (
              <div className="device-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <label style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', flex: 1 }}>
                    <input type="checkbox" checked={useMaxJerkRatio} onChange={(e) => setUseMaxJerkRatio(e.target.checked)} style={{ width: 'auto' }} />
                    <span style={{ fontSize: 12 }}>Max jerk ratio</span>
                  </label>
                  <span style={{ fontSize: 12, fontFamily: 'var(--mono)', minWidth: 42, textAlign: 'right' }}>{isFinite(maxJerkRatio) ? fmtNum(maxJerkRatio, 3) : '∞'}</span>
                </div>
                {useMaxJerkRatio && (
                  <input
                    type="range"
                    min={0}
                    max={sliderMax(summary.jerk_ratio, 3)}
                    step={0.001}
                    value={isFinite(maxJerkRatio) ? maxJerkRatio : sliderMax(summary.jerk_ratio, 3)}
                    onChange={(e) => setMaxJerkRatio(Number(e.target.value))}
                    style={{ width: '100%' }}
                  />
                )}
              </div>
            )}
          </div>

          {activeCount === 0 && (
            <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>
              Enable at least one criterion above to start flagging.
            </div>
          )}

          {activeCount > 0 && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>
                  Flagged episodes <span className={`dbadge ${flaggedEpisodes.length > 0 ? 'badge-warn' : 'badge-idle'}`}>{flaggedEpisodes.length}</span>
                </span>
              </div>

              {flaggedEpisodes.length === 0 ? (
                <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>
                  No episodes match current thresholds.
                </div>
              ) : (
                <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6, marginBottom: 8 }}>
                  {flaggedEpisodes.map((ep) => {
                    const reasons: string[] = []
                    if (useMinFrames && ep.frames < minFrames) reasons.push(`${ep.frames} frames`)
                    if (useMinMovement && ep.movement < minMovement) reasons.push(`mv ${fmtNum(ep.movement, 3)}`)
                    if (useMaxJerk && isFinite(maxJerk) && ep.jerk_score > maxJerk) reasons.push(`jerk ${fmtNum(ep.jerk_score, 3)}`)
                    if (useMaxJerkRatio && isFinite(maxJerkRatio) && (ep.jerk_ratio ?? 0) > maxJerkRatio) reasons.push(`ratio ${fmtNum(ep.jerk_ratio ?? 0, 3)}`)
                    return (
                      <div
                        key={ep.episode_index}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '5px 10px',
                          borderBottom: '1px solid var(--border)',
                          fontSize: 12,
                        }}
                      >
                        <span style={{ fontFamily: 'var(--mono)' }}>ep {ep.episode_index}</span>
                        <span className="muted" style={{ fontSize: 11 }}>{reasons.join(' · ')}</span>
                      </div>
                    )
                  })}
                </div>
              )}

              {flaggedEpisodes.length > 0 && (
                <>
                  <div className="field-help" style={{ marginBottom: 6 }}>
                    Tags flagged episodes as <strong>bad</strong> in one bulk request.
                  </div>
                  <button className="btn-primary" onClick={tagFlagged} disabled={tagging} style={{ width: '100%' }}>
                    {tagging ? 'Tagging…' : `🏷 Tag ${flaggedEpisodes.length} episode${flaggedEpisodes.length !== 1 ? 's' : ''} as bad`}
                  </button>
                </>
              )}
            </>
          )}
        </>
      )}
    </details>
  )
}
