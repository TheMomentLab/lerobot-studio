import { useState, useEffect, useCallback, useRef } from "react";
import {
  Play,
} from "lucide-react";
import {
  PageHeader, StatusBadge,
  ProcessButtons, StickyControlBar, BlockerCard, RefreshButton,
} from "../../components/wireframe";
import { useHfAuth } from "../../hf-auth-context";
import {
  apiGet,
  apiPost,
  subscribeTrainChannel,
  type TrainMetricEvent,
  type TrainOutputEvent,
  type TrainStatusEvent,
} from "../../services/apiClient";
import { useLeStudioStore } from "../../store";
import {
  normalizeCheckpointStep,
  normalizeDeviceKey,
  parseBackendError,
  toBackendTrainPayload,
} from "../../services/contracts";
import {
  notifyError,
  notifyProcessStarted,
  notifyProcessStopRequested,
  notifyProcessCompleted,
  notifyProcessEndedWithError,
} from "../../services/notifications";
import {
  type TrainStatus,
  type CudaState,
  type PresetKey,
  type PreflightResponse,
  type ActionResponse,
  type CheckpointItem,
  type CheckpointsResponse,
  type DatasetResponse,
  type GpuStatusResponse,
  type ColabConfigResponse,
  type ColabLinkResponse,
  PRESETS,
  LOCAL_DATASETS,
  CHECKPOINTS_MOCK,
  STARTING_STEPS,
} from "./types";
import { CustomTooltip } from "./components/CustomTooltip";
import { GpuBar } from "./components/GpuBar";
import { HfGateBanner } from "./components/HfGateBanner";
import { ColabPanel } from "./components/ColabPanel";
import { TrainCompletedPanel } from "./components/TrainCompletedPanel";
import { TrainPreflightBanner } from "./components/TrainPreflightBanner";
import { TrainProgressPanel } from "./components/TrainProgressPanel";
import { TrainSettingsPanel } from "./components/TrainSettingsPanel";
import { TrainStartingView } from "./components/TrainStartingView";

void GpuBar;
void CustomTooltip;
void HfGateBanner;

