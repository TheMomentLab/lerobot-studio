import { useEffect, useMemo, useRef, useState } from 'react'
import { apiGet, apiPost } from '../../lib/api'
import type { DatasetEpisode } from '../../lib/types'
import { useLeStudioStore } from '../../store'

type SelectionMode = 'filter' | 'good_only' | 'exclude_bad'

interface Props {
  filteredEpisodes: DatasetEpisode[]  // current tag-filter result from parent
  allEpisodes: DatasetEpisode[]       // all episodes regardless of filter
  tags: Record<string, string>        // episode_index → 'good'|'bad'|'review'
  totalEpisodes: number
  datasetId: string                   // "user/repo"
  onDerived?: (newRepoId: string) => void
}

interface DeriveJob {
  status: string
  phase: string
  progress: number
  logs: string[]
  error: string
  keep_count: number
  delete_count: number
}

type DeriveResponse = { ok: boolean; job_id?: string; error?: string }
type DeriveStatusResponse = { ok: boolean } & Partial<DeriveJob>
type DeriveCancelResponse = { ok: boolean; error?: string }

const REPO_ID_REGEX = /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/

const MODE_LABELS: Record<SelectionMode, string> = {
  filter: 'Current filter',
  good_only: 'Good only',
  exclude_bad: 'Exclude bad',
}

const MODE_DESCRIPTIONS: Record<SelectionMode, string> = {
  filter: 'Keep episodes shown by the tag filter above.',
  good_only: 'Keep only episodes tagged as good.',
  exclude_bad: 'Keep all episodes except those tagged as bad.',
}

