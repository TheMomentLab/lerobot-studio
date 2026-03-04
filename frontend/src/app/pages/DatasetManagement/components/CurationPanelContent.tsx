import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Filter, Loader2, Square } from "lucide-react";

import { FieldRow, WireInput } from "../../../components/wireframe";
import { cn } from "../../../components/ui/utils";
import { apiGet, apiPost } from "../../../services/apiClient";
import { useLeStudioStore } from "../../../store";
import type { DatasetDetail, DeriveStartResponse, DeriveStatusResponse, TagType } from "../types";
import { parseDatasetId } from "../utils";

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
          <div className="flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800">
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
