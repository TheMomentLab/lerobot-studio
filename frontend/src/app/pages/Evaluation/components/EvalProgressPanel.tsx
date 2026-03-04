import { StatusBadge } from "../../../components/wireframe";
import { cn } from "../../../components/ui/utils";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from "recharts";
import type { EpisodeResult } from "../../../hooks/useEvalProgress";
import { RewardTooltip } from "./RewardTooltip";

export interface EvalProgressPanelProps {
  doneEpisodes: number;
  progressTotal: number | null;
  numEpisodes: number;
  meanReward: number | null;
  computedSuccessRate: number | null;
  bestEp: EpisodeResult | null;
  progressPct: number;
  episodeResults: EpisodeResult[];
}

export function EvalProgressPanel({
  doneEpisodes,
  progressTotal,
  numEpisodes,
  meanReward,
  computedSuccessRate,
  bestEp,
  progressPct,
  episodeResults,
}: EvalProgressPanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Evaluation Progress
          </span>
          <StatusBadge status="running" label="RUNNING" pulse />
        </div>
        <div className="px-4 py-4 flex flex-col gap-4">
          <div className="flex items-center gap-6 flex-wrap">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm text-zinc-400">Episode</span>
              <span className="text-sm font-mono text-zinc-700 dark:text-zinc-200">
                {doneEpisodes}
                <span className="text-zinc-400 text-sm">
                  {" "}/ {progressTotal ?? numEpisodes}
                </span>
              </span>
            </div>
            {meanReward !== null && (
              <div className="flex flex-col gap-0.5">
                <span className="text-sm text-zinc-400">Avg Reward</span>
                <span
                  className={cn(
                    "text-sm font-mono",
                    (meanReward ?? 0) >= 0.6
                      ? "text-emerald-600 dark:text-emerald-400"
                      : (meanReward ?? 0) >= 0.4
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-red-600 dark:text-red-400",
                  )}
                >
                  {meanReward.toFixed(3)}
                </span>
              </div>
            )}
            {computedSuccessRate !== null && (
              <div className="flex flex-col gap-0.5">
                <span className="text-sm text-zinc-400">Success Rate</span>
                <span
                  className={cn(
                    "text-sm font-mono",
                    (computedSuccessRate ?? 0) >= 60
                      ? "text-emerald-600 dark:text-emerald-400"
                      : (computedSuccessRate ?? 0) >= 40
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-red-600 dark:text-red-400",
                  )}
                >
                  {computedSuccessRate}%
                </span>
              </div>
            )}
            {bestEp && (
              <div className="flex flex-col gap-0.5">
                <span className="text-sm text-zinc-400">Best</span>
                <span className="text-sm font-mono text-emerald-600 dark:text-emerald-400">
                  Ep {bestEp.ep} ({bestEp.reward.toFixed(3)})
                </span>
              </div>
            )}
          </div>

          <div>
            <div className="flex justify-between text-sm text-zinc-500 mb-1">
              <span>
                {doneEpisodes} / {progressTotal ?? numEpisodes} episodes
              </span>
              <span>{Math.round(progressPct)}%</span>
            </div>
            <div className="h-2.5 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500 bg-zinc-800 dark:bg-zinc-200"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {episodeResults.length > 0 && (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Reward per Episode
            </span>
          </div>
          <div className="h-56 p-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={episodeResults}
                margin={{ top: 8, right: 8, bottom: 4, left: -12 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(63,63,70,0.5)"
                  vertical={false}
                />
                <XAxis
                  dataKey="ep"
                  tick={{ fontSize: 10, fill: "#71717a" }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#71717a" }}
                  tickLine={false}
                  axisLine={false}
                  domain={[0, 1]}
                  tickFormatter={(v) => v.toFixed(1)}
                  width={32}
                />
                <Tooltip content={<RewardTooltip />} />
                <ReferenceLine
                  y={0.6}
                  stroke="#6b7280"
                  strokeDasharray="4 4"
                  strokeWidth={1}
                />
                <Bar dataKey="reward" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                  {episodeResults.map((r) => (
                    <Cell
                      key={r.ep}
                      fill={
                        r.reward >= 0.7
                          ? "#10b981"
                          : r.reward >= 0.5
                            ? "#f59e0b"
                            : "#ef4444"
                      }
                      fillOpacity={r.ep === bestEp?.ep ? 1 : 0.75}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
