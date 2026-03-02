import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Link } from "react-router";
import { ChevronDown, ChevronUp, Play, Loader2, CheckCircle2, Check, Pause } from "lucide-react";
import { cn } from "../components/ui/utils";
import { apiGet, apiPost } from "../services/apiClient";
import { useLeStudioStore } from "../store";
import {
  extractPreflightReason,
  getConfigBool,
  getConfigString,
  parseBackendError,
  toBackendRecordPayload,
  type PreflightResult,
} from "../services/contracts";
import {
  PageHeader, StatusBadge, WireSelect, WireInput,
  FieldRow, ModeToggle, StickyControlBar, WireBox, WireToggle, ProcessButtons,
  HfGateBanner, BlockerCard,
} from "../components/wireframe";
import { useHfAuth } from "../hf-auth-context";
import {
  notifyError,
  notifySuccess,
  notifyProcessStarted,
  notifyProcessStopRequested,
  notifyProcessCompleted,
  notifyProcessEndedWithError,
} from "../services/notifications";
import { toVideoName, useCameraFeeds } from "../hooks/useCameraFeeds";



type RecPhase = "idle" | "loading" | "running";

type ActionResponse = {
  ok: boolean;
  error?: string;
  currentEp?: number;
  event?: string;
};

type CameraStatsResponse = {
  cameras?: Record<string, { fps: number; mbps: number }>;
};

type DevicesResponse = {
  cameras: Array<{ device: string; path: string; kernels: string; symlink: string; model: string }>;
  arms: unknown[];
};

const LOADING_STEPS = [
  "팔 연결 중...",
  "카메라 열기...",
  "데이터셋 준비...",
  "녹화 준비 완료",
];

