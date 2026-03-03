import React, { useState, useEffect, useRef, useMemo } from "react";
import { Link } from "react-router";
import {
  RefreshCw, Trash2, Search, Upload, ExternalLink, Cloud,
  Play, Pause, SkipBack, SkipForward, CheckCircle2, ThumbsUp, ThumbsDown,
  Heart, Download, AlertTriangle, MoreVertical, FileWarning, MonitorPlay,
  Filter, Settings, Lock, Loader2, Square, Activity, Zap, Film, HardDrive
} from "lucide-react";
import {
  PageHeader, StatusBadge, WireSelect, WireInput, FieldRow,
  WireBox, WireToggle, StickyControlBar, RefreshButton, SubTabs,
} from "../components/wireframe";
import { useHfAuth } from "../hf-auth-context";
import { cn } from "../components/ui/utils";
import { apiDelete, apiGet, apiPost } from "../services/apiClient";
import {
  buildHubSearchPath,
  fromBackendDatasetList,
  fromBackendHubSearch,
} from "../services/contracts";
import { useLeStudioStore } from "../store";

// ─── Types ───────────────────────────────────────────────────────────────────
type LocalDataset = { id: string; episodes: number; frames: number; size: string; modified: string; tags?: string[] };
type HubResult = { id: string; desc: string; downloads: number; likes: number; tags: string[]; modified: string };
type MyHubDataset = {
  id: string;
  downloads: number;
  likes: number;
  size: string;
  modified: string;
  local_sync: boolean;
};
type MyHubDatasetsResponse = {
  ok?: boolean;
  username?: string;
  datasets?: MyHubDataset[];
  error?: string;
};
type HubDownloadStartResponse = { ok?: boolean; job_id?: string; error?: string };
type HubDownloadStatusResponse = {
  ok?: boolean;
  status?: string;
  progress?: number;
  logs?: string[];
  error?: string;
};

type DatasetPushStartResponse = { ok?: boolean; job_id?: string; error?: string };
type DatasetPushStatusResponse = {
  ok?: boolean;
  status?: string;
  phase?: string;
  progress?: number;
  logs?: string[];
  repo_id?: string;
  error?: string;
};

type DatasetDeleteResponse = {
  ok?: boolean;
  detail?: string;
  error?: string;
};

type QualityCheck = {
  level?: "ok" | "warn" | "error";
  name?: string;
  message?: string;
};

type DatasetQualityResponse = {
  ok?: boolean;
  score?: number;
  checks?: QualityCheck[];
  error?: string;
};

type EpisodeStat = {
  episode_index: number;
  frames: number;
  movement: number;
  jerk_score: number;
  jerk_ratio?: number;
};

type StatsSummaryMetric = { min: number; max: number; p25: number; p75: number; median: number };
type DatasetStatsResponse = {
  ok?: boolean;
  episodes?: EpisodeStat[];
  dataset_summary?: {
    frames?: StatsSummaryMetric;
    movement?: StatsSummaryMetric;
    jerk_score?: StatsSummaryMetric;
    jerk_ratio?: StatsSummaryMetric;
  };
  error?: string;
};

type StatsRecomputeResponse = { ok?: boolean; status?: string; cached?: boolean; job_id?: string; error?: string };
type StatsStatusResponse = { ok?: boolean; status?: string; phase?: string; progress?: number; error?: string };
type BulkTagsResponse = { ok?: boolean; applied?: number; error?: string };

type DeriveStartResponse = { ok?: boolean; job_id?: string; error?: string };
type DeriveStatusResponse = {
  ok?: boolean;
  status?: string;
  phase?: string;
  progress?: number;
  logs?: string[];
  error?: string;
  keep_count?: number;
  delete_count?: number;
};
type TagsResponse = { ok?: boolean; tags?: Record<string, TagType> };

type DatasetVideoRef = {
  chunk_index?: number;
  file_index?: number;
  from_timestamp?: number;
  to_timestamp?: number;
};

type DatasetEpisode = {
  episode_index: number;
  length?: number;
  video_files?: Record<string, DatasetVideoRef>;
};

type DatasetDetail = {
  dataset_id: string;
  total_episodes: number;
  total_frames: number;
  fps: number;
  cameras: string[];
  episodes: DatasetEpisode[];
};

type HfGateBannerProps = {
  authState: string;
  level: "hf_read" | "hf_write";
};

function HfGateBanner({ authState, level }: HfGateBannerProps) {
  const requirement = level === "hf_write" ? "write" : "read";
  return (
    <div className="rounded-lg border border-amber-300/70 bg-amber-50/80 dark:border-amber-500/40 dark:bg-amber-950/30 px-3 py-2 text-sm text-amber-800 dark:text-amber-200 flex items-center gap-2">
      <Lock size={14} className="flex-none" />
      <span>
        Hugging Face auth required ({requirement}). Current state: <span className="font-mono">{authState}</span>
      </span>
    </div>
  );
}

type TagType = "good" | "bad" | "review" | "untagged";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseDatasetId(id: string): { user: string; repo: string } | null {
  const [user, repo] = id.split("/");
  if (!user || !repo) return null;
  return { user, repo };
}

function formatMetric(value: number | null | undefined, unit: string): string {
  return Number.isFinite(value) ? `${value} ${unit}` : "—";
}

// ─── Sub-Components ──────────────────────────────────────────────────────────

