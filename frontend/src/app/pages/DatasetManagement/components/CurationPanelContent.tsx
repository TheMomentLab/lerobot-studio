import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronRight,
  Circle,
  Info,
  Square,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";

import { buttonStyles } from "../../../components/ui/button";
import { Card, FieldRow, StatusBadge, WireInput } from "../../../components/wireframe";
import { cn } from "../../../components/ui/utils";
import { apiGet, apiPost } from "../../../services/apiClient";
import { useLeStudioStore } from "../../../store";
import type { DatasetDetail, DeriveStartResponse, DeriveStatusResponse, TagType } from "../types";
import { parseDatasetId } from "../utils";

// ─── Constants ───────────────────────────────────────────────────────────────

const TAG_CONFIG: Record<
  TagType,
  { icon: typeof ThumbsUp; label: string; bg: string; border: string; text: string; textMuted: string; badge: string }
> = {
  good: {
    icon: ThumbsUp,
    label: "Good",
    bg: "bg-white dark:bg-zinc-900",
    border: "border-zinc-200 dark:border-zinc-800",
    text: "text-emerald-600 dark:text-emerald-400",
    textMuted: "text-zinc-500 dark:text-zinc-400",
    badge: "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10",
  },
  bad: {
    icon: ThumbsDown,
    label: "Bad",
    bg: "bg-white dark:bg-zinc-900",
    border: "border-zinc-200 dark:border-zinc-800",
    text: "text-red-600 dark:text-red-400",
    textMuted: "text-zinc-500 dark:text-zinc-400",
    badge: "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10",
  },
  review: {
    icon: AlertTriangle,
    label: "Review",
    bg: "bg-white dark:bg-zinc-900",
    border: "border-zinc-200 dark:border-zinc-800",
    text: "text-amber-600 dark:text-amber-400",
    textMuted: "text-zinc-500 dark:text-zinc-400",
    badge: "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10",
  },
  untagged: {
    icon: Circle,
    label: "Untagged",
    bg: "bg-white dark:bg-zinc-900",
    border: "border-zinc-200 dark:border-zinc-800",
    text: "text-zinc-500 dark:text-zinc-400",
    textMuted: "text-zinc-400 dark:text-zinc-500",
    badge: "text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800",
  },
};

const DERIVE_MODES = [
  {
    key: "good" as const,
    label: "Good Only",
    description: "Keep only episodes explicitly tagged as good",
  },
  {
    key: "exclude_bad" as const,
    label: "Exclude Bad",
    description: "Keep everything except episodes tagged as bad",
  },
  {
    key: "filter" as const,
    label: "Current Filter",
    description: "Keep all episodes with their current tags applied",
  },
];

// ─── Component ───────────────────────────────────────────────────────────────

