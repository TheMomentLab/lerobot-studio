import { AlertTriangle, Cpu, RotateCcw } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { StatusBadge } from "../../../components/wireframe";
import { cn } from "../../../components/ui/utils";
import { CustomTooltip } from "./CustomTooltip";

interface TrainProgressPanelProps {
  currentStep: number;
  totalSteps: number;
  latestLoss: number | undefined;
  eta: string;
  policyType: string;
  gpuSnapshot: {
    util: number;
    vramUsedGb: number;
    vramTotalGb: number;
  };
  progress: number;
  lossData: { step: number; loss: number }[];
  oomDetected: boolean;
  onRetryAfterOom: () => void;
}

export function TrainProgressPanel({
  currentStep,
  totalSteps,
  latestLoss,
  eta,
  policyType,
  gpuSnapshot,
  progress,
  lossData,
  oomDetected,
  onRetryAfterOom,
}: TrainProgressPanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Training Progress</span>
          <StatusBadge status="running" label="RUNNING" pulse />
        </div>
        <div className="px-4 py-4 flex flex-col gap-4">
          <div className="flex items-center gap-6 flex-wrap">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm text-zinc-400">Step</span>
              <span className="text-sm font-mono text-zinc-700 dark:text-zinc-200">
                {currentStep.toLocaleString()} <span className="text-zinc-400 text-sm">/ {totalSteps.toLocaleString()}</span>
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-sm text-zinc-400">Loss</span>
              <span className={cn("text-sm font-mono", latestLoss ? "text-zinc-700 dark:text-zinc-200" : "text-zinc-500")}>
                {latestLoss ? latestLoss.toFixed(5) : "—"}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-sm text-zinc-400">ETA</span>
              <span className="text-sm font-mono text-zinc-700 dark:text-zinc-200">{eta}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-sm text-zinc-400">Policy</span>
              <span className="text-sm text-zinc-500">{policyType}</span>
            </div>

            <div className="ml-auto flex items-center gap-4 text-sm text-zinc-400">
              <Cpu size={12} className="text-zinc-500" />
              <span className="font-mono">GPU {gpuSnapshot.util}%</span>
              <span className="font-mono">VRAM {gpuSnapshot.vramUsedGb}/{gpuSnapshot.vramTotalGb} GB</span>
            </div>
          </div>

          <div>
            <div className="flex justify-between text-sm text-zinc-500 mb-1">
              <span>{progress}%</span>
              <span>{currentStep.toLocaleString()} / {totalSteps.toLocaleString()} steps</span>
            </div>
            <div className="h-2.5 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500 bg-zinc-800 dark:bg-zinc-200"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {lossData.length === 0 && (
            <p className="text-sm text-zinc-400 italic">No training signals yet... will appear in chart shortly.</p>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Loss Trend</span>
        </div>
        {lossData.length > 1 ? (
          <div className="h-64 p-3">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={lossData} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(63,63,70,0.5)" vertical={false} />
                <XAxis
                  dataKey="step"
                  tick={{ fontSize: 10, fill: "#71717a" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#71717a" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => v.toFixed(3)}
                  width={46}
                />
                <Tooltip content={<CustomTooltip />} />
                <Line
                  type="monotone"
                  dataKey="loss"
                  stroke="#71717a"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-40 flex items-center justify-center">
            <p className="text-sm text-zinc-400 italic">Collecting data...</p>
          </div>
        )}
      </div>

      {oomDetected && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3.5 flex items-start gap-2.5">
          <AlertTriangle size={14} className="text-red-600 dark:text-red-400 flex-none mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-red-600 dark:text-red-400 mb-1">GPU Out of Memory (OOM)</p>
            <p className="text-sm text-zinc-400">VRAM insufficient. Try reducing Training Steps or switching to CPU/MPS. Retry?</p>
          </div>
          <button
            onClick={onRetryAfterOom}
            className="flex items-center gap-1 px-4 py-2 rounded-lg border border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400 text-sm cursor-pointer hover:bg-red-500/20"
          >
            <RotateCcw size={12} /> Reduce &amp; Retry
          </button>
        </div>
      )}
    </div>
  );
}