export function Recording() {
  const config = useLeStudioStore((s) => s.config);
  const [mode, setMode] = useState("Single Arm");
  const [phase, setPhase] = useState<RecPhase>("idle");
  const [loadingStep, setLoadingStep] = useState(0);
  const [currentEp, setCurrentEp] = useState(0);
  const [totalEps, setTotalEps] = useState(50);
  const [lastEvent, setLastEvent] = useState<string | null>(null);
  const [pausedFeeds, setPausedFeeds] = useState<Record<string, boolean>>({});
  const [advStreamOpen, setAdvStreamOpen] = useState(false);
  const [recTab, setRecTab] = useState("plan");
  const [startAccepted, setStartAccepted] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [flowError, setFlowError] = useState<string | null>(null);
  const lastErrorAtRef = useRef(0);
  const prevRunningRef = useRef(false);
  const [cameraStats, setCameraStats] = useState<Record<string, { fps: number; mbps: number }>>({});
  const { hfAuth } = useHfAuth();
  const [recordRepoId, setRecordRepoId] = useState(() => getConfigString(config, "record_repo_id", "lerobot-user/pick_cube_dataset"));
  const [recordTask, setRecordTask] = useState(() => getConfigString(config, "record_task", ""));
  const [resumeEnabled, setResumeEnabled] = useState(() => getConfigBool(config, "record_resume", false));
  const [pushToHub, setPushToHub] = useState(() => hfAuth === "ready" && getConfigBool(config, "record_push_to_hub", true));
  const [camerasMapped, setCamerasMapped] = useState<{ role: string; path: string }[]>([]);

  const progress = Math.round((currentEp / totalEps) * 100);
  const running = phase === "running";
  const feedTargets = useMemo(
    () => camerasMapped.map((cam) => ({ id: cam.role, videoName: toVideoName(cam.path) })),
    [camerasMapped],
  );
  const previewFeedsActive = phase === "idle" && recTab === "camera";
  const cameraFrames = useCameraFeeds(feedTargets, previewFeedsActive || running, 30, pausedFeeds);

  const handleStart = async () => {
    if (actionPending) return;
    setActionPending(true);
    setFlowError(null);
    setStartAccepted(false);
    setPhase("loading");
    setLoadingStep(0);
    try {
      const payload = toBackendRecordPayload({
        modeLabel: mode,
        totalEpisodes: totalEps,
        repoId: recordRepoId.trim(),
        task: recordTask.trim(),
        resume: resumeEnabled,
        pushToHub: hfAuth === "ready" && pushToHub,
        cameras: camerasMapped,
        config,
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
    setLastEvent(stopped.event ?? "recording ended");
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
      setActionPending(false);
      return;
    }
    setCurrentEp(result.currentEp ?? currentEp + 1);
    setLastEvent(result.event ?? `saved episode ${currentEp + 1}`);
    notifySuccess("Episode saved");
    setActionPending(false);
  }, [actionPending, currentEp]);
  const handleDiscard = useCallback(async () => {
    if (actionPending) return;
    setActionPending(true);
    const result = await apiPost<ActionResponse>("/api/process/record/input", { text: "left" });
    if (!result.ok) {
      const reason = result.error ?? "discard failed";
      setFlowError(reason);
      notifyError(reason);
      setActionPending(false);
      return;
    }
    setLastEvent(result.event ?? `discarded episode ${currentEp}`);
    notifyError("Episode discarded");
    setActionPending(false);
  }, [actionPending, currentEp]);

  const toggleFeed = (role: string) =>
    setPausedFeeds((prev) => ({ ...prev, [role]: !prev[role] }));

  // Simulated loading sequence
  useEffect(() => {
    if (phase !== "loading" || !startAccepted) return;
    if (loadingStep >= LOADING_STEPS.length) {
      setPhase("running");
      return;
    }
    const timer = setTimeout(() => setLoadingStep((s) => s + 1), 800);
    return () => clearTimeout(timer);
  }, [phase, loadingStep, startAccepted]);

  useEffect(() => {
    if (!flowError) return;
    lastErrorAtRef.current = Date.now();
  }, [flowError]);

  useEffect(() => {
    if (hfAuth !== "ready") setPushToHub(false);
  }, [hfAuth]);
  useEffect(() => {
    const run = async () => {
      const result = await apiGet<DevicesResponse>("/api/devices");
      const mapped = (result.cameras ?? [])
        .filter((cam) => cam.symlink)
        .map((cam) => ({ role: cam.symlink, path: `/dev/lerobot/${cam.symlink}` }));
      setCamerasMapped(mapped);
    };
    void run();
  }, []);

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

  useEffect(() => {
    if (phase !== "running") return;

    const poll = async () => {
      const result = await apiGet<CameraStatsResponse>("/api/camera/stats");
      setCameraStats(result.cameras ?? {});
    };

    void poll();
    const timer = setInterval(() => {
      void poll();
    }, 2000);

    return () => clearInterval(timer);
  }, [phase]);

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

  const cameraStatsRows = camerasMapped.map((cam) => ({
    role: cam.role,
    fps: cameraStats[cam.role]?.fps ?? 30,
  }));

  return (
    <div className="flex flex-col h-full">
      {/* Top nav bar */}
      <div className="flex items-center justify-between px-6 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-sm text-zinc-400">
        <Link to="/teleop" className="inline-flex items-center gap-1 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">
          ← Teleop
        </Link>
        <div className="flex items-center gap-2">
          <span className="text-zinc-300 dark:text-zinc-600">Teleop</span>
          <span className="text-zinc-300 dark:text-zinc-600">›</span>
          <span className="text-zinc-700 dark:text-zinc-200 font-medium">Recording</span>
          <span className="text-zinc-300 dark:text-zinc-600">›</span>
          <Link to="/dataset" className="hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">Dataset</Link>
        </div>
        <Link to="/dataset" className="inline-flex items-center gap-1 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">
          Dataset →
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-6 flex flex-col gap-4 max-w-[1600px] mx-auto w-full">
          {/* Header */}
          <div className="flex items-start justify-between">
            <PageHeader
              title="Episode Recording"
              subtitle="원격 조작 + 에피소드 데이터 녹화 → 학습용 데이터셋 생성"
              status={running ? "running" : phase === "loading" ? "warning" : "ready"}
              statusLabel={running ? "RECORDING" : phase === "loading" ? "STARTING..." : "READY"}
            />
            {phase === "idle" && (
              <ModeToggle
                options={["Single Arm", "Bi-Arm"]}
                value={mode}
                onChange={setMode}
              />
            )}
          </div>

          {flowError && <BlockerCard title="실행 차단" severity="error" reasons={[flowError]} />}

          {/* ─── IDLE: Sub-tabs for settings ─── */}
          {phase === "idle" && (
            <div className="flex flex-col gap-4">
              <div className="flex gap-1 bg-zinc-100 dark:bg-zinc-800/50 p-1 rounded-lg w-fit mx-auto">
                {[
                  { key: "plan", label: "녹화 계획" },
                  { key: "device", label: "디바이스" },
                  { key: "camera", label: "카메라" },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setRecTab(tab.key)}
                    className={cn(
                      "px-3.5 py-1.5 rounded-md text-sm font-medium transition-all",
                      recTab === tab.key
                        ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm"
                        : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* 녹화 계획 Tab */}
              {recTab === "plan" && (
                <div className="flex flex-col gap-3">
                  <FieldRow label="에피소드 수">
                    <input
                      type="number"
                      value={totalEps}
                      onChange={(e) => setTotalEps(Math.max(1, Number(e.target.value) || 1))}
                      className="w-full h-7 px-2 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-700 dark:text-zinc-300 text-sm outline-none focus:border-blue-500 dark:focus:border-blue-400"
                    />
                  </FieldRow>
                  <FieldRow label="Dataset Repo ID">
                    <WireInput value={recordRepoId} onChange={setRecordRepoId} placeholder="username/dataset-name" />
                  </FieldRow>
                  <FieldRow label="Task Description">
                    <WireInput value={recordTask} onChange={setRecordTask} placeholder="Pick the red cube and place it..." />
                  </FieldRow>
                  <div className="flex flex-col gap-2 pt-1">
                    <WireToggle label="Resume — 기존 데이터셋에 이어서 녹화" checked={resumeEnabled} onChange={setResumeEnabled} />
                    <div className="flex items-center gap-2">
                      <WireToggle
                        label="Push to Hub — 완료 후 자동 업로드"
                        checked={pushToHub}
                        onChange={setPushToHub}
                      />
                      {hfAuth !== "ready" && (
                        <span className="text-sm text-amber-600 dark:text-amber-400 flex items-center gap-1">
                          🔒 HF required
                        </span>
                      )}
                    </div>
                    {hfAuth !== "ready" && (
                      <div className="mt-1">
                        <HfGateBanner authState={hfAuth} level="hf_write" />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 디바이스 Tab */}
              {recTab === "device" && (
                <div className="flex flex-col gap-3">
                  <p className="text-sm text-zinc-400">로봇과 조종 방식을 선택하세요.</p>
                  <FieldRow label="Robot Type">
                    <WireSelect value="so101_follower" options={["so101_follower", "so100_follower"]} />
                  </FieldRow>
                  <FieldRow label="Teleop Type">
                    <WireSelect value="so101_leader" options={["so101_leader", "keyboard"]} />
                  </FieldRow>
                  <div className="border-t border-zinc-100 dark:border-zinc-800 pt-3 flex flex-col gap-2">
                    <p className="text-sm text-zinc-400">연결할 디바이스 포트를 선택하세요.</p>
                    {mode === "Single Arm" ? (
                      <>
                        <FieldRow label="Follower Port">
                          <WireSelect value="/dev/lerobot/follower_arm" options={["/dev/lerobot/follower_arm"]} />
                        </FieldRow>
                        <FieldRow label="Leader Port">
                          <WireSelect value="/dev/lerobot/leader_arm" options={["/dev/lerobot/leader_arm"]} />
                        </FieldRow>
                      </>
                    ) : (
                      <>
                        {["Left Follower", "Right Follower", "Left Leader", "Right Leader"].map((label) => (
                          <FieldRow key={label} label={label}>
                            <WireSelect placeholder={`${label} Port`} options={["/dev/lerobot/follower_arm", "/dev/lerobot/leader_arm"]} />
                          </FieldRow>
                        ))}
                      </>
                    )}
                  </div>
                  <div className="border-t border-zinc-100 dark:border-zinc-800 pt-3 flex flex-col gap-2">
                    <p className="text-sm text-zinc-400">캘리브레이션 프로필을 선택하세요.</p>
                    {mode === "Single Arm" ? (
                      <>
                        <FieldRow label="Follower ID">
                          <WireSelect value="follower_arm_1" options={["follower_arm_1"]} />
                        </FieldRow>
                        <FieldRow label="Leader ID">
                          <WireSelect value="leader_arm_1" options={["leader_arm_1"]} />
                        </FieldRow>
                      </>
                    ) : (
                      <FieldRow label="Robot ID">
                        <WireSelect value="bimanual_follower" options={["bimanual_follower"]} />
                      </FieldRow>
                    )}
                  </div>
                </div>
              )}

              {/* 카메라 Tab — 설정 위, 프리뷰 아래 */}
              {recTab === "camera" && (
                <div className="flex flex-col gap-4">
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                    <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                      <span className="text-sm text-zinc-500">카메라 피드</span>
                      <StatusBadge status="ready" label={`${cameraStatsRows.length}/${camerasMapped.length} 매핑됨`} />
                    </div>
                    <div className="p-4 flex flex-col gap-3">
                      {camerasMapped.length === 0 ? (
                        <div className="text-sm text-zinc-400 text-center py-2">
                          카메라 매핑이 없습니다. <a href="/camera-setup" className="underline hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">Camera Setup</a> 탭에서 먼저 카메라를 연결하세요.
                        </div>
                      ) : camerasMapped.map((cam) => (
                        <div key={cam.role} className="flex items-center gap-2 px-2 py-1.5 rounded border border-zinc-100 dark:border-zinc-800/50">
                          <span className="size-1.5 rounded-full bg-emerald-400 flex-none" />
                          <span className="text-sm text-zinc-600 dark:text-zinc-300 font-mono">{cam.role}</span>
                          <span className="text-sm text-zinc-400 ml-auto font-mono truncate">{cam.path}</span>
                        </div>
                      ))}

                      {/* Advanced stream settings */}
                      <button
                        onClick={() => setAdvStreamOpen(!advStreamOpen)}
                        className="flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-600 cursor-pointer"
                      >
                        고급 스트림 설정
                        {advStreamOpen ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                      </button>

                      {advStreamOpen && (
                        <div className="flex flex-col gap-2 pl-2 border-l-2 border-zinc-100 dark:border-zinc-800">
                          <FieldRow label="코덱">
                            <WireSelect value="MJPG" options={["MJPG", "YUYV"]} />
                          </FieldRow>
                          <FieldRow label="해상도">
                            <WireSelect value="640×480" options={["1280×720", "800×600", "640×480", "320×240"]} />
                          </FieldRow>
                          <FieldRow label="FPS">
                            <WireSelect value="30" options={["15", "30", "60"]} />
                          </FieldRow>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Compact thumbnails */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {camerasMapped.map((cam) => {
                      const frameSrc = cameraFrames[cam.role];
                      return (
                        <div key={cam.role} className="relative rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-800">
                          <div className="aspect-video bg-zinc-200 dark:bg-zinc-900">
                            {frameSrc ? (
                              <img src={frameSrc} alt={`${cam.role} preview`} className="h-full w-full object-cover" />
                            ) : (
                              <div className="h-full w-full flex items-center justify-center">
                                <span className="text-sm text-zinc-600">대기 중...</span>
                              </div>
                            )}
                          </div>
                          <div className="px-2 py-1.5 bg-zinc-50 dark:bg-zinc-900">
                            <div className="text-sm text-zinc-600 dark:text-zinc-300">{cam.role}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ─── LOADING: Step-by-step feedback ─── */}
          {phase === "loading" && (
            <div className="flex-1 flex flex-col items-center justify-center py-16 gap-6">
              <Loader2 size={32} className="text-zinc-400 animate-spin" />
              <div className="flex flex-col gap-2">
                {LOADING_STEPS.map((step, i) => (
                  <div key={step} className="flex items-center gap-2.5">
                    {i < loadingStep ? (
                      <CheckCircle2 size={14} className="text-emerald-600 dark:text-emerald-400 flex-none" />
                    ) : i === loadingStep ? (
                      <Loader2 size={14} className="text-zinc-400 animate-spin flex-none" />
                    ) : (
                      <div className="size-3.5 rounded-full border border-zinc-600 flex-none" />
                    )}
                    <span className={cn("text-sm",
                      i < loadingStep ? "text-zinc-400" :
                      i === loadingStep ? "text-zinc-800 dark:text-zinc-200" : "text-zinc-600"
                    )}>
                      {step}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ─── RUNNING: Camera feed + Episode controls ─── */}
          {phase === "running" && (
            <div className="flex flex-col gap-4">
              {/* Episode progress bar — inline */}
              <div className="flex items-center gap-3 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800">
                <span className="text-sm text-zinc-400 flex-none">Episode</span>
                <span className="text-sm font-mono text-zinc-800 dark:text-zinc-200">{currentEp} / {totalEps}</span>
                <div className="flex-1 h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <span className="text-sm text-zinc-500 flex-none">{progress}%</span>
                {lastEvent && (
                  <span className="text-sm text-zinc-500 flex-none ml-2 truncate max-w-48">
                    Last: {lastEvent}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap gap-2 text-sm text-zinc-400">
                {cameraStatsRows.map((row) => (
                  <span key={row.role} className={row.fps < 25 ? "text-amber-600 dark:text-amber-400" : ""}>
                    {row.role}: {row.fps.toFixed(1)} fps
                  </span>
                ))}
              </div>

              {/* Camera feeds — full width */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {camerasMapped.map((cam) => {
                  const frameSrc = cameraFrames[cam.role];
                  return (
                    <div key={cam.role} className="relative rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-800">
                      <div className="aspect-video bg-zinc-200 dark:bg-zinc-900 relative">
                        {!pausedFeeds[cam.role] ? (
                          frameSrc ? (
                            <img src={frameSrc} alt={`${cam.role} stream`} className="absolute inset-0 h-full w-full object-cover" />
                          ) : (
                            <WireBox
                              className="absolute inset-0 border-0 rounded-none"
                              label={`MJPEG stream — ${cam.role}`}
                            />
                          )
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center text-zinc-600">
                            <span className="text-sm flex items-center gap-1"><Pause size={10} className="fill-current" /> 일시정지</span>
                          </div>
                        )}

                        {/* Overlays */}
                        <div className="absolute top-2 left-2 flex items-center gap-1.5">
                          <span className="px-1.5 py-0.5 rounded bg-red-500/80 text-white text-sm font-mono">REC</span>
                          <span className="px-1.5 py-0.5 rounded bg-black/60 text-white text-sm font-mono">{Math.round(cameraStats[cam.role]?.fps ?? 30)} fps</span>
                        </div>
                        <button
                          onClick={() => toggleFeed(cam.role)}
                          className="absolute top-2 right-2 p-1.5 rounded bg-black/50 text-white cursor-pointer hover:bg-black/70 transition-colors"
                        >
                          {pausedFeeds[cam.role]
                            ? <Play size={10} className="fill-current" />
                            : <Pause size={10} className="fill-current" />}
                        </button>
                      </div>
                      <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-900">
                        <div className="text-sm text-zinc-600 dark:text-zinc-300">{cam.role}</div>
                        <div className="text-sm text-zinc-400 font-mono">{cam.path}</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Keyboard shortcuts */}
              <div className="flex flex-wrap gap-2 text-sm text-zinc-400">
                {[
                  { key: "→", desc: "Save Episode" },
                  { key: "←", desc: "Discard" },
                  { key: "Esc", desc: "End Recording" },
                ].map((s) => (
                  <div key={s.key} className="flex items-center gap-1.5">
                    <kbd className="px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 font-mono text-zinc-500 bg-zinc-50 dark:bg-zinc-900">
                      {s.key}
                    </kbd>
                    <span>{s.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sticky control bar */}
      <StickyControlBar>
        <div className="flex items-center gap-3 min-w-0">
          <StatusBadge
            status={running ? "running" : phase === "loading" ? "warning" : "ready"}
            label={running ? "RECORDING" : phase === "loading" ? "STARTING..." : "READY"}
            pulse={running}
          />
          <span className="text-sm text-zinc-400 truncate">
            {running ? `Episode ${currentEp} / ${totalEps}` : "녹화 준비 완료"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {running && (
            <>
              <button
                onClick={handleSave}
                className="flex items-center gap-1 px-4 py-2 rounded border border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-sm cursor-pointer"
              >
                <Check size={12} /> Save →
              </button>
              <button
                onClick={handleDiscard}
                className="flex items-center gap-1 px-4 py-2 rounded border border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-sm cursor-pointer"
              >
                ← Discard
              </button>
            </>
          )}
          <ProcessButtons
            running={phase !== "idle"}
            onStart={() => { void handleStart(); }}
            onStop={() => { void handleStop(); }}
            startLabel={<><Play size={13} className="fill-current" /> Start Recording</>}
            disabled={actionPending}
            compact
            fullWidth={false}
          />
        </div>
      </StickyControlBar>
    </div>
  );
}
