import React, { useState, useEffect } from "react";
import { Link } from "react-router";
import {
  RefreshCw, Trash2, Search, Upload, ExternalLink, Cloud,
  Play, Pause, SkipBack, SkipForward, CheckCircle2, ThumbsUp, ThumbsDown,
  Heart, Download, AlertTriangle, MoreVertical, FileWarning, MonitorPlay,
  Filter, Settings, Lock, Loader2, Square
} from "lucide-react";
import {
  PageHeader, StatusBadge, WireSelect, WireInput, FieldRow,
  WireBox, WireToggle, StickyControlBar, HfGateBanner,
} from "../components/wireframe";
import { useHfAuth } from "../hf-auth-context";
import { cn } from "../components/ui/utils";
import { apiGet } from "../services/apiClient";

// ─── Types ───────────────────────────────────────────────────────────────────
type LocalDataset = { id: string; episodes: number; frames: number; size: string; modified: string; tags?: string[] };
type HubResult = { id: string; desc: string; downloads: number; likes: number; tags: string[]; modified: string };

const MY_HUB_DATASETS = [
  { id: "lerobot-user/pick_cube", downloads: 18, likes: 3, size: "1.2 GB", modified: "2026-03-01", localSync: true },
  { id: "lerobot-user/place_cup", downloads: 7, likes: 1, size: "720 MB", modified: "2026-02-28", localSync: true },
  { id: "lerobot-user/old_grasp_v1", downloads: 42, likes: 5, size: "2.1 GB", modified: "2026-01-15", localSync: false },
];

type TagType = "good" | "bad" | "review" | "untagged";

const TAG_STYLES: Record<TagType, string> = {
  good: "bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/20",
  bad: "bg-red-500/10 text-red-500 dark:text-red-400 border-red-500/20",
  review: "bg-amber-500/10 text-amber-500 dark:text-amber-400 border-amber-500/20",
  untagged: "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700",
};

// ─── Sub-Components ──────────────────────────────────────────────────────────

