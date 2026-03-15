import { AlertTriangle, Loader2 } from "lucide-react";

import { buttonStyles } from "../../../components/ui/button";

export interface EvalPreflightBannerProps {
  preflightReason: string;
  installing: boolean;
  preflightAction: string;
  preflightCommand: string;
  preflightFixLabel: string;
  onInstallCudaTorch: () => void;
  onRunPreflightFix: () => void;
  onStopInstall: () => void;
  onUseCpu: () => void;
}

export function EvalPreflightBanner({
  preflightReason,
  installing,
  preflightAction,
  preflightCommand,
  preflightFixLabel,
  onInstallCudaTorch,
  onRunPreflightFix,
  onStopInstall,
  onUseCpu,
}: EvalPreflightBannerProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/5">
      <AlertTriangle
        size={13}
        className="text-amber-600 dark:text-amber-400 flex-none"
      />
      <span className="text-sm text-amber-600 dark:text-amber-400 flex-1 truncate">
        {preflightReason || "Device preflight failed"}
      </span>
      <div className="flex items-center gap-2 flex-none">
        {installing ? (
          <>
            <span className="flex items-center gap-1.5 text-sm text-zinc-400">
              <Loader2 size={12} className="animate-spin" /> Installing...
            </span>
            <button
              onClick={onStopInstall}
              className={buttonStyles({
                variant: "secondary",
                tone: "danger",
                size: "sm",
                className: "h-auto px-2.5 py-1 text-xs",
              })}
            >
              Stop
            </button>
          </>
        ) : (
          <>
            {preflightAction === "install_torch_cuda" && (
              <button
                onClick={onInstallCudaTorch}
                className={buttonStyles({
                  variant: "primary",
                  tone: "warning",
                  className: "h-auto px-3 py-1.5",
                })}
              >
                Install CUDA PyTorch
              </button>
            )}
            {preflightAction === "install_python_dep" && preflightCommand && (
              <button
                onClick={onRunPreflightFix}
                className={buttonStyles({
                  variant: "primary",
                  tone: "warning",
                  className: "h-auto px-3 py-1.5",
                })}
              >
                {preflightFixLabel}
              </button>
            )}
            {preflightCommand &&
              preflightAction !== "install_torch_cuda" &&
              preflightAction !== "install_python_dep" && (
                <button
                  onClick={onRunPreflightFix}
                  className={buttonStyles({
                    variant: "primary",
                    tone: "warning",
                    className: "h-auto px-3 py-1.5",
                  })}
                >
                  Run Fix
                </button>
              )}
            <button
              onClick={onUseCpu}
              className={buttonStyles({
                variant: "secondary",
                tone: "neutral",
                className: "h-auto px-3 py-1.5",
              })}
            >
              Use CPU
            </button>
          </>
        )}
      </div>
    </div>
  );
}
