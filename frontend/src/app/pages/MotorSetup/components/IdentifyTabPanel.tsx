import { Bot, Zap } from "lucide-react";
import { Card, EmptyState, StatusBadge, WireSelect } from "../../../components/wireframe";
import type { ArmDevice } from "../types";

interface IdentifyTabPanelProps {
  arms: ArmDevice[];
  identifyStep: "idle" | "waiting" | "found" | "conflict";
  identifyRole: string;
  armRoles: string[];
  onSetIdentifyStep: (step: "idle" | "waiting" | "found" | "conflict") => void;
  onSetIdentifyRole: (role: string) => void;
}

export function IdentifyTabPanel({
  arms,
  identifyStep,
  identifyRole,
  armRoles,
  onSetIdentifyStep,
  onSetIdentifyRole,
}: IdentifyTabPanelProps) {
  return (
    <div className="flex flex-col gap-4">
      {arms.length === 0 ? (
        <Card title={`Connected Arms (${arms.length})`}>
          <EmptyState
            icon={<Zap size={28} />}
            message="No arms detected. Connect USB and refresh."
            messageClassName="max-w-none whitespace-nowrap"
          />
        </Card>
      ) : (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Connected Arms ({arms.length})</span>
          </div>
          <div className="px-4 flex-1">
            <div className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800/50">
              {arms.map((arm) => (
                <div key={arm.device} className="flex items-center gap-3 py-2.5">
                  <div className="size-7 rounded bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                    <Bot size={14} className="text-zinc-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-zinc-700 dark:text-zinc-300 font-mono truncate">{arm.path}</div>
                    {arm.serial && <div className="text-sm text-zinc-400">S/N: {arm.serial}</div>}
                  </div>
                  <StatusBadge status={arm.symlink ? "ready" : "warning"} label={arm.symlink ?? "no symlink"} />
                </div>
              ))}
            </div>
          </div>

          {identifyStep === "idle" && (
            <div className="px-4 py-3 border-t border-zinc-100 dark:border-zinc-800/50 flex items-center gap-3">
              <span className="text-sm text-zinc-500">Disconnect one arm from USB, then click Start.</span>
              <button
                onClick={() => onSetIdentifyStep("waiting")}
                className="ml-auto px-4 py-2 rounded border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer whitespace-nowrap"
              >
                <Zap size={12} className="inline mr-1.5" />
                Start Identify
              </button>
            </div>
          )}
        </div>
      )}

      {identifyStep === "waiting" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 px-3 py-2 rounded border border-amber-500/30 bg-amber-500/5">
            <span className="size-2 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-sm text-amber-400">Reconnect the arm... Detecting changes (1.5s polling)</span>
          </div>
          <div className="flex items-center gap-3">
            {import.meta.env.DEV && <button onClick={() => onSetIdentifyStep("found")} className="text-sm text-zinc-400 hover:text-zinc-600 cursor-pointer underline w-fit">
              (Demo: detected)
            </button>}
            <button onClick={() => onSetIdentifyStep("idle")} className="text-sm text-red-400 hover:text-red-500 cursor-pointer w-fit">
              Cancel
            </button>
          </div>
        </div>
      )}

      {identifyStep === "found" && (
        <div className="flex flex-col gap-3">
          <div className="px-3 py-2.5 rounded border border-emerald-500/30 bg-emerald-500/5">
            <p className="text-sm text-emerald-400 mb-1.5">✓ Arm detected. Assign a role below.</p>
          </div>
          <div className="flex items-center gap-2">
            <WireSelect value={identifyRole} options={armRoles} onChange={onSetIdentifyRole} />
            <button
              onClick={() => { onSetIdentifyStep("idle"); onSetIdentifyRole("(none)"); }}
              disabled={identifyRole === "(none)"}
              className="px-4 py-2 rounded-lg border border-emerald-500/50 bg-emerald-500/10 text-emerald-400 text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Assign
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
