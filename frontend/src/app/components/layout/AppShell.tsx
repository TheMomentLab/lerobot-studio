import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Outlet, NavLink, useLocation, useNavigate } from "react-router";
import { cn } from "../ui/utils";
import { useTheme } from "../../theme-context";
import { HfAuthProvider, useHfAuth } from "../../hf-auth-context";
import { StepperNav } from "../wireframe";
import { getLeStudioState, mapActiveTabToPath, mapPathnameToActiveTab, useLeStudioStore } from "../../store";
import {
  apiGet,
  apiDelete,
  apiPost,
  subscribeNonTrainChannel,
  subscribeTrainChannel,
  type TrainMetricEvent,
  type TrainOutputEvent,
  type TrainStatusEvent,
} from "../../services/apiClient";
import {
  Monitor, Camera, Settings, Video, Database, Brain, FlaskConical,
  Moon, Sun, Menu, X, ChevronRight, Terminal, ChevronUp, ChevronDown, Copy, Trash2, Play, RefreshCw, Square,
} from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "../ui/popover";

// ─── Nav Config ───────────────────────────────────────────────────────────────
const NAV_GROUPS = [
  {
    id: "hardware",
    label: "Hardware",
    items: [
      { path: "/", label: "System Status", icon: Monitor },
      { path: "/motor-setup", label: "Motor Setup", icon: Settings },
      { path: "/camera-setup", label: "Camera Setup", icon: Camera },
    ],
  },
  {
    id: "operate",
    label: "Operate",
    items: [
      { path: "/teleop", label: "Teleop", icon: Play },
      { path: "/recording", label: "Recording", icon: Video },
    ],
  },
  {
    id: "data",
    label: "Data",
    items: [
      { path: "/dataset", label: "Dataset", icon: Database },
    ],
  },
  {
    id: "ml",
    label: "ML",
    items: [
      { path: "/training", label: "Training", icon: Brain },
      { path: "/evaluation", label: "Evaluation", icon: FlaskConical },
    ],
  },
];

