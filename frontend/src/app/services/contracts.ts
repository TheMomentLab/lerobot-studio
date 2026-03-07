import type { LeStudioConfig } from "../store/types";

type CameraMapping = { role: string; path: string };

type RecordLike = Record<string, unknown>;

export type PreflightCheck = {
  status: "ok" | "warn" | "error";
  label: string;
  msg: string;
};

export type PreflightResult = {
  ok: boolean;
  reason?: string;
  checks?: PreflightCheck[];
};

export type UiResourcesData = {
  cpu_percent: number;
  ram_used: number;
  ram_total: number;
  disk_used: number;
  disk_total: number;
  cache_size: number;
};

export type HistoryCategory = "eval" | "train" | "teleop" | "record" | "motor" | "other";

export type UiHistoryEntry = {
  type: string;
  ts: string;
  meta: string;
  summary: string;
  category: HistoryCategory;
};

export type UiLocalDataset = {
  id: string;
  episodes: number;
  frames: number;
  size: string;
  modified: string;
  tags?: string[];
};

export type UiHubDataset = {
  id: string;
  desc: string;
  downloads: number;
  likes: number;
  tags: string[];
  modified: string;
};

function asRecord(value: unknown): RecordLike | null {
  if (typeof value !== "object" || value === null) return null;
  return value as RecordLike;
}

function getString(source: RecordLike, key: string, fallback = ""): string {
  const value = source[key];
  return typeof value === "string" ? value : fallback;
}

