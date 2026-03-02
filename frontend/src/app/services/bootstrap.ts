import { apiGet } from "./apiClient";
import {
  DEFAULT_SIDEBAR_SIGNALS,
  type DevicesResponse,
  type LeStudioConfig,
  type SidebarSignals,
} from "../store/types";

type BootstrapErrorKey =
  | "config"
  | "devices"
  | "depsStatus"
  | "hfWhoami"
  | "trainPreflight";

type DepsStatusResponse = {
  huggingface_cli?: boolean;
  rules_needs_root?: boolean;
  rules_needs_install?: boolean;
  rulesNeedsRoot?: boolean;
  rulesNeedsInstall?: boolean;
  [key: string]: unknown;
};

type HfWhoamiResponse = {
  ok?: boolean;
  username?: string | null;
  [key: string]: unknown;
};

type TrainPreflightResponse = {
  ok?: boolean;
  [key: string]: unknown;
};

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

  const direct = payload.config;
  if (isRecord(direct)) {
    return direct;
  }

  const dataNode = payload.data;
  if (isRecord(dataNode)) {
    const nested = dataNode.config;
    if (isRecord(nested)) {
      return nested;
    }
    return dataNode;
  }

  return payload;
}

function normalizeCameras(value: unknown): DevicesResponse["cameras"] {
  if (!Array.isArray(value)) return [];

  return value.map((camera, idx) => {
    if (typeof camera === "string") {
      return { device: camera };
    }

    if (!isRecord(camera)) {
      return { device: `camera-${idx + 1}` };
    }

    const device =
      (typeof camera.device === "string" && camera.device) ||
      (typeof camera.path === "string" && camera.path) ||
      `camera-${idx + 1}`;

    return {
      device,
      symlink: typeof camera.symlink === "string" ? camera.symlink : undefined,
      model: typeof camera.model === "string" ? camera.model : undefined,
    };
  });
}

function normalizeArms(value: unknown): DevicesResponse["arms"] {
  if (!Array.isArray(value)) return [];

  return value.map((arm, idx) => {
    if (typeof arm === "string") {
      return { device: arm };
    }

    if (!isRecord(arm)) {
      return { device: `arm-${idx + 1}` };
    }

    const device =
      (typeof arm.device === "string" && arm.device) ||
      (typeof arm.path === "string" && arm.path) ||
      `arm-${idx + 1}`;

    return {
      device,
      symlink: typeof arm.symlink === "string" ? arm.symlink : undefined,
    };
  });
}

function normalizeDevices(payload: unknown): DevicesResponse {
  if (!isRecord(payload)) {
    return { cameras: [], arms: [] };
  }

  const directDevices = isRecord(payload.devices) ? payload.devices : null;
  const nestedDevices = isRecord(payload.data) && isRecord(payload.data.devices) ? payload.data.devices : null;
  const devicesNode = directDevices ?? nestedDevices;

  if (devicesNode) {
    return {
      cameras: normalizeCameras(devicesNode.cameras),
      arms: normalizeArms(devicesNode.arms),
    };
  }

  if (isRecord(payload.data)) {
    return {
      cameras: normalizeCameras(payload.data.cameras),
      arms: normalizeArms(payload.data.arms),
    };
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
  const rulesNeedsRoot =
    parseBoolean(depsStatus?.rules_needs_root) === true || parseBoolean(depsStatus?.rulesNeedsRoot) === true;
  const rulesNeedsInstall =
    parseBoolean(depsStatus?.rules_needs_install) === true || parseBoolean(depsStatus?.rulesNeedsInstall) === true;

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
    apiGet<unknown>("/api/config"),
    apiGet<unknown>("/api/devices"),
    apiGet<unknown>("/api/deps/status"),
    apiGet<unknown>("/api/hf/whoami"),
    apiGet<unknown>("/api/train/preflight?device=cuda"),
  ]);

  const configPayload = configResult.status === "fulfilled" ? configResult.value : null;
  if (configResult.status === "rejected") {
    errors.config = String(configResult.reason ?? "failed to load config");
  }

  const devicesPayload = devicesResult.status === "fulfilled" ? devicesResult.value : null;
  if (devicesResult.status === "rejected") {
    errors.devices = String(devicesResult.reason ?? "failed to load devices");
  }

  const depsPayload = depsResult.status === "fulfilled" ? depsResult.value : null;
  if (depsResult.status === "rejected") {
    errors.depsStatus = String(depsResult.reason ?? "failed to load deps status");
  }

  const whoamiPayload = whoamiResult.status === "fulfilled" ? whoamiResult.value : null;
  if (whoamiResult.status === "rejected") {
    errors.hfWhoami = String(whoamiResult.reason ?? "failed to load hf identity");
  }

  const preflightPayload = preflightResult.status === "fulfilled" ? preflightResult.value : null;
  if (preflightResult.status === "rejected") {
    errors.trainPreflight = String(preflightResult.reason ?? "failed to run train preflight");
  }

  const config = normalizeConfig(configPayload);
  const devices = normalizeDevices(devicesPayload);
  const depsStatus = isRecord(depsPayload) ? (depsPayload as DepsStatusResponse) : null;
  const hfWhoami = isRecord(whoamiPayload) ? (whoamiPayload as HfWhoamiResponse) : null;
  const hfUsername = extractHfUsername(hfWhoami);
  const trainPreflightOk =
    isRecord(preflightPayload)
      ? parseBoolean((preflightPayload as TrainPreflightResponse).ok)
      : null;

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
