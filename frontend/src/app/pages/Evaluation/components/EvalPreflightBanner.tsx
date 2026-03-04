import { AlertTriangle, Loader2 } from "lucide-react";

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
              className="px-2 py-1 rounded border border-zinc-600 text-zinc-400 text-xs cursor-pointer hover:bg-zinc-800 transition-colors"
            >
              Stop
            </button>
          </>
        ) : (
          <>
            {preflightAction === "install_torch_cuda" && (
              <button
                onClick={onInstallCudaTorch}
                className="px-2.5 py-1 rounded border border-amber-500/50 bg-amber-500/10 text-amber-400 text-sm font-medium cursor-pointer hover:bg-amber-500/20 transition-all"
              >
                Install CUDA PyTorch
              </button>
            )}
            {preflightAction === "install_python_dep" && preflightCommand && (
              <button
                onClick={onRunPreflightFix}
                className="px-2.5 py-1 rounded border border-amber-500/50 bg-amber-500/10 text-amber-400 text-sm font-medium cursor-pointer hover:bg-amber-500/20 transition-all"
              >
                {preflightFixLabel}
              </button>
            )}
            {preflightCommand &&
              preflightAction !== "install_torch_cuda" &&
              preflightAction !== "install_python_dep" && (
                <button
                  onClick={onRunPreflightFix}
                  className="px-2.5 py-1 rounded border border-amber-500/50 bg-amber-500/10 text-amber-400 text-sm font-medium cursor-pointer hover:bg-amber-500/20 transition-all"
                >
                  Run Fix
                </button>
              )}
            <button
              onClick={onUseCpu}
              className="px-2.5 py-1 rounded border border-zinc-600 text-zinc-400 text-sm cursor-pointer hover:bg-zinc-800 transition-colors"
            >
              Use CPU
            </button>
          </>
        )}
      </div>
    </div>
  );
}