function getNumber(source: RecordLike, key: string, fallback = 0): number {
  const value = source[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function getBoolean(source: RecordLike, key: string, fallback = false): boolean {
  const value = source[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return fallback;
}

function normalizeMode(modeLabel: string): "single" | "bi" {
  return /bi/i.test(modeLabel) ? "bi" : "single";
}

function normalizeSpeed(speedLabel: string): string {
  const cleaned = speedLabel.replace(/x$/i, "").trim();
  return cleaned || "0.5";
}

function cameraRecord(cameras: CameraMapping[]): Record<string, string> {
  const mapped: Record<string, string> = {};
  for (const camera of cameras) {
    if (!camera.role || !camera.path) continue;
    mapped[camera.role] = camera.path;
  }
  return mapped;
}

export function normalizeDeviceKey(deviceLabel: string): "cuda" | "cpu" | "mps" {
  const lower = deviceLabel.toLowerCase();
  if (lower.includes("mps")) return "mps";
  if (lower.includes("cpu")) return "cpu";
  return "cuda";
}

export function extractPreflightReason(preflight: PreflightResult): string {
  if (preflight.reason && preflight.reason.trim()) return preflight.reason;
  const checks = Array.isArray(preflight.checks) ? preflight.checks : [];

  const formatCheck = (check: PreflightCheck): string => {
    const normalizedLabel = check.label.trim().replace(/_/g, " ");
    const normalizedMsg = check.msg.trim();
    if (normalizedLabel && normalizedMsg) {
      const labelLower = normalizedLabel.toLowerCase();
      if (normalizedMsg.toLowerCase().includes(labelLower)) {
        return normalizedMsg;
      }
      return `${normalizedLabel}: ${normalizedMsg}`;
    }
    return normalizedMsg || normalizedLabel;
  };

  const errorMessages = checks.filter((check) => check.status === "error").map(formatCheck).filter(Boolean);
  if (errorMessages.length > 0) return errorMessages.join(" | ");

  const warnMessages = checks.filter((check) => check.status === "warn").map(formatCheck).filter(Boolean);
  if (warnMessages.length > 0) return warnMessages.join(" | ");

  return "preflight failed";
}

type BaseProcessPayload = {
  robot_mode: "single" | "bi";
  robot_type: string;
  teleop_type: string;
  follower_port: string;
  leader_port: string;
  robot_id: string;
  teleop_id: string;
  left_follower_port: string;
  right_follower_port: string;
  left_leader_port: string;
  right_leader_port: string;
  left_robot_id: string;
  right_robot_id: string;
  left_teleop_id: string;
  right_teleop_id: string;
  cameras: Record<string, string>;
};

function buildBaseProcessPayload(config: LeStudioConfig, modeLabel: string, cameras: CameraMapping[]): BaseProcessPayload {
  const cfg = asRecord(config) ?? {};
  return {
    robot_mode: normalizeMode(modeLabel),
    robot_type: getString(cfg, "robot_type", "so101_follower"),
    teleop_type: getString(cfg, "teleop_type", "so101_leader"),
    follower_port: getString(cfg, "follower_port", "/dev/follower_arm_1"),
    leader_port: getString(cfg, "leader_port", "/dev/leader_arm_1"),
    robot_id: getString(cfg, "robot_id", "follower_arm_1"),
    teleop_id: getString(cfg, "teleop_id", "leader_arm_1"),
    left_follower_port: getString(cfg, "left_follower_port", "/dev/follower_arm_1"),
    right_follower_port: getString(cfg, "right_follower_port", "/dev/follower_arm_2"),
    left_leader_port: getString(cfg, "left_leader_port", "/dev/leader_arm_1"),
    right_leader_port: getString(cfg, "right_leader_port", "/dev/leader_arm_2"),
    left_robot_id: getString(cfg, "left_robot_id", "follower_arm_1"),
    right_robot_id: getString(cfg, "right_robot_id", "follower_arm_2"),
    left_teleop_id: getString(cfg, "left_teleop_id", "leader_arm_1"),
    right_teleop_id: getString(cfg, "right_teleop_id", "leader_arm_2"),
    cameras: cameraRecord(cameras),
  };
}

export function toBackendTeleopPayload(input: {
  modeLabel: string;
  speedLabel: string;
  cameras: CameraMapping[];
  config: LeStudioConfig;
}): RecordLike {
  return {
    ...buildBaseProcessPayload(input.config, input.modeLabel, input.cameras),
    teleop_speed: normalizeSpeed(input.speedLabel),
  };
}

export function toBackendRecordPayload(input: {
  modeLabel: string;
  totalEpisodes: number;
  repoId: string;
  task: string;
  resume: boolean;
  pushToHub: boolean;
  datasetRoot?: string;
  cameras: CameraMapping[];
  config: LeStudioConfig;
}): RecordLike {
  const cfg = asRecord(input.config) ?? {};
  const payload: RecordLike = {
    ...buildBaseProcessPayload(input.config, input.modeLabel, input.cameras),
    record_repo_id: input.repoId || getString(cfg, "record_repo_id", "user/dataset"),
    record_episodes: Math.max(1, Math.floor(input.totalEpisodes || 1)),
    record_task: input.task || getString(cfg, "record_task", "task"),
    record_resume: input.resume,
    record_push_to_hub: input.pushToHub,
  };
  if (input.datasetRoot) {
    payload.record_dataset_root = input.datasetRoot;
  }
  return payload;
}

function mapPolicyLabelToTrainPolicy(policyLabel: string): string {
  const lower = policyLabel.toLowerCase();
  if (lower.includes("td-mpc") || lower.includes("tdmpc")) return "tdmpc2";
  if (lower.includes("diffusion")) return "diffusion";
  return "act";
}

export function toBackendTrainPayload(input: {
  policyLabel: string;
  datasetSource: "local" | "hf";
  localDatasetId: string | null;
  hfDatasetId: string | null;
  steps: number;
  deviceLabel: string;
  lr: string;
  outputRepo: string;
  batchSize: number;
  config: LeStudioConfig;
}): RecordLike {
  const cfg = asRecord(input.config) ?? {};
  const dataset = input.datasetSource === "local"
    ? (input.localDatasetId || getString(cfg, "train_repo_id", "user/dataset"))
    : (input.hfDatasetId || getString(cfg, "train_repo_id", "user/dataset"));

  const payload: RecordLike = {
    train_policy: mapPolicyLabelToTrainPolicy(input.policyLabel),
    train_repo_id: dataset,
    train_steps: Math.max(1, Math.floor(input.steps || 1)),
    train_device: normalizeDeviceKey(input.deviceLabel),
    train_dataset_source: input.datasetSource,
  };

  if (input.lr.trim()) payload.train_lr = input.lr.trim();
  if (input.outputRepo.trim()) payload.train_output_repo = input.outputRepo.trim();

  const batchSize = input.batchSize > 0 ? input.batchSize : getNumber(cfg, "train_batch_size", 0);
  if (batchSize > 0) payload.train_batch_size = batchSize;

  return payload;
}

export function toBackendEvalPayload(input: {
  envType: string;
  policyPath: string;
  datasetRepo: string;
  datasetOverride?: string;
  episodes: number;
  deviceLabel: string;
  task: string;
  cameraMapping: Record<string, string>;
  cameraCatalog: CameraMapping[];
  config: LeStudioConfig;
}): RecordLike {
  const cfg = asRecord(input.config) ?? {};
  const cameraByRole = new Map(input.cameraCatalog.map((camera) => [camera.role, camera.path]));
  const cameras: Record<string, string> = {};
  for (const [imageKey, role] of Object.entries(input.cameraMapping)) {
    if (!role) continue;
    const path = cameraByRole.get(role);
    if (!path) continue;
    cameras[imageKey] = path;
  }

  return {
    ...buildBaseProcessPayload(input.config, getString(cfg, "robot_mode", "single"), input.cameraCatalog),
    eval_env_type: input.envType,
    eval_policy_path: input.policyPath,
    eval_repo_id: input.datasetOverride?.trim() || input.datasetRepo,
    eval_episodes: Math.max(1, Math.floor(input.episodes || 1)),
    eval_device: normalizeDeviceKey(input.deviceLabel),
    eval_task: input.task,
    eval_robot_type: getString(cfg, "eval_robot_type", getString(cfg, "robot_type", "so101_follower")),
    eval_teleop_type: getString(cfg, "eval_teleop_type", getString(cfg, "teleop_type", "so101_leader")),
    cameras,
    record_cam_width: getNumber(cfg, "record_cam_width", 640),
    record_cam_height: getNumber(cfg, "record_cam_height", 480),
    record_cam_fps: getNumber(cfg, "record_cam_fps", 30),
  };
}

function toRoundedGbFromMb(valueMb: number): number {
  return Number((valueMb / 1024).toFixed(1));
}

export function fromBackendResources(payload: unknown): UiResourcesData {
  const raw = asRecord(payload) ?? {};
  const ramUsedMb = getNumber(raw, "ram_used_mb", Number.NaN);
  const ramTotalMb = getNumber(raw, "ram_total_mb", Number.NaN);
  const diskUsedGb = getNumber(raw, "disk_used_gb", Number.NaN);
  const diskTotalGb = getNumber(raw, "disk_total_gb", Number.NaN);

  return {
    cpu_percent: getNumber(raw, "cpu_percent", 0),
    ram_used: Number.isFinite(ramUsedMb) ? toRoundedGbFromMb(ramUsedMb) : getNumber(raw, "ram_used", 0),
    ram_total: Number.isFinite(ramTotalMb) ? toRoundedGbFromMb(ramTotalMb) : getNumber(raw, "ram_total", 0),
    disk_used: Number.isFinite(diskUsedGb) ? diskUsedGb : getNumber(raw, "disk_used", 0),
    disk_total: Number.isFinite(diskTotalGb) ? diskTotalGb : getNumber(raw, "disk_total", 0),
    cache_size: Number.isFinite(getNumber(raw, "lerobot_cache_mb", Number.NaN))
      ? toRoundedGbFromMb(getNumber(raw, "lerobot_cache_mb", 0))
      : getNumber(raw, "cache_size", 0),
  };
}

function formatHistoryMeta(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function classifyEvent(type: string): HistoryCategory {
  if (type.startsWith("eval")) return "eval";
  if (type.startsWith("train")) return "train";
  if (type.startsWith("teleop")) return "teleop";
  if (type.startsWith("record")) return "record";
  if (type.startsWith("motor") || type.startsWith("calibrat")) return "motor";
  return "other";
}

function extractShortPath(policyPath: string): string {
  // "outputs/train/2026-02-28/02-34-35_act/checkpoints/last/pretrained_model" → "act / last"
  const parts = policyPath.split("/");
  const cpIdx = parts.indexOf("checkpoints");
  if (cpIdx >= 1 && cpIdx + 1 < parts.length) {
    const trainDir = parts[cpIdx - 1] ?? "";
    const policyName = trainDir.replace(/^\d{2}-\d{2}-\d{2}_/, "");
    const checkpoint = parts[cpIdx + 1] ?? "";
    return `${policyName} / ${checkpoint}`;
  }
  // fallback: last 2 segments
  return parts.slice(-2).join("/");
}

function formatTimeOnly(ts: string): string {
  // "2026-02-28T11:09:42" → "11:09"
  const match = ts.match(/T?(\d{2}:\d{2})/);
  return match ? match[1] : ts;
}

function summarizeHistoryEntry(type: string, meta: string): string {
  const category = classifyEvent(type);
  const isEnd = type.endsWith("_end");

  // _end events with empty meta
  if (isEnd && (!meta || meta === "{}" || meta === "\"{}\"")) {
    const baseName = type.replace(/_end$/, "").replace(/_/g, " ");
    return `${baseName} finished`;
  }

  // Try to parse JSON meta
  let parsed: Record<string, unknown> | null = null;
  try {
    let raw = meta;
    // Handle double-encoded JSON strings
    if (raw.startsWith('"') && raw.endsWith('"')) {
      raw = JSON.parse(raw) as string;
    }
    const result = JSON.parse(raw);
    if (typeof result === "object" && result !== null) parsed = result as Record<string, unknown>;
  } catch { /* not JSON, use raw */ }

  if (!parsed) return meta || type.replace(/_/g, " ");

  switch (category) {
    case "eval": {
      const path = typeof parsed.policy_path === "string" ? extractShortPath(parsed.policy_path) : "";
      const device = typeof parsed.device === "string" ? parsed.device.toUpperCase() : "";
      return [path, device].filter(Boolean).join(" · ") || "eval started";
    }
    case "train": {
      const policy = typeof parsed.policy === "string" ? parsed.policy.toUpperCase() : "";
      const repo = typeof parsed.repo_id === "string" ? parsed.repo_id.split("/").pop() : "";
      const steps = typeof parsed.steps === "number" ? `${parsed.steps} steps` : "";
      const device = typeof parsed.device === "string" ? parsed.device.toUpperCase() : "";
      return [policy, repo, steps, device].filter(Boolean).join(" · ") || "train started";
    }
    case "record": {
      const repo = typeof parsed.repo_id === "string" ? parsed.repo_id.split("/").pop() : "";
      const task = typeof parsed.task === "string" ? parsed.task : "";
      return [repo, task].filter(Boolean).join(" · ") || "record started";
    }
    default:
      return meta;
  }
}

export function fromBackendHistory(payload: unknown): UiHistoryEntry[] {
  const root = asRecord(payload);
  const entries = root && Array.isArray(root.entries) ? root.entries : Array.isArray(payload) ? payload : [];

  return entries
    .map((entry) => {
      const item = asRecord(entry);
      if (!item) return null;
      const type = getString(item, "type", "unknown");
      const meta = formatHistoryMeta(item.meta);
      return {
        type,
        ts: String(item.ts ?? ""),
        meta,
        summary: summarizeHistoryEntry(type, meta),
        category: classifyEvent(type),
      };
    })
    .filter((item): item is UiHistoryEntry => item !== null);
}

function formatDatasetSize(sizeMb: number): string {
  if (!Number.isFinite(sizeMb) || sizeMb <= 0) return "0 MB";
  if (sizeMb >= 1024) return `${(sizeMb / 1024).toFixed(2)} GB`;
  return `${sizeMb.toFixed(1)} MB`;
}

export function fromBackendDatasetList(payload: unknown): UiLocalDataset[] {
  const root = asRecord(payload);
  const datasets = root && Array.isArray(root.datasets) ? root.datasets : [];

  const mapped: UiLocalDataset[] = [];
  for (const entry of datasets) {
    const item = asRecord(entry);
    if (!item) continue;

    const id = getString(item, "id", "");
    if (!id) continue;

    const episodes = getNumber(item, "total_episodes", getNumber(item, "episodes", 0));
    const frames = getNumber(item, "total_frames", getNumber(item, "frames", 0));
    const sizeText = typeof item.size === "string"
      ? item.size
      : formatDatasetSize(getNumber(item, "size_mb", 0));
    const tags = Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === "string") : [];

    mapped.push({
      id,
      episodes,
      frames,
      size: sizeText,
      modified: getString(item, "modified", ""),
      tags,
    });
  }

  return mapped;
}

export function buildHubSearchPath(query: string, limit = 20): string {
  const params = new URLSearchParams();
  params.set("query", query);
  params.set("limit", String(limit));
  params.set("tag", "lerobot");
  return `/api/hub/datasets/search?${params.toString()}`;
}

export function fromBackendHubSearch(payload: unknown): UiHubDataset[] {
  const root = asRecord(payload);
  const records = root && Array.isArray(root.datasets)
    ? root.datasets
    : root && Array.isArray(root.results)
      ? root.results
      : [];

  return records
    .map((entry) => {
      const item = asRecord(entry);
      if (!item) return null;
      return {
        id: getString(item, "id", ""),
        desc: getString(item, "desc", getString(item, "description", "")),
        downloads: getNumber(item, "downloads", 0),
        likes: getNumber(item, "likes", 0),
        tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === "string") : [],
        modified: getString(item, "modified", getString(item, "last_modified", "")),
      };
    })
    .filter((item): item is UiHubDataset => item !== null && item.id.length > 0);
}

export function normalizeCheckpointStep(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function parseBackendError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}

export function getConfigString(config: LeStudioConfig, key: string, fallback = ""): string {
  const cfg = asRecord(config) ?? {};
  return getString(cfg, key, fallback);
}

export function getConfigBool(config: LeStudioConfig, key: string, fallback = false): boolean {
  const cfg = asRecord(config) ?? {};
  return getBoolean(cfg, key, fallback);
}
