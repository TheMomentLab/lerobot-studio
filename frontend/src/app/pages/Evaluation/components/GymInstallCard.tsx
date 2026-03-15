import { AlertTriangle } from "lucide-react";

import { buttonStyles } from "../../../components/ui/button";

export interface GymInstallCardProps {
  gymModuleName: string;
  installing: boolean;
  onInstall: () => void;
}

export function GymInstallCard({
  gymModuleName,
  installing,
  onInstall,
}: GymInstallCardProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-amber-500/30 bg-amber-500/5">
      <AlertTriangle
        size={16}
        className="text-amber-600 dark:text-amber-400 flex-none"
      />
      <div className="flex-1">
        <span className="text-sm text-amber-600 dark:text-amber-400 font-medium">
          Environment plugin required
        </span>
        <span className="text-sm text-zinc-400 ml-2">{gymModuleName}</span>
      </div>
      <button
        onClick={onInstall}
        disabled={installing}
        className={buttonStyles({
          variant: "primary",
          tone: "warning",
          className: "h-auto px-3 py-1.5",
        })}
      >
        {installing ? "Installing..." : `Install ${gymModuleName}`}
      </button>
    </div>
  );
}
