export type AppTab =
  | "status"
  | "device-setup"
  | "motor-setup"
  | "calibrate"
  | "teleop"
  | "record"
  | "dataset"
  | "train"
  | "eval";

export type ProcessName =
  | "teleop"
  | "record"
  | "calibrate"
  | "motor_setup"
  | "train"
  | "train_install"
  | "eval";

export type LogKind = "stdout" | "stderr" | "error" | "info" | "warn";

export type LogLine = {
  id: string;
  text: string;
  kind: LogKind;
  ts: number;
};

export type SidebarSignals = {
  rulesNeedsRoot: boolean;
  rulesNeedsInstall: boolean;
  hasCameras: boolean;
  hasArms: boolean;
  trainMissingDep: boolean;
  datasetMissingDep: boolean;
};

export const DEFAULT_SIDEBAR_SIGNALS: SidebarSignals = {
  rulesNeedsRoot: false,
  rulesNeedsInstall: false,
  hasCameras: true,
  hasArms: true,
  trainMissingDep: false,
  datasetMissingDep: false,
};

export type ApiHealthState = {
  resources: boolean;
  history: boolean;
  [key: string]: boolean;
};

export type ApiSupportState = {
  resources: boolean;
  history: boolean;
  [key: string]: boolean;
};

export type DeviceCamera = {
  device: string;
  symlink?: string;
  model?: string;
};

export type DeviceArm = {
  device: string;
  symlink?: string;
};

export type DevicesResponse = {
  cameras: DeviceCamera[];
  arms: DeviceArm[];
};

export type DatasetListItem = {
  id: string;
  timestamp?: number;
};

export type LeStudioConfig = Record<string, unknown>;

export type ToastLevel = "success" | "error" | "info";

export type ToastMessage = {
  id: string;
  message: string;
  kind: ToastLevel;
};

export type LeStudioStoreData = {
  activeTab: AppTab;
  config: LeStudioConfig;
  procStatus: Record<string, boolean>;
  devices: DevicesResponse;
  wsReady: boolean;
  apiHealth: ApiHealthState;
  apiSupport: ApiSupportState;
  hfUsername: string | null;
  datasets: DatasetListItem[];
  loadingDatasets: boolean;
  logLines: Record<string, LogLine[]>;
  toasts: ToastMessage[];
  sidebarSignals: SidebarSignals;
  mobileSidebarOpen: boolean;
  consoleHeight: number;
};

export type LeStudioStoreActions = {
  setActiveTab: (tab: AppTab) => void;
  setConfig: (config: LeStudioConfig) => void;
  updateConfig: (partial: Partial<LeStudioConfig>) => void;
  setProcStatus: (status: Record<string, boolean>) => void;
  setDevices: (devices: DevicesResponse) => void;
  setWsReady: (ready: boolean) => void;
  setApiHealth: (key: string, value: boolean) => void;
  setApiSupport: (key: string, value: boolean) => void;
  appendLog: (processName: string, text: string, kind: LogKind) => void;
  clearLog: (processName: string) => void;
  addToast: (message: string, kind: ToastLevel) => void;
  removeToast: (id: string) => void;
  setSidebarSignals: (signals: Partial<SidebarSignals>) => void;
  setMobileSidebarOpen: (open: boolean) => void;
  setHfUsername: (username: string | null) => void;
  setConsoleHeight: (height: number) => void;
  setDatasets: (datasets: DatasetListItem[]) => void;
  setLoadingDatasets: (loading: boolean) => void;
};

export type LeStudioStoreState = LeStudioStoreData & LeStudioStoreActions;

export type StoreSelector<T> = (state: LeStudioStoreState) => T;
