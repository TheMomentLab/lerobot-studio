type ProcessName = "teleop" | "record" | "calibrate" | "motor_setup" | "train" | "train_install" | "eval";

type PreflightCheck = {
  status: "ok" | "warn" | "error";
  label: string;
  msg: string;
};

type Checkpoint = {
  name: string;
  path: string;
  step: number;
};

type MockState = {
  config: Record<string, unknown>;
  processes: Record<ProcessName, boolean>;
  cudaInstalled: boolean;
  episodesDone: number;
  checkpoints: Checkpoint[];
  trainStep: number;
  trainTotalSteps: number;
  history: { type: string; ts: string; meta: string }[];
};

type TrainStatusState = "starting" | "running" | "stopped";

type TrainStatusFrame = {
  process: "train";
  state: TrainStatusState;
  reason?: string;
};

type TrainOutputFrame = {
  process: "train";
  level: "info" | "warn" | "error";
  line: string;
};

type TrainMetricFrame = {
  process: "train";
  step: number;
  totalSteps: number;
  loss: number;
};

type NonTrainProcessName = "teleop" | "record" | "calibrate" | "motor_setup" | "eval";

type NonTrainOutputFrame = {
  process: NonTrainProcessName;
  level: "info" | "warn" | "error";
  line: string;
};

export type TrainStatusEvent = {
  channel: "status";
  payload: TrainStatusFrame;
  seq: number;
  ts: number;
};

export type TrainOutputEvent = {
  channel: "output";
  payload: TrainOutputFrame;
  seq: number;
  ts: number;
};

export type TrainMetricEvent = {
  channel: "metric";
  payload: TrainMetricFrame;
  seq: number;
  ts: number;
};

export type NonTrainOutputEvent = {
  channel: "output";
  payload: NonTrainOutputFrame;
  seq: number;
  ts: number;
};

export type TrainStreamEvent = TrainStatusEvent | TrainOutputEvent | TrainMetricEvent;
export type TrainStreamChannel = TrainStreamEvent["channel"];

const state: MockState = {
  config: {
    robot_type: "so101_follower",
    robot_id: "my_robot",
    teleop_id: "my_teleop",
    robot_mode: "bi",
    record_repo_id: "lerobot-user/pick_cube",
    train_repo_id: "lerobot-user/pick_cube",
    policy: "act",
    training_steps: 50000,
    device: "cuda",
  },
  processes: {
    teleop: false,
    record: false,
    calibrate: false,
    motor_setup: false,
    train: false,
    train_install: false,
    eval: false,
  },
  cudaInstalled: true,
  episodesDone: 0,
  trainStep: 0,
  trainTotalSteps: 0,
  checkpoints: [
    { name: "checkpoint_010000", path: "outputs/train/act_pick_cube/checkpoints/010000", step: 10000 },
    { name: "checkpoint_025000", path: "outputs/train/act_pick_cube/checkpoints/025000", step: 25000 },
    { name: "last", path: "outputs/train/act_pick_cube/checkpoints/last", step: 25000 },
  ],
  history: [
    { type: "Calibration", ts: "2026-03-01 13:45", meta: "follower_arm — 6 motors" },
    { type: "Recording", ts: "2026-03-01 12:10", meta: "lerobot/pick_cube — 12 episodes" },
    { type: "Training", ts: "2026-03-01 10:00", meta: "ACT — 50K steps, loss: 0.0023" },
    { type: "Evaluation", ts: "2026-02-28 17:30", meta: "Success rate: 8/10" },
  ],
};

const statusListeners = new Set<(event: TrainStatusEvent) => void>();
const outputListeners = new Set<(event: TrainOutputEvent) => void>();
const metricListeners = new Set<(event: TrainMetricEvent) => void>();
const nonTrainOutputListeners: Record<NonTrainProcessName, Set<(event: NonTrainOutputEvent) => void>> = {
  teleop: new Set(),
  record: new Set(),
  calibrate: new Set(),
  motor_setup: new Set(),
  eval: new Set(),
};
let trainTimer: ReturnType<typeof setInterval> | null = null;
let trainStartTimeout: ReturnType<typeof setTimeout> | null = null;
let teleopTimer: ReturnType<typeof setInterval> | null = null;
let recordTimer: ReturnType<typeof setInterval> | null = null;
let calibrateTimer: ReturnType<typeof setInterval> | null = null;
let motorSetupTimer: ReturnType<typeof setInterval> | null = null;
let evalTimer: ReturnType<typeof setInterval> | null = null;
let trainEventSeq = 0;

