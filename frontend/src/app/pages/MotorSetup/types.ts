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
  kernel?: string;
  symlink?: string;
  mode?: string;
  exists?: boolean;
};

export type RulesResponse = {
  arm_rules?: RuleItem[];
};

export type ActionResponse = {
  ok: boolean;
  error?: string;
};

export type CalibrationFileItem = {
  id: string;
  guessed_type?: string;
  modified?: string;
  size?: number;
};

export type CalibrationListResponse = {
  files?: CalibrationFileItem[];
};

export type CalibrationFileStatusResponse = {
  exists?: boolean;
  path?: string;
  modified?: string;
  size?: number;
};
