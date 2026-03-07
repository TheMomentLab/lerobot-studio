export type TrainStatus = "idle" | "starting" | "running" | "blocked";
export type CudaState = "ok" | "fail" | "installing";
export type PresetKey = "quick" | "standard" | "full";

export type PreflightResponse = {
  ok: boolean;
  reason?: string;
  action?: string | null;
  command?: string | null;
};

export type ActionResponse = {
  ok: boolean;
  error?: string;
};

export type CheckpointItem = {
  name: string;
  path: string;
  step: number | null;
};

export type CheckpointsResponse = {
  ok: boolean;
  checkpoints: CheckpointItem[];
};

export type DatasetResponse = {
  datasets?: Array<{ id: string }>;
};

export type GpuStatusResponse = {
  exists: boolean;
  utilization: number;
  memory_used: number;
  memory_total: number;
  memory_percent: number;
};

export type ColabConfigResponse = {
  ok: boolean;
  error?: string;
  repo_id?: string;
  config_path?: string;
  colab_link?: string;
};

export type ColabLinkResponse = {
  ok: boolean;
  error?: string;
  url?: string;
};

export type HfGateBannerProps = {
  authState: string;
  level: "hf_read" | "hf_write";
};

export const DEFAULT_COLAB_NOTEBOOK_URL = "https://colab.research.google.com/github/TheMomentLab/lerobot-studio/blob/dev/notebooks/lerobot_train.ipynb";

export const PRESETS: Record<PresetKey, { label: string; steps: number; tag: string }> = {
  quick: { label: "Quick", steps: 1000, tag: "1K" },
  standard: { label: "Standard", steps: 50000, tag: "50K" },
  full: { label: "Full", steps: 100000, tag: "100K" },
};

export const POLICY_TYPES = ["ACT", "Diffusion Policy", "TD-MPC2"];
export const LOCAL_DATASETS = [
  "lerobot-user/pick_cube",
  "lerobot-user/place_cup",
  "lerobot-user/stack_blocks",
];
export const CHECKPOINTS_MOCK = [
  { name: "checkpoint_010000", path: "outputs/train/act_pick_cube/checkpoints/010000", step: 10000 },
  { name: "checkpoint_025000", path: "outputs/train/act_pick_cube/checkpoints/025000", step: 25000 },
  { name: "last", path: "outputs/train/act_pick_cube/checkpoints/last", step: 25000 },
];

export const STARTING_STEPS = [
  { label: "CUDA Preflight Check", pattern: /cuda backend detected|no accelerated backend|using cuda|using cpu/i },
  { label: "Loading Dataset",      pattern: /Creating dataset/i },
  { label: "Initializing Model",   pattern: /Creating policy/i },
  { label: "Starting Training Loop", pattern: /Start offline training|cfg\.steps=/i },
];

export type LossTooltipEntry = {
  value?: number;
};
