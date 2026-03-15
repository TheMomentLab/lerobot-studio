import { Link } from "react-router";
import {
  AlertTriangle,
  CheckCircle2,
  Trophy,
  TrendingDown,
  RotateCcw,
  ArrowRight,
} from "lucide-react";
import { buttonStyles } from "../../../components/ui/button";
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

export interface EvalResultsPanelProps {
  progressStatus: "idle" | "starting" | "running" | "stopped" | "completed" | "error";
  selectedEnvLabel: string;
  envType: string;
  doneEpisodes: number;
  avgReward: number | null;
  computedSuccessRate: number | null;
  finalReward: number | null;
  finalSuccess: number | null;
  bestEp: EpisodeResult | null;
  worstEp: EpisodeResult | null;
  episodeResults: EpisodeResult[];
  onQuickRerun: () => void;
  onStartNewEvaluation: () => void;
}

export function EvalResultsPanel({
  progressStatus,
  selectedEnvLabel,
  envType,
  doneEpisodes,
  avgReward,
  computedSuccessRate,
  finalReward,
  finalSuccess,
  bestEp,
  worstEp,
  episodeResults,
  onQuickRerun,
  onStartNewEvaluation,
}: EvalResultsPanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <div
        className={cn(
          "flex items-center gap-3 px-4 py-3 rounded-lg border",
          progressStatus === "error"
            ? "border-red-500/30 bg-red-500/5"
            : progressStatus === "stopped"
              ? "border-zinc-500/30 bg-zinc-500/5"
              : "border-emerald-500/30 bg-emerald-500/5",
        )}
      >
        {progressStatus === "error" ? (
          <AlertTriangle
            size={16}
            className="text-red-600 dark:text-red-400 flex-none"
          />
        ) : (
          <CheckCircle2
            size={16}
            className="text-emerald-600 dark:text-emerald-400 flex-none"
          />
        )}
        <div>
          <span
            className={cn(
              "text-sm font-medium",
              progressStatus === "error"
                ? "text-red-600 dark:text-red-400"
                : progressStatus === "stopped"
                  ? "text-zinc-500"
                  : "text-emerald-600 dark:text-emerald-400",
            )}
          >
            {progressStatus === "error"
              ? "Evaluation Error"
              : progressStatus === "stopped"
                ? "Evaluation Stopped"
                : "Evaluation Complete"}
          </span>
          <span className="text-sm text-zinc-400 ml-3">
            {selectedEnvLabel ?? envType} . {doneEpisodes} episodes
            {avgReward !== null && ` . Avg Reward ${avgReward.toFixed(3)}`}
            {computedSuccessRate !== null && ` . Success ${computedSuccessRate}%`}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/20">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm text-zinc-400">Total</span>
          <span className="text-sm font-mono text-zinc-700 dark:text-zinc-200">
            {doneEpisodes} eps
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-sm text-zinc-400">Avg Reward</span>
          <span
            className={cn(
              "text-sm font-mono",
              (avgReward ?? 0) >= 0.6
                ? "text-emerald-600 dark:text-emerald-400"
                : (avgReward ?? 0) >= 0.4
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-red-600 dark:text-red-400",
            )}
          >
            {avgReward?.toFixed(3) ?? finalReward?.toFixed(3) ?? "-"}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-sm text-zinc-400">Success Rate</span>
          <span
            className={cn(
              "text-sm font-mono",
              (computedSuccessRate ?? 0) >= 60
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-amber-600 dark:text-amber-400",
            )}
          >
            {computedSuccessRate != null
              ? `${computedSuccessRate}%`
              : finalSuccess != null
                ? `${finalSuccess.toFixed(1)}%`
                : "-"}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-sm text-zinc-400">Best</span>
          <span className="text-sm font-mono text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
            {bestEp ? (
              <>
                <Trophy size={12} /> Ep {bestEp.ep} ({bestEp.reward.toFixed(3)})
              </>
            ) : (
              "-"
            )}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-sm text-zinc-400">Worst</span>
          <span className="text-sm font-mono text-red-600 dark:text-red-400 flex items-center gap-1">
            {worstEp ? (
              <>
                <TrendingDown size={12} /> Ep {worstEp.ep} ({worstEp.reward.toFixed(3)})
              </>
            ) : (
              "-"
            )}
          </span>
        </div>
      </div>

      {episodeResults.length > 0 && (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Reward per Episode
            </span>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <span className="size-2 rounded-sm bg-emerald-500" />
                <span className="text-sm text-zinc-500">&gt;= 0.7</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="size-2 rounded-sm bg-amber-500" />
                <span className="text-sm text-zinc-500">0.5-0.7</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="size-2 rounded-sm bg-red-500" />
                <span className="text-sm text-zinc-500">&lt; 0.5</span>
              </div>
              <span className="text-sm text-zinc-600">- 0.6 baseline</span>
            </div>
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

      {episodeResults.length > 0 && (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Episode Details ({episodeResults.length})
            </span>
          </div>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800/50 max-h-52 overflow-y-auto">
            {episodeResults.map((r) => (
              <div
                key={r.ep}
                className={cn(
                  "flex items-center gap-3 px-4 py-2 transition-colors",
                  r.ep === bestEp?.ep
                    ? "bg-emerald-500/5"
                    : r.ep === worstEp?.ep
                      ? "bg-red-500/5"
                      : "",
                )}
              >
                <span className="text-sm text-zinc-400 font-mono w-14 flex-none flex items-center gap-1">
                  {r.ep === bestEp?.ep && (
                    <Trophy
                      size={10}
                      className="text-emerald-600 dark:text-emerald-400"
                    />
                  )}
                  {r.ep === worstEp?.ep && (
                    <TrendingDown
                      size={10}
                      className="text-red-600 dark:text-red-400"
                    />
                  )}
                  Ep {r.ep}
                </span>
                <div className="flex-1 h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      r.reward >= 0.7
                        ? "bg-emerald-500"
                        : r.reward >= 0.5
                          ? "bg-amber-500"
                          : "bg-red-500",
                    )}
                    style={{ width: `${r.reward * 100}%` }}
                  />
                </div>
                <span
                  className={cn(
                    "text-sm font-mono w-12 text-right flex-none",
                    r.reward >= 0.7
                      ? "text-emerald-600 dark:text-emerald-400"
                      : r.reward >= 0.5
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-red-600 dark:text-red-400",
                  )}
                >
                  {r.reward.toFixed(3)}
                </span>
                {r.frames > 0 && (
                  <span className="text-sm text-zinc-500 w-16 text-right flex-none font-mono">
                    {r.frames} fr
                  </span>
                )}
                <span
                  className={cn(
                    "text-sm w-6 text-right flex-none",
                    r.success
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-zinc-500",
                  )}
                >
                  {r.success ? "✓" : "✗"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 justify-end">
        <button
          onClick={onQuickRerun}
          className={buttonStyles({
            variant: "primary",
            tone: "success",
            className: "h-auto px-4 py-2 gap-1.5",
          })}
        >
          <RotateCcw size={12} /> Quick Rerun (3 ep)
        </button>
        <button
          onClick={onStartNewEvaluation}
          className={buttonStyles({
            variant: "secondary",
            tone: "neutral",
            className: "h-auto px-4 py-2 gap-1.5",
          })}
        >
          <RotateCcw size={12} /> Start New Evaluation
        </button>
        <Link
          to="/train"
          className={buttonStyles({
            variant: "secondary",
            tone: "neutral",
            className: "h-auto px-4 py-2 gap-1.5",
          })}
        >
          <ArrowRight size={12} /> Go to Training
        </Link>
        <Link
          to="/record"
          className={buttonStyles({
            variant: "secondary",
            tone: "neutral",
            className: "h-auto px-4 py-2 gap-1.5",
          })}
        >
          <ArrowRight size={12} /> Record New Data
        </Link>
      </div>
    </div>
  );
}
