import { useSyncExternalStore } from "react";
import type {
  AppTab,
  LeStudioConfig,
  LeStudioStoreActions,
  LeStudioStoreState,
  SidebarSignals,
  StoreSelector,
} from "./types";
import { DEFAULT_SIDEBAR_SIGNALS } from "./types";

const MAX_LOG_LINES = 1200;
const ACTIVE_TAB_STORAGE_KEY = "lestudio.active-tab";

const VALID_TABS = new Set<AppTab>([
  "status",
  "device-setup",
  "motor-setup",
  "calibrate",
  "teleop",
  "record",
  "dataset",
  "train",
  "eval",
]);

type StoreListener = () => void;

const listeners = new Set<StoreListener>();

function notifyListeners(): void {
  for (const listener of listeners) {
    listener();
  }
}

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function loadInitialActiveTab(): AppTab {
  if (typeof window === "undefined") return "status";
  const saved = window.localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
  if (saved && VALID_TABS.has(saved as AppTab)) {
    return saved as AppTab;
  }
  return "status";
}

function persistActiveTab(tab: AppTab): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, tab);
}

function setState(
  updater:
    | Partial<LeStudioStoreState>
    | ((prev: LeStudioStoreState) => Partial<LeStudioStoreState>),
): void {
  const patch = typeof updater === "function" ? updater(storeState) : updater;
  storeState = { ...storeState, ...patch };
  notifyListeners();
}

function subscribe(listener: StoreListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const actions: LeStudioStoreActions = {
  setActiveTab: (tab) => {
    if (!VALID_TABS.has(tab)) return;
    if (storeState.activeTab === tab) return;
    persistActiveTab(tab);
    setState({ activeTab: tab });
  },
  setConfig: (config) => {
    setState({ config });
  },
  updateConfig: (partial) => {
    setState((prev) => ({ config: { ...prev.config, ...partial } }));
  },
  setProcStatus: (status) => {
    setState({ procStatus: status });
  },
  setDevices: (devices) => {
    setState({
      devices: {
        cameras: devices.cameras ?? [],
        arms: devices.arms ?? [],
      },
    });
  },
  setWsReady: (ready) => {
    setState({ wsReady: ready });
  },
  setApiHealth: (key, value) => {
    setState((prev) => ({ apiHealth: { ...prev.apiHealth, [key]: value } }));
  },
  setApiSupport: (key, value) => {
    setState((prev) => ({ apiSupport: { ...prev.apiSupport, [key]: value } }));
  },
  appendLog: (processName, text, kind) => {
    setState((prev) => {
      const existing = prev.logLines[processName] ?? [];
      const next = [...existing, { id: uid(), text, kind, ts: Date.now() }];
      return {
        logLines: {
          ...prev.logLines,
          [processName]: next.slice(Math.max(0, next.length - MAX_LOG_LINES)),
        },
      };
    });
  },
  clearLog: (processName) => {
    setState((prev) => ({
      logLines: {
        ...prev.logLines,
        [processName]: [],
      },
    }));
  },
  addToast: (message, kind) => {
    setState((prev) => ({
      toasts: [...prev.toasts, { id: uid(), message, kind }],
    }));
  },
  removeToast: (id) => {
    setState((prev) => ({
      toasts: prev.toasts.filter((toast) => toast.id !== id),
    }));
  },
  setSidebarSignals: (signals) => {
    setState((prev) => ({
      sidebarSignals: { ...prev.sidebarSignals, ...signals },
    }));
  },
  setMobileSidebarOpen: (open) => {
    setState({ mobileSidebarOpen: open });
  },
  setHfUsername: (username) => {
    setState({ hfUsername: username });
  },
  setConsoleHeight: (height) => {
    setState({ consoleHeight: height });
  },
  setDatasets: (datasets) => {
    setState({ datasets });
  },
  setLoadingDatasets: (loading) => {
    setState({ loadingDatasets: loading });
  },
};

let storeState: LeStudioStoreState = {
  activeTab: loadInitialActiveTab(),
  config: {},
  procStatus: {},
  devices: { cameras: [], arms: [] },
  wsReady: false,
  apiHealth: { resources: true, history: true },
  apiSupport: { resources: true, history: true },
  hfUsername: null,
  datasets: [],
  loadingDatasets: false,
  logLines: {},
  toasts: [],
  sidebarSignals: DEFAULT_SIDEBAR_SIGNALS,
  mobileSidebarOpen: false,
  consoleHeight: 170,
  ...actions,
};

export function getLeStudioState(): LeStudioStoreState {
  return storeState;
}

export function setLeStudioState(
  updater:
    | Partial<LeStudioStoreState>
    | ((prev: LeStudioStoreState) => Partial<LeStudioStoreState>),
): void {
  setState(updater);
}

export function resetLeStudioState(overrides?: Partial<LeStudioConfig>): void {
  storeState = {
    activeTab: loadInitialActiveTab(),
    config: overrides ?? {},
    procStatus: {},
    devices: { cameras: [], arms: [] },
    wsReady: false,
    apiHealth: { resources: true, history: true },
    apiSupport: { resources: true, history: true },
    hfUsername: null,
    datasets: [],
    loadingDatasets: false,
    logLines: {},
    toasts: [],
    sidebarSignals: DEFAULT_SIDEBAR_SIGNALS,
    mobileSidebarOpen: false,
    consoleHeight: 170,
    ...actions,
  };
  notifyListeners();
}

export function useLeStudioStore<T>(selector: StoreSelector<T>): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(storeState),
    () => selector(storeState),
  );
}

export const leStudioStore = {
  getState: getLeStudioState,
  setState: setLeStudioState,
  subscribe,
};

export type { LeStudioStoreState };

export const ACTIVE_TAB_TOKENS: AppTab[] = [
  "status",
  "device-setup",
  "motor-setup",
  "calibrate",
  "teleop",
  "record",
  "dataset",
  "train",
  "eval",
];

export function mapPathnameToActiveTab(pathname: string): AppTab {
  if (pathname.startsWith("/camera-setup")) return "device-setup";
  if (pathname.startsWith("/motor-setup")) return "motor-setup";
  if (pathname.startsWith("/teleop")) return "teleop";
  if (pathname.startsWith("/recording")) return "record";
  if (pathname.startsWith("/dataset")) return "dataset";
  if (pathname.startsWith("/training")) return "train";
  if (pathname.startsWith("/evaluation")) return "eval";
  if (pathname.startsWith("/calibrate")) return "calibrate";
  return "status";
}

export function mapActiveTabToPath(tab: AppTab): string {
  if (tab === "device-setup") return "/camera-setup";
  if (tab === "motor-setup" || tab === "calibrate") return "/motor-setup";
  if (tab === "teleop") return "/teleop";
  if (tab === "record") return "/recording";
  if (tab === "dataset") return "/dataset";
  if (tab === "train") return "/training";
  if (tab === "eval") return "/evaluation";
  return "/";
}

export function applySidebarSignalsPatch(signals: Partial<SidebarSignals>): void {
  actions.setSidebarSignals(signals);
}
