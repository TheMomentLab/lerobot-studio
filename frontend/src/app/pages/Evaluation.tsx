import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Link } from "react-router";
import {
  ChevronDown, ChevronUp, AlertTriangle, CheckCircle2,
  Trophy, TrendingDown, ArrowRight, Video,
  PackageOpen, Loader2, RotateCcw, Play
} from "lucide-react";
import {
  PageHeader, StatusBadge, FieldRow,
  ProcessButtons, StickyControlBar, BlockerCard, RefreshButton
} from "../components/wireframe";
import { cn } from "../components/ui/utils";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine
} from "recharts";
import {
  notifySuccess,
  notifyProcessStarted,
  notifyProcessStopRequested,
  notifyError,
} from "../services/notifications";
import { apiGet, apiPost } from "../services/apiClient";
import { useLeStudioStore } from "../store";
import type { LogLine } from "../store/types";
import {
  parseBackendError,
  toBackendEvalPayload,
  normalizeDeviceKey,
} from "../services/contracts";
import {
  useEvalProgress,
  type EpisodeResult,
} from "../hooks/useEvalProgress";
import {
  useEvalCheckpoint,
  type CheckpointItem,
} from "../hooks/useEvalCheckpoint";
import { useMappedCameras } from "../hooks/useMappedCameras";

// ─── Constants ───────────────────────────────────────────────────────────────

const EMPTY_LOG: LogLine[] = [];