export function DatasetCurationPanel({
  filteredEpisodes,
  allEpisodes,
  tags,
  totalEpisodes,
  datasetId,
  onDerived,
}: Props) {
  const addToast = useLeStudioStore((s) => s.addToast)
  const [mode, setMode] = useState<SelectionMode>('good_only')
  const [newRepoId, setNewRepoId] = useState('')
  const [jobId, setJobId] = useState('')
  const [job, setJob] = useState<DeriveJob | null>(null)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current)
    }
  }, [])

  // Compute keep episodes based on selected mode
  const keepEpisodes = useMemo(() => {
    if (mode === 'filter') return filteredEpisodes
    if (mode === 'good_only')
      return allEpisodes.filter((ep) => tags[String(ep.episode_index)] === 'good')
    if (mode === 'exclude_bad')
      return allEpisodes.filter((ep) => tags[String(ep.episode_index)] !== 'bad')
    return filteredEpisodes
  }, [mode, filteredEpisodes, allEpisodes, tags])

  const keepCount = keepEpisodes.length
  const deleteCount = totalEpisodes - keepCount

  const stopPolling = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
  }

  const startPolling = (id: string, kc: number) => {
    pollingRef.current = setInterval(async () => {
      try {
        const s = await apiGet<DeriveStatusResponse>(
          `/api/datasets/derive/status/${encodeURIComponent(id)}`,
        )
        if (!s.ok) return
        setJob({
          status: s.status ?? 'unknown',
          phase: s.phase ?? '',
          progress: s.progress ?? 0,
          logs: s.logs ?? [],
          error: s.error ?? '',
          keep_count: s.keep_count ?? kc,
          delete_count: s.delete_count ?? totalEpisodes - kc,
        })
        if (s.status === 'success') {
          stopPolling()
          addToast(`Dataset created: ${newRepoId}`, 'success')
          onDerived?.(newRepoId.trim())
        } else if (s.status === 'error') {
          stopPolling()
          addToast(`Derive failed: ${s.error ?? 'Unknown error'}`, 'error')
        } else if (s.status === 'cancelled') {
          stopPolling()
          addToast('Derive cancelled', 'info')
        }
      } catch {
        // ignore transient errors
      }
    }, 1500)
  }

  const handleDerive = async () => {
    const [user, repo] = datasetId.split('/')
    const keepIndices = keepEpisodes.map((ep) => ep.episode_index)

    const res = await apiPost<DeriveResponse>(
      `/api/datasets/${encodeURIComponent(user)}/${encodeURIComponent(repo)}/derive`,
      { new_repo_id: newRepoId.trim(), keep_indices: keepIndices },
    )

    if (!res.ok || !res.job_id) {
      addToast(`Derive failed: ${res.error ?? 'Unknown error'}`, 'error')
      return
    }

    setJobId(res.job_id)
    setJob({
      status: 'queued',
      phase: 'queued',
      progress: 0,
      logs: [],
      error: '',
      keep_count: keepIndices.length,
      delete_count: totalEpisodes - keepIndices.length,
    })
    addToast('Derive job started', 'info')
    startPolling(res.job_id, keepIndices.length)
  }

  const reset = () => {
    stopPolling()
    setJobId('')
    setJob(null)
    setNewRepoId('')
  }

  const repoIdValid = REPO_ID_REGEX.test(newRepoId.trim())
  const isRunning = !!jobId && job?.status !== 'success' && job?.status !== 'error' && job?.status !== 'cancelled'
  const canDerive = repoIdValid && keepCount > 0 && keepCount < totalEpisodes && !isRunning
  const curationSummaryBadgeClass =
    keepCount === 0
      ? 'badge-warn'
      : keepCount === totalEpisodes
        ? 'badge-idle'
        : 'badge-ok'

  const deleteIndices = useMemo(() => {
    const keepSet = new Set(keepEpisodes.map((ep) => ep.episode_index))
    return allEpisodes
      .map((ep) => ep.episode_index)
      .filter((idx) => !keepSet.has(idx))
      .sort((a, b) => a - b)
  }, [allEpisodes, keepEpisodes])

  const deriveCliPreview = useMemo(() => {
    const displayRepo = newRepoId.trim() || 'yourname/my-dataset-curated'
    const previewIndices = deleteIndices.slice(0, 60)
    const suffix = deleteIndices.length > previewIndices.length ? ', ...' : ''
    return [
      'python -m lerobot.scripts.lerobot_edit_dataset \\',
      `  --repo_id=${datasetId} \\`,
      `  --new_repo_id=${displayRepo} \\`,
      '  --operation.type=delete_episodes \\',
      `  --operation.episode_indices=[${previewIndices.join(', ')}${suffix}] \\`,
      '  --push_to_hub=false',
    ].join('\n')
  }, [datasetId, newRepoId, deleteIndices])

  const cancelDerive = async () => {
    if (!jobId || !isRunning) return
    const res = await apiPost<DeriveCancelResponse>(
      `/api/datasets/derive/cancel/${encodeURIComponent(jobId)}`,
    )
    if (!res.ok) {
      addToast(`Cancel failed: ${res.error ?? 'Unknown error'}`, 'error')
      return
    }
    addToast('Derive cancel requested', 'info')
  }

  return (
    <details
      id="ds-curation-panel"
      className="advanced-panel advanced-panel-clickable dataset-collapsible-panel"
    >
      <summary className="dataset-collapsible-summary">
        <span className="dataset-collapsible-title">Curation — Derive Dataset</span>
        <span className={`dbadge dataset-collapsible-meta ${curationSummaryBadgeClass}`}>
          {keepCount} / {totalEpisodes} keep
        </span>
      </summary>

      {/* Selection mode */}
      <label style={{ fontSize: 12 }}>Episode Selection</label>
      <div style={{ display: 'flex', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
        {(Object.keys(MODE_LABELS) as SelectionMode[]).map((m) => (
          <button
            key={m}
            className={`toggle ${mode === m ? 'active' : ''}`}
            style={{ fontSize: 12 }}
            disabled={isRunning}
            onClick={() => setMode(m)}
          >
            {MODE_LABELS[m]}
          </button>
        ))}
      </div>
      <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>
        {MODE_DESCRIPTIONS[mode]}
      </div>

      {/* Keep / Remove summary */}
      <div className="device-list" style={{ marginBottom: 8 }}>
        <div className="device-item" style={{ justifyContent: 'space-between' }}>
          <span className="dname">Keep</span>
          <span className={`dbadge ${keepCount > 0 ? 'badge-ok' : 'badge-idle'}`}>
            {keepCount} episodes
          </span>
        </div>
        <div className="device-item" style={{ justifyContent: 'space-between' }}>
          <span className="dname">Remove</span>
          <span className={`dbadge ${deleteCount > 0 ? 'badge-warn' : 'badge-idle'}`}>
            {deleteCount} episodes
          </span>
        </div>
      </div>

      {keepCount === 0 && (
        <div style={{ fontSize: 11, color: 'var(--red)', marginBottom: 8 }}>
          No episodes match this selection — nothing to derive.
        </div>
      )}
      {keepCount === totalEpisodes && (
        <div style={{ fontSize: 11, color: 'var(--yellow, #f5a623)', marginBottom: 8 }}>
          ⚠ All episodes selected — the derived dataset would be identical to the original.
        </div>
      )}

      {/* New repo ID */}
      <label style={{ fontSize: 12 }}>New Dataset Repo ID</label>
      <input
        type="text"
        value={newRepoId}
        onChange={(e) => setNewRepoId(e.target.value)}
        placeholder="yourname/my-dataset-curated"
        disabled={isRunning}
        style={newRepoId && !repoIdValid ? { borderColor: 'var(--red)' } : undefined}
      />
      <div className="field-help" style={{ marginBottom: 8 }}>
        "user/dataset" format. Saved locally — push to Hub separately from Dataset tab.
      </div>

      <details style={{ marginBottom: 8 }}>
        <summary style={{ cursor: 'pointer', fontSize: 12 }}>CLI Preview (transparent execution)</summary>
        <pre
          style={{
            marginTop: 6,
            marginBottom: 0,
            fontSize: 11,
            fontFamily: 'var(--mono)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            background: 'var(--bg)',
            borderRadius: 6,
            border: '1px solid var(--border)',
            padding: 8,
          }}
        >
          {deriveCliPreview}
        </pre>
        {deleteIndices.length > 60 && (
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            Showing first 60 delete indices of {deleteIndices.length}.
          </div>
        )}
      </details>

      <button
        className="btn-primary"
        onClick={handleDerive}
        disabled={!canDerive}
        style={{ width: '100%' }}
      >
        ✦ Create Derived Dataset
      </button>

      {/* Job progress */}
      {job && (
        <div style={{ marginTop: 10 }}>
          <div
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}
          >
            <span style={{ fontSize: 12 }}>{job.phase || job.status}</span>
            <span
              className={`dbadge ${
                job.status === 'success'
                  ? 'badge-ok'
                  : job.status === 'error'
                    ? 'badge-err'
                    : job.status === 'cancelled'
                      ? 'badge-idle'
                    : 'badge-run'
              }`}
            >
              {job.status === 'running' || job.status === 'queued'
                ? `${job.progress}%`
                : job.status}
            </span>
          </div>

          <div style={{ height: 6, borderRadius: 4, background: 'var(--border)', overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${job.progress}%`,
                background: job.status === 'error' ? 'var(--red)' : 'var(--green)',
                transition: 'width 0.3s',
              }}
            />
          </div>

          {job.error ? (
            <div style={{ marginTop: 6, color: 'var(--red)', fontSize: 11, wordBreak: 'break-word' }}>
              {job.error}
            </div>
          ) : null}

          {job.logs.length > 0 ? (
            <div
              style={{
                marginTop: 6,
                fontSize: 11,
                fontFamily: 'monospace',
                background: 'var(--bg)',
                borderRadius: 4,
                padding: '4px 6px',
                maxHeight: 80,
                overflowY: 'auto',
                color: 'var(--text-muted)',
              }}
            >
              {job.logs.slice(-6).map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          ) : null}

          {job.status === 'success' && (
            <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="dbadge badge-ok">Done</span>
              <span style={{ fontSize: 11 }}>
                <code>{newRepoId}</code> — {job.keep_count} episodes
              </span>
              <button className="btn-xs" onClick={reset}>
                New Derive
              </button>
            </div>
          )}

          {isRunning && (
            <button className="btn-xs" style={{ marginTop: 6 }} onClick={() => void cancelDerive()}>
              Cancel
            </button>
          )}

          {job.status === 'error' && (
            <button
              className="btn-xs"
              style={{ marginTop: 6 }}
              onClick={() => {
                setJobId('')
                setJob(null)
              }}
            >
              Retry
            </button>
          )}
        </div>
      )}
    </details>
  )
}
