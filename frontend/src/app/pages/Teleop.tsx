import { useMemo, useState, useEffect, useRef } from "react";
import { Link } from "react-router";
import { ChevronDown, ChevronUp, Play, Pause, Loader2, CheckCircle2, Camera } from "lucide-react";
import { cn } from "../components/ui/utils";
import { apiGet, apiPost } from "../services/apiClient";
import { useLeStudioStore } from "../store";
import {
  extractPreflightReason,
  parseBackendError,
  toBackendTeleopPayload,
  type PreflightResult,
} from "../services/contracts";
import {
  notifyError,
  notifyProcessStarted,
  notifyProcessStopRequested,
  notifyProcessEndedWithError,
} from "../services/notifications";
import {
  PageHeader, StatusBadge, WireSelect,
  FieldRow, ProcessButtons, ModeToggle, StickyControlBar, SubTabs,
  WireBox, BlockerCard, RefreshButton, EmptyState,
} from "../components/wireframe";
import { toVideoName, useCameraFeeds } from "../hooks/useCameraFeeds";



type TeleopPhase = "idle" | "loading" | "running";

type ActionResponse = {
  ok: boolean;
  error?: string;
};

type CameraStatsResponse = {
  cameras?: Record<string, { fps: number; mbps: number }>;
};


type DevicesResponse = {
  cameras: Array<{ device: string; path: string; kernels: string; symlink: string; model: string }>;
  arms: Array<{ device: string; path: string; symlink?: string | null }>;
};

type CalibFile = { id: string; guessed_type: string };

const LOADING_STEPS = [
  "Connecting arm...",
  "Opening camera...",
  "Initializing stream...",
  "Ready",
];

