import { cn } from "../../../components/ui/utils";
import type { RewardTooltipEntry } from "../types";

export function RewardTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: RewardTooltipEntry[];
}) {
  const ep = payload?.[0]?.payload;
  if (!active || !ep) return null;
  return (
    <div className="px-3 py-2 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm shadow-xl">
      <div className="text-zinc-400 mb-1">Episode {ep.ep}</div>
      <div className={ep.success ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
        Reward: {ep.reward.toFixed(3)}
      </div>
      <div className="text-zinc-500">Frames: {ep.frames}</div>
      <div className={cn("mt-0.5", ep.success ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-500")}>
        {ep.success ? "✓ Success" : "✗ Failed"}
      </div>
    </div>
  );
}
