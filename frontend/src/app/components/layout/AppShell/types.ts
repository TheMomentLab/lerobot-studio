export type RuntimeProcessName = "teleop" | "record" | "calibrate" | "motor_setup" | "train" | "eval";

export type RunningInfo = {
  process: RuntimeProcessName;
  text: string;
  pct: number | null;
};
