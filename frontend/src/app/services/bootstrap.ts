import { apiGet } from "./apiClient";
import {
  DEFAULT_SIDEBAR_SIGNALS,
  type DepsStatusResponse,
  type DevicesResponse,
  type HfWhoamiResponse,
  type LeStudioConfig,
  type SidebarSignals,
  type TrainPreflightResponse,
} from "../store/types";

type BootstrapErrorKey =
  | "config"
  | "devices"
  | "depsStatus"
  | "hfWhoami"
  | "trainPreflight";

export type BootstrapResult = {
  config: LeStudioConfig;
  devices: DevicesResponse;
  sidebarSignals: SidebarSignals;
  hfUsername: string | null;
  prefillPatch: Partial<LeStudioConfig>;
  raw: {
    depsStatus: DepsStatusResponse | null;
    hfWhoami: HfWhoamiResponse | null;
    trainPreflightOk: boolean | null;
  };
  errors: Partial<Record<BootstrapErrorKey, string>>;
};

const PREFILL_KEYS = ["record_repo_id", "train_repo_id", "dataset_repo_id"] as const;
const DEFAULT_REPO_PREFIX_RE = /^user\//;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }
  if (typeof value !== "string") return null;
  const lowered = value.trim().toLowerCase();
  if (lowered === "true" || lowered === "1" || lowered === "yes") return true;
  if (lowered === "false" || lowered === "0" || lowered === "no") return false;
  return null;
}

function normalizeConfig(payload: unknown): LeStudioConfig {
  if (!isRecord(payload)) return {};
  return payload;
}

function normalizeCameras(value: unknown): DevicesResponse["cameras"] {
  if (!Array.isArray(value)) return [];

  return value.filter(isRecord).map((cam) => ({
    device: typeof cam.device === "string" ? cam.device : "",
    path: typeof cam.path === "string" ? cam.path : undefined,
    kernels: typeof cam.kernels === "string" ? cam.kernels : undefined,
    symlink: typeof cam.symlink === "string" ? cam.symlink : undefined,
    model: typeof cam.model === "string" ? cam.model : undefined,
  }));
}

function normalizeArms(value: unknown): DevicesResponse["arms"] {
  if (!Array.isArray(value)) return [];

  return value.filter(isRecord).map((arm) => ({
    device: typeof arm.device === "string" ? arm.device : "",
    path: typeof arm.path === "string" ? arm.path : undefined,
    symlink: typeof arm.symlink === "string" ? arm.symlink : undefined,
    serial: typeof arm.serial === "string" ? arm.serial : undefined,
    kernels: typeof arm.kernels === "string" ? arm.kernels : undefined,
  }));
}

function normalizeDevices(payload: unknown): DevicesResponse {
  if (!isRecord(payload)) {
    return { cameras: [], arms: [] };
  }

  return {
    cameras: normalizeCameras(payload.cameras),
    arms: normalizeArms(payload.arms),
  };
}

function extractHfUsername(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  if (payload.ok === false) return null;
  return typeof payload.username === "string" && payload.username.trim() ? payload.username : null;
}

function deriveSidebarSignals(
  depsStatus: DepsStatusResponse | null,
  devices: DevicesResponse,
  trainPreflightOk: boolean | null,
): SidebarSignals {
  const huggingfaceCli = parseBoolean(depsStatus?.huggingface_cli);
  const huggingfaceCliOk = huggingfaceCli !== false;
  const rulesNeedsRoot = parseBoolean(depsStatus?.rules_needs_root) === true;
  const rulesNeedsInstall = parseBoolean(depsStatus?.rules_needs_install) === true;

  return {
    ...DEFAULT_SIDEBAR_SIGNALS,
    hasCameras: devices.cameras.length > 0,
    hasArms: devices.arms.length > 0,
    datasetMissingDep: !huggingfaceCliOk,
    trainMissingDep: trainPreflightOk === false,
    rulesNeedsRoot,
    rulesNeedsInstall,
  };
}

export function buildRepoPrefillPatch(
  config: LeStudioConfig,
  username: string | null,
): Partial<LeStudioConfig> {
  if (!username) return {};

  const patch: Partial<LeStudioConfig> = {};
  for (const key of PREFILL_KEYS) {
    const value = config[key];
    if (typeof value !== "string") continue;
    if (!DEFAULT_REPO_PREFIX_RE.test(value)) continue;
    patch[key] = value.replace("user/", `${username}/`);
  }
  return patch;
}

export function withPrefilledRepoIds(config: LeStudioConfig, username: string | null): LeStudioConfig {
  const patch = buildRepoPrefillPatch(config, username);
  if (Object.keys(patch).length === 0) return config;
  return { ...config, ...patch };
}

export async function runBootstrap(): Promise<BootstrapResult> {
  const errors: Partial<Record<BootstrapErrorKey, string>> = {};

  const [
    configResult,
    devicesResult,
    depsResult,
    whoamiResult,
    preflightResult,
  ] = await Promise.allSettled([
    apiGet<LeStudioConfig>("/api/config"),
    apiGet<DevicesResponse>("/api/devices"),
    apiGet<DepsStatusResponse>("/api/deps/status"),
    apiGet<HfWhoamiResponse>("/api/hf/whoami"),
    apiGet<TrainPreflightResponse>("/api/train/preflight?device=cuda"),
  ]);

  if (configResult.status === "rejected") {
    errors.config = String(configResult.reason ?? "failed to load config");
  }

  if (devicesResult.status === "rejected") {
    errors.devices = String(devicesResult.reason ?? "failed to load devices");
  }

  if (depsResult.status === "rejected") {
    errors.depsStatus = String(depsResult.reason ?? "failed to load deps status");
  }

  if (whoamiResult.status === "rejected") {
    errors.hfWhoami = String(whoamiResult.reason ?? "failed to load hf identity");
  }

  if (preflightResult.status === "rejected") {
    errors.trainPreflight = String(preflightResult.reason ?? "failed to run train preflight");
  }

  const config = normalizeConfig(configResult.status === "fulfilled" ? configResult.value : null);
  const devices = normalizeDevices(devicesResult.status === "fulfilled" ? devicesResult.value : null);
  const depsStatus = depsResult.status === "fulfilled" ? depsResult.value : null;
  const hfWhoami = whoamiResult.status === "fulfilled" ? whoamiResult.value : null;
  const hfUsername = extractHfUsername(hfWhoami);
  const trainPreflightOk =
    preflightResult.status === "fulfilled" ? (preflightResult.value.ok ?? null) : null;

  const prefillPatch = buildRepoPrefillPatch(config, hfUsername);
  const sidebarSignals = deriveSidebarSignals(depsStatus, devices, trainPreflightOk);

  return {
    config,
    devices,
    sidebarSignals,
    hfUsername,
    prefillPatch,
    raw: {
      depsStatus,
      hfWhoami,
      trainPreflightOk,
    },
    errors,
  };
}
