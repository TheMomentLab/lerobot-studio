import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Play } from "lucide-react";
import { apiGet, apiPost } from "../../services/apiClient";
import { MotorMappingGate } from "../../components/MotorMappingGate";
import { useLeStudioStore, getLeStudioState } from "../../store";
import {
  extractPreflightReason,
  getConfigBool,
  getConfigString,
  parseBackendError,
  toBackendRecordPayload,
  type PreflightResult,
} from "../../services/contracts";
import {
  PageHeader, StatusBadge, ModeToggle, StickyControlBar, ProcessButtons, SubTabs,
  BlockerCard, RefreshButton,
} from "../../components/wireframe";
import { buttonStyles } from "../../components/ui/button";
import {
  buildMappedArmLists,
  defaultArmSelection,
  resolveArmConfig,
  type MappedArmLists,
  type ArmSelection,
  type ResolvedArmConfig,
} from "../../services/armSets";
import { useHfAuth } from "../../hf-auth-context";
import {
  notifyError,
  notifyProcessStarted,
  notifyProcessStopRequested,
  notifyProcessCompleted,
  notifyProcessEndedWithError,
} from "../../services/notifications";
import { toVideoName, useCameraFeeds } from "../../hooks/useCameraFeeds";
import { RecordingPlanTab } from "./components/RecordingPlanTab";
import { RecordingDeviceTab } from "./components/RecordingDeviceTab";
import { RecordingCameraTab } from "./components/RecordingCameraTab";
import { RecordingLoadingView } from "./components/RecordingLoadingView";
import { RecordingRunningView } from "./components/RecordingRunningView";



type RecPhase = "idle" | "loading" | "running";

type ActionResponse = {
  ok: boolean;
  error?: string;
  currentEp?: number;
  event?: string;
};

type DevicesResponse = {
  cameras: Array<{ device: string; path: string; kernels: string; symlink: string; model: string }>;
  arms: Array<{ device: string; path: string; symlink?: string | null }>;
};

type CalibFile = { id: string; guessed_type: string; rel_path?: string };

const LOADING_STEPS = [
  { label: "Opening cameras...", pattern: /OpenCVCamera.*connected\./i },
  { label: "Connecting arm...", pattern: /(?:SO\w*(?:Leader|Follower)|(?:Leader|Follower))\s+connected\./i },
  { label: "Starting recording...", pattern: /Recording episode/i },
];