export function CurationPanelContent({
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
  const [showEpisodes, setShowEpisodes] = useState(false);

  // ─── Derived data ──────────────────────────────────────────────────────────

  const tagCounts = useMemo(() => {
    const c: Record<TagType, number> = { good: 0, bad: 0, review: 0, untagged: 0 };
    for (const ep of detail.episodes) {
      const tag: TagType = tags[String(ep.episode_index)] ?? "untagged";
      c[tag]++;
    }
    return c;
  }, [detail.episodes, tags]);

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

  const dropCount = Math.max(0, detail.total_episodes - keepIndices.length);
  const keepSet = useMemo(() => new Set(keepIndices), [keepIndices]);
  const running = Boolean(jobId);

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const handleStartDerive = async () => {
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

  // ─── Job polling ───────────────────────────────────────────────────────────

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

  const canCreate = !running && keepIndices.length > 0 && keepIndices.length < detail.total_episodes;

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 flex flex-col gap-4">

      {/* ─── 1. Tag Summary Dashboard ─── */}
      <div>
        <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-2">
          Episode Tags
        </div>
        <div className="grid grid-cols-4 gap-2">
          {(["good", "bad", "review", "untagged"] as const).map((t) => {
            const cfg = TAG_CONFIG[t];
            const Icon = cfg.icon;
            return (
              <div
                key={t}
                className={cn("px-3 py-2 rounded-lg border", cfg.bg, cfg.border)}
              >
                <div className={cn("text-lg font-bold tabular-nums", cfg.text)}>
                  {tagCounts[t]}
                </div>
                <div className={cn("text-xs flex items-center gap-1", cfg.textMuted)}>
                  <Icon size={10} /> {cfg.label}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── 2. Derive Mode — Radio Cards ─── */}
      <div>
        <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-2">
          Derive Mode
        </div>
        <div className="flex flex-col gap-1.5">
          {DERIVE_MODES.map((mode) => (
            <button
              key={mode.key}
              type="button"
              onClick={() => { if (!running) setDeriveMode(mode.key); }}
              disabled={running}
              className={cn(
                "flex items-start gap-3 px-3 py-2.5 rounded-lg border text-left transition-all cursor-pointer",
                deriveMode === mode.key
                  ? "border-blue-500/50 bg-blue-50 dark:bg-blue-500/10 ring-1 ring-blue-500/20"
                  : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800/30",
                running && "opacity-50 cursor-not-allowed",
              )}
            >
              {/* Radio circle */}
              <div
                className={cn(
                  "mt-0.5 size-4 rounded-full border-2 flex items-center justify-center flex-none",
                  deriveMode === mode.key ? "border-blue-500" : "border-zinc-300 dark:border-zinc-600",
                )}
              >
                {deriveMode === mode.key && <div className="size-2 rounded-full bg-blue-500" />}
              </div>
              <div>
                <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{mode.label}</div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{mode.description}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ─── 3. Impact Preview ─── */}
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/30 p-3">
        <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-2">
          Impact Preview
        </div>
        {/* Bar */}
        <div className="flex h-3 rounded-full overflow-hidden bg-zinc-200 dark:bg-zinc-700 mb-2">
          {keepIndices.length > 0 && (
            <div
              className="h-full bg-emerald-500 transition-all duration-300"
              style={{ width: `${(keepIndices.length / detail.total_episodes) * 100}%` }}
            />
          )}
          {dropCount > 0 && (
            <div
              className="h-full bg-red-400 dark:bg-red-500/70 transition-all duration-300"
              style={{ width: `${(dropCount / detail.total_episodes) * 100}%` }}
            />
          )}
        </div>
        {/* Labels */}
        <div className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
            <span className="size-2 rounded-full bg-emerald-500 flex-none" />
            Keep {keepIndices.length} eps
          </span>
          <span className="flex items-center gap-1.5 text-red-500 dark:text-red-400 font-medium">
            <span className="size-2 rounded-full bg-red-400 dark:bg-red-500/70 flex-none" />
            Drop {dropCount} eps
          </span>
        </div>
      </div>

      {/* ─── 4. Collapsible Episode Details ─── */}
      <div>
        <button
          type="button"
          onClick={() => setShowEpisodes(!showEpisodes)}
          className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors cursor-pointer"
        >
          <ChevronRight
            size={12}
            className={cn("transition-transform duration-200", showEpisodes && "rotate-90")}
          />
          Episode Details
          <span className="text-zinc-400 dark:text-zinc-500 font-normal normal-case">
            ({keepIndices.length} kept, {dropCount} dropped)
          </span>
        </button>

        {showEpisodes && (
          <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800/50">
            {detail.episodes.map((ep) => {
              const tag: TagType = tags[String(ep.episode_index)] ?? "untagged";
              const kept = keepSet.has(ep.episode_index);
              const tagCfg = TAG_CONFIG[tag];
              return (
                <div
                  key={ep.episode_index}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 text-sm",
                    kept
                      ? "bg-white dark:bg-zinc-900"
                      : "bg-zinc-50 dark:bg-zinc-800/50 opacity-50",
                  )}
                >
                  {/* Keep/Drop dot */}
                  <span
                    className={cn(
                      "size-1.5 rounded-full flex-none",
                      kept ? "bg-emerald-500" : "bg-red-400",
                    )}
                  />
                  {/* Episode label */}
                  <span className="font-mono text-zinc-700 dark:text-zinc-300 flex-none w-12">
                    Ep {ep.episode_index}
                  </span>
                  {/* Frame count */}
                  <span className="text-zinc-400 text-xs flex-none">
                    {ep.length ?? "?"} frames
                  </span>
                  <div className="flex-1" />
                  {/* Tag badge */}
                  <span className={cn("text-xs px-1.5 py-0.5 rounded", tagCfg.badge)}>
                    {tagCfg.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── 5. Job Progress ─── */}
      {job && (
        <Card
          title={
            running
              ? "Creating Derived Dataset..."
              : String(job.status) === "success"
                ? "Dataset Created"
                : String(job.status) === "error"
                  ? "Derive Failed"
                  : String(job.status) === "cancelled"
                    ? "Derive Cancelled"
                    : "Processing"
          }
          badge={
            running
              ? <StatusBadge status="running" pulse />
              : String(job.status) === "success"
                ? <StatusBadge status="ready" />
                : <StatusBadge status="error" />
          }
          action={
            running ? (
              <button
                type="button"
                onClick={() => { void handleCancel(); }}
                className="flex items-center gap-1 text-xs text-red-500 hover:text-red-400 transition-colors cursor-pointer"
              >
                <Square size={10} /> Cancel
              </button>
            ) : undefined
          }
        >
          <div className="flex flex-col gap-2">
            {/* Progress bar */}
            <div>
              <div className="flex items-center justify-between mb-1 text-xs text-zinc-400">
                <span>{job.phase ?? job.status ?? "running"}</span>
                <span className="font-mono">{Number(job.progress ?? 0)}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-300",
                    String(job.status) === "error" ? "bg-red-500" : "bg-zinc-800 dark:bg-zinc-200",
                  )}
                  style={{ width: `${Math.max(0, Math.min(100, Number(job.progress ?? 0)))}%` }}
                />
              </div>
            </div>
            {/* Logs */}
            <div className="max-h-28 overflow-y-auto font-mono text-xs text-zinc-500 space-y-0.5">
              {(job.logs ?? []).slice(-8).map((log, i) => (
                <div key={`${i}-${log}`}>{log}</div>
              ))}
              {job.error && <div className="text-red-500">{job.error}</div>}
            </div>
          </div>
        </Card>
      )}

      {/* ─── 6. Derive Action ─── */}
      <div className="flex flex-col gap-2 pt-1 border-t border-zinc-100 dark:border-zinc-800/50">
        <FieldRow label="New Repo ID">
          <WireInput
            value={newRepoId}
            onChange={(v) => { if (!running) setNewRepoId(v); }}
            placeholder={defaultRepoId}
            disabled={running}
          />
        </FieldRow>

        {/* Disabled-state messaging */}
        {!running && keepIndices.length === 0 && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/5 text-sm text-amber-600 dark:text-amber-400">
            <AlertTriangle size={13} className="flex-none" />
            No episodes to keep — select a different mode or tag episodes first.
          </div>
        )}
        {!running && keepIndices.length > 0 && keepIndices.length >= detail.total_episodes && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/30 text-sm text-zinc-500">
            <Info size={13} className="flex-none" />
            All episodes are kept — nothing to filter. Tag some episodes as bad first.
          </div>
        )}

        <button
          type="button"
          onClick={() => { void handleStartDerive(); }}
          disabled={!canCreate}
          className={buttonStyles({
            variant: "primary",
            tone: "neutral",
            className: "w-full h-auto px-6 py-2.5",
          })}
        >
          Create Derived Dataset ({keepIndices.length} of {detail.total_episodes} episodes)
        </button>
      </div>
    </div>
  );
}
