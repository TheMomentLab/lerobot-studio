import { CheckCircle2, ChevronDown, ChevronUp, Copy, ExternalLink, Loader2, Upload } from "lucide-react";

import { cn } from "../../../components/ui/utils";
import { HfGateBanner } from "./HfGateBanner";

interface ColabPanelProps {
  colabOpen: boolean;
  setColabOpen: (value: boolean) => void;
  hfAuth: string;
  colabRepoId: string;
  selectedRepoId: string;
  pushState: "idle" | "pushing" | "done";
  onPushToHub: () => void;
  handleCopySnippet: () => void;
  colabCopied: boolean;
  colabSnippet: string;
  handleOpenColab: () => void;
  colabStarting: boolean;
  device: string;
}

export function ColabPanel({
  colabOpen,
  setColabOpen,
  hfAuth,
  colabRepoId,
  selectedRepoId,
  pushState,
  onPushToHub,
  handleCopySnippet,
  colabCopied,
  colabSnippet,
  handleOpenColab,
  colabStarting,
  device,
}: ColabPanelProps) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
      <button
        onClick={() => setColabOpen(!colabOpen)}
        className="w-full flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800 gap-2 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors"
      >
        <img src="/colab-logo.png" alt="" aria-hidden="true" className="size-3.5 object-contain" />
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Colab Training</span>
        <span className="text-sm text-zinc-400 ml-1">Train on Google Colab when you don't have a GPU</span>
        {colabOpen ? <ChevronUp size={10} className="ml-auto text-zinc-400" /> : <ChevronDown size={10} className="ml-auto text-zinc-400" />}
      </button>
      {colabOpen && (
        <div className="px-4 py-4 flex flex-col gap-4">
          {hfAuth !== "ready" && (
            <HfGateBanner authState={hfAuth} level="hf_write" />
          )}

          <div className="flex items-center gap-3 flex-wrap">
            <span className="flex-none size-5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold grid place-items-center leading-[0]">1</span>
            <p className="text-sm text-zinc-600 dark:text-zinc-300 font-medium">Upload dataset to HF Hub</p>
            <code className="text-[11px] text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded truncate">
              {colabRepoId || selectedRepoId || "lerobot-user/pick_cube"}
            </code>
            <button
              disabled={hfAuth !== "ready" || pushState !== "idle"}
              onClick={onPushToHub}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2 rounded border text-sm font-medium transition-colors whitespace-nowrap",
                pushState === "done"
                  ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/15"
                  : "border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5",
                hfAuth !== "ready" ? "opacity-40 cursor-not-allowed"
                  : pushState === "pushing" ? "opacity-70 cursor-wait"
                  : pushState === "done" ? "cursor-default"
                  : "hover:bg-emerald-500/10 cursor-pointer"
              )}
            >
              {pushState === "pushing" ? <Loader2 size={12} className="animate-spin" />
                : pushState === "done" ? <CheckCircle2 size={12} />
                : <Upload size={12} />}
              {pushState === "pushing" ? "Pushing…" : pushState === "done" ? "Pushed!" : "Push to Hub"}
            </button>
          </div>

          <div className="flex items-start gap-3">
            <span className="flex-none size-5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold grid place-items-center leading-[0] mt-0.5">2</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-zinc-600 dark:text-zinc-300 font-medium mb-1.5">Paste config snippet into Colab</p>
              <div className="relative rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-900 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2 bg-zinc-800 border-b border-zinc-700">
                  <span className="text-sm text-zinc-400 font-mono">python</span>
                  <button
                    onClick={handleCopySnippet}
                    disabled={hfAuth !== "ready"}
                    className={cn(
                      "flex items-center gap-1 text-sm transition-colors",
                      hfAuth !== "ready" ? "text-zinc-600 cursor-not-allowed" : "text-zinc-400 hover:text-zinc-200 cursor-pointer"
                    )}
                  >
                    <Copy size={10} />
                    {colabCopied ? "Copied!" : "Copy"}
                  </button>
                </div>
                <pre className="p-3 text-sm text-zinc-300 font-mono overflow-auto leading-relaxed whitespace-pre max-h-48">
                  {colabSnippet}
                </pre>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <span className="flex-none size-5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold grid place-items-center leading-[0]">3</span>
            <p className="text-sm text-zinc-600 dark:text-zinc-300 font-medium">Open and run Colab notebook</p>
            <button
              type="button"
              onClick={handleOpenColab}
              disabled={hfAuth !== "ready" || colabStarting}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2 rounded border text-sm transition-colors",
                "border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300",
                hfAuth !== "ready" ? "opacity-40 cursor-not-allowed"
                  : colabStarting ? "opacity-70 cursor-wait"
                  : "hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer"
              )}
            >
              {colabStarting ? <Loader2 size={12} className="animate-spin" /> : <ExternalLink size={12} />}
              {colabStarting ? "Opening..." : "Open Colab Notebook"}
            </button>
          </div>

          {device === "MPS (Apple Silicon)" && (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              ⚠ Colab automatically uses CUDA instead of MPS.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