export function Teleop() {
  const config = useLeStudioStore((s) => s.config);
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
  const [camerasMapped, setCamerasMapped] = useState<{ role: string; path: string }[]>([]);
  const [armPortOptions, setArmPortOptions] = useState<string[]>([]);
  const [followerIdOptions, setFollowerIdOptions] = useState<string[]>([]);
  const [leaderIdOptions, setLeaderIdOptions] = useState<string[]>([]);
  const [bimanualIdOptions, setBimanualIdOptions] = useState<string[]>([]);
  const [selectedFollowerPort, setSelectedFollowerPort] = useState("");
  const [selectedLeaderPort, setSelectedLeaderPort] = useState("");
  const [selectedFollowerId, setSelectedFollowerId] = useState("");
  const [selectedLeaderId, setSelectedLeaderId] = useState("");
  const [selectedBimanualId, setSelectedBimanualId] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const running = phase === "running";
  const feedTargets = useMemo(
    () => camerasMapped.map((cam) => ({ id: cam.role, videoName: toVideoName(cam.path) })),
    [camerasMapped],
  );
  const previewFeedsActive = phase === "idle" && teleopTab === "camera";
  const cameraFrames = useCameraFeeds(feedTargets, previewFeedsActive || running, 30, pausedFeeds);

  const toggleFeed = (role: string) =>
    setPausedFeeds((prev) => ({ ...prev, [role]: !prev[role] }));

  const handleStart = async () => {
    if (actionPending) return;
    setActionPending(true);
    setFlowError(null);
    setStartAccepted(false);
    setPhase("loading");
    setLoadingStep(0);
    try {
      const payload = toBackendTeleopPayload({
        modeLabel: mode,
        speedLabel: speed,
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

      const started = await apiPost<ActionResponse>("/api/teleop/start", payload);
      if (!started.ok) {
        setPhase("idle");
        const reason = started.error ?? "failed to start teleop";
        setFlowError(reason);
        notifyError(reason);
        return;
      }

      setStartAccepted(true);
      notifyProcessStarted("teleop");
    } catch (error) {
      setPhase("idle");
      const reason = parseBackendError(error, "failed to start teleop");
      setFlowError(reason);
      notifyError(reason);
    } finally {
      setActionPending(false);
    }
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
      const devResult = await apiGet<DevicesResponse>("/api/devices");
      const mapped = (devResult.cameras ?? [])
        .filter((cam) => cam.symlink)
        .map((cam) => ({ role: cam.symlink, path: `/dev/lerobot/${cam.symlink}` }));
      setCamerasMapped(mapped);

      const ports = Array.from(
        new Set(
          (devResult.arms ?? [])
            .map((arm) => (arm.symlink ? `/dev/${arm.symlink}` : arm.path))
            .filter((value): value is string => Boolean(value))
        )
      );
      setArmPortOptions(ports);
      setSelectedFollowerPort((prev) => (prev && ports.includes(prev) ? prev : ports[0] ?? ""));
      setSelectedLeaderPort((prev) => (prev && ports.includes(prev) ? prev : ports[0] ?? ""));

      const calibResult = await apiGet<{ files?: CalibFile[] }>("/api/calibrate/list");
      const files = calibResult.files ?? [];
      const followers = Array.from(new Set(files.filter((f) => f.guessed_type.includes("follower")).map((f) => f.id)));
      const leaders = Array.from(new Set(files.filter((f) => f.guessed_type.includes("leader")).map((f) => f.id)));
      const bimanual = Array.from(new Set(files.filter((f) => f.guessed_type.startsWith("bi_")).map((f) => f.id)));
      setFollowerIdOptions(followers);
      setLeaderIdOptions(leaders);
      setBimanualIdOptions(bimanual);
      setSelectedFollowerId((prev) => (prev && followers.includes(prev) ? prev : followers[0] ?? ""));
      setSelectedLeaderId((prev) => (prev && leaders.includes(prev) ? prev : leaders[0] ?? ""));
      setSelectedBimanualId((prev) => (prev && bimanual.includes(prev) ? prev : bimanual[0] ?? ""));

    };
    void run();
  }, [refreshKey]);

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

  const activeFpsValues = camerasMapped.map((cam) => cameraStats[cam.role]?.fps).filter((v): v is number => typeof v === "number");
  const avgFps = activeFpsValues.length > 0 ? activeFpsValues.reduce((sum, cur) => sum + cur, 0) / activeFpsValues.length : 30;
  const loopMs = Math.max(1, Math.round(1000 / avgFps));

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 flex flex-col gap-4 max-w-[1600px] mx-auto w-full">
          {/* Header */}
          <PageHeader
            title="Teleop"
            subtitle="Real-time teleoperation + multi-camera feed"
            action={
              <div className="flex items-center gap-3">
                {phase === "idle" && (
                  <ModeToggle options={["Single Arm", "Bi-Arm"]} value={mode} onChange={setMode} />
                )}
                <RefreshButton onClick={() => setRefreshKey(k => k + 1)} />
              </div>
            }
          />

          {flowError && <BlockerCard title="Execution Blocked" severity="error" reasons={[flowError]} />}

          {/* ─── IDLE: Sub-tabs for settings ─── */}
          {phase === "idle" && (
            <div className="flex flex-col gap-4">
              <SubTabs
                tabs={[
                  { key: "motor", label: "Motor Setting" },
                  { key: "camera", label: "Camera Setting" },
                ]}
                activeKey={teleopTab}
                onChange={setTeleopTab}
                className="mx-auto"
              />

              {/* Motor Setting Tab */}
              {teleopTab === "motor" && (
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800">
                    <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Motor Configuration</span>
                  </div>
                  <div className="px-4 py-4 flex flex-col gap-3">
                  <p className="text-sm text-zinc-400">Select robot type and control method.</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
                    <FieldRow label="Robot Type">
                      <WireSelect value="so101_follower" options={["so101_follower", "so100_follower", "aloha"]} />
                    </FieldRow>
                    <FieldRow label="Teleop Type">
                      <WireSelect value="so101_leader" options={["so101_leader", "so100_leader", "keyboard"]} />
                    </FieldRow>
                  </div>

                  <div className="border-t border-zinc-100 dark:border-zinc-800 pt-3 flex flex-col gap-2">
                    <p className="text-sm text-zinc-400">Select device port to connect.</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
                    {mode === "Single Arm" ? (
                      <>
                        <FieldRow label="Follower Port">
                          <WireSelect
                            placeholder={armPortOptions.length === 0 ? "No ports detected" : undefined}
                            value={selectedFollowerPort}
                            options={armPortOptions}
                            onChange={setSelectedFollowerPort}
                          />
                        </FieldRow>
                        <FieldRow label="Leader Port">
                          <WireSelect
                            placeholder={armPortOptions.length === 0 ? "No ports detected" : undefined}
                            value={selectedLeaderPort}
                            options={armPortOptions}
                            onChange={setSelectedLeaderPort}
                          />
                        </FieldRow>
                      </>
                    ) : (
                      <>
                        {["Left Follower", "Right Follower", "Left Leader", "Right Leader"].map((label) => (
                          <FieldRow key={label} label={label}>
                            <WireSelect
                              placeholder={armPortOptions.length === 0 ? "No ports detected" : `${label} Port`}
                              options={armPortOptions}
                            />
                          </FieldRow>
                        ))}
                      </>
                    )}
                    </div>
                  </div>

                  <div className="border-t border-zinc-100 dark:border-zinc-800 pt-3 flex flex-col gap-2">
                    <p className="text-sm text-zinc-400">Select calibration profile.</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
                    {mode === "Single Arm" ? (
                      <>
                        <FieldRow label="Follower ID">
                          <WireSelect
                            placeholder={followerIdOptions.length === 0 ? "No calibration files" : undefined}
                            value={selectedFollowerId}
                            options={followerIdOptions}
                            onChange={setSelectedFollowerId}
                          />
                        </FieldRow>
                        <FieldRow label="Leader ID">
                          <WireSelect
                            placeholder={leaderIdOptions.length === 0 ? "No calibration files" : undefined}
                            value={selectedLeaderId}
                            options={leaderIdOptions}
                            onChange={setSelectedLeaderId}
                          />
                        </FieldRow>
                      </>
                    ) : (
                      <FieldRow label="Robot ID">
                        <WireSelect
                          placeholder={bimanualIdOptions.length === 0 ? "No calibration files" : undefined}
                          value={selectedBimanualId}
                          options={bimanualIdOptions}
                          onChange={setSelectedBimanualId}
                        />
                      </FieldRow>
                    )}
                    </div>
                  </div>
                </div>
                </div>
              )}

              {/* Camera Setting Tab — settings above, preview below */}
              {teleopTab === "camera" && (
                <div className="flex flex-col gap-4">
                  {/* Camera settings — full width */}
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800">
                      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Camera feed settings</span>
                    </div>
                    <div className="px-4 py-4 flex flex-col gap-3">
                      {camerasMapped.length === 0 ? (
                        <EmptyState
                          icon={<Camera size={28} />}
                          message={
                            <>
                              No camera mappings. First connect cameras in the{" "}
                              <a href="/camera-setup" className="underline hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">Camera Setup</a> tab.
                            </>
                          }
                          messageClassName="max-w-none"
                        />
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
                        Advanced stream settings
                        {advStreamOpen ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                      </button>

                      {advStreamOpen && (
                        <div className="flex flex-col gap-2 pl-2 border-l-2 border-zinc-100 dark:border-zinc-800">
                          <FieldRow label="Codec">
                            <WireSelect value="MJPG" options={["MJPG", "YUYV"]} />
                          </FieldRow>
                          <FieldRow label="Resolution">
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
                  <div className={cn(
                    "grid gap-2",
                    camerasMapped.length === 1
                      ? "grid-cols-1"
                      : camerasMapped.length === 2
                        ? "grid-cols-1 sm:grid-cols-2"
                        : camerasMapped.length === 3
                          ? "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3"
                          : "grid-cols-2 sm:grid-cols-4",
                  )}>
                    {camerasMapped.map((cam) => {
                      const frameSrc = cameraFrames[cam.role];
                      return (
                        <div key={cam.role} className="relative rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-800">
                          <div className="aspect-video bg-zinc-200 dark:bg-zinc-900">
                            {frameSrc ? (
                              <img src={frameSrc} alt={`${cam.role} preview`} className="h-full w-full object-cover" />
                            ) : (
                              <div className="h-full w-full flex items-center justify-center">
                                <span className="text-sm text-zinc-600">Waiting...</span>
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

          {/* ─── RUNNING: Camera feed focus ─── */}
          {phase === "running" && (
            <div className="flex flex-col gap-4">
              {/* Runtime Status — inline */}
              <div className="flex flex-wrap items-center gap-3 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-zinc-400">Arm:</span>
                  <StatusBadge status="running" label="active" />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-zinc-400">Camera:</span>
                  <StatusBadge status="running" label={`${camerasMapped.length}/${camerasMapped.length}`} />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-zinc-400">Conflict:</span>
                  <StatusBadge status="idle" label="None" />
                </div>
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
                            <span className="text-sm flex items-center gap-1"><Pause size={10} className="fill-current" /> Paused</span>
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
                  );
                })}
              </div>

              {/* Loop stats */}
              <div className="flex items-center gap-2 px-3 py-2 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50">
                <span className="text-sm text-zinc-400 font-mono">Loop:</span>
                <span className="text-sm font-mono text-emerald-600 dark:text-emerald-400">{loopMs}ms ({Math.round(avgFps)}Hz)</span>
                <div className="ml-2 w-16 h-1 rounded-full bg-emerald-500/30">
                  <div className="h-full w-3/4 rounded-full bg-emerald-400" />
                </div>
                <span className="ml-auto text-sm text-zinc-500">{mode} · {speed} · {camerasMapped.length} cams</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sticky control bar */}
      <StickyControlBar>
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2">
            <StatusBadge
              status={running ? "running" : phase === "loading" ? "warning" : "ready"}
              label={running ? "TELEOP ACTIVE" : phase === "loading" ? "STARTING..." : "READY"}
              pulse={running}
            />
            {running && (
              <span className="text-sm text-zinc-400">
                {mode} · Loop {loopMs}ms
              </span>
            )}
          </div>

          {(phase === "idle" || phase === "running") && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-400 whitespace-nowrap">Speed:</span>
              <WireSelect
                value={speed}
                options={["0.1x", "0.25x", "0.5x", "0.75x", "1.0x"]}
                onChange={setSpeed}
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
