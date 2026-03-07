import { HardDrive, Cloud } from "lucide-react";
import { WireInput, WireToggle } from "../../../components/wireframe";
import { useLeStudioStore } from "../../../store";
import { cn } from "../../../components/ui/utils";

type RecordingPlanTabProps = {
  totalEps: number;
  recordRepoId: string;
  recordTask: string;
  resumeEnabled: boolean;
  hfAuth: string;
  availableDatasets: string[];
  datasetStorageMode: "local" | "hf";
  localDatasetRoot: string;
  setTotalEps: (value: number) => void;
  setRecordRepoId: (value: string) => void;
  setRecordTask: (value: string) => void;
  setResumeEnabled: (value: boolean) => void;
  setDatasetStorageMode: (value: "local" | "hf") => void;
  setLocalDatasetRoot: (value: string) => void;
};

export function RecordingPlanTab({
  totalEps,
  recordRepoId,
  recordTask,
  resumeEnabled,
  hfAuth,
  availableDatasets,
  datasetStorageMode,
  localDatasetRoot,
  setTotalEps,
  setRecordRepoId,
  setRecordTask,
  setResumeEnabled,
  setDatasetStorageMode,
  setLocalDatasetRoot,
}: RecordingPlanTabProps) {
  const hfUsername = useLeStudioStore((s) => s.hfUsername);
  const isLocal = datasetStorageMode === "local";
  const prefix = !isLocal && hfUsername ? `${hfUsername}/` : "";

  // Strip prefix for display; keep full repo id in state
  const datasetName = prefix && recordRepoId.startsWith(prefix)
    ? recordRepoId.slice(prefix.length)
    : recordRepoId;

  const handleNameChange = (val: string) => {
    if (isLocal) {
      // Local mode: repo_id is just a name (no prefix needed)
      setRecordRepoId(val);
    } else {
      // HF mode: if user types a full "user/name" keep it; otherwise prepend prefix
      if (val.includes("/")) {
        setRecordRepoId(val);
      } else {
        setRecordRepoId(prefix + val);
      }
    }
  };

  // Suggestion list: show only dataset-name part (strip matching prefix)
  const suggestions = availableDatasets.map((id) =>
    prefix && id.startsWith(prefix) ? id.slice(prefix.length) : id,
  );

  const inputCls = "w-full h-9 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-800 dark:text-zinc-200 text-sm outline-none hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 transition-all";

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Episode Settings</span>
      </div>
      <div className="px-4 py-4 flex flex-col gap-3">
        {/* Storage mode toggle */}
        <div>
          <div className="text-sm text-zinc-500 mb-1.5">Dataset Storage</div>
          <div className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
            <button
              onClick={() => setDatasetStorageMode("local")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-all cursor-pointer",
                isLocal
                  ? "bg-zinc-800 dark:bg-zinc-200 text-white dark:text-zinc-900"
                  : "bg-white dark:bg-zinc-800/50 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800",
              )}
            >
              <HardDrive size={13} />
              Local
            </button>
            <button
              onClick={() => setDatasetStorageMode("hf")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-all cursor-pointer border-l border-zinc-200 dark:border-zinc-700",
                !isLocal
                  ? "bg-zinc-800 dark:bg-zinc-200 text-white dark:text-zinc-900"
                  : "bg-white dark:bg-zinc-800/50 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800",
              )}
            >
              <Cloud size={13} />
              HF Hub
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-sm text-zinc-500 mb-1.5">Number of Episodes</div>
            <input
              type="number"
              value={totalEps}
              onChange={(e) => setTotalEps(Math.max(1, Number(e.target.value) || 1))}
              className={inputCls}
            />
          </div>
          <div>
            <div className="text-sm text-zinc-500 mb-1.5">
              {isLocal ? "Dataset Name" : "Dataset Repo ID"}
            </div>
            <div className="flex items-stretch">
              {!isLocal && prefix && (
                <span className="inline-flex items-center px-3 rounded-l-lg border border-r-0 border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 text-sm select-none whitespace-nowrap">
                  {prefix}
                </span>
              )}
              <input
                list="dataset-repo-options"
                value={datasetName}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="my-dataset"
                className={cn(
                  "flex-1 min-w-0 h-9 px-3 py-2 border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-800 dark:text-zinc-200 text-sm outline-none hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 transition-all",
                  !isLocal && prefix ? "rounded-r-lg" : "rounded-lg",
                )}
              />
              <datalist id="dataset-repo-options">
                {suggestions.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>
          </div>
        </div>

        {/* Local root path — only shown in local mode */}
        {isLocal && (
          <div>
            <div className="text-sm text-zinc-500 mb-1.5">Local Root Path</div>
            <input
              value={localDatasetRoot}
              onChange={(e) => setLocalDatasetRoot(e.target.value)}
              placeholder="~/.cache/huggingface/lerobot"
              className={inputCls}
            />
            <div className="text-xs text-zinc-400 mt-1">
              Dataset will be saved to: <span className="font-mono">{localDatasetRoot || "~/.cache/huggingface/lerobot"}/{recordRepoId.includes("/") ? recordRepoId : `local/${recordRepoId || "my-dataset"}`}</span>
            </div>
          </div>
        )}

        <div>
          <div className="text-sm text-zinc-500 mb-1.5">Task Description</div>
          <WireInput value={recordTask} onChange={setRecordTask} placeholder="Pick the red cube and place it..." />
        </div>
        <div className="pt-1">
          <WireToggle label="Resume — continue recording to existing dataset" checked={resumeEnabled} onChange={setResumeEnabled} />
          {!isLocal && hfAuth !== "ready" && (
            <div className="mt-2 text-sm text-amber-600 dark:text-amber-400 flex items-center gap-1">
              HF login required to push to Hub
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