// 1. Hub Search Panel
function HubSearchPanel() {
  const addToast = useLeStudioStore((s) => s.addToast);
  const { hfAuth } = useHfAuth();
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState(false);
  const [hubResults, setHubResults] = useState<HubResult[]>([]);
  const [myHubDatasets, setMyHubDatasets] = useState<MyHubDataset[]>([]);
  const [myHubUsername, setMyHubUsername] = useState("lerobot-user");
  const [myHubLoading, setMyHubLoading] = useState(false);
  const [myHubReloadToken, setMyHubReloadToken] = useState(0);
  const [downloading, setDownloading] = useState<Record<string, number>>({});
  const [downloadJobs, setDownloadJobs] = useState<Record<string, string>>({});
  const [downloadNotes, setDownloadNotes] = useState<Record<string, string>>({});

  const setDownloadProgress = (repoId: string, rawProgress: unknown) => {
    const numeric = typeof rawProgress === "number" ? rawProgress : Number(rawProgress ?? 0);
    const clamped = Math.max(0, Math.min(100, Number.isFinite(numeric) ? numeric : 0));
    setDownloading((prev) => ({ ...prev, [repoId]: clamped }));
  };

  const clearDownloadUi = (repoId: string) => {
    setDownloading((prev) => {
      const next = { ...prev };
      delete next[repoId];
      return next;
    });
    setDownloadNotes((prev) => {
      const next = { ...prev };
      delete next[repoId];
      return next;
    });
  };

  const doSearch = () => {
    if (!query.trim()) return;
    apiGet<unknown>(buildHubSearchPath(query.trim())).then((res) => {
      setHubResults(fromBackendHubSearch(res));
      setSearched(true);
    });
  };

  const startDownload = async (repoId: string) => {
    if (downloadJobs[repoId]) return;

    setDownloadProgress(repoId, 0);
    setDownloadNotes((prev) => ({ ...prev, [repoId]: "Preparing download job..." }));

    try {
      const started = await apiPost<HubDownloadStartResponse>("/api/hub/datasets/download", {
        repo_id: repoId,
      });

      if (!started.ok || !started.job_id) {
        clearDownloadUi(repoId);
        addToast(started.error ?? "Failed to start download job.", "error");
        return;
      }

      setDownloadJobs((prev) => ({ ...prev, [repoId]: started.job_id as string }));
      addToast(`Download started: ${repoId}`, "info");
    } catch (error) {
      clearDownloadUi(repoId);
      addToast(error instanceof Error ? error.message : "Download request failed", "error");
    }
  };

  useEffect(() => {
    if (hfAuth !== "ready") {
      setMyHubLoading(false);
      setMyHubDatasets([]);
      return;
    }

    let cancelled = false;
    setMyHubLoading(true);

    void apiGet<MyHubDatasetsResponse>("/api/hf/my-datasets?limit=50")
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          setMyHubDatasets(Array.isArray(res.datasets) ? res.datasets : []);
          setMyHubUsername(typeof res.username === "string" && res.username ? res.username : "lerobot-user");
          return;
        }
        setMyHubDatasets([]);
      })
      .catch(() => {
        if (cancelled) return;
        setMyHubDatasets([]);
      })
      .finally(() => {
        if (!cancelled) setMyHubLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [hfAuth, myHubReloadToken]);

  useEffect(() => {
    const jobs = Object.entries(downloadJobs);
    if (jobs.length === 0) return;

    let cancelled = false;

    const pollOnce = async () => {
      for (const [repoId, jobId] of jobs) {
        try {
          const status = await apiGet<HubDownloadStatusResponse>(`/api/hub/datasets/download/status/${encodeURIComponent(jobId)}`);

          if (!status.ok) {
            setDownloadJobs((prev) => {
              const next = { ...prev };
              delete next[repoId];
              return next;
            });
            clearDownloadUi(repoId);
            if (!cancelled) addToast(status.error ?? `Failed to check download status: ${repoId}`, "error");
            continue;
          }

          setDownloadProgress(repoId, status.progress);
          if (Array.isArray(status.logs) && status.logs.length > 0) {
            const tail = String(status.logs[status.logs.length - 1] ?? "").trim();
            if (tail) {
              setDownloadNotes((prev) => ({ ...prev, [repoId]: tail }));
            }
          }

          const phase = String(status.status ?? "running");
          if (phase === "success") {
            setDownloadJobs((prev) => {
              const next = { ...prev };
              delete next[repoId];
              return next;
            });
            setDownloadProgress(repoId, 100);
            if (!cancelled) addToast(`Download complete: ${repoId}`, "success");
            setMyHubReloadToken((prev) => prev + 1);
            window.setTimeout(() => {
              if (!cancelled) clearDownloadUi(repoId);
            }, 1200);
            continue;
          }

          if (phase === "error") {
            setDownloadJobs((prev) => {
              const next = { ...prev };
              delete next[repoId];
              return next;
            });
            clearDownloadUi(repoId);
            if (!cancelled) {
              addToast(status.error ?? `Download failed: ${repoId}`, "error");
            }
          }
        } catch (error) {
          setDownloadJobs((prev) => {
            const next = { ...prev };
            delete next[repoId];
            return next;
          });
          clearDownloadUi(repoId);
          if (!cancelled) {
            addToast(error instanceof Error ? error.message : `Failed to check download status: ${repoId}`, "error");
          }
        }
      }
    };

    void pollOnce();
    const timer = window.setInterval(() => {
      void pollOnce();
    }, 1200);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [addToast, downloadJobs]);

  return (
    <div className="flex flex-col gap-4">
      {/* Search Bar */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Hub — dataset ID, tags, keywords..."
            className="w-full h-9 pl-9 pr-3 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-sm outline-none placeholder:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 transition-all"
            onKeyDown={(e) => e.key === "Enter" && doSearch()}
          />
        </div>
        <button
          onClick={doSearch}
          className="px-4 h-9 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-zinc-50 dark:text-zinc-900 text-sm font-medium hover:opacity-90 transition-opacity"
        >
          Search
        </button>
      </div>

      {/* Search Results */}
      {searched && (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
            <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Search Results ({hubResults.length})</span>
            <button onClick={() => setSearched(false)} className="text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">Close</button>
          </div>
          <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {hubResults.length === 0 ? (
              <div className="px-4 py-6 text-sm text-zinc-400 text-center">No search results found.</div>
            ) : hubResults.map((r) => {
              const progress = downloading[r.id];
              const isDownloading = progress !== undefined;
              const note = downloadNotes[r.id];

              return (
                <div key={r.id} className="group relative flex items-center justify-between px-3 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors">
                  {isDownloading && (
                    <div
                      className="absolute inset-0 bg-emerald-500/5 dark:bg-emerald-500/10 z-0 pointer-events-none transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  )}

                  <div className="relative z-10 flex flex-col gap-1 min-w-0 flex-1 mr-4">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-medium text-blue-500 dark:text-blue-400">{r.id}</span>
                      {r.tags.map(tag => (
                        <span key={tag} className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-sm text-zinc-500 border border-zinc-200 dark:border-zinc-700">
                          {tag}
                        </span>
                      ))}
                    </div>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 truncate">{r.desc}</p>
                    {note && (
                      <p className="text-xs text-zinc-400 truncate">{note}</p>
                    )}
                    <div className="flex items-center gap-3 text-sm text-zinc-400 mt-0.5">
                      <span className="flex items-center gap-1"><Download size={10} /> {r.downloads.toLocaleString()}</span>
                      <span className="flex items-center gap-1"><Heart size={10} className="text-red-600 dark:text-red-400" /> {r.likes}</span>
                      <span>Updated {r.modified}</span>
                    </div>
                  </div>

                  <div className="relative z-10 flex-none">
                     {isDownloading ? (
                       <div className="flex items-center gap-2 px-4 py-2 rounded bg-zinc-100 dark:bg-zinc-800 text-sm font-mono text-zinc-500">
                         <span className="w-8 text-right">{progress}%</span>
                         <div className="w-16 h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
                           <div className="h-full bg-emerald-500 transition-all duration-300" style={{ width: `${progress}%` }} />
                         </div>
                       </div>
                     ) : (
                      <button
                        onClick={() => { void startDownload(r.id); }}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-sm font-medium text-zinc-700 dark:text-zinc-300 transition-colors"
                      >
                        <Download size={12} />
                        Download
                      </button>
                     )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* My Hub Datasets */}
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
        <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cloud size={13} className="text-zinc-400" />
            <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300">My Hub Datasets</span>
            <span className="text-sm text-zinc-400">{myHubDatasets.length} items</span>
          </div>
          <a href={`https://huggingface.co/${myHubUsername}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">
            Hub Profile <ExternalLink size={10} />
          </a>
        </div>
        <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {myHubLoading ? (
            <div className="px-4 py-6 text-sm text-zinc-400 text-center">Loading your Hub datasets...</div>
          ) : myHubDatasets.length === 0 ? (
            <div className="px-4 py-6 text-sm text-zinc-400 text-center">No Hub datasets found.</div>
          ) : myHubDatasets.map((ds) => (
            <div key={ds.id} className="flex items-center justify-between px-3 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors">
              <div className="flex flex-col gap-0.5 min-w-0 flex-1 mr-4">
                <div className="flex items-center gap-2">
                  <a href={`https://huggingface.co/datasets/${ds.id}`} target="_blank" rel="noopener noreferrer" className="font-mono text-sm font-medium text-blue-500 dark:text-blue-400 hover:underline">{ds.id}</a>
                  {ds.local_sync && (
                    <HardDrive size={14} className="text-emerald-500 dark:text-emerald-400 flex-none" title="Synced locally" />
                  )}
                </div>
                <div className="flex items-center gap-3 text-sm text-zinc-400">
                  <span className="flex items-center gap-1"><Download size={10} /> {ds.downloads}</span>
                  <span className="flex items-center gap-1"><Heart size={10} className="text-red-600 dark:text-red-400" /> {ds.likes}</span>
                  <span>{ds.size}</span>
                  <span>Updated {ds.modified}</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-none">
                {!ds.local_sync && (
                  <button
                    onClick={() => { void startDownload(ds.id); }}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-sm font-medium text-zinc-500 dark:text-zinc-400 transition-colors"
                  >
                    <Download size={12} /> Pull
                  </button>
                )}
                <a href={`https://huggingface.co/datasets/${ds.id}`} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">
                  <ExternalLink size={13} />
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// 2. Video Player Panel — real <video> elements with synchronized multi-cam playback
function VideoPlayerPanel({
  detail,
  datasetId,
  onTagsChanged,
  initialEpisode,
}: {
  detail: DatasetDetail;
  datasetId: string;
  onTagsChanged?: () => void;
  initialEpisode?: number;
}) {
  const addToast = useLeStudioStore((s) => s.addToast);
  const [selectedEpisode, setSelectedEpisode] = useState(detail.episodes[0]?.episode_index ?? 0);
  useEffect(() => { if (initialEpisode !== undefined) setSelectedEpisode(initialEpisode); }, [initialEpisode]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [episodeTags, setEpisodeTags] = useState<Record<string, TagType>>({});
  const [tagFilter, setTagFilter] = useState<string>("All");
  const [episodeQuery, setEpisodeQuery] = useState("");
  const [autoNext, setAutoNext] = useState(false);
  const videoContainerRef = useRef<HTMLDivElement>(null);

  // Refs to avoid stale closures in video event handlers
  const autoNextRef = useRef(false);
  const episodesRef = useRef(detail.episodes);
  const selectedEpisodeRef = useRef(selectedEpisode);
  useEffect(() => { autoNextRef.current = autoNext; }, [autoNext]);
  useEffect(() => { episodesRef.current = detail.episodes; }, [detail.episodes]);
  useEffect(() => { selectedEpisodeRef.current = selectedEpisode; }, [selectedEpisode]);
  const advanceToNextRef = useRef<() => void>(() => {});
  const shouldAutoPlayRef = useRef(false);
  useEffect(() => {
    advanceToNextRef.current = () => {
      const episodes = episodesRef.current;
      const current = selectedEpisodeRef.current;
      const idx = episodes.findIndex((ep) => ep.episode_index === current);
      if (idx >= 0 && idx < episodes.length - 1) {
        shouldAutoPlayRef.current = true;
        setSelectedEpisode(episodes[idx + 1].episode_index);
      } else {
        addToast('Last episode.', 'info');
      }
    };
  }, [addToast]);

  const parsedId = parseDatasetId(datasetId);
  const currentTag: TagType = (episodeTags[String(selectedEpisode)] as TagType) ?? "untagged";

  const filteredEpisodes = useMemo(() => {
    if (tagFilter === "All") return detail.episodes;
    return detail.episodes.filter((ep) => {
      const tag = episodeTags[String(ep.episode_index)] ?? "untagged";
      return tag === tagFilter;
    });
  }, [detail.episodes, tagFilter, episodeTags]);

  const searchedEpisodes = useMemo(() => {
    const q = episodeQuery.trim();
    if (!q) return filteredEpisodes;
    return filteredEpisodes.filter((ep) => String(ep.episode_index).includes(q));
  }, [filteredEpisodes, episodeQuery]);

  const selectedEpisodeData = useMemo(
    () => detail.episodes.find((ep) => ep.episode_index === selectedEpisode) ?? null,
    [detail.episodes, selectedEpisode],
  );

  const episodeTimeBounds = useMemo(() => {
    if (!selectedEpisodeData || !detail.cameras[0]) return { from: 0, to: null };
    const cam = detail.cameras[0];
    const meta = selectedEpisodeData.video_files?.[cam];
    return { from: meta?.from_timestamp ?? 0, to: meta?.to_timestamp ?? null };
  }, [selectedEpisodeData, detail.cameras]);

  // Load existing tags on mount
  useEffect(() => {
    if (!parsedId) return;
    apiGet<{ ok: boolean; tags: Record<string, TagType> }>(
      `/api/datasets/${encodeURIComponent(parsedId.user)}/${encodeURIComponent(parsedId.repo)}/tags`,
    ).then((res) => {
      if (res.ok) setEpisodeTags(res.tags ?? {});
    }).catch(() => { /* silent */ });
  }, [datasetId]); // eslint-disable-line react-hooks/exhaustive-deps

  const getAllVideos = (): HTMLVideoElement[] => {
    if (!videoContainerRef.current) return [];
    return Array.from(videoContainerRef.current.querySelectorAll("video.ds-video"));
  };

  const togglePlay = () => {
    const videos = getAllVideos();
    if (videos.length === 0) return;
    if (isPlaying) {
      videos.forEach((v) => v.pause());
      setIsPlaying(false);
      return;
    }
    const epFrom = episodeTimeBounds.from;
    if (videos[0].currentTime < epFrom) {
      videos.forEach((v) => { v.currentTime = epFrom; });
    }
    videos.forEach((v) => {
      v.playbackRate = playbackSpeed;
      void v.play().catch(() => setIsPlaying(false));
    });
    setIsPlaying(true);
  };

  const handleScrub = (value: number) => {
    const epFrom = episodeTimeBounds.from;
    const absTime = epFrom + Math.max(0, value);
    const videos = getAllVideos();
    videos.forEach((v) => {
      v.currentTime = Math.min(Number.isFinite(v.duration) ? v.duration : absTime, absTime);
    });
    setCurrentTime(Math.max(0, value));
  };

  const handleSpeedChange = (speed: number) => {
    setPlaybackSpeed(speed);
    getAllVideos().forEach((v) => { v.playbackRate = speed; });
  };

  // Wire up video event listeners when episode / cameras change
  useEffect(() => {
    const videos = getAllVideos();
    if (videos.length === 0) {
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      return;
    }
    const { from: epFrom, to: epTo } = episodeTimeBounds;
    videos.forEach((v) => { v.playbackRate = playbackSpeed; });
    const primary = videos[0];

    const seekToStart = () => {
      if (epFrom > 0) {
        primary.currentTime = epFrom;
        videos.slice(1).forEach((v) => { v.currentTime = epFrom; });
      }
      if (shouldAutoPlayRef.current) {
        shouldAutoPlayRef.current = false;
        videos.forEach((v) => { v.playbackRate = playbackSpeed; void v.play().catch(() => {}); });
        setIsPlaying(true);
      }
    };
    const syncFromPrimary = () => {
      const raw = primary.currentTime || 0;
      const relTime = Math.max(0, raw - epFrom);
      const epDuration = epTo !== null
        ? Math.max(0, epTo - epFrom)
        : (Number.isFinite(primary.duration) ? Math.max(0, primary.duration - epFrom) : 0);
      setCurrentTime(relTime);
      setDuration(epDuration);
      setIsPlaying(!primary.paused && !primary.ended);
    };
    const clampToEnd = () => {
      if (epTo !== null && primary.currentTime >= epTo) {
        primary.pause();
        videos.slice(1).forEach((v) => v.pause());
        setIsPlaying(false);
        if (autoNextRef.current) advanceToNextRef.current();
      }
    };
    const syncAcross = () => {
      const target = primary.currentTime || 0;
      videos.slice(1).forEach((v) => {
        if (Math.abs(v.currentTime - target) > 0.05) v.currentTime = target;
      });
    };

    primary.addEventListener("loadedmetadata", seekToStart);
    primary.addEventListener("loadedmetadata", syncFromPrimary);
    primary.addEventListener("durationchange", syncFromPrimary);
    primary.addEventListener("timeupdate", syncFromPrimary);
    primary.addEventListener("timeupdate", syncAcross);
    primary.addEventListener("timeupdate", clampToEnd);
    primary.addEventListener("play", syncFromPrimary);
    primary.addEventListener("pause", syncFromPrimary);
    const handleEnded = () => { syncFromPrimary(); if (autoNextRef.current) advanceToNextRef.current(); };
    primary.addEventListener("ended", handleEnded);
    syncFromPrimary();

    return () => {
      primary.removeEventListener("loadedmetadata", seekToStart);
      primary.removeEventListener("loadedmetadata", syncFromPrimary);
      primary.removeEventListener("durationchange", syncFromPrimary);
      primary.removeEventListener("timeupdate", syncFromPrimary);
      primary.removeEventListener("timeupdate", syncAcross);
      primary.removeEventListener("timeupdate", clampToEnd);
      primary.removeEventListener("play", syncFromPrimary);
      primary.removeEventListener("pause", syncFromPrimary);
      primary.removeEventListener("ended", handleEnded);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId, selectedEpisode, detail.cameras, playbackSpeed, episodeTimeBounds]);

  const formatTime = (seconds: number) => {
    const s = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toFixed(1).padStart(4, "0")}`;
  };

  const tagEpisode = async (tag: TagType) => {
    if (!parsedId) return;
    if (tag === "untagged") {
      setEpisodeTags((prev) => { const next = { ...prev }; delete next[String(selectedEpisode)]; return next; });
    } else {
      setEpisodeTags((prev) => ({ ...prev, [String(selectedEpisode)]: tag }));
    }
    try {
      await apiPost(`/api/datasets/${encodeURIComponent(parsedId.user)}/${encodeURIComponent(parsedId.repo)}/tags`, {
        episode_index: selectedEpisode,
        tag,
      });
      onTagsChanged?.();
    } catch (err) {
      addToast(`Tag failed: ${String(err)}`, "error");
    }
  };

  const epIndex = searchedEpisodes.findIndex((ep) => ep.episode_index === selectedEpisode);

  return (
    <div>
      {/* Player Info Bar */}
      <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 text-sm font-mono text-zinc-500">
            Episode <span className="text-zinc-900 dark:text-zinc-100 font-bold">{selectedEpisode}</span>
            <span className="text-zinc-400">/ {Math.max(0, searchedEpisodes.length - 1)}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              value={episodeQuery}
              onChange={(e) => setEpisodeQuery(e.target.value)}
              placeholder="Find episode..."
              className="pl-6 pr-2 py-1 h-7 w-36 text-sm rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 placeholder:text-zinc-400 outline-none hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-blue-500 dark:focus:border-blue-400 transition-colors"
            />
          </div>
          <div className="relative">
            <Filter size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400" />
            <select
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              className="pl-6 pr-2 py-1 h-7 text-sm rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 outline-none cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-blue-500 dark:focus:border-blue-400 transition-colors"
            >
              <option>All</option>
              <option>good</option>
              <option>bad</option>
              <option>review</option>
              <option>untagged</option>
            </select>
          </div>
          <div className="h-4 w-px bg-zinc-200 dark:bg-zinc-700 mx-1" />
          <button
            onClick={() => { if (epIndex > 0) setSelectedEpisode(searchedEpisodes[epIndex - 1].episode_index); }}
            disabled={epIndex <= 0}
            className="p-1 text-zinc-400 hover:text-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <SkipBack size={16} />
          </button>
          <button
            onClick={() => { if (epIndex < searchedEpisodes.length - 1) setSelectedEpisode(searchedEpisodes[epIndex + 1].episode_index); }}
            disabled={epIndex >= searchedEpisodes.length - 1}
            className="p-1 text-zinc-400 hover:text-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <SkipForward size={16} />
          </button>
        </div>
      </div>

      <div className="p-4 flex flex-col gap-4">
        {/* Video Grid */}
        <div
          ref={videoContainerRef}
          className={cn(
            "gap-2 bg-zinc-100 dark:bg-zinc-950 rounded-lg p-2 grid",
            detail.cameras.length === 1
              ? "grid-cols-1"
              : detail.cameras.length === 2
                ? "grid-cols-1 md:grid-cols-2"
                : detail.cameras.length === 3
                  ? "grid-cols-1 md:grid-cols-2 xl:grid-cols-3"
                  : "grid-cols-1 md:grid-cols-2 xl:grid-cols-4",
          )}
        >
          {detail.cameras.length === 0 ? (
            <div className="col-span-full text-center text-sm text-zinc-400 py-8">
              No video data in this dataset.
            </div>
          ) : detail.cameras.map((cam) => {
            if (!parsedId) return null;
            const videoMeta = selectedEpisodeData?.video_files?.[cam];
            const chunk = `chunk-${String(Math.max(0, Number(videoMeta?.chunk_index ?? 0))).padStart(3, "0")}`;
            const file = `file-${String(Math.max(0, Number(videoMeta?.file_index ?? 0))).padStart(3, "0")}.mp4`;
            const src = `/api/datasets/${encodeURIComponent(parsedId.user)}/${encodeURIComponent(parsedId.repo)}/videos/${encodeURIComponent(cam)}/${encodeURIComponent(chunk)}/${encodeURIComponent(file)}`;
            return (
              <div key={cam} className="relative bg-zinc-800 rounded border border-zinc-700 overflow-hidden aspect-video">
                <div className="absolute top-2 left-2 z-10 px-1.5 py-0.5 bg-black/50 backdrop-blur rounded text-[10px] font-mono text-zinc-300">
                  {cam}
                </div>
                <video
                  key={`${cam}-ep${selectedEpisode}`}
                  className="ds-video w-full h-full object-contain"
                  src={src}
                  preload="metadata"
                  playsInline
                />
              </div>
            );
          })}
        </div>

        {/* Controls Bar */}
        <div className="flex flex-col gap-2">
          {/* Scrubber */}
          <div className="flex items-center gap-3">
            <span className="text-sm font-mono text-zinc-400 w-12 text-right">{formatTime(currentTime)}</span>
            {/* Custom styled track with overlay range input for interaction */}
            <div className="relative flex-1 h-3 flex items-center group">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-zinc-900 dark:bg-zinc-100 transition-none"
                    style={{ width: `${duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0}%` }}
                  />
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(duration, 0.01)}
                value={Math.min(currentTime, Math.max(duration, 0))}
                step={0.01}
                onChange={(e) => handleScrub(Number(e.target.value))}
                className="absolute inset-0 w-full opacity-0 cursor-pointer"
              />
            </div>
            <span className="text-sm font-mono text-zinc-400 w-12">{formatTime(duration)}</span>
          </div>

          {/* Action Buttons Row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <button
                onClick={togglePlay}
                className="p-2 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-colors"
              >
                {isPlaying ? <Pause size={18} /> : <Play size={18} />}
              </button>
              <div className="h-4 w-px bg-zinc-200 dark:bg-zinc-700 mx-2" />
              <div className="flex gap-1 bg-zinc-100 dark:bg-zinc-800 p-0.5 rounded-md">
                {[0.5, 1, 2].map((speed) => (
                  <button
                    key={speed}
                    onClick={() => handleSpeedChange(speed)}
                    className={cn(
                      "px-2 py-0.5 text-sm font-medium rounded transition-all",
                      playbackSpeed === speed
                        ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm"
                        : "text-zinc-400 hover:text-zinc-600",
                    )}
                  >
                    {speed}x
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={() => { void tagEpisode("good"); }}
                className={cn("p-1.5 rounded transition-colors", currentTag === "good" ? "text-emerald-500 dark:text-emerald-400" : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300")}
                title="Good"
              >
                <ThumbsUp size={14} />
              </button>
              <button
                onClick={() => { void tagEpisode("bad"); }}
                className={cn("p-1.5 rounded transition-colors", currentTag === "bad" ? "text-red-500 dark:text-red-400" : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300")}
                title="Bad"
              >
                <ThumbsDown size={14} />
              </button>
              <button
                onClick={() => { void tagEpisode("review"); }}
                className={cn("p-1.5 rounded transition-colors", currentTag === "review" ? "text-amber-500 dark:text-amber-400" : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300")}
                title="Review"
              >
                <FileWarning size={14} />
              </button>
              {currentTag !== "untagged" && (
                <button onClick={() => { void tagEpisode("untagged"); }} className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors" title="Clear Tag">
                  <Trash2 size={14} />
                </button>
              )}
              <div className="h-4 w-px bg-zinc-200 dark:bg-zinc-700 mx-1" />
              <WireToggle label="Auto-next" checked={autoNext} onChange={setAutoNext} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AutoFlagPanelContent({
  datasetId,
  totalEpisodes,
  tags,
  onTagsChanged,
  onPreviewEpisode,
}: {
  datasetId: string;
  totalEpisodes: number;
  tags: Record<string, TagType>;
  onTagsChanged: () => void;
  onPreviewEpisode?: (episodeIndex: number) => void;
}) {
  const addToast = useLeStudioStore((s) => s.addToast);
  const parsed = parseDatasetId(datasetId);
  const [stats, setStats] = useState<EpisodeStat[]>([]);
  const [jobId, setJobId] = useState("");
  const [jobProgress, setJobProgress] = useState(0);
  const [jobPhase, setJobPhase] = useState("idle");
  const [tagging, setTagging] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const didAutoRun = useRef(false);

  const flagged = useMemo(
    () => stats.filter((ep) => ep.frames < 30 || ep.movement < 0.01 || ep.jerk_score > 5),
    [stats],
  );

  const pendingFlagged = useMemo(
    () => flagged.filter((ep) => tags[String(ep.episode_index)] !== "bad"),
    [flagged, tags],
  );

  const fetchStats = async (): Promise<boolean> => {
    if (!parsed) return false;
    const res = await apiGet<DatasetStatsResponse>(
      `/api/datasets/${encodeURIComponent(parsed.user)}/${encodeURIComponent(parsed.repo)}/stats`,
    );
    if (!res.ok || !Array.isArray(res.episodes)) {
      return false;
    }
    setStats(res.episodes);
    return res.episodes.length > 0;
  };

  const handleRecompute = async () => {
    if (!parsed) return;
    try {
      const res = await apiPost<StatsRecomputeResponse>(
        `/api/datasets/${encodeURIComponent(parsed.user)}/${encodeURIComponent(parsed.repo)}/stats/recompute`,
        { force: true },
      );
      if (!res.ok) {
        addToast(res.error ?? "Failed to recompute stats", "error");
        return;
      }
      if (!res.job_id) {
        await fetchStats();
        return;
      }
      setJobId(res.job_id);
      setJobProgress(0);
      setJobPhase("queued");
    } catch (error) {
      addToast(error instanceof Error ? error.message : "Failed to recompute stats", "error");
    }
  };

  const handleBulkTag = async () => {
    if (!parsed || pendingFlagged.length === 0) return;
    setTagging(true);
    try {
      const updates = pendingFlagged.map((ep) => ({ episode_index: ep.episode_index, tag: "bad" as const }));
      const res = await apiPost<BulkTagsResponse>(
        `/api/datasets/${encodeURIComponent(parsed.user)}/${encodeURIComponent(parsed.repo)}/tags/bulk`,
        { updates },
      );
      if (!res.ok) {
        addToast(res.error ?? "Bulk tagging failed", "error");
        return;
      }
      addToast(`Bulk tagging complete: ${res.applied ?? pendingFlagged.length} episodes`, "success");
      onTagsChanged();
    } catch (error) {
      addToast(error instanceof Error ? error.message : "Bulk tagging failed", "error");
    } finally {
      setTagging(false);
    }
  };

  const handleSingleTag = async (episodeIndex: number, tag: TagType) => {
    if (!parsed) return;
    try {
      await apiPost(`/api/datasets/${encodeURIComponent(parsed.user)}/${encodeURIComponent(parsed.repo)}/tags`, { episode_index: episodeIndex, tag });
      onTagsChanged();
    } catch (err) {
      addToast(`Tag failed: ${String(err)}`, "error");
    }
  };

  const handleDismiss = async (episodeIndex: number) => { await handleSingleTag(episodeIndex, "good"); };

  const getViolations = (ep: EpisodeStat) => {
    const v: string[] = [];
    if (ep.frames < 30) v.push("frames");
    if (ep.movement < 0.01) v.push("motion");
    if (ep.jerk_score > 5) v.push("jerk");
    return v;
  };

  const handleCancelJob = async () => {
    if (!jobId) return;
    await apiPost(`/api/datasets/stats/cancel/${encodeURIComponent(jobId)}`);
  };

  useEffect(() => {
    if (!jobId) return;
    const timer = window.setInterval(async () => {
      const status = await apiGet<StatsStatusResponse>(`/api/datasets/stats/status/${encodeURIComponent(jobId)}`);
      if (!status.ok) {
        setJobId("");
        addToast(status.error ?? "Stats job failed", "error");
        return;
      }
      const state = String(status.status ?? "running");
      setJobPhase(String(status.phase ?? state));
      setJobProgress(Math.max(0, Math.min(100, Number(status.progress ?? 0))));
      if (state === "success") {
        setJobId("");
        void fetchStats();
      }
      if (state === "error" || state === "cancelled") {
        setJobId("");
      }
    }, 1200);
    return () => window.clearInterval(timer);
  }, [addToast, jobId]);

  // Auto-run on tab mount: try cached stats first, if none then recompute
  useEffect(() => {
    if (didAutoRun.current || !parsed) return;
    didAutoRun.current = true;
    (async () => {
      const hasCached = await fetchStats();
      if (!hasCached) {
        await handleRecompute();
      }
      setInitialLoading(false);
    })();
  }, [parsed]);

  return (
    <div className="p-4 flex flex-col gap-4">
      {/* Loading / computing state */}
      {(initialLoading || jobId) && (
        <div className="flex flex-col items-center justify-center py-8 gap-3">
          <RefreshCw size={20} className="text-zinc-400 animate-spin" />
          <span className="text-sm text-zinc-500">
            {jobId ? `${jobPhase}… ${jobProgress}%` : "Loading stats…"}
          </span>
          {jobId && (
            <button
              onClick={() => { void handleCancelJob(); }}
              className="px-3 py-1.5 text-xs rounded border border-red-500/30 text-red-500 hover:bg-red-500/10"
            >
              Cancel
            </button>
          )}
        </div>
      )}

      {/* Results */}
      {!initialLoading && !jobId && (
        <>
          {/* Criteria pills */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-zinc-500">Criteria</span>
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700"><Film size={10} /> frames &lt; 30</span>
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700"><Activity size={10} /> motion &lt; 0.01</span>
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700"><Zap size={10} /> jerk &gt; 5.0</span>
            <div className="flex-1" />
            <button
              onClick={() => { void handleRecompute(); }}
              className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
              title="Recompute Stats"
            >
              <RefreshCw size={14} />
            </button>
          </div>

          {flagged.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 size={14} />
              All {totalEpisodes} episodes passed
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {/* Progress bar */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{flagged.length} / {totalEpisodes} flagged</span>
                  <span className="text-sm text-zinc-400">{pendingFlagged.length} unreviewed</span>
                </div>
                <div className="h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                  <div className="h-full rounded-full bg-emerald-400 dark:bg-emerald-500 transition-all" style={{ width: `${((flagged.length - pendingFlagged.length) / flagged.length) * 100}%` }} />
                </div>
              </div>

              {/* Episode cards */}
              <div className="max-h-64 overflow-auto space-y-2">
                {flagged.map((ep) => (
                  <div key={ep.episode_index} className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-2.5 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Ep {ep.episode_index}</span>
                        {getViolations(ep).map((v) => (
                          <span key={v} className="text-amber-500 dark:text-amber-400" title={v}>
                            {v === "frames" && <Film size={12} />}
                            {v === "motion" && <Activity size={12} />}
                            {v === "jerk" && <Zap size={12} />}
                          </span>
                        ))}
                        {tags[String(ep.episode_index)] === "bad" && (
                          <ThumbsDown size={12} className="text-zinc-400" />
                        )}
                        {tags[String(ep.episode_index)] === "good" && (
                          <ThumbsUp size={12} className="text-emerald-500" />
                        )}
                      </div>
                      <div className="text-xs text-zinc-400">{ep.frames} frames · motion {ep.movement.toFixed(3)} · jerk {ep.jerk_score.toFixed(3)}</div>
                    </div>
                    <div className="flex items-center gap-1 flex-none">
                      {onPreviewEpisode && (
                        <button onClick={() => onPreviewEpisode(ep.episode_index)} className="p-1.5 rounded text-zinc-400 hover:text-blue-500 hover:bg-blue-500/10 transition-colors cursor-pointer" title="Preview in Playback">
                          <Play size={12} />
                        </button>
                      )}
                      {tags[String(ep.episode_index)] !== "bad" && tags[String(ep.episode_index)] !== "good" && (
                        <>
                          <button onClick={() => { void handleSingleTag(ep.episode_index, "bad"); }} className="p-1.5 rounded text-zinc-400 hover:text-zinc-600 hover:bg-zinc-500/10 transition-colors cursor-pointer" title="Tag as Bad">
                            <ThumbsDown size={12} />
                          </button>
                          <button onClick={() => { void handleDismiss(ep.episode_index); }} className="p-1.5 rounded text-zinc-400 hover:text-emerald-500 hover:bg-emerald-500/10 transition-colors cursor-pointer" title="Dismiss (not bad)">
                            <ThumbsUp size={12} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Bottom action / completion signal */}
              {pendingFlagged.length === 0 ? (
                <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400 py-2">
                  <CheckCircle2 size={14} />
                  All flagged episodes reviewed
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => { void handleBulkTag(); }}
                  disabled={tagging}
                  className="w-full py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
                >
                  {tagging ? "Tagging..." : `Bulk tag ${pendingFlagged.length} remaining as Bad`}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CurationPanelContent({
  datasetId,
  detail,
  tags,
  onDerived,
}: {
  datasetId: string;
  detail: DatasetDetail;
  tags: Record<string, TagType>;
  onDerived: (newRepoId: string) => void;
}) {
  const addToast = useLeStudioStore((s) => s.addToast);
  const hfUsername = useLeStudioStore((s) => s.hfUsername);
  const parsed = parseDatasetId(datasetId);
  const defaultRepoId = `${hfUsername ?? "lerobot-user"}/${parsed.repo}_curated_v1`;
  const [deriveMode, setDeriveMode] = useState<"filter" | "good" | "exclude_bad">("good");
  const [newRepoId, setNewRepoId] = useState(defaultRepoId);
  const [jobId, setJobId] = useState("");
  const [job, setJob] = useState<DeriveStatusResponse | null>(null);

  const keepIndices = useMemo(() => {
    if (deriveMode === "filter") return detail.episodes.map((ep) => ep.episode_index);
    if (deriveMode === "good") {
      return detail.episodes
        .filter((ep) => tags[String(ep.episode_index)] === "good")
        .map((ep) => ep.episode_index);
    }
    return detail.episodes
      .filter((ep) => tags[String(ep.episode_index)] !== "bad")
      .map((ep) => ep.episode_index);
  }, [deriveMode, detail.episodes, tags]);

  const handleStartDerive = async () => {
    if (!parsed) return;
    try {
      const target = newRepoId.trim();
      if (!target) {
        addToast("Enter a new Repo ID", "error");
        return;
      }
      const res = await apiPost<DeriveStartResponse>(
        `/api/datasets/${encodeURIComponent(parsed.user)}/${encodeURIComponent(parsed.repo)}/derive`,
        { new_repo_id: target, keep_indices: keepIndices },
      );
      if (!res.ok || !res.job_id) {
        addToast(res.error ?? "Failed to start derive", "error");
        return;
      }
      setJobId(res.job_id);
      setJob({ status: "queued", phase: "queued", progress: 0, logs: [] });
      addToast("Creating derived dataset", "info");
    } catch (error) {
      addToast(error instanceof Error ? error.message : "Failed to start derive", "error");
    }
  };

  const handleCancel = async () => {
    if (!jobId) return;
    await apiPost(`/api/datasets/derive/cancel/${encodeURIComponent(jobId)}`);
  };

  useEffect(() => {
    if (!jobId) return;
    const timer = window.setInterval(async () => {
      const res = await apiGet<DeriveStatusResponse>(`/api/datasets/derive/status/${encodeURIComponent(jobId)}`);
      if (!res.ok) {
        setJobId("");
        addToast(res.error ?? "Failed to check derive status", "error");
        return;
      }
      setJob(res);
      const status = String(res.status ?? "running");
      if (status === "success") {
        setJobId("");
        addToast("Derived dataset created successfully", "success");
        onDerived(newRepoId.trim());
      }
      if (status === "error" || status === "cancelled") {
        setJobId("");
      }
    }, 1200);
    return () => window.clearInterval(timer);
  }, [addToast, jobId, newRepoId, onDerived]);

  const running = Boolean(jobId);

  return (
    <div className="p-4 flex flex-col gap-3">
      {/* Row 1: Filter mode + Keep/Drop stats */}
      <div className="flex flex-col md:flex-row md:items-center gap-4">
        <div className="flex gap-1 bg-zinc-100 dark:bg-zinc-800/50 p-1 rounded-lg flex-1">
          {[
            { key: "filter", label: "Current Filter" },
            { key: "good", label: "Good Only" },
            { key: "exclude_bad", label: "Exclude Bad" },
          ].map((opt) => (
            <button
              key={opt.key}
              onClick={() => {
                if (!running) setDeriveMode(opt.key as "filter" | "good" | "exclude_bad");
              }}
              className={cn(
                "flex-1 px-3.5 py-1.5 rounded-md text-sm font-medium transition-all cursor-pointer",
                deriveMode === opt.key
                  ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="flex gap-4 text-sm px-2 md:px-0 justify-end md:justify-start flex-shrink-0">
          <span className="text-zinc-700 dark:text-zinc-300 font-medium">Keep: {keepIndices.length} eps</span>
          <span className="text-zinc-400 font-medium">Drop: {Math.max(0, detail.total_episodes - keepIndices.length)} eps</span>
        </div>
      </div>

      {/* Job progress */}
      {job && (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {running && <Loader2 size={12} className="text-zinc-400 animate-spin" />}
              {!running && String(job.status) === "success" && <CheckCircle2 size={12} className="text-emerald-400" />}
              <span className="text-sm text-zinc-500">{job.phase ?? job.status ?? "running"}</span>
            </div>
            <span className="text-sm text-zinc-400 font-mono">{Number(job.progress ?? 0)}%</span>
          </div>
          <div className="px-3 py-1">
            <div className="h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
              <div className="h-full rounded-full bg-zinc-800 dark:bg-zinc-200" style={{ width: `${Math.max(0, Math.min(100, Number(job.progress ?? 0)))}%` }} />
            </div>
          </div>
          <div className="px-3 py-2 max-h-28 overflow-y-auto font-mono text-sm text-zinc-500 space-y-0.5">
            {(job.logs ?? []).slice(-8).map((log, i) => <div key={`${i}-${log}`}>{log}</div>)}
            {job.error && <div className="text-red-500">{job.error}</div>}
          </div>
          {running && (
            <div className="px-3 py-2 border-t border-zinc-100 dark:border-zinc-800/50">
              <button onClick={() => { void handleCancel(); }} className="flex items-center gap-1 text-sm text-red-500 hover:text-red-400">
                <Square size={10} /> Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {/* Row 2: Repo ID + Create button */}
      <div className="flex flex-col md:flex-row md:items-end gap-2">
        <div className="flex-1">
          <FieldRow label="New Repo ID">
            <WireInput
              value={newRepoId}
              onChange={(v) => {
                if (!running) setNewRepoId(v);
              }}
              placeholder={defaultRepoId}
            />
          </FieldRow>
        </div>
        <button
          onClick={() => { void handleStartDerive(); }}
          disabled={running || keepIndices.length === 0 || keepIndices.length >= detail.total_episodes}
          className={cn(
            "px-6 py-2 rounded-lg text-sm font-medium whitespace-nowrap flex-shrink-0",
            running
              ? "bg-zinc-300 dark:bg-zinc-700 text-zinc-500 cursor-not-allowed"
              : "bg-zinc-900 dark:bg-zinc-100 text-zinc-50 dark:text-zinc-900 hover:opacity-90",
          )}
        >
          Create Derived Dataset
        </button>
      </div>
    </div>
  );
}


// ─── Main Component ──────────────────────────────────────────────────────────

export function DatasetManagement() {
  const { hfAuth } = useHfAuth();
  const addToast = useLeStudioStore((s) => s.addToast);
  const [pageTab, setPageTab] = useState<"local" | "hub">("local");
  const [localDatasets, setLocalDatasets] = useState<LocalDataset[]>([]);
  const [selectedDataset, setSelectedDataset] = useState<LocalDataset | null>(null);
  const [detailData, setDetailData] = useState<DatasetDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [qualityData, setQualityData] = useState<DatasetQualityResponse | null>(null);
  const [qualityLoading, setQualityLoading] = useState(false);
  const [datasetTags, setDatasetTags] = useState<Record<string, TagType>>({});
  const [deletingDatasetId, setDeletingDatasetId] = useState<string | null>(null);
  const [pushJobId, setPushJobId] = useState("");
  const [pushStatus, setPushStatus] = useState<DatasetPushStatusResponse | null>(null);
  const [detailTab, setDetailTab] = useState<"player" | "quality" | "curation">("player");
  const [jumpEpisode, setJumpEpisode] = useState<number | undefined>(undefined);

  const fetchDetail = async (datasetId: string) => {
    const parsed = parseDatasetId(datasetId);
    if (!parsed) return;
    setDetailLoading(true);
    setDetailData(null);
    try {
      const detail = await apiGet<DatasetDetail>(
        `/api/datasets/${encodeURIComponent(parsed.user)}/${encodeURIComponent(parsed.repo)}`,
      );
      if (Array.isArray(detail?.cameras)) setDetailData(detail);
    } catch {
      /* silent — player will show error state */
    } finally {
      setDetailLoading(false);
    }
  };

  const loadDatasets = async () => {
    apiGet<unknown>("/api/datasets").then((res) => {
      const datasets = fromBackendDatasetList(res);
      setLocalDatasets(datasets);
      if (datasets.length > 0) {
        setSelectedDataset(datasets[0]);
        void fetchDetail(datasets[0].id);
      } else {
        setSelectedDataset(null);
        setDetailData(null);
        setQualityData(null);
        setDatasetTags({});
        setPushJobId("");
        setPushStatus(null);
      }
    });
  };

  useEffect(() => {
    void loadDatasets();
    apiGet<unknown>("/api/datasets").then((res) => {
      const datasets = fromBackendDatasetList(res);
      setLocalDatasets(datasets);
      if (datasets.length > 0) {
        setSelectedDataset(datasets[0]);
        void fetchDetail(datasets[0].id);
      }
    });
  }, []);

  const selectDataset = (ds: LocalDataset) => {
    setSelectedDataset(ds);
    setQualityData(null);
    setPushJobId("");
    setPushStatus(null);
    setDatasetTags({});
    void fetchDetail(ds.id);
  };

  const refreshDatasetTags = async (datasetId: string) => {
    const parsed = parseDatasetId(datasetId);
    if (!parsed) return;
    try {
      const tagRes = await apiGet<TagsResponse>(
        `/api/datasets/${encodeURIComponent(parsed.user)}/${encodeURIComponent(parsed.repo)}/tags`,
      );
      setDatasetTags(tagRes.ok ? (tagRes.tags ?? {}) : {});
    } catch {
      setDatasetTags({});
    }
  };

  useEffect(() => {
    if (!selectedDataset) return;
    void refreshDatasetTags(selectedDataset.id);
  }, [selectedDataset?.id]);

  const handleInspectQuality = async () => {
    if (!selectedDataset) return;
    const parsed = parseDatasetId(selectedDataset.id);
    if (!parsed) return;
    setQualityLoading(true);
    try {
      const res = await apiGet<DatasetQualityResponse>(
        `/api/datasets/${encodeURIComponent(parsed.user)}/${encodeURIComponent(parsed.repo)}/quality`,
      );
      if (!res.ok) {
        addToast(res.error ?? "Quality check failed", "error");
        return;
      }
      setQualityData(res);
      addToast("Quality check complete", "success");
    } catch (error) {
      addToast(error instanceof Error ? error.message : "Quality check failed", "error");
    } finally {
      setQualityLoading(false);
    }
  };

  const handlePushToHub = async () => {
    if (!selectedDataset || hfAuth !== "ready") return;
    const parsed = parseDatasetId(selectedDataset.id);
    if (!parsed) return;
    try {
      const res = await apiPost<DatasetPushStartResponse>(
        `/api/datasets/${encodeURIComponent(parsed.user)}/${encodeURIComponent(parsed.repo)}/push`,
        { target_repo_id: selectedDataset.id },
      );
      if (!res.ok || !res.job_id) {
        addToast(res.error ?? "Failed to start Hub push", "error");
        setPushStatus({ status: "error", phase: "error", progress: 0, error: res.error });
        return;
      }
      setPushJobId(res.job_id);
      setPushStatus({ status: "queued", phase: "queued", progress: 5, logs: ["Upload job queued"] });
      addToast("Hub push started", "info");
    } catch (error) {
      addToast(error instanceof Error ? error.message : "Failed to start Hub push", "error");
    }
  };

  const handleDeleteDataset = async (datasetId: string) => {
    if (deletingDatasetId) return;
    const parsed = parseDatasetId(datasetId);
    if (!parsed) return;

    const confirmed = window.confirm(
      `Delete local dataset "${datasetId}"?\n\nThis will remove the local cache files permanently.`,
    );
    if (!confirmed) return;

    setDeletingDatasetId(datasetId);
    try {
      const res = await apiDelete<DatasetDeleteResponse>(
        `/api/datasets/${encodeURIComponent(parsed.user)}/${encodeURIComponent(parsed.repo)}`,
      );
      if (!res.ok) {
        addToast(res.detail ?? res.error ?? "Failed to delete dataset", "error");
        return;
      }

      addToast(`Deleted: ${datasetId}`, "success");

      if (selectedDataset?.id === datasetId) {
        setSelectedDataset(null);
        setDetailData(null);
        setQualityData(null);
        setDatasetTags({});
      }

      await loadDatasets();
    } catch (error) {
      addToast(error instanceof Error ? error.message : "Failed to delete dataset", "error");
    } finally {
      setDeletingDatasetId(null);
    }
  };

  useEffect(() => {
    if (!pushJobId) return;
    const timer = window.setInterval(async () => {
      const status = await apiGet<DatasetPushStatusResponse>(`/api/datasets/push/status/${encodeURIComponent(pushJobId)}`);
      if (!status.ok) {
        setPushStatus({ status: "error", phase: "error", progress: 0, error: status.error });
        setPushJobId("");
        return;
      }
      setPushStatus(status);
      const s = String(status.status ?? "running");
      if (s === "success" || s === "error") {
        setPushJobId("");
      }
    }, 1200);
    return () => window.clearInterval(timer);
  }, [pushJobId]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 max-w-[1600px] mx-auto flex flex-col gap-6">
          <PageHeader
            title="Dataset Management"
            subtitle="Manage datasets, quality checks, Hub integration, and curation"
            action={<RefreshButton onClick={() => { void loadDatasets(); }} />}
          />

          {/* Page-level Tabs */}
          <SubTabs
            tabs={[
              { key: "local", icon: <MonitorPlay size={13} />, label: "Local Datasets" },
              { key: "hub", icon: <Download size={13} />, label: "Hub Download" },
            ]}
            activeKey={pageTab}
            onChange={(k) => setPageTab(k as "local" | "hub")}
            className="mx-auto"
          />

          {/* Hub Download Tab */}
          {pageTab === "hub" && (
            <div className="flex flex-col gap-4">
              {hfAuth !== "ready" && (
                <HfGateBanner authState={hfAuth} level="hf_read" />
              )}
              <HubSearchPanel />
            </div>
          )}

          {/* Local Dataset Tab */}
          {pageTab === "local" && (
          <div className="grid grid-cols-1 xl:grid-cols-[320px_1fr] gap-6 items-start">

            {/* Left Column: List (Fixed 320px) */}
            <div className="flex w-full flex-col gap-4 xl:sticky xl:top-6">
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
                <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Local Datasets</span>
                  <span className="text-sm text-zinc-400">{localDatasets.length} items</span>
                </div>
                <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {localDatasets.map((ds) => (
                    <div
                      key={ds.id}
                      onClick={() => selectDataset(ds)}
                      className={cn(
                        "group flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors",
                        selectedDataset?.id === ds.id
                          ? "bg-blue-50/50 dark:bg-blue-900/20"
                          : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50",
                      )}
                    >
                      {selectedDataset?.id === ds.id
                        ? <div className="w-1 h-6 rounded-full bg-blue-500 flex-none" />
                        : <div className="w-1 h-6 rounded-full bg-transparent flex-none" />
                      }
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">
                          {ds.id.split("/")[1]}
                        </div>
                        <div className="text-sm text-zinc-400 mt-0.5">
                          {ds.episodes} eps · {ds.frames} frames · {ds.size}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDeleteDataset(ds.id);
                        }}
                        disabled={deletingDatasetId === ds.id}
                        className="p-1 rounded text-zinc-400 hover:text-red-500 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 transition-all flex-none disabled:opacity-40 disabled:cursor-not-allowed"
                        title="Delete"
                        aria-label={`Delete ${ds.id}`}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
                {/* Add link */}
                <div className="px-3 py-2.5 border-t border-zinc-200 dark:border-zinc-800 text-center">
                  <Link to="/recording" className="text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:underline">
                    + Record new dataset
                  </Link>
                </div>
              </div>
            </div>

            {/* Right Column: Detail (Fluid) */}
            <div className="flex flex-col gap-6">

              {/* Dataset Header / Actions */}
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
                {!selectedDataset ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
                    <Search size={28} className="text-zinc-300 dark:text-zinc-600" />
                    <p className="text-sm text-zinc-400">Select a dataset to view details.</p>
                  </div>
                ) : (<>
                {/* Header bar: title + actions */}
                <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium font-mono text-zinc-700 dark:text-zinc-200 truncate">{selectedDataset?.id}</span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-none">
                    {hfAuth === "ready" ? (
                      <button
                        onClick={() => { void handlePushToHub(); }}
                        disabled={!selectedDataset}
                        className="p-1.5 rounded-md bg-zinc-900 dark:bg-zinc-100 text-zinc-50 dark:text-zinc-900 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                        title="Upload to Hub"
                        aria-label="Upload to Hub"
                      >
                        <Upload size={12} />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        if (selectedDataset?.id) {
                          void handleDeleteDataset(selectedDataset.id);
                        }
                      }}
                      disabled={!selectedDataset}
                      className="p-1 rounded text-zinc-400 hover:text-red-500 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-zinc-400 transition-colors"
                      title="Delete dataset"
                      aria-label="Delete dataset"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                {/* Sub-tabs */}
                <div className="px-2 pt-2">
                  <SubTabs
                    tabs={[
                      { key: "player", icon: <Play size={12} />, label: "Playback" },
                      { key: "quality", icon: <AlertTriangle size={12} />, label: "Quality Check" },
                      { key: "curation", icon: <Filter size={12} />, label: "Curation" },
                    ]}
                    activeKey={detailTab}
                    onChange={(k) => setDetailTab(k as "player" | "quality" | "curation")}
                  />
                </div>
                {/* Info row */}
                <div className="px-3 py-2.5 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800">
                  <div className="flex items-center gap-4 text-sm text-zinc-500">
                    <span className="flex items-center gap-1"><MonitorPlay size={12} /> {formatMetric(selectedDataset?.episodes, "eps")}</span>
                    <span>{formatMetric(selectedDataset?.frames, "frames")}</span>
                    <span>{formatMetric(detailData?.fps, "FPS")}</span>
                    <span>{selectedDataset?.size}</span>
                    <span className="text-zinc-400">{selectedDataset?.modified}</span>
                  </div>
                  <div className="flex gap-1.5">
                    {(selectedDataset?.tags ?? []).map(t => (
                      <span key={t} className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-sm text-zinc-500 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700">{t}</span>
                    ))}
                  </div>
                </div>

                {/* Hub Push Status */}
                {pushStatus && (
                   <div className="px-3 py-2.5 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/30 animate-in slide-in-from-top-2">
                     <div className="flex justify-between text-sm mb-2">
                       <span className="font-medium text-zinc-700 dark:text-zinc-300 flex items-center gap-2">
                         {String(pushStatus.status ?? "running") === "success" ? <CheckCircle2 size={12} /> : <Upload size={12} className="animate-bounce" />}
                         {String(pushStatus.status ?? "running") === "success" ? "Upload Complete" : `Pushing to Hugging Face Hub... (${pushStatus.phase ?? "running"})`}
                       </span>
                       <span className="text-zinc-500">{Math.max(0, Math.min(100, Number(pushStatus.progress ?? 0)))}%</span>
                     </div>
                     <div className="h-2 w-full bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
                       <div
                         className="h-full bg-emerald-500 transition-all duration-300 ease-out"
                         style={{ width: `${Math.max(0, Math.min(100, Number(pushStatus.progress ?? 0)))}%` }}
                       />
                     </div>
                     {pushStatus.error && (
                       <div className="text-xs text-red-500 mt-2">{pushStatus.error}</div>
                     )}
                   </div>
                )}

                {/* Quality Check Results */}
                {qualityData && (
                  <div className="px-3 py-3 border-t border-zinc-200 dark:border-zinc-800 animate-in slide-in-from-top-2">
                     <div className="flex items-center gap-4 mb-4">
                       <div className="flex flex-col items-center justify-center w-16 h-16 rounded-full bg-emerald-50 border-4 border-emerald-100 text-emerald-600">
                         <span className="text-xl font-bold">{Math.max(0, Math.min(100, Number(qualityData.score ?? 0)))}</span>
                         <span className="text-[9px] uppercase font-bold text-emerald-600 dark:text-emerald-400">Score</span>
                       </div>
                       <div className="flex-1">
                         <h4 className="font-medium text-sm text-zinc-800 dark:text-zinc-200">Quality Assessment Report</h4>
                         <p className="text-sm text-zinc-500 mt-0.5">Checked {Array.isArray(qualityData.checks) ? qualityData.checks.length : 0} items across {selectedDataset?.episodes} episodes.</p>
                       </div>
                       <Link to="/training" className="text-sm px-4 py-2 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded-lg border border-zinc-200 dark:border-zinc-700 font-medium hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
                         → Go to AI Training
                       </Link>
                     </div>

                     <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                       {(qualityData.checks ?? []).map((item, idx) => (
                         <div key={`${item.name ?? "check"}-${idx}`} className="flex items-start gap-3 p-2 rounded bg-zinc-50 dark:bg-zinc-800/50">
                            {item.level === "ok" ? <CheckCircle2 size={14} className="text-emerald-500 mt-0.5" /> : <AlertTriangle size={14} className="text-amber-500 mt-0.5" />}
                            <div>
                              <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{item.name ?? `check-${idx}`}</div>
                              <div className="text-sm text-zinc-500">{item.message ?? ""}</div>
                            </div>
                         </div>
                       ))}
                     </div>
                  </div>
                )}

                {detailTab === "player" && selectedDataset && (
                  detailLoading ? (
                    <div className="p-8 flex items-center justify-center gap-2 text-sm text-zinc-400">
                      <Loader2 size={14} className="animate-spin" /> Loading episode data...
                    </div>
                  ) : detailData ? (
                    <VideoPlayerPanel
                      detail={detailData}
                      datasetId={selectedDataset.id}
                      onTagsChanged={() => { void refreshDatasetTags(selectedDataset.id); }}
                      initialEpisode={jumpEpisode}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
                      <div className="text-3xl opacity-30">
                        <AlertTriangle size={28} />
                      </div>
                      <p className="text-sm text-zinc-400 max-w-xs">Unable to load data.</p>
                    </div>
                  )
                )}
                {detailTab === "quality" && selectedDataset && (
                  <AutoFlagPanelContent
                    datasetId={selectedDataset.id}
                    totalEpisodes={detailData?.total_episodes ?? selectedDataset.episodes}
                    tags={datasetTags}
                    onTagsChanged={() => { void refreshDatasetTags(selectedDataset.id); }}
                    onPreviewEpisode={(ep) => { setJumpEpisode(ep); setDetailTab("player"); }}
                  />
                )}
                {detailTab === "curation" && selectedDataset && detailData && (
                  <CurationPanelContent
                    datasetId={selectedDataset.id}
                    detail={detailData}
                    tags={datasetTags}
                    onDerived={(newRepoId) => {
                      void apiGet<unknown>("/api/datasets").then((res) => {
                        const datasets = fromBackendDatasetList(res);
                        setLocalDatasets(datasets);
                        const next = datasets.find((ds) => ds.id === newRepoId);
                        if (next) {
                          setSelectedDataset(next);
                          void fetchDetail(next.id);
                          void refreshDatasetTags(next.id);
                        }
                      });
                    }}
                  />
                )}
                </>)}
              </div>

            </div>
          </div>
          )}

        </div>
      </div>

    </div>
  );
}