const TRAIN_START_DELAY_MS = 1400;
const TRAIN_METRIC_INTERVAL_MS = 400;

function nextEventMeta(): { seq: number; ts: number } {
  trainEventSeq += 1;
  return {
    seq: trainEventSeq,
    ts: Date.now(),
  };
}

function emitStatus(state: TrainStatusState, reason?: string): void {
  const event: TrainStatusEvent = {
    channel: "status",
    payload: {
      process: "train",
      state,
      reason,
    },
    ...nextEventMeta(),
  };
  for (const listener of statusListeners) {
    listener(event);
  }
}

function emitOutput(line: string, level: TrainOutputFrame["level"]): void {
  const event: TrainOutputEvent = {
    channel: "output",
    payload: {
      process: "train",
      level,
      line,
    },
    ...nextEventMeta(),
  };
  for (const listener of outputListeners) {
    listener(event);
  }
}

function emitMetric(step: number, totalSteps: number, loss: number): void {
  const event: TrainMetricEvent = {
    channel: "metric",
    payload: {
      process: "train",
      step,
      totalSteps,
      loss,
    },
    ...nextEventMeta(),
  };
  for (const listener of metricListeners) {
    listener(event);
  }
}

function emitNonTrainOutput(processName: NonTrainProcessName, line: string, level: "info" | "warn" | "error"): void {
  const listeners = nonTrainOutputListeners[processName];
  if (!listeners || listeners.size === 0) return;

  const event: NonTrainOutputEvent = {
    channel: "output",
    payload: {
      process: processName,
      level,
      line,
    },
    ...nextEventMeta(),
  };

  for (const listener of listeners) {
    listener(event);
  }
}

function clearTimer(ref: ReturnType<typeof setInterval> | null): null {
  if (ref) {
    clearInterval(ref);
  }
  return null;
}

function stopNonTrainTimers(processName: NonTrainProcessName): void {
  if (processName === "teleop") teleopTimer = clearTimer(teleopTimer);
  if (processName === "record") recordTimer = clearTimer(recordTimer);
  if (processName === "calibrate") calibrateTimer = clearTimer(calibrateTimer);
  if (processName === "motor_setup") motorSetupTimer = clearTimer(motorSetupTimer);
  if (processName === "eval") evalTimer = clearTimer(evalTimer);
}

function stopTrainStream(emitStatusEvent = true, reason = "stopped by user"): void {
  const wasActive = state.processes.train || trainStartTimeout !== null || trainTimer !== null;

  if (trainStartTimeout) {
    clearTimeout(trainStartTimeout);
    trainStartTimeout = null;
  }
  if (trainTimer) {
    clearInterval(trainTimer);
    trainTimer = null;
  }
  state.processes.train = false;
  if (emitStatusEvent && wasActive) {
    emitOutput(reason, "warn");
    emitStatus("stopped", reason);
  }
}

function startTrainStream(totalSteps: number): void {
  stopTrainStream(false);
  state.processes.train = true;
  state.trainStep = 0;
  state.trainTotalSteps = totalSteps;
  emitOutput(`train preflight passed (steps=${totalSteps})`, "info");
  emitStatus("starting");

  trainStartTimeout = setTimeout(() => {
    trainStartTimeout = null;
    emitStatus("running");
    emitOutput("train loop started", "info");
    const stepDelta = Math.max(1, Math.round(totalSteps / 100));
    trainTimer = setInterval(() => {
      const nextStep = Math.min(totalSteps, state.trainStep + stepDelta);
      state.trainStep = nextStep;
      const i = nextStep / stepDelta;
      const loss = Math.max(0.00015, 0.18 * Math.exp(-i * 0.09) + (Math.random() - 0.5) * 0.004);

      emitMetric(nextStep, totalSteps, loss);

      const milestoneStep = stepDelta * 10;
      if (nextStep % milestoneStep === 0 || nextStep >= totalSteps) {
        emitOutput(`step=${nextStep}/${totalSteps} loss=${loss.toFixed(5)}`, "info");
      }

      if (nextStep >= totalSteps) {
        if (trainTimer) {
          clearInterval(trainTimer);
          trainTimer = null;
        }
        state.processes.train = false;
        emitOutput("training completed", "info");
        emitStatus("stopped", "completed");
      }
    }, TRAIN_METRIC_INTERVAL_MS);
  }, TRAIN_START_DELAY_MS);
}

