import { WireInput, WireToggle } from "../../../components/wireframe";

type RecordingPlanTabProps = {
  totalEps: number;
  recordRepoId: string;
  recordTask: string;
  resumeEnabled: boolean;
  pushToHub: boolean;
  hfAuth: string;
  availableDatasets: string[];
  setTotalEps: (value: number) => void;
  setRecordRepoId: (value: string) => void;
  setRecordTask: (value: string) => void;
  setResumeEnabled: (value: boolean) => void;
  setPushToHub: (value: boolean) => void;
};

export function RecordingPlanTab({
  totalEps,
  recordRepoId,
  recordTask,
  resumeEnabled,
  pushToHub,
  hfAuth,
  availableDatasets,
  setTotalEps,
  setRecordRepoId,
  setRecordTask,
  setResumeEnabled,
  setPushToHub,
}: RecordingPlanTabProps) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Episode Settings</span>
      </div>
      <div className="px-4 py-4 flex flex-col gap-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-sm text-zinc-500 mb-1.5">Number of Episodes</div>
            <input
              type="number"
              value={totalEps}
              onChange={(e) => setTotalEps(Math.max(1, Number(e.target.value) || 1))}
              className="w-full h-9 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-800 dark:text-zinc-200 text-sm outline-none hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 transition-all"
            />
          </div>
          <div>
            <div className="text-sm text-zinc-500 mb-1.5">Dataset Repo ID</div>
            {availableDatasets.length > 0 ? (
              <select
                value={recordRepoId}
                onChange={(e) => setRecordRepoId(e.target.value)}
                className="w-full h-9 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-800 dark:text-zinc-200 text-sm outline-none cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 transition-all"
              >
                {availableDatasets.map((id) => (
                  <option key={id} value={id}>{id}</option>
                ))}
              </select>
            ) : (
              <WireInput value={recordRepoId} onChange={setRecordRepoId} placeholder="username/dataset-name" />
            )}
          </div>
        </div>
        <div>
          <div className="text-sm text-zinc-500 mb-1.5">Task Description</div>
          <WireInput value={recordTask} onChange={setRecordTask} placeholder="Pick the red cube and place it..." />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 pt-1">
          <div className="flex items-center gap-2">
            <WireToggle label="Resume — continue recording to existing dataset" checked={resumeEnabled} onChange={setResumeEnabled} />
          </div>
          <div className="flex items-center gap-2">
            <WireToggle
              label="Push to Hub — auto-upload after completion"
              checked={pushToHub}
              onChange={setPushToHub}
            />
            {hfAuth !== "ready" && (
              <span className="text-sm text-amber-600 dark:text-amber-400 flex items-center gap-1">
                🔒 HF required
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
