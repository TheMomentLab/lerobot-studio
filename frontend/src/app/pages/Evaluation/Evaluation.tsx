import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Loader2,
  Play,
  CheckCircle2,
} from "lucide-react";
import {
  PageHeader, StatusBadge,
  ProcessButtons, StickyControlBar, BlockerCard, RefreshButton
} from "../../components/wireframe";
import { cn } from "../../components/ui/utils";
import {
  notifyProcessStarted,
  notifyProcessStopRequested,
  notifyError,
} from "../../services/notifications";
import { apiGet, apiPost } from "../../services/apiClient";
import { useLeStudioStore } from "../../store";
import {
  parseBackendError,
  toBackendEvalPayload,
  normalizeDeviceKey,
} from "../../services/contracts";
import {
  useEvalProgress,
  EVAL_STARTING_STEPS,
} from "../../hooks/useEvalProgress";
import {
  useEvalCheckpoint,
} from "../../hooks/useEvalCheckpoint";
import { useMappedCameras } from "../../hooks/useMappedCameras";

import { EMPTY_LOG } from "./types";
import type { EvalPreflightResponse } from "./types";
import { EvalPreflightBanner } from "./components/EvalPreflightBanner";
import { EvalSettingsPanel } from "./components/EvalSettingsPanel";
import { EvalProgressPanel } from "./components/EvalProgressPanel";
import { EvalResultsPanel } from "./components/EvalResultsPanel";
import { GymInstallCard } from "./components/GymInstallCard";

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

  const hfUsername = useLeStudioStore((s) => s.hfUsername);
  // ── Local state ──────────────────────────────────────────────────────────
  const [policySource, setPolicySource] = useState<"local" | "hf">("local");
  const [deviceLabel, setDeviceLabel] = useState("CUDA (GPU)");
  const [numEpisodes, setNumEpisodes] = useState(10);
  const [datasetRepo, setDatasetRepo] = useState(`${hfUsername ?? "lerobot-user"}/pick_cube`);
  const [datasetOverride, setDatasetOverride] = useState("");
  const [advOpen, setAdvOpen] = useState(false);
  const [cameraConfigOpen, setCameraConfigOpen] = useState(true);
  const [showBlockers, setShowBlockers] = useState(false);
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
    progressStatus, setProgressStatus, startingStep, doneEpisodes, meanReward, successRate,
    finalReward, finalSuccess, bestEpisode, worstEpisode,
    setEndedAtMs, elapsedTick,
    progressTotal, progressPct,
    episodeResults, beginEval, markError,
  } = useEvalProgress({ evalLogLines, running });

  const { mappedCamEntries } = useMappedCameras();

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

  const configBlockers = useMemo(() => {
    const blockers: string[] = [];
    if (noLocalCheckpoint) blockers.push("No checkpoint selected");
    if (envTypeMissing) blockers.push("Env Type is required");
    if (envTaskMissing) blockers.push("Task is required");
    if (envType && !installedEnvSet.has(envType)) blockers.push(`${envType} environment not installed`);
    if (conflictProcess) blockers.push(`${conflictProcess} process running`);
    return blockers;
  }, [noLocalCheckpoint, envTypeMissing, envTaskMissing, envType, installedEnvSet, conflictProcess]);

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
  const refreshPreflight = useCallback(async (): Promise<EvalPreflightResponse> => {
    const device = normalizeDeviceKey(deviceLabel);
    try {
      const res = await apiGet<EvalPreflightResponse>(
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
    void apiPost<{ ok: boolean; error?: string }>("/api/train/install_torchcodec_fix", { command: preflightCommand }).then((res) => {
      if (!res.ok) appendLog("eval", `[ERROR] ${res.error ?? "Failed to start installer."}`, "error");
      else addToast("Auto-install started — check console", "info");
    }).catch(() => {
      appendLog("eval", "[ERROR] Failed to request auto-install.", "error");
    });
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
    // Show blockers if required fields are missing
    if (configBlockers.length > 0) {
      setShowBlockers(true);
      return;
    }
    setShowBlockers(false);
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
        appendLog("eval", `[ERROR] ${preflight.reason ?? "Device compatibility check failed."}`, "error");
        notifyError(preflight.reason ?? "Device preflight failed");
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
    configBlockers, refreshPreflight, appendLog, beginEval, evalLogLines.length,
    markError, setEndedAtMs, setProgressStatus, addToast,
  ]);

  const stopEval = useCallback(() => {
    void apiPost("/api/process/eval/stop");
    setEndedAtMs(Date.now());
    setProgressStatus((prev) => (prev === "error" ? "error" : doneEpisodes > 0 ? "stopped" : "idle"));
    notifyProcessStopRequested("eval");
  }, [doneEpisodes, setEndedAtMs, setProgressStatus]);

  // Reset blocker cards when all blockers are resolved
  useEffect(() => {
    if (configBlockers.length === 0) setShowBlockers(false);
  }, [configBlockers]);
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
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 pb-8 flex flex-col gap-4 max-w-[1600px] mx-auto w-full">

          {/* Header */}
          <PageHeader
            title="Policy Evaluation"
            subtitle="Evaluate trained AI policies on real robots or simulated environments"
            action={<RefreshButton onClick={() => { void refreshPreflight(); }} />}
          />

          {/* System blocker — preflight / install issues */}
          {!isRunning && !preflightOk && (
            <EvalPreflightBanner
              preflightReason={preflightReason}
              installing={installing}
              preflightAction={preflightAction}
              preflightCommand={preflightCommand}
              preflightFixLabel={preflightFixLabel}
              onInstallCudaTorch={() => {
                void installCudaTorch();
              }}
              onRunPreflightFix={() => {
                void runPreflightFix();
              }}
              onStopInstall={stopInstallProcess}
              onUseCpu={() => {
                setDeviceLabel("CPU");
                void refreshPreflight();
              }}
            />
          )}

          {/* Config blockers — one card per reason */}
          {showBlockers && !isRunning && configBlockers.length > 0 && configBlockers.map((reason, i) => (
            <BlockerCard
              key={i}
              severity="warning"
              reasons={[
                reason,
                ...(reason === "No checkpoint selected" ? [{ text: "Go to Train", to: "/train" }] : []),
              ]}
            />
          ))}


          {/* Gym plugin install card */}
          {gymInstallCommand && !isRunning && (
            <GymInstallCard
              gymModuleName={gymModuleName}
              installing={installing}
              onInstall={() => {
                void installGymPlugin();
              }}
            />
          )}

          {/* ─── IDLE: Settings ─────────────────────────────────────── */}
          {showIdle && (
            <EvalSettingsPanel
              policySource={policySource}
              setPolicySource={setPolicySource}
              policyPath={policyPath}
              checkpoints={checkpoints}
              onCheckpointChange={handleCheckpointChange}
              updateConfig={updateConfig}
              deviceLabel={deviceLabel}
              setDeviceLabel={setDeviceLabel}
              numEpisodes={numEpisodes}
              setNumEpisodes={setNumEpisodes}
              datasetRepo={datasetRepo}
              setDatasetRepo={setDatasetRepo}
              envType={envType}
              envTypes={envTypes}
              envTypeFromCheckpoint={envTypeFromCheckpoint}
              envTypeMissing={envTypeMissing}
              envTaskFromCheckpoint={envTaskFromCheckpoint}
              envTaskMissing={envTaskMissing}
              task={task}
              advOpen={advOpen}
              setAdvOpen={setAdvOpen}
              datasetOverride={datasetOverride}
              setDatasetOverride={setDatasetOverride}
              isRealRobot={isRealRobot}
              imageKeysFromCheckpoint={imageKeysFromCheckpoint}
              cameraConfigOpen={cameraConfigOpen}
              setCameraConfigOpen={setCameraConfigOpen}
              cameraMapping={cameraMapping}
              setCameraMapping={setCameraMapping}
              mappedCamEntries={mappedCamEntries}
            />
          )}

          {/* ─── STARTING: Log-based steps ──────────────────────────── */}
          {showStarting && (
            <div className="flex-1 flex flex-col items-center justify-center py-16 gap-6">
              <Loader2 size={32} className="text-zinc-400 animate-spin" />
              <div className="flex flex-col gap-2">
                {EVAL_STARTING_STEPS.map((s, i) => (
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
                {selectedEnv?.label ?? envType} · {numEpisodes} episodes · {policyPath.split("/").pop() || policyPath}
              </p>
            </div>
          )}

          {/* ─── RUNNING: Monitoring ────────────────────────────────── */}
          {showRunning && (
            <EvalProgressPanel
              doneEpisodes={doneEpisodes}
              progressTotal={progressTotal}
              numEpisodes={numEpisodes}
              meanReward={meanReward}
              computedSuccessRate={computedSuccessRate}
              bestEp={bestEp}
              progressPct={progressPct}
              episodeResults={episodeResults}
            />
          )}

          {/* ─── DONE/STOPPED/ERROR: Results ─────────────────────────── */}
          {showResults && (
            <EvalResultsPanel
              progressStatus={progressStatus}
              selectedEnvLabel={selectedEnv?.label ?? ""}
              envType={envType}
              doneEpisodes={doneEpisodes}
              avgReward={avgReward}
              computedSuccessRate={computedSuccessRate}
              finalReward={finalReward}
              finalSuccess={finalSuccess}
              bestEp={bestEp}
              worstEp={worstEp}
              episodeResults={episodeResults}
              onQuickRerun={() => {
                void startEval(3);
              }}
              onStartNewEvaluation={() => {
                setProgressStatus("idle");
              }}
            />
          )}

        </div>
      </div>

      {/* ── Sticky Control Bar ─────────────────────────────────────────── */}
      <StickyControlBar>
        <div className="flex items-center gap-3 min-w-0">
          <StatusBadge
            status={
              showStarting ? "loading" :
              isRunning ? "running" :
              progressStatus === "completed" ? "ready" :
              progressStatus === "error" ? "blocked" :
              !preflightOk ? "blocked" : "ready"
            }
            label={
              showStarting ? "STARTING" :
              isRunning ? "EVALUATING" :
              progressStatus === "completed" ? "DONE" :
              progressStatus === "error" ? "ERROR" :
              !preflightOk ? "BLOCKED" : "READY"
            }
            pulse={isRunning}
          />
          <span className="text-sm text-zinc-400 truncate">
            {showStarting ? (
              "Starting evaluation…"
            ) : isRunning ? (
              <span className="font-mono">Episode {doneEpisodes} / {progressTotal ?? numEpisodes}</span>
            ) : (progressStatus === "completed" || progressStatus === "stopped") && avgReward !== null ? (
              <>
                Avg Reward: <span className={cn("font-mono", (avgReward ?? 0) >= 0.6 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>{avgReward.toFixed(3)}</span>
                {" "}· Success: <span className={cn("font-mono", (computedSuccessRate ?? 0) >= 60 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>{computedSuccessRate ?? "—"}%</span>
              </>
            ) : !preflightOk ? (
              <span className="text-amber-600 dark:text-amber-400">{preflightReason || "Device preflight failed"}</span>
            ) : showBlockers && configBlockers.length > 0 ? (
              <span className="text-amber-600 dark:text-amber-400">{configBlockers[0]}</span>
            ) : (
              "Evaluation ready"
            )}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <ProcessButtons
            running={isRunning}
            onStart={() => { void startEval(); }}
            onStop={stopEval}
            disabled={!!conflictProcess}
            startLabel={<><Play size={13} className="fill-current" /> Start Eval</>}
            compact
            buttonClassName="py-1"
          />
        </div>
      </StickyControlBar>
    </div>
  );
}
