import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActionIcon, Badge, Box, Button, Checkbox, Group, Menu, NativeSelect, Paper, Slider, Text, TextInput, Title } from '@mantine/core'
import { DatasetCurationPanel } from '../components/dataset/DatasetCurationPanel'
import { DatasetAutoFlagPanel } from '../components/dataset/DatasetAutoFlagPanel'
import { HubSearchCard } from '../components/dataset/HubSearchCard'
import { DatasetQualityPanel } from '../components/dataset/DatasetQualityPanel'
import type { QualityResponse } from '../components/dataset/DatasetQualityPanel'
import { apiDelete, apiGet, apiPost } from '../lib/api'
import { logError } from '../lib/errors'
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
const DATASET_AUTO_NEXT_STORAGE_KEY = 'lestudio-dataset-auto-next-on-tag'
const EP_SELECT_PAGE_SIZE = 100

const parseDatasetId = (id: string): { user: string; repo: string } | null => {
  const [user, repo] = id.split('/')
  if (!user || !repo) return null
  return { user, repo }
}

const compactCameraLabel = (cameraName: string): string => {
  const parts = cameraName.split('.')
  return parts.length > 0 ? parts[parts.length - 1] : cameraName
}

export function DatasetTab({ active }: DatasetTabProps) {
  const addToast = useLeStudioStore((s) => s.addToast)

  const setActiveTab = useLeStudioStore((s) => s.setActiveTab)
  const datasets = useLeStudioStore((s) => s.datasets)
  const loadingDatasets = useLeStudioStore((s) => s.loadingDatasets)
  const setDatasets = useLeStudioStore((s) => s.setDatasets)
  const setLoadingDatasets = useLeStudioStore((s) => s.setLoadingDatasets)
  const [selected, setSelected] = useState<DatasetDetail | null>(null)
  const [selectedEpisode, setSelectedEpisode] = useState<number>(0)
  const [tags, setTags] = useState<Record<string, 'good' | 'bad' | 'review'>>({})
  const [filter, setFilter] = useState<TagFilter>('all')
  const [episodeQuery, setEpisodeQuery] = useState('')
  const [episodePage, setEpisodePage] = useState(1)
  const [autoNextOnTag, setAutoNextOnTag] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(DATASET_AUTO_NEXT_STORAGE_KEY) === '1'
  })
  const [pushStatus, setPushStatus] = useState<PushStatus>({
    visible: false,
    status: 'idle',
    phase: 'idle',
    progress: 0,
    note: '',
  })
  const [pushJobId, setPushJobId] = useState('')
  const [quality, setQuality] = useState<QualityResponse | null>(null)

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
  }, [addToast, setDatasets, setLoadingDatasets])



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



  const loadDataset = async (id: string) => {
    const parsed = parseDatasetId(id)
    if (!parsed) {
      addToast('Invalid dataset id format', 'error')
      return
    }
    try {
      const detail = await apiGet<DatasetDetail>(`/api/datasets/${encodeURIComponent(parsed.user)}/${encodeURIComponent(parsed.repo)}`)
      setSelected(detail)
      setEpisodeQuery('')
      setEpisodePage(1)
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

  const reloadTags = useCallback(async () => {
    if (!selected) return
    const [u, r] = selected.dataset_id.split('/')
    const tagRes = await apiGet<{ ok: boolean; tags: Record<string, 'good' | 'bad' | 'review'> }>(
      `/api/datasets/${encodeURIComponent(u)}/${encodeURIComponent(r)}/tags`,
    )
    setTags(tagRes.ok ? tagRes.tags ?? {} : {})
  }, [selected])

  const filteredEpisodes = useMemo(() => {
    if (!selected) return []
    if (filter === 'all') return selected.episodes
    return selected.episodes.filter((ep) => {
      const tag = tags[String(ep.episode_index)] ?? 'untagged'
      return tag === filter
    })
  }, [selected, filter, tags])

  const searchedEpisodes = useMemo(() => {
    const q = episodeQuery.trim()
    if (!q) return filteredEpisodes
    return filteredEpisodes.filter((ep) => String(ep.episode_index).includes(q))
  }, [filteredEpisodes, episodeQuery])

  const episodePageCount = useMemo(
    () => Math.max(1, Math.ceil(searchedEpisodes.length / EP_SELECT_PAGE_SIZE)),
    [searchedEpisodes],
  )

  const pagedEpisodes = useMemo(() => {
    const safePage = Math.max(1, Math.min(episodePage, episodePageCount))
    const from = (safePage - 1) * EP_SELECT_PAGE_SIZE
    const to = from + EP_SELECT_PAGE_SIZE
    return searchedEpisodes.slice(from, to)
  }, [searchedEpisodes, episodePage, episodePageCount])

  const selectedEpisodeData = useMemo(() => {
    if (!selected) return null
    return selected.episodes.find((ep) => ep.episode_index === selectedEpisode) ?? null
  }, [selected, selectedEpisode])

  const selectedEpisodeIsUntagged = !Object.prototype.hasOwnProperty.call(tags, String(selectedEpisode))
  const selectedEpisodeTag: 'good' | 'bad' | 'review' | 'untagged' = selectedEpisodeIsUntagged
    ? 'untagged'
    : tags[String(selectedEpisode)]

  const episodeSummaryText = useMemo(() => {
    const hasSearch = episodeQuery.trim() !== ''
    const hasTagFilter = filter !== 'all'
    const hasPaging = episodePageCount > 1
    if (!hasSearch && !hasTagFilter && !hasPaging) return ''

    const parts: string[] = []
    if (hasPaging) {
      parts.push(`Showing ${pagedEpisodes.length} of ${searchedEpisodes.length}`)
    } else {
      parts.push(`${searchedEpisodes.length} episodes`)
    }
    if (hasTagFilter) {
      parts.push(`tag: ${filter}`)
    }
    if (hasSearch) {
      parts.push('search active')
    }
    return parts.join(' · ')
  }, [episodeQuery, filter, episodePageCount, pagedEpisodes.length, searchedEpisodes.length])

  const cameraBadges = useMemo(() => {
    if (!selected) return []
    return selected.cameras.map((cameraName) => ({
      full: cameraName,
      compact: compactCameraLabel(cameraName),
    }))
  }, [selected])

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

  useEffect(() => {
    if (searchedEpisodes.length === 0) return
    if (!searchedEpisodes.some((ep) => ep.episode_index === selectedEpisode)) {
      setSelectedEpisode(searchedEpisodes[0].episode_index)
    }
  }, [searchedEpisodes, selectedEpisode])

  useEffect(() => {
    setEpisodePage(1)
  }, [selected?.dataset_id, filter, episodeQuery])

  useEffect(() => {
    if (episodePage > episodePageCount) {
      setEpisodePage(episodePageCount)
    }
  }, [episodePage, episodePageCount])

  useEffect(() => {
    if (searchedEpisodes.length === 0) return
    const idx = searchedEpisodes.findIndex((ep) => ep.episode_index === selectedEpisode)
    if (idx < 0) return
    const expectedPage = Math.floor(idx / EP_SELECT_PAGE_SIZE) + 1
    if (expectedPage !== episodePage) {
      setEpisodePage(expectedPage)
    }
  }, [searchedEpisodes, selectedEpisode, episodePage])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(DATASET_AUTO_NEXT_STORAGE_KEY, autoNextOnTag ? '1' : '0')
  }, [autoNextOnTag])

  const jumpEpisodePage = useCallback((targetPage: number) => {
    if (searchedEpisodes.length === 0) return
    const safePage = Math.max(1, Math.min(targetPage, episodePageCount))
    if (safePage === episodePage) return
    const from = (safePage - 1) * EP_SELECT_PAGE_SIZE
    const targetEpisode = searchedEpisodes[from]
    setEpisodePage(safePage)
    if (targetEpisode) {
      setSelectedEpisode(targetEpisode.episode_index)
    }
  }, [searchedEpisodes, episodePageCount, episodePage])

  const tagEpisode = async (tag: 'good' | 'bad' | 'review' | 'untagged') => {
    if (!selected) return
    const parsed = parseDatasetId(selected.dataset_id)
    if (!parsed) return
    const episodesSnapshot = filteredEpisodes.map((ep) => ep.episode_index)
    const currentEpisode = selectedEpisode
    const currentIndex = episodesSnapshot.findIndex((episodeIndex) => episodeIndex === currentEpisode)
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
      if (autoNextOnTag && currentIndex >= 0) {
        if (currentIndex < episodesSnapshot.length - 1) {
          setSelectedEpisode(episodesSnapshot[currentIndex + 1])
        } else {
          addToast('Reached last episode in current filter.', 'info')
        }
      }
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
        const errText = String(res.error ?? 'Failed to create upload job')
        setPushStatus({ visible: true, status: 'error', phase: 'error', progress: 0, note: res.error ?? 'Failed to create upload job' })
        addToast(`Hub push failed: ${res.error ?? 'Unknown error'}`, 'error')
        if (errText.includes('HF_TOKEN') || errText.includes('HUGGINGFACE_HUB_TOKEN')) {
          addToast('Set your HF token in the Hub panel, then retry push.', 'info')
        }
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
      void video.play().catch((err) => {
        logError('DatasetTab.videoPlay')(err)
        setIsPlaying(false)
      })
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



  return (
    <Box id="tab-dataset" className={`tab ${active ? 'active' : ''}`} style={{ display: active ? 'block' : 'none' }}>
      <Group className="section-header" mb="md" align="center">
        <Title order={2}>Dataset Viewer</Title>
        <Badge variant="light" color={selected ? 'green' : 'yellow'}>
          {selected ? `${selected.total_episodes} Episodes` : datasets.length > 0 ? `${datasets.length} Datasets` : 'No Datasets'}
        </Badge>
        <Button onClick={refreshList} size="xs" variant="light">
          ↺ Refresh List
        </Button>
      </Group>

      <HubSearchCard onDownloadComplete={refreshList} />

      <div className="two-col">
        <Paper withBorder p="md" mb="md" className="card" style={{ maxHeight: 800, display: 'flex', flexDirection: 'column' }}>
          <Text size="sm" fw={600} c="dimmed" mb="xs">Local Datasets</Text>
          <div id="dataset-list" className="device-list" style={{ overflowY: 'auto', flex: 1 }}>
            {datasets.length === 0 && loadingDatasets
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
                    <div className="ds-actions-menu">
                      <Menu shadow="md" position="bottom-end" withinPortal>
                        <Menu.Target>
                          <ActionIcon className="ds-actions-summary" size="sm" variant="subtle" title="Dataset actions" onClick={(e) => e.stopPropagation()}>
                            ⋮
                          </ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown className="ds-actions-panel" onClick={(e) => e.stopPropagation()}>
                          <Menu.Item
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              void inspectQuality(ds.id)
                            }}
                          >
                            Inspect Quality
                          </Menu.Item>
                          <Menu.Item
                            className="ds-action-btn-push"
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              void pushToHub(ds.id)
                            }}
                          >
                            Push to Hub
                          </Menu.Item>
                          <Menu.Item
                            className="ds-action-btn-danger"
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              void deleteDataset(ds.id)
                            }}
                          >
                            Delete
                          </Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                    </div>
                  </div>
                ))}
          </div>
        </Paper>

        <Paper withBorder p="md" mb="md" className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {!selected ? (
            <div id="dataset-detail-empty" className="dataset-empty-state">
              <div className="dataset-empty-icon">📂</div>
              <div className="dataset-empty-title">No dataset selected</div>
              <div className="dataset-empty-hint">Select a dataset from the list to view details and replay episodes.</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 8 }}>
                {latestDatasetId ? (
                  <Button size="compact-xs" variant="light" onClick={() => void loadDataset(latestDatasetId)}>
                    Select Latest Dataset
                  </Button>
                ) : null}
                <Button size="compact-xs" variant="light" onClick={() => setActiveTab('record')}>
                  Go to Record
                </Button>
              </div>
            </div>
          ) : (
            <div id="dataset-detail-view" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="dataset-detail-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div>
                  <Text id="ds-title" size="sm" fw={600} c="dimmed" mb="xs" style={{ marginBottom: 4 }}>
                    {selected.dataset_id}
                  </Text>
                  <div id="ds-stats" className="muted dataset-detail-stats" style={{ fontSize: 13 }}>
                    {selected.total_episodes} episodes · {selected.total_frames} frames · {selected.fps} FPS
                  </div>
                  <div className="dataset-camera-row">
                    <span className="muted">Cameras</span>
                    <div className="dataset-camera-chip-list">
                      {cameraBadges.length === 0 ? (
                        <span className="muted" style={{ fontSize: 12 }}>None</span>
                      ) : (
                        cameraBadges.map((camera) => (
                          <span
                            key={camera.full}
                            className="dbadge badge-idle dataset-camera-chip"
                            title={camera.full}
                          >
                            {camera.compact}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                </div>
                <div id="ds-detail-actions">
                  <div className="ds-actions-menu">
                    <Menu shadow="md" position="bottom-end" withinPortal>
                      <Menu.Target>
                        <ActionIcon className="ds-actions-summary" size="sm" variant="subtle" title="Dataset actions" onClick={(e) => e.stopPropagation()}>
                          ⋮
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown className="ds-actions-panel" onClick={(e) => e.stopPropagation()}>
                        <Menu.Item onClick={() => void inspectQuality(selected.dataset_id)}>
                          Inspect Quality
                        </Menu.Item>
                        <Menu.Item className="ds-action-btn-push" onClick={() => void pushToHub(selected.dataset_id)}>
                          Push to Hub
                        </Menu.Item>
                        <Menu.Item className="ds-action-btn-danger" onClick={() => void deleteDataset(selected.dataset_id)}>
                          Delete
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                  </div>
                </div>
              </div>

              {!quality ? (
                <div className="dataset-workflow-banner">
                  <span className="dsub">Run quality inspection before training to validate episodes, frames, and video integrity.</span>
                  <Button type="button" className="link-btn" variant="subtle" size="compact-xs" onClick={() => void inspectQuality(selected.dataset_id)}>→ Inspect Quality Now</Button>
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
                    <Button size="compact-xs" variant="light" onClick={() => void pushToHub(selected.dataset_id)}>
                      Retry Push
                    </Button>
                  </div>
                ) : null}
              </div>

              {quality && <DatasetQualityPanel quality={quality} />}

              {quality && quality.score >= 60 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <Button type="button" className="link-btn" variant="subtle" size="compact-xs" onClick={() => setActiveTab('train')}>→ Proceed to Train</Button>
                </div>
              )}


              <div className="dataset-episode-controls">
                <div className="dataset-episode-row dataset-episode-row-primary">
                  <NativeSelect
                    id="ds-ep-select"
                    className="dataset-episode-select"
                    label="Episode"
                    value={String(selectedEpisode)}
                    onChange={(e) => setSelectedEpisode(Number(e.target.value))}
                    style={{ flex: 1, minWidth: 220 }}
                    data={pagedEpisodes.length > 0
                      ? pagedEpisodes.map((ep) => ({ value: String(ep.episode_index), label: `Episode ${ep.episode_index} (${ep.length ?? 0} frames)` }))
                      : [{ value: String(selectedEpisode), label: 'No matching episodes' }]}
                  />

                  <div className="dataset-page-nav" aria-label="Episode page navigation">
                  <Button
                    className="dataset-ep-nav-btn"
                    size="compact-xs"
                    variant="light"
                    title="Previous page"
                    onClick={() => jumpEpisodePage(episodePage - 1)}
                    disabled={episodePage <= 1}
                  >
                    Prev {EP_SELECT_PAGE_SIZE}
                  </Button>
                  <Button
                    className="dataset-ep-nav-btn"
                    size="compact-xs"
                    variant="light"
                    title="Next page"
                    onClick={() => jumpEpisodePage(episodePage + 1)}
                    disabled={episodePage >= episodePageCount}
                  >
                    Next {EP_SELECT_PAGE_SIZE}
                  </Button>
                    <span className="muted dataset-page-indicator">
                      Page {episodePage}/{episodePageCount}
                    </span>
                  </div>

                  <span className={`dbadge dataset-episode-tag-badge ${
                    selectedEpisodeTag === 'good' ? 'badge-ok'
                      : selectedEpisodeTag === 'bad' ? 'badge-err'
                      : selectedEpisodeTag === 'review' ? 'badge-warn'
                      : 'badge-idle'
                  }`}>
                    {selectedEpisodeTag}
                  </span>
                </div>

                <div className="dataset-episode-row dataset-episode-row-secondary">
                  <div className="dataset-secondary-fields">
                    <div className="dataset-inline-field">
                      <TextInput
                        id="ds-ep-query"
                        label="Find"
                        value={episodeQuery}
                        onChange={(e) => setEpisodeQuery(e.target.value)}
                        placeholder="episode index"
                      />
                    </div>

                    <div className="dataset-inline-field">
                      <NativeSelect
                        id="ds-tag-filter"
                        label="Filter"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value as TagFilter)}
                        data={[
                          { value: 'all', label: 'All episodes' },
                          { value: 'good', label: '👍 Good' },
                          { value: 'bad', label: '👎 Bad' },
                          { value: 'review', label: '🔍 Review' },
                          { value: 'untagged', label: 'Untagged' },
                        ]}
                      />
                    </div>
                  </div>

                  {episodeSummaryText ? (
                    <div className="dataset-episode-summary">
                      <span className="muted dataset-episode-count">
                        {episodeSummaryText}
                      </span>
                    </div>
                  ) : null}
                </div>
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
                  <Box style={{ flex: 1 }}>
                    <Slider
                      id="ds-scrubber"
                      min={0}
                      max={Math.max(duration, 0.01)}
                      value={Math.min(currentTime, Math.max(duration, 0.01))}
                      step={0.01}
                      onChange={handleScrub}
                      color="blue"
                    />
                  </Box>
                  <span id="ds-time-total" style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text2)', minWidth: 48 }}>
                    {formatTime(duration)}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
                  <ActionIcon variant="light" title="Previous episode" onClick={() => {
                    const eps = filteredEpisodes
                    const idx = eps.findIndex((ep) => ep.episode_index === selectedEpisode)
                    if (idx > 0) setSelectedEpisode(eps[idx - 1].episode_index)
                  }}>
                    ⏮
                  </ActionIcon>
                  <Button id="ds-play-btn" size="compact-xs" variant="light" style={{ minWidth: 74 }} onClick={togglePlay}>
                    {isPlaying ? '⏸ Pause' : '▶ Play'}
                  </Button>
                  <ActionIcon variant="light" title="Next episode" onClick={() => {
                    const eps = filteredEpisodes
                    const idx = eps.findIndex((ep) => ep.episode_index === selectedEpisode)
                    if (idx >= 0 && idx < eps.length - 1) setSelectedEpisode(eps[idx + 1].episode_index)
                  }}>
                    ⏭
                  </ActionIcon>
                  <NativeSelect
                    id="ds-speed-select"
                    value={String(playbackSpeed)}
                    onChange={(e) => handleSpeedChange(Number(e.target.value))}
                    style={{ fontSize: 11, padding: '4px 6px', borderRadius: 4, background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', cursor: 'pointer' }}
                    data={[
                      { value: '0.25', label: '0.25×' },
                      { value: '0.5', label: '0.5×' },
                      { value: '1', label: '1×' },
                      { value: '1.5', label: '1.5×' },
                      { value: '2', label: '2×' },
                    ]}
                  />
                </div>
              </div>

              <div className="dataset-tag-row">
                <span className="dataset-tag-label">Tag</span>
                <div className="dataset-tag-actions">
                  <Button
                    id="ds-tag-good"
                    className={`dataset-tag-btn ${selectedEpisodeTag === 'good' ? 'active' : ''}`}
                    size="compact-xs"
                    variant="light"
                    onClick={() => tagEpisode('good')}
                  >
                    👍 Good
                  </Button>
                  <Button
                    id="ds-tag-bad"
                    className={`dataset-tag-btn ${selectedEpisodeTag === 'bad' ? 'active' : ''}`}
                    size="compact-xs"
                    variant="light"
                    onClick={() => tagEpisode('bad')}
                  >
                    👎 Bad
                  </Button>
                  <Button
                    id="ds-tag-review"
                    className={`dataset-tag-btn ${selectedEpisodeTag === 'review' ? 'active' : ''}`}
                    size="compact-xs"
                    variant="light"
                    onClick={() => tagEpisode('review')}
                  >
                    🔍 Review
                  </Button>
                  <Button
                    id="ds-tag-clear"
                    className={`dataset-tag-btn ${selectedEpisodeIsUntagged ? 'active' : ''}`}
                    size="compact-xs"
                    variant="light"
                    onClick={() => tagEpisode('untagged')}
                  >
                    ✕ Clear
                  </Button>
                </div>
                <Checkbox id="ds-auto-next" className="dataset-auto-next" checked={autoNextOnTag} onChange={(e) => setAutoNextOnTag(e.target.checked)} label="Auto-next after tag" />
              </div>

              {selected && (
                <DatasetAutoFlagPanel
                  datasetId={selected.dataset_id}
                  totalEpisodes={selected.total_episodes}
                  onTagsChanged={reloadTags}
                />
              )}

              {selected && (
                <DatasetCurationPanel
                  filteredEpisodes={filteredEpisodes}
                  allEpisodes={selected.episodes}
                  tags={tags}
                  totalEpisodes={selected.total_episodes}
                  datasetId={selected.dataset_id}
                  onDerived={(newRepoId) => {
                    void refreshList().then(() => {
                      void loadDataset(newRepoId)
                    })
                  }}
                />
              )}
            </div>
          )}
        </Paper>
      </div>

    </Box>
  )
}
