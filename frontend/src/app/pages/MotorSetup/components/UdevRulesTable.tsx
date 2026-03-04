import type { RuleItem } from "../types";

interface UdevRulesTableProps {
  armRules: RuleItem[];
}

export function UdevRulesTable({ armRules }: UdevRulesTableProps) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/30">
            {["Port", "SYMLINK", "MODE", "STATUS"].map((h) => (
              <th key={h} className="text-left py-1.5 px-3 text-zinc-400 font-normal">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
          {armRules.length === 0 ? (
            <tr>
              <td colSpan={4} className="py-3 px-3 text-sm text-zinc-500">No arm udev rules yet.</td>
            </tr>
          ) : armRules.map((row) => (
            <tr key={`${row.kernel ?? "?"}-${row.symlink ?? "?"}`}>
              <td className="py-1.5 px-3 font-mono text-zinc-500">{row.kernel ?? "-"}</td>
              <td className="py-1.5 px-3 font-mono text-zinc-400">{row.symlink ?? "-"}</td>
              <td className="py-1.5 px-3 font-mono text-zinc-500">{row.mode ?? "-"}</td>
              <td className="py-1.5 px-3">
                <span className={row.exists ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>
                  {row.exists ? "Active" : "Missing"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
