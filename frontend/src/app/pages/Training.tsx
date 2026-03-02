import React, { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router";
import {
  RefreshCw, ChevronDown, ChevronUp, ExternalLink, Copy,
  Cpu, HardDrive, Zap, AlertTriangle, CheckCircle2, ArrowRight,
  Play, Square, RotateCcw, Loader2, Lock, Upload
} from "lucide-react";
import {
  PageHeader, StatusBadge, FieldRow, WireSelect, WireInput,
  ProcessButtons, StickyControlBar, WireToggle, Chip, BlockerCard, RefreshButton,
} from "../components/wireframe";
import { useHfAuth } from "../hf-auth-context";
import { cn } from "../components/ui/utils";
import {
  apiGet,
  apiPost,
  subscribeTrainChannel,
  type TrainMetricEvent,
  type TrainOutputEvent,
  type TrainStatusEvent,
} from "../services/apiClient";
import { useLeStudioStore } from "../store";
import {
  normalizeCheckpointStep,
  normalizeDeviceKey,
  parseBackendError,
  toBackendTrainPayload,
} from "../services/contracts";
import {
  notifyError,
  notifyProcessStarted,
  notifyProcessStopRequested,
  notifyProcessCompleted,
  notifyProcessEndedWithError,
} from "../services/notifications";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer
} from "recharts";

// ─── Types ────────────────────────────────────────────────────────────────────
type TrainStatus = "idle" | "starting" | "running" | "blocked";
type CudaState = "ok" | "fail" | "installing";
type PresetKey = "quick" | "standard" | "full";

type PreflightResponse = {
  ok: boolean;
  reason?: string;
  action?: string | null;
  command?: string | null;
};

type ActionResponse = {
  ok: boolean;
  error?: string;
};

type CheckpointItem = {
  name: string;
  path: string;
  step: number | null;
};

type CheckpointsResponse = {
  ok: boolean;
  checkpoints: CheckpointItem[];
};

type DatasetResponse = {
  datasets?: Array<{ id: string }>;
};

type GpuStatusResponse = {
  exists: boolean;
  utilization: number;
  memory_used: number;
  memory_total: number;
  memory_percent: number;
};

type ColabConfigResponse = {
  ok: boolean;
  error?: string;
  repo_id?: string;
  config_path?: string;
  colab_link?: string;
};

type ColabLinkResponse = {
  ok: boolean;
  error?: string;
  url?: string;
};

type HfGateBannerProps = {
  authState: string;
  level: "hf_read" | "hf_write";
};

const PRESETS: Record<PresetKey, { label: string; steps: number; tag: string }> = {
  quick:    { label: "Quick",    steps: 1000,  tag: "1K" },
  standard: { label: "Standard", steps: 50000, tag: "50K" },
  full:     { label: "Full",     steps: 100000, tag: "100K" },
};

const POLICY_TYPES = ["ACT", "Diffusion Policy", "TD-MPC2"];
const LOCAL_DATASETS = [
  "lerobot-user/pick_cube",
  "lerobot-user/place_cup",
  "lerobot-user/stack_blocks",
];
const CHECKPOINTS_MOCK = [
  { name: "checkpoint_010000", path: "outputs/train/act_pick_cube/checkpoints/010000", step: 10000 },
  { name: "checkpoint_025000", path: "outputs/train/act_pick_cube/checkpoints/025000", step: 25000 },
  { name: "last",              path: "outputs/train/act_pick_cube/checkpoints/last",   step: 25000 },
];

const STARTING_STEPS = [
  { label: "CUDA Preflight Check", delay: 400 },
  { label: "Loading Dataset", delay: 300 },
  { label: "Initializing Model", delay: 300 },
  { label: "Starting Training Loop", delay: 200 },
];

// ─── Custom Tooltip ───────────────────────────────────────────────────────────
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="px-3 py-2 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm font-mono shadow-xl">
      <div className="text-zinc-400 mb-1">Step {label?.toLocaleString()}</div>
      <div className="text-zinc-800 dark:text-zinc-200">loss: {payload[0]?.value?.toFixed(5)}</div>
    </div>
  );
}