// 1. Hub Search Panel
function HubSearchPanel() {
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState(false);
  const [hubResults, setHubResults] = useState<HubResult[]>([]);
  const [downloading, setDownloading] = useState<Record<string, number>>({}); // id -> progress

  const doSearch = () => {
    if (!query.trim()) return;
    apiGet<{ ok: boolean; results: HubResult[] }>(`/api/hub/datasets/search?q=${encodeURIComponent(query)}`).then((res) => {
      setHubResults(res.results);
      setSearched(true);
    });
  };

  const startDownload = (id: string) => {
    setDownloading((prev) => ({ ...prev, [id]: 0 }));
    // Simulate download
    let progress = 0;
    const interval = setInterval(() => {
      progress += 10;
      setDownloading((prev) => ({ ...prev, [id]: progress }));
      if (progress >= 100) {
        clearInterval(interval);
        setTimeout(() => {
          setDownloading((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
        }, 1000);
      }
    }, 200);
  };

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
            placeholder="Hub 전체 검색 — 데이터셋 ID, 태그, 키워드..."
            className="w-full h-9 pl-9 pr-3 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-sm outline-none focus:border-zinc-400 dark:focus:border-zinc-500 transition-colors placeholder:text-zinc-400"
            onKeyDown={(e) => e.key === "Enter" && doSearch()}
          />
        </div>
        <button
          onClick={doSearch}
          className="px-4 h-9 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-zinc-50 dark:text-zinc-900 text-sm font-medium hover:opacity-90 transition-opacity"
        >
          검색
        </button>
      </div>

      {/* Search Results */}
      {searched && (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
            <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300">검색 결과 ({hubResults.length})</span>
            <button onClick={() => setSearched(false)} className="text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">닫기</button>
          </div>
          <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {hubResults.map((r) => {
              const progress = downloading[r.id];
              const isDownloading = progress !== undefined;

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
                        onClick={() => startDownload(r.id)}
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
            <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300">내 Hub 데이터셋</span>
            <span className="text-sm text-zinc-400">{MY_HUB_DATASETS.length}개</span>
          </div>
          <a href="https://huggingface.co/lerobot-user" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">
            Hub 프로필 <ExternalLink size={10} />
          </a>
        </div>
        <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {MY_HUB_DATASETS.map((ds) => (
            <div key={ds.id} className="flex items-center justify-between px-3 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors">
              <div className="flex flex-col gap-0.5 min-w-0 flex-1 mr-4">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-medium text-blue-500 dark:text-blue-400">{ds.id}</span>
                  {ds.localSync && (
                    <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-sm text-emerald-500 dark:text-emerald-400 border border-emerald-500/30">로컬 동기화됨</span>
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
                {!ds.localSync && (
                  <button
                    onClick={() => startDownload(ds.id)}
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

// 2. Video Player Panel
function VideoPlayerPanel({ dataset }: { dataset: any }) {
  const [currentEpisode, setCurrentEpisode] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playTime, setPlayTime] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [episodeTags, setEpisodeTags] = useState<Record<number, TagType>>({ 0: "good", 1: "bad", 4: "review" });
  const [autoNext, setAutoNext] = useState(false);

  // Tag Filter state
  const [tagFilter, setTagFilter] = useState<string>("All");

  if (!dataset) return null;
  const totalEpisodes = dataset.episodes;
  const totalFrames = 70; // Mock frames per episode
  const currentTag = episodeTags[currentEpisode] ?? "untagged";

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (playing) {
      interval = setInterval(() => {
        setPlayTime((prev) => {
          if (prev >= totalFrames) {
            if (autoNext && currentEpisode < totalEpisodes - 1) {
              setCurrentEpisode(c => c + 1);
              return 0;
            }
            setPlaying(false);
            return totalFrames;
          }
          return prev + 1;
        });
      }, 1000 / (30 * playbackSpeed)); // 30fps base
    }
    return () => clearInterval(interval);
  }, [playing, playbackSpeed, autoNext, currentEpisode, totalEpisodes]);

  const toggleTag = (tag: TagType) => {
    setEpisodeTags(prev => {
      const next = { ...prev };
      if (next[currentEpisode] === tag) delete next[currentEpisode];
      else next[currentEpisode] = tag;
      return next;
    });
    if (autoNext && currentEpisode < totalEpisodes - 1) {
      setCurrentEpisode(e => e + 1);
      setPlayTime(0);
    }
  };

  const clearTag = () => {
    setEpisodeTags(prev => {
      const next = { ...prev };
      delete next[currentEpisode];
      return next;
    });
  };

  return (
    <div>
      {/* Player Info Bar */}
      <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 text-sm font-mono text-zinc-500">
             Episode <span className="text-zinc-900 dark:text-zinc-100 font-bold">{currentEpisode}</span>
             <span className="text-zinc-400">/ {totalEpisodes - 1}</span>
          </div>
          <span className={cn("text-sm px-2 py-0.5 rounded border uppercase font-medium", TAG_STYLES[currentTag])}>
            {currentTag}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Filter size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400" />
            <select
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              className="pl-6 pr-2 py-1 h-7 text-sm rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 outline-none focus:border-zinc-400"
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
             onClick={() => setCurrentEpisode(p => Math.max(0, p - 1))}
             disabled={currentEpisode === 0}
             className="p-1 text-zinc-400 hover:text-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
           >
             <SkipBack size={16} />
           </button>
           <button
             onClick={() => setCurrentEpisode(p => Math.min(totalEpisodes - 1, p + 1))}
             disabled={currentEpisode === totalEpisodes - 1}
             className="p-1 text-zinc-400 hover:text-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
           >
             <SkipForward size={16} />
           </button>
        </div>
      </div>

      <div className="p-4 flex flex-col gap-4">
      {/* Video Grid */}
      <div className={cn(
        "gap-2 bg-zinc-100 dark:bg-zinc-950 rounded-lg p-2 relative group grid",
        dataset.tags.length === 1 ? "grid-cols-1" : dataset.tags.length <= 4 ? "grid-cols-2" : "grid-cols-3"
      )}>
        {dataset.tags.map((cam: string) => (
          <div key={cam} className="relative bg-zinc-800 rounded border border-zinc-700 overflow-hidden flex items-center justify-center aspect-video">
             {/* Mock Video Content */}
             <div className="absolute inset-0 flex items-center justify-center">
               <span className="text-zinc-400 font-mono text-sm select-none">{cam}</span>
             </div>
             {/* Live/Cam Badge */}
             <div className="absolute top-2 left-2 px-1.5 py-0.5 bg-black/50 backdrop-blur rounded text-[10px] font-mono text-zinc-300">
               {cam}
             </div>
          </div>
        ))}
        
        {/* Play Overlay (if paused) */}
        {!playing && (
          <div 
            className="absolute inset-0 flex items-center justify-center bg-black/10 hover:bg-black/20 transition-colors cursor-pointer z-10"
            onClick={() => setPlaying(true)}
          >
            <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
              <Play size={24} className="text-white fill-white ml-1" />
            </div>
          </div>
        )}
      </div>

      {/* Controls Bar */}
      <div className="flex flex-col gap-2">
        {/* Scrubber */}
        <div className="flex items-center gap-3">
          <span className="text-sm font-mono text-zinc-400 w-8 text-right">{playTime}</span>
          <div className="relative flex-1 h-4 flex items-center">
            <input
              type="range"
              min={0}
              max={totalFrames}
              value={playTime}
              onChange={(e) => setPlayTime(Number(e.target.value))}
              className="w-full h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-full appearance-none cursor-pointer accent-zinc-900 dark:accent-zinc-100"
            />
          </div>
          <span className="text-sm font-mono text-zinc-400 w-8">{totalFrames}</span>
        </div>

        {/* Action Buttons Row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button 
              onClick={() => setPlaying(!playing)}
              className="p-2 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition-colors"
            >
              {playing ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <div className="h-4 w-px bg-zinc-200 dark:bg-zinc-700 mx-2" />
            
            {/* Playback Speed */}
            <div className="flex gap-1 bg-zinc-100 dark:bg-zinc-800 p-0.5 rounded-md">
              {[0.5, 1, 2].map(speed => (
                <button
                  key={speed}
                  onClick={() => setPlaybackSpeed(speed)}
                  className={cn(
                    "px-2 py-0.5 text-sm font-medium rounded transition-all",
                    playbackSpeed === speed 
                      ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm" 
                      : "text-zinc-400 hover:text-zinc-600"
                  )}
                >
                  {speed}x
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => toggleTag("good")}
              className={cn("flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border transition-colors", currentTag === "good" ? TAG_STYLES.good + " border-emerald-500" : "border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800")}
            >
              <ThumbsUp size={12} /> Good
            </button>
            <button
              onClick={() => toggleTag("bad")}
              className={cn("flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border transition-colors", currentTag === "bad" ? TAG_STYLES.bad + " border-red-500" : "border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800")}
            >
              <ThumbsDown size={12} /> Bad
            </button>
            <button
              onClick={() => toggleTag("review")}
              className={cn("flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border transition-colors", currentTag === "review" ? TAG_STYLES.review + " border-amber-500" : "border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800")}
            >
              <FileWarning size={12} /> Review
            </button>
            
            {currentTag !== "untagged" && (
              <button onClick={clearTag} className="p-1.5 text-zinc-400 hover:text-zinc-600 transition-colors" title="Clear Tag">
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

// 3. Auto Flag Panel (tab content — no wrapper)
function AutoFlagPanelContent() {
  const [isComputing, setIsComputing] = useState(false);
  const [flaggedCount, setFlaggedCount] = useState<number | null>(null);

  const handleCompute = () => {
    setIsComputing(true);
    setTimeout(() => {
      setIsComputing(false);
      setFlaggedCount(3);
    }, 1500);
  };

  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="flex justify-between items-start">
        <div className="flex gap-2">
          {["Strict", "Balanced", "Lenient"].map((mode) => (
            <button key={mode} className={cn("px-4 py-2 text-sm rounded-lg border transition-colors", mode === "Balanced" ? "bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900" : "bg-white dark:bg-zinc-900 text-zinc-500 border-zinc-200 dark:border-zinc-700 hover:border-zinc-400")}>
              {mode}
            </button>
          ))}
        </div>
        <button
          onClick={handleCompute}
          disabled={isComputing}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-zinc-500 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw size={12} className={cn(isComputing && "animate-spin")} />
          {isComputing ? "Computing..." : "Recompute Stats"}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
         {[
           { label: "Min Frames", value: "30", checked: true },
           { label: "Min Motion", value: "0.01", checked: true },
           { label: "Max Jerk", value: "5.0", checked: true },
           { label: "Max Jerk Ratio", value: "20%", checked: false },
         ].map(item => (
           <div key={item.label} className="flex items-center justify-between py-1">
              <div className="flex items-center gap-2">
                <input type="checkbox" defaultChecked={item.checked} className="accent-zinc-600 dark:accent-zinc-400" />
                <span className="text-sm text-zinc-500">{item.label}</span>
              </div>
              <input type="text" defaultValue={item.value} className="w-16 h-7 text-right px-2 rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 text-sm font-mono" />
           </div>
         ))}
      </div>

      {flaggedCount !== null && (
        <div className="bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">결과 리포트</span>
            <span className="text-sm text-zinc-500">{flaggedCount} 에피소드 감지됨</span>
          </div>
          <ul className="space-y-1 mb-3">
            <li className="text-sm text-zinc-600 dark:text-zinc-400">• Episode 4: Frame count (24) &lt; Min (30)</li>
            <li className="text-sm text-zinc-600 dark:text-zinc-400">• Episode 11: Max Jerk (8.2) &gt; Limit (5.0)</li>
            <li className="text-sm text-zinc-600 dark:text-zinc-400">• Episode 23: Min Motion (0.00) &lt; Limit (0.01)</li>
          </ul>
          <button className="w-full py-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-zinc-50 dark:text-zinc-900 text-sm font-medium hover:opacity-90 transition-opacity">
            플래그된 {flaggedCount}개 에피소드를 'Bad'로 일괄 태그
          </button>
        </div>
      )}
    </div>
  );
}

// 4. Curation Panel (tab content — no wrapper)
const DERIVE_LOGS = [
  "Filtering episodes with Good tag...",
  "Copying 44 episodes to new dataset...",
  "Processing episode 12/44...",
  "Processing episode 24/44...",
  "Processing episode 36/44...",
  "Processing episode 44/44...",
  "Writing metadata...",
  "Done. Dataset saved.",
];

function CurationPanelContent() {
  const [deriveMode, setDeriveMode] = useState("Good Only");
  const [deriving, setDeriving] = useState(false);
  const [deriveProgress, setDeriveProgress] = useState(0);
  const [deriveLogs, setDeriveLogs] = useState<string[]>([]);
  const [deriveDone, setDeriveDone] = useState(false);

  const startDerive = () => {
    setDeriving(true);
    setDeriveProgress(0);
    setDeriveLogs([]);
    setDeriveDone(false);
    let step = 0;
    const tick = () => {
      step++;
      setDeriveLogs(DERIVE_LOGS.slice(0, step));
      setDeriveProgress(Math.round((step / DERIVE_LOGS.length) * 100));
      if (step >= DERIVE_LOGS.length) {
        setDeriving(false);
        setDeriveDone(true);
      } else {
        setTimeout(tick, 600);
      }
    };
    setTimeout(tick, 400);
  };

  const cancelDerive = () => {
    setDeriving(false);
    setDeriveLogs((prev) => [...prev, "Cancelled by user."]);
  };

  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="flex gap-2">
        {["현재 필터 적용", "Good Only", "Exclude Bad"].map(opt => (
          <button
            key={opt}
            onClick={() => { if (!deriving) setDeriveMode(opt); }}
            className={cn("px-4 py-2 rounded-lg border text-sm flex-1 transition-colors cursor-pointer", opt === deriveMode ? "bg-zinc-900 dark:bg-zinc-100 text-zinc-50 dark:text-zinc-900 border-zinc-900 dark:border-zinc-100 font-medium" : "border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800")}
          >
            {opt}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between text-sm px-2">
         <span className="text-zinc-400">결과 미리보기:</span>
         <div className="flex gap-4">
           <span className="text-zinc-700 dark:text-zinc-300 font-medium">Keep: 44 eps</span>
           <span className="text-zinc-400 font-medium">Drop: 8 eps</span>
         </div>
      </div>

      <FieldRow label="새 Repo ID">
        <WireInput placeholder="lerobot-user/pick_cube_curated_v1" className="font-mono text-sm" disabled={deriving} />
      </FieldRow>

      {/* Derive progress */}
      {(deriving || deriveLogs.length > 0) && (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
          <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {deriving && <Loader2 size={12} className="text-zinc-400 animate-spin" />}
              {deriveDone && <CheckCircle2 size={12} className="text-emerald-400" />}
              <span className="text-sm text-zinc-500">{deriving ? "생성 중..." : deriveDone ? "완료" : "중단됨"}</span>
            </div>
            <span className="text-sm text-zinc-400 font-mono">{deriveProgress}%</span>
          </div>
          {deriving && (
            <div className="px-3 py-1">
              <div className="h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
                <div className="h-full rounded-full bg-zinc-800 dark:bg-zinc-200 transition-all duration-300" style={{ width: `${deriveProgress}%` }} />
              </div>
            </div>
          )}
          <div className="px-3 py-2 max-h-28 overflow-y-auto font-mono text-sm text-zinc-500 space-y-0.5">
            {deriveLogs.map((log, i) => <div key={i}>{log}</div>)}
          </div>
          {deriving && (
            <div className="px-3 py-2 border-t border-zinc-100 dark:border-zinc-800/50">
              <button onClick={cancelDerive} className="flex items-center gap-1 text-sm text-red-400 hover:text-red-300 transition-colors cursor-pointer">
                <Square size={10} /> Cancel
              </button>
            </div>
          )}
        </div>
      )}

      <button
        onClick={startDerive}
        disabled={deriving}
        className={cn(
          "w-full py-2 rounded-lg text-sm font-medium transition-opacity",
          deriving
            ? "bg-zinc-300 dark:bg-zinc-700 text-zinc-500 cursor-not-allowed"
            : "bg-zinc-900 dark:bg-zinc-100 text-zinc-50 dark:text-zinc-900 hover:opacity-90 cursor-pointer"
        )}
      >
        {deriveDone ? "다시 생성하기" : "파생 데이터셋 생성하기"}
      </button>
    </div>
  );
}


// ─── Main Component ──────────────────────────────────────────────────────────

export function DatasetManagement() {
  const { hfAuth } = useHfAuth();
  const [pageTab, setPageTab] = useState<"local" | "hub">("local");
  const [localDatasets, setLocalDatasets] = useState<LocalDataset[]>([]);
  const [selectedDataset, setSelectedDataset] = useState<LocalDataset | null>(null);
  const [qualityChecked, setQualityChecked] = useState(false);

  useEffect(() => {
    apiGet<{ datasets: LocalDataset[] }>("/api/datasets").then((res) => {
      setLocalDatasets(res.datasets);
      if (res.datasets.length > 0) setSelectedDataset(res.datasets[0]);
    });
  }, []);
  const [hubPushOpen, setHubPushOpen] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [detailTab, setDetailTab] = useState<"player" | "quality" | "curation">("player");

  // Upload simulation
  useEffect(() => {
    if (hubPushOpen && uploadProgress < 100) {
      const timer = setTimeout(() => setUploadProgress(p => Math.min(100, p + 5)), 200);
      return () => clearTimeout(timer);
    }
  }, [hubPushOpen, uploadProgress]);

  return (
    <div className="flex flex-col h-full">
      {/* Top nav bar */}
      <div className="flex items-center justify-between px-6 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-sm text-zinc-400">
        <Link to="/recording" className="inline-flex items-center gap-1 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">
          ← Recording
        </Link>
        <div className="flex items-center gap-2">
          <span className="text-zinc-300 dark:text-zinc-600">Recording</span>
          <span className="text-zinc-300 dark:text-zinc-600">›</span>
          <span className="text-zinc-700 dark:text-zinc-200 font-medium">Dataset</span>
          <span className="text-zinc-300 dark:text-zinc-600">›</span>
          <Link to="/training" className="hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">Training</Link>
        </div>
        <Link to="/training" className="inline-flex items-center gap-1 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">
          Training →
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-6 max-w-[1600px] mx-auto flex flex-col gap-6">
          <PageHeader
            title="Dataset Management"
            subtitle="데이터셋 관리, 품질 검사, Hub 연동 및 큐레이션"
          />

          {/* Page-level Tabs */}
          <div className="flex gap-1 bg-zinc-100 dark:bg-zinc-800/50 p-1 rounded-lg w-fit mx-auto">
            {([
              { key: "local", icon: <MonitorPlay size={13} />, label: "로컬 데이터셋" },
              { key: "hub", icon: <Download size={13} />, label: "Hub 다운로드" },
            ] as const).map(tab => (
              <button
                key={tab.key}
                onClick={() => setPageTab(tab.key)}
                className={cn(
                  "flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-sm font-medium transition-all",
                  pageTab === tab.key
                    ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                )}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

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
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300">로컬 데이터셋</span>
                  <span className="text-sm text-zinc-400">{localDatasets.length}개</span>
                </div>
                <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {localDatasets.map((ds) => (
                    <div
                      key={ds.id}
                      onClick={() => { setSelectedDataset(ds); setQualityChecked(false); setHubPushOpen(false); setUploadProgress(0); }}
                      className={cn(
                        "group flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors",
                        selectedDataset?.id === ds.id
                          ? "bg-blue-50/50 dark:bg-blue-900/20"
                          : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
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
                      <button className="p-1 rounded text-zinc-400 hover:text-red-500 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 transition-all flex-none" title="Delete">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
                {/* Add link */}
                <div className="px-3 py-2.5 border-t border-zinc-200 dark:border-zinc-800 text-center">
                  <Link to="/record" className="text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:underline">
                    + 새 데이터셋 녹화하러 가기
                  </Link>
                </div>
              </div>
            </div>

            {/* Right Column: Detail (Fluid) */}
            <div className="flex flex-col gap-6">

              {/* Dataset Header / Actions */}
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                {/* Header bar: title + actions */}
                <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium font-mono text-zinc-700 dark:text-zinc-200 truncate">{selectedDataset?.id}</span>
                    <StatusBadge status="ready" label="Local Ready" />
                  </div>
                  <div className="flex items-center gap-1.5 flex-none">
                    <button
                      onClick={() => setQualityChecked(!qualityChecked)}
                      className={cn("px-4 py-2 rounded-lg border text-sm font-medium transition-colors flex items-center gap-1.5", qualityChecked ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/30 text-emerald-700 dark:text-emerald-400" : "border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300")}
                    >
                      <CheckCircle2 size={12} /> Quality
                    </button>
                    <button
                      onClick={() => hfAuth === "ready" && setHubPushOpen(!hubPushOpen)}
                      disabled={hfAuth !== "ready"}
                      className={cn(
                        "px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-all",
                        hfAuth !== "ready"
                          ? "border border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400 cursor-not-allowed"
                          : "bg-zinc-900 dark:bg-zinc-100 text-zinc-50 dark:text-zinc-900 hover:opacity-90"
                      )}
                      title={hfAuth !== "ready" ? "HF token 필요" : "Hub에 업로드"}
                    >
                      {hfAuth !== "ready" ? <Lock size={12} /> : <Upload size={12} />}
                      Hub Push
                    </button>
                    <button className="p-1 rounded text-zinc-400 hover:text-red-500 transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                {/* Sub-tabs */}
                <div className="flex border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/30">
                  {([
                    { key: "player", icon: <Play size={12} />, label: "재생" },
                    { key: "quality", icon: <AlertTriangle size={12} />, label: "품질 검사" },
                    { key: "curation", icon: <Filter size={12} />, label: "큐레이션" },
                  ] as const).map(tab => (
                    <button
                      key={tab.key}
                      onClick={() => setDetailTab(tab.key)}
                      className={cn(
                        "flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors relative",
                        detailTab === tab.key
                          ? "text-zinc-900 dark:text-zinc-100"
                          : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                      )}
                    >
                      {tab.icon}
                      {tab.label}
                      {detailTab === tab.key && (
                        <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-zinc-900 dark:bg-zinc-100 rounded-full" />
                      )}
                    </button>
                  ))}
                </div>
                {/* Info row */}
                <div className="px-3 py-2.5 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800">
                  <div className="flex items-center gap-4 text-sm text-zinc-500">
                    <span className="flex items-center gap-1"><MonitorPlay size={12} /> {selectedDataset?.episodes} eps</span>
                    <span>{selectedDataset?.frames} frames</span>
                    <span>30 FPS</span>
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
                {hubPushOpen && (
                   <div className="px-3 py-2.5 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/30 animate-in slide-in-from-top-2">
                     <div className="flex justify-between text-sm mb-2">
                       <span className="font-medium text-zinc-700 dark:text-zinc-300 flex items-center gap-2">
                         {uploadProgress < 100 ? <Upload size={12} className="animate-bounce" /> : <CheckCircle2 size={12} />}
                         {uploadProgress < 100 ? "Pushing to Hugging Face Hub..." : "Upload Complete"}
                       </span>
                       <span className="text-zinc-500">{uploadProgress}%</span>
                     </div>
                     <div className="h-2 w-full bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
                       <div
                         className="h-full bg-emerald-500 transition-all duration-300 ease-out"
                         style={{ width: `${uploadProgress}%` }}
                       />
                     </div>
                   </div>
                )}

                {/* Quality Check Results */}
                {qualityChecked && (
                  <div className="px-3 py-3 border-t border-zinc-200 dark:border-zinc-800 animate-in slide-in-from-top-2">
                     <div className="flex items-center gap-4 mb-4">
                       <div className="flex flex-col items-center justify-center w-16 h-16 rounded-full bg-emerald-50 border-4 border-emerald-100 text-emerald-600">
                         <span className="text-xl font-bold">78</span>
                         <span className="text-[9px] uppercase font-bold text-emerald-600 dark:text-emerald-400">Score</span>
                       </div>
                       <div className="flex-1">
                         <h4 className="font-medium text-sm text-zinc-800 dark:text-zinc-200">Quality Assessment Report</h4>
                         <p className="text-sm text-zinc-500 mt-0.5">Checked 4 items across {selectedDataset?.episodes} episodes.</p>
                       </div>
                       <Link to="/training" className="text-sm px-4 py-2 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded-lg border border-zinc-200 dark:border-zinc-700 font-medium hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
                         → AI 학습 하러가기
                       </Link>
                     </div>

                     <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                       {[
                         { name: "Frame Count Consistency", status: "pass", msg: "All episodes have 70 frames." },
                         { name: "Camera Sync", status: "pass", msg: " timestamps aligned within 10ms." },
                         { name: "Action Space Coverage", status: "warn", msg: "Joint 4 range usage < 50%" },
                         { name: "Duplicate Detection", status: "pass", msg: "No duplicate episodes found." },
                       ].map(item => (
                         <div key={item.name} className="flex items-start gap-3 p-2 rounded bg-zinc-50 dark:bg-zinc-800/50">
                            {item.status === "pass" ? <CheckCircle2 size={14} className="text-emerald-500 mt-0.5" /> : <AlertTriangle size={14} className="text-amber-500 mt-0.5" />}
                            <div>
                              <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{item.name}</div>
                              <div className="text-sm text-zinc-500">{item.msg}</div>
                            </div>
                         </div>
                       ))}
                     </div>
                  </div>
                )}

                {detailTab === "player" && selectedDataset && <VideoPlayerPanel dataset={selectedDataset} />}
                {detailTab === "quality" && <AutoFlagPanelContent />}
                {detailTab === "curation" && <CurationPanelContent />}
              </div>

            </div>
          </div>
          )}

        </div>
      </div>

      <StickyControlBar>
        <div className="flex items-center gap-3 min-w-0">
          <StatusBadge
            status={pageTab === "local" && selectedDataset ? "ready" : "idle"}
            label={pageTab === "local" && selectedDataset ? "READY" : "IDLE"}
          />
          {pageTab === "local" && selectedDataset && (
            <span className="text-sm text-zinc-400 truncate">
              {selectedDataset?.id} · {selectedDataset?.episodes} eps · {selectedDataset?.size}
            </span>
          )}
        </div>
      </StickyControlBar>
    </div>
  );
}
