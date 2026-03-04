import {
  Monitor,
  Camera,
  Settings,
  Video,
  Database,
  Brain,
  FlaskConical,
  Play,
} from "lucide-react";
import type { RuntimeProcessName } from "./types";

export const NAV_GROUPS = [
  {
    id: "hardware",
    label: "Hardware",
    items: [
      { path: "/", label: "System Status", icon: Monitor },
      { path: "/motor-setup", label: "Motor Setup", icon: Settings },
      { path: "/camera-setup", label: "Camera Setup", icon: Camera },
    ],
  },
  {
    id: "operate",
    label: "Operate",
    items: [
      { path: "/teleop", label: "Teleop", icon: Play },
      { path: "/recording", label: "Recording", icon: Video },
    ],
  },
  {
    id: "data",
    label: "Data",
    items: [
      { path: "/dataset", label: "Dataset", icon: Database },
    ],
  },
  {
    id: "ml",
    label: "ML",
    items: [
      { path: "/training", label: "Training", icon: Brain },
      { path: "/evaluation", label: "Evaluation", icon: FlaskConical },
    ],
  },
];

export const MIN_CONSOLE_HEIGHT = 32;

export const PROCESS_NAMES = ["teleop", "record", "calibrate", "motor_setup", "train", "eval"] as const;

export const PROCESS_LABELS: Record<RuntimeProcessName, string> = {
  teleop: "Teleop",
  record: "Record",
  calibrate: "Calibrate",
  motor_setup: "Motor Setup",
  train: "Train",
  eval: "Eval",
};

export const TAB_TO_PROCESS: Partial<Record<string, RuntimeProcessName>> = {
  teleop: "teleop",
  record: "record",
  calibrate: "calibrate",
  "motor-setup": "motor_setup",
  train: "train",
  eval: "eval",
};

export const PROCESS_TO_TAB: Record<RuntimeProcessName, "teleop" | "record" | "calibrate" | "motor-setup" | "train" | "eval"> = {
  teleop: "teleop",
  record: "record",
  calibrate: "motor-setup",
  motor_setup: "motor-setup",
  train: "train",
  eval: "eval",
};

export const TRAIN_STEP_RE = /\bstep\s*[:=]\s*([0-9]+(?:\.[0-9]+)?[KMBTQ]?)/i;
export const TRAIN_LOSS_RE = /\bloss\s*[:=]\s*([+-]?[0-9]*\.?[0-9]+(?:e[+-]?[0-9]+)?)/i;
export const TRAIN_TOTAL_RE = /cfg\.steps=([0-9_,]+)/i;
export const EVAL_DONE_RE = /episode\s*([0-9]+)\s*\/\s*([0-9]+)/i;
export const EVAL_REWARD_RE = /\b(?:mean[_\s-]?reward|avg[_\s-]?reward|episode[_\s-]?reward|reward)\s*[:=]\s*([+-]?[0-9]*\.?[0-9]+(?:e[+-]?[0-9]+)?)/i;
