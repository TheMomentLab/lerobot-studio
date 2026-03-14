import type { Dispatch, SetStateAction } from "react";
import { ChevronDown, ChevronUp, Video } from "lucide-react";
import { cn } from "../../../components/ui/utils";
import { ArmPairSelector } from "../../../components/wireframe/ArmPairSelector";
import type {
  CheckpointItem,
  EnvTypeItem,
} from "../../../hooks/useEvalCheckpoint";
import type {
  ArmSelection,
  MappedArmLists,
  ResolvedArmConfig,
} from "../../../services/armSets";
import type { CalibrationListFile } from "../../../services/calibrationProfiles";
import type { EvalCalibrationProfile } from "../types";

export interface EvalSettingsPanelProps {
  policySource: "local" | "hf";
  setPolicySource: Dispatch<SetStateAction<"local" | "hf">>;
  policyPath: string;
  checkpoints: CheckpointItem[];
  onCheckpointChange: (path: string) => void;
  updateConfig: (partial: Record<string, unknown>) => void;
  deviceLabel: string;
  setDeviceLabel: Dispatch<SetStateAction<string>>;
  numEpisodes: number;
  setNumEpisodes: Dispatch<SetStateAction<number>>;
  datasetRepo: string;
  setDatasetRepo: Dispatch<SetStateAction<string>>;
  envType: string;
  envTypes: EnvTypeItem[];
  envTypeFromCheckpoint: string | null;
  envTypeMissing: boolean;
  envTaskFromCheckpoint: string | null;
  envTaskMissing: boolean;
  task: string;
  advOpen: boolean;
  setAdvOpen: Dispatch<SetStateAction<boolean>>;
  datasetOverride: string;
  setDatasetOverride: Dispatch<SetStateAction<string>>;
  isRealRobot: boolean;
  imageKeysFromCheckpoint: string[];
  cameraConfigOpen: boolean;
  setCameraConfigOpen: Dispatch<SetStateAction<boolean>>;
  cameraMapping: Record<string, string>;
  setCameraMapping: Dispatch<SetStateAction<Record<string, string>>>;
  mappedCamEntries: [string, string][];
  calibrationProfiles: EvalCalibrationProfile[];
  onCalibrationIdChange: (configKey: string, value: string) => void;
  armLists: MappedArmLists;
  armSelection: ArmSelection;
  onArmSelectionChange: (selection: ArmSelection) => void;
  onArmConfigResolved: (config: ResolvedArmConfig) => void;
  evalCalibFiles: CalibrationListFile[];
  robotMode: "single" | "bi";
  computeDeviceOptions: Array<string | { value: string; label: string; disabled?: boolean }>;
}

