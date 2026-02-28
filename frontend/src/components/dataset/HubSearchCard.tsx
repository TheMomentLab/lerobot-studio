/**
 * HubSearchCard
 *
 * Self-contained card for all HuggingFace Hub interactions:
 *  - HF Auth Token management (save / clear / show)
 *  - Hub dataset search
 *  - Hub dataset download with progress tracking
 *
 * Extracted from DatasetTab.tsx to reduce that file's size and isolate all
 * Hub-related state here.
 */
import { useCallback, useEffect, useState } from 'react'
import { apiDelete, apiGet, apiPost } from '../../lib/api'
import { useLeStudioStore } from '../../store'

// ─── Types ───────────────────────────────────────────────────────────────────

interface HubDatasetItem {
  id: string
  downloads?: number
  likes?: number
  tags?: string[]
  last_modified?: string
}

interface HubSearchResponse {
  ok: boolean
  datasets: HubDatasetItem[]
  error?: string
}

interface HubDownloadResponse {
  ok: boolean
  job_id?: string
  error?: string
}

interface HubDownloadStatusResponse {
  ok: boolean
  status?: string
  progress?: number
  logs?: string[]
  error?: string
}

interface HFTokenStatusResponse {
  ok: boolean
  has_token: boolean
  source: string
  masked_token?: string
  error?: string
}

interface HFTokenMutationResponse {
  ok: boolean
  has_token?: boolean
  source?: string
  error?: string
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface Props {
  /** Called when a dataset download completes successfully, so the parent can refresh its list. */
  onDownloadComplete: () => void
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const clampPercent = (value: number) =>
  Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))

// ─── Component ───────────────────────────────────────────────────────────────

