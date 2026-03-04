import { CheckCircle2, Loader2 } from "lucide-react";
import { cn } from "../../../components/ui/utils";

const LOADING_STEPS = [
  "Connecting arm...",
  "Opening cameras...",
  "Preparing dataset...",
  "Recording ready",
];

type RecordingLoadingViewProps = {
  loadingStep: number;
};

export function RecordingLoadingView({ loadingStep }: RecordingLoadingViewProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center py-16 gap-6">
      <Loader2 size={32} className="text-zinc-400 animate-spin" />
      <div className="flex flex-col gap-2">
        {LOADING_STEPS.map((step, i) => (
          <div key={step} className="flex items-center gap-2.5">
            {i < loadingStep ? (
              <CheckCircle2 size={14} className="text-emerald-600 dark:text-emerald-400 flex-none" />
            ) : i === loadingStep ? (
              <Loader2 size={14} className="text-zinc-400 animate-spin flex-none" />
            ) : (
              <div className="size-3.5 rounded-full border border-zinc-600 flex-none" />
            )}
            <span className={cn("text-sm",
              i < loadingStep ? "text-zinc-400" :
              i === loadingStep ? "text-zinc-800 dark:text-zinc-200" : "text-zinc-600"
            )}>
              {step}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
