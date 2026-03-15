import type { Dispatch, SetStateAction } from "react";
import { Bot, Loader2, Trash2, Zap } from "lucide-react";
import { buttonStyles } from "../../../components/ui/button";
import { Card, EmptyState, WireSelect } from "../../../components/wireframe";
import type { ArmDevice } from "../types";

interface MappingTabPanelProps {
  arms: ArmDevice[];
  armRoleMap: Record<string, string>;
  onSetArmRoleMap: Dispatch<SetStateAction<Record<string, string>>>;
  hasAnyMapping: boolean;
  onClearAllMappings: () => void;
  autoApplying: boolean;
  onRoleChange: (nextMap: Record<string, string>) => void;
  onOpenIdentify: () => void;
}

export function MappingTabPanel({
  arms,
  armRoleMap,
  onSetArmRoleMap,
  hasAnyMapping,
  onClearAllMappings,
  autoApplying,
  onRoleChange,
  onOpenIdentify,
}: MappingTabPanelProps) {
  return (
    <div className="flex flex-col gap-4">
      {arms.length === 0 ? (
        <Card
          title={`Arm Mapping (${arms.length})`}
        >
          <EmptyState
            icon={<Zap size={28} />}
            message="No arms detected. Connect USB and refresh."
            messageClassName="max-w-none whitespace-nowrap"
          />
        </Card>
      ) : (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Arm Mapping ({arms.length})</span>
            {autoApplying && (
              <span className="flex items-center gap-1.5 text-xs text-zinc-400">
                <Loader2 size={12} className="animate-spin" /> Applying…
              </span>
            )}
          </div>
          <div className="px-4 flex-1">
            <div className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800/50 border-b border-zinc-100 dark:border-zinc-800/50">
              {arms.map((arm) => (
                <div key={arm.device} className="flex items-center gap-3 py-2.5">
                  <div className="size-7 rounded bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                    <Bot size={14} className="text-zinc-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-zinc-700 dark:text-zinc-300 font-mono truncate">{arm.path}</div>
                    {arm.serial && <div className="text-sm text-zinc-400">S/N: {arm.serial}</div>}
                  </div>
                  <div className="w-44 flex-none">
                    <WireSelect
                      value={armRoleMap[arm.device] ?? "(none)"}
                      options={["(none)", "Follower Arm 1", "Follower Arm 2", "Leader Arm 1", "Leader Arm 2"]}
                      onChange={(v) => {
                        const next = { ...armRoleMap };
                        if (v !== "(none)") {
                          for (const key of Object.keys(next)) {
                            if (next[key] === v) next[key] = "(none)";
                          }
                        }
                        next[arm.device] = v;
                        onSetArmRoleMap(next);
                        onRoleChange(next);
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      )}

      {arms.length > 0 && (
        <div className="flex justify-end gap-2">
          {hasAnyMapping && (
            <button
              onClick={onClearAllMappings}
              disabled={autoApplying}
              className={buttonStyles({
                variant: "secondary",
                tone: "neutral",
                className: "h-10 px-4 whitespace-nowrap",
              })}
            >
              <Trash2 size={12} className="inline mr-1.5" />
              Clear All
            </button>
          )}
          <button
            onClick={onOpenIdentify}
            className={buttonStyles({
              variant: "primary",
              tone: "neutral",
              className: "h-10 px-5 whitespace-nowrap",
            })}
          >
              <Zap size={12} className="inline mr-1.5" />
              Identify Arm
          </button>
        </div>
      )}
    </div>
  );
}
