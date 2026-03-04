import { useEffect, useMemo, useRef, useState } from "react";
import {
  FileWarning,
  Filter,
  Pause,
  Play,
  Search,
  SkipBack,
  SkipForward,
  ThumbsDown,
  ThumbsUp,
  Eraser,
} from "lucide-react";

import { WireToggle } from "../../../components/wireframe";
import { cn } from "../../../components/ui/utils";
import { apiGet, apiPost } from "../../../services/apiClient";
import { useLeStudioStore } from "../../../store";
import type { DatasetDetail, TagType } from "../types";
import { parseDatasetId } from "../utils";

export function VideoPlayerPanel({
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
        addToast("Last episode.", "info");
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
                  <Eraser size={14} />
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