export function subscribeTrainChannel(channel: "status", listener: (event: TrainStatusEvent) => void): () => void;
export function subscribeTrainChannel(channel: "output", listener: (event: TrainOutputEvent) => void): () => void;
export function subscribeTrainChannel(channel: "metric", listener: (event: TrainMetricEvent) => void): () => void;
export function subscribeTrainChannel(channel: TrainStreamChannel, listener: (event: TrainStreamEvent) => void): () => void {
  if (channel === "status") {
    const typed = listener as (event: TrainStatusEvent) => void;
    statusListeners.add(typed);
    return () => {
      statusListeners.delete(typed);
    };
  }

  if (channel === "output") {
    const typed = listener as (event: TrainOutputEvent) => void;
    outputListeners.add(typed);
    return () => {
      outputListeners.delete(typed);
    };
  }

  const typed = listener as (event: TrainMetricEvent) => void;
  metricListeners.add(typed);
  return () => {
    metricListeners.delete(typed);
  };
}

export function subscribeNonTrainChannel(
  processName: NonTrainProcessName,
  listener: (event: NonTrainOutputEvent) => void,
): () => void {
  const listeners = nonTrainOutputListeners[processName];
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getQuery(path: string): URLSearchParams {
  const url = new URL(path, "http://lestudio.local");
  return url.searchParams;
}

function getPathname(path: string): string {
  const url = new URL(path, "http://lestudio.local");
  return url.pathname;
}

function conflictProcess(exclude?: ProcessName): ProcessName | null {
  const keys: ProcessName[] = ["teleop", "record", "calibrate", "motor_setup", "train", "eval"];
  for (const key of keys) {
    if (key === exclude) continue;
    if (state.processes[key]) return key;
  }
  return null;
}

export async function handleMockGet(path: string): Promise<unknown> {
  const pathname = getPathname(path);
  const query = getQuery(path);

  if (pathname === "/api/config") {
    return state.config;
  }

  if (pathname === "/api/robots") {
    return {
      types: ["so101_follower", "so100_follower", "aloha"],
      details: {
        so101_follower: { capabilities: ["has_arms", "has_cameras"], compatible_teleops: ["so101_leader", "keyboard"] },
        so100_follower: { capabilities: ["has_arms"], compatible_teleops: ["so100_leader", "keyboard"] },
        aloha: { capabilities: ["has_arms", "has_cameras"], compatible_teleops: ["keyboard"] },
      },
    };
  }

  if (pathname === "/api/teleops") {
    const robotType = query.get("robot_type") ?? "";
    if (robotType === "so100_follower") return { types: ["so100_leader", "keyboard"] };
    return { types: ["so101_leader", "keyboard"] };
  }

  if (pathname === "/api/calibrate/list") {
    return {
      files: [
        { id: "follower_arm_1", guessed_type: "follower" },
        { id: "leader_arm_1", guessed_type: "leader" },
      ],
    };
  }

  if (pathname === "/api/camera/stats") {
    return {
      cameras: {
        top_cam_1: { fps: 29.8, mbps: 3.2 },
        wrist_cam_1: { fps: 30.0, mbps: 2.8 },
      },
    };
  }

  if (pathname === "/api/devices") {
    return {
      cameras: [
        { device: "video0", symlink: "top_cam_1", path: "/dev/video0", kernels: "3-1.2:1.0", model: "C920 HD Pro" },
        { device: "video2", symlink: "wrist_cam_1", path: "/dev/video2", kernels: "3-1.3:1.0", model: "C270 HD" },
        { device: "video4", symlink: null, path: "/dev/video4", kernels: "3-1.4:1.0", model: "Unknown" },
      ],
      arms: [
        { device: "ttyUSB0", symlink: "follower_arm_1", path: "/dev/ttyUSB0", serial: "AX12-0047" },
        { device: "ttyUSB1", symlink: "leader_arm_1", path: "/dev/ttyUSB1", serial: "AX12-0048" },
      ],
    };
  }

  if (pathname === "/api/system/resources") {
    return {
      cpu_percent: 42,
      ram_used: 11.2,
      ram_total: 32,
      disk_used: 187,
      disk_total: 512,
      cache_size: 4.3,
    };
  }

  if (pathname === "/api/history") {
    return { ok: true, entries: state.history };
  }

  if (pathname === "/api/datasets") {
    return {
      datasets: [
        { id: "lerobot-user/pick_cube", episodes: 52, frames: 3640, size: "1.2 GB", modified: "2026-03-01 14:30", tags: ["top_cam_1", "wrist_cam_1"] },
        { id: "lerobot-user/place_cup", episodes: 30, frames: 2100, size: "720 MB", modified: "2026-02-28 16:00", tags: ["top_cam_1", "wrist_cam_1"] },
        { id: "lerobot-user/stack_blocks", episodes: 15, frames: 900, size: "340 MB", modified: "2026-02-25 11:20", tags: ["top_cam_1"] },
      ],
    };
  }

  if (pathname === "/api/eval/env-types") {
    return {
      envs: [
        { type: "gym_pusht", label: "PushT", module: "gym_pusht", installed: true, description: "2D 물체 밀기 태스크" },
        { type: "gym_aloha", label: "Aloha", module: "gym_aloha", installed: false, description: "양팔 로봇 시뮬레이션" },
        { type: "gym_xarm", label: "xArm", module: "gym_xarm", installed: false, description: "xArm 로봇 시뮬레이션" },
        { type: "gym_manipulator", label: "Real Robot", module: "gym_manipulator", installed: true, description: "실제 로봇 평가" },
      ],
    };
  }

  if (pathname === "/api/hub/datasets/search") {
    const q = (query.get("q") ?? "").toLowerCase();
    const all = [
      { id: "lerobot/pick_cube_aloha", desc: "Pick and place tasks with Aloha", downloads: 1240, likes: 87, tags: ["manipulation", "aloha"], modified: "2026-02-20" },
      { id: "lerobot/aloha_mobile", desc: "Mobile manipulation dataset", downloads: 890, likes: 65, tags: ["manipulation", "mobile"], modified: "2026-02-18" },
      { id: "danaaubakirova/lerobot_push", desc: "Push task recordings", downloads: 210, likes: 14, tags: ["push", "so100"], modified: "2026-02-12" },
    ];
    const filtered = q ? all.filter((d) => d.id.includes(q) || d.desc.toLowerCase().includes(q)) : all;
    return { ok: true, results: filtered };
  }

  if (pathname === "/api/gpu/status") {
    return {
      exists: true,
      utilization: state.processes.train ? 78 : 12,
      memory_used: state.processes.train ? 12288 : 2048,
      memory_total: 24576,
      memory_percent: state.processes.train ? 50 : 8,
    };
  }

  if (pathname === "/api/checkpoints") {
    return {
      ok: true,
      checkpoints: state.checkpoints,
    };
  }

  if (pathname === "/api/train/preflight") {
    const device = (query.get("device") ?? "CUDA (GPU)").toLowerCase();
    if (device.includes("cuda") && !state.cudaInstalled) {
      return {
        ok: false,
        reason: "CUDA preflight failed: CUDA PyTorch is not installed",
        action: "install_pytorch",
      };
    }
    return {
      ok: true,
      reason: "",
      action: null,
    };
  }

  if (pathname === "/api/train/colab/link") {
    return {
      ok: true,
      url: "https://colab.research.google.com/",
      session_limit_note: "Colab free-tier sessions may disconnect",
    };
  }

  if (pathname.startsWith("/api/camera/snapshot/")) {
    const camName = pathname.split("/").pop() ?? "";
    return {
      ok: true,
      camera: camName,
      width: 640,
      height: 480,
      format: "jpeg",
      data: `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect fill="%23222" width="640" height="480"/><text x="320" y="240" text-anchor="middle" fill="%23888" font-size="24">${camName} (mock)</text></svg>`,
    };
  }

  if (pathname === "/api/deps/status") {
    return { huggingface_cli: true };
  }

  if (pathname === "/api/hf/whoami") {
    return { ok: true, username: "lerobot-user" };
  }

  return { ok: false, error: `Unknown GET endpoint: ${pathname}` };
}

export async function handleMockPost(path: string, body?: unknown): Promise<unknown> {
  const pathname = getPathname(path);

  if (pathname === "/api/config") {
    const nextConfig = (body ?? {}) as Record<string, unknown>;
    state.config = { ...state.config, ...nextConfig };
    return state.config;
  }

  if (pathname === "/api/preflight") {
    const payload = (body ?? {}) as Record<string, unknown>;
    const process = String(payload.process ?? "");
    const checks: PreflightCheck[] = [];
    const conflicting = conflictProcess(process === "teleop" || process === "record" || process === "train" ? (process as ProcessName) : undefined);

    if (conflicting) {
      checks.push({ status: "error", label: "process", msg: `${conflicting} process is already running` });
    } else {
      checks.push({ status: "ok", label: "process", msg: "no conflict" });
    }

    if (process === "train") {
      const device = String(payload.device ?? "cuda").toLowerCase();
      if (device.includes("cuda") && !state.cudaInstalled) {
        checks.push({ status: "error", label: "cuda", msg: "CUDA runtime not available" });
      } else {
        checks.push({ status: "ok", label: "cuda", msg: "device ready" });
      }
    }

    const hasError = checks.some((check) => check.status === "error");
    return {
      ok: !hasError,
      checks,
      reason: hasError ? checks.find((check) => check.status === "error")?.msg ?? "preflight failed" : "",
    };
  }

  if (pathname === "/api/camera/check_paths") {
    const payload = (body ?? {}) as { paths?: string[] };
    const result: Record<string, boolean> = {};
    for (const p of payload.paths ?? []) {
      result[p] = p.startsWith("/dev/");
    }
    return result;
  }

  if (pathname === "/api/teleop/start") {
    const conflicting = conflictProcess("teleop");
    if (conflicting) return { ok: false, error: `${conflicting} is running` };
    state.processes.teleop = true;
    stopNonTrainTimers("teleop");
    emitNonTrainOutput("teleop", "teleop preflight passed", "info");
    emitNonTrainOutput("teleop", "teleop loop started", "info");
    teleopTimer = setInterval(() => {
      if (!state.processes.teleop) return;
      emitNonTrainOutput("teleop", `teleop loop ${10 + Math.floor(Math.random() * 8)}ms`, "info");
    }, 1800);
    return { ok: true };
  }

  if (pathname === "/api/record/start") {
    const conflicting = conflictProcess("record");
    if (conflicting) return { ok: false, error: `${conflicting} is running` };
    state.processes.record = true;
    state.episodesDone = 0;
    stopNonTrainTimers("record");
    emitNonTrainOutput("record", "record preflight passed", "info");
    emitNonTrainOutput("record", "recording started", "info");
    recordTimer = setInterval(() => {
      if (!state.processes.record) return;
      emitNonTrainOutput("record", `episode ${state.episodesDone + 1} recording...`, "info");
    }, 2000);
    return { ok: true, episode: state.episodesDone };
  }

  if (pathname === "/api/calibrate/start") {
    const conflicting = conflictProcess("calibrate");
    if (conflicting) return { ok: false, error: `${conflicting} is running` };
    state.processes.calibrate = true;
    stopNonTrainTimers("calibrate");
    emitNonTrainOutput("calibrate", "calibration started", "info");
    calibrateTimer = setInterval(() => {
      if (!state.processes.calibrate) return;
      emitNonTrainOutput("calibrate", "checking motor ranges...", "info");
    }, 2200);
    return { ok: true };
  }

  if (pathname === "/api/motor_setup/start") {
    const conflicting = conflictProcess("motor_setup");
    if (conflicting) return { ok: false, error: `${conflicting} is running` };
    state.processes.motor_setup = true;
    stopNonTrainTimers("motor_setup");
    emitNonTrainOutput("motor_setup", "motor setup started", "info");
    motorSetupTimer = setInterval(() => {
      if (!state.processes.motor_setup) return;
      emitNonTrainOutput("motor_setup", "waiting for next motor connection...", "info");
    }, 2400);
    return { ok: true };
  }

  if (pathname === "/api/train/start") {
    const payload = (body ?? {}) as Record<string, unknown>;
    const device = String(payload.device ?? payload.train_device ?? "cuda").toLowerCase();
    const totalStepsRaw = payload.customSteps ?? payload.train_steps ?? 50000;
    const totalSteps = Math.max(1, Number(totalStepsRaw));
    if (device.includes("cuda") && !state.cudaInstalled) {
      return { ok: false, error: "CUDA preflight failed", auto_install_started: false };
    }
    const conflicting = conflictProcess("train");
    if (conflicting) return { ok: false, error: `${conflicting} is running` };
    startTrainStream(totalSteps);
    return { ok: true };
  }

  if (pathname === "/api/train/install_pytorch") {
    state.processes.train_install = true;
    state.cudaInstalled = true;
    state.processes.train_install = false;
    return { ok: true };
  }

  if (pathname === "/api/train/install_torchcodec_fix") {
    return { ok: true };
  }

  if (pathname === "/api/train/colab/config") {
    return {
      ok: true,
      repo_id: "lerobot-user/mock-train-config",
      config_path: "lestudio_train_config.json",
      colab_link: "https://colab.research.google.com/",
      manual_run_required: true,
    };
  }

  if (pathname === "/api/eval/start") {
    const conflicting = conflictProcess("eval" as ProcessName);
    if (conflicting) return { ok: false, error: `${conflicting} is running` };
    state.processes.eval = true;
    stopNonTrainTimers("eval");
    emitNonTrainOutput("eval", "evaluation started", "info");
    emitNonTrainOutput("eval", "episode 0 / 10", "info");
    evalTimer = setInterval(() => {
      if (!state.processes.eval) return;
      const done = Math.max(1, Math.min(10, Math.floor(Math.random() * 10) + 1));
      const reward = (0.3 + Math.random() * 0.6).toFixed(3);
      emitNonTrainOutput("eval", `episode ${done} / 10 reward=${reward}`, "info");
    }, 2600);
    return { ok: true };
  }

  if (pathname === "/api/history/clear") {
    state.history = [];
    return { ok: true };
  }

  if (pathname === "/api/process/record/input") {
    const payload = (body ?? {}) as { text?: string };
    const text = String(payload.text ?? "");
    if (text === "right") {
      state.episodesDone += 1;
      emitNonTrainOutput("record", `saved episode ${state.episodesDone}`, "info");
      return { ok: true, currentEp: state.episodesDone, event: `saved episode ${state.episodesDone}` };
    }
    if (text === "left") {
      emitNonTrainOutput("record", `discarded episode ${state.episodesDone}`, "warn");
      return { ok: true, currentEp: state.episodesDone, event: `discarded episode ${state.episodesDone}` };
    }
    if (text === "escape") {
      state.processes.record = false;
      stopNonTrainTimers("record");
      emitNonTrainOutput("record", "recording ended", "info");
      return { ok: true, currentEp: state.episodesDone, event: "recording ended" };
    }
    return { ok: false, error: `Unknown input: ${text}` };
  }

  if (pathname.startsWith("/api/process/") && pathname.endsWith("/command")) {
    const parts = pathname.split("/");
    const name = parts[3] as ProcessName;
    const payload = (body ?? {}) as { command?: string };
    const command = String(payload.command ?? "");
    if (!(name in state.processes)) {
      return { ok: false, error: `Unknown process: ${name}` };
    }
    if (name !== "train" && name !== "train_install") {
      emitNonTrainOutput(name as NonTrainProcessName, `$ ${command}`, "info");
    }
    return { ok: true, command };
  }

  if (pathname.startsWith("/api/process/") && pathname.endsWith("/stop")) {
    const parts = pathname.split("/");
    const name = parts[3] as ProcessName;
    if (name in state.processes) {
      if (name === "train") {
        stopTrainStream();
        return { ok: true };
      }
      state.processes[name] = false;
      if (name !== "train_install") {
        stopNonTrainTimers(name as NonTrainProcessName);
        emitNonTrainOutput(name as NonTrainProcessName, "process stopped", "warn");
      }
      return { ok: true };
    }
    return { ok: false, error: `Unknown process: ${name}` };
  }

  return { ok: false, error: `Unknown POST endpoint: ${pathname}` };
}
