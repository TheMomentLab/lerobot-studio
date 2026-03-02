import React, { useState, useEffect, useRef } from "react";
import { Link } from "react-router";
import { ChevronDown, ChevronUp, Play, Pause, Loader2, CheckCircle2 } from "lucide-react";
import { cn } from "../components/ui/utils";
import { apiGet, apiPost } from "../services/apiClient";
import {
  notifyError,
  notifyProcessStarted,
  notifyProcessStopRequested,
  notifyProcessEndedWithError,
} from "../services/notifications";
import {
  PageHeader, StatusBadge, WireSelect,
  FieldRow, ProcessButtons, ModeToggle, StickyControlBar,
  WireBox, BlockerCard,
} from "../components/wireframe";


const CAMERAS_MAPPED = [
  { role: "top_cam_1", path: "/dev/lerobot/top_cam_1" },
  { role: "wrist_cam_1", path: "/dev/lerobot/wrist_cam_1" },
];

type TeleopPhase = "idle" | "loading" | "running";

type PreflightResponse = {
  ok: boolean;
  reason?: string;
};

type ActionResponse = {
  ok: boolean;
  error?: string;
};

type CameraStatsResponse = {
  cameras?: Record<string, { fps: number; mbps: number }>;
};

type CameraCheckResponse = Record<string, boolean>;

const LOADING_STEPS = [
  "팔 연결 중...",
  "카메라 열기...",
  "스트림 초기화...",
  "준비 완료",
];