export function EvalSettingsPanel({
  policySource,
  setPolicySource,
  policyPath,
  checkpoints,
  onCheckpointChange,
  updateConfig,
  deviceLabel,
  setDeviceLabel,
  numEpisodes,
  setNumEpisodes,
  datasetRepo,
  setDatasetRepo,
  envType,
  envTypes,
  envTypeFromCheckpoint,
  envTypeMissing,
  envTaskFromCheckpoint,
  envTaskMissing,
  task,
  advOpen,
  setAdvOpen,
  datasetOverride,
  setDatasetOverride,
  isRealRobot,
  imageKeysFromCheckpoint,
  cameraConfigOpen,
  setCameraConfigOpen,
  cameraMapping,
  setCameraMapping,
  mappedCamEntries,
  calibrationProfiles,
  onCalibrationIdChange,
  armLists,
  armSelection,
  onArmSelectionChange,
  onArmConfigResolved,
  evalCalibFiles,
  robotMode,
  computeDeviceOptions,
}: EvalSettingsPanelProps) {
  void calibrationProfiles;
  void onCalibrationIdChange;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Evaluation Settings
          </span>
        </div>
        <div className="px-4 py-4 flex flex-col gap-4">
          <div>
            <div className="text-sm text-zinc-500 mb-1.5">Policy Source</div>
            <div className="flex flex-col md:flex-row md:items-center gap-2">
              <div className="flex gap-1 bg-zinc-100 dark:bg-zinc-800/50 p-0.5 rounded-lg w-fit flex-none">
                <button
                  onClick={() => setPolicySource("local")}
                  className={cn(
                    "flex items-center gap-1.5 px-3.5 py-1 rounded-md text-sm font-medium transition-all cursor-pointer",
                    policySource === "local"
                      ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm"
                      : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300",
                  )}
                >
                  Local
                </button>
                <button
                  onClick={() => setPolicySource("hf")}
                  title="Hugging Face"
                  className={cn(
                    "flex items-center gap-1.5 px-3.5 py-1 rounded-md text-sm font-medium transition-all cursor-pointer",
                    policySource === "hf"
                      ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm"
                      : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300",
                  )}
                >
                  HF
                </button>
              </div>
              <div className="flex-1 min-w-0">
                {policySource === "local" ? (
                  checkpoints.length === 0 ? (
                    <div className="text-sm text-amber-600 dark:text-amber-400">
                      No checkpoints found. Train a model first.
                    </div>
                  ) : (
                    <select
                      value={policyPath}
                      onChange={(e) => onCheckpointChange(e.target.value)}
                      className="w-full h-9 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-800 dark:text-zinc-200 text-sm outline-none cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 transition-all"
                    >
                      {checkpoints.map((cp) => (
                        <option key={cp.path} value={cp.path}>
                          {cp.display ??
                            (cp.step
                              ? `${cp.name} (step ${cp.step.toLocaleString()})`
                              : cp.name)}
                        </option>
                      ))}
                    </select>
                  )
                ) : (
                  <input
                    type="text"
                    value={policyPath}
                    placeholder="e.g. lerobot/act_pusht_diffusion"
                    onChange={(e) =>
                      updateConfig({ eval_policy_path: e.target.value })
                    }
                    className="w-full h-9 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-800 dark:text-zinc-200 text-sm outline-none placeholder:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 transition-all"
                  />
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <div className="text-sm text-zinc-500 mb-1.5">Device</div>
              <select
                value={deviceLabel}
                onChange={(e) => setDeviceLabel(e.target.value)}
                className="w-full h-9 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-800 dark:text-zinc-200 text-sm outline-none cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 transition-all"
              >
                {computeDeviceOptions.map((option) => {
                  const value = typeof option === "string" ? option : option.value;
                  const label = typeof option === "string" ? option : option.label;
                  const disabled = typeof option === "string" ? false : Boolean(option.disabled);
                  return <option key={value} value={value} disabled={disabled}>{label}</option>;
                })}
              </select>
            </div>
            <div>
              <div className="text-sm text-zinc-500 mb-1.5">Number of Episodes</div>
              <input
                type="number"
                value={numEpisodes}
                onChange={(e) => setNumEpisodes(Number(e.target.value))}
                min={1}
                max={100}
                className="w-full h-9 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-800 dark:text-zinc-200 text-sm outline-none hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 transition-all"
              />
            </div>
            <div>
              <div className="text-sm text-zinc-500 mb-1.5">Dataset Repo ID</div>
              <input
                type="text"
                value={datasetRepo}
                onChange={(e) => setDatasetRepo(e.target.value)}
                className="w-full h-9 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-800 dark:text-zinc-200 text-sm outline-none placeholder:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 transition-all"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="text-sm text-zinc-500 mb-1.5">
                Env Type
                {envTypeFromCheckpoint && (
                  <span className="text-xs text-emerald-600 dark:text-emerald-400 ml-1.5">
                    from checkpoint
                  </span>
                )}
                {envTypeMissing && (
                  <span className="text-xs text-zinc-400 ml-1.5">(required)</span>
                )}
              </div>
              <select
                value={envType}
                onChange={(e) => updateConfig({ eval_env_type: e.target.value })}
                className="w-full h-9 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-800 dark:text-zinc-200 text-sm outline-none cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 transition-all"
              >
                <option value="">- Select env type -</option>
                {envTypes.map((et) => (
                  <option key={et.type} value={et.type} disabled={!et.installed}>
                    {et.label}
                    {et.installed ? "" : " (not installed)"}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div className="text-sm text-zinc-500 mb-1.5">
                Task
                {envTaskFromCheckpoint && (
                  <span className="text-xs text-emerald-600 dark:text-emerald-400 ml-1.5">
                    from checkpoint
                  </span>
                )}
                {envTaskMissing && (
                  <span className="text-xs text-zinc-400 ml-1.5">(required)</span>
                )}
              </div>
              <input
                type="text"
                value={task}
                placeholder="e.g. Pick up the block"
                onChange={(e) => updateConfig({ eval_task: e.target.value })}
                className="w-full h-9 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-800 dark:text-zinc-200 text-sm outline-none placeholder:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 transition-all"
              />
            </div>
          </div>

          <button
            onClick={() => setAdvOpen(!advOpen)}
            className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-500 dark:hover:text-zinc-300 transition-colors cursor-pointer w-fit"
          >
            {advOpen ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            Advanced Settings
          </button>
          {advOpen && (
            <div className="pl-3 border-l-2 border-zinc-100 dark:border-zinc-800">
              <div className="text-sm text-zinc-500 mb-1.5">
                Dataset Override <span className="text-zinc-600">(optional)</span>
              </div>
              <input
                type="text"
                value={datasetOverride}
                onChange={(e) => setDatasetOverride(e.target.value)}
                placeholder="Override with different dataset repo"
                className="w-full h-9 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-800 dark:text-zinc-200 text-sm outline-none placeholder:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 transition-all"
              />
            </div>
          )}

          {isRealRobot && (
            <div className="border-t border-zinc-100 dark:border-zinc-800 pt-3 flex flex-col gap-3">
              <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Robot Configuration</div>
              <ArmPairSelector
                mode={robotMode === "bi" ? "Bi-Arm" : "Single Arm"}
                armLists={armLists}
                calibFiles={evalCalibFiles}
                selection={armSelection}
                onSelectionChange={onArmSelectionChange}
                onConfigResolved={onArmConfigResolved}
              />
            </div>
          )}

          {isRealRobot && imageKeysFromCheckpoint.length > 0 && (
            <div className="border-t border-zinc-100 dark:border-zinc-800 pt-3 flex flex-col gap-2">
              <div
                className="flex items-center justify-between cursor-pointer"
                onClick={() => setCameraConfigOpen(!cameraConfigOpen)}
              >
                <div className="flex items-center gap-2">
                  <Video
                    size={12}
                    className="text-emerald-600 dark:text-emerald-400"
                  />
                  <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
                    Camera Mapping
                  </span>
                  <span className="text-xs text-zinc-400">
                    {Object.values(cameraMapping).filter(Boolean).length}/
                    {imageKeysFromCheckpoint.length} mapped
                  </span>
                </div>
                {cameraConfigOpen ? (
                  <ChevronUp size={10} className="text-zinc-500" />
                ) : (
                  <ChevronDown size={10} className="text-zinc-500" />
                )}
              </div>
              {cameraConfigOpen && (
                <div className="flex flex-col gap-2">
                  <p className="text-sm text-zinc-400">
                    Map policy image keys to actual cameras.
                  </p>
                  {mappedCamEntries.length === 0 && (
                    <p className="text-sm text-amber-600 dark:text-amber-400">
                      No mapped cameras. Set up cameras in Device Setup first.
                    </p>
                  )}
                  {imageKeysFromCheckpoint.map((key) => (
                    <div key={key} className="flex flex-col gap-1">
                      <code className="text-xs font-mono text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded self-start max-w-full truncate">
                        {key}
                      </code>
                      <select
                        value={cameraMapping[key] || ""}
                        onChange={(e) =>
                          setCameraMapping((prev) => ({
                            ...prev,
                            [key]: e.target.value,
                          }))
                        }
                        className="w-full h-9 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-800 dark:text-zinc-200 text-sm outline-none cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 transition-all"
                      >
                        <option value="">- Select -</option>
                        {mappedCamEntries.map(([sym, path]) => (
                          <option key={sym} value={sym}>
                            {sym} ({path})
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                  {Object.values(cameraMapping).some((v) => !v) && (
                    <p className="text-sm text-amber-600 dark:text-amber-400">
                      ⚠ Unmapped cameras detected. Evaluation may fail.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
