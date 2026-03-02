import React, { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router";
import {
  ChevronDown, ChevronUp, AlertTriangle, CheckCircle2,
  Trophy, TrendingDown, ArrowRight, Video,
  PackageOpen, Loader2, RotateCcw, Play
} from "lucide-react";
import {
  PageHeader, StatusBadge, FieldRow,
  ProcessButtons, StickyControlBar, BlockerCard
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
} from "../services/notifications";
import { apiGet, apiPost } from "../services/apiClient";

// ─── Types ────────────────────────────────────────────────────────────────────
type EvalStatus = "idle" | "starting" | "running" | "done" | "blocked";

interface GymEnv {
  type: string;
  label: string;
  module: string;
  installed: boolean;
  description: string;
}

interface EpisodeResult {
  ep: number;
  reward: number;
  frames: number;
  success: boolean;
}

const CAMERA_MOCKS = [
  { role: "top_cam_1",   path: "/dev/lerobot/top_cam_1" },
  { role: "wrist_cam_1", path: "/dev/lerobot/wrist_cam_1" },
];

const IMAGE_KEYS_FROM_CHECKPOINT = [
  "observation.images.top",
  "observation.images.wrist",
];

const STARTING_STEPS = [
  { label: "환경 초기화", delay: 400 },
  { label: "정책 모델 로딩", delay: 350 },
  { label: "카메라 / 센서 연결", delay: 250 },
  { label: "평가 루프 시작", delay: 200 },
];

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
  // API-fetched data
  const [gymEnvs, setGymEnvs] = useState<GymEnv[]>([]);
  const [policySources, setPolicySources] = useState<string[]>([]);

  useEffect(() => {
    apiGet<{ envs: GymEnv[] }>("/api/eval/env-types").then((res) => {
      setGymEnvs(res.envs);
      setInstalledEnvs(new Set(res.envs.filter((e) => e.installed).map((e) => e.type)));
      if (res.envs.length > 0) setEnvType(res.envs[0].type);
    });
    apiGet<{ ok: boolean; checkpoints: { name: string; path: string; step: number }[] }>("/api/checkpoints").then((res) => {
      const paths = res.checkpoints.map((c) => c.path);
      setPolicySources(paths);
      if (paths.length > 0) setPolicySource(paths[0]);
    });
  }, []);

  // Config state
  const [policySource, setPolicySource] = useState("");
  const [datasetRepo, setDatasetRepo] = useState("lerobot-user/pick_cube");
  const [numEpisodes, setNumEpisodes] = useState(10);
  const [device, setDevice] = useState("CUDA (GPU)");
  const [envType, setEnvType] = useState("");
  const [task, setTask] = useState("pick cube and place");
  const [datasetOverride, setDatasetOverride] = useState("");
  const [advOpen, setAdvOpen] = useState(false);

  // Env install
  const [installingEnv, setInstallingEnv] = useState<string | null>(null);
  const [installedEnvs, setInstalledEnvs] = useState<Set<string>>(new Set());

  // Camera config
  const [cameraConfigOpen, setCameraConfigOpen] = useState(true);
  const [cameraMapping, setCameraMapping] = useState<Record<string, string>>({
    "observation.images.top": "top_cam_1",
    "observation.images.wrist": "",
  });

  // Eval state
  const [evalStatus, setEvalStatus] = useState<EvalStatus>("idle");
  const [currentEp, setCurrentEp] = useState(0);
  const [results, setResults] = useState<EpisodeResult[]>([]);
  const [startingStep, setStartingStep] = useState(0);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cameraMappingRef = useRef<HTMLDivElement>(null);

  const selectedEnv = gymEnvs.find((e) => e.type === envType);
  const isRealRobot = envType === "gym_manipulator";
  const isRunning = evalStatus === "running" || evalStatus === "starting";

  // Derived stats
  const avgReward = results.length > 0
    ? (results.reduce((s, r) => s + r.reward, 0) / results.length)
    : null;
  const bestEp = results.length > 0 ? results.reduce((a, b) => a.reward > b.reward ? a : b) : null;
  const worstEp = results.length > 0 ? results.reduce((a, b) => a.reward < b.reward ? a : b) : null;
  const successRate = results.length > 0
    ? Math.round((results.filter((r) => r.success).length / results.length) * 100)
    : null;

  const startEval = useCallback(() => {
    apiPost<{ ok: boolean; error?: string }>("/api/eval/start", {
      env_type: envType,
      policy_path: policySource,
      dataset_repo: datasetRepo,
      num_episodes: numEpisodes,
      device,
    });
    setEvalStatus("starting");
    notifyProcessStarted("eval");
    setResults([]);
    setCurrentEp(0);
    setStartingStep(0);

    let step = 0;
    const advanceStep = () => {
      step++;
      setStartingStep(step);
      if (step < STARTING_STEPS.length) {
        setTimeout(advanceStep, STARTING_STEPS[step].delay);
      } else {
        setTimeout(() => {
          setEvalStatus("running");
          let ep = 0;
          intervalRef.current = setInterval(() => {
            ep++;
            const reward = Math.max(0.05, Math.min(1.0, 0.55 + (Math.random() - 0.5) * 0.7));
            const success = reward >= 0.6;
            setCurrentEp(ep);
            setResults((prev) => [...prev, { ep, reward, frames: 150 + Math.round(Math.random() * 80), success }]);
            if (ep >= numEpisodes) {
              clearInterval(intervalRef.current!);
              setEvalStatus("done");
              notifySuccess("Evaluation completed.");
            }
          }, 700);
        }, 300);
      }
    };
    setTimeout(advanceStep, STARTING_STEPS[0].delay);
  }, [numEpisodes, envType, policySource, datasetRepo, device]);

  const stopEval = useCallback(() => {
    apiPost("/api/process/eval/stop");
    if (intervalRef.current) clearInterval(intervalRef.current);
    setEvalStatus("idle");
    notifyProcessStopRequested("eval");
  }, []);

  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current); }, []);

  const handleInstall = (env: GymEnv) => {
    setInstallingEnv(env.type);
    setTimeout(() => {
      setInstalledEnvs((prev) => new Set([...prev, env.type]));
      setInstallingEnv(null);
      setEnvType(env.type);
    }, 2800);
  };

  const handleStopInstall = () => setInstallingEnv(null);

  return (
    <div className="flex flex-col h-full">
      {/* Top nav bar */}
      <div className="flex items-center justify-between px-6 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-sm text-zinc-400">
        <Link to="/training" className="inline-flex items-center gap-1 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">
          ← Training
        </Link>
        <div className="flex items-center gap-2">
          <span className="text-zinc-300 dark:text-zinc-600">Training</span>
          <span className="text-zinc-300 dark:text-zinc-600">›</span>
          <span className="text-zinc-700 dark:text-zinc-200 font-medium">Evaluation</span>
        </div>
        <div />
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-6 pb-8 flex flex-col gap-4 max-w-[1600px] mx-auto w-full">

          {/* Header */}
          <PageHeader
            title="Policy Evaluation"
            subtitle="학습된 AI 정책을 실제 로봇 또는 시뮬레이션 환경에서 평가합니다"
            status={
              evalStatus === "running" ? "running" :
              evalStatus === "starting" ? "warning" :
              evalStatus === "done" ? "ready" :
              evalStatus === "blocked" ? "blocked" : "idle"
            }
            statusLabel={
              evalStatus === "running" ? "EVALUATING" :
              evalStatus === "starting" ? "STARTING" :
              evalStatus === "done" ? "DONE" :
              evalStatus === "blocked" ? "BLOCKED" : "IDLE"
            }
          />

          {/* ─── IDLE: Settings ─────────────────────────────────────── */}
          {evalStatus === "idle" && results.length === 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_2fr] gap-4 items-start">

              {/* Eval Config — right wide */}
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden lg:order-2">
                <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800 flex items-center">
                  <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300">평가 설정</span>
                </div>
                <div className="p-4 flex flex-col gap-4">

                  {/* Top row */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <div className="text-sm text-zinc-500 mb-1.5">Policy Source</div>
                      <select
                        value={policySource}
                        onChange={(e) => setPolicySource(e.target.value)}
                        className="w-full h-7 px-2 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-700 dark:text-zinc-300 text-sm outline-none cursor-pointer focus:border-blue-500 dark:focus:border-blue-400"
                      >
                        {policySources.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
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
                    <div>
                      <div className="text-sm text-zinc-500 mb-1.5">Device</div>
                      <select
                        value={device}
                        onChange={(e) => setDevice(e.target.value)}
                        className="w-full h-7 px-2 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-700 dark:text-zinc-300 text-sm outline-none cursor-pointer focus:border-blue-500 dark:focus:border-blue-400"
                      >
                        {["CUDA (GPU)", "CPU"].map((d) => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* Second row: Episodes + Task */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <div className="text-sm text-zinc-500 mb-1.5">에피소드 수</div>
                      <input
                        type="number"
                        value={numEpisodes}
                        onChange={(e) => setNumEpisodes(Number(e.target.value))}
                        min={1}
                        max={100}
                        className="w-full h-7 px-2 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-700 dark:text-zinc-300 text-sm outline-none focus:border-blue-500 dark:focus:border-blue-400"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <div className="text-sm text-zinc-500 mb-1.5">Task</div>
                      <input
                        type="text"
                        value={task}
                        onChange={(e) => setTask(e.target.value)}
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
                    고급 설정
                  </button>
                  {advOpen && (
                    <div className="pl-3 border-l-2 border-zinc-100 dark:border-zinc-800">
                      <div className="text-sm text-zinc-500 mb-1.5">Dataset Override <span className="text-zinc-600">(선택)</span></div>
                      <input
                        type="text"
                        value={datasetOverride}
                        onChange={(e) => setDatasetOverride(e.target.value)}
                        placeholder="다른 dataset repo로 override"
                        className="w-full h-7 px-2 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-700 dark:text-zinc-300 text-sm outline-none placeholder:text-zinc-500 focus:border-blue-500 dark:focus:border-blue-400"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Env Type — left narrow */}
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden lg:order-1">
                <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800 flex items-center">
                  <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300">환경 선택</span>
                </div>
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
                  {gymEnvs.map((env) => {
                    const isInstalled = installedEnvs.has(env.type);
                    const isInstalling = installingEnv === env.type;
                    const isSelected = envType === env.type;
                    const isRealRobotEnv = env.type === "gym_manipulator";
                    return (
                      <div key={env.type}>
                        <div
                          className={cn(
                            "flex items-center gap-3 px-4 py-2.5 transition-colors",
                            isInstalled ? "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/20" : "",
                            isSelected ? "bg-zinc-50 dark:bg-zinc-800/30" : ""
                          )}
                          onClick={() => { if (isInstalled) { setEnvType(env.type); if (env.type === 'gym_manipulator') { setTimeout(() => cameraMappingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100); } } }}
                        >
                          <span className={cn("size-1.5 rounded-full flex-none",
                            isInstalled ? "bg-emerald-400" : "bg-zinc-600"
                          )} />
                          <div className="flex-1 min-w-0">
                            <span className={cn("text-sm",
                              isSelected ? "text-zinc-800 dark:text-zinc-100 font-medium" : "text-zinc-600 dark:text-zinc-300"
                            )}>
                              {env.label}
                            </span>
                            <span className="text-sm text-zinc-500 ml-2">{env.description}</span>
                          </div>
                          {isSelected && (
                            <span className="text-sm text-zinc-400 border border-zinc-200 dark:border-zinc-700 rounded px-1.5 py-0.5 flex-none">선택됨</span>
                          )}
                          {!isInstalled && (
                            isInstalling ? (
                              <div className="flex items-center gap-1.5 flex-none">
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleStopInstall(); }}
                                  className="text-sm text-red-600 dark:text-red-400 hover:underline cursor-pointer"
                                >
                                  Stop
                                </button>
                                <Loader2 size={12} className="text-zinc-400 animate-spin" />
                              </div>
                            ) : (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleInstall(env); }}
                                className="text-sm text-zinc-400 hover:text-zinc-200 hover:underline cursor-pointer flex-none"
                              >
                                Install
                              </button>
                            )
                          )}
                        </div>
                        {/* Camera mapping sub-detail for Real Robot */}
                        {isRealRobotEnv && isSelected && (
                          <div ref={cameraMappingRef} className="bg-zinc-50/50 dark:bg-zinc-900/30">
                            <div
                              className="flex items-center justify-between pl-9 pr-4 py-1.5 cursor-pointer"
                              onClick={() => setCameraConfigOpen(!cameraConfigOpen)}
                            >
                              <div className="flex items-center gap-2">
                                <Video size={12} className="text-emerald-600 dark:text-emerald-400 flex-none" />
                                <span className="text-sm text-zinc-500">카메라 매핑</span>
                                <span className="text-sm text-emerald-600 dark:text-emerald-400">
                                  {Object.values(cameraMapping).filter(Boolean).length}/{IMAGE_KEYS_FROM_CHECKPOINT.length} 매핑됨
                                </span>
                              </div>
                              {cameraConfigOpen ? <ChevronUp size={10} className="text-zinc-500" /> : <ChevronDown size={10} className="text-zinc-500" />}
                            </div>
                            {cameraConfigOpen && (
                              <div className="border-t border-zinc-100 dark:border-zinc-800/40 px-4 py-2 space-y-2">
                                <p className="text-sm text-zinc-400 pl-5">체크포인트의 image key를 실제 카메라에 매핑합니다.</p>
                                {IMAGE_KEYS_FROM_CHECKPOINT.map((key) => (
                                  <div key={key} className="flex items-center gap-2 pl-5">
                                    <code className="text-sm font-mono text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded flex-none">
                                      {key}
                                    </code>
                                    <ArrowRight size={10} className="text-zinc-400 flex-none" />
                                    <select
                                      value={cameraMapping[key] || ""}
                                      onChange={(e) => setCameraMapping((prev) => ({ ...prev, [key]: e.target.value }))}
                                      className="flex-1 h-7 px-2 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-700 dark:text-zinc-300 text-sm outline-none cursor-pointer focus:border-blue-500 dark:focus:border-blue-400"
                                    >
                                      <option value="">— 선택 —</option>
                                      {CAMERA_MOCKS.map((c) => (
                                        <option key={c.role} value={c.role}>{c.role} ({c.path})</option>
                                      ))}
                                    </select>
                                  </div>
                                ))}
                                {Object.values(cameraMapping).some((v) => !v) && (
                                  <p className="text-sm text-amber-600 dark:text-amber-400 pl-5">
                                    ⚠ 매핑되지 않은 카메라가 있습니다. 평가 실행 시 오류가 발생할 수 있습니다.
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {!selectedEnv || !installedEnvs.has(selectedEnv.type) ? (
                  <div className="px-4 py-2 border-t border-zinc-100 dark:border-zinc-800/50">
                    <BlockerCard reasons={[`${selectedEnv?.label ?? envType} 환경이 설치되지 않았습니다`]} title="환경 미설치" />
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {/* ─── STARTING: Spinner + Checklist ──────────────────────── */}
          {evalStatus === "starting" && (
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
                {selectedEnv?.label ?? envType} · {numEpisodes} episodes · {policySource.split("/").pop()}
              </p>
            </div>
          )}

          {/* ─── RUNNING: Monitoring ────────────────────────────────── */}
          {evalStatus === "running" && (
            <div className="flex flex-col gap-4">

              {/* Progress */}
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300">평가 진행</span>
                  <StatusBadge status="running" label="RUNNING" pulse />
                </div>
                <div className="p-4 flex flex-col gap-4">
                  <div className="flex items-center gap-6 flex-wrap">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm text-zinc-400">Episode</span>
                      <span className="text-sm font-mono text-zinc-700 dark:text-zinc-200">
                        {currentEp} <span className="text-zinc-400 text-sm">/ {numEpisodes}</span>
                      </span>
                    </div>
                    {avgReward !== null && (
                      <div className="flex flex-col gap-0.5">
                        <span className="text-sm text-zinc-400">Avg Reward</span>
                        <span className={cn("text-sm font-mono", avgReward >= 0.6 ? "text-emerald-600 dark:text-emerald-400" : avgReward >= 0.4 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400")}>
                          {avgReward.toFixed(3)}
                        </span>
                      </div>
                    )}
                    {successRate !== null && (
                      <div className="flex flex-col gap-0.5">
                        <span className="text-sm text-zinc-400">Success Rate</span>
                        <span className={cn("text-sm font-mono", successRate >= 60 ? "text-emerald-600 dark:text-emerald-400" : successRate >= 40 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400")}>
                          {successRate}%
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
                      <span>{currentEp} / {numEpisodes} episodes</span>
                      <span>{Math.round((currentEp / numEpisodes) * 100)}%</span>
                    </div>
                    <div className="h-2.5 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500 bg-zinc-800 dark:bg-zinc-200"
                        style={{ width: `${(currentEp / numEpisodes) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Reward Chart */}
              {results.length > 0 && (
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                  <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800 flex items-center">
                    <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300">에피소드별 Reward</span>
                  </div>
                  <div className="h-56 p-3">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={results} margin={{ top: 8, right: 8, bottom: 4, left: -12 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(63,63,70,0.5)" vertical={false} />
                        <XAxis dataKey="ep" tick={{ fontSize: 10, fill: "#71717a" }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fontSize: 10, fill: "#71717a" }} tickLine={false} axisLine={false} domain={[0, 1]} tickFormatter={(v) => v.toFixed(1)} width={32} />
                        <Tooltip content={<RewardTooltip />} />
                        <ReferenceLine y={0.6} stroke="#6b7280" strokeDasharray="4 4" strokeWidth={1} />
                        <Bar dataKey="reward" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                          {results.map((r) => (
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

          {/* ─── DONE: Results ──────────────────────────────────────── */}
          {evalStatus === "done" && (
            <div className="flex flex-col gap-4">

              {/* Completion summary */}
              <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5">
                <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400 flex-none" />
                <div>
                  <span className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">평가 완료</span>
                  <span className="text-sm text-zinc-400 ml-3">
                    {selectedEnv?.label} · {numEpisodes} episodes · Avg Reward {avgReward?.toFixed(3)} · Success {successRate}%
                  </span>
                </div>
              </div>

              {/* Summary stats */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/20">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm text-zinc-400">Total</span>
                  <span className="text-sm font-mono text-zinc-700 dark:text-zinc-200">{results.length} eps</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm text-zinc-400">Avg Reward</span>
                  <span className={cn("text-sm font-mono", (avgReward ?? 0) >= 0.6 ? "text-emerald-600 dark:text-emerald-400" : (avgReward ?? 0) >= 0.4 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400")}>
                    {avgReward?.toFixed(3) ?? "—"}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm text-zinc-400">Success Rate</span>
                  <span className={cn("text-sm font-mono", (successRate ?? 0) >= 60 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>
                    {successRate}%
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm text-zinc-400">Best</span>
                  <span className="text-sm font-mono text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <Trophy size={12} /> Ep {bestEp?.ep} ({bestEp?.reward.toFixed(3)})
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm text-zinc-400">Worst</span>
                  <span className="text-sm font-mono text-red-600 dark:text-red-400 flex items-center gap-1">
                    <TrendingDown size={12} /> Ep {worstEp?.ep} ({worstEp?.reward.toFixed(3)})
                  </span>
                </div>
              </div>

              {/* Reward Chart */}
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300">에피소드별 Reward</span>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-emerald-500" /><span className="text-sm text-zinc-500">≥ 0.7</span></div>
                    <div className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-amber-500" /><span className="text-sm text-zinc-500">0.5–0.7</span></div>
                    <div className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-red-500" /><span className="text-sm text-zinc-500">&lt; 0.5</span></div>
                    <span className="text-sm text-zinc-600">— 0.6 기준선</span>
                  </div>
                </div>
                <div className="h-56 p-3">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={results} margin={{ top: 8, right: 8, bottom: 4, left: -12 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(63,63,70,0.5)" vertical={false} />
                      <XAxis dataKey="ep" tick={{ fontSize: 10, fill: "#71717a" }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: "#71717a" }} tickLine={false} axisLine={false} domain={[0, 1]} tickFormatter={(v) => v.toFixed(1)} width={32} />
                      <Tooltip content={<RewardTooltip />} />
                      <ReferenceLine y={0.6} stroke="#6b7280" strokeDasharray="4 4" strokeWidth={1} />
                      <Bar dataKey="reward" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                        {results.map((r) => (
                          <Cell key={r.ep} fill={r.reward >= 0.7 ? "#10b981" : r.reward >= 0.5 ? "#f59e0b" : "#ef4444"} fillOpacity={r.ep === bestEp?.ep ? 1 : 0.75} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Episode Detail Table */}
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800 flex items-center">
                  <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300">에피소드 상세 ({results.length})</span>
                </div>
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800/50 max-h-52 overflow-y-auto">
                  {results.map((r) => (
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
                      <span className="text-sm text-zinc-500 w-16 text-right flex-none font-mono">{r.frames} fr</span>
                      <span className={cn("text-sm w-6 text-right flex-none", r.success ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-500")}>
                        {r.success ? "✓" : "✗"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Next actions */}
              <div className="flex flex-wrap items-center gap-2 justify-end">
                <button
                  onClick={() => {
                    setNumEpisodes(3);
                    setResults([]);
                    setCurrentEp(0);
                    startEval();
                  }}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-emerald-500/40 text-sm text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 transition-colors cursor-pointer"
                >
                  <RotateCcw size={12} /> 빠른 재실행 (3 ep)
                </button>
                <button
                  onClick={() => { setResults([]); setCurrentEp(0); setEvalStatus("idle"); }}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                >
                  <RotateCcw size={12} /> 새 평가 시작
                </button>
                <Link
                  to="/training"
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                >
                  <ArrowRight size={12} /> Train으로 이동
                </Link>
                <Link
                  to="/recording"
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                >
                  <ArrowRight size={12} /> 새 데이터 녹화
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
              evalStatus === "running" ? "running" :
              evalStatus === "starting" ? "warning" :
              evalStatus === "done" ? "ready" :
              evalStatus === "blocked" ? "blocked" : "idle"
            }
            label={
              evalStatus === "running" ? "EVALUATING" :
              evalStatus === "starting" ? "STARTING" :
              evalStatus === "done" ? "DONE" :
              evalStatus === "blocked" ? "BLOCKED" : "READY"
            }
            pulse={isRunning}
          />
          {isRunning && (
            <span className="text-sm text-zinc-400 font-mono truncate">
              Episode {currentEp} / {numEpisodes}
            </span>
          )}
          {evalStatus === "done" && avgReward !== null && (
            <span className="text-sm text-zinc-400">
              Avg Reward: <span className={cn("font-mono", avgReward >= 0.6 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>{avgReward.toFixed(3)}</span>
              {" "}· Success: <span className={cn("font-mono", (successRate ?? 0) >= 60 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>{successRate}%</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ProcessButtons
            running={isRunning}
            onStart={startEval}
            onStop={stopEval}
            disabled={evalStatus === "blocked" || !installedEnvs.has(envType)}
            startLabel={<><Play size={13} className="fill-current" /> Start Eval</>}
            compact
          />
        </div>
      </StickyControlBar>
    </div>
  );
}
