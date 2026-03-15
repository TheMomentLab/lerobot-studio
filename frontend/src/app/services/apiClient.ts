import {
  handleMockGet,
  handleMockDelete,
  handleMockPost,
  subscribeNonTrainChannel as subscribeMockNonTrainChannel,
  subscribeTrainChannel as subscribeMockTrainChannel,
} from "../../mock-api/handlers";
import type {
  NonTrainOutputEvent,
  TrainMetricEvent,
  TrainOutputEvent,
  TrainStatusEvent,
  TrainStreamChannel,
  TrainStreamEvent,
} from "../../mock-api/handlers";
import type { DevicesResponse } from "../store/types";
import { getLeStudioState, setLeStudioState } from "../store";
import { notifyInfo } from "./notifications";
import {
  clearStoredSessionToken,
  readStoredSessionToken,
  resolveApiOrigin,
  SESSION_TOKEN_HEADER,
  shouldPromptForSessionToken,
  writeStoredSessionToken,
} from "./sessionToken";

const NETWORK_DELAY_MS = 120;
const TRANSPORT_STORAGE_KEY = "wireframe-api-transport-mode";

type TransportMode = "mock" | "passthrough";
type NonTrainProcessName = "teleop" | "record" | "calibrate" | "motor_setup" | "eval";

const NON_TRAIN_PROCESS_NAMES: ReadonlySet<NonTrainProcessName> = new Set([
  "teleop",
  "record",
  "calibrate",
  "motor_setup",
  "eval",
]);

let transportMode: TransportMode = readInitialTransportMode();

type WsListenerMap = {
  status: Set<(event: TrainStatusEvent) => void>;
  output: Set<(event: TrainOutputEvent) => void>;
  metric: Set<(event: TrainMetricEvent) => void>;
};

const wsListeners: WsListenerMap = {
  status: new Set(),
  output: new Set(),
  metric: new Set(),
};

const wsNonTrainListeners: Record<NonTrainProcessName, Set<(event: NonTrainOutputEvent) => void>> = {
  teleop: new Set(),
  record: new Set(),
  calibrate: new Set(),
  motor_setup: new Set(),
  eval: new Set(),
};

let wsSocket: WebSocket | null = null;
let wsEventSeq = 0;
let wsTrainRunning: boolean | null = null;
let lastKnownTotalSteps = 0;
let lastDeviceGeneration = -1;
let deviceRefreshInFlight = false;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function readInitialTransportMode(): TransportMode {
  const envRaw = String(import.meta.env.VITE_API_TRANSPORT_MODE ?? "passthrough").toLowerCase();
  const envMode: TransportMode = envRaw === "passthrough" ? "passthrough" : "mock";

  if (typeof window === "undefined") {
    return envMode;
  }

  const storedRaw = window.localStorage.getItem(TRANSPORT_STORAGE_KEY);
  if (storedRaw === "mock" || storedRaw === "passthrough") {
    return storedRaw;
  }

  return envMode;
}

function getApiBaseUrl(): string {
  const raw = String(import.meta.env.VITE_API_BASE_URL ?? "").trim();
  return raw;
}