export function HubSearchCard({ onDownloadComplete }: Props) {
  const addToast = useLeStudioStore((s) => s.addToast)
  const setHfUsername = useLeStudioStore((s) => s.setHfUsername)

  // ── HF token state ──────────────────────────────────────────────────────
  const [hfTokenInput, setHfTokenInput] = useState('')
  const [hfTokenVisible, setHfTokenVisible] = useState(false)
  const [hfTokenSaving, setHfTokenSaving] = useState(false)
  const [hfTokenHasSaved, setHfTokenHasSaved] = useState(false)
  const [hfTokenSource, setHfTokenSource] = useState('none')
  const [hfTokenMasked, setHfTokenMasked] = useState('')

  // ── Hub search state ─────────────────────────────────────────────────────
  const [hubQuery, setHubQuery] = useState('')
  const [hubTag, setHubTag] = useState('lerobot')
  const [hubStatusText, setHubStatusText] = useState('Ready')
  const [hubStatusClass, setHubStatusClass] = useState('badge-idle')
  const [hubResults, setHubResults] = useState<HubDatasetItem[]>([])

  // ── Hub download state ───────────────────────────────────────────────────
  const [hubDownloadVisible, setHubDownloadVisible] = useState(false)
  const [hubDownloadStatus, setHubDownloadStatus] = useState('idle')
  const [hubDownloadProgress, setHubDownloadProgress] = useState(0)
  const [hubDownloadNote, setHubDownloadNote] = useState('')
  const [hubDownloadJobId, setHubDownloadJobId] = useState('')
  const [lastHubDownloadRepoId, setLastHubDownloadRepoId] = useState('')

  // ── HF token methods ─────────────────────────────────────────────────────

  const refreshHfTokenStatus = useCallback(async () => {
    try {
      const res = await apiGet<HFTokenStatusResponse>('/api/hf/token/status')
      if (!res.ok) {
        setHfTokenHasSaved(false)
        setHfTokenSource('none')
        setHfTokenMasked('')
        return
      }
      setHfTokenHasSaved(Boolean(res.has_token))
      setHfTokenSource(String(res.source ?? 'none'))
      setHfTokenMasked(String(res.masked_token ?? ''))
    } catch {
      setHfTokenHasSaved(false)
      setHfTokenSource('none')
      setHfTokenMasked('')
    }
  }, [])

  useEffect(() => {
    void refreshHfTokenStatus()
  }, [refreshHfTokenStatus])

  const saveHfToken = async () => {
    const token = hfTokenInput.trim()
    if (!token) {
      addToast('Enter your Hugging Face token first.', 'error')
      return
    }
    setHfTokenSaving(true)
    try {
      const res = await apiPost<HFTokenMutationResponse>('/api/hf/token', { token })
      if (!res.ok) {
        addToast(`Failed to save token: ${res.error ?? 'unknown error'}`, 'error')
        return
      }
      setHfTokenInput('')
      await refreshHfTokenStatus()
      addToast('Hugging Face token saved.', 'success')
      try {
        const whoami = await apiGet<{ ok: boolean; username: string | null }>('/api/hf/whoami')
        setHfUsername(whoami.ok ? whoami.username : null)
      } catch {
        setHfUsername(null)
      }
    } catch (error) {
      addToast(`Failed to save token: ${String(error)}`, 'error')
    } finally {
      setHfTokenSaving(false)
    }
  }

  const clearHfToken = async () => {
    setHfTokenSaving(true)
    try {
      const res = await apiDelete<HFTokenMutationResponse>('/api/hf/token')
      if (!res.ok) {
        addToast(`Failed to clear token: ${res.error ?? 'unknown error'}`, 'error')
        return
      }
      setHfTokenInput('')
      await refreshHfTokenStatus()
      setHfUsername(null)
      addToast('Hugging Face token cleared.', 'info')
    } catch (error) {
      addToast(`Failed to clear token: ${String(error)}`, 'error')
    } finally {
      setHfTokenSaving(false)
    }
  }

  // ── Hub search ──────────────────────────────────────────────────────────

  const searchHub = async () => {
    const query = hubQuery.trim()
    const tag = hubTag.trim() || 'lerobot'
    setHubStatusText('Searching...')
    setHubStatusClass('badge-warn')
    setHubResults([])
    try {
      const params = new URLSearchParams({ query, tag, limit: '30' })
      const res = await apiGet<HubSearchResponse>(`/api/hub/datasets/search?${params.toString()}`)
      if (!res.ok) {
        setHubStatusText('Error')
        setHubStatusClass('badge-err')
        addToast(`Hub search failed: ${res.error ?? 'Unknown error'}`, 'error')
        return
      }
      const next = res.datasets ?? []
      setHubResults(next)
      if (next.length === 0) {
        setHubStatusText('0 results')
        setHubStatusClass('badge-idle')
      } else {
        setHubStatusText(`${next.length} results`)
        setHubStatusClass('badge-ok')
      }
    } catch (error) {
      setHubStatusText('Error')
      setHubStatusClass('badge-err')
      addToast(`Hub search error: ${String(error)}`, 'error')
    }
  }

  // ── Hub download ─────────────────────────────────────────────────────────

  const downloadHubDataset = async (repoId: string) => {
    const confirmed = window.confirm(
      `Download dataset "${repoId}" from HuggingFace Hub?\n\nLarge datasets may take several minutes.`,
    )
    if (!confirmed) return
    setLastHubDownloadRepoId(repoId)
    setHubDownloadVisible(true)
    setHubDownloadStatus('queued')
    setHubDownloadProgress(0)
    setHubDownloadNote('Preparing download...')
    setHubDownloadJobId('')
    try {
      const res = await apiPost<HubDownloadResponse>('/api/hub/datasets/download', {
        repo_id: repoId,
      })
      if (!res.ok || !res.job_id) {
        setHubDownloadStatus('error')
        setHubDownloadProgress(0)
        setHubDownloadNote(res.error ?? 'Failed to start download')
        addToast(`Download failed: ${res.error ?? 'Unknown error'}`, 'error')
        return
      }
      setHubDownloadJobId(res.job_id)
    } catch (error) {
      setHubDownloadStatus('error')
      setHubDownloadProgress(0)
      setHubDownloadNote(String(error))
      addToast(`Download failed: ${String(error)}`, 'error')
    }
  }

  // Download job polling
  useEffect(() => {
    if (!hubDownloadJobId) return
    const timer = window.setInterval(async () => {
      try {
        const res = await apiGet<HubDownloadStatusResponse>(
          `/api/hub/datasets/download/status/${encodeURIComponent(hubDownloadJobId)}`,
        )
        if (!res.ok) {
          setHubDownloadStatus('error')
          setHubDownloadProgress(0)
          setHubDownloadNote(res.error ?? 'Status poll failed')
          setHubDownloadJobId('')
          return
        }
        const status = String(res.status ?? 'running')
        const logs = Array.isArray(res.logs) ? res.logs : []
        const tail = logs.length > 0 ? String(logs[logs.length - 1]) : ''
        const note =
          status === 'error' ? String(res.error ?? tail ?? 'Download failed') : tail
        setHubDownloadStatus(status)
        setHubDownloadProgress(clampPercent(Number(res.progress ?? 0)))
        setHubDownloadNote(note)
        if (status === 'success') {
          setHubDownloadJobId('')
          addToast('Dataset download completed', 'success')
          onDownloadComplete()
        }
        if (status === 'error') {
          setHubDownloadJobId('')
          addToast(`Download failed: ${res.error ?? 'Unknown error'}`, 'error')
        }
      } catch (error) {
        setHubDownloadStatus('error')
        setHubDownloadProgress(0)
        setHubDownloadNote(String(error))
        setHubDownloadJobId('')
      }
    }, 1200)
    return () => window.clearInterval(timer)
  }, [addToast, hubDownloadJobId, onDownloadComplete])

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="card" style={{ marginTop: 16, marginBottom: 16 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
        }}
      >
        <h3 style={{ margin: 0 }}>HuggingFace Hub</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {hubStatusText !== 'Ready' && (
            <span className={`dbadge ${hubStatusClass}`} id="hub-search-status">
              {hubStatusText}
            </span>
          )}
          {hubStatusClass === 'badge-err' ? (
            <button className="btn-xs" onClick={() => void searchHub()}>
              Retry Search
            </button>
          ) : null}
        </div>
      </div>

      {/* ── HF Auth Token ── */}
      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 10,
          background: 'var(--bg3)',
          marginBottom: 10,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
            marginBottom: 8,
            flexWrap: 'wrap',
          }}
        >
          <strong style={{ fontSize: 13 }}>Hub Auth Token</strong>
          <span className={`dbadge ${hfTokenHasSaved ? 'badge-ok' : 'badge-warn'}`}>
            {hfTokenHasSaved ? `Configured (${hfTokenSource})` : 'Missing'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            id="hub-token-input"
            type={hfTokenVisible ? 'text' : 'password'}
            value={hfTokenInput}
            placeholder={
              hfTokenHasSaved
                ? 'Enter new token to replace current one'
                : 'Paste HF token (hf_...)'
            }
            style={{ flex: 1, minWidth: 220 }}
            onChange={(e) => setHfTokenInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                void saveHfToken()
              }
            }}
          />
          <button className="btn-xs" onClick={() => setHfTokenVisible((prev) => !prev)}>
            {hfTokenVisible ? 'Hide' : 'Show'}
          </button>
          <button className="btn-xs" disabled={hfTokenSaving} onClick={() => void saveHfToken()}>
            Save Token
          </button>
          <button
            className="btn-xs"
            disabled={hfTokenSaving || !hfTokenHasSaved}
            onClick={() => void clearHfToken()}
          >
            Clear Token
          </button>
        </div>
        <div className="muted" style={{ marginTop: 6, fontSize: 11 }}>
          {hfTokenHasSaved
            ? `Current token: ${hfTokenMasked}`
            : 'Token is required for Hub push/download in this GUI session.'}
        </div>
      </div>

      {/* ── Search bar ── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <input
          id="hub-search-query"
          type="text"
          value={hubQuery}
          placeholder="Search datasets (e.g. so101, pick)"
          style={{ flex: 1, minWidth: 160 }}
          onChange={(e) => setHubQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              void searchHub()
            }
          }}
        />
        <input
          id="hub-search-tag"
          type="text"
          value={hubTag}
          placeholder="tag (default: lerobot)"
          style={{ width: 160 }}
          onChange={(e) => setHubTag(e.target.value)}
        />
        <button className="btn-sm" onClick={() => void searchHub()}>
          Search
        </button>
      </div>

      {/* ── Search results ── */}
      <div
        id="hub-search-results"
        className="device-list"
        style={{ maxHeight: 260, overflowY: 'auto' }}
      >
        {hubResults.length === 0 ? (
          <div className="device-item">
            <span className="muted">
              Enter a query and press Search to find LeRobot datasets on the Hub.
            </span>
          </div>
        ) : (
          hubResults.map((item) => {
            const tagsLine = (item.tags ?? []).slice(0, 4).join(' · ')
            const metaParts = [
              item.downloads && item.downloads > 0
                ? `↓ ${item.downloads.toLocaleString()}`
                : null,
              item.likes && item.likes > 0 ? `♥ ${item.likes}` : null,
              item.last_modified ? item.last_modified.slice(0, 10) : null,
            ].filter((entry): entry is string => Boolean(entry))
            return (
              <div
                key={item.id}
                className="device-item"
                style={{ alignItems: 'flex-start', gap: 8 }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: 13,
                      color: 'var(--text1)',
                      wordBreak: 'break-all',
                    }}
                  >
                    {item.id}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>
                    {metaParts.join(' · ')}
                  </div>
                  {tagsLine ? (
                    <div
                      style={{
                        fontSize: 10,
                        color: 'var(--text2)',
                        marginTop: 2,
                        fontFamily: 'var(--mono)',
                      }}
                    >
                      {tagsLine}
                    </div>
                  ) : null}
                </div>
                <div
                  style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}
                >
                  <button className="btn-xs" onClick={() => void downloadHubDataset(item.id)}>
                    Download
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* ── Download progress panel ── */}
      <div
        id="hub-download-panel"
        style={{
          display: hubDownloadVisible ? 'block' : 'none',
          marginTop: 10,
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
            fontSize: 12,
            color: 'var(--text2)',
            marginBottom: 6,
          }}
        >
          <span id="hub-dl-label">Downloading... {hubDownloadStatus}</span>
          <span id="hub-dl-percent">{clampPercent(hubDownloadProgress)}%</span>
        </div>
        <div className="usb-bus-bar-track">
          <div
            id="hub-dl-fill"
            className="usb-bar-fill good"
            style={{ width: `${clampPercent(hubDownloadProgress)}%` }}
          />
        </div>
        <div id="hub-dl-note" className="muted" style={{ fontSize: 11, marginTop: 6 }}>
          {hubDownloadNote}
        </div>
        {hubDownloadStatus === 'error' && lastHubDownloadRepoId ? (
          <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
            <button
              className="btn-xs"
              onClick={() => void downloadHubDataset(lastHubDownloadRepoId)}
            >
              Retry Download
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