// ─── GPU Bar ──────────────────────────────────────────────────────────────────
function GpuBar({ label, value, max, unit }: { label: string; value: number; max: number; unit: string }) {
  const pct = Math.round((value / max) * 100);
  const color = pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-zinc-500 dark:bg-zinc-400";
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-zinc-400 w-20 flex-none">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-zinc-200 dark:bg-zinc-700/80 overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-sm font-mono text-zinc-400 w-24 text-right flex-none">
        {value} / {max} {unit} <span className="text-zinc-500">({pct}%)</span>
      </span>
    </div>
  );
}

function HfGateBanner({ authState, level }: HfGateBannerProps) {
  const requirement = level === "hf_write" ? "write" : "read";
  return (
    <div className="rounded-lg border border-amber-300/70 bg-amber-50/80 dark:border-amber-500/40 dark:bg-amber-950/30 px-3 py-2 text-sm text-amber-800 dark:text-amber-200 flex items-center gap-2">
      <Lock size={14} className="flex-none" />
      <span>
        Hugging Face auth required ({requirement}). Current state: <span className="font-mono">{authState}</span>
      </span>
    </div>
  );
}

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
  const [lastOutputLine, setLastOutputLine] = useState("ready");
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
    if (colabRepoId) return;
    if (!selectedRepoId || !selectedRepoId.includes("/")) return;
    setColabRepoId(selectedRepoId);
  }, [colabRepoId, selectedRepoId]);

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
      {/* Top nav bar */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center px-6 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-sm text-zinc-400">
        <Link to="/dataset" className="inline-flex items-center gap-1 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">
          ← Dataset
        </Link>
        <div className="flex items-center gap-2">
          <span className="text-zinc-300 dark:text-zinc-600">Dataset</span>
          <span className="text-zinc-300 dark:text-zinc-600">›</span>
          <span className="text-zinc-700 dark:text-zinc-200 font-medium">Training</span>
          <span className="text-zinc-300 dark:text-zinc-600">›</span>
          <Link to="/evaluation" className="hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">Evaluation</Link>
        </div>
        <Link to="/evaluation" className="justify-self-end inline-flex items-center gap-1 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">
          Evaluation →
        </Link>
      </div>

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

              {/* Preflight — compact card (hidden when OK) */}
              {cudaState !== "ok" && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/5">
                  <AlertTriangle size={13} className="text-amber-600 dark:text-amber-400 flex-none" />
                  <span className="text-sm text-amber-600 dark:text-amber-400 flex-1 truncate">{preflightReason || "Environment check failed."}</span>
                  <div className="flex items-center gap-2 flex-none">
                    {cudaFixRunning ? (
                      <>
                        <span className="flex items-center gap-1.5 text-sm text-zinc-400">
                          <Loader2 size={12} className="animate-spin" /> Installing…
                        </span>
                        <button
                          onClick={() => { void apiPost("/api/process/train_install/stop"); setCudaFixRunning(false); }}
                          className="px-2 py-1 rounded border border-zinc-600 text-zinc-400 text-xs cursor-pointer hover:bg-zinc-800 transition-colors"
                        >Stop</button>
                      </>
                    ) : (
                      <>
                        {preflightAction === "install_torch_cuda" && (
                          <button
                            onClick={handleInstallCuda}
                            className="px-2.5 py-1 rounded border border-amber-500/50 bg-amber-500/10 text-amber-400 text-sm font-medium cursor-pointer hover:bg-amber-500/20 transition-all"
                          >Install CUDA PyTorch</button>
                        )}
                        {preflightAction && preflightAction !== "install_torch_cuda" && (
                          <button
                            onClick={() => { void handleInstallTorchcodecFix(); }}
                            className="px-2.5 py-1 rounded border border-amber-500/50 bg-amber-500/10 text-amber-400 text-sm font-medium cursor-pointer hover:bg-amber-500/20 transition-all"
                          >Auto Fix</button>
                        )}
                        <button
                          onClick={() => { setDevice("CPU"); setCudaState("ok"); setPreflightAction(null); }}
                          className="px-2.5 py-1 rounded border border-zinc-600 text-zinc-400 text-sm cursor-pointer hover:bg-zinc-800 transition-colors"
                        >Use CPU</button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Training Config */}
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
                <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800 flex items-center">
                  <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Training Config</span>
                </div>
                <div className="p-4 flex flex-col gap-4">

                  {/* Row 1: Policy Type + Dataset */}
                  <div className="grid grid-cols-1 md:grid-cols-[1fr_1px_1fr] gap-4 md:gap-0 md:items-start">
                    {/* Policy Type */}
                    <div className="md:pr-4">
                      <div className="text-sm text-zinc-500 mb-1.5">Policy Type</div>
                      <select
                        value={policyType}
                        onChange={(e) => setPolicyType(e.target.value)}
                        className="w-full h-7 px-2 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-700 dark:text-zinc-300 text-sm outline-none cursor-pointer focus:border-blue-500 dark:focus:border-blue-400"
                      >
                        {POLICY_TYPES.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>

                    {/* Vertical divider */}
                    <div className="hidden md:block bg-zinc-100 dark:bg-zinc-800/50" />

                    {/* Dataset Source */}
                    <div className="md:pl-4">
                      <div className="text-sm text-zinc-500 mb-1.5">Dataset</div>
                      <div className="flex items-center gap-1.5">
                        <div className="flex gap-0.5 p-0.5 rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/30 flex-none">
                          <button
                            onClick={() => setDatasetSource("local")}
                            className={cn("px-2 py-1 rounded text-sm transition-colors cursor-pointer leading-none",
                              datasetSource === "local"
                                ? "bg-white dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200 shadow-sm"
                                : "text-zinc-400 hover:text-zinc-500"
                            )}
                          >
                            Local
                          </button>
                          <button
                            onClick={() => { if (hfAuth === "ready") setDatasetSource("hf"); }}
                            className={cn("px-2 py-1 rounded text-sm transition-colors leading-none flex items-center gap-1",
                              datasetSource === "hf" && hfAuth === "ready"
                                ? "bg-white dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200 shadow-sm cursor-pointer"
                                : "text-zinc-400 hover:text-zinc-500 cursor-pointer",
                              hfAuth !== "ready" && "opacity-40 cursor-not-allowed"
                            )}
                            title={hfAuth !== "ready" ? "HF token required — configure in header" : "Load dataset from Hugging Face Hub"}
                          >
                            {hfAuth !== "ready" && <Lock size={10} />}
                            HF
                          </button>
                        </div>
                        <div className="flex-1 min-w-0">
                          {datasetSource === "local" ? (
                            <WireSelect
                              value={selectedLocalDataset}
                              options={availableDatasets.length > 0 ? availableDatasets : LOCAL_DATASETS}
                              onChange={setSelectedLocalDataset}
                            />
                          ) : (
                            <WireInput value={hfDatasetRepoId} onChange={setHfDatasetRepoId} placeholder="username/dataset-name" />
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Row 2: Device + Training Steps */}
                  <div className="grid grid-cols-1 md:grid-cols-[1fr_1px_1fr] gap-4 md:gap-0 pt-4 border-t border-zinc-100 dark:border-zinc-800/50 md:items-start">
                    {/* Compute Device */}
                    <div className="md:pr-4">
                      <div className="text-sm text-zinc-500 mb-1.5">Compute Device</div>
                      <select
                        value={device}
                        onChange={(e) => setDevice(e.target.value)}
                        className="w-full h-7 px-2 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-700 dark:text-zinc-300 text-sm outline-none cursor-pointer focus:border-blue-500 dark:focus:border-blue-400"
                      >
                        {["CUDA (GPU)", "CPU", "MPS (Apple Silicon)"].map((d) => <option key={d} value={d}>{d}</option>)}
                      </select>
                      {device === "MPS (Apple Silicon)" && (
                        <p className="text-sm text-amber-600 dark:text-amber-400 mt-1">⚠ Colab automatically uses CUDA.</p>
                      )}
                    </div>

                    {/* Vertical divider */}
                    <div className="hidden md:block bg-zinc-100 dark:bg-zinc-800/50" />

                    {/* Training Steps */}
                    <div className="md:pl-4">
                      <div className="text-sm text-zinc-500 mb-1.5">Training Steps</div>
                      <div className="flex items-center gap-2">
                        <div className="flex gap-1">
                          {(Object.entries(PRESETS) as [PresetKey, typeof PRESETS[PresetKey]][]).map(([key, p]) => (
                            <button
                              key={key}
                              onClick={() => handlePreset(key)}
                              className={cn("px-2.5 py-1.5 rounded border text-sm transition-colors cursor-pointer",
                                preset === key
                                  ? "border-zinc-900 dark:border-zinc-100 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-medium shadow-sm"
                                  : "border-zinc-200 dark:border-zinc-700 text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-600"
                              )}
                            >
                              {p.label} ({p.tag})
                            </button>
                          ))}
                        </div>
                        <input
                          type="number"
                          value={customSteps}
                          onChange={(e) => { setCustomSteps(Number(e.target.value)); setPreset("standard"); }}
                          className="w-24 h-7 px-2 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-700 dark:text-zinc-300 text-sm outline-none font-mono focus:border-blue-500 dark:focus:border-blue-400"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Advanced overrides */}
                  <div className="border-t border-zinc-100 dark:border-zinc-800 pt-3">
                    <button
                      onClick={() => setAdvOpen(!advOpen)}
                      className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-500 dark:hover:text-zinc-300 transition-colors cursor-pointer w-fit"
                    >
                      {advOpen ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                      Advanced Overrides
                    </button>
                    {advOpen && (
                      <div className="grid grid-cols-1 md:grid-cols-[1fr_1px_1fr] md:gap-0 gap-3 mt-3">
                        <div className="md:pr-4">
                          <FieldRow label="Learning Rate">
                            <input
                              type="text"
                              value={lrValue}
                              onChange={(e) => setLrValue(e.target.value)}
                              className="w-full h-7 px-2 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-700 dark:text-zinc-300 text-sm outline-none font-mono focus:border-blue-500 dark:focus:border-blue-400"
                            />
                          </FieldRow>
                        </div>
                        <div className="hidden md:block bg-zinc-100 dark:bg-zinc-800/50" />
                        <div className="md:pl-4">
                          <FieldRow label="Output Repo">
                            <div className="flex items-center gap-1.5">
                              <input
                                type="text"
                                value={modelOutputRepo}
                                onChange={(e) => setModelOutputRepo(e.target.value)}
                                placeholder="username/model-name (optional)"
                                disabled={hfAuth !== "ready"}
                                className={cn(
                                  "w-full h-7 px-2 rounded border text-sm outline-none placeholder:text-zinc-500 focus:border-blue-500 dark:focus:border-blue-400",
                                  hfAuth !== "ready"
                                    ? "border-amber-500/30 bg-amber-500/5 text-zinc-400 cursor-not-allowed"
                                    : "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-700 dark:text-zinc-300"
                                )}
                              />
                              {hfAuth !== "ready" && (
                                <span className="text-sm text-amber-600 dark:text-amber-400 whitespace-nowrap">🔒 HF</span>
                              )}
                            </div>
                          </FieldRow>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Colab 학습 설정 */}
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
                <button
                  onClick={() => setColabOpen(!colabOpen)}
                  className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-2 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors"
                >
                  <img src="/colab-logo.png" alt="" aria-hidden="true" className="size-3.5 object-contain" />
                  <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Colab Training</span>
                  <span className="text-sm text-zinc-400 ml-1">Train on Google Colab when you don't have a GPU</span>
                  {colabOpen ? <ChevronUp size={10} className="ml-auto text-zinc-400" /> : <ChevronDown size={10} className="ml-auto text-zinc-400" />}
                </button>
                {colabOpen && (
                  <div className="p-4 flex flex-col gap-4">
                    {hfAuth !== "ready" && (
                      <HfGateBanner authState={hfAuth} level="hf_write" />
                    )}

                    {/* Step 1: Push Dataset */}
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="flex-none size-5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold grid place-items-center leading-[0]">1</span>
                      <p className="text-sm text-zinc-600 dark:text-zinc-300 font-medium">Upload dataset to HF Hub</p>
                      <code className="text-[11px] text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded truncate">
                        {colabRepoId || selectedRepoId || "lerobot-user/pick_cube"}
                      </code>
                      <button
                        disabled={hfAuth !== "ready" || pushState !== "idle"}
                        onClick={handlePushToHub}
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

                    {/* Step 2: Copy snippet */}
                    <div className="flex items-start gap-3">
                      <span className="flex-none size-5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold grid place-items-center leading-[0] mt-0.5">2</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-zinc-600 dark:text-zinc-300 font-medium mb-1.5">Paste config snippet into Colab</p>
                        <div className="relative rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-900 overflow-hidden">
                          <div className="flex items-center justify-between px-4 py-2 bg-zinc-800 border-b border-zinc-700">
                            <span className="text-sm text-zinc-400 font-mono">python</span>
                            <button
                              onClick={() => { void handleCopySnippet(); }}
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

                    {/* Step 3: Open Colab */}
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="flex-none size-5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold grid place-items-center leading-[0]">3</span>
                      <p className="text-sm text-zinc-600 dark:text-zinc-300 font-medium">Open and run Colab notebook</p>
                      <button
                        type="button"
                        onClick={() => { void handleOpenColab(); }}
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
            </div>
          )}

          {/* ─── STARTING: Spinner + Checklist ──────────────────────── */}
          {trainStatus === "starting" && (
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
          )}

          {/* ─── RUNNING: Monitoring ────────────────────────────────── */}
          {trainStatus === "running" && (
            <div className="flex flex-col gap-4">

              {/* Progress + GPU row */}
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
                <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Training Progress</span>
                  <StatusBadge status="running" label="RUNNING" pulse />
                </div>
                <div className="p-4 flex flex-col gap-4">

                  {/* Stats row */}
                  <div className="flex items-center gap-6 flex-wrap">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm text-zinc-400">Step</span>
                      <span className="text-sm font-mono text-zinc-700 dark:text-zinc-200">
                        {currentStep.toLocaleString()} <span className="text-zinc-400 text-sm">/ {totalSteps.toLocaleString()}</span>
                      </span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm text-zinc-400">Loss</span>
                      <span className={cn("text-sm font-mono", latestLoss ? "text-zinc-700 dark:text-zinc-200" : "text-zinc-500")}>
                        {latestLoss ? latestLoss.toFixed(5) : "—"}
                      </span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm text-zinc-400">ETA</span>
                      <span className="text-sm font-mono text-zinc-700 dark:text-zinc-200">{eta}</span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm text-zinc-400">Policy</span>
                      <span className="text-sm text-zinc-500">{policyType}</span>
                    </div>

                    {/* GPU inline */}
                    <div className="ml-auto flex items-center gap-4 text-sm text-zinc-400">
                      <Cpu size={12} className="text-zinc-500" />
                      <span className="font-mono">GPU {gpuSnapshot.util}%</span>
                      <span className="font-mono">VRAM {gpuSnapshot.vramUsedGb}/{gpuSnapshot.vramTotalGb} GB</span>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div>
                    <div className="flex justify-between text-sm text-zinc-500 mb-1">
                      <span>{progress}%</span>
                      <span>{currentStep.toLocaleString()} / {totalSteps.toLocaleString()} steps</span>
                    </div>
                    <div className="h-2.5 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500 bg-zinc-800 dark:bg-zinc-200"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>

                  {lossData.length === 0 && (
                    <p className="text-sm text-zinc-400 italic">No training signals yet... will appear in chart shortly.</p>
                  )}
                </div>
              </div>

              {/* Loss Chart — full width */}
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
                <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800 flex items-center">
                  <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Loss Trend</span>
                </div>
                {lossData.length > 1 ? (
                  <div className="h-64 p-3">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={lossData} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(63,63,70,0.5)" vertical={false} />
                        <XAxis
                          dataKey="step"
                          tick={{ fontSize: 10, fill: "#71717a" }}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)}
                        />
                        <YAxis
                          tick={{ fontSize: 10, fill: "#71717a" }}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(v) => v.toFixed(3)}
                          width={46}
                        />
                        <Tooltip content={<CustomTooltip />} />
                        <Line
                          type="monotone"
                          dataKey="loss"
                          stroke="#71717a"
                          strokeWidth={2}
                          dot={false}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="h-40 flex items-center justify-center">
                    <p className="text-sm text-zinc-400 italic">Collecting data...</p>
                  </div>
                )}
              </div>

              {/* OOM Detection */}
              {oomDetected && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3.5 flex items-start gap-2.5">
                  <AlertTriangle size={14} className="text-red-600 dark:text-red-400 flex-none mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm text-red-600 dark:text-red-400 mb-1">GPU Out of Memory (OOM)</p>
                    <p className="text-sm text-zinc-400">Current batch size: 32. Reduce to 16 and retry?</p>
                  </div>
                  <button
                    onClick={() => { setOomDetected(false); void startTraining(); }}
                    className="flex items-center gap-1 px-4 py-2 rounded-lg border border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400 text-sm cursor-pointer hover:bg-red-500/20"
                  >
                    <RotateCcw size={12} /> Reduce &amp; Retry
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ─── COMPLETED: Checkpoints ─────────────────────────────── */}
          {completed && (
            <div className="flex flex-col gap-4">

              {/* Completion summary */}
              <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5">
                <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400 flex-none" />
                <div>
                  <span className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">Training Complete</span>
                  <span className="text-sm text-zinc-400 ml-3">
                    {policyType} · {totalSteps.toLocaleString()} steps · Loss {latestLoss?.toFixed(5) ?? "—"}
                  </span>
                </div>
              </div>

              {/* Loss Chart — final */}
              {lossData.length > 1 && (
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
                  <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800 flex items-center">
                    <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Loss Trend (Final)</span>
                  </div>
                  <div className="h-48 p-3">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={lossData} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(63,63,70,0.5)" vertical={false} />
                        <XAxis
                          dataKey="step"
                          tick={{ fontSize: 10, fill: "#71717a" }}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)}
                        />
                        <YAxis
                          tick={{ fontSize: 10, fill: "#71717a" }}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(v) => v.toFixed(3)}
                          width={46}
                        />
                        <Tooltip content={<CustomTooltip />} />
                        <Line
                          type="monotone"
                          dataKey="loss"
                          stroke="#71717a"
                          strokeWidth={2}
                          dot={false}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Checkpoints */}
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
                <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Checkpoints ({checkpointList.length})</span>
                  <button
                    onClick={() => { void refreshCheckpoints(); }}
                    className="text-zinc-400 hover:text-zinc-300 cursor-pointer p-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded"
                    title="Refresh"
                  >
                    <RefreshCw size={12} />
                  </button>
                </div>
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
                  {checkpointList.map((cp) => (
                    <div key={cp.name} className="flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/20 transition-colors">
                      <HardDrive size={12} className="text-zinc-400 flex-none" />
                      <div className="min-w-0 flex-1">
                        <span className="text-sm text-zinc-700 dark:text-zinc-300 font-mono">{cp.name}</span>
                        <span className="text-sm text-zinc-400 font-mono ml-3">{cp.path}</span>
                      </div>
                      <span className="text-sm text-zinc-500 font-mono flex-none">
                        step {cp.step !== null ? cp.step.toLocaleString() : "—"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Next action */}
              <div className="flex items-center gap-3 justify-end">
                <Link
                  to="/evaluation"
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                >
                  <ArrowRight size={12} /> Go to Policy Evaluation
                </Link>
                <button
                  onClick={() => { setShowCheckpoints(false); setCurrentStep(0); setLossData([]); }}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                >
                  <RotateCcw size={12} /> Start New Training
                </button>
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
              trainStatus === "running" ? "running" :
              trainStatus === "starting" ? "warning" :
              trainStatus === "blocked" ? "blocked" :
              "idle"
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
          {trainStatus === "running" && (
            <span className="text-sm text-zinc-400 font-mono truncate min-w-0">
              Step {currentStep.toLocaleString()} · Loss {latestLoss?.toFixed(5) ?? "—"} · ETA {eta}
            </span>
          )}
          {completed && (
            <span className="text-sm text-emerald-600 dark:text-emerald-400">Training Complete ✓</span>
          )}
          {trainStatus === "idle" && !completed && cudaState === "fail" && (
            <span className="text-sm text-zinc-400 truncate">{preflightReason || "Preflight failed"}</span>
          )}
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
          />
        </div>
      </StickyControlBar>
    </div>
  );
}