export function Recording() {
  const config = useLeStudioStore((s) => s.config);
  const updateConfig = useLeStudioStore((s) => s.updateConfig);
  const recordRunningOnBackend = useLeStudioStore((s) => !!s.procStatus.record);
  const recordReconnected = useLeStudioStore((s) => !!s.procReconnected.record);
  const [mode, setMode] = useState("Single Arm");
  const [phase, setPhase] = useState<RecPhase>(() => recordRunningOnBackend ? "running" : "idle");
  const [loadingStep, setLoadingStep] = useState(0);
  const [currentEp, setCurrentEp] = useState(0);
  const [totalEps, setTotalEps] = useState(50);
  const [pausedFeeds, setPausedFeeds] = useState<Record<string, boolean>>({});
  const [advStreamOpen, setAdvStreamOpen] = useState(false);
  const [recTab, setRecTab] = useState("plan");
  const [startAccepted, setStartAccepted] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [flowError, setFlowError] = useState<string | null>(null);
  const lastErrorAtRef = useRef(0);
  const prevRunningRef = useRef(false);
  const { hfAuth } = useHfAuth();
  const [recordRepoId, setRecordRepoId] = useState(() =>
    getConfigString(config, "record_repo_id", ""),
  );
  const [datasetStorageMode, setDatasetStorageMode] = useState<"local" | "hf">("local");
  const [localDatasetRoot, setLocalDatasetRoot] = useState(() =>
    getConfigString(config, "record_dataset_root", "~/.cache/huggingface/lerobot"),
  );
  const [recordTask, setRecordTask] = useState(() => getConfigString(config, "record_task", ""));
  const [availableDatasets, setAvailableDatasets] = useState<string[]>([]);

  useEffect(() => {
    apiGet<{ datasets?: { id: string }[] }>("/api/datasets").then((res) => {
      const ids = (res.datasets ?? []).map((d) => d.id).filter(Boolean);
      setAvailableDatasets(ids);
    }).catch(() => {});
  }, []);
  const [resumeEnabled, setResumeEnabled] = useState(() => getConfigBool(config, "record_resume", false));
  const [camerasMapped, setCamerasMapped] = useState<{ role: string; path: string }[]>([]);
  const [enabledCameras, setEnabledCameras] = useState<Set<string>>(new Set());
  const [armLists, setArmLists] = useState<MappedArmLists>({ followers: [], leaders: [] });
  const [armSelection, setArmSelection] = useState<ArmSelection>({ follower: "", leader: "" });
  const [calibFilesRaw, setCalibFilesRaw] = useState<CalibFile[]>([]);
  const [selectedFollowerPort, setSelectedFollowerPort] = useState("");
  const [selectedLeaderPort, setSelectedLeaderPort] = useState("");
  const [selectedLeftFollowerPort, setSelectedLeftFollowerPort] = useState("");
  const [selectedRightFollowerPort, setSelectedRightFollowerPort] = useState("");
  const [selectedLeftLeaderPort, setSelectedLeftLeaderPort] = useState("");
  const [selectedRightLeaderPort, setSelectedRightLeaderPort] = useState("");
  const [selectedFollowerId, setSelectedFollowerId] = useState("");
  const [selectedLeaderId, setSelectedLeaderId] = useState("");

  const progress = Math.round((currentEp / totalEps) * 100);
  const running = phase === "running";
  const selectedCameras = useMemo(
    () => camerasMapped.filter((cam: { role: string; path: string }) => enabledCameras.has(cam.role)),
    [camerasMapped, enabledCameras],
  );
  const feedTargets = useMemo(
    () => selectedCameras.map((cam: { role: string; path: string }) => ({ id: cam.role, videoName: toVideoName(cam.path) })),
    [selectedCameras],
  );
  const previewFeedsActive = phase === "idle" && recTab === "camera";
  const cameraFrames = useCameraFeeds(feedTargets, previewFeedsActive || running, 30, pausedFeeds);
  const effectiveConfig = useMemo(() => ({
    ...config,
    follower_port: selectedFollowerPort || getConfigString(config, "follower_port", "/dev/follower_arm_1"),
    leader_port: selectedLeaderPort || getConfigString(config, "leader_port", "/dev/leader_arm_1"),
    left_follower_port: selectedLeftFollowerPort || getConfigString(config, "left_follower_port", "/dev/follower_arm_1"),
    right_follower_port: selectedRightFollowerPort || getConfigString(config, "right_follower_port", "/dev/follower_arm_2"),
    left_leader_port: selectedLeftLeaderPort || getConfigString(config, "left_leader_port", "/dev/leader_arm_1"),
    right_leader_port: selectedRightLeaderPort || getConfigString(config, "right_leader_port", "/dev/leader_arm_2"),
    robot_id: selectedFollowerId || getConfigString(config, "robot_id", "follower_arm_1"),
    teleop_id: selectedLeaderId || getConfigString(config, "teleop_id", "leader_arm_1"),
    left_robot_id: getConfigString(config, "left_robot_id", "follower_arm_1"),
    right_robot_id: getConfigString(config, "right_robot_id", "follower_arm_2"),
    left_teleop_id: getConfigString(config, "left_teleop_id", "leader_arm_1"),
    right_teleop_id: getConfigString(config, "right_teleop_id", "leader_arm_2"),
  }), [config, selectedFollowerPort, selectedLeaderPort, selectedLeftFollowerPort, selectedRightFollowerPort, selectedLeftLeaderPort, selectedRightLeaderPort, selectedFollowerId, selectedLeaderId]);

  const persistConfigPatch = useCallback((patch: Record<string, unknown>) => {
    updateConfig(patch);
    void apiPost<Record<string, unknown>>("/api/config", patch).catch(() => undefined);
  }, [updateConfig]);
  const handleArmSetConfigResolved = useCallback((resolved: ResolvedArmConfig) => {
    setSelectedFollowerPort(resolved.followerPort);
    setSelectedLeaderPort(resolved.leaderPort);
    setSelectedLeftFollowerPort(resolved.leftFollowerPort);
    setSelectedRightFollowerPort(resolved.rightFollowerPort);
    setSelectedLeftLeaderPort(resolved.leftLeaderPort);
    setSelectedRightLeaderPort(resolved.rightLeaderPort);
    setSelectedFollowerId(resolved.followerId);
    setSelectedLeaderId(resolved.leaderId);
    persistConfigPatch({
      robot_type: resolved.robotType,
      teleop_type: resolved.teleopType,
      follower_port: resolved.followerPort,
      leader_port: resolved.leaderPort,
      robot_id: resolved.followerId,
      teleop_id: resolved.leaderId,
      left_follower_port: resolved.leftFollowerPort,
      right_follower_port: resolved.rightFollowerPort,
      left_leader_port: resolved.leftLeaderPort,
      right_leader_port: resolved.rightLeaderPort,
      left_robot_id: resolved.leftRobotId,
      right_robot_id: resolved.rightRobotId,
      left_teleop_id: resolved.leftTeleopId,
      right_teleop_id: resolved.rightTeleopId,
    });
  }, [persistConfigPatch]);

  const handleStart = async () => {
    if (actionPending) return;
    setActionPending(true);
    setFlowError(null);
    setStartAccepted(false);
    setPhase("loading");
    setLoadingStep(0);
    loadingStepRef.current = 0;
    loadingStartIdxRef.current = (recordLogs ?? []).length;
    try {
      const payload = toBackendRecordPayload({
        modeLabel: mode,
        totalEpisodes: totalEps,
        repoId: recordRepoId.trim(),
        task: recordTask.trim(),
        resume: resumeEnabled,
        pushToHub: datasetStorageMode === "hf" && hfAuth === "ready",
        datasetRoot: datasetStorageMode === "local" ? localDatasetRoot.trim() : undefined,
        cameras: selectedCameras,
        config: effectiveConfig,
      });

      const preflight = await apiPost<PreflightResult>("/api/preflight", payload);
      if (!preflight.ok) {
        setPhase("idle");
        const reason = extractPreflightReason(preflight);
        setFlowError(reason);
        notifyError(reason);
        return;
      }

      const started = await apiPost<ActionResponse & { resume_requested?: boolean; resume_enabled?: boolean }>("/api/record/start", payload);
      if (!started.ok) {
        setPhase("idle");
        const reason = started.error ?? "failed to start recording";
        setFlowError(reason);
        notifyError(reason);
        return;
      }

      if (started.resume_requested && !started.resume_enabled) {
        notifyError("Resume requested but target dataset was not found. Started without resume.");
      }

      setStartAccepted(true);
      notifyProcessStarted("record");
    } catch (error) {
      setPhase("idle");
      const reason = parseBackendError(error, "failed to start recording");
      setFlowError(reason);
      notifyError(reason);
    } finally {
      setActionPending(false);
    }
  };
  const handleStop = useCallback(async () => {
    if (actionPending) return;
    setActionPending(true);
    const stopped = await apiPost<ActionResponse>("/api/process/record/stop");
    if (!stopped.ok) {
      const reason = stopped.error ?? "failed to stop recording";
      setFlowError(reason);
      notifyError(reason);
    } else {
      notifyProcessStopRequested("record");
    }
    setPhase("idle");
    setLoadingStep(0);
    setStartAccepted(false);
    setActionPending(false);
  }, [actionPending]);
  const handleSave = useCallback(async () => {
    if (actionPending) return;
    setActionPending(true);
    const result = await apiPost<ActionResponse>("/api/process/record/input", { text: "right" });
    if (!result.ok) {
      const reason = result.error ?? "save failed";
      setFlowError(reason);
      notifyError(reason);
    }
    // Episode counter is updated by log-based tracking (Recording episode N)
    setActionPending(false);
  }, [actionPending]);
  const handleDiscard = useCallback(async () => {
    if (actionPending) return;
    setActionPending(true);
    const result = await apiPost<ActionResponse>("/api/process/record/input", { text: "left" });
    if (!result.ok) {
      const reason = result.error ?? "discard failed";
      setFlowError(reason);
      notifyError(reason);
    }
    // Episode counter is updated by log-based tracking (Recording episode N)
    setActionPending(false);
  }, [actionPending]);

  const toggleFeed = (role: string) =>
    setPausedFeeds((prev) => ({ ...prev, [role]: !prev[role] }));

  const toggleCamera = (role: string) => {
    setEnabledCameras((prev: Set<string>) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  };

  // Real log-based loading sequence
  const recordLogs = useLeStudioStore((s) => s.logLines["record"]);
  const loadingStartIdxRef = useRef(0);
  const loadingStepRef = useRef(0);

  // Sync phase with backend process status
  useEffect(() => {
    if (phase === "idle" && recordRunningOnBackend) {
      const logs = getLeStudioState().logLines["record"] ?? [];
      loadingStartIdxRef.current = logs.length;
      // Restore episode counter from existing logs
      let latestEp = -1;
      for (const line of logs) {
        const m = /Recording episode (\d+)/i.exec(line.text);
        if (m) latestEp = Number(m[1]);
      }
      if (latestEp >= 0) setCurrentEp(latestEp);
      setPhase("running");
    } else if (phase !== "idle" && !recordRunningOnBackend) {
      setPhase("idle");
      setStartAccepted(false);
      setActionPending(false);
    }
  }, [phase, recordRunningOnBackend]);

  useEffect(() => {
    if (phase !== "loading" || !startAccepted) return;

    const logs = recordLogs ?? [];
    const logsToScan = logs.slice(loadingStartIdxRef.current);
    let step = loadingStepRef.current;
    for (const line of logsToScan) {
      if (step >= LOADING_STEPS.length) break;
      // Check current step and all later steps — skip ahead if a later one matches first
      for (let s = step; s < LOADING_STEPS.length; s++) {
        if (LOADING_STEPS[s].pattern.test(line.text)) {
          step = s + 1;
          break;
        }
      }
    }

    if (step !== loadingStepRef.current) {
      loadingStepRef.current = step;
      setLoadingStep(step);
      if (step >= LOADING_STEPS.length) {
        setPhase("running");
      }
    }
  }, [phase, startAccepted, recordLogs]);

  // Timeout fallback: if stuck on loading for 20s total, force running
  useEffect(() => {
    if (phase !== "loading" || !startAccepted) return;
    const timer = setTimeout(() => {
      loadingStepRef.current = LOADING_STEPS.length;
      setLoadingStep(LOADING_STEPS.length);
      setPhase("running");
    }, 20_000);
    return () => clearTimeout(timer);
  }, [phase, startAccepted]);

  // Track episode number from logs — "Recording episode N"
  useEffect(() => {
    if (phase !== "running") return;
    const logs = recordLogs ?? [];
    let latestEp = -1;
    for (let i = loadingStartIdxRef.current; i < logs.length; i++) {
      const m = /Recording episode (\d+)/i.exec(logs[i].text);
      if (m) latestEp = Number(m[1]);
    }
    if (latestEp >= 0) setCurrentEp(latestEp);
  }, [phase, recordLogs]);

  // Watch for process end — detect "[record process ended]" in logs
  useEffect(() => {
    if (phase === "idle") return;
    const logs = recordLogs ?? [];
    const endMarker = logs.find(
      (l, i) => i >= loadingStartIdxRef.current && /\[record process ended\]/i.test(l.text),
    );
    if (endMarker) {
      setPhase("idle");
      setStartAccepted(false);
      setActionPending(false);
    }
  }, [phase, recordLogs]);

  useEffect(() => {
    if (!flowError) return;
    lastErrorAtRef.current = Date.now();
  }, [flowError]);

  const loadDevicesAndCalibration = useCallback(async () => {
    const result = await apiGet<DevicesResponse>("/api/devices");
    const mapped = (result.cameras ?? [])
      .filter((cam) => cam.symlink)
      .map((cam) => ({ role: cam.symlink, path: `/dev/${cam.symlink}` }));
    setCamerasMapped(mapped);
    setEnabledCameras(new Set(mapped.map((cam) => cam.role)));

    const rawPorts = Array.from(
      new Set(
        (result.arms ?? [])
          .map((arm) => (arm.symlink ? `/dev/${arm.symlink}` : arm.path))
          .filter((value): value is string => Boolean(value))
      )
    );
    const defaultFollower = rawPorts.find((p) => /follower/i.test(p)) ?? rawPorts[0] ?? "";
    const defaultLeader = rawPorts.find((p) => /leader/i.test(p)) ?? rawPorts[1] ?? rawPorts[0] ?? "";
    const defaultLeftFollower = rawPorts.find((p) => /follower.*(?:1|left)/i.test(p)) ?? defaultFollower;
    const defaultRightFollower = rawPorts.find((p) => /follower.*(?:2|right)/i.test(p)) ?? rawPorts[1] ?? defaultFollower;
    const defaultLeftLeader = rawPorts.find((p) => /leader.*(?:1|left)/i.test(p)) ?? defaultLeader;
    const defaultRightLeader = rawPorts.find((p) => /leader.*(?:2|right)/i.test(p)) ?? rawPorts[1] ?? defaultLeader;
    setSelectedFollowerPort((prev) => (prev && rawPorts.includes(prev) ? prev : defaultFollower));
    setSelectedLeaderPort((prev) => (prev && rawPorts.includes(prev) ? prev : defaultLeader));
    setSelectedLeftFollowerPort((prev) => (prev && rawPorts.includes(prev) ? prev : defaultLeftFollower));
    setSelectedRightFollowerPort((prev) => (prev && rawPorts.includes(prev) ? prev : defaultRightFollower));
    setSelectedLeftLeaderPort((prev) => (prev && rawPorts.includes(prev) ? prev : defaultLeftLeader));
    setSelectedRightLeaderPort((prev) => (prev && rawPorts.includes(prev) ? prev : defaultRightLeader));

    const calibResult = await apiGet<{ files?: CalibFile[] }>("/api/calibrate/list");
    const files = calibResult.files ?? [];
    setCalibFilesRaw(files);

    const lists = buildMappedArmLists(result.arms ?? [], files);
    setArmLists(lists);
    const sel = defaultArmSelection(lists, mode as "Single Arm" | "Bi-Arm");
    setArmSelection(sel);
    const resolved = resolveArmConfig(mode as "Single Arm" | "Bi-Arm", sel, lists, files);
    handleArmSetConfigResolved(resolved);
  }, [handleArmSetConfigResolved, mode]);

  useEffect(() => {
    void loadDevicesAndCalibration();
  }, [loadDevicesAndCalibration]);

  useEffect(() => {
    if (armLists.followers.length === 0 && armLists.leaders.length === 0) return;
    const timer = window.setTimeout(() => {
      const sel = defaultArmSelection(armLists, mode as "Single Arm" | "Bi-Arm");
      setArmSelection(sel);
      const resolved = resolveArmConfig(mode as "Single Arm" | "Bi-Arm", sel, armLists, calibFilesRaw);
      handleArmSetConfigResolved(resolved);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [armLists, calibFilesRaw, handleArmSetConfigResolved, mode]);

  useEffect(() => {
    const wasRunning = prevRunningRef.current;
    if (wasRunning && !running) {
      const abnormal = Date.now() - lastErrorAtRef.current < 120000;
      if (abnormal) {
        notifyProcessEndedWithError("record", undefined, { toast: false });
      } else {
        notifyProcessCompleted("record");
      }
    }
    prevRunningRef.current = running;
  }, [running]);

  // Keyboard shortcuts: → Save, ← Discard, Esc Stop
  useEffect(() => {
    if (!running) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "ArrowRight") { e.preventDefault(); handleSave(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); handleDiscard(); }
      else if (e.key === "Escape") { e.preventDefault(); handleStop(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running, handleSave, handleDiscard, handleStop]);

  return (
    <div className="flex flex-col h-full">
      <MotorMappingGate>
      <div className="flex-1 overflow-y-auto">
        <section aria-label="Episode recording" className="p-6 flex flex-col gap-4 max-w-[1600px] mx-auto w-full">
          {/* Header */}
          <PageHeader
            title="Episode Recording"
            subtitle="Remote control + episode recording → create training dataset"
            action={
              <div className="flex items-center gap-3">
                {phase === "idle" && (
                  <ModeToggle options={["Single Arm", "Bi-Arm"]} value={mode} onChange={setMode} />
                )}
                <RefreshButton onClick={() => { void loadDevicesAndCalibration(); }} />
              </div>
            }
          />

          {flowError && <BlockerCard title="Execution Blocked" severity="error" reasons={[flowError]} />}
          {/* ─── IDLE: Sub-tabs for settings ─── */}
          {phase === "idle" && (
            <div className="flex flex-col gap-4">
              <SubTabs
                tabs={[
                  { key: "plan", label: "Recording Plan" },
                  { key: "device", label: "Device" },
                  { key: "camera", label: "Camera" },
                ]}
                activeKey={recTab}
                onChange={setRecTab}
                className="mx-auto"
              />

              {recTab === "plan" && (
                <RecordingPlanTab
                  totalEps={totalEps}
                  recordRepoId={recordRepoId}
                  recordTask={recordTask}
                  resumeEnabled={resumeEnabled}
                  hfAuth={hfAuth}
                  availableDatasets={availableDatasets}
                  datasetStorageMode={datasetStorageMode}
                  localDatasetRoot={localDatasetRoot}
                  setTotalEps={setTotalEps}
                  setRecordRepoId={setRecordRepoId}
                  setRecordTask={setRecordTask}
                  setResumeEnabled={setResumeEnabled}
                  setDatasetStorageMode={setDatasetStorageMode}
                  setLocalDatasetRoot={setLocalDatasetRoot}
                />
              )}

              {recTab === "device" && (
                <RecordingDeviceTab
                  mode={mode}
                  armLists={armLists}
                  calibFiles={calibFilesRaw}
                  armSelection={armSelection}
                  onSelectionChange={setArmSelection}
                  onArmSetConfigResolved={handleArmSetConfigResolved}
                />
              )}

              {recTab === "camera" && (
                <RecordingCameraTab
                  camerasMapped={camerasMapped}
                  enabledCameras={enabledCameras}
                  selectedCameras={selectedCameras}
                  toggleCamera={toggleCamera}
                  cameraFrames={cameraFrames}
                  advStreamOpen={advStreamOpen}
                  setAdvStreamOpen={setAdvStreamOpen}
                />
              )}
            </div>
          )}

          {phase === "loading" && <RecordingLoadingView loadingStep={loadingStep} steps={LOADING_STEPS} />}

          {phase === "running" && recordReconnected && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-blue-500/30 bg-blue-500/5 text-sm text-blue-600 dark:text-blue-400">
              <span className="flex-none">⚡</span>
              <span>Reconnected — This recording session was recovered from a previous server session. You can still stop the process.</span>
            </div>
          )}
          {phase === "running" && (
            <RecordingRunningView
              camerasMapped={selectedCameras}
              cameraFrames={cameraFrames}
              pausedFeeds={pausedFeeds}
              currentEp={currentEp}
              totalEps={totalEps}
              progress={progress}
              onToggleFeed={toggleFeed}
            />
          )}
        </section>
      </div>

      {/* Sticky control bar */}
      <StickyControlBar>
        <div className="flex items-center gap-3 min-w-0">
          <StatusBadge
            status={running ? "running" : phase === "loading" ? "loading" : "ready"}
            label={running ? "RECORDING" : phase === "loading" ? "STARTING..." : "READY"}
            pulse={running}
          />
          <span className="text-sm text-zinc-400 truncate">
            {running
              ? `Episode ${currentEp} / ${totalEps}`
              : phase === "loading"
                ? "Starting recording…"
                : "Recording ready"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {running && (
            <>
              <button
                onClick={handleSave}
                title="Save episode (→)"
                className={buttonStyles({
                  variant: "primary",
                  tone: "success",
                  className: "h-auto px-4 py-1.5",
                })}
              >
                Save
              </button>
              <button
                onClick={handleDiscard}
                title="Discard episode (←)"
                className={buttonStyles({
                  variant: "secondary",
                  tone: "warning",
                  className: "h-auto px-4 py-1.5",
                })}
              >
                Discard
              </button>
            </>
          )}
          <ProcessButtons
            running={phase !== "idle"}
            onStart={() => { void handleStart(); }}
            onStop={() => { void handleStop(); }}
            startLabel={<><Play size={13} className="fill-current" /> Start Recording</>}
            disabled={actionPending || (armLists.followers.length === 0 && armLists.leaders.length === 0)}
            compact
            fullWidth={false}
            buttonClassName="py-1"
          />
        </div>
      </StickyControlBar>
      </MotorMappingGate>
    </div>
  );
}
