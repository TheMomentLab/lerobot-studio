import { Lock } from "lucide-react";

import type { HfGateBannerProps } from "../types";

export function HfGateBanner({ authState, level }: HfGateBannerProps) {
  const requirement = level === "hf_write" ? "write" : "read";
  return (
    <div className="rounded-lg border border-amber-300/70 bg-amber-50/80 dark:border-amber-500/40 dark:bg-amber-950/30 px-3 py-2 text-sm text-amber-800 dark:text-amber-200 flex items-center gap-2">
      <Lock size={14} className="flex-none" />
      <span>
        Hugging Face auth required ({requirement}). Current state: <span className="font-mono">{authState}</span>
      </span>
    </div>
  );
}