// ─── Main Component ───────────────────────────────────────────────────────────
export function Training() {
  const config = useLeStudioStore((s) => s.config);
  const { hfAuth } = useHfAuth();
  // Config
  const [policyType, setPolicyType] = useState("ACT");
  const [datasetSource, setDatasetSource] = useState<"local" | "hf">("local");
  // Auto-revert to local when HF auth becomes unavailable
  useEffect(() => {
    if (hfAuth !== "ready" && datasetSource === "hf") setDatasetSource("local");
  }, [hfAuth, datasetSource]);
  const [preset, setPreset] = useState<PresetKey>("standard");
  const [customSteps, setCustomSteps] = useState(PRESETS.standard.steps);
  const [device, setDevice] = useState("CUDA (GPU)");
  const [advOpen, setAdvOpen] = useState(false);
  const [lrValue, setLrValue] = useState("1e-4");
  const [modelOutputRepo, setModelOutputRepo] = useState("");
  const [selectedLocalDataset, setSelectedLocalDataset] = useState<string>(LOCAL_DATASETS[0]);
  const [hfDatasetRepoId, setHfDatasetRepoId] = useState("");

  // Status
  const [trainStatus, setTrainStatus] = useState<TrainStatus>("idle");
  const [cudaState, setCudaState] = useState<CudaState>("ok");
  const [cudaFixRunning, setCudaFixRunning] = useState(false);
  const [preflightReason, setPreflightReason] = useState<string>("");
  const [preflightAction, setPreflightAction] = useState<string | null>(null);

  // Progress
  const [currentStep, setCurrentStep] = useState(0);
  const [lossData, setLossData] = useState<{ step: number; loss: number }[]>([]);
  const [oomDetected, setOomDetected] = useState(false);

  // Panels
  const [showCheckpoints, setShowCheckpoints] = useState(false);
  const [startingStep, setStartingStep] = useState(0);
  const [checkpointList, setCheckpointList] = useState<CheckpointItem[]>(CHECKPOINTS_MOCK);
  const [flowError, setFlowError] = useState<string | null>(null);
  const [, setLastOutputLine] = useState("ready");
  const lastErrorAtRef = useRef(0);
  const prevRunningRef = useRef(false);
  const [availableDatasets, setAvailableDatasets] = useState<string[]>(LOCAL_DATASETS);

  const totalSteps = customSteps;
  const running = trainStatus === "running";
  const progress = totalSteps > 0 ? Math.round((currentStep / totalSteps) * 100) : 0;
  const latestLoss = lossData[lossData.length - 1]?.loss;
  const eta = running ? `~${Math.round((totalSteps - currentStep) / 500 * 0.8 / 60)}h ${Math.round(((totalSteps - currentStep) / 500 * 0.8) % 60)}m` : "—";
  const completed = trainStatus === "idle" && showCheckpoints;

  const [gpuSnapshot, setGpuSnapshot] = useState({ util: 76, vramUsedGb: 12, vramTotalGb: 24 });

  // Colab
  const [colabOpen, setColabOpen] = useState(false);
  const [colabCopied, setColabCopied] = useState(false);
  const [colabStarting, setColabStarting] = useState(false);
  const [colabRepoId, setColabRepoId] = useState("");
  const [colabConfigPath, setColabConfigPath] = useState("lestudio_train_config.json");
  const [colabLaunchUrl, setColabLaunchUrl] = useState("https://colab.research.google.com");
  const [pushState, setPushState] = useState<"idle" | "pushing" | "done">("idle");
  const selectedRepoId = datasetSource === "hf" ? hfDatasetRepoId.trim() : selectedLocalDataset.trim();

  const handlePushToHub = useCallback(async () => {
    if (pushState !== "idle") return;
    if (!selectedRepoId || !selectedRepoId.includes("/")) {
      const reason = "Please select a valid dataset repo_id (user/repo) first.";
      setFlowError(reason);
      notifyError(reason);
      return;
    }
    setPushState("pushing");
    setFlowError(null);
    try {
      const uploaded = await apiPost<ColabConfigResponse>("/api/train/colab/config", {
        train_repo_id: selectedRepoId,
        train_policy: policyType,
        train_steps: customSteps,
        train_device: normalizeDeviceKey(device),
        train_lr: lrValue,
        train_output_repo: modelOutputRepo,
        train_dataset_source: datasetSource,
      });
      if (!uploaded.ok) {
        const reason = uploaded.error ?? "Failed to upload Colab config";
        setPushState("idle");
        setFlowError(reason);
        notifyError(reason);
        return;
      }

      const nextRepoId = (uploaded.repo_id ?? selectedRepoId).trim();
      const nextConfigPath = (uploaded.config_path ?? "lestudio_train_config.json").trim() || "lestudio_train_config.json";
      let nextLaunchUrl = (uploaded.colab_link ?? "").trim();

      if (!nextLaunchUrl) {
        const query = new URLSearchParams({
          repo_id: nextRepoId,
          config_path: nextConfigPath,
        });
        const linkResponse = await apiGet<ColabLinkResponse>(`/api/train/colab/link?${query.toString()}`);
        if (linkResponse.ok && linkResponse.url) {
          nextLaunchUrl = linkResponse.url.trim();
        }
      }

      setColabRepoId(nextRepoId);
      setColabConfigPath(nextConfigPath);
      setColabLaunchUrl(nextLaunchUrl || "https://colab.research.google.com");
      setPushState("done");
      setTimeout(() => setPushState("idle"), 3000);
    } catch (error) {
      const reason = parseBackendError(error, "Error preparing Colab");
      setPushState("idle");
      setFlowError(reason);
      notifyError(reason);
    }
  }, [customSteps, datasetSource, device, lrValue, modelOutputRepo, policyType, pushState, selectedRepoId]);

  const colabSnippet = `repo_id = "${colabRepoId || selectedRepoId || "lerobot-user/pick_cube"}"  #@param {type:"string"}
config_path = "${colabConfigPath}"  #@param {type:"string"}

if "lestudio_load_config" in globals():
    cfg = lestudio_load_config(repo_id=repo_id, config_path=config_path)
else:
    import json, os
    from huggingface_hub import hf_hub_download
    cfg_file = hf_hub_download(
        repo_id=repo_id,
        filename=config_path,
        repo_type="dataset",
        token=os.getenv("HF_TOKEN"),
    )
    with open(cfg_file, "r", encoding="utf-8") as f:
        cfg = json.load(f)
print("LeStudio config loaded:", cfg.get("dataset_repo"), cfg.get("policy"), cfg.get("steps"))`;

  const handleOpenColab = useCallback(async () => {
    if (hfAuth !== "ready") return;
    const openUrl = colabLaunchUrl || "https://colab.research.google.com";
    setColabStarting(true);
    try {
      window.open(openUrl, "_blank", "noopener,noreferrer");
    } finally {
      setColabStarting(false);
    }
  }, [colabLaunchUrl, hfAuth]);

  const handleCopySnippet = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(colabSnippet);
      setColabCopied(true);
      setTimeout(() => setColabCopied(false), 2000);
    } catch {
      // fallback: noop in wireframe
    }
  }, [colabSnippet]);

  const refreshCheckpoints = useCallback(async () => {
    const response = await apiGet<CheckpointsResponse>("/api/checkpoints");
    if (response.ok && Array.isArray(response.checkpoints)) {
      setCheckpointList(
        response.checkpoints.map((checkpoint) => ({
          ...checkpoint,
          step: normalizeCheckpointStep(checkpoint.step),
        })),
      );
    }
  }, []);

  const startTraining = useCallback(async () => {
    setFlowError(null);
    try {
      const preflightDevice = normalizeDeviceKey(device);
      const preflight = await apiGet<PreflightResponse>(`/api/train/preflight?device=${encodeURIComponent(preflightDevice)}`);
      if (!preflight.ok) {
        setTrainStatus("idle");
        setCudaState("fail");
        const reason = preflight.reason ?? "train preflight failed";
        setPreflightReason(reason);
        setPreflightAction(preflight.action ?? null);
        notifyError(reason);
        return;
      }

      const payload = toBackendTrainPayload({
        policyLabel: policyType,
        datasetSource,
        localDatasetId: selectedLocalDataset,
        hfDatasetId: hfDatasetRepoId,
        steps: customSteps,
        deviceLabel: device,
        lr: lrValue,
        outputRepo: modelOutputRepo,
        config,
      });

      const start = await apiPost<ActionResponse>("/api/train/start", payload);
      if (!start.ok) {
        setTrainStatus("idle");
        const reason = start.error ?? "failed to start training";
        setFlowError(reason);
        notifyError(reason);
        return;
      }

      setTrainStatus("starting");
      notifyProcessStarted("train");
      setLossData([]);
      setCurrentStep(0);
      setOomDetected(false);
      setShowCheckpoints(false);
      setStartingStep(0);

      let step = 0;
      const advanceStep = () => {
        step++;
        setStartingStep(step);
        if (step < STARTING_STEPS.length) {
          setTimeout(advanceStep, STARTING_STEPS[step].delay);
        }
      };
      setTimeout(advanceStep, STARTING_STEPS[0].delay);
    } catch (error) {
      const reason = parseBackendError(error, "failed to start training");
      setTrainStatus("idle");
      setFlowError(reason);
      notifyError(reason);
    }
  }, [config, customSteps, datasetSource, device, hfDatasetRepoId, lrValue, modelOutputRepo, policyType, selectedLocalDataset]);

  const stopTraining = useCallback(async () => {
    const stop = await apiPost<ActionResponse>("/api/process/train/stop");
    if (!stop.ok) {
      const reason = stop.error ?? "failed to stop training";
      setFlowError(reason);
      notifyError(reason);
      return;
    }
    setTrainStatus("idle");
    setFlowError(null);
    notifyProcessStopRequested("train");
  }, []);

  const handlePreset = (key: PresetKey) => {
    setPreset(key);
    setCustomSteps(PRESETS[key].steps);
  };

  const handleInstallCuda = async () => {
    setCudaState("installing");
    setCudaFixRunning(true);
    const install = await apiPost<ActionResponse>("/api/train/install_pytorch", { nightly: true });
    if (!install.ok) {
      setCudaState("fail");
      setFlowError(install.error ?? "install failed");
      setCudaFixRunning(false);
      return;
    }
    setCudaState("ok");
    setCudaFixRunning(false);
    setFlowError(null);
  };

  const handleInstallTorchcodecFix = useCallback(async () => {
    setFlowError(null);
    try {
      const preflightDevice = normalizeDeviceKey(device);
      const preflight = await apiGet<PreflightResponse>(`/api/train/preflight?device=${encodeURIComponent(preflightDevice)}`);
      const command = (preflight.command ?? "").trim();
      if (!command) {
        const reason = "Could not find torchcodec fix command. Please check preflight again.";
        setFlowError(reason);
        notifyError(reason);
        return;
      }
      const response = await apiPost<ActionResponse>("/api/train/install_torchcodec_fix", { command });
      if (!response.ok) {
        const reason = response.error ?? "Failed to run torchcodec fix";
        setFlowError(reason);
        notifyError(reason);
        return;
      }
      setCudaFixRunning(true);
      setCudaState("installing");
    } catch (error) {
      const reason = parseBackendError(error, "Error running torchcodec fix");
      setFlowError(reason);
      notifyError(reason);
    }
  }, [device]);

  useEffect(() => {
    if (completed) {
      void refreshCheckpoints();
    }
  }, [completed, refreshCheckpoints]);

  useEffect(() => {
    const poll = async () => {
      const response = await apiGet<DatasetResponse>("/api/datasets");
      const next = (response.datasets ?? [])
        .map((item) => item.id)
        .filter((id) => typeof id === "string" && id.length > 0);
      if (next.length > 0) {
        setAvailableDatasets(next);
        setSelectedLocalDataset((prev) => (next.includes(prev) ? prev : next[0]));
      }
    };

    void poll();
    const timer = setInterval(() => {
      void poll();
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  // Preflight check on mount and device change
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const preflightDevice = normalizeDeviceKey(device);
        const res = await apiGet<PreflightResponse>(`/api/train/preflight?device=${encodeURIComponent(preflightDevice)}`);
        if (cancelled) return;
        if (res.ok) {
          setCudaState("ok");
          setPreflightReason(res.reason ?? "");
          setPreflightAction(null);
        } else {
          setCudaState("fail");
          setPreflightReason(res.reason ?? "Preflight check failed");
          setPreflightAction(res.action ?? null);
        }
      } catch {
        // preflight fetch failed — leave current state
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [device]);

  useEffect(() => {
    if (!flowError) return;
    lastErrorAtRef.current = Date.now();
  }, [flowError]);

  useEffect(() => {
    const runningNow = trainStatus === "running" || trainStatus === "starting";
    const wasRunning = prevRunningRef.current;

    if (wasRunning && !runningNow) {
      const abnormal = Date.now() - lastErrorAtRef.current < 120000;
      if (abnormal) {
        notifyProcessEndedWithError("train", undefined, { toast: false });
      } else {
        notifyProcessCompleted("train");
      }
    }

    prevRunningRef.current = runningNow;
  }, [trainStatus]);

  useEffect(() => {
    if (trainStatus !== "running") return;

    const poll = async () => {
      const response = await apiGet<GpuStatusResponse>("/api/gpu/status");
      if (!response.exists) {
        return;
      }
      setGpuSnapshot({
        util: response.utilization,
        vramUsedGb: Number((response.memory_used / 1024).toFixed(1)),
        vramTotalGb: Number((response.memory_total / 1024).toFixed(1)),
      });
    };

    void poll();
    const timer = setInterval(() => {
      void poll();
    }, 5000);

    return () => clearInterval(timer);
  }, [trainStatus]);

  useEffect(() => {
    const unsubscribeStatus = subscribeTrainChannel("status", (event: TrainStatusEvent) => {
      if (event.payload.state === "starting") {
        setTrainStatus("starting");
        return;
      }

      if (event.payload.state === "running") {
        setTrainStatus("running");
        return;
      }

      setTrainStatus((prev) => (prev === "running" || prev === "starting" ? "idle" : prev));
      if (event.payload.reason === "completed") {
        setShowCheckpoints(true);
      }
    });

    const unsubscribeMetric = subscribeTrainChannel("metric", (event: TrainMetricEvent) => {
      const { step, loss, totalSteps: streamTotal } = event.payload;
      setCurrentStep(step);
      setLossData((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.step === step) {
          return prev;
        }
        return [...prev, { step, loss }];
      });
      if (step >= streamTotal) {
        setShowCheckpoints(true);
      }
    });

    const unsubscribeOutput = subscribeTrainChannel("output", (event: TrainOutputEvent) => {
      setLastOutputLine(event.payload.line);
      if (event.payload.level === "error" || /\berror\b|traceback|exception|failed/i.test(event.payload.line)) {
        lastErrorAtRef.current = Date.now();
      }
    });

    return () => {
      unsubscribeStatus();
      unsubscribeMetric();
      unsubscribeOutput();
    };
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 flex flex-col gap-4 max-w-[1600px] mx-auto w-full">

          {/* Header */}
          <PageHeader
            title="AI Training"
            subtitle="Train AI policies on recorded datasets and monitor progress in real-time"
            action={<RefreshButton onClick={() => { void refreshCheckpoints(); }} />}
          />

          {flowError && cudaState === "ok" && <BlockerCard title="Execution Blocked" severity="error" reasons={[flowError]} />}

          {/* ─── IDLE: Settings ─────────────────────────────────────── */}
          {trainStatus === "idle" && !completed && (
            <div className="flex flex-col gap-4">
              <TrainPreflightBanner
                cudaState={cudaState}
                preflightReason={preflightReason}
                preflightAction={preflightAction}
                cudaFixRunning={cudaFixRunning}
                onInstallCuda={handleInstallCuda}
                onInstallTorchcodecFix={() => { void handleInstallTorchcodecFix(); }}
                onUseCpu={() => { setDevice("CPU"); setCudaState("ok"); setPreflightAction(null); }}
                onStopInstall={() => { void apiPost("/api/process/train_install/stop"); setCudaFixRunning(false); }}
              />

              <TrainSettingsPanel
                policyType={policyType}
                setPolicyType={setPolicyType}
                datasetSource={datasetSource}
                setDatasetSource={setDatasetSource}
                hfAuth={hfAuth}
                selectedLocalDataset={selectedLocalDataset}
                setSelectedLocalDataset={setSelectedLocalDataset}
                availableDatasets={availableDatasets}
                hfDatasetRepoId={hfDatasetRepoId}
                setHfDatasetRepoId={setHfDatasetRepoId}
                device={device}
                setDevice={setDevice}
                preset={preset}
                customSteps={customSteps}
                setCustomSteps={setCustomSteps}
                setPreset={setPreset}
                handlePreset={handlePreset}
                advOpen={advOpen}
                setAdvOpen={setAdvOpen}
                lrValue={lrValue}
                setLrValue={setLrValue}
                modelOutputRepo={modelOutputRepo}
                setModelOutputRepo={setModelOutputRepo}
              />

              <ColabPanel
                colabOpen={colabOpen}
                setColabOpen={setColabOpen}
                hfAuth={hfAuth}
                colabRepoId={colabRepoId}
                selectedRepoId={selectedRepoId}
                pushState={pushState}
                onPushToHub={() => { void handlePushToHub(); }}
                handleCopySnippet={() => { void handleCopySnippet(); }}
                colabCopied={colabCopied}
                colabSnippet={colabSnippet}
                handleOpenColab={() => { void handleOpenColab(); }}
                colabStarting={colabStarting}
                device={device}
              />
            </div>
          )}

          {/* ─── STARTING: Spinner + Checklist ──────────────────────── */}
          {trainStatus === "starting" && (
            <TrainStartingView
              startingStep={startingStep}
              policyType={policyType}
              datasetSource={datasetSource}
              customSteps={customSteps}
              availableDatasets={availableDatasets}
            />
          )}

          {/* ─── RUNNING: Monitoring ────────────────────────────────── */}
          {trainStatus === "running" && (
            <TrainProgressPanel
              currentStep={currentStep}
              totalSteps={totalSteps}
              latestLoss={latestLoss}
              eta={eta}
              policyType={policyType}
              gpuSnapshot={gpuSnapshot}
              progress={progress}
              lossData={lossData}
              oomDetected={oomDetected}
              onRetryAfterOom={() => { setOomDetected(false); void startTraining(); }}
            />
          )}

          {/* ─── COMPLETED: Checkpoints ─────────────────────────────── */}
          {completed && (
            <TrainCompletedPanel
              policyType={policyType}
              totalSteps={totalSteps}
              latestLoss={latestLoss}
              lossData={lossData}
              checkpointList={checkpointList}
              onRefreshCheckpoints={() => { void refreshCheckpoints(); }}
              onStartNewTraining={() => { setShowCheckpoints(false); setCurrentStep(0); setLossData([]); }}
            />
          )}

        </div>
      </div>

      {/* ── Sticky Control Bar ─────────────────────────────────────────── */}
      <StickyControlBar>
        <div className="flex items-center gap-3 min-w-0">
          <StatusBadge
            status={
              trainStatus === "running" ? "running" :
              trainStatus === "starting" ? "warning" :
              trainStatus === "blocked" ? "blocked" :
              "ready"
            }
            label={
              trainStatus === "running" ? "TRAINING" :
              trainStatus === "starting" ? "STARTING" :
              trainStatus === "blocked" ? "BLOCKED" :
              completed ? "DONE" :
              "READY"
            }
            pulse={trainStatus === "running"}
          />
          <span className="text-sm text-zinc-400 truncate min-w-0">
            {trainStatus === "running" ? (
              <span className="font-mono">Step {currentStep.toLocaleString()} · Loss {latestLoss?.toFixed(5) ?? "—"} · ETA {eta}</span>
            ) : trainStatus === "starting" ? (
              "Starting training…"
            ) : completed ? (
              <span className="text-emerald-600 dark:text-emerald-400">Training complete</span>
            ) : trainStatus === "blocked" || cudaState === "fail" ? (
              preflightReason || "Preflight failed"
            ) : (
              "Training ready"
            )}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <ProcessButtons
            running={trainStatus === "running" || trainStatus === "starting"}
            onStart={() => { void startTraining(); }}
            onStop={() => { void stopTraining(); }}
            disabled={cudaState === "fail"}
            startLabel={<><Play size={13} className="fill-current" /> Start Training</>}
            compact
            fullWidth={false}
            buttonClassName="py-1"
          />
        </div>
      </StickyControlBar>
    </div>
  );
}
