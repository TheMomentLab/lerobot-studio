import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { ChevronUp, ChevronDown, Copy, Eraser, Square, Terminal } from "lucide-react";
import {
  apiPost,
  subscribeNonTrainChannel,
  subscribeTrainChannel,
  type TrainMetricEvent,
  type TrainOutputEvent,
  type TrainStatusEvent,
} from "../../../services/apiClient";
import { cn } from "../../ui/utils";
import { getLeStudioState, useLeStudioStore } from "../../../store";
import {
  PROCESS_NAMES,
  PROCESS_LABELS,
  TAB_TO_PROCESS,
  MIN_CONSOLE_HEIGHT,
  TRAIN_STEP_RE,
  TRAIN_LOSS_RE,
  TRAIN_TOTAL_RE,
  EVAL_DONE_RE,
  EVAL_REWARD_RE,
} from "./constants";
import type { RuntimeProcessName, RunningInfo } from "./types";
import {
  parseCompactNumber,
  formatElapsed,
  formatEta,
  isRuntimeProcessRunning,
  mapOutputLevelToKind,
  logLineClass,
} from "./utils";

export function RuntimeConsoleDrawer() {
  const consoleHeight = useLeStudioStore((s) => s.consoleHeight);
  const setConsoleHeight = useLeStudioStore((s) => s.setConsoleHeight);
  const activeTab = useLeStudioStore((s) => s.activeTab);
  const procStatus = useLeStudioStore((s) => s.procStatus);
  const setProcStatus = useLeStudioStore((s) => s.setProcStatus);
  const appendLog = useLeStudioStore((s) => s.appendLog);
  const clearLog = useLeStudioStore((s) => s.clearLog);
  const addToast = useLeStudioStore((s) => s.addToast);
  const logLines = useLeStudioStore((s) => s.logLines);

  const [collapsed, setCollapsed] = useState(true);
  const [activeProcess, setActiveProcess] = useState<RuntimeProcessName>("teleop");
  const [stdinValue, setStdinValue] = useState("");
  const [elapsedByProcess, setElapsedByProcess] = useState<Record<string, number>>({});

  const dragging = useRef(false);
  const startY = useRef(0);
  const startH = useRef(0);
  const dragOpenedRef = useRef(false);
  const logRef = useRef<HTMLDivElement | null>(null);
  const prevRunningByProcessRef = useRef<Record<string, boolean>>({});
  const startTimesRef = useRef<Record<string, number>>({});
  const trainProgressRef = useRef<{ firstTs: number | null; firstStep: number | null; lastTs: number | null; lastStep: number | null }>({
    firstTs: null,
    firstStep: null,
    lastTs: null,
    lastStep: null,
  });

  const lines = logLines[activeProcess] ?? [];
  const running = isRuntimeProcessRunning(procStatus, activeProcess);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    startY.current = e.clientY;
    startH.current = collapsed ? MIN_CONSOLE_HEIGHT : consoleHeight;
    dragOpenedRef.current = collapsed;
    e.preventDefault();
  }, [collapsed, consoleHeight]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = startY.current - e.clientY;
      const newHeight = Math.max(MIN_CONSOLE_HEIGHT, Math.min(500, startH.current + delta));
      if (dragOpenedRef.current && delta > 10) {
        dragOpenedRef.current = false;
        setCollapsed(false);
      }
      setConsoleHeight(newHeight);
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [setConsoleHeight]);

  useEffect(() => {
    const mapped = TAB_TO_PROCESS[activeTab];
    if (!mapped) return;
    setActiveProcess((prev) => (prev === mapped ? prev : mapped));
  }, [activeTab]);

  useEffect(() => {
    for (const processName of PROCESS_NAMES) {
      const runningNow = isRuntimeProcessRunning(procStatus, processName);
      if (runningNow && !startTimesRef.current[processName]) {
        startTimesRef.current[processName] = Date.now();
      }
      if (!runningNow) {
        delete startTimesRef.current[processName];
      }
    }
  }, [procStatus]);

  useEffect(() => {
    const hasRunning = PROCESS_NAMES.some((processName) => isRuntimeProcessRunning(procStatus, processName));
    if (!hasRunning) return;

    const timer = setInterval(() => {
      const now = Date.now();
      const next: Record<string, number> = {};
      for (const [processName, startedAt] of Object.entries(startTimesRef.current)) {
        next[processName] = Math.max(0, Math.floor((now - startedAt) / 1000));
      }
      setElapsedByProcess(next);
    }, 1000);

    return () => clearInterval(timer);
  }, [procStatus]);

  const runningInfos = useMemo<RunningInfo[]>(() => {
    const results: RunningInfo[] = [];

    for (const processName of PROCESS_NAMES) {
      if (!isRuntimeProcessRunning(procStatus, processName)) continue;

      const processLogs = logLines[processName] ?? [];
      const elapsed = elapsedByProcess[processName] ?? 0;

      if (processName === "train") {
        let step: number | null = null;
        let total: number | null = null;
        let loss: number | null = null;

        for (const line of processLogs) {
          const stepMatch = line.text.match(TRAIN_STEP_RE);
          if (stepMatch) {
            const parsed = parseCompactNumber(stepMatch[1]);
            if (parsed !== null) {
              step = parsed;
            }
          }

          const slashMatch = line.text.match(/([0-9]+)\s*\/\s*([0-9]+)/);
          if (slashMatch) {
            const parsedStep = Number(slashMatch[1]);
            const parsedTotal = Number(slashMatch[2]);
            if (Number.isFinite(parsedStep)) step = parsedStep;
            if (Number.isFinite(parsedTotal) && parsedTotal > 0) total = parsedTotal;
          }

          const totalMatch = line.text.match(TRAIN_TOTAL_RE);
          if (totalMatch) {
            const parsed = Number(totalMatch[1].replace(/[,_]/g, ""));
            if (Number.isFinite(parsed) && parsed > 0) total = parsed;
          }

          const lossMatch = line.text.match(TRAIN_LOSS_RE);
          if (lossMatch) {
            const parsed = Number(lossMatch[1]);
            if (Number.isFinite(parsed)) {
              loss = parsed;
            }
          }
        }

        const pct = step !== null && total ? Math.max(0, Math.min(100, (step / total) * 100)) : null;
        const parts: string[] = [];
        if (step !== null && total) parts.push(`${step} / ${total}`);
        if (loss !== null) parts.push(`loss ${loss.toFixed(4)}`);
        if (step !== null && total) {
          const { firstTs, firstStep, lastTs, lastStep } = trainProgressRef.current;
          if (firstTs !== null && firstStep !== null && lastTs !== null && lastStep !== null) {
            const elapsedSec = (lastTs - firstTs) / 1000;
            const progressed = lastStep - firstStep;
            if (elapsedSec > 0 && progressed > 0 && total > step) {
              const etaSeconds = (total - step) / (progressed / elapsedSec);
              const eta = formatEta(etaSeconds);
              if (eta) parts.push(`ETA ${eta}`);
            }
          }
        }
        if (!parts.length) parts.push(elapsed > 0 ? `Running ${formatElapsed(elapsed)}` : "Starting...");
        results.push({ process: processName, text: parts.join(" · "), pct });
        continue;
      }

      if (processName === "eval") {
        let done = 0;
        let total: number | null = null;
        let reward: number | null = null;
        for (const line of processLogs) {
          const match = line.text.match(EVAL_DONE_RE);
          if (!match) continue;
          const parsedDone = Number(match[1]);
          const parsedTotal = Number(match[2]);
          if (Number.isFinite(parsedDone)) done = Math.max(done, parsedDone);
          if (Number.isFinite(parsedTotal) && parsedTotal > 0) total = parsedTotal;

          const rewardMatch = line.text.match(EVAL_REWARD_RE);
          if (rewardMatch) {
            const parsedReward = Number(rewardMatch[1]);
            if (Number.isFinite(parsedReward)) reward = parsedReward;
          }
        }
        const pct = total ? Math.max(0, Math.min(100, (done / total) * 100)) : null;
        const parts: string[] = [];
        if (total) parts.push(`${done} / ${total} episodes`);
        if (reward !== null) parts.push(`Reward ${reward.toFixed(4)}`);
        if (parts.length === 0) parts.push(elapsed > 0 ? `Running ${formatElapsed(elapsed)}` : "Starting...");
        const text = parts.join(" · ");
        results.push({ process: processName, text, pct });
        continue;
      }

      if (processName === "record") {
        let episode = 0;
        for (const line of processLogs) {
          const match = line.text.match(/episode\s*([0-9]+)/i);
          if (!match) continue;
          const parsedEpisode = Number(match[1]);
          if (Number.isFinite(parsedEpisode)) episode = Math.max(episode, parsedEpisode);
        }
        const text = episode > 0
          ? `Episode ${episode} · ${formatElapsed(elapsed)}`
          : (elapsed > 0 ? `Recording ${formatElapsed(elapsed)}` : "Recording...");
        results.push({ process: processName, text, pct: null });
        continue;
      }

      results.push({
        process: processName,
        text: elapsed > 0 ? `Running ${formatElapsed(elapsed)}` : "Running...",
        pct: null,
      });
    }

    return results.filter((info) => info.process !== TAB_TO_PROCESS[activeTab]);
  }, [activeTab, elapsedByProcess, logLines, procStatus]);
  void runningInfos;

  useEffect(() => {
    let started: RuntimeProcessName | null = null;
    for (const processName of PROCESS_NAMES) {
      const runningNow = isRuntimeProcessRunning(procStatus, processName);
      const wasRunning = !!prevRunningByProcessRef.current[processName];
      if (!wasRunning && runningNow && started === null) {
        started = processName;
      }
      prevRunningByProcessRef.current[processName] = runningNow;
    }

    if (started) {
      setActiveProcess(started);
      setCollapsed(false);
    }
  }, [procStatus]);

  useEffect(() => {
    if (collapsed || !logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [collapsed, lines]);

  useEffect(() => {
    const unsubscribers = [
      subscribeNonTrainChannel("teleop", (event) => {
        appendLog("teleop", event.payload.line, mapOutputLevelToKind(event.payload.level));
      }),
      subscribeNonTrainChannel("record", (event) => {
        appendLog("record", event.payload.line, mapOutputLevelToKind(event.payload.level));
      }),
      subscribeNonTrainChannel("calibrate", (event) => {
        appendLog("calibrate", event.payload.line, mapOutputLevelToKind(event.payload.level));
      }),
      subscribeNonTrainChannel("motor_setup", (event) => {
        appendLog("motor_setup", event.payload.line, mapOutputLevelToKind(event.payload.level));
      }),
      subscribeNonTrainChannel("eval", (event) => {
        appendLog("eval", event.payload.line, mapOutputLevelToKind(event.payload.level));
      }),
    ];

    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, [appendLog]);

  useEffect(() => {
    const unsubscribeStatus = subscribeTrainChannel("status", (event: TrainStatusEvent) => {
      const next = { ...getLeStudioState().procStatus };
      if (event.payload.state === "starting") {
        next.train_install = true;
      } else if (event.payload.state === "running") {
        next.train_install = false;
        next.train = true;
      } else {
        next.train_install = false;
        next.train = false;
      }
      setProcStatus(next);
      appendLog("train", `[status] ${event.payload.state}${event.payload.reason ? ` (${event.payload.reason})` : ""}`, "info");
    });

    const unsubscribeMetric = subscribeTrainChannel("metric", (event: TrainMetricEvent) => {
      appendLog("train", `step=${event.payload.step}/${event.payload.totalSteps} loss=${event.payload.loss.toFixed(5)}`, "info");
      const now = Date.now();
      const tracker = trainProgressRef.current;
      if (tracker.firstTs === null || tracker.firstStep === null) {
        tracker.firstTs = now;
        tracker.firstStep = event.payload.step;
      }
      tracker.lastTs = now;
      tracker.lastStep = event.payload.step;
    });

    const unsubscribeOutput = subscribeTrainChannel("output", (event: TrainOutputEvent) => {
      appendLog("train", event.payload.line, mapOutputLevelToKind(event.payload.level));
    });

    return () => {
      unsubscribeStatus();
      unsubscribeMetric();
      unsubscribeOutput();
    };
  }, [appendLog, setProcStatus]);

  const handleStop = useCallback(async (processName: RuntimeProcessName) => {
    const result = await apiPost<{ ok: boolean; error?: string }>(`/api/process/${processName}/stop`);
    if (!result.ok) {
      addToast(result.error ?? `Failed to stop ${processName}`, "error");
      return;
    }

    const next = {
      ...getLeStudioState().procStatus,
      [processName]: false,
      ...(processName === "train" ? { train_install: false } : {}),
    };
    setProcStatus(next);
    if (processName === "train") {
      trainProgressRef.current = {
        firstTs: null,
        firstStep: null,
        lastTs: null,
        lastStep: null,
      };
    }
    appendLog(processName, "[info] stop requested", "info");
    addToast(`Stopped ${processName}`, "success");
  }, [addToast, appendLog, setProcStatus]);

  const handleCopy = useCallback(async (count?: number) => {
    const target = typeof count === "number" ? lines.slice(Math.max(0, lines.length - count)) : lines;
    const text = target.map((line) => line.text).join("\n");

    try {
      await navigator.clipboard.writeText(text);
      addToast(`Copied ${target.length} line${target.length === 1 ? "" : "s"}`, "success");
    } catch {
      addToast("Failed to copy logs", "error");
    }
  }, [addToast, lines]);

  const sendStdin = useCallback(async () => {
    const input = running ? stdinValue : stdinValue.trim();
    if (!running && !input) return;

    if (running) {
      const response = await apiPost<{ ok: boolean; error?: string }>(`/api/process/${activeProcess}/input`, { text: input });
      if (!response.ok) {
        addToast(response.error ?? `Failed to send input to ${activeProcess}`, "error");
        return;
      }
      appendLog(activeProcess, `> ${input}`, "stdout");
      setStdinValue("");
      return;
    }

    if (input === "clear") {
      clearLog(activeProcess);
      setStdinValue("");
      return;
    }

    const response = await apiPost<{ ok: boolean; error?: string; command?: string }>(`/api/process/${activeProcess}/command`, {
      command: input,
    });
    if (!response.ok) {
      addToast(response.error ?? `Failed to run command on ${activeProcess}`, "error");
      return;
    }

    appendLog(activeProcess, `$ ${response.command ?? input}`, "info");
    addToast(`Command sent to ${activeProcess}`, "success");
    setStdinValue("");
  }, [activeProcess, addToast, appendLog, running, stdinValue]);

  const onInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    void sendStdin();
  }, [sendStdin]);

  return (
    <div
      className="flex-none border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 flex flex-col"
      style={{ height: collapsed ? MIN_CONSOLE_HEIGHT : consoleHeight }}
    >
      <div
        onMouseDown={onMouseDown}
        className="h-1 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-600 cursor-ns-resize flex-none transition-colors"
      />

      <div className="flex items-center gap-2 px-3 h-7 flex-none border-b border-zinc-200 dark:border-zinc-800">
        <Terminal size={12} className="text-zinc-400 flex-none" />
        <span className="text-sm text-zinc-500 font-mono">Console</span>

        <div className="flex items-center gap-1 ml-2">
          {PROCESS_NAMES.map((p) => (
            <button
              key={p}
              onClick={() => setActiveProcess(p)}
              className={cn(
                "px-2 py-0.5 rounded text-sm font-mono transition-colors cursor-pointer",
                activeProcess === p
                  ? "bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                  : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
              )}
            >
              {isRuntimeProcessRunning(procStatus, p) ? (
                <span className="flex items-center gap-1">
                  {PROCESS_LABELS[p]}
                </span>
              ) : (
                PROCESS_LABELS[p]
              )}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1">
          <button
            className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 cursor-pointer"
            title="Copy logs"
            onClick={() => { void handleCopy(); }}
          >
            <Copy size={12} />
          </button>
          <button
            className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 cursor-pointer"
            title="Clear"
            onClick={() => clearLog(activeProcess)}
          >
            <Eraser size={12} />
          </button>
          <button
            className={cn(
              "p-1 cursor-pointer",
              running
                ? "text-red-600 dark:text-red-400 hover:text-red-500"
                : "text-zinc-400 opacity-50 cursor-not-allowed",
            )}
            onClick={() => { if (running) void handleStop(activeProcess); }}
            title="Stop process"
          >
            <Square size={11} className="fill-current" />
          </button>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 cursor-pointer"
          >
            {collapsed ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div ref={logRef} className="flex-1 overflow-y-auto p-2 font-mono" style={{ fontSize: "11px" }}>
          {lines.map((line) => (
            <div key={line.id} className={logLineClass(line.kind)}>
              {line.text}
            </div>
          ))}
          {lines.length === 0 && (
            <div className="text-zinc-400">No output yet. Start a process to stream logs.</div>
          )}
        </div>
      )}

      {!collapsed && (
        <div className="flex items-center gap-2 px-4 py-2 border-t border-zinc-200 dark:border-zinc-800 flex-none">
          <span className="text-zinc-400 font-mono text-sm">›</span>
          <input
            type="text"
            value={stdinValue}
            onChange={(e) => setStdinValue(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={running
              ? "stdin — press Enter to send (empty = newline)"
              : "Enter command and press Enter to run"
            }
            className="flex-1 bg-transparent text-sm font-mono text-zinc-700 dark:text-zinc-300 placeholder:text-zinc-500 outline-none"
          />
          <button
            className="px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 text-xs font-mono text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900 cursor-pointer"
            onClick={() => { void sendStdin(); }}
          >
            Send
          </button>
          <button
            className="px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 text-xs font-mono text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900 cursor-pointer"
            onClick={() => setConsoleHeight(170)}
            title="Reset console height"
          >
            Reset
          </button>
        </div>
      )}
    </div>
  );
}