export function Teleop() {
  const [mode, setMode] = useState("Single Arm");
  const [phase, setPhase] = useState<TeleopPhase>("idle");
  const [loadingStep, setLoadingStep] = useState(0);
  const [pausedFeeds, setPausedFeeds] = useState<Record<string, boolean>>({});
  const [speed, setSpeed] = useState("1.0x");
  const [advStreamOpen, setAdvStreamOpen] = useState(false);
  const [teleopTab, setTeleopTab] = useState("motor");
  const [startAccepted, setStartAccepted] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [flowError, setFlowError] = useState<string | null>(null);
  const lastErrorAtRef = useRef(0);
  const prevRunningRef = useRef(false);
  const [cameraStats, setCameraStats] = useState<Record<string, { fps: number; mbps: number }>>({});
  const [cameraPathOk, setCameraPathOk] = useState<Record<string, boolean>>({});
  const running = phase === "running";

  const toggleFeed = (role: string) =>
    setPausedFeeds((prev) => ({ ...prev, [role]: !prev[role] }));

  const handleStart = async () => {
    if (actionPending) return;
    setActionPending(true);
    setFlowError(null);
    setStartAccepted(false);
    setPhase("loading");
    setLoadingStep(0);
    const preflight = await apiPost<PreflightResponse>("/api/preflight", {
      process: "teleop",
      mode,
      speed,
    });
    if (!preflight.ok) {
      setPhase("idle");
      setActionPending(false);
      const reason = preflight.reason ?? "preflight failed";
      setFlowError(reason);
      notifyError(reason);
      return;
    }
    const started = await apiPost<ActionResponse>("/api/teleop/start", {
      mode,
      speed,
    });
    if (!started.ok) {
      setPhase("idle");
      setActionPending(false);
      const reason = started.error ?? "failed to start teleop";
      setFlowError(reason);
      notifyError(reason);
      return;
    }
    setStartAccepted(true);
    notifyProcessStarted("teleop");
    setActionPending(false);
  };

  const handleStop = async () => {
    if (actionPending) return;
    setActionPending(true);
    setFlowError(null);
    const stopped = await apiPost<ActionResponse>("/api/process/teleop/stop");
    if (!stopped.ok) {
      const reason = stopped.error ?? "failed to stop teleop";
      setFlowError(reason);
      notifyError(reason);
    } else {
      notifyProcessStopRequested("teleop");
    }
    setPhase("idle");
    setLoadingStep(0);
    setPausedFeeds({});
    setStartAccepted(false);
    setActionPending(false);
  };

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
    const run = async () => {
      const result = await apiPost<CameraCheckResponse>("/api/camera/check_paths", {
        paths: CAMERAS_MAPPED.map((cam) => cam.path),
      });
      setCameraPathOk(result);
    };
    void run();
  }, []);

  useEffect(() => {
    if (!flowError) return;
    lastErrorAtRef.current = Date.now();
  }, [flowError]);

  useEffect(() => {
    const wasRunning = prevRunningRef.current;
    if (wasRunning && !running) {
      const abnormal = Date.now() - lastErrorAtRef.current < 120000;
      if (abnormal) {
        notifyProcessEndedWithError("teleop", undefined, { toast: false });
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
    }, 1000);
    return () => clearInterval(timer);
  }, [phase]);

  const validCameraCount = CAMERAS_MAPPED.filter((cam) => cameraPathOk[cam.path] !== false).length;
  const activeFpsValues = CAMERAS_MAPPED.map((cam) => cameraStats[cam.role]?.fps).filter((v): v is number => typeof v === "number");
  const avgFps = activeFpsValues.length > 0 ? activeFpsValues.reduce((sum, cur) => sum + cur, 0) / activeFpsValues.length : 30;
  const loopMs = Math.max(1, Math.round(1000 / avgFps));

  return (
    <div className="flex flex-col h-full">
      {/* Top nav bar */}
      <div className="flex items-center justify-between px-6 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-sm text-zinc-400">
        <Link to="/motor-setup" className="inline-flex items-center gap-1 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">
          ← Motor Setup
        </Link>
        <div className="flex items-center gap-2">
          <span className="text-zinc-300 dark:text-zinc-600">Motor Setup</span>
          <span className="text-zinc-300 dark:text-zinc-600">›</span>
          <span className="text-zinc-700 dark:text-zinc-200 font-medium">Teleop</span>
          <span className="text-zinc-300 dark:text-zinc-600">›</span>
          <Link to="/recording" className="hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">Recording</Link>
        </div>
        <Link to="/recording" className="inline-flex items-center gap-1 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">
          Recording →
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-6 flex flex-col gap-4 max-w-[1600px] mx-auto w-full">
          {/* Header */}
          <div className="flex items-start justify-between">
            <PageHeader
              title="Teleop"
              subtitle="실시간 원격 조작 + 멀티 카메라 피드"
              status={running ? "running" : phase === "loading" ? "warning" : "ready"}
              statusLabel={running ? "TELEOP ACTIVE" : phase === "loading" ? "STARTING..." : "READY"}
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
                  { key: "motor", label: "Motor Setting" },
                  { key: "camera", label: "Camera Setting" },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setTeleopTab(tab.key)}
                    className={cn(
                      "px-3.5 py-1.5 rounded-md text-sm font-medium transition-all",
                      teleopTab === tab.key
                        ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm"
                        : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Motor Setting Tab */}
              {teleopTab === "motor" && (
                <div className="flex flex-col gap-3">
                  <p className="text-sm text-zinc-400">로봇과 조종 방식을 선택하세요.</p>
                  <FieldRow label="Robot Type">
                    <WireSelect value="so101_follower" options={["so101_follower", "so100_follower", "aloha"]} />
                  </FieldRow>
                  <FieldRow label="Teleop Type">
                    <WireSelect value="so101_leader" options={["so101_leader", "so100_leader", "keyboard"]} />
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

                  {mode === "Single Arm" && (
                    <div className="border-t border-zinc-100 dark:border-zinc-800 pt-3 flex flex-col gap-2">
                      <p className="text-sm text-zinc-400">캘리브레이션 프로필을 선택하세요.</p>
                      <FieldRow label="Follower ID">
                        <WireSelect value="follower_arm_1" options={["follower_arm_1", "follower_arm_0"]} />
                      </FieldRow>
                      <FieldRow label="Leader ID">
                        <WireSelect value="leader_arm_1" options={["leader_arm_1"]} />
                      </FieldRow>
                    </div>
                  )}
                </div>
              )}

              {/* Camera Setting Tab — 설정 위, 프리뷰 아래 */}
              {teleopTab === "camera" && (
                <div className="flex flex-col gap-4">
                  {/* Camera settings — full width */}
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                    <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                      <span className="text-sm text-zinc-500">카메라 피드 설정</span>
                      <StatusBadge status={validCameraCount === CAMERAS_MAPPED.length ? "ready" : "warning"} label={`${validCameraCount}/${CAMERAS_MAPPED.length} 사용 가능`} />
                    </div>
                    <div className="p-4 flex flex-col gap-3">
                      {CAMERAS_MAPPED.map((cam) => (
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
                          <FieldRow label="JPEG Quality">
                            <input type="range" min={30} max={95} defaultValue={75} className="w-full h-1.5 accent-zinc-500 cursor-pointer" />
                          </FieldRow>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Camera feed previews — compact thumbnails */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {CAMERAS_MAPPED.map((cam) => (
                      <div key={cam.role} className="relative rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-800">
                        <div className="aspect-video bg-zinc-200 dark:bg-zinc-900 flex items-center justify-center">
                          <span className="text-sm text-zinc-600">대기 중...</span>
                        </div>
                        <div className="px-2 py-1.5 bg-zinc-50 dark:bg-zinc-900">
                          <div className="text-sm text-zinc-600 dark:text-zinc-300">{cam.role}</div>
                        </div>
                      </div>
                    ))}
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

          {/* ─── RUNNING: Camera feed focus ─── */}
          {phase === "running" && (
            <div className="flex flex-col gap-4">
              {/* Runtime Status — 인라인 */}
              <div className="flex flex-wrap items-center gap-3 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-zinc-400">Arm:</span>
                  <StatusBadge status="running" label="active" />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-zinc-400">Camera:</span>
                  <StatusBadge status="running" label="2/2" />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-zinc-400">Conflict:</span>
                  <StatusBadge status="idle" label="없음" />
                </div>
              </div>

              {/* Camera feeds — full width */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {CAMERAS_MAPPED.map((cam) => (
                  <div key={cam.role} className="relative rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-800">
                    <div className="aspect-video bg-zinc-200 dark:bg-zinc-900 relative">
                      {!pausedFeeds[cam.role] ? (
                        <WireBox
                          className="absolute inset-0 border-0 rounded-none"
                          label={`MJPEG stream — ${cam.role}`}
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-zinc-600">
                          <span className="text-sm flex items-center gap-1"><Pause size={10} className="fill-current" /> 일시정지</span>
                        </div>
                      )}

                      {/* Overlays */}
                      <div className="absolute top-2 left-2 flex items-center gap-1.5">
                        <span className="px-1.5 py-0.5 rounded bg-red-500/80 text-white text-sm font-mono">LIVE</span>
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
                ))}
              </div>

              {/* Loop stats */}
              <div className="flex items-center gap-2 px-3 py-2 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50">
                <span className="text-sm text-zinc-400 font-mono">Loop:</span>
                <span className="text-sm font-mono text-emerald-600 dark:text-emerald-400">{loopMs}ms ({Math.round(avgFps)}Hz)</span>
                <div className="ml-2 w-16 h-1 rounded-full bg-emerald-500/30">
                  <div className="h-full w-3/4 rounded-full bg-emerald-400" />
                </div>
                <span className="ml-auto text-sm text-zinc-500">{mode} · {speed} · {validCameraCount}/{CAMERAS_MAPPED.length} cams</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sticky control bar */}
      <StickyControlBar>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <StatusBadge
              status={running ? "running" : phase === "loading" ? "warning" : "ready"}
              label={running ? "TELEOP ACTIVE" : phase === "loading" ? "STARTING..." : "READY"}
              pulse={running}
            />
            {running && (
              <span className="text-sm text-zinc-400">
                {mode} · Loop 12ms
              </span>
            )}
          </div>

          {(phase === "idle" || phase === "running") && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-400 whitespace-nowrap">속도:</span>
              <WireSelect
                value={speed}
                options={["0.1x", "0.25x", "0.5x", "0.75x", "1.0x"]}
              />
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <ProcessButtons
            running={phase !== "idle"}
            onStart={() => { void handleStart(); }}
            onStop={() => { void handleStop(); }}
            startLabel={<><Play size={13} className="fill-current" /> Start Teleop</>}
            disabled={actionPending}
            compact
          />
        </div>
      </StickyControlBar>
    </div>
  );
}
