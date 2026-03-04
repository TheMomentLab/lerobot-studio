import type { LogLine } from "../../store/types";
import type { EpisodeResult } from "../../hooks/useEvalProgress";

export const EMPTY_LOG: LogLine[] = [];

export type EvalPreflightResponse = {
  ok: boolean;
  reason?: string;
  action?: string;
  command?: string;
};

export type RewardTooltipEntry = {
  payload?: EpisodeResult;
};
