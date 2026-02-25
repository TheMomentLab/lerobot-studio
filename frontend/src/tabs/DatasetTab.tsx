import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiDelete, apiGet, apiPost } from '../lib/api'
import type { DatasetDetail, DatasetListItem } from '../lib/types'
import { useLeStudioStore } from '../store'

interface DatasetTabProps {
  active: boolean
}

type TagFilter = 'all' | 'good' | 'bad' | 'review' | 'untagged'

interface PushStatus {
  visible: boolean
  status: string
  phase: string
  progress: number
  note: string
}

interface QualityCheck {
  level: string
  name: string
  message: string
}

interface QualityResponse {
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

interface PushStartResponse {
  ok: boolean
  job_id?: string
  error?: string
}

interface PushStatusResponse {
  ok: boolean
  status?: string
  phase?: string
  progress?: number
  logs?: string[]
  repo_id?: string
  error?: string
}

const clampPercent = (value: number) => Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))

const parseDatasetId = (id: string): { user: string; repo: string } | null => {
  const [user, repo] = id.split('/')
  if (!user || !repo) return null
  return { user, repo }
}

export function DatasetTab({ active }: DatasetTabProps) {
  const addToast = useLeStudioStore((s) => s.addToast)
  const setActiveTab = useLeStudioStore((s) => s.setActiveTab)
  const [datasets, setDatasets] = useState<DatasetListItem[]>([])
  const [loadingDatasets, setLoadingDatasets] = useState(false)
  const [selected, setSelected] = useState<DatasetDetail | null>(null)
  const [selectedEpisode, setSelectedEpisode] = useState<number>(0)
  const [tags, setTags] = useState<Record<string, 'good' | 'bad' | 'review'>>({})
  const [filter, setFilter] = useState<TagFilter>('all')
  const [pushStatus, setPushStatus] = useState<PushStatus>({
    visible: false,
    status: 'idle',
    phase: 'idle',
    progress: 0,
    note: '',
  })
  const [pushJobId, setPushJobId] = useState('')
  const [quality, setQuality] = useState<QualityResponse | null>(null)
  const [hubQuery, setHubQuery] = useState('')
  const [hubTag, setHubTag] = useState('lerobot')
  const [hubStatusText, setHubStatusText] = useState('Ready')
  const [hubStatusClass, setHubStatusClass] = useState('badge-idle')
  const [hubResults, setHubResults] = useState<HubDatasetItem[]>([])
  const [hubDownloadVisible, setHubDownloadVisible] = useState(false)
  const [hubDownloadStatus, setHubDownloadStatus] = useState('idle')
  const [hubDownloadProgress, setHubDownloadProgress] = useState(0)
  const [hubDownloadNote, setHubDownloadNote] = useState('')
  const [hubDownloadJobId, setHubDownloadJobId] = useState('')
  const [lastHubDownloadRepoId, setLastHubDownloadRepoId] = useState('')
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackSpeed, setPlaybackSpeed] = useState(1)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const videoContainerRef = useRef<HTMLDivElement>(null)

  const refreshList = useCallback(async () => {
    setLoadingDatasets(true)
    try {
      const res = await apiGet<{ datasets: DatasetListItem[] }>('/api/datasets')
      setDatasets(res.datasets ?? [])
    } catch (error) {
      addToast(`Failed to load datasets: ${String(error)}`, 'error')
    } finally {
      setLoadingDatasets(false)
    }
  }, [addToast])

  useEffect(() => {
    if (!active) return
    refreshList()
  }, [active, refreshList])

  useEffect(() => {
    if (!pushJobId) return
    const timer = window.setInterval(async () => {
      try {
        const res = await apiGet<PushStatusResponse>(`/api/datasets/push/status/${encodeURIComponent(pushJobId)}`)
        if (!res.ok) {
          setPushStatus((prev) => ({ ...prev, visible: true, status: 'error', phase: 'error', progress: 0, note: res.error ?? 'Unknown push status error' }))
          setPushJobId('')
          return
        }
        const status = String(res.status ?? 'running')
        const phase = String(res.phase ?? status)
        const progress = clampPercent(Number(res.progress ?? 0))
        const tail = Array.isArray(res.logs) && res.logs.length > 0 ? String(res.logs[res.logs.length - 1]) : ''
        const note = status === 'error' ? String(res.error ?? tail ?? 'Upload failed') : tail
        setPushStatus({ visible: true, status, phase, progress, note })
        if (status === 'success') {
          addToast(`Dataset pushed to Hub: ${res.repo_id ?? selected?.dataset_id ?? ''}`, 'success')
          setPushJobId('')
        }
        if (status === 'error') {
          addToast(`Hub push failed: ${res.error ?? 'Unknown error'}`, 'error')
          setPushJobId('')
        }
      } catch (error) {
        setPushStatus((prev) => ({ ...prev, visible: true, status: 'error', phase: 'error', progress: 0, note: String(error) }))
        setPushJobId('')
      }
    }, 1200)
    return () => window.clearInterval(timer)
  }, [addToast, pushJobId, selected?.dataset_id])

  useEffect(() => {
    if (!hubDownloadJobId) return
    const timer = window.setInterval(async () => {
      try {
        const res = await apiGet<HubDownloadStatusResponse>(`/api/hub/datasets/download/status/${encodeURIComponent(hubDownloadJobId)}`)
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
        const note = status === 'error' ? String(res.error ?? tail ?? 'Download failed') : tail
        setHubDownloadStatus(status)
        setHubDownloadProgress(clampPercent(Number(res.progress ?? 0)))
        setHubDownloadNote(note)
        if (status === 'success') {
          setHubDownloadJobId('')
          addToast('Dataset download completed', 'success')
          refreshList()
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
  }, [addToast, hubDownloadJobId, refreshList])

  const loadDataset = async (id: string) => {
    const parsed = parseDatasetId(id)
    if (!parsed) {
      addToast('Invalid dataset id format', 'error')
      return
    }
    try {
      const detail = await apiGet<DatasetDetail>(`/api/datasets/${encodeURIComponent(parsed.user)}/${encodeURIComponent(parsed.repo)}`)
      setSelected(detail)
      setPushStatus({ visible: false, status: 'idle', phase: 'idle', progress: 0, note: '' })
      setPushJobId('')
      setQuality(null)
      if (detail.episodes.length > 0) {
        setSelectedEpisode(detail.episodes[0].episode_index)
      } else {
        setSelectedEpisode(0)
      }
      const tagRes = await apiGet<{ ok: boolean; tags: Record<string, 'good' | 'bad' | 'review'> }>(
        `/api/datasets/${encodeURIComponent(parsed.user)}/${encodeURIComponent(parsed.repo)}/tags`,
      )
      setTags(tagRes.ok ? tagRes.tags ?? {} : {})
    } catch (error) {
      addToast(`Failed to load dataset: ${String(error)}`, 'error')
    }
  }

  const filteredEpisodes = useMemo(() => {
    if (!selected) return []
    if (filter === 'all') return selected.episodes
    return selected.episodes.filter((ep) => {
      const tag = tags[String(ep.episode_index)] ?? 'untagged'
      return tag === filter
    })
  }, [selected, filter, tags])

  const selectedEpisodeData = useMemo(() => {
    if (!selected) return null
    return selected.episodes.find((ep) => ep.episode_index === selectedEpisode) ?? null
  }, [selected, selectedEpisode])

  const latestDatasetId = useMemo(() => {
    if (!datasets.length) return ''
    const latest = [...datasets].sort((a, b) => (Number(b.timestamp ?? 0) - Number(a.timestamp ?? 0)))[0]
    return latest?.id ?? ''
  }, [datasets])

  const episodeTimeBounds = useMemo(() => {
    if (!selectedEpisodeData || !selected?.cameras[0]) return { from: 0, to: null }
    const cam = selected.cameras[0]
    const meta = selectedEpisodeData.video_files?.[cam]
    return {
      from: meta?.from_timestamp ?? 0,
      to: meta?.to_timestamp ?? null,
    }
  }, [selectedEpisodeData, selected?.cameras])
  useEffect(() => {
    if (filteredEpisodes.length === 0) return
    if (!filteredEpisodes.some((ep) => ep.episode_index === selectedEpisode)) {
      setSelectedEpisode(filteredEpisodes[0].episode_index)
    }
  }, [filteredEpisodes, selectedEpisode])

  const tagEpisode = async (tag: 'good' | 'bad' | 'review' | 'untagged') => {
    if (!selected) return
    const parsed = parseDatasetId(selected.dataset_id)
    if (!parsed) return
    try {
      const res = await apiPost<{ ok: boolean; error?: string }>(`/api/datasets/${encodeURIComponent(parsed.user)}/${encodeURIComponent(parsed.repo)}/tags`, {
        episode_index: selectedEpisode,
        tag,
      })
      if (!res.ok) {
        addToast(`Tag failed: ${res.error ?? 'unknown error'}`, 'error')
        return
      }
      if (tag === 'untagged') {
        setTags((prev) => {
          const next = { ...prev }
          delete next[String(selectedEpisode)]
          return next
        })
      } else {
        setTags((prev) => ({ ...prev, [String(selectedEpisode)]: tag }))
      }
      addToast(`Episode ${selectedEpisode} tagged: ${tag}`, 'info')
    } catch (error) {
      addToast(`Tag failed: ${String(error)}`, 'error')
    }
  }

  const deleteDataset = async (id: string) => {
    const parsed = parseDatasetId(id)
    if (!parsed) {
      addToast('Invalid dataset id format.', 'error')
      return
    }
    const confirmed = window.confirm(`Are you sure you want to delete dataset "${id}"?\nThis cannot be undone.`)
    if (!confirmed) return
    try {
      await apiDelete<{ ok: boolean }>(`/api/datasets/${encodeURIComponent(parsed.user)}/${encodeURIComponent(parsed.repo)}`)
      addToast(`Deleted dataset: ${id}`, 'success')
      if (selected?.dataset_id === id) {
        setSelected(null)
        setTags({})
      }
      await refreshList()
    } catch (error) {
      addToast(`Delete failed: ${String(error)}`, 'error')
    }
  }

  const pushToHub = async (id: string) => {
    const parsed = parseDatasetId(id)
    if (!parsed) {
      addToast('Invalid dataset id format.', 'error')
      return
    }
    const targetRaw = window.prompt('Target Hub repo (username/dataset). Leave empty to use same id:', id)
    if (targetRaw === null) return
    const target = targetRaw.trim() || id
    if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(target)) {
      addToast('Target repo must be username/dataset format.', 'error')
      return
    }
    setPushStatus({ visible: true, status: 'starting', phase: 'starting', progress: 2, note: 'Preparing upload job...' })
    setPushJobId('')
    try {
      const res = await apiPost<PushStartResponse>(`/api/datasets/${encodeURIComponent(parsed.user)}/${encodeURIComponent(parsed.repo)}/push`, { target_repo_id: target })
      if (!res.ok || !res.job_id) {
        setPushStatus({ visible: true, status: 'error', phase: 'error', progress: 0, note: res.error ?? 'Failed to create upload job' })
        addToast(`Hub push failed: ${res.error ?? 'Unknown error'}`, 'error')
        return
      }
      setPushStatus({ visible: true, status: 'queued', phase: 'queued', progress: 5, note: 'Upload job queued...' })
      setPushJobId(res.job_id)
    } catch (error) {
      setPushStatus({ visible: true, status: 'error', phase: 'error', progress: 0, note: String(error) })
      addToast(`Hub push failed: ${String(error)}`, 'error')
    }
  }

  const inspectQuality = async (id: string) => {
    const parsed = parseDatasetId(id)
    if (!parsed) {
      addToast('Invalid dataset id format.', 'error')
      return
    }
    try {
      const res = await apiGet<QualityResponse>(`/api/datasets/${encodeURIComponent(parsed.user)}/${encodeURIComponent(parsed.repo)}/quality`)
      if (!res.ok) {
        addToast(`Quality check failed: ${res.error ?? 'Unknown error'}`, 'error')
        return
      }
      setQuality(res)
      addToast('Quality check complete.', 'success')
    } catch (error) {
      addToast(`Quality check failed: ${String(error)}`, 'error')
    }
  }

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

  const downloadHubDataset = async (repoId: string) => {
    const confirmed = window.confirm(`Download dataset "${repoId}" from HuggingFace Hub?\n\nLarge datasets may take several minutes.`)
    if (!confirmed) return
    setLastHubDownloadRepoId(repoId)
    setHubDownloadVisible(true)
    setHubDownloadStatus('queued')
    setHubDownloadProgress(0)
    setHubDownloadNote('Preparing download...')
    setHubDownloadJobId('')
    try {
      const res = await apiPost<HubDownloadResponse>('/api/hub/datasets/download', { repo_id: repoId })
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

  const qualityBadgeClass = !quality ? 'badge-idle' : quality.score >= 80 ? 'badge-ok' : quality.score >= 60 ? 'badge-warn' : 'badge-err'

  const qualityStatsText = useMemo(() => {
    if (!quality?.stats) return ''
    const stats = quality.stats
    const cameraCounts = stats.camera_file_counts ?? {}
    const cameraSummary =
      Object.keys(cameraCounts).length > 0 ? Object.entries(cameraCounts).map(([key, value]) => `${key}:${value}`).join(' · ') : '--'
    return `Episodes ${stats.total_detected_episodes ?? '--'} (expected ${stats.total_expected_episodes ?? '--'}) · Frames ${stats.total_frames ?? '--'} · FPS ${stats.fps ?? '--'} · Zero-byte videos ${stats.zero_byte_videos ?? '--'} · Camera files ${cameraSummary}`
  }, [quality])

  const formatTime = (seconds: number) => {
    const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
    const m = Math.floor(safeSeconds / 60)
    const s = safeSeconds % 60
    return `${m}:${s.toFixed(1).padStart(4, '0')}`
  }

  const getAllVideos = (): HTMLVideoElement[] => {
    if (!videoContainerRef.current) return []
    return Array.from(videoContainerRef.current.querySelectorAll('video.ds-video'))
  }

  const togglePlay = () => {
    const videos = getAllVideos()
    if (videos.length === 0) return
    if (isPlaying) {
      videos.forEach((video) => video.pause())
      setIsPlaying(false)
      return
    }
    const epFrom = episodeTimeBounds.from
    if (videos[0].currentTime < epFrom) {
      videos.forEach((v) => { v.currentTime = epFrom })
    }
    videos.forEach((video) => {
      video.playbackRate = playbackSpeed
      void video.play().catch(() => { setIsPlaying(false) })
    })
    setIsPlaying(true)
  }


  const handleScrub = (value: number) => {
    const epFrom = episodeTimeBounds.from
    const clampedRel = Math.max(0, Math.min(duration || Number.POSITIVE_INFINITY, value))
    const absTime = epFrom + clampedRel
    const videos = getAllVideos()
    videos.forEach((video) => {
      const maxTime = Number.isFinite(video.duration) ? video.duration : absTime
      video.currentTime = Math.max(0, Math.min(maxTime, absTime))
    })
    setCurrentTime(clampedRel)
  }

  const handleSpeedChange = (speed: number) => {
    setPlaybackSpeed(speed)
    const videos = getAllVideos()
    videos.forEach((video) => {
      video.playbackRate = speed
    })
  }

  useEffect(() => {
    const videos = getAllVideos()
    if (videos.length === 0) {
      setIsPlaying(false)
      setCurrentTime(0)
      setDuration(0)
      return
    }
    const { from: epFrom, to: epTo } = episodeTimeBounds
    videos.forEach((video) => {
      video.playbackRate = playbackSpeed
    })
    const primary = videos[0]
    const seekToEpisodeStart = () => {
      if (epFrom > 0) {
        primary.currentTime = epFrom
        videos.slice(1).forEach((v) => { v.currentTime = epFrom })
      }
    }
    const syncFromPrimary = () => {
      const raw = primary.currentTime || 0
      const relTime = Math.max(0, raw - epFrom)
      const epDuration = epTo !== null
        ? Math.max(0, epTo - epFrom)
        : (Number.isFinite(primary.duration) ? Math.max(0, primary.duration - epFrom) : 0)
      setCurrentTime(relTime)
      setDuration(epDuration)
      setIsPlaying(!primary.paused && !primary.ended)
    }
    const clampToEpisodeEnd = () => {
      if (epTo !== null && primary.currentTime >= epTo) {
        primary.pause()
        videos.slice(1).forEach((v) => v.pause())
        setIsPlaying(false)
      }
    }
    const syncAcrossVideos = () => {
      const target = primary.currentTime || 0
      videos.slice(1).forEach((video) => {
        if (Math.abs(video.currentTime - target) > 0.05) {
          video.currentTime = target
        }
      })
    }
    primary.addEventListener('loadedmetadata', seekToEpisodeStart)
    primary.addEventListener('loadedmetadata', syncFromPrimary)
    primary.addEventListener('durationchange', syncFromPrimary)
    primary.addEventListener('timeupdate', syncFromPrimary)
    primary.addEventListener('timeupdate', syncAcrossVideos)
    primary.addEventListener('timeupdate', clampToEpisodeEnd)
    primary.addEventListener('play', syncFromPrimary)
    primary.addEventListener('pause', syncFromPrimary)
    primary.addEventListener('ended', syncFromPrimary)
    syncFromPrimary()
    return () => {
      primary.removeEventListener('loadedmetadata', seekToEpisodeStart)
      primary.removeEventListener('loadedmetadata', syncFromPrimary)
      primary.removeEventListener('durationchange', syncFromPrimary)
      primary.removeEventListener('timeupdate', syncFromPrimary)
      primary.removeEventListener('timeupdate', syncAcrossVideos)
      primary.removeEventListener('timeupdate', clampToEpisodeEnd)
      primary.removeEventListener('play', syncFromPrimary)
      primary.removeEventListener('pause', syncFromPrimary)
      primary.removeEventListener('ended', syncFromPrimary)
    }
  }, [selected?.dataset_id, selectedEpisode, selected?.cameras, playbackSpeed, episodeTimeBounds])

  const hubCard = (
    <div className="card" style={{ marginTop: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
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
      <div id="hub-search-results" className="device-list" style={{ maxHeight: 260, overflowY: 'auto' }}>
        {hubResults.length === 0 ? (
          <div className="device-item">
            <span className="muted">Enter a query and press Search to find LeRobot datasets on the Hub.</span>
          </div>
        ) : (
          hubResults.map((item) => {
            const tagsLine = (item.tags ?? []).slice(0, 4).join(' · ')
            const metaParts = [
              item.downloads && item.downloads > 0 ? `↓ ${item.downloads.toLocaleString()}` : null,
              item.likes && item.likes > 0 ? `♥ ${item.likes}` : null,
              item.last_modified ? item.last_modified.slice(0, 10) : null,
            ].filter((entry): entry is string => Boolean(entry))
            return (
              <div key={item.id} className="device-item" style={{ alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text1)', wordBreak: 'break-all' }}>{item.id}</div>
                  <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>{metaParts.join(' · ')}</div>
                  {tagsLine ? <div style={{ fontSize: 10, color: 'var(--text2)', marginTop: 2, fontFamily: 'var(--mono)' }}>{tagsLine}</div> : null}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
                  <button className="btn-xs" onClick={() => void downloadHubDataset(item.id)}>
                    Download
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>
      <div id="hub-download-panel" style={{ display: hubDownloadVisible ? 'block' : 'none', marginTop: 10, border: '1px solid var(--border)', borderRadius: 8, padding: 10, background: 'var(--bg3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text2)', marginBottom: 6 }}>
          <span id="hub-dl-label">Downloading... {hubDownloadStatus}</span>
          <span id="hub-dl-percent">{clampPercent(hubDownloadProgress)}%</span>
        </div>
        <div className="usb-bus-bar-track">
          <div id="hub-dl-fill" className="usb-bar-fill good" style={{ width: `${clampPercent(hubDownloadProgress)}%` }} />
        </div>
        <div id="hub-dl-note" className="muted" style={{ fontSize: 11, marginTop: 6 }}>
          {hubDownloadNote}
        </div>
        {hubDownloadStatus === 'error' && lastHubDownloadRepoId ? (
          <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn-xs" onClick={() => void downloadHubDataset(lastHubDownloadRepoId)}>
              Retry Download
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )

  return (
    <section id="tab-dataset" className={`tab ${active ? 'active' : ''}`}>
      <div className="section-header">
        <h2>Dataset Viewer</h2>
        <span className={`status-verdict ${selected ? 'ready' : datasets.length > 0 ? 'warn' : 'warn'}`}>
          {selected ? `${selected.total_episodes} Episodes` : datasets.length > 0 ? `${datasets.length} Datasets` : 'No Datasets'}
        </span>
        <button onClick={refreshList} className="btn-sm">
          ↺ Refresh List
        </button>
      </div>

      {hubCard}

      <div className="two-col">
        <div className="card" style={{ maxHeight: 800, display: 'flex', flexDirection: 'column' }}>
          <h3>Local Datasets</h3>
          <div id="dataset-list" className="device-list" style={{ overflowY: 'auto', flex: 1 }}>
            {loadingDatasets
              ? <div className="device-empty-note">Loading datasets...</div>
              : datasets.length === 0
              ? <div className="device-empty-note">No datasets found in local cache.<br />Record episodes in the <strong>Record</strong> tab, or search and download from the <strong>HuggingFace Hub</strong> above.</div>
                : datasets.map((ds) => (
                  <div
                    className={`device-item ${selected?.dataset_id === ds.id ? 'selected' : ''}`}
                    key={ds.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Open dataset ${ds.id}`}
                    style={{ cursor: 'pointer', alignItems: 'flex-start', position: 'relative' }}
                    onClick={() => loadDataset(ds.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        void loadDataset(ds.id)
                      }
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{ds.id}</div>
                      <div style={{ fontSize: 11, color: 'var(--text2)' }}>
                        {ds.total_episodes ?? 0} episodes · {ds.total_frames ?? 0} frames · {ds.size_mb ?? 0} MB
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text2)' }}>Modified: {ds.modified || (ds.timestamp ? new Date(ds.timestamp * 1000).toLocaleString() : '--')}</div>
                    </div>
                    <details className="ds-actions-menu" onClick={(e) => e.stopPropagation()}>
                      <summary className="btn-xs ds-actions-summary" title="Dataset actions">
                        Actions ▾
                      </summary>
                      <div className="ds-actions-panel">
                        <button
                          className="btn-xs"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            void inspectQuality(ds.id)
                          }}
                        >
                          Inspect Quality
                        </button>
                        <button
                          className="btn-xs ds-action-btn-push"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            void pushToHub(ds.id)
                          }}
                        >
                          Push to Hub
                        </button>
                        <button
                          className="btn-xs ds-action-btn-danger"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            void deleteDataset(ds.id)
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </details>
                  </div>
                ))}
          </div>
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {!selected ? (
            <div id="dataset-detail-empty" className="dataset-empty-state">
              <div className="dataset-empty-icon">📂</div>
              <div className="dataset-empty-title">No dataset selected</div>
              <div className="dataset-empty-hint">Select a dataset from the list to view details and replay episodes.</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 8 }}>
                {latestDatasetId ? (
                  <button className="btn-sm" onClick={() => void loadDataset(latestDatasetId)}>
                    Select Latest Dataset
                  </button>
                ) : null}
                <button className="btn-sm" onClick={() => setActiveTab('record')}>
                  Go to Record
                </button>
              </div>
            </div>
          ) : (
            <div id="dataset-detail-view" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div>
                  <h3 id="ds-title" style={{ marginBottom: 4 }}>
                    {selected.dataset_id}
                  </h3>
                  <div id="ds-stats" className="muted" style={{ fontSize: 13 }}>
                    {selected.total_episodes} episodes · {selected.total_frames} frames · {selected.fps} FPS · Cameras: {selected.cameras.join(', ') || 'None'}
                  </div>
                </div>
                <div id="ds-detail-actions">
                  <details className="ds-actions-menu">
                    <summary className="btn-xs ds-actions-summary" title="Dataset actions">
                      Actions ▾
                    </summary>
                    <div className="ds-actions-panel">
                      <button className="btn-xs" onClick={() => void inspectQuality(selected.dataset_id)}>
                        Inspect Quality
                      </button>
                      <button className="btn-xs ds-action-btn-push" onClick={() => void pushToHub(selected.dataset_id)}>
                        Push to Hub
                      </button>
                      <button className="btn-xs ds-action-btn-danger" onClick={() => void deleteDataset(selected.dataset_id)}>
                        Delete
                      </button>
                    </div>
                  </details>
                </div>
              </div>

              <div className="dataset-quick-actions">
                <button className="btn-xs" onClick={() => void inspectQuality(selected.dataset_id)}>Inspect Quality</button>
                <button className="btn-xs ds-action-btn-push" onClick={() => void pushToHub(selected.dataset_id)}>Push to Hub</button>
                <button className="btn-xs ds-action-btn-danger" onClick={() => void deleteDataset(selected.dataset_id)}>Delete</button>
              </div>

              {!quality ? (
                <div className="dataset-workflow-banner">
                  <span className="dsub">Run quality inspection before training to validate episodes, frames, and video integrity.</span>
                  <button type="button" className="link-btn" onClick={() => void inspectQuality(selected.dataset_id)}>→ Inspect Quality Now</button>
                </div>
              ) : null}

              <div id="ds-push-status" style={{ display: pushStatus.visible ? 'block' : 'none', border: '1px solid var(--border)', borderRadius: 8, padding: 10, background: 'var(--bg3)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text2)', marginBottom: 6 }}>
                  <span id="ds-push-label">Hub Upload - {pushStatus.phase || pushStatus.status}</span>
                  <span id="ds-push-percent">{clampPercent(pushStatus.progress)}%</span>
                </div>
                <div className="usb-bus-bar-track">
                  <div id="ds-push-fill" className="usb-bar-fill good" style={{ width: `${clampPercent(pushStatus.progress)}%` }} />
                </div>
                <div id="ds-push-note" className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                  {pushStatus.note}
                </div>
                {pushStatus.status === 'error' ? (
                  <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
                    <button className="btn-xs" onClick={() => void pushToHub(selected.dataset_id)}>
                      Retry Push
                    </button>
                  </div>
                ) : null}
              </div>

              <div id="ds-quality-panel" style={{ display: quality ? 'block' : 'none', border: '1px solid var(--border)', borderRadius: 8, padding: 10, background: 'var(--bg3)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <strong>Quality Inspector</strong>
                  <span id="ds-quality-score" className={`dbadge ${qualityBadgeClass}`}>
                    Score: {quality?.score ?? '--'}
                  </span>
                </div>
                <div id="ds-quality-stats" className="muted" style={{ fontSize: 11, marginBottom: 8 }}>
                  {qualityStatsText}
                </div>
                <div id="ds-quality-checks" className="device-list">
                  {(quality?.checks ?? []).map((check, idx) => {
                    const level = check.level || 'ok'
                    const cls = level === 'error' ? 'badge-err' : level === 'warn' ? 'badge-warn' : 'badge-ok'
                    return (
                      <div key={`${check.name}-${idx}`} className="device-item" style={{ alignItems: 'flex-start' }}>
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

              {quality && quality.score >= 60 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <button type="button" className="link-btn" onClick={() => setActiveTab('train')}>→ Proceed to Train</button>
                </div>
              )}

              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <label>Episode:</label>
                <select id="ds-ep-select" value={selectedEpisode} onChange={(e) => setSelectedEpisode(Number(e.target.value))} style={{ flex: 1, minWidth: 160 }}>
                  {filteredEpisodes.map((ep) => (
                    <option key={ep.episode_index} value={ep.episode_index}>
                      Episode {ep.episode_index} ({ep.length ?? 0} frames)
                    </option>
                  ))}
                </select>
                <span className={`dbadge ${
                  (tags[String(selectedEpisode)] ?? 'untagged') === 'good' ? 'badge-ok'
                    : (tags[String(selectedEpisode)] ?? 'untagged') === 'bad' ? 'badge-err'
                    : (tags[String(selectedEpisode)] ?? 'untagged') === 'review' ? 'badge-warn'
                    : 'badge-idle'
                }`}>
                  {tags[String(selectedEpisode)] ?? 'untagged'}
                </span>
                <select id="ds-tag-filter" value={filter} onChange={(e) => setFilter(e.target.value as TagFilter)}>
                  <option value="all">All episodes</option>
                  <option value="good">👍 Good</option>
                  <option value="bad">👎 Bad</option>
                  <option value="review">🔍 Review</option>
                  <option value="untagged">Untagged</option>
                </select>
              </div>

              <div id="ds-video-grid" className="video-preview-grid" ref={videoContainerRef} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                {selected.cameras.length === 0 ? (
                  <div className="muted" style={{ gridColumn: '1/-1' }}>
                    No video data in this dataset.
                  </div>
                ) : (
                  selected.cameras.map((cam) => {
                    const parsed = parseDatasetId(selected.dataset_id)
                    if (!parsed) return null
                    const videoMeta = selectedEpisodeData?.video_files?.[cam]
                    const chunk = `chunk-${String(Math.max(0, Number(videoMeta?.chunk_index ?? 0))).padStart(3, '0')}`
                    const file = `file-${String(Math.max(0, Number(videoMeta?.file_index ?? 0))).padStart(3, '0')}.mp4`
                    return (
                      <div key={cam} style={{ background: 'var(--bg-app)', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
                        <div style={{ padding: '6px 10px', fontSize: 11, fontFamily: 'var(--mono)', borderBottom: '1px solid var(--border)', background: 'rgba(0,0,0,0.2)' }}>{cam}</div>
                        <video
                          key={`${cam}-ep${selectedEpisode}`}
                          className="ds-video"
                          src={`/api/datasets/${encodeURIComponent(parsed.user)}/${encodeURIComponent(parsed.repo)}/videos/${encodeURIComponent(cam)}/${encodeURIComponent(chunk)}/${encodeURIComponent(file)}`}
                          preload="metadata"
                          playsInline
                          style={{ width: '100%', display: 'block' }}
                        />
                      </div>
                    )
                  })
                )}
              </div>

              <div
                id="ds-video-controls"
                style={{
                  display: selected.cameras.length > 0 ? 'flex' : 'none',
                  flexDirection: 'column',
                  gap: 8,
                  padding: 10,
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  background: 'var(--bg3)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span id="ds-time-current" style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text2)', minWidth: 48, textAlign: 'right' }}>
                    {formatTime(currentTime)}
                  </span>
                  <input
                    id="ds-scrubber"
                    type="range"
                    min={0}
                    max={Math.max(duration, 0)}
                    value={Math.min(currentTime, Math.max(duration, 0))}
                    step={0.01}
                    onChange={(e) => handleScrub(Number(e.target.value))}
                    style={{ flex: 1, cursor: 'pointer', accentColor: 'var(--accent)' }}
                  />
                  <span id="ds-time-total" style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text2)', minWidth: 48 }}>
                    {formatTime(duration)}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
                  <button className="btn-sm" title="Previous episode" onClick={() => {
                    const eps = filteredEpisodes
                    const idx = eps.findIndex((ep) => ep.episode_index === selectedEpisode)
                    if (idx > 0) setSelectedEpisode(eps[idx - 1].episode_index)
                  }}>
                    ⏮
                  </button>
                  <button id="ds-play-btn" className="btn-sm" style={{ minWidth: 74 }} onClick={togglePlay}>
                    {isPlaying ? '⏸ Pause' : '▶ Play'}
                  </button>
                  <button className="btn-sm" title="Next episode" onClick={() => {
                    const eps = filteredEpisodes
                    const idx = eps.findIndex((ep) => ep.episode_index === selectedEpisode)
                    if (idx >= 0 && idx < eps.length - 1) setSelectedEpisode(eps[idx + 1].episode_index)
                  }}>
                    ⏭
                  </button>
                  <select
                    id="ds-speed-select"
                    value={playbackSpeed}
                    onChange={(e) => handleSpeedChange(Number(e.target.value))}
                    style={{ fontSize: 11, padding: '4px 6px', borderRadius: 4, background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', cursor: 'pointer' }}
                  >
                    <option value={0.25}>0.25×</option>
                    <option value={0.5}>0.5×</option>
                    <option value={1}>1×</option>
                    <option value={1.5}>1.5×</option>
                    <option value={2}>2×</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                <span style={{ fontSize: 11, color: 'var(--text2)', minWidth: 28 }}>Tag:</span>
                <button id="ds-tag-good" className="btn-xs" onClick={() => tagEpisode('good')}>
                  👍 Good
                </button>
                <button id="ds-tag-bad" className="btn-xs" onClick={() => tagEpisode('bad')}>
                  👎 Bad
                </button>
                <button id="ds-tag-review" className="btn-xs" onClick={() => tagEpisode('review')}>
                  🔍 Review
                </button>
                <button id="ds-tag-clear" className="btn-xs" onClick={() => tagEpisode('untagged')}>
                  ✕ Clear
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

    </section>
  )
}