function getWsBaseUrl(): string {
  const explicit = String(import.meta.env.VITE_WS_BASE_URL ?? "").trim();
  if (explicit) {
    return explicit;
  }

  const apiBase = getApiBaseUrl();
  if (apiBase) {
    if (apiBase.startsWith("https://")) return apiBase.replace("https://", "wss://");
    if (apiBase.startsWith("http://")) return apiBase.replace("http://", "ws://");
  }

  if (typeof window !== "undefined") {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}`;
  }

  return "";
}

function buildApiUrl(path: string): string {
  const base = getApiBaseUrl();
  if (!base) {
    return path;
  }
  const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

function getResolvedApiOrigin(): string {
  const windowOrigin = typeof window === "undefined" ? "" : window.location.origin;
  return resolveApiOrigin(getApiBaseUrl(), windowOrigin);
}

function promptForSessionToken(currentToken = ""): string {
  if (typeof window === "undefined") {
    return "";
  }

  const apiOrigin = getResolvedApiOrigin();
  const entered = window.prompt(
    "Remote LeStudio changes require the session token printed by the server. Paste it to continue, or save it from the header Remote badge.",
    currentToken,
  );
  const normalized = typeof entered === "string" ? entered.trim() : "";
  if (!normalized) {
    clearStoredSessionToken(apiOrigin, window.localStorage);
    return "";
  }

  writeStoredSessionToken(apiOrigin, normalized, window.localStorage);
  notifyInfo("Saved LeStudio session token for this server.");
  return normalized;
}

async function sendPassthroughMutation(
  path: string,
  method: "POST" | "DELETE",
  body: unknown,
  token: string,
): Promise<Response> {
  const headers = new Headers();
  if (method === "POST") {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set(SESSION_TOKEN_HEADER, token);
  }

  return fetch(buildApiUrl(path), {
    method,
    headers,
    ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
  });
}

async function passthroughGet<T>(path: string): Promise<T> {
  const response = await fetch(buildApiUrl(path), { method: "GET" });
  const data = await response.json();
  return data as T;
}

async function passthroughPost<T>(path: string, body?: unknown): Promise<T> {
  const apiOrigin = getResolvedApiOrigin();
  let token = typeof window === "undefined" ? "" : readStoredSessionToken(apiOrigin, window.localStorage);
  let promptedForMissingToken = false;

  if (typeof window !== "undefined" && shouldPromptForSessionToken(apiOrigin, token)) {
    promptedForMissingToken = true;
    token = promptForSessionToken(token);
  }

  let response = await sendPassthroughMutation(path, "POST", body, token);
  if (response.status === 401 && typeof window !== "undefined" && !promptedForMissingToken) {
    clearStoredSessionToken(apiOrigin, window.localStorage);
    const retryToken = promptForSessionToken("");
    if (retryToken) {
      response = await sendPassthroughMutation(path, "POST", body, retryToken);
    }
  }

  const data = await response.json();
  return data as T;
}

async function passthroughDelete<T>(path: string): Promise<T> {
  const apiOrigin = getResolvedApiOrigin();
  let token = typeof window === "undefined" ? "" : readStoredSessionToken(apiOrigin, window.localStorage);
  let promptedForMissingToken = false;

  if (typeof window !== "undefined" && shouldPromptForSessionToken(apiOrigin, token)) {
    promptedForMissingToken = true;
    token = promptForSessionToken(token);
  }

  let response = await sendPassthroughMutation(path, "DELETE", undefined, token);
  if (response.status === 401 && typeof window !== "undefined" && !promptedForMissingToken) {
    clearStoredSessionToken(apiOrigin, window.localStorage);
    const retryToken = promptForSessionToken("");
    if (retryToken) {
      response = await sendPassthroughMutation(path, "DELETE", undefined, retryToken);
    }
  }

  const data = await response.json();
  return data as T;
}

export function getTransportMode(): TransportMode {
  return transportMode;
}

export function setTransportMode(mode: TransportMode): void {
  transportMode = mode;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(TRANSPORT_STORAGE_KEY, mode);
  }

  if (mode === "mock") {
    disconnectTrainSocket();
  }
}

function handleGlobalWsEvents(data: unknown): void {
  if (typeof data !== "string") return;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(data) as Record<string, unknown>;
  } catch {
    return;
  }
  if (!obj || typeof obj !== "object") return;

  if (obj.type === "api_health" && typeof obj.key === "string" && typeof obj.value === "boolean") {
    setLeStudioState((prev) => ({ apiHealth: { ...prev.apiHealth, [obj.key as string]: obj.value as boolean } }));
  }

  if (obj.type === "api_support" && typeof obj.key === "string" && typeof obj.value === "boolean") {
    setLeStudioState((prev) => {
      const next = { ...prev.apiSupport, [obj.key as string]: obj.value as boolean };
      const healthPatch: Record<string, boolean> = {};
      if (obj.value) {
        healthPatch[obj.key as string] = true;
      }
      return {
        apiSupport: next,
        apiHealth: { ...prev.apiHealth, ...healthPatch },
      };
    });
  }

  if (obj.type === "output" && typeof obj.process === "string") {
    const processName = obj.process;
    if (processName !== "train" && processName !== "train_install") {
      const line =
        typeof obj.text === "string"
          ? obj.text
          : typeof obj.line === "string"
            ? obj.line
            : "";
      if (line) {
        const level = normalizeOutputLevel(obj.kind, line);
        if (NON_TRAIN_PROCESS_NAMES.has(processName as NonTrainProcessName)) {
          const nonTrainProcess = processName as NonTrainProcessName;
          const listeners = wsNonTrainListeners[nonTrainProcess];
          const replace = typeof obj.replace === "string" ? obj.replace : undefined;
          const event: NonTrainOutputEvent = {
            channel: "output",
            payload: {
              process: nonTrainProcess,
              level,
              line,
              ...(replace ? { replace } : {}),
            },
            ...nextWsMeta(),
          };
          if (listeners.size > 0) {
            for (const listener of listeners) {
              listener(event);
            }
          } else {
            const kind = level === "info" ? "stdout" : level;
            getLeStudioState().appendLog(processName, line, kind, replace);
          }
        } else {
          const kind = level === "info" ? "stdout" : level;
          getLeStudioState().appendLog(processName, line, kind);
        }
      }
    }
  }

  if (obj.type === "status" && obj.processes && typeof obj.processes === "object") {
    const processes = obj.processes as Record<string, boolean>;
    setLeStudioState({ procStatus: processes });
    // Clear reconnected flag for processes that are no longer running
    const prev = getLeStudioState().procReconnected;
    if (Object.keys(prev).length > 0) {
      const cleaned = { ...prev };
      let changed = false;
      for (const [name, isRunning] of Object.entries(processes)) {
        if (!isRunning && name in cleaned) {
          delete cleaned[name];
          changed = true;
        }
      }
      if (changed) setLeStudioState({ procReconnected: cleaned });
    }

    if (typeof obj.device_generation === "number" && obj.device_generation !== lastDeviceGeneration) {
      lastDeviceGeneration = obj.device_generation;
      if (!deviceRefreshInFlight) {
        deviceRefreshInFlight = true;
        apiGet<Partial<DevicesResponse>>("/api/devices")
          .then((data) => {
            setLeStudioState({
              devices: {
                cameras: Array.isArray(data.cameras) ? data.cameras : [],
                arms: Array.isArray(data.arms) ? data.arms : [],
              },
            });
          })
          .catch(() => {})
          .finally(() => {
            deviceRefreshInFlight = false;
          });
      }
    }
  }
}

function connectTrainSocketIfNeeded(): void {
  if (transportMode !== "passthrough") return;
  if (typeof window === "undefined") return;
  if (wsSocket) return;

  const wsBase = getWsBaseUrl();
  if (!wsBase) return;
  const normalizedBase = wsBase.endsWith("/") ? wsBase.slice(0, -1) : wsBase;
  const socketUrl = `${normalizedBase}/ws`;

  try {
    wsSocket = new WebSocket(socketUrl);
  } catch {
    wsSocket = null;
    return;
  }

  wsSocket.onopen = () => {
    setLeStudioState({ wsReady: true });
  };

  wsSocket.onclose = () => {
    wsSocket = null;
    wsTrainRunning = null;
    setLeStudioState({ wsReady: false });
  };

  wsSocket.onerror = () => {
    setLeStudioState({ wsReady: false });
  };

  wsSocket.onmessage = (ev) => {
    handleGlobalWsEvents(ev.data);

    const parsed = parseTrainStreamEvents(ev.data);
    if (parsed.length === 0) return;

    for (const event of parsed) {
      if (event.channel === "status") {
        for (const listener of wsListeners.status) {
          listener(event);
        }
        continue;
      }

      if (event.channel === "output") {
        for (const listener of wsListeners.output) {
          listener(event);
        }
        continue;
      }

      for (const listener of wsListeners.metric) {
        listener(event);
      }
    }
  };
}

function nextWsMeta(): { seq: number; ts: number } {
  wsEventSeq += 1;
  return { seq: wsEventSeq, ts: Date.now() };
}

function normalizeOutputLevel(value: unknown, line: string): "info" | "warn" | "error" {
  if (value === "error" || value === "stderr") return "error";
  if (value === "warn" || value === "warning") return "warn";
  if (/\berror\b|traceback|exception|failed/i.test(line)) return "error";
  return "info";
}

function parseTrainStreamEvents(data: unknown): TrainStreamEvent[] {
  if (typeof data !== "string") return [];

  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return [];
  }

  if (!raw || typeof raw !== "object") return [];
  const obj = raw as Record<string, unknown>;

  if (typeof obj.channel === "string") {
    const parsedEnvelope = parseEnvelopeEvent(obj);
    return parsedEnvelope ? [parsedEnvelope] : [];
  }

  return parseBackendWsEvent(obj);
}

function parseEnvelopeEvent(obj: Record<string, unknown>): TrainStreamEvent | null {
  const channel = obj.channel;
  const payload = obj.payload;
  const seq = obj.seq;
  const ts = obj.ts;

  if ((channel !== "status" && channel !== "output" && channel !== "metric") || !payload || typeof payload !== "object") {
    return null;
  }

  const normalizedSeq = typeof seq === "number" ? seq : nextWsMeta().seq;
  const normalizedTs = typeof ts === "number" ? ts : Date.now();

  if (channel === "status") {
    const p = payload as Record<string, unknown>;
    if (p.process !== "train") return null;
    if (p.state !== "starting" && p.state !== "running" && p.state !== "stopped") return null;
    return {
      channel: "status",
      payload: {
        process: "train",
        state: p.state,
        reason: typeof p.reason === "string" ? p.reason : undefined,
      },
      seq: normalizedSeq,
      ts: normalizedTs,
    };
  }

  if (channel === "output") {
    const p = payload as Record<string, unknown>;
    if (p.process !== "train") return null;
    if (p.level !== "info" && p.level !== "warn" && p.level !== "error") return null;
    if (typeof p.line !== "string") return null;
    return {
      channel: "output",
      payload: {
        process: "train",
        level: p.level,
        line: p.line,
      },
      seq: normalizedSeq,
      ts: normalizedTs,
    };
  }

  const p = payload as Record<string, unknown>;
  if (p.process !== "train") return null;
  if (typeof p.step !== "number" || typeof p.totalSteps !== "number" || typeof p.loss !== "number") return null;
  return {
    channel: "metric",
    payload: {
      process: "train",
      step: p.step,
      totalSteps: p.totalSteps,
      loss: p.loss,
    },
    seq: normalizedSeq,
    ts: normalizedTs,
  };
}

function parseBackendWsEvent(obj: Record<string, unknown>): TrainStreamEvent[] {
  const type = obj.type;
  if (type === "output") {
    const process = obj.process;
    if (process !== "train" && process !== "train_install") return [];
    const line = typeof obj.text === "string" ? obj.text : typeof obj.line === "string" ? obj.line : "";
    if (!line) return [];
    const level = normalizeOutputLevel(obj.kind, line);
    return [{
      channel: "output",
      payload: {
        process: "train",
        level,
        line,
      },
      ...nextWsMeta(),
    }];
  }

  if (type === "metric") {
    if (obj.process !== "train") return [];
    if (!obj.metric || typeof obj.metric !== "object") return [];
    const metric = obj.metric as Record<string, unknown>;
    const step = Number(metric.step);
    const total = Number(metric.totalSteps ?? metric.total ?? metric.total_steps);
    const loss = Number(metric.loss);
    if (Number.isFinite(total)) {
      lastKnownTotalSteps = total;
    }
    const resolvedTotal = Number.isFinite(total) ? total : lastKnownTotalSteps;
    if (!Number.isFinite(step) || !Number.isFinite(loss)) return [];
    return [{
      channel: "metric",
      payload: {
        process: "train",
        step,
        totalSteps: resolvedTotal,
        loss,
      },
      ...nextWsMeta(),
    }];
  }

  if (type === "status") {
    if (!obj.processes || typeof obj.processes !== "object") return [];
    const processes = obj.processes as Record<string, unknown>;
    const trainRunning = Boolean(processes.train);
    const installRunning = Boolean(processes.train_install);
    const running = trainRunning || installRunning;
    const nextState = installRunning && !trainRunning ? "starting" : running ? "running" : "stopped";
    const events: TrainStreamEvent[] = [];

    if (wsTrainRunning === null) {
      wsTrainRunning = running;
      if (running) {
        events.push({
          channel: "status",
          payload: { process: "train", state: nextState },
          ...nextWsMeta(),
        });
      }
      return events;
    }

    if (wsTrainRunning !== running) {
      wsTrainRunning = running;
      if (!running) lastKnownTotalSteps = 0;
      events.push({
        channel: "status",
        payload: {
          process: "train",
          state: nextState,
          reason: running ? undefined : "status-poll",
        },
        ...nextWsMeta(),
      });
    }

    return events;
  }

  return [];
}

function disconnectTrainSocket(): void {
  if (!wsSocket) return;
  wsSocket.close();
  wsSocket = null;
}

export async function apiGet<T>(path: string): Promise<T> {
  if (transportMode === "passthrough") {
    return passthroughGet<T>(path);
  }

  await delay(NETWORK_DELAY_MS);
  const response = await handleMockGet(path);
  return response as T;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  if (transportMode === "passthrough") {
    return passthroughPost<T>(path, body);
  }

  await delay(NETWORK_DELAY_MS);
  const response = await handleMockPost(path, body);
  return response as T;
}

export async function apiDelete<T>(path: string): Promise<T> {
  if (transportMode === "passthrough") {
    return passthroughDelete<T>(path);
  }

  await delay(NETWORK_DELAY_MS);
  const response = await handleMockDelete(path);
  return response as T;
}

export type {
  NonTrainOutputEvent,
  TrainMetricEvent,
  TrainOutputEvent,
  TrainStatusEvent,
  TrainStreamChannel,
  TrainStreamEvent,
};

export function subscribeNonTrainChannel(
  processName: NonTrainProcessName,
  listener: (event: NonTrainOutputEvent) => void,
): () => void {
  if (transportMode !== "passthrough") {
    return subscribeMockNonTrainChannel(processName, listener);
  }

  connectTrainSocketIfNeeded();
  wsNonTrainListeners[processName].add(listener);
  return () => {
    wsNonTrainListeners[processName].delete(listener);
  };
}

type TrainListenerMap = {
  status: (event: TrainStatusEvent) => void;
  output: (event: TrainOutputEvent) => void;
  metric: (event: TrainMetricEvent) => void;
};

export function subscribeTrainChannel<C extends TrainStreamChannel>(
  channel: C,
  listener: TrainListenerMap[C],
): () => void {
  if (transportMode !== "passthrough") {
    if (channel === "status") {
      return subscribeMockTrainChannel("status", listener as (event: TrainStatusEvent) => void);
    }
    if (channel === "output") {
      return subscribeMockTrainChannel("output", listener as (event: TrainOutputEvent) => void);
    }
    return subscribeMockTrainChannel("metric", listener as (event: TrainMetricEvent) => void);
  }

  connectTrainSocketIfNeeded();

  if (channel === "status") {
    const typed = listener as (event: TrainStatusEvent) => void;
    wsListeners.status.add(typed);
    return () => {
      wsListeners.status.delete(typed);
    };
  }

  if (channel === "output") {
    const typed = listener as (event: TrainOutputEvent) => void;
    wsListeners.output.add(typed);
    return () => {
      wsListeners.output.delete(typed);
    };
  }

  const typed = listener as (event: TrainMetricEvent) => void;
  wsListeners.metric.add(typed);
  return () => {
    wsListeners.metric.delete(typed);
  };
}
