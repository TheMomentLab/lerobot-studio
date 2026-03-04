import { Link } from "react-router";
import { ArrowRight, CheckCircle2, HardDrive, RefreshCw, RotateCcw } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { CheckpointItem } from "../types";
import { CustomTooltip } from "./CustomTooltip";

interface TrainCompletedPanelProps {
  policyType: string;
  totalSteps: number;
  latestLoss: number | undefined;
  lossData: { step: number; loss: number }[];
  checkpointList: CheckpointItem[];
  onRefreshCheckpoints: () => void;
  onStartNewTraining: () => void;
}

export function TrainCompletedPanel({
  policyType,
  totalSteps,
  latestLoss,
  lossData,
  checkpointList,
  onRefreshCheckpoints,
  onStartNewTraining,
}: TrainCompletedPanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5">
        <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400 flex-none" />
        <div>
          <span className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">Training Complete</span>
          <span className="text-sm text-zinc-400 ml-3">
            {policyType} · {totalSteps.toLocaleString()} steps · Loss {latestLoss?.toFixed(5) ?? "—"}
          </span>
        </div>
      </div>

      {lossData.length > 1 && (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Loss Trend (Final)</span>
          </div>
          <div className="h-48 p-3">
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
        </div>
      )}

      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Checkpoints ({checkpointList.length})</span>
          <button
            onClick={onRefreshCheckpoints}
            className="text-zinc-400 hover:text-zinc-300 cursor-pointer p-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded"
            title="Refresh"
          >
            <RefreshCw size={12} />
          </button>
        </div>
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
          {checkpointList.map((cp) => (
            <div key={cp.name} className="flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/20 transition-colors">
              <HardDrive size={12} className="text-zinc-400 flex-none" />
              <div className="min-w-0 flex-1">
                <span className="text-sm text-zinc-700 dark:text-zinc-300 font-mono">{cp.name}</span>
                <span className="text-sm text-zinc-400 font-mono ml-3">{cp.path}</span>
              </div>
              <span className="text-sm text-zinc-500 font-mono flex-none">
                step {cp.step !== null ? cp.step.toLocaleString() : "—"}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3 justify-end">
        <Link
          to="/evaluation"
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
        >
          <ArrowRight size={12} /> Go to Policy Evaluation
        </Link>
        <button
          onClick={onStartNewTraining}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
        >
          <RotateCcw size={12} /> Start New Training
        </button>
      </div>
    </div>
  );
}
