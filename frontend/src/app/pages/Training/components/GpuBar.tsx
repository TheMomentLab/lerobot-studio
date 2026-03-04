export function GpuBar({ label, value, max, unit }: { label: string; value: number; max: number; unit: string }) {
  const pct = Math.round((value / max) * 100);
  const color = pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-zinc-500 dark:bg-zinc-400";
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-zinc-400 w-20 flex-none">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-zinc-200 dark:bg-zinc-700/80 overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-sm font-mono text-zinc-400 w-24 text-right flex-none">
        {value} / {max} {unit} <span className="text-zinc-500">({pct}%)</span>
      </span>
    </div>
  );
}