// ─── Reward Tooltip ───────────────────────────────────────────────────────────
function RewardTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const ep = payload[0]?.payload as EpisodeResult;
  return (
    <div className="px-3 py-2 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm shadow-xl">
      <div className="text-zinc-400 mb-1">Episode {ep.ep}</div>
      <div className={ep.success ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
        Reward: {ep.reward.toFixed(3)}
      </div>
      <div className="text-zinc-500">Frames: {ep.frames}</div>
      <div className={cn("mt-0.5", ep.success ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-500")}>
        {ep.success ? "✓ Success" : "✗ Failed"}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export function Evaluation() {
  // ── Store ────────────────────────────────────────────────────────────────
  const config = useLeStudioStore((s) => s.config);
  const updateConfig = useLeStudioStore((s) => s.updateConfig);
  const procStatus = useLeStudioStore((s) => s.procStatus);
  const running = useLeStudioStore((s) => !!s.procStatus.eval);
  const installing = useLeStudioStore((s) => !!s.procStatus.train_install);
  const evalLogLines = useLeStudioStore((s) => s.logLines.eval ?? EMPTY_LOG);
  const appendLog = useLeStudioStore((s) => s.appendLog);
  const addToast = useLeStudioStore((s) => s.addToast);

  // ── Local state ──────────────────────────────────────────────────────────
  const [policySource, setPolicySource] = useState<"local" | "hf">("local");
  const [deviceLabel, setDeviceLabel] = useState("CUDA (GPU)");
  const [numEpisodes, setNumEpisodes] = useState(10);
  const [datasetRepo, setDatasetRepo] = useState("lerobot-user/pick_cube");
  const [datasetOverride, setDatasetOverride] = useState("");
  const [advOpen, setAdvOpen] = useState(false);
  const [cameraConfigOpen, setCameraConfigOpen] = useState(true);
  const [cameraMapping, setCameraMapping] = useState<Record<string, string>>({});

  // ── Preflight ────────────────────────────────────────────────────────────
  const [preflightOk, setPreflightOk] = useState(true);
  const [preflightReason, setPreflightReason] = useState("");
  const [preflightAction, setPreflightAction] = useState("");
  const [preflightCommand, setPreflightCommand] = useState("");
  const [gymInstallCommand, setGymInstallCommand] = useState("");
  const [gymModuleName, setGymModuleName] = useState("");
  const autoInstallCommandRef = useRef("");

  // ── Hooks ────────────────────────────────────────────────────────────────
  const {
    checkpoints, envTypes, envTypeFromCheckpoint, envTaskFromCheckpoint,
    imageKeysFromCheckpoint, applyCheckpointEnv,
  } = useEvalCheckpoint({ active: true, policySource, config, updateConfig });

  const {
    progressStatus, setProgressStatus, doneEpisodes, meanReward, successRate,
    finalReward, finalSuccess, bestEpisode, worstEpisode,
    startedAtMs, endedAtMs, setEndedAtMs, elapsedTick,
    lastMetricUpdateMs, progressTotal, progressPct,
    showProgressDetails, progressStatusStyle,
    episodeResults, beginEval, markError,
  } = useEvalProgress({ evalLogLines, running });

  const { mappedCameras, mappedCamEntries } = useMappedCameras();

  // ── Derived values ───────────────────────────────────────────────────────
  const policyPath = (config.eval_policy_path as string) ?? "";
  const envType = ((config.eval_env_type as string) ?? "").trim() || envTypeFromCheckpoint || "";
  const task = ((config.eval_task as string) ?? "").trim() || envTaskFromCheckpoint || "";
  const isRealRobot = envType === "gym_manipulator";
  const isRunning = running || progressStatus === "starting";
  void elapsedTick; // used for timer re-renders

  const conflictProcess = useMemo(() => {
    for (const [name, status] of Object.entries(procStatus)) {
      if (name !== "eval" && name !== "train_install" && status) return name;
    }
    return null;
  }, [procStatus]);

  const installedEnvSet = useMemo(
    () => new Set(envTypes.filter((e) => e.installed).map((e) => e.type)),
    [envTypes],
  );

  const envTypeMissing = !envType && !envTypeFromCheckpoint;
  const envTaskMissing = !task && !envTaskFromCheckpoint;
  const noLocalCheckpoint = policySource === "local" && !policyPath;

  const evalBlockers = useMemo(() => {
    const blockers: string[] = [];
    if (!preflightOk) blockers.push(preflightReason || "Device preflight failed");
    if (noLocalCheckpoint) blockers.push("No checkpoint selected");
    if (envTypeMissing) blockers.push("Env Type is required");
    if (envTaskMissing) blockers.push("Task is required");
    if (envType && !installedEnvSet.has(envType)) blockers.push(`${envType} environment not installed`);
    if (conflictProcess) blockers.push(`${conflictProcess} process running`);
    return blockers;
  }, [preflightOk, preflightReason, noLocalCheckpoint, envTypeMissing, envTaskMissing, envType, installedEnvSet, conflictProcess]);

  const evalReady = evalBlockers.length === 0;
  const preflightFixLabel = preflightAction === "install_python_dep" ? "Install Missing Packages" : "Run Fix";
  const selectedEnv = envTypes.find((e) => e.type === envType);
  // Stats (for chart results)
  const avgReward = episodeResults.length > 0
    ? (episodeResults.reduce((s, r) => s + r.reward, 0) / episodeResults.length)
    : meanReward;
  const computedSuccessRate = episodeResults.length > 0
    ? Math.round((episodeResults.filter((r) => r.success).length / episodeResults.length) * 100)
    : successRate;
  const bestEp = episodeResults.length > 0 ? episodeResults.reduce((a, b) => a.reward > b.reward ? a : b) : bestEpisode ? { ep: bestEpisode.ep, reward: bestEpisode.reward, frames: 0, success: true } : null;
  const worstEp = episodeResults.length > 0 ? episodeResults.reduce((a, b) => a.reward < b.reward ? a : b) : worstEpisode ? { ep: worstEpisode.ep, reward: worstEpisode.reward, frames: 0, success: false } : null;

  // Show results when we have episode data and not actively running config
  const hasResults = episodeResults.length > 0 || (doneEpisodes > 0 && (progressStatus === "completed" || progressStatus === "stopped" || progressStatus === "error"));
  const showIdle = !isRunning && !hasResults;
  const showRunning = progressStatus === "running";
  const showStarting = progressStatus === "starting";
  const showResults = !isRunning && hasResults;

  // ── Preflight logic ──────────────────────────────────────────────────────
  const refreshPreflight = useCallback(async () => {
    const device = normalizeDeviceKey(deviceLabel);
    try {
      const res = await apiGet<{ ok: boolean; reason?: string; action?: string; command?: string }>(
        `/api/train/preflight?device=${encodeURIComponent(device)}`,
      );
      setPreflightOk(!!res.ok);
      setPreflightReason(res.reason ?? "");
      setPreflightAction(res.action ?? "");
      setPreflightCommand(res.command ?? "");
      return res;
    } catch {
      setPreflightOk(true); // don't block if API is unavailable
      return { ok: true };
    }
  }, [deviceLabel]);

  useEffect(() => {
    void refreshPreflight();
  }, [refreshPreflight]);

  // Poll preflight while it's failing
  useEffect(() => {
    if (preflightOk) return;
    const timer = window.setInterval(() => { void refreshPreflight(); }, 5000);
    return () => window.clearInterval(timer);
  }, [preflightOk, refreshPreflight]);

  // Auto-install missing python deps
  useEffect(() => {
    if (preflightOk) {
      autoInstallCommandRef.current = "";
      return;
    }
    if (installing || preflightAction !== "install_python_dep" || !preflightCommand) return;
    if (autoInstallCommandRef.current === preflightCommand) return;
    autoInstallCommandRef.current = preflightCommand;
    appendLog("eval", "[INFO] Auto-installing missing Python packages in background...", "info");
    void apiPost("/api/train/install_torchcodec_fix", { command: preflightCommand }).then((res: any) => {
      if (!res.ok) appendLog("eval", `[ERROR] ${res.error ?? "Failed to start installer."}`, "error");
      else addToast("Auto-install started — check console", "info");
    }).catch(() => {});
  }, [preflightOk, installing, preflightAction, preflightCommand, appendLog, addToast]);

  // ── Camera mapping sync ──────────────────────────────────────────────────
  useEffect(() => {
    if (!imageKeysFromCheckpoint.length) {
      setCameraMapping((prev) => (Object.keys(prev).length > 0 ? {} : prev));
      return;
    }
    setCameraMapping((prev) => {
      const next: Record<string, string> = {};
      for (const key of imageKeysFromCheckpoint) {
        if (prev[key] && mappedCamEntries.some(([sym]) => sym === prev[key])) {
          next[key] = prev[key];
        } else {
          next[key] = mappedCamEntries.find(([sym]) => sym === key)?.[0] ?? (mappedCamEntries[0]?.[0] ?? "");
        }
      }
      return next;
    });
  }, [imageKeysFromCheckpoint, mappedCamEntries]);

  // ── Start / Stop ─────────────────────────────────────────────────────────
  const startEval = useCallback(async (episodesOverride?: number) => {
    try {
      const episodes = episodesOverride ?? numEpisodes;
      const cameraCatalog = mappedCamEntries.map(([sym, path]) => ({ role: sym, path }));
      const payload = toBackendEvalPayload({
        envType,
        policyPath: policySource === "local" ? policyPath : (policyPath || ""),
        datasetRepo,
        datasetOverride,
        episodes,
        deviceLabel,
        task,
        cameraMapping,
        cameraCatalog,
        config,
      });

      // Preflight check
      const preflight = await refreshPreflight();
      if (!preflight.ok) {
        appendLog("eval", `[ERROR] ${(preflight as any).reason || "Device compatibility check failed."}`, "error");
        notifyError((preflight as any).reason || "Device preflight failed");
        return;
      }

      beginEval(episodes, evalLogLines.length);
      notifyProcessStarted("eval");

      const res = await apiPost<{
        ok: boolean; error?: string;
        auto_install_started?: boolean; action?: string;
        command?: string; module_name?: string;
      }>("/api/eval/start", payload);

      if (!res.ok) {
        if (res.auto_install_started) {
          appendLog("eval", `[INFO] ${res.error ?? "Auto-install started. Retry evaluation after installer finishes."}`, "info");
          addToast("Auto-fix started in background", "info");
          void refreshPreflight();
          setProgressStatus("idle");
          setEndedAtMs(Date.now());
          return;
        }
        if (res.action === "install_gym_plugin" && res.command) {
          setGymInstallCommand(res.command);
          setGymModuleName(res.module_name ?? res.command);
          appendLog("eval", `[ERROR] ${res.error ?? "Missing gym plugin."}`, "error");
          appendLog("eval", `[INFO] Install command: ${res.command}`, "info");
          addToast(`${res.module_name ?? "Gym plugin"} not installed`, "error");
        } else {
          appendLog("eval", `[ERROR] ${res.error ?? "failed to start eval"}`, "error");
          notifyError(res.error ?? "Failed to start evaluation");
        }
        markError();
        setEndedAtMs(Date.now());
        return;
      }

      setProgressStatus("running");
      setGymInstallCommand("");
      setGymModuleName("");
      addToast("Eval started", "success");
    } catch (error) {
      const reason = parseBackendError(error, "failed to start evaluation");
      appendLog("eval", `[ERROR] ${reason}`, "error");
      markError();
      setEndedAtMs(Date.now());
      notifyError(reason);
    }
  }, [
    numEpisodes, mappedCamEntries, envType, policySource, policyPath,
    datasetRepo, datasetOverride, deviceLabel, task, cameraMapping, config,
    refreshPreflight, appendLog, beginEval, evalLogLines.length,
    markError, setEndedAtMs, setProgressStatus, addToast,
  ]);

  const stopEval = useCallback(() => {
    void apiPost("/api/process/eval/stop");
    setEndedAtMs(Date.now());
    setProgressStatus((prev) => (prev === "error" ? "error" : doneEpisodes > 0 ? "stopped" : "idle"));
    notifyProcessStopRequested("eval");
  }, [doneEpisodes, setEndedAtMs, setProgressStatus]);

  // ── Gym plugin install ───────────────────────────────────────────────────
  const installGymPlugin = useCallback(async () => {
    if (!gymInstallCommand) return;
    appendLog("eval", `[INFO] Installing ${gymModuleName}: ${gymInstallCommand}`, "info");
    try {
      const res = await apiPost<{ ok: boolean; error?: string }>("/api/train/install_torchcodec_fix", { command: gymInstallCommand });
      if (!res.ok) appendLog("eval", `[ERROR] ${res.error ?? "Failed to start gym plugin installer."}`, "error");
      else addToast(`Installing ${gymModuleName} — check console`, "info");
    } catch (e) {
      appendLog("eval", `[ERROR] ${e instanceof Error ? e.message : "Installer request failed."}`, "error");
    }
  }, [addToast, appendLog, gymInstallCommand, gymModuleName]);

  const installCudaTorch = useCallback(async () => {
    appendLog("eval", "[INFO] Starting PyTorch CUDA installer from GUI...", "info");
    try {
      const res = await apiPost<{ ok: boolean; error?: string }>("/api/train/install_pytorch", { nightly: true, cuda_tag: "cu128" });
      if (!res.ok) return appendLog("eval", `[ERROR] ${res.error ?? "Failed to start CUDA installer."}`, "error");
      addToast("CUDA PyTorch install started", "info");
      void refreshPreflight();
    } catch (e) {
      appendLog("eval", `[ERROR] ${e instanceof Error ? e.message : "Installer request failed."}`, "error");
    }
  }, [addToast, appendLog, refreshPreflight]);

  const runPreflightFix = useCallback(async () => {
    if (!preflightCommand) return;
    appendLog("eval", `[INFO] Running: ${preflightCommand}`, "info");
    try {
      const res = await apiPost<{ ok: boolean; error?: string }>("/api/train/install_torchcodec_fix", { command: preflightCommand });
      if (!res.ok) return appendLog("eval", `[ERROR] ${res.error ?? "Failed to start installer."}`, "error");
      addToast("Fix installer started — check console for progress", "info");
    } catch (e) {
      appendLog("eval", `[ERROR] ${e instanceof Error ? e.message : "Installer request failed."}`, "error");
    }
  }, [addToast, appendLog, preflightCommand]);

  const stopInstallProcess = useCallback(() => {
    void apiPost("/api/process/train_install/stop");
    addToast("Install stop requested", "info");
  }, [addToast]);
  // ── Checkpoint change handler ────────────────────────────────────────────
  const handleCheckpointChange = useCallback((path: string) => {
    updateConfig({ eval_policy_path: path, eval_env_type: "", eval_task: "" });
    const cp = checkpoints.find((c) => c.path === path);
    if (cp) applyCheckpointEnv(cp);
  }, [updateConfig, checkpoints, applyCheckpointEnv]);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      {/* Top nav bar */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center px-6 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-sm text-zinc-400">
        <Link to="/training" className="inline-flex items-center gap-1 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">
          ← Training
        </Link>
        <div className="flex items-center gap-2">
          <span className="text-zinc-300 dark:text-zinc-600">Training</span>
          <span className="text-zinc-300 dark:text-zinc-600">›</span>
          <span className="text-zinc-700 dark:text-zinc-200 font-medium">Evaluation</span>
        </div>
        <div className="justify-self-end" />
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-6 pb-8 flex flex-col gap-4 max-w-[1600px] mx-auto w-full">

          {/* Header */}
          <PageHeader
            title="Policy Evaluation"
            subtitle="Evaluate trained AI policies on real robots or simulated environments"
            action={<RefreshButton onClick={() => { void refreshPreflight(); }} />}
          />

          {/* Blockers */}
          {!isRunning && !evalReady && evalBlockers.length > 0 && (
            <BlockerCard
              title="Evaluation Blocked"
              severity="warning"
              reasons={[
                ...evalBlockers.map((b) => b),
                ...(noLocalCheckpoint ? [{ text: "Go to Train", to: "/training" }] : []),
              ]}
            />
          )}


          {/* Gym plugin install card */}
          {gymInstallCommand && !isRunning && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-amber-500/30 bg-amber-500/5">
              <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400 flex-none" />
              <div className="flex-1">
                <span className="text-sm text-amber-600 dark:text-amber-400 font-medium">Environment plugin required</span>
                <span className="text-sm text-zinc-400 ml-2">{gymModuleName}</span>
              </div>
              <button
                onClick={() => { void installGymPlugin(); }}
                disabled={installing}
                className="px-3 py-1.5 rounded border border-amber-500/40 text-sm text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/20 transition-colors cursor-pointer disabled:opacity-50"
              >
                {installing ? "Installing..." : `Install ${gymModuleName}`}
              </button>
            </div>
          )}

          {/* ─── IDLE: Settings ─────────────────────────────────────── */}
          {showIdle && (
            <div className="flex flex-col gap-4">

              {/* Eval Config — right wide */}
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
                <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800 flex items-center">
                  <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Evaluation Settings</span>
                </div>
                <div className="p-4 flex flex-col gap-4">

                  {/* Policy source toggle + selector */}
                  <div>
                    <div className="text-sm text-zinc-500 mb-1.5">Policy Source</div>
                    <div className="flex flex-col md:flex-row md:items-center gap-2">
                      <div className="flex gap-1 bg-zinc-100 dark:bg-zinc-800/50 p-0.5 rounded-lg w-fit flex-none">
                        <button
                          onClick={() => setPolicySource("local")}
                          className={cn("flex items-center gap-1.5 px-3.5 py-1 rounded-md text-sm font-medium transition-all cursor-pointer", policySource === "local" ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300")}
                        >Local</button>
                        <button
                          onClick={() => setPolicySource("hf")}
                          title="Hugging Face"
                          className={cn("flex items-center gap-1.5 px-3.5 py-1 rounded-md text-sm font-medium transition-all cursor-pointer", policySource === "hf" ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300")}
                        >HF</button>
                      </div>
                      <div className="flex-1 min-w-0">
                        {policySource === "local" ? (
                          checkpoints.length === 0 ? (
                            <div className="text-sm text-amber-600 dark:text-amber-400">No checkpoints found. Train a model first.</div>
                          ) : (
                            <select
                              value={policyPath}
                              onChange={(e) => handleCheckpointChange(e.target.value)}
                              className="w-full h-9 px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-700 dark:text-zinc-300 text-sm outline-none cursor-pointer focus:border-blue-500 dark:focus:border-blue-400"
                            >
                              {checkpoints.map((cp) => (
                                <option key={cp.path} value={cp.path}>
                                  {cp.display ?? (cp.step ? `${cp.name} (step ${cp.step.toLocaleString()})` : cp.name)}
                                </option>
                              ))}
                            </select>
                          )
                        ) : (
                          <input
                            type="text"
                            value={policyPath}
                            placeholder="e.g. lerobot/act_pusht_diffusion"
                            onChange={(e) => updateConfig({ eval_policy_path: e.target.value })}
                            className="w-full h-9 px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-700 dark:text-zinc-300 text-sm outline-none placeholder:text-zinc-500 focus:border-blue-500 dark:focus:border-blue-400"
                          />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Top row: Device + Episodes */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <div className="text-sm text-zinc-500 mb-1.5">Device</div>
                      <select
                        value={deviceLabel}
                        onChange={(e) => setDeviceLabel(e.target.value)}
                        className="w-full h-7 px-2 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-700 dark:text-zinc-300 text-sm outline-none cursor-pointer focus:border-blue-500 dark:focus:border-blue-400"
                      >
                        <option value="CUDA (GPU)">CUDA (GPU)</option>
                        <option value="CPU">CPU</option>
                        <option value="MPS">MPS (Apple Silicon)</option>
                      </select>
                      {!preflightOk && (
                        <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3.5 flex flex-col gap-2.5">
                          <div className="flex items-center gap-2">
                            <AlertTriangle size={14} className="text-amber-600 dark:text-amber-400 flex-none" />
                            <span className="text-sm text-amber-600 dark:text-amber-400">{preflightReason || "Device preflight failed. Evaluation is blocked."}</span>
                          </div>
                          {preflightAction === "install_torch_cuda" && (
                            <div className="flex gap-2">
                              <button
                                onClick={() => { void installCudaTorch(); }}
                                disabled={installing}
                                className="px-3 py-1.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-sm font-medium cursor-pointer hover:bg-amber-500/20 transition-all disabled:opacity-50"
                              >
                                {installing ? "Installing..." : "Install CUDA PyTorch (Nightly)"}
                              </button>
                            </div>
                          )}
                          {preflightAction === "install_python_dep" && preflightCommand && (
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => { void runPreflightFix(); }}
                                disabled={installing}
                                className="px-3 py-1.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-sm font-medium cursor-pointer hover:bg-amber-500/20 transition-all disabled:opacity-50"
                              >
                                {installing ? "Installing..." : preflightFixLabel}
                              </button>
                              {installing && (
                                <button
                                  onClick={stopInstallProcess}
                                  className="px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-500 text-xs cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                                >
                                  Stop
                                </button>
                              )}
                            </div>
                          )}
                          {preflightCommand && preflightAction !== "install_torch_cuda" && preflightAction !== "install_python_dep" && (
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => { void runPreflightFix(); }}
                                disabled={installing}
                                className="px-3 py-1.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-sm font-medium cursor-pointer hover:bg-amber-500/20 transition-all disabled:opacity-50"
                              >
                                {installing ? "Installing..." : "Run Fix"}
                              </button>
                            </div>
                          )}
                          {installing && (
                            <div className="flex items-center gap-2 text-sm text-zinc-400">
                              <Loader2 size={12} className="animate-spin" />
                              <span>Fix in progress… check console for details</span>
                            </div>
                          )}
                          {!installing && (
                            <button
                              onClick={() => { setDeviceLabel("CPU"); void refreshPreflight(); }}
                              className="text-sm text-zinc-400 hover:text-zinc-300 transition-colors cursor-pointer self-start"
                            >
                              → Switch to CPU instead
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="text-sm text-zinc-500 mb-1.5">Number of Episodes</div>
                      <input
                        type="number"
                        value={numEpisodes}
                        onChange={(e) => setNumEpisodes(Number(e.target.value))}
                        min={1} max={100}
                        className="w-full h-7 px-2 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-700 dark:text-zinc-300 text-sm outline-none focus:border-blue-500 dark:focus:border-blue-400"
                      />
                    </div>
                    <div>
                      <div className="text-sm text-zinc-500 mb-1.5">Dataset Repo ID</div>
                      <input
                        type="text"
                        value={datasetRepo}
                        onChange={(e) => setDatasetRepo(e.target.value)}
                        className="w-full h-7 px-2 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-700 dark:text-zinc-300 text-sm outline-none focus:border-blue-500 dark:focus:border-blue-400"
                      />
                    </div>
                  </div>

                  {/* Env type + Task */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <div className="text-sm text-zinc-500 mb-1.5">
                        Env Type
                        {envTypeFromCheckpoint && <span className="text-xs text-emerald-600 dark:text-emerald-400 ml-1.5">from checkpoint</span>}
                        {envTypeMissing && <span className="text-xs text-zinc-400 ml-1.5">(required)</span>}
                      </div>
                      <select
                        value={envType}
                        onChange={(e) => updateConfig({ eval_env_type: e.target.value })}
                        className="w-full h-7 px-2 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-700 dark:text-zinc-300 text-sm outline-none cursor-pointer focus:border-blue-500 dark:focus:border-blue-400"
                      >
                        <option value="">— Select env type —</option>
                        {envTypes.map((et) => (
                          <option key={et.type} value={et.type}>
                            {et.label}{et.installed ? "" : " (not installed)"}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <div className="text-sm text-zinc-500 mb-1.5">
                        Task
                        {envTaskFromCheckpoint && <span className="text-xs text-emerald-600 dark:text-emerald-400 ml-1.5">from checkpoint</span>}
                        {envTaskMissing && <span className="text-xs text-zinc-400 ml-1.5">(required)</span>}
                      </div>
                      <input
                        type="text"
                        value={task}
                        placeholder="e.g. Pick up the block"
                        onChange={(e) => updateConfig({ eval_task: e.target.value })}
                        className="w-full h-7 px-2 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-700 dark:text-zinc-300 text-sm outline-none focus:border-blue-500 dark:focus:border-blue-400"
                      />
                    </div>
                  </div>

                  {/* Advanced */}
                  <button
                    onClick={() => setAdvOpen(!advOpen)}
                    className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-500 dark:hover:text-zinc-300 transition-colors cursor-pointer w-fit"
                  >
                    {advOpen ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                    Advanced Settings
                  </button>
                  {advOpen && (
                    <div className="pl-3 border-l-2 border-zinc-100 dark:border-zinc-800">
                      <div className="text-sm text-zinc-500 mb-1.5">Dataset Override <span className="text-zinc-600">(optional)</span></div>
                      <input
                        type="text"
                        value={datasetOverride}
                        onChange={(e) => setDatasetOverride(e.target.value)}
                        placeholder="Override with different dataset repo"
                        className="w-full h-7 px-2 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-700 dark:text-zinc-300 text-sm outline-none placeholder:text-zinc-500 focus:border-blue-500 dark:focus:border-blue-400"
                      />
                    </div>
                  )}

                  {/* Camera mapping — policy-dependent */}
                  {isRealRobot && imageKeysFromCheckpoint.length > 0 && (
                    <div className="border-t border-zinc-100 dark:border-zinc-800 pt-3 flex flex-col gap-2">
                      <div
                        className="flex items-center justify-between cursor-pointer"
                        onClick={() => setCameraConfigOpen(!cameraConfigOpen)}
                      >
                        <div className="flex items-center gap-2">
                          <Video size={12} className="text-emerald-600 dark:text-emerald-400" />
                          <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Camera Mapping</span>
                          <span className="text-xs text-zinc-400">
                            {Object.values(cameraMapping).filter(Boolean).length}/{imageKeysFromCheckpoint.length} mapped
                          </span>
                        </div>
                        {cameraConfigOpen ? <ChevronUp size={10} className="text-zinc-500" /> : <ChevronDown size={10} className="text-zinc-500" />}
                      </div>
                      {cameraConfigOpen && (
                        <div className="flex flex-col gap-2">
                          <p className="text-sm text-zinc-400">
                            Map policy image keys to actual cameras.
                          </p>
                          {mappedCamEntries.length === 0 && (
                            <p className="text-sm text-amber-600 dark:text-amber-400">
                              No mapped cameras. Set up cameras in Device Setup first.
                            </p>
                          )}
                          {imageKeysFromCheckpoint.map((key) => (
                            <div key={key} className="flex flex-col gap-1">
                              <code className="text-xs font-mono text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded self-start max-w-full truncate">
                                {key}
                              </code>
                              <select
                                value={cameraMapping[key] || ""}
                                onChange={(e) => setCameraMapping((prev) => ({ ...prev, [key]: e.target.value }))}
                                className="w-full h-7 px-2 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-700 dark:text-zinc-300 text-sm outline-none cursor-pointer focus:border-blue-500 dark:focus:border-blue-400"
                              >
                                <option value="">— Select —</option>
                                {mappedCamEntries.map(([sym, path]) => (
                                  <option key={sym} value={sym}>{sym} ({path})</option>
                                ))}
                              </select>
                            </div>
                          ))}
                          {Object.values(cameraMapping).some((v) => !v) && (
                            <p className="text-sm text-amber-600 dark:text-amber-400">
                              ⚠ Unmapped cameras detected. Evaluation may fail.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

            </div>
          )}

          {/* ─── STARTING: Spinner ──────────────────────────────────── */}
          {showStarting && (
            <div className="flex-1 flex flex-col items-center justify-center py-16 gap-6">
              <Loader2 size={32} className="text-zinc-400 animate-spin" />
              <div className="flex flex-col items-center gap-2">
                <span className="text-sm text-zinc-500">Starting evaluation...</span>
                <p className="text-sm text-zinc-400">
                  {selectedEnv?.label ?? envType} · {numEpisodes} episodes · {policyPath.split("/").pop() || policyPath}
                </p>
              </div>
            </div>
          )}

          {/* ─── RUNNING: Monitoring ────────────────────────────────── */}
          {showRunning && (
            <div className="flex flex-col gap-4">

              {/* Progress */}
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
                <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Evaluation Progress</span>
                  <StatusBadge status="running" label="RUNNING" pulse />
                </div>
                <div className="p-4 flex flex-col gap-4">
                  <div className="flex items-center gap-6 flex-wrap">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm text-zinc-400">Episode</span>
                      <span className="text-sm font-mono text-zinc-700 dark:text-zinc-200">
                        {doneEpisodes} <span className="text-zinc-400 text-sm">/ {progressTotal ?? numEpisodes}</span>
                      </span>
                    </div>
                    {meanReward !== null && (
                      <div className="flex flex-col gap-0.5">
                        <span className="text-sm text-zinc-400">Avg Reward</span>
                        <span className={cn("text-sm font-mono", (meanReward ?? 0) >= 0.6 ? "text-emerald-600 dark:text-emerald-400" : (meanReward ?? 0) >= 0.4 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400")}>
                          {meanReward.toFixed(3)}
                        </span>
                      </div>
                    )}
                    {computedSuccessRate !== null && (
                      <div className="flex flex-col gap-0.5">
                        <span className="text-sm text-zinc-400">Success Rate</span>
                        <span className={cn("text-sm font-mono", (computedSuccessRate ?? 0) >= 60 ? "text-emerald-600 dark:text-emerald-400" : (computedSuccessRate ?? 0) >= 40 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400")}>
                          {computedSuccessRate}%
                        </span>
                      </div>
                    )}
                    {bestEp && (
                      <div className="flex flex-col gap-0.5">
                        <span className="text-sm text-zinc-400">Best</span>
                        <span className="text-sm font-mono text-emerald-600 dark:text-emerald-400">Ep {bestEp.ep} ({bestEp.reward.toFixed(3)})</span>
                      </div>
                    )}
                  </div>

                  {/* Progress bar */}
                  <div>
                    <div className="flex justify-between text-sm text-zinc-500 mb-1">
                      <span>{doneEpisodes} / {progressTotal ?? numEpisodes} episodes</span>
                      <span>{Math.round(progressPct)}%</span>
                    </div>
                    <div className="h-2.5 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500 bg-zinc-800 dark:bg-zinc-200"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Reward Chart (live) */}
              {episodeResults.length > 0 && (
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
                  <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800 flex items-center">
                    <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Reward per Episode</span>
                  </div>
                  <div className="h-56 p-3">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={episodeResults} margin={{ top: 8, right: 8, bottom: 4, left: -12 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(63,63,70,0.5)" vertical={false} />
                        <XAxis dataKey="ep" tick={{ fontSize: 10, fill: "#71717a" }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fontSize: 10, fill: "#71717a" }} tickLine={false} axisLine={false} domain={[0, 1]} tickFormatter={(v) => v.toFixed(1)} width={32} />
                        <Tooltip content={<RewardTooltip />} />
                        <ReferenceLine y={0.6} stroke="#6b7280" strokeDasharray="4 4" strokeWidth={1} />
                        <Bar dataKey="reward" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                          {episodeResults.map((r) => (
                            <Cell key={r.ep} fill={r.reward >= 0.7 ? "#10b981" : r.reward >= 0.5 ? "#f59e0b" : "#ef4444"} fillOpacity={r.ep === bestEp?.ep ? 1 : 0.75} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ─── DONE/STOPPED/ERROR: Results ─────────────────────────── */}
          {showResults && (
            <div className="flex flex-col gap-4">

              {/* Completion summary */}
              <div className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-lg border",
                progressStatus === "error"
                  ? "border-red-500/30 bg-red-500/5"
                  : progressStatus === "stopped"
                    ? "border-zinc-500/30 bg-zinc-500/5"
                    : "border-emerald-500/30 bg-emerald-500/5",
              )}>
                {progressStatus === "error" ? (
                  <AlertTriangle size={16} className="text-red-600 dark:text-red-400 flex-none" />
                ) : (
                  <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400 flex-none" />
                )}
                <div>
                  <span className={cn("text-sm font-medium",
                    progressStatus === "error" ? "text-red-600 dark:text-red-400" :
                    progressStatus === "stopped" ? "text-zinc-500" :
                    "text-emerald-600 dark:text-emerald-400",
                  )}>
                    {progressStatus === "error" ? "Evaluation Error" : progressStatus === "stopped" ? "Evaluation Stopped" : "Evaluation Complete"}
                  </span>
                  <span className="text-sm text-zinc-400 ml-3">
                    {selectedEnv?.label ?? envType} · {doneEpisodes} episodes
                    {avgReward !== null && ` · Avg Reward ${avgReward.toFixed(3)}`}
                    {computedSuccessRate !== null && ` · Success ${computedSuccessRate}%`}
                  </span>
                </div>
              </div>

              {/* Summary stats */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/20">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm text-zinc-400">Total</span>
                  <span className="text-sm font-mono text-zinc-700 dark:text-zinc-200">{doneEpisodes} eps</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm text-zinc-400">Avg Reward</span>
                  <span className={cn("text-sm font-mono", (avgReward ?? 0) >= 0.6 ? "text-emerald-600 dark:text-emerald-400" : (avgReward ?? 0) >= 0.4 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400")}>
                    {avgReward?.toFixed(3) ?? finalReward?.toFixed(3) ?? "—"}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm text-zinc-400">Success Rate</span>
                  <span className={cn("text-sm font-mono", (computedSuccessRate ?? 0) >= 60 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>
                    {computedSuccessRate != null ? `${computedSuccessRate}%` : finalSuccess != null ? `${finalSuccess.toFixed(1)}%` : "—"}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm text-zinc-400">Best</span>
                  <span className="text-sm font-mono text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    {bestEp ? <><Trophy size={12} /> Ep {bestEp.ep} ({bestEp.reward.toFixed(3)})</> : "—"}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm text-zinc-400">Worst</span>
                  <span className="text-sm font-mono text-red-600 dark:text-red-400 flex items-center gap-1">
                    {worstEp ? <><TrendingDown size={12} /> Ep {worstEp.ep} ({worstEp.reward.toFixed(3)})</> : "—"}
                  </span>
                </div>
              </div>

              {/* Reward Chart */}
              {episodeResults.length > 0 && (
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                  <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                    <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Reward per Episode</span>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-emerald-500" /><span className="text-sm text-zinc-500">≥ 0.7</span></div>
                      <div className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-amber-500" /><span className="text-sm text-zinc-500">0.5–0.7</span></div>
                      <div className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-red-500" /><span className="text-sm text-zinc-500">&lt; 0.5</span></div>
                      <span className="text-sm text-zinc-600">— 0.6 baseline</span>
                    </div>
                  </div>
                  <div className="h-56 p-3">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={episodeResults} margin={{ top: 8, right: 8, bottom: 4, left: -12 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(63,63,70,0.5)" vertical={false} />
                        <XAxis dataKey="ep" tick={{ fontSize: 10, fill: "#71717a" }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fontSize: 10, fill: "#71717a" }} tickLine={false} axisLine={false} domain={[0, 1]} tickFormatter={(v) => v.toFixed(1)} width={32} />
                        <Tooltip content={<RewardTooltip />} />
                        <ReferenceLine y={0.6} stroke="#6b7280" strokeDasharray="4 4" strokeWidth={1} />
                        <Bar dataKey="reward" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                          {episodeResults.map((r) => (
                            <Cell key={r.ep} fill={r.reward >= 0.7 ? "#10b981" : r.reward >= 0.5 ? "#f59e0b" : "#ef4444"} fillOpacity={r.ep === bestEp?.ep ? 1 : 0.75} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Episode Detail Table */}
              {episodeResults.length > 0 && (
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                  <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800 flex items-center">
                    <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Episode Details ({episodeResults.length})</span>
                  </div>
                  <div className="divide-y divide-zinc-100 dark:divide-zinc-800/50 max-h-52 overflow-y-auto">
                    {episodeResults.map((r) => (
                      <div
                        key={r.ep}
                        className={cn("flex items-center gap-3 px-4 py-2 transition-colors",
                          r.ep === bestEp?.ep ? "bg-emerald-500/5" :
                          r.ep === worstEp?.ep ? "bg-red-500/5" : ""
                        )}
                      >
                        <span className="text-sm text-zinc-400 font-mono w-14 flex-none flex items-center gap-1">
                          {r.ep === bestEp?.ep && <Trophy size={10} className="text-emerald-600 dark:text-emerald-400" />}
                          {r.ep === worstEp?.ep && <TrendingDown size={10} className="text-red-600 dark:text-red-400" />}
                          Ep {r.ep}
                        </span>
                        <div className="flex-1 h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
                          <div
                            className={cn("h-full rounded-full",
                              r.reward >= 0.7 ? "bg-emerald-500" : r.reward >= 0.5 ? "bg-amber-500" : "bg-red-500"
                            )}
                            style={{ width: `${r.reward * 100}%` }}
                          />
                        </div>
                        <span className={cn("text-sm font-mono w-12 text-right flex-none",
                          r.reward >= 0.7 ? "text-emerald-600 dark:text-emerald-400" : r.reward >= 0.5 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400"
                        )}>
                          {r.reward.toFixed(3)}
                        </span>
                        {r.frames > 0 && <span className="text-sm text-zinc-500 w-16 text-right flex-none font-mono">{r.frames} fr</span>}
                        <span className={cn("text-sm w-6 text-right flex-none", r.success ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-500")}>
                          {r.success ? "✓" : "✗"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Next actions */}
              <div className="flex flex-wrap items-center gap-2 justify-end">
                <button
                  onClick={() => { void startEval(3); }}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-emerald-500/40 text-sm text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 transition-colors cursor-pointer"
                >
                  <RotateCcw size={12} /> Quick Rerun (3 ep)
                </button>
                <button
                  onClick={() => { setProgressStatus("idle"); }}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                >
                  <RotateCcw size={12} /> Start New Evaluation
                </button>
                <Link
                  to="/training"
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                >
                  <ArrowRight size={12} /> Go to Training
                </Link>
                <Link
                  to="/recording"
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                >
                  <ArrowRight size={12} /> Record New Data
                </Link>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* ── Sticky Control Bar ─────────────────────────────────────────── */}
      <StickyControlBar>
        <div className="flex items-center gap-3 min-w-0">
          <StatusBadge
            status={
              showStarting ? "warning" :
              isRunning ? "running" :
              progressStatus === "completed" ? "ready" :
              progressStatus === "error" ? "blocked" :
              evalReady ? "ready" : "blocked"
            }
            label={
              showStarting ? "STARTING" :
              isRunning ? "EVALUATING" :
              progressStatus === "completed" ? "DONE" :
              progressStatus === "error" ? "ERROR" :
              evalReady ? "READY" : "BLOCKED"
            }
            pulse={isRunning}
          />
          {isRunning && (
            <span className="text-sm text-zinc-400 font-mono truncate">
              Episode {doneEpisodes} / {progressTotal ?? numEpisodes}
            </span>
          )}
          {(progressStatus === "completed" || progressStatus === "stopped") && avgReward !== null && (
            <span className="text-sm text-zinc-400">
              Avg Reward: <span className={cn("font-mono", (avgReward ?? 0) >= 0.6 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>{avgReward.toFixed(3)}</span>
              {" "}· Success: <span className={cn("font-mono", (computedSuccessRate ?? 0) >= 60 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>{computedSuccessRate ?? "—"}%</span>
            </span>
          )}
          {!isRunning && !hasResults && !evalReady && evalBlockers.length > 0 && (
            <span className="text-sm text-zinc-400 truncate">{evalBlockers[0]}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ProcessButtons
            running={isRunning}
            onStart={() => { void startEval(); }}
            onStop={stopEval}
            disabled={!evalReady || !!conflictProcess}
            startLabel={<><Play size={13} className="fill-current" /> Start Eval</>}
            compact
          />
        </div>
      </StickyControlBar>
    </div>
  );
}
