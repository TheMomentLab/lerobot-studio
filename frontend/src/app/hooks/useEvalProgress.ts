/**
 * useEvalProgress — Parse eval process stdout to track real progress.
 *
 * Ported from frontend_legacy/src/hooks/useEvalProgress.ts with additions:
 *   - episodeResults[] for per-episode chart data
 *   - adapted to current frontend store types
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LogLine } from "../store/types";

// ─── Types ───────────────────────────────────────────────────────────────────

export type EvalProgressStatus =
  | "idle"
  | "starting"
  | "running"
  | "stopped"
  | "completed"
  | "error";

export interface EpisodeReward {
  ep: number;
  reward: number;
}

export interface EpisodeResult {
  ep: number;
  reward: number;
  frames: number;
  success: boolean;
}

interface EvalProgressStyle {
  label: string;
  bg: string;
  color: string;
}

interface UseEvalProgressArgs {
  evalLogLines: LogLine[];
  running: boolean;
}

// ─── Markers ─────────────────────────────────────────────────────────────────

const COMPLETE_MARKER =
  /evaluation complete|end of evaluation|eval complete|end of eval/i;
const END_MARKER = /\[eval process ended\]/i;
const ERROR_MARKER = /\[ERROR\]|Traceback|RuntimeError|Exception|failed/i;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseSuccessPercent(rawValue: string): number | null {
  const raw = Number(rawValue);
  if (!Number.isFinite(raw)) return null;
  return raw > 1 ? Math.min(100, raw) : Math.max(0, raw * 100);
}

export function formatReward(value: number | null): string {
  return Number.isFinite(value) ? Number(value).toFixed(4) : "--";
}

export function formatSuccess(value: number | null): string {
  return Number.isFinite(value) ? `${Number(value).toFixed(1)}%` : "--";
}

export function formatClock(ms: number | null): string {
  if (!ms) return "--";
  return new Date(ms).toLocaleTimeString();
}

export function formatElapsed(
  startedAtMs: number | null,
  endedAtMs: number | null,
): string {
  if (!startedAtMs) return "--";
  const endMs = endedAtMs ?? Date.now();
  const sec = Math.max(0, Math.floor((endMs - startedAtMs) / 1000));
  const mm = String(Math.floor(sec / 60)).padStart(2, "0");
  const ss = String(sec % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useEvalProgress({
  evalLogLines,
  running,
}: UseEvalProgressArgs) {
  // ── Aggregate state ──────────────────────────────────────────────────────
  const [progressStatus, setProgressStatus] =
    useState<EvalProgressStatus>("idle");
  const [doneEpisodes, setDoneEpisodes] = useState(0);
  const [targetEpisodes, setTargetEpisodes] = useState<number | null>(null);
  const [meanReward, setMeanReward] = useState<number | null>(null);
  const [successRate, setSuccessRate] = useState<number | null>(null);
  const [finalReward, setFinalReward] = useState<number | null>(null);
  const [finalSuccess, setFinalSuccess] = useState<number | null>(null);
  const [bestEpisode, setBestEpisode] = useState<EpisodeReward | null>(null);
  const [worstEpisode, setWorstEpisode] = useState<EpisodeReward | null>(null);
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null);
  const [endedAtMs, setEndedAtMs] = useState<number | null>(null);
  const [hadError, setHadError] = useState(false);
  const [elapsedTick, setElapsedTick] = useState(0);
  const [lastMetricUpdateMs, setLastMetricUpdateMs] = useState<number | null>(
    null,
  );

  // ── Per-episode results (for chart) ──────────────────────────────────────
  const [episodeResults, setEpisodeResults] = useState<EpisodeResult[]>([]);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const processedLogsRef = useRef(0);
  const perEpisodeRewardRef = useRef<Record<number, number>>({});
  const perEpisodeDataRef = useRef<
    Record<number, { reward: number; success: boolean; frames: number }>
  >({});
  const doneEpisodesRef = useRef(0);
  const targetEpisodesRef = useRef<number | null>(null);
  const meanRewardRef = useRef<number | null>(null);
  const successRateRef = useRef<number | null>(null);
  const hadErrorRef = useRef(false);

  // ── Sync refs ────────────────────────────────────────────────────────────
  useEffect(() => {
    doneEpisodesRef.current = doneEpisodes;
  }, [doneEpisodes]);
  useEffect(() => {
    targetEpisodesRef.current = targetEpisodes;
  }, [targetEpisodes]);
  useEffect(() => {
    meanRewardRef.current = meanReward;
  }, [meanReward]);
  useEffect(() => {
    successRateRef.current = successRate;
  }, [successRate]);
  useEffect(() => {
    hadErrorRef.current = hadError;
  }, [hadError]);

  // ── Updaters ─────────────────────────────────────────────────────────────

  const updateDoneEpisodes = useCallback((done: number) => {
    setDoneEpisodes((prev) => {
      const next = Math.max(prev, done);
      doneEpisodesRef.current = next;
      return next;
    });
  }, []);

  const updateTargetEpisodes = useCallback((target: number) => {
    setTargetEpisodes((prev) => {
      if (!Number.isFinite(target) || target <= 0) return prev;
      targetEpisodesRef.current = target;
      return target;
    });
  }, []);

  const recomputeBestWorst = useCallback(() => {
    const entries = Object.entries(perEpisodeRewardRef.current)
      .map(([ep, reward]) => ({ ep: Number(ep), reward: Number(reward) }))
      .filter((v) => Number.isFinite(v.ep) && Number.isFinite(v.reward));
    if (!entries.length) {
      setBestEpisode(null);
      setWorstEpisode(null);
      return;
    }
    entries.sort((a, b) => a.reward - b.reward);
    setWorstEpisode(entries[0]);
    setBestEpisode(entries[entries.length - 1]);
  }, []);

  const recomputeEpisodeResults = useCallback(() => {
    const results = Object.entries(perEpisodeDataRef.current)
      .map(([ep, data]) => ({
        ep: Number(ep),
        reward: data.reward,
        frames: data.frames,
        success: data.success,
      }))
      .filter((v) => Number.isFinite(v.ep))
      .sort((a, b) => a.ep - b.ep);
    setEpisodeResults(results);
  }, []);

  // ── Reset ────────────────────────────────────────────────────────────────

  const resetEvalState = useCallback((status: EvalProgressStatus) => {
    setProgressStatus(status);
    setDoneEpisodes(0);
    setTargetEpisodes(null);
    setMeanReward(null);
    setSuccessRate(null);
    setFinalReward(null);
    setFinalSuccess(null);
    setBestEpisode(null);
    setWorstEpisode(null);
    setHadError(false);
    setStartedAtMs(null);
    setEndedAtMs(null);
    setElapsedTick(0);
    setLastMetricUpdateMs(null);
    setEpisodeResults([]);
    doneEpisodesRef.current = 0;
    targetEpisodesRef.current = null;
    meanRewardRef.current = null;
    successRateRef.current = null;
    hadErrorRef.current = false;
    processedLogsRef.current = 0;
    perEpisodeRewardRef.current = {};
    perEpisodeDataRef.current = {};
  }, []);

  const beginEval = useCallback(
    (episodes: number, currentLogCount: number) => {
      resetEvalState("starting");
      setStartedAtMs(Date.now());
      setTargetEpisodes(episodes);
      targetEpisodesRef.current = episodes;
      processedLogsRef.current = currentLogCount;
    },
    [resetEvalState],
  );

  const markError = useCallback(() => {
    hadErrorRef.current = true;
    setHadError(true);
    setProgressStatus("error");
  }, []);

  // ── Elapsed timer ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!startedAtMs || endedAtMs) return;
    const timer = window.setInterval(() => setElapsedTick((t) => t + 1), 1000);
    return () => window.clearInterval(timer);
  }, [startedAtMs, endedAtMs]);

  // ── Log parsing ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (evalLogLines.length < processedLogsRef.current) {
      processedLogsRef.current = 0;
    }
    const nextLines = evalLogLines.slice(processedLogsRef.current);
    if (!nextLines.length) return;

    for (const lineItem of nextLines) {
      const line = lineItem.text ?? "";
      if (!line) continue;

      if (lineItem.kind === "error" || ERROR_MARKER.test(line)) {
        markError();
      }

      setLastMetricUpdateMs(lineItem.ts ?? Date.now());

      // ── tqdm progress bar ──
      const tqdmMatch = line.match(
        /Stepping through eval batches:\s*(\d+)%\|.*\|\s*(\d+)\/(\d+)/,
      );
      if (tqdmMatch) {
        const pct = parseInt(tqdmMatch[1], 10);
        const done = parseInt(tqdmMatch[2], 10);
        const total = parseInt(tqdmMatch[3], 10);
        if (Number.isFinite(done)) updateDoneEpisodes(done);
        if (Number.isFinite(total) && total > 0) updateTargetEpisodes(total);
        if (!hadErrorRef.current && pct > 0) setProgressStatus("running");
      }

      // ── Episode total ──
      const epTotalMatch =
        line.match(/(?:^|\s)(?:n_episodes|episodes)\s*[:=]\s*([0-9]+)/i) ||
        line.match(/episode\s*\d+\s*\/\s*([0-9]+)/i) ||
        line.match(/completed\s*episodes\s*[:=]\s*\d+\s*\/\s*([0-9]+)/i);
      if (epTotalMatch) {
        const total = parseInt(epTotalMatch[1], 10);
        if (Number.isFinite(total) && total > 0) updateTargetEpisodes(total);
      }

      // ── Done episodes ──
      const doneMatch =
        line.match(/episode\s*([0-9]+)\s*\/\s*([0-9]+)/i) ||
        line.match(/completed\s*episodes\s*[:=]\s*([0-9]+)\s*\/\s*([0-9]+)/i) ||
        line.match(/\bepisode\s*[:#]\s*([0-9]+)\b/i);
      if (doneMatch) {
        const done = parseInt(doneMatch[1], 10);
        if (Number.isFinite(done) && done >= 0) {
          updateDoneEpisodes(done);
          if (!hadErrorRef.current) setProgressStatus("running");
        }
        if (doneMatch[2]) {
          const total = parseInt(doneMatch[2], 10);
          if (Number.isFinite(total) && total > 0) updateTargetEpisodes(total);
        }
      }

      // ── Per-episode result (e.g. "episode 3: reward=0.54 success=True frames=180") ──
      const perEpMatch = line.match(
        /episode\s*(\d+).*?reward\s*[:=]\s*([+-]?\d*\.?\d+(?:e[+-]?\d+)?)/i,
      );
      if (perEpMatch) {
        const epNum = parseInt(perEpMatch[1], 10);
        const reward = Number(perEpMatch[2]);
        if (Number.isFinite(epNum) && Number.isFinite(reward)) {
          const successMatch = line.match(
            /success\s*[:=]\s*(true|false|1|0)/i,
          );
          const framesMatch = line.match(/frames?\s*[:=]\s*(\d+)/i);
          const success = successMatch
            ? successMatch[1].toLowerCase() === "true" ||
              successMatch[1] === "1"
            : reward >= 0.6;
          const frames = framesMatch ? parseInt(framesMatch[1], 10) : 0;
          perEpisodeRewardRef.current[epNum] = reward;
          perEpisodeDataRef.current[epNum] = { reward, success, frames };
          recomputeBestWorst();
          recomputeEpisodeResults();
        }
      }

      // ── Aggregate success rate ──
      const successMatch = line.match(
        /\bsuccess(?:[_\s-]?rate)?\s*[:=]\s*([0-9]*\.?[0-9]+)\s*%?/i,
      );
      if (successMatch) {
        const parsed = parseSuccessPercent(successMatch[1]);
        if (parsed !== null) {
          setSuccessRate(parsed);
          successRateRef.current = parsed;
        }
      }

      // ── Aggregate reward ──
      const rewardMatch = line.match(
        /\b(?:mean[_\s-]?reward|avg[_\s-]?reward|episode[_\s-]?reward)\s*[:=]\s*([+-]?[0-9]*\.?[0-9]+(?:e[+-]?[0-9]+)?)/i,
      );
      if (rewardMatch) {
        const reward = Number(rewardMatch[1]);
        if (Number.isFinite(reward)) {
          setMeanReward(reward);
          meanRewardRef.current = reward;
          const epForReward = line.match(/episode\s*([0-9]+)\b/i);
          if (epForReward) {
            const epIdx = parseInt(epForReward[1], 10);
            if (Number.isFinite(epIdx)) {
              perEpisodeRewardRef.current[epIdx] = reward;
              if (!perEpisodeDataRef.current[epIdx]) {
                perEpisodeDataRef.current[epIdx] = {
                  reward,
                  success: reward >= 0.6,
                  frames: 0,
                };
                recomputeEpisodeResults();
              }
              recomputeBestWorst();
            }
          }
        }
      }

      // ── Final reward ──
      const finalRewardMatch = line.match(
        /(?:final|overall|eval)\s*(?:mean[_\s-]?reward|avg[_\s-]?reward|reward)\s*[:=]\s*([+-]?[0-9]*\.?[0-9]+(?:e[+-]?[0-9]+)?)/i,
      );
      if (finalRewardMatch) {
        const value = Number(finalRewardMatch[1]);
        if (Number.isFinite(value)) setFinalReward(value);
      }

      // ── Final success ──
      const finalSuccessMatch = line.match(
        /(?:final|overall|eval)\s*(?:success(?:[_\s-]?rate)?)\s*[:=]\s*([0-9]*\.?[0-9]+)\s*%?/i,
      );
      if (finalSuccessMatch) {
        const parsed = parseSuccessPercent(finalSuccessMatch[1]);
        if (parsed !== null) setFinalSuccess(parsed);
      }

      // ── Aggregated JSON keys ──
      const aggregatedMatch = line.match(
        /['"](?:sum_reward|avg_reward|mean_reward)['"]\s*:\s*([+-]?\d*\.?\d+(?:e[+-]?\d+)?)/i,
      );
      if (aggregatedMatch) {
        const val = Number(aggregatedMatch[1]);
        if (Number.isFinite(val))
          setFinalReward((prev) => prev ?? val);
      }

      const aggregatedSuccessMatch = line.match(
        /['"]pc_success['"]\s*:\s*([+-]?\d*\.?\d+(?:e[+-]?\d+)?)/i,
      );
      if (aggregatedSuccessMatch) {
        const val = Number(aggregatedSuccessMatch[1]);
        if (Number.isFinite(val))
          setFinalSuccess((prev) => prev ?? (val > 1 ? val : val * 100));
      }

      // ── Completion ──
      if (COMPLETE_MARKER.test(line)) {
        setProgressStatus((prev) => (prev === "error" ? "error" : "completed"));
        setEndedAtMs((prev) => prev ?? lineItem.ts ?? Date.now());
        setFinalReward((prev) =>
          Number.isFinite(prev) ? prev : meanRewardRef.current,
        );
        setFinalSuccess((prev) =>
          Number.isFinite(prev) ? prev : successRateRef.current,
        );
      }

      // ── Process end ──
      if (END_MARKER.test(line)) {
        setEndedAtMs((prev) => prev ?? lineItem.ts ?? Date.now());
        setProgressStatus((prev) => {
          if (prev === "error") return "error";
          if (
            targetEpisodesRef.current &&
            doneEpisodesRef.current >= targetEpisodesRef.current
          )
            return "completed";
          return "stopped";
        });
      }
    }

    processedLogsRef.current = evalLogLines.length;
  }, [
    evalLogLines,
    markError,
    recomputeBestWorst,
    recomputeEpisodeResults,
    updateDoneEpisodes,
    updateTargetEpisodes,
  ]);

  // ── Process running sync ─────────────────────────────────────────────────

  useEffect(() => {
    if (running) {
      setStartedAtMs((prev) => prev ?? Date.now());
      setEndedAtMs(null);
      setProgressStatus((prev) =>
        prev === "starting" ||
        prev === "error" ||
        prev === "completed"
          ? prev
          : "running",
      );
      return;
    }
    if (startedAtMs && !endedAtMs) {
      setEndedAtMs(Date.now());
      setProgressStatus((prev) => {
        if (prev === "completed" || prev === "error") return prev;
        return doneEpisodesRef.current > 0 ? "stopped" : "idle";
      });
    }
  }, [running, startedAtMs, endedAtMs]);

  // ── Derived ──────────────────────────────────────────────────────────────

  const progressTotal =
    targetEpisodes && targetEpisodes > 0 ? targetEpisodes : null;
  const progressPct = Math.max(
    0,
    Math.min(100, progressTotal ? (doneEpisodes / progressTotal) * 100 : 0),
  );
  const showProgressDetails =
    progressStatus === "running" ||
    progressStatus === "completed" ||
    progressStatus === "stopped" ||
    progressStatus === "error" ||
    doneEpisodes > 0;

  const progressStatusStyle = useMemo<EvalProgressStyle>(() => {
    const map: Record<EvalProgressStatus, EvalProgressStyle> = {
      idle: {
        label: "IDLE",
        bg: "rgba(148,163,184,0.18)",
        color: "var(--text2, #71717a)",
      },
      starting: {
        label: "STARTING",
        bg: "rgba(59,130,246,0.18)",
        color: "#93c5fd",
      },
      running: {
        label: "RUNNING",
        bg: "rgba(34,197,94,0.18)",
        color: "#86efac",
      },
      stopped: {
        label: "STOPPED",
        bg: "rgba(148,163,184,0.18)",
        color: "var(--text2, #71717a)",
      },
      completed: {
        label: "COMPLETED",
        bg: "rgba(16,185,129,0.20)",
        color: "#6ee7b7",
      },
      error: {
        label: "ERROR",
        bg: "rgba(248,81,73,0.20)",
        color: "#fca5a5",
      },
    };
    return map[progressStatus];
  }, [progressStatus]);

  return {
    progressStatus,
    setProgressStatus,
    doneEpisodes,
    targetEpisodes,
    meanReward,
    successRate,
    finalReward,
    finalSuccess,
    bestEpisode,
    worstEpisode,
    startedAtMs,
    endedAtMs,
    setEndedAtMs,
    hadError,
    elapsedTick,
    lastMetricUpdateMs,
    progressTotal,
    progressPct,
    showProgressDetails,
    progressStatusStyle,
    episodeResults,
    resetEvalState,
    beginEval,
    markError,
  };
}
