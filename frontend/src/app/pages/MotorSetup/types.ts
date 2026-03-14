export type ArmDevice = {
  device: string;
  path: string;
  symlink?: string | null;
  serial?: string;
};

export type MotorData = {
  id: number;
  pos: number | null;
  load: number | null;
  current: number | null;
  collision: boolean;
  target: number;
};

export type MotorPositionsResponse = {
  ok: boolean;
  connected: boolean;
  positions: Record<string, number | null>;
  motors?: Record<string, { position: number | null; load: number | null; current: number | null; collision: boolean }>;
  freewheel?: boolean;
};

export type MotorConnectResponse = {
  ok: boolean;
  connected_ids?: number[];
  error?: string;
};

export type DeviceResponse = {
  arms?: ArmDevice[];
};

export type RuleItem = {
  subsystem?: string;
  kernel?: string;
  serial?: string;
  symlink?: string;
  mode?: string;
  exists?: boolean;
};

export type RulesResponse = {
  camera_rules?: RuleItem[];
  arm_rules?: RuleItem[];
};

export type ActionResponse = {
  ok: boolean;
  error?: string;
};

export type CalibrationIssue = {
  severity: "error" | "warning";
  joint: string;
  code: string;
  message: string;
};

export type CalibrationValidation = {
  ok: boolean;
  path: string;
  errors: CalibrationIssue[];
  warnings: CalibrationIssue[];
};

export type CalibrationFileItem = {
  id: string;
  guessed_type?: string;
  rel_path?: string;
  modified?: string;
  size?: number;
  raw_ids?: string[];
  shared_profile?: boolean;
};

export type CalibrationListResponse = {
  files?: CalibrationFileItem[];
};

export type CalibrationFileStatusResponse = {
  exists?: boolean;
  path?: string;
  modified?: string;
  size?: number;
  validation?: CalibrationValidation;
};
