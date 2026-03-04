import { AlertTriangle, Loader2 } from "lucide-react";

import type { CudaState } from "../types";

interface TrainPreflightBannerProps {
  cudaState: CudaState;
  preflightReason: string;
  preflightAction: string | null;
  cudaFixRunning: boolean;
  onInstallCuda: () => void;
  onInstallTorchcodecFix: () => void;
  onUseCpu: () => void;
  onStopInstall: () => void;
}

export function TrainPreflightBanner({
  cudaState,
  preflightReason,
  preflightAction,
  cudaFixRunning,
  onInstallCuda,
  onInstallTorchcodecFix,
  onUseCpu,
  onStopInstall,
}: TrainPreflightBannerProps) {
  if (cudaState === "ok") return null;

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/5">
      <AlertTriangle size={13} className="text-amber-600 dark:text-amber-400 flex-none" />
      <span className="text-sm text-amber-600 dark:text-amber-400 flex-1 truncate">{preflightReason || "Environment check failed."}</span>
      <div className="flex items-center gap-2 flex-none">
        {cudaFixRunning ? (
          <>
            <span className="flex items-center gap-1.5 text-sm text-zinc-400">
              <Loader2 size={12} className="animate-spin" /> Installing…
            </span>
            <button
              onClick={onStopInstall}
              className="px-2 py-1 rounded border border-zinc-600 text-zinc-400 text-xs cursor-pointer hover:bg-zinc-800 transition-colors"
            >Stop</button>
          </>
        ) : (
          <>
            {preflightAction === "install_torch_cuda" && (
              <button
                onClick={onInstallCuda}
                className="px-2.5 py-1 rounded border border-amber-500/50 bg-amber-500/10 text-amber-400 text-sm font-medium cursor-pointer hover:bg-amber-500/20 transition-all"
              >Install CUDA PyTorch</button>
            )}
            {preflightAction && preflightAction !== "install_torch_cuda" && (
              <button
                onClick={onInstallTorchcodecFix}
                className="px-2.5 py-1 rounded border border-amber-500/50 bg-amber-500/10 text-amber-400 text-sm font-medium cursor-pointer hover:bg-amber-500/20 transition-all"
              >Auto Fix</button>
            )}
            <button
              onClick={onUseCpu}
              className="px-2.5 py-1 rounded border border-zinc-600 text-zinc-400 text-sm cursor-pointer hover:bg-zinc-800 transition-colors"
            >Use CPU</button>
          </>
        )}
      </div>
    </div>
  );
}
