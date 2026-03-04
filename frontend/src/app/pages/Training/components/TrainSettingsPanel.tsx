import { ChevronDown, ChevronUp } from "lucide-react";

import { FieldRow, ModeToggle, WireInput, WireSelect } from "../../../components/wireframe";
import { cn } from "../../../components/ui/utils";
import { LOCAL_DATASETS, POLICY_TYPES, PRESETS, type PresetKey } from "../types";

interface TrainSettingsPanelProps {
  policyType: string;
  setPolicyType: (value: string) => void;
  datasetSource: "local" | "hf";
  setDatasetSource: (value: "local" | "hf") => void;
  hfAuth: string;
  selectedLocalDataset: string;
  setSelectedLocalDataset: (value: string) => void;
  availableDatasets: string[];
  hfDatasetRepoId: string;
  setHfDatasetRepoId: (value: string) => void;
  device: string;
  setDevice: (value: string) => void;
  preset: PresetKey;
  customSteps: number;
  setCustomSteps: (value: number) => void;
  setPreset: (value: PresetKey) => void;
  handlePreset: (key: PresetKey) => void;
  advOpen: boolean;
  setAdvOpen: (value: boolean) => void;
  lrValue: string;
  setLrValue: (value: string) => void;
  modelOutputRepo: string;
  setModelOutputRepo: (value: string) => void;
}

export function TrainSettingsPanel({
  policyType,
  setPolicyType,
  datasetSource,
  setDatasetSource,
  hfAuth,
  selectedLocalDataset,
  setSelectedLocalDataset,
  availableDatasets,
  hfDatasetRepoId,
  setHfDatasetRepoId,
  device,
  setDevice,
  preset,
  customSteps,
  setCustomSteps,
  setPreset,
  handlePreset,
  advOpen,
  setAdvOpen,
  lrValue,
  setLrValue,
  modelOutputRepo,
  setModelOutputRepo,
}: TrainSettingsPanelProps) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Training Config</span>
      </div>
      <div className="px-4 py-4 flex flex-col gap-4">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1px_1fr] gap-4 md:gap-0 md:items-start">
          <div className="md:pr-4">
            <div className="text-sm text-zinc-500 mb-1.5">Policy Type</div>
            <WireSelect
              value={policyType}
              options={POLICY_TYPES}
              onChange={setPolicyType}
            />
          </div>

          <div className="hidden md:block bg-zinc-100 dark:bg-zinc-800/50" />

          <div className="md:pl-4">
            <div className="text-sm text-zinc-500 mb-1.5">Dataset</div>
            <div className="flex items-center gap-1.5">
              <ModeToggle
                options={["Local", "HF"]}
                value={datasetSource === "local" ? "Local" : "HF"}
                onChange={(v) => {
                  if (v === "HF" && hfAuth !== "ready") return;
                  setDatasetSource(v === "Local" ? "local" : "hf");
                }}
              />
              <div className="flex-1 min-w-0">
                {datasetSource === "local" ? (
                  <WireSelect
                    value={selectedLocalDataset}
                    options={availableDatasets.length > 0 ? availableDatasets : LOCAL_DATASETS}
                    onChange={setSelectedLocalDataset}
                  />
                ) : (
                  <WireInput value={hfDatasetRepoId} onChange={setHfDatasetRepoId} placeholder="username/dataset-name" />
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_1px_1fr] gap-4 md:gap-0 pt-4 border-t border-zinc-100 dark:border-zinc-800/50 md:items-start">
          <div className="md:pr-4">
            <div className="text-sm text-zinc-500 mb-1.5">Compute Device</div>
            <WireSelect
              value={device}
              options={["CUDA (GPU)", "CPU", "MPS (Apple Silicon)"]}
              onChange={setDevice}
            />
            {device === "MPS (Apple Silicon)" && (
              <p className="text-sm text-amber-600 dark:text-amber-400 mt-1">⚠ Colab automatically uses CUDA.</p>
            )}
          </div>

          <div className="hidden md:block bg-zinc-100 dark:bg-zinc-800/50" />

          <div className="md:pl-4">
            <div className="text-sm text-zinc-500 mb-1.5">Training Steps</div>
            <div className="flex items-center gap-2">
              <ModeToggle
                options={Object.values(PRESETS).map((p) => `${p.label} (${p.tag})`)}
                value={`${PRESETS[preset].label} (${PRESETS[preset].tag})`}
                onChange={(v) => {
                  const key = (Object.entries(PRESETS) as [PresetKey, typeof PRESETS[PresetKey]][]).find(([, p]) => `${p.label} (${p.tag})` === v)?.[0];
                  if (key) handlePreset(key);
                }}
              />
              <input
                type="number"
                value={customSteps}
                onChange={(e) => { setCustomSteps(Number(e.target.value)); setPreset("standard"); }}
                className="w-24 h-9 px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-800 dark:text-zinc-200 text-sm font-mono outline-none hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 transition-all"
              />
            </div>
          </div>
        </div>

        <div className="border-t border-zinc-100 dark:border-zinc-800 pt-3">
          <button
            onClick={() => setAdvOpen(!advOpen)}
            className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-500 dark:hover:text-zinc-300 transition-colors cursor-pointer w-fit"
          >
            {advOpen ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            Advanced Overrides
          </button>
          {advOpen && (
            <div className="grid grid-cols-1 md:grid-cols-[1fr_1px_1fr] md:gap-0 gap-3 mt-3">
              <div className="md:pr-4">
                <FieldRow label="Learning Rate">
                  <input
                    type="text"
                    value={lrValue}
                    onChange={(e) => setLrValue(e.target.value)}
                    className="w-full h-9 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-800 dark:text-zinc-200 text-sm font-mono outline-none placeholder:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 transition-all"
                  />
                </FieldRow>
              </div>
              <div className="hidden md:block bg-zinc-100 dark:bg-zinc-800/50" />
              <div className="md:pl-4">
                <FieldRow label="Output Repo">
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={modelOutputRepo}
                      onChange={(e) => setModelOutputRepo(e.target.value)}
                      placeholder="username/model-name (optional)"
                      disabled={hfAuth !== "ready"}
                      className={cn(
                        "w-full h-9 px-3 py-2 rounded-lg border text-sm outline-none placeholder:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30 transition-all",
                        hfAuth !== "ready"
                          ? "border-amber-500/30 bg-amber-500/5 text-zinc-400 cursor-not-allowed"
                          : "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-800 dark:text-zinc-200"
                      )}
                    />
                    {hfAuth !== "ready" && (
                      <span className="text-sm text-amber-600 dark:text-amber-400 whitespace-nowrap">🔒 HF</span>
                    )}
                  </div>
                </FieldRow>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
