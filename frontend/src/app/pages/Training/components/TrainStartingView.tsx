import { CheckCircle2, Loader2 } from "lucide-react";

import { cn } from "../../../components/ui/utils";
import { LOCAL_DATASETS, STARTING_STEPS } from "../types";

interface TrainStartingViewProps {
  startingStep: number;
  policyType: string;
  datasetSource: "local" | "hf";
  customSteps: number;
  availableDatasets: string[];
}

export function TrainStartingView({
  startingStep,
  policyType,
  datasetSource,
  customSteps,
  availableDatasets,
}: TrainStartingViewProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center py-16 gap-6">
      <Loader2 size={32} className="text-zinc-400 animate-spin" />
      <div className="flex flex-col gap-2">
        {STARTING_STEPS.map((s, i) => (
          <div key={i} className="flex items-center gap-2.5">
            {i < startingStep ? (
              <CheckCircle2 size={14} className="text-emerald-600 dark:text-emerald-400 flex-none" />
            ) : i === startingStep ? (
              <Loader2 size={14} className="text-zinc-400 animate-spin flex-none" />
            ) : (
              <div className="size-3.5 rounded-full border border-zinc-600 flex-none" />
            )}
            <span className={cn("text-sm",
              i < startingStep ? "text-zinc-400" :
              i === startingStep ? "text-zinc-800 dark:text-zinc-200" : "text-zinc-500 dark:text-zinc-600"
            )}>
              {s.label}
            </span>
          </div>
        ))}
      </div>
      <p className="text-sm text-zinc-500">
        {policyType} · {datasetSource === "local" ? (availableDatasets[0] ?? LOCAL_DATASETS[0]) : "HF dataset"} · {customSteps.toLocaleString()} steps
      </p>
    </div>
  );
}