// ─── Sidebar ──────────────────────────────────────────────────────────────────
function Sidebar({ collapsed, onClose }: { collapsed: boolean; onClose?: () => void }) {
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    hardware: true, operate: true, data: true, ml: true,
  });

  const toggle = (id: string) =>
    setOpenGroups((prev) => ({ ...prev, [id]: !prev[id] }));

  return (
    <nav
      className={cn(
        "h-full flex flex-col bg-zinc-50 dark:bg-zinc-950 border-r border-zinc-200 dark:border-zinc-800 overflow-y-auto flex-none transition-all duration-200",
        collapsed ? "w-12" : "w-52"
      )}
    >
      {/* Close button (mobile) */}
      {onClose && (
        <div className="flex justify-end p-2 md:hidden">
          <button onClick={onClose} className="p-1 text-zinc-400 hover:text-zinc-600">
            <X size={16} />
          </button>
        </div>
      )}

      <div className="p-2 flex flex-col gap-0.5 flex-1">
        {NAV_GROUPS.map((group, idx) => (
          <div key={group.id} className={cn("mb-1", idx > 0 && "mt-1 pt-1 border-t border-zinc-200/60 dark:border-zinc-800/60")}>
            {/* Group Header */}
            {!collapsed && (
              <button
                onClick={() => toggle(group.id)}
                className="w-full flex items-center justify-between px-2 py-1 text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded cursor-pointer"
              >
                <span className="uppercase tracking-wider" style={{ fontSize: "10px" }}>
                  {group.label}
                </span>
                {openGroups[group.id] ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              </button>
            )}

            {/* Items */}
            {(collapsed || openGroups[group.id]) && (
              <div className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      end={item.path === "/"}
                      onClick={onClose}
                      className={({ isActive }) =>
                        cn(
                          "flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors",
                          collapsed ? "justify-center" : "",
                          isActive
                            ? "bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
                            : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 hover:text-zinc-700 dark:hover:text-zinc-300"
                        )
                      }
                      title={collapsed ? item.label : undefined}
                    >
                      <Icon size={14} className="flex-none" />
                      {!collapsed && (
                        <span className="flex-1 truncate">{item.label}</span>
                      )}
                    </NavLink>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </nav>
  );
}

// ─── Console Drawer ───────────────────────────────────────────────────────────
const MIN_CONSOLE_HEIGHT = 32;

const PROCESS_NAMES = ["teleop", "record", "calibrate", "motor_setup", "train", "eval"] as const;
type RuntimeProcessName = (typeof PROCESS_NAMES)[number];

const PROCESS_LABELS: Record<RuntimeProcessName, string> = {
  teleop: "Teleop",
  record: "Record",
  calibrate: "Calibrate",
  motor_setup: "Motor Setup",
  train: "Train",
  eval: "Eval",
};

const TAB_TO_PROCESS: Partial<Record<string, RuntimeProcessName>> = {
  teleop: "teleop",
  record: "record",
  calibrate: "calibrate",
  "motor-setup": "motor_setup",
  train: "train",
  eval: "eval",
};

const PROCESS_TO_TAB: Record<RuntimeProcessName, "teleop" | "record" | "calibrate" | "motor-setup" | "train" | "eval"> = {
  teleop: "teleop",
  record: "record",
  calibrate: "motor-setup",
  motor_setup: "motor-setup",
  train: "train",
  eval: "eval",
};

const TRAIN_STEP_RE = /\bstep\s*[:=]\s*([0-9]+(?:\.[0-9]+)?[KMBTQ]?)/i;
const TRAIN_LOSS_RE = /\bloss\s*[:=]\s*([+-]?[0-9]*\.?[0-9]+(?:e[+-]?[0-9]+)?)/i;
const TRAIN_TOTAL_RE = /cfg\.steps=([0-9_,]+)/i;
const EVAL_DONE_RE = /episode\s*([0-9]+)\s*\/\s*([0-9]+)/i;
const EVAL_REWARD_RE = /\b(?:mean[_\s-]?reward|avg[_\s-]?reward|episode[_\s-]?reward|reward)\s*[:=]\s*([+-]?[0-9]*\.?[0-9]+(?:e[+-]?[0-9]+)?)/i;

function parseCompactNumber(token: string): number | null {
  const raw = token.trim().toUpperCase();
  const match = raw.match(/^([0-9]+(?:\.[0-9]+)?)([KMBTQ]?)$/);
  if (!match) {
    const value = Number(raw.replace(/,/g, ""));
    return Number.isFinite(value) ? Math.floor(value) : null;
  }

  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;

  const unit = match[2];
  const mult = unit === "K"
    ? 1_000
    : unit === "M"
      ? 1_000_000
      : unit === "B"
        ? 1_000_000_000
        : unit === "T"
          ? 1_000_000_000_000
          : unit === "Q"
            ? 1_000_000_000_000_000
            : 1;
  return Math.floor(value * mult);
}

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatEta(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.ceil(seconds)}s`;
}

function isRuntimeProcessRunning(status: Record<string, boolean>, processName: RuntimeProcessName): boolean {
  if (processName === "train") return !!(status.train || status.train_install);
  return !!status[processName];
}

function mapOutputLevelToKind(level: "info" | "warn" | "error"): "stdout" | "warn" | "error" {
  if (level === "warn") return "warn";
  if (level === "error") return "error";
  return "stdout";
}

function logLineClass(kind: string): string {
  if (kind === "stderr" || kind === "error") return "text-red-600 dark:text-red-400";
  if (kind === "warn") return "text-amber-600 dark:text-amber-400";
  if (kind === "info") return "text-zinc-500 dark:text-zinc-300";
  return "text-zinc-500 dark:text-zinc-400";
}

type RunningInfo = {
  process: RuntimeProcessName;
  text: string;
  pct: number | null;
};

function RuntimeConsoleDrawer() {
  const consoleHeight = useLeStudioStore((s) => s.consoleHeight);
  const setConsoleHeight = useLeStudioStore((s) => s.setConsoleHeight);
  const activeTab = useLeStudioStore((s) => s.activeTab);
  const setActiveTab = useLeStudioStore((s) => s.setActiveTab);
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

  useEffect(() => {
    let started: RuntimeProcessName | null = null;
    let anyRunning = false;
    for (const processName of PROCESS_NAMES) {
      const runningNow = isRuntimeProcessRunning(procStatus, processName);
      const wasRunning = !!prevRunningByProcessRef.current[processName];
      if (!wasRunning && runningNow && started === null) {
        started = processName;
      }
      if (runningNow) anyRunning = true;
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
        className="h-1 bg-transparent hover:bg-zinc-300 dark:hover:bg-zinc-700 cursor-ns-resize flex-none transition-colors"
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
            <Trash2 size={12} />
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

      {/* Running summary chips intentionally hidden to avoid duplicate process controls with Console header */}

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

// ─── Header ───────────────────────────────────────────────────────────────────
function Header({
  onToggleSidebar,
  onMobileToggle,
}: {
  onToggleSidebar: () => void;
  onMobileToggle: () => void;
}) {
  const { theme, toggleTheme } = useTheme();
  const [wsStatus] = useState<"connected" | "unstable" | "disconnected">("connected");
  const { hfAuth, refreshHfAuth } = useHfAuth();
  const hfUsername = useLeStudioStore((s) => s.hfUsername);
  const config = useLeStudioStore((s) => s.config);
  const setConfig = useLeStudioStore((s) => s.setConfig);
  const addToast = useLeStudioStore((s) => s.addToast);
  const [hfTokenInput, setHfTokenInput] = useState("");
  const [savingHfToken, setSavingHfToken] = useState(false);
  const [deletingHfToken, setDeletingHfToken] = useState(false);
  const [hfPopoverOpen, setHfPopoverOpen] = useState(false);

  const wsColor = {
    connected: "bg-emerald-400",
    unstable: "bg-amber-400",
    disconnected: "bg-red-400",
  }[wsStatus];

  const hfLabel = hfAuth === "ready"
    ? (hfUsername ?? "Connected")
    : hfAuth === "missing_token"
      ? "No Token"
      : hfAuth === "expired_token"
        ? "Expired"
      : "Invalid";

  const hfTitle = hfAuth === "ready"
    ? (hfUsername ? `Hugging Face Account Connected: ${hfUsername}` : "Hugging Face token is properly connected")
    : hfAuth === "missing_token"
      ? "Hugging Face token is not configured"
      : hfAuth === "expired_token"
        ? "Hugging Face token has expired"
      : "Hugging Face token is invalid";

  return (
    <header className="h-11 flex-none flex items-center gap-2 px-3 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 z-50">
      {/* Desktop toggle */}
      <button
        onClick={onToggleSidebar}
        className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded cursor-pointer hidden md:block"
        title="Toggle sidebar"
      >
        <Menu size={15} />
      </button>
      {/* Mobile toggle */}
      <button
        onClick={onMobileToggle}
        className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded cursor-pointer md:hidden"
        title="Open menu"
      >
        <Menu size={15} />
      </button>

      {/* Logo */}
      <NavLink to="/" className="flex items-center gap-1.5 mr-4 hover:opacity-75 transition-opacity">
        <svg className="size-6 text-zinc-700 dark:text-zinc-300" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round">
          <defs>
            <mask id="planet-mask">
              <rect width="100" height="100" fill="white" />
              <path d="M 0,50 A 50,16 0 0,0 100,50" fill="none" stroke="black" strokeWidth="12" transform="rotate(-15 50 50)" />
            </mask>
          </defs>
          <circle cx="50" cy="50" r="34" mask="url(#planet-mask)" />
          <ellipse cx="50" cy="50" rx="48" ry="16" transform="rotate(-15 50 50)" />
        </svg>
        <span className="text-sm text-zinc-800 dark:text-zinc-200">LeStudio</span>
        <span className="text-[10px] font-bold tracking-wide uppercase leading-none px-1.5 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-500 dark:text-amber-400">BETA</span>
      </NavLink>

      <div className="flex-1" />

      <div className="flex items-center gap-1.5">

        {/* HF Auth popover */}
        <Popover open={hfPopoverOpen} onOpenChange={setHfPopoverOpen}>
          <PopoverTrigger asChild>
            <button
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded border text-sm cursor-pointer transition-colors",
                hfAuth === "ready"
                  ? "border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400"
                  : hfAuth === "missing_token"
                    ? "border-amber-500/30 text-amber-600 dark:text-amber-400 bg-amber-500/5"
                    : hfAuth === "expired_token"
                      ? "border-amber-500/30 text-amber-600 dark:text-amber-400 bg-amber-500/5"
                    : "border-red-500/30 text-red-600 dark:text-red-400 bg-red-500/5"
              )}
              title={hfTitle}
            >
              <span aria-hidden="true">🤗</span>
              <span>{hfLabel}</span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700 p-0">
            <div className="px-3 py-2.5 border-b border-zinc-100 dark:border-zinc-800">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Hugging Face</span>
                {hfAuth !== "ready" && (
                  <a
                    href="https://huggingface.co/settings/tokens"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors whitespace-nowrap flex-none"
                  >
                    Get Token →
                  </a>
                )}
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">{hfTitle}</p>
            </div>
            <div className="p-3 flex flex-col gap-2">
              {hfAuth === "ready" ? (
                <>
                  <div className="flex items-center gap-2">
                    <span className="size-2 rounded-full bg-emerald-400 flex-none" />
                    <span className="text-sm text-zinc-700 dark:text-zinc-200">{hfUsername ?? "Connected"}</span>
                  </div>
                  <button
                    onClick={async () => {
                      setDeletingHfToken(true);
                      try {
                        await apiDelete<{ ok?: boolean }>("/api/hf/token");
                        await refreshHfAuth();
                        addToast("HF token deleted.", "success");
                      } catch {
                        addToast("Failed to delete HF token.", "error");
                      } finally {
                        setDeletingHfToken(false);
                      }
                    }}
                    disabled={deletingHfToken}
                    className="w-full px-2.5 py-1.5 rounded border border-red-500/30 bg-red-500/5 text-sm text-red-600 dark:text-red-400 hover:bg-red-500/10 disabled:opacity-60 disabled:cursor-not-allowed transition-colors cursor-pointer"
                  >
                    {deletingHfToken ? "Deleting..." : "Delete Token"}
                  </button>
                </>
              ) : (
                <>
                  <input
                    type="password"
                    value={hfTokenInput}
                    onChange={(e) => setHfTokenInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && hfTokenInput.trim()) {
                        e.preventDefault();
                        const token = hfTokenInput.trim();
                        setSavingHfToken(true);
                        void apiPost<{ ok?: boolean; error?: string }>("/api/hf/token", { token }).then(async (result) => {
                          if (result?.ok) {
                            setHfTokenInput("");
                            await refreshHfAuth();
                            addToast("HF token saved.", "success");
                            setHfPopoverOpen(false);
                          } else {
                            addToast(result?.error ?? "Failed to save HF token.", "error");
                          }
                        }).catch(() => {
                          addToast("Failed to save HF token.", "error");
                        }).finally(() => {
                          setSavingHfToken(false);
                        });
                      }
                    }}
                    placeholder="hf_..."
                    className="w-full px-2.5 py-1.5 rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-sm text-zinc-700 dark:text-zinc-200 placeholder:text-zinc-400 outline-none focus:border-zinc-400 dark:focus:border-zinc-500 transition-colors"
                  />
                  <button
                    onClick={async () => {
                      const token = hfTokenInput.trim();
                      if (!token) { addToast("Enter HF token.", "error"); return; }
                      setSavingHfToken(true);
                      try {
                        const result = await apiPost<{ ok?: boolean; error?: string }>("/api/hf/token", { token });
                        if (result?.ok) {
                          setHfTokenInput("");
                          await refreshHfAuth();
                          addToast("HF token saved.", "success");
                          setHfPopoverOpen(false);
                        } else {
                          addToast(result?.error ?? "Failed to save HF token.", "error");
                        }
                      } catch {
                        addToast("Failed to save HF token.", "error");
                      } finally {
                        setSavingHfToken(false);
                      }
                    }}
                    disabled={savingHfToken || !hfTokenInput.trim()}
                    className="w-full px-2.5 py-1.5 rounded border border-zinc-300 dark:border-zinc-600 bg-zinc-100 dark:bg-zinc-800 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors cursor-pointer"
                  >
                    {savingHfToken ? "Saving..." : "Save Token"}
                  </button>
                </>
              )}
            </div>
          </PopoverContent>
        </Popover>

        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-zinc-200 dark:border-zinc-700" title={`WebSocket: ${wsStatus}`}>
          <span className={cn("size-2 rounded-full", wsColor)} />
          <span className="text-sm text-zinc-500 dark:text-zinc-400">WS</span>
        </div>

        <div className="mx-0.5 h-4 w-px bg-zinc-200 dark:bg-zinc-700" />

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="p-1.5 rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 cursor-pointer"
          title="Toggle theme"
        >
          {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
        </button>

        {/* GitHub */}
        <a
          href="https://github.com/TheMomentLab/lerobot-studio"
          target="_blank"
          rel="noopener noreferrer"
          className="p-1.5 rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 cursor-pointer"
          title="GitHub"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
          </svg>
        </a>


      </div>
    </header>
  );
}

// ─── App Shell ────────────────────────────────────────────────────────────────
export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const activeTab = useLeStudioStore((s) => s.activeTab);
  const setActiveTab = useLeStudioStore((s) => s.setActiveTab);
  const mobileSidebarOpen = useLeStudioStore((s) => s.mobileSidebarOpen);
  const setMobileSidebarOpen = useLeStudioStore((s) => s.setMobileSidebarOpen);
  const didRestoreActiveTabRef = useRef(false);

  useEffect(() => {
    const next = mapPathnameToActiveTab(location.pathname);
    setActiveTab(next);
  }, [location.pathname, setActiveTab]);

  useEffect(() => {
    if (didRestoreActiveTabRef.current) return;
    didRestoreActiveTabRef.current = true;

    const restoredPath = mapActiveTabToPath(activeTab);
    if (location.pathname === "/" && restoredPath !== "/") {
      navigate(restoredPath, { replace: true });
    }
  }, [activeTab, location.pathname, navigate]);

  return (
    <HfAuthProvider>
      <div className="h-screen flex flex-col bg-zinc-50 dark:bg-zinc-950 overflow-hidden">
        <Header
          onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
          onMobileToggle={() => setMobileSidebarOpen(true)}
        />

        <div className="flex flex-1 overflow-hidden">
          {/* Desktop sidebar */}
          <div className="hidden md:flex">
            <Sidebar collapsed={sidebarCollapsed} />
          </div>

          {/* Mobile sidebar overlay */}
          {mobileSidebarOpen && (
            <div className="md:hidden fixed inset-0 z-50 flex" data-testid="mobile-sidebar-overlay">
              <div className="absolute inset-0 bg-black/50 animate-in fade-in duration-200" onClick={() => setMobileSidebarOpen(false)} />
              <div className="relative z-10 h-full animate-in slide-in-from-left duration-200">
                <Sidebar collapsed={false} onClose={() => setMobileSidebarOpen(false)} />
              </div>
            </div>
          )}

          {/* Main content */}
          <main className="flex-1 overflow-y-auto">
            <StepperNav currentPath={location.pathname} />
            <Outlet />
          </main>
        </div>

        <RuntimeConsoleDrawer />
      </div>
    </HfAuthProvider>
  );
}
