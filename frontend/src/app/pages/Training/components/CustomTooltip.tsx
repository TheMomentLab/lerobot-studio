import type { LossTooltipEntry } from "../types";

export function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: LossTooltipEntry[];
  label?: number | string;
}) {
  if (!active || !payload?.length) return null;
  const loss = payload[0]?.value;
  if (typeof loss !== "number") return null;

  return (
    <div className="px-3 py-2 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm font-mono shadow-xl">
      <div className="text-zinc-400 mb-1">Step {label?.toLocaleString()}</div>
      <div className="text-zinc-800 dark:text-zinc-200">loss: {loss.toFixed(5)}</div>
    </div>
  );
}
