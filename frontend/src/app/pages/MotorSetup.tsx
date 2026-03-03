import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Link } from "react-router";
import {
  PageHeader, Card, StatusBadge, WireSelect, WireInput, FieldRow,
  ProcessButtons, WireToggle, ModeToggle, EmptyState, BlockerCard, RefreshButton, SubTabs
} from "../components/wireframe";
import { AlertCircle, AlertTriangle, Bot, Zap, Ruler, Play, Square, Check, Circle, Loader2, CornerDownLeft, RotateCcw, Trash2 } from "lucide-react";
import { cn } from "../components/ui/utils";
import { apiDelete, apiGet, apiPost } from "../services/apiClient";
import { useLeStudioStore } from "../store";

// ─── Types ────────────────────────────────────────────────────────────────────

type ArmDevice = {
  device: string;
  path: string;
  symlink?: string | null;
  serial?: string;
};

type MotorData = {
  id: number;
  pos: number | null;
  load: number | null;
  current: number | null;
  collision: boolean;
  target: number;
};

type MotorPositionsResponse = {
  ok: boolean;
  connected: boolean;
  positions: Record<string, number | null>;
  motors?: Record<string, { position: number | null; load: number | null; current: number | null; collision: boolean }>;
  freewheel?: boolean;
};

type MotorConnectResponse = {
  ok: boolean;
  connected_ids?: number[];
  error?: string;
};

type DeviceResponse = {
  arms?: ArmDevice[];
};

type RuleItem = {
  kernel?: string;
  symlink?: string;
  mode?: string;
  exists?: boolean;
};

type RulesResponse = {
  arm_rules?: RuleItem[];
};

type ActionResponse = {
  ok: boolean;
  error?: string;
};

type CalibrationFileItem = {
  id: string;
  guessed_type?: string;
  modified?: string;
  size?: number;
};

type CalibrationListResponse = {
  files?: CalibrationFileItem[];
};

type CalibrationFileStatusResponse = {
  exists?: boolean;
  path?: string;
  modified?: string;
  size?: number;
};

// ─── Constants ────────────────────────────────────────────────────────────────

// MOTOR_NAMES kept for future range visualization

// Setup wizard: motors in REVERSED order (gripper first, shoulder_pan last) — matches lerobot CLI
const SETUP_MOTORS = [
  { name: "gripper", id: 6 },
  { name: "wrist_roll", id: 5 },
  { name: "wrist_flex", id: 4 },
  { name: "elbow_flex", id: 3 },
  { name: "shoulder_lift", id: 2 },
  { name: "shoulder_pan", id: 1 },
];

const ARM_TYPES = ["so101_follower", "so100_follower", "so101_leader", "so100_leader"];

function toArmSymlink(roleLabel: string): string {
  if (roleLabel === "Follower Arm 1") return "follower_arm_1";
  if (roleLabel === "Follower Arm 2") return "follower_arm_2";
  if (roleLabel === "Leader Arm 1") return "leader_arm_1";
  if (roleLabel === "Leader Arm 2") return "leader_arm_2";
  return "(none)";
}

// Load / Current thresholds (CheckFeetechMotors reference)
const LOAD_WARN = 700;
const LOAD_DANGER = 1023;
const CURRENT_WARN = 560;
const CURRENT_DANGER = 800;

// ─── Sub-components ───────────────────────────────────────────────────────────


function MotorCard({
  motor,
  freewheel,
  onMove,
  onClearCollision,
  onTargetChange,
}: {
  motor: MotorData;
  freewheel: boolean;
  onMove: (id: number, target: number) => void;
  onClearCollision: (id: number) => void;
  onTargetChange: (id: number, target: number) => void;
}) {
  const loadColor =
    motor.load === null ? "text-zinc-400" :
    motor.load >= LOAD_DANGER ? "text-red-400" :
    motor.load >= LOAD_WARN ? "text-amber-400" :
    "text-zinc-400";

  const currentColor =
    motor.current === null ? "text-zinc-400" :
    motor.current >= CURRENT_DANGER ? "text-red-400" :
    motor.current >= CURRENT_WARN ? "text-amber-400" :
    "text-zinc-400";

  return (
    <div className={`rounded-lg border bg-white dark:bg-zinc-900 p-3 flex flex-col gap-2 ${motor.collision ? "border-red-500/40" : "border-zinc-200 dark:border-zinc-800"}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm text-zinc-500">Motor #{motor.id}</span>
        {motor.collision && (
          <span className="px-1.5 py-0.5 rounded bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            Collision
          </span>
        )}
      </div>

      {/* Values */}
      <div className="grid grid-cols-3 gap-2">
        <div className="text-center">
          <div className="text-sm text-zinc-400 mb-0.5">POS</div>
          <div className="text-sm font-mono text-zinc-700 dark:text-zinc-300">
            {motor.pos !== null ? motor.pos : <span className="text-red-400">err</span>}
          </div>
        </div>
        <div className="text-center">
          <div className="text-sm text-zinc-400 mb-0.5">LOAD</div>
          <div className={`text-sm font-mono ${loadColor}`}>
            {motor.load !== null ? motor.load : "—"}
          </div>
        </div>
        <div className="text-center">
          <div className="text-sm text-zinc-400 mb-0.5">CURR</div>
          <div className={`text-sm font-mono ${currentColor}`}>
            {motor.current !== null ? `${motor.current}mA` : "—"}
          </div>
        </div>
      </div>

      {/* Target control */}
      <div className="flex items-center gap-1 mt-1">
        <button
          onClick={() => onTargetChange(motor.id, Math.max(0, motor.target - 10))}
          className="size-7 flex items-center justify-center rounded border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer text-sm"
        >
          ▼
        </button>
        <input
          type="number"
          value={motor.target}
          onChange={(e) => onTargetChange(motor.id, Math.max(0, Math.min(4095, Number(e.target.value))))}
          min={0}
          max={4095}
          className="flex-1 h-7 px-1.5 text-center text-sm font-mono rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-700 dark:text-zinc-300 outline-none focus:border-zinc-400 dark:focus:border-zinc-500"
        />
        <button
          onClick={() => onTargetChange(motor.id, Math.min(4095, motor.target + 10))}
          className="size-7 flex items-center justify-center rounded border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer text-sm"
        >
          ▲
        </button>
        <button
          onClick={() => onMove(motor.id, motor.target)}
          disabled={freewheel || motor.collision}
          className="px-2 h-7 rounded border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          Move
        </button>
      </div>

      {motor.collision && (
        <button
          onClick={() => onClearCollision(motor.id)}
          className="text-sm text-red-400 hover:text-red-500 underline cursor-pointer"
        >
          Clear Collision
        </button>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function MotorSetup() {
  const procStatus = useLeStudioStore((s) => s.procStatus);
  const appendLog = useLeStudioStore((s) => s.appendLog);
  const clearLog = useLeStudioStore((s) => s.clearLog);
  const addToast = useLeStudioStore((s) => s.addToast);

  // ── Device data ──────────────────────────────────────────────────────────
  const [arms, setArms] = useState<ArmDevice[]>([]);
  const [armRules, setArmRules] = useState<RuleItem[]>([]);
  const [udevOpen, setUdevOpen] = useState(false);

  // ── Motor Setup (CLI) ────────────────────────────────────────────────────
  const setupRunning = Boolean(procStatus.motor_setup);
  const calibrateRunning = Boolean(procStatus.calibrate);
  const [setupArmType, setSetupArmType] = useState("so101_follower");
  const [setupPort, setSetupPort] = useState("");
  const [armTypes, setArmTypes] = useState<string[]>(ARM_TYPES);
  const [_hasRun, setHasRun] = useState(false);

  // ── Motor Monitor ─────────────────────────────────────────────────────────
  const [monConnected, setMonConnected] = useState(false);
  const [monConnecting, setMonConnecting] = useState(false);
  const [monPort, setMonPort] = useState("");
  const [monMotors, setMonMotors] = useState<MotorData[]>([]);
  const [freewheel, setFreewheel] = useState(false);
  const [monError, setMonError] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Calibration (mock UI only — real API in Calibration page) ────────────
  const [calibMode, setCalibMode] = useState("Single Arm");
  const [calibArmType, setCalibArmType] = useState("so101_follower");
  const [calibPort, setCalibPort] = useState("");
  const [calibArmId, setCalibArmId] = useState("");
  const [calibBiType, setCalibBiType] = useState("bi_so_follower");
  const [calibBiId, setCalibBiId] = useState("bimanual_follower");
  const [calibBiLeftPort, setCalibBiLeftPort] = useState("");
  const [calibBiRightPort, setCalibBiRightPort] = useState("");
  const [calibFiles, setCalibFiles] = useState<CalibrationFileItem[]>([]);

  // ── Setup Wizard ──────────────────────────────────────────────────────────
  const [wizardRunning, setWizardRunning] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [wizardMotorState, setWizardMotorState] = useState<("pending" | "waiting" | "writing" | "done" | "error")[]>(
    SETUP_MOTORS.map(() => "pending")
  );
  const [wizardError, setWizardError] = useState<string | null>(null);
  const [wizardDetectedId, setWizardDetectedId] = useState("");
  const [wizardBaudRate, setWizardBaudRate] = useState("1000000");
  const [wizardConnectionConfirmed, setWizardConnectionConfirmed] = useState(false);

  // ── Mapping tab ───────────────────────────────────────────────────────────
  const [armRoleMap, setArmRoleMap] = useState<Record<string, string>>({});
  const [mappingApplied, setMappingApplied] = useState(false);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [motorTab, setMotorTab] = useState("identify");
  const [identifyStep, setIdentifyStep] = useState<"idle" | "waiting" | "found" | "conflict">("idle");
  const [identifyRole, setIdentifyRole] = useState("(none)");
  const [_conflictTarget] = useState("");
  const [noPort, setNoPort] = useState(false);
  const [hasConflict, setHasConflict] = useState(false);

  // ─── Data loading ──────────────────────────────────────────────────────────

  const loadDevices = useCallback(async () => {
    try {
      const res = await apiGet<DeviceResponse>("/api/devices");
      const nextArms = Array.isArray(res.arms) ? res.arms : [];
      setArms(nextArms);

      // Auto-select port for Setup tab
      if (nextArms.length > 0) {
        const best = nextArms[0];
        const bestPort = best.path ?? `/dev/${best.device ?? "ttyUSB0"}`;
        const second = nextArms[1] ?? nextArms[0];
        const secondPort = second.path ?? `/dev/${second.device ?? "ttyUSB1"}`;
        setSetupPort((prev) => prev || bestPort);
        setMonPort((prev) => prev || bestPort);
        setCalibPort((prev) => prev || bestPort);
        setCalibBiLeftPort((prev) => prev || bestPort);
        setCalibBiRightPort((prev) => prev || secondPort);
      }

      // Pre-populate armRoleMap from existing symlinks
      const ARM_ROLE_OPTIONS = ["Follower Arm 1", "Follower Arm 2", "Leader Arm 1", "Leader Arm 2"];
      const symToLabel = Object.fromEntries(
        ARM_ROLE_OPTIONS.map((label) => [label.toLowerCase().replace(/ /g, "_"), label]),
      );
      const initialMap: Record<string, string> = {};
      for (const arm of nextArms) {
        if (arm.symlink && symToLabel[arm.symlink]) {
          initialMap[arm.device] = symToLabel[arm.symlink];
        }
      }
      if (Object.keys(initialMap).length > 0) {
        setArmRoleMap((prev) => {
          const hasExisting = Object.values(prev).some((v) => v && v !== "(none)");
          return hasExisting ? prev : { ...prev, ...initialMap };
        });
      }
    } catch {
      // ignore
    }
  }, []);

  const loadUdevRules = useCallback(async () => {
    try {
      const res = await apiGet<RulesResponse>("/api/rules/current");
      setArmRules(Array.isArray(res.arm_rules) ? res.arm_rules : []);
    } catch {
      setArmRules([]);
    }
  }, []);

  const loadArmTypes = useCallback(async () => {
    try {
      const res = await apiGet<{ types?: string[] }>("/api/robots");
      if (Array.isArray(res.types) && res.types.length > 0) {
        setArmTypes(res.types);
      }
    } catch {
      // keep defaults
    }
  }, []);

  useEffect(() => {
    void loadDevices();
    void loadUdevRules();
    void loadArmTypes();
  }, [loadDevices, loadUdevRules, loadArmTypes]);

  // Auto-select port matching arm type keyword (follower/leader)
  useEffect(() => {
    if (arms.length === 0) return;
    const keyword = setupArmType.includes("follower") ? "follower" : setupArmType.includes("leader") ? "leader" : "";
    const match = keyword
      ? arms.find((a) => (a.symlink ?? a.device ?? "").toLowerCase().includes(keyword))
      : undefined;
    const best = match ?? arms[0];
    const p = best.path ?? `/dev/${best.device ?? "ttyUSB0"}`;
    setSetupPort(p);
    if (!monConnected) setMonPort(p);
  }, [arms, setupArmType, monConnected]);

  // ─── Motor Monitor polling ──────────────────────────────────────────────────

  useEffect(() => {
    if (!monConnected) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(async () => {
      try {
        const res = await apiGet<MotorPositionsResponse>("/api/motor/positions");
        if (!res.ok || !res.connected) {
          setMonConnected(false);
          setMonMotors([]);
          setFreewheel(false);
          return;
        }

        if (res.freewheel !== undefined) setFreewheel(res.freewheel);

        setMonMotors((prev) => {
          const next = [...prev];
          for (const motor of next) {
            const idStr = String(motor.id);
            if (res.motors && res.motors[idStr]) {
              const d = res.motors[idStr];
              motor.pos = d.position;
              motor.load = d.load;
              motor.current = d.current;
              motor.collision = d.collision;
            } else if (res.positions[idStr] !== undefined) {
              motor.pos = res.positions[idStr];
            }
          }
          return next;
        });
      } catch {
        // ignore transient errors
      }
    }, 100);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [monConnected]);

  // ─── Motor Monitor handlers ─────────────────────────────────────────────────

  const handleMonConnect = async () => {
    if (!monPort) { setMonError("Select a port first."); return; }
    setMonConnecting(true);
    setMonError("");
    try {
      const res = await apiPost<MotorConnectResponse>("/api/motor/connect", { port: monPort });
      if (!res.ok) {
        setMonError(res.error ?? "Connection failed");
        return;
      }
      const ids = res.connected_ids ?? [];
      setMonMotors(ids.map((id) => ({ id, pos: null, load: null, current: null, collision: false, target: 2048 })));
      setFreewheel(false);
      setMonConnected(true);
      addToast(`Motor monitor connected (${ids.length} motors)`, "success");
    } catch (err) {
      setMonError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setMonConnecting(false);
    }
  };

  const handleMonDisconnect = useCallback(async () => {
    if (pollRef.current) clearInterval(pollRef.current);
    await apiPost("/api/motor/disconnect", {});
    setMonConnected(false);
    setMonMotors([]);
    setFreewheel(false);
    setMonError("");
  }, []);

  const handleFreewheelToggle = async () => {
    const endpoint = freewheel ? "/api/motor/freewheel/exit" : "/api/motor/freewheel/enter";
    const res = await apiPost<ActionResponse>(endpoint, {});
    if (!res.ok) {
      addToast(`Freewheel ${freewheel ? "exit" : "enter"} failed: ${res.error}`, "error");
      return;
    }
    setFreewheel(!freewheel);
    addToast(freewheel ? "Freewheel OFF — torque restored" : "Freewheel ON — move motors freely by hand", "info");
  };

  const handleEmergencyStop = async () => {
    const res = await apiPost<ActionResponse>("/api/motor/torque_off", {});
    if (!res.ok) {
      addToast(`Emergency stop failed: ${res.error}`, "error");
    } else {
      setFreewheel(false);
      addToast("Emergency stop — all torque OFF", "info");
    }
  };

  const handleMoveMotor = async (id: number, target: number) => {
    const res = await apiPost<ActionResponse>(`/api/motor/${id}/move`, { position: target });
    if (!res.ok) addToast(`Motor ${id} move failed: ${res.error}`, "error");
  };

  const handleClearCollision = async (id: number) => {
    const res = await apiPost<ActionResponse>(`/api/motor/${id}/clear_collision`, {});
    if (!res.ok) {
      addToast(`Clear collision failed: ${res.error}`, "error");
    } else {
      setMonMotors((prev) => prev.map((m) => m.id === id ? { ...m, collision: false } : m));
      addToast(`Motor ${id} collision cleared`, "info");
    }
  };

  const handleTargetChange = (id: number, target: number) => {
    setMonMotors((prev) => prev.map((m) => m.id === id ? { ...m, target } : m));
  };

  // ─── Motor Setup (CLI) handlers ────────────────────────────────────────────

  const handleSetupStart = async () => {
    if (!setupPort.startsWith("/dev/")) {
      addToast("Port must start with /dev/", "error");
      return;
    }
    clearLog("motor_setup");
    const res = await apiPost<ActionResponse>("/api/motor_setup/start", {
      robot_type: setupArmType,
      port: setupPort,
    });
    if (!res.ok) {
      appendLog("motor_setup", `[ERROR] ${res.error ?? "failed to start motor setup"}`, "error");
      addToast("Failed to start motor setup", "error");
    } else {
      addToast("Motor setup started", "success");
      setHasRun(true);
      startWizard();
    }
  };

  const refreshCalibrationList = useCallback(async () => {
    try {
      const res = await apiGet<CalibrationListResponse>("/api/calibrate/list");
      const files = Array.isArray(res.files) ? res.files : [];
      setCalibFiles(files);
    } catch {
      setCalibFiles([]);
    }
  }, []);

  useEffect(() => {
    void refreshCalibrationList();
  }, [refreshCalibrationList]);


  const handleCalibrationStart = async () => {
    const payload = calibMode === "Bi-Arm"
      ? {
          robot_mode: "bi",
          bi_type: calibBiType,
          robot_id: calibBiId,
          left_port: calibBiLeftPort,
          right_port: calibBiRightPort,
        }
      : {
          robot_mode: "single",
          robot_type: calibArmType,
          robot_id: calibArmId,
          port: calibPort,
        };

    const res = await apiPost<ActionResponse>("/api/calibrate/start", payload);
    if (!res.ok) {
      addToast(res.error ?? "Calibration start failed", "error");
      appendLog("calibrate", `[ERROR] ${res.error ?? "failed to start calibration"}`, "error");
      return;
    }

    addToast("Calibration started", "success");
    appendLog("calibrate", "[info] calibration started", "info");
  };

  const handleCalibrationStop = async () => {
    const res = await apiPost<ActionResponse>("/api/process/calibrate/stop", {});
    if (!res.ok) {
      addToast(res.error ?? "Calibration stop failed", "error");
      return;
    }
    addToast("Calibration stop requested", "info");
    await refreshCalibrationList();
    await refreshCalibrationFileStatus();
  };

  const handleCalibrationDelete = async (file: CalibrationFileItem) => {
    if (!window.confirm(`Delete calibration file?\n\n${file.id}\n\nThis cannot be undone.`)) return;
    const guessedType = typeof file.guessed_type === "string" && file.guessed_type ? file.guessed_type : calibArmType;
    const body = await apiDelete<ActionResponse>(
      `/api/calibrate/file?robot_type=${encodeURIComponent(guessedType)}&robot_id=${encodeURIComponent(file.id)}`,
    );
    if (!body.ok) {
      addToast(body.error ?? "Calibration file delete failed", "error");
      return;
    }
    addToast(`Deleted calibration: ${file.id}`, "success");
    await refreshCalibrationList();
    await refreshCalibrationFileStatus();
  };

  const applyArmMapping = async () => {
    const armAssignments: Record<string, string> = {};
    for (const arm of arms) {
      if (!arm.serial) continue;
      const roleLabel = armRoleMap[arm.device] ?? "(none)";
      armAssignments[arm.serial] = toArmSymlink(roleLabel);
    }

    const result = await apiPost<ActionResponse>("/api/rules/apply", {
      assignments: {},
      arm_assignments: armAssignments,
    });

    if (!result.ok) {
      addToast(result.error ?? "Failed to apply arm mapping.", "error");
      setMappingApplied(false);
      return;
    }

    setMappingApplied(true);
    addToast("Arm mapping rules applied.", "success");
    await loadUdevRules();
  };

  // ─── Setup Wizard helpers ──────────────────────────────────────────────────

  const startWizard = () => {
    setWizardRunning(true);
    setWizardStep(0);
    setWizardMotorState(SETUP_MOTORS.map((_, i) => i === 0 ? "waiting" : "pending"));
    setWizardError(null);
    setWizardDetectedId("");
    setWizardBaudRate("1000000");
    setWizardConnectionConfirmed(false);
  };

  const wizardPressEnter = () => {
    if (!wizardRunning) return;
    if (!wizardConnectionConfirmed) {
      setWizardError("Confirm that only the current motor is connected.");
      return;
    }
    if (!wizardDetectedId.trim()) {
      setWizardError("Enter the detected motor ID.");
      return;
    }

    const newState = [...wizardMotorState];
    newState[wizardStep] = "writing";
    setWizardMotorState(newState);
    setWizardError(null);
    setTimeout(() => {
      const doneState = [...newState];
      doneState[wizardStep] = "done";
      const nextStep = wizardStep + 1;
      if (nextStep < SETUP_MOTORS.length) {
        doneState[nextStep] = "waiting";
        setWizardStep(nextStep);
        setWizardDetectedId("");
        setWizardConnectionConfirmed(false);
      }
      setWizardMotorState(doneState);
      if (nextStep >= SETUP_MOTORS.length) {
        setTimeout(() => setWizardRunning(false), 500);
      }
    }, 1000);
  };

  const wizardSimulateError = () => {
    const newState = [...wizardMotorState];
    newState[wizardStep] = "error";
    setWizardMotorState(newState);
    setWizardError(`Failed to write EEPROM for '${SETUP_MOTORS[wizardStep].name}'.`);
  };

  const wizardRetry = () => {
    const newState = [...wizardMotorState];
    newState[wizardStep] = "waiting";
    setWizardMotorState(newState);
    setWizardError(null);
  };

  const wizardAllDone = wizardMotorState.every((s) => s === "done");

  const mappedCount = Object.values(armRoleMap).filter((r) => r && r !== "(none)").length;
  const ARM_ROLES = ["(none)", ...arms.map((a) => a.symlink ?? a.device ?? a.path)];

  const monPortLabel = arms.find((a) => a.path === monPort)?.symlink ?? monPort;

  const calibTypeMismatch =
    calibMode === "Single Arm" &&
    ((calibArmType.includes("follower") && calibPort.includes("leader")) ||
      (calibArmType.includes("leader") && calibPort.includes("follower")));

  const calibArmIdOptions = useMemo(() => {
    const role = calibArmType.includes("leader") ? "leader" : calibArmType.includes("follower") ? "follower" : "";
    const roleMatched = role
      ? calibFiles.filter((f) => (f.guessed_type ?? "").toLowerCase().includes(role))
      : calibFiles;
    return Array.from(new Set(roleMatched.map((f) => f.id).filter(Boolean)));
  }, [calibArmType, calibFiles]);

  const calibPortOptions = useMemo(
    () => arms.map((a) => a.path ?? `/dev/${a.device}`),
    [arms]
  );

  useEffect(() => {
    if (calibArmIdOptions.length === 0) {
      if (calibArmId !== "") setCalibArmId("");
      return;
    }
    if (!calibArmIdOptions.includes(calibArmId)) {
      setCalibArmId(calibArmIdOptions[0]);
    }
  }, [calibArmId, calibArmIdOptions]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 flex flex-col gap-4 max-w-[1600px] mx-auto w-full">
          <PageHeader
            title="Motor Setup"
            subtitle="Arm mapping, motor ID setup and verification"
            action={
              <div className="flex items-center gap-2">
                {import.meta.env.DEV && <div className="flex items-center gap-2 text-sm text-zinc-400">
                  <span className="hidden sm:inline">Demo:</span>
                  <button onClick={() => setNoPort((v) => !v)} className={`px-2 py-0.5 rounded border cursor-pointer text-sm ${noPort ? "border-amber-500/50 text-amber-400 bg-amber-500/10" : "border-zinc-200 dark:border-zinc-700 text-zinc-500"}`}>
                    no port
                  </button>
                  <button onClick={() => setHasConflict((v) => !v)} className={`px-2 py-0.5 rounded border cursor-pointer text-sm ${hasConflict ? "border-red-500/50 text-red-400 bg-red-500/10" : "border-zinc-200 dark:border-zinc-700 text-zinc-500"}`}>
                    conflict
                  </button>
                </div>}
                <RefreshButton onClick={() => { void loadDevices(); void loadUdevRules(); void loadArmTypes(); }} />
              </div>
            }
          />

          <div className="flex flex-col gap-6">
            <SubTabs
              tabs={[
                { key: "identify", label: "Arm Identify" },
                { key: "mapping", label: "Mapping" },
                { key: "setup", label: "Motor Setup" },
                { key: "monitor", label: "Motor Monitor" },
                { key: "calibration", label: "Calibration" },
              ]}
              activeKey={motorTab}
              onChange={setMotorTab}
              className="mx-auto"
            />

            {/* udev 규칙 상태 — 공통 */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm text-zinc-500">udev rules</span>
                <StatusBadge status={armRules.length > 0 ? "ready" : "warning"} label={armRules.length > 0 ? "Installed" : "Not installed"} />
              </div>
              <div className="flex items-center gap-3">

                <button
                  onClick={() => setUdevOpen(!udevOpen)}
                  className="text-sm text-zinc-400 hover:text-zinc-300 cursor-pointer"
                >
                  {udevOpen ? "Hide" : "Details"}
                </button>
              </div>
            </div>

            {udevOpen && (
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/30">
                      {["Port", "SYMLINK", "MODE", "STATUS"].map((h) => (
                        <th key={h} className="text-left py-1.5 px-3 text-zinc-400 font-normal">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
                    {armRules.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-3 px-3 text-sm text-zinc-500">No arm udev rules yet.</td>
                      </tr>
                    ) : armRules.map((row) => (
                      <tr key={`${row.kernel ?? "?"}-${row.symlink ?? "?"}`}>
                        <td className="py-1.5 px-3 font-mono text-zinc-500">{row.kernel ?? "-"}</td>
                        <td className="py-1.5 px-3 font-mono text-zinc-400">{row.symlink ?? "-"}</td>
                        <td className="py-1.5 px-3 font-mono text-zinc-500">{row.mode ?? "-"}</td>
                        <td className="py-1.5 px-3">
                          <span className={row.exists ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>
                            {row.exists ? "Active" : "Missing"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* ─── 팔 식별 탭 ────────────────────────────────────────────── */}
            {motorTab === "identify" && (
              <div className="flex flex-col gap-4">
                {arms.length === 0 ? (
                  <Card title={`Connected Arms (${arms.length})`}>
                    <EmptyState
                      icon={<Zap size={28} />}
                      message="No arms detected. Connect USB and refresh."
                      messageClassName="max-w-none whitespace-nowrap"
                    />
                  </Card>
                ) : (
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-col">
                    <div className="flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800">
                      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Connected Arms ({arms.length})</span>
                    </div>
                    <div className="px-4 flex-1">
                      <div className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800/50">
                        {arms.map((arm) => (
                          <div key={arm.device} className="flex items-center gap-3 py-2.5">
                            <div className="size-7 rounded bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                              <Bot size={14} className="text-zinc-500" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm text-zinc-700 dark:text-zinc-300 font-mono truncate">{arm.path}</div>
                              {arm.serial && <div className="text-sm text-zinc-400">S/N: {arm.serial}</div>}
                            </div>
                            <StatusBadge status={arm.symlink ? "ready" : "warning"} label={arm.symlink ?? "no symlink"} />
                          </div>
                        ))}
                      </div>
                    </div>

                    {identifyStep === "idle" && (
                      <div className="px-4 py-3 border-t border-zinc-100 dark:border-zinc-800/50 flex items-center gap-3">
                        <span className="text-sm text-zinc-500">Disconnect one arm from USB, then click Start.</span>
                        <button
                          onClick={() => setIdentifyStep("waiting")}
                          className="ml-auto px-4 py-2 rounded border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer whitespace-nowrap"
                        >
                          <Zap size={12} className="inline mr-1.5" />
                          Start Identify
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {identifyStep === "waiting" && (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2 px-3 py-2 rounded border border-amber-500/30 bg-amber-500/5">
                      <span className="size-2 rounded-full bg-amber-400 animate-pulse" />
                      <span className="text-sm text-amber-400">Reconnect the arm… Detecting changes (1.5s polling)</span>
                    </div>
                    <div className="flex items-center gap-3">
                      {import.meta.env.DEV && <button onClick={() => setIdentifyStep("found")} className="text-sm text-zinc-400 hover:text-zinc-600 cursor-pointer underline w-fit">
                        (Demo: detected)
                      </button>}
                      <button onClick={() => setIdentifyStep("idle")} className="text-sm text-red-400 hover:text-red-500 cursor-pointer w-fit">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {identifyStep === "found" && (
                  <div className="flex flex-col gap-3">
                    <div className="px-3 py-2.5 rounded border border-emerald-500/30 bg-emerald-500/5">
                      <p className="text-sm text-emerald-400 mb-1.5">✓ Arm detected. Assign a role below.</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <WireSelect value={identifyRole} options={ARM_ROLES} onChange={setIdentifyRole} />
                      <button
                        onClick={() => { setIdentifyStep("idle"); setIdentifyRole("(none)"); }}
                        disabled={identifyRole === "(none)"}
                        className="px-4 py-2 rounded-lg border border-emerald-500/50 bg-emerald-500/10 text-emerald-400 text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Assign
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ─── 매핑 탭 ───────────────────────────────────────────────── */}
            {motorTab === "mapping" && (
              <div className="flex flex-col gap-4">
                {arms.length === 0 ? (
                  <Card
                    title={`Arm Mapping (${arms.length})`}
                    action={
                      <span className="flex items-center gap-1 text-sm">
                        <span className="size-1.5 rounded-full bg-zinc-400" />
                        <span className="text-zinc-400">{mappedCount} / {arms.length} complete</span>
                      </span>
                    }
                  >
                    <EmptyState
                      icon={<Zap size={28} />}
                      message="No arms detected. Connect USB and refresh."
                      messageClassName="max-w-none whitespace-nowrap"
                    />
                  </Card>
                ) : (
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-col">
                    <div className="flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800">
                      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Arm Mapping ({arms.length})</span>
                      <span className="flex items-center gap-1 text-sm">
                        <span className={`size-1.5 rounded-full ${mappedCount === arms.length ? "bg-emerald-400" : "bg-zinc-400"}`} />
                        <span className="text-zinc-400">{mappedCount} / {arms.length} complete</span>
                      </span>
                    </div>
                    <div className="px-4 flex-1">
                      <div className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800/50">
                        {arms.map((arm) => (
                          <div key={arm.device} className="flex items-center gap-3 py-2.5">
                            <div className="size-7 rounded bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                              <Bot size={14} className="text-zinc-500" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm text-zinc-700 dark:text-zinc-300 font-mono truncate">{arm.path}</div>
                              {arm.serial && <div className="text-sm text-zinc-400">S/N: {arm.serial}</div>}
                            </div>
                            <div className="w-44 flex-none">
                              <WireSelect
                                value={armRoleMap[arm.device] ?? "(none)"}
                                options={["(none)", "Follower Arm 1", "Follower Arm 2", "Leader Arm 1", "Leader Arm 2"]}
                                onChange={(v) => {
                                  setArmRoleMap((prev) => ({ ...prev, [arm.device]: v }));
                                  setMappingApplied(false);
                                }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="px-4 py-3 border-t border-zinc-100 dark:border-zinc-800/50 flex items-center justify-end">
                      <button
                        onClick={() => { void applyArmMapping(); }}
                        disabled={mappingApplied || mappedCount === 0}
                        className="px-4 py-2 rounded border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Check size={12} className="inline mr-1" />
                        Apply
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ─── 모터 설정 탭 ──────────────────────────────────────────── */}
            {motorTab === "setup" && (
              <div className="flex flex-col gap-4">
                {!wizardRunning && !wizardAllDone && (
                    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-col">
                      <div className="flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800">
                        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Setup Configuration</span>
                      </div>
                      <div className="px-4 py-4 flex flex-col gap-3">
                        {(noPort || arms.length === 0) && <BlockerCard title="Setup Blocked" reasons={["Cannot detect port. Check USB connection."]} />}
                        {hasConflict && !noPort && (
                          <BlockerCard
                            title="Setup Blocked"
                            severity="error"
                            reasons={[{ text: "Teleop process is running", to: "/teleop" }]}
                          />
                        )}
                        <FieldRow label="Arm Role Type">
                          <WireSelect
                            value={setupArmType}
                            options={armTypes}
                            onChange={setSetupArmType}
                          />
                        </FieldRow>
                        <FieldRow label="Arm Port">
                          <WireSelect
                            placeholder={noPort || arms.length === 0 ? "No port detected" : undefined}
                            value={noPort || arms.length === 0 ? "" : setupPort}
                            options={noPort || arms.length === 0 ? [] : arms.map((a) => a.path ?? `/dev/${a.device}`)}
                            onChange={setSetupPort}
                          />
                        </FieldRow>
                        <div className="flex justify-end mt-2">
                          <button
                            onClick={() => { void handleSetupStart(); }}
                            disabled={noPort || hasConflict || arms.length === 0}
                            className="px-4 py-2 rounded border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                          >
                            <Play size={12} className="inline mr-1.5 fill-current" />
                            Start Motor Setup
                          </button>
                        </div>
                      </div>
                    </div>
                )}

                {wizardRunning && (
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-zinc-500 flex-none">Progress</span>
                      <div className="flex-1 h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
                        <div
                          className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                          style={{ width: `${(wizardMotorState.filter((s) => s === "done").length / SETUP_MOTORS.length) * 100}%` }}
                        />
                      </div>
                      <span className="text-sm text-zinc-400 flex-none font-mono">
                        {wizardMotorState.filter((s) => s === "done").length} / {SETUP_MOTORS.length}
                      </span>
                    </div>

                    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden divide-y divide-zinc-100 dark:divide-zinc-800/50">
                      {SETUP_MOTORS.map((motor, i) => {
                        const state = wizardMotorState[i];
                        const isCurrent = i === wizardStep && wizardRunning;
                        return (
                          <div
                            key={motor.name}
                            className={cn(
                              "flex items-center gap-3 px-4 py-2.5 transition-colors",
                              isCurrent && "bg-emerald-500/5 dark:bg-emerald-500/10",
                              state === "done" && "opacity-60"
                            )}
                          >
                            <div className="flex-none">
                              {state === "done" && <Check size={16} className="text-emerald-500" />}
                              {state === "writing" && <Loader2 size={16} className="text-emerald-400 animate-spin" />}
                              {state === "waiting" && <Circle size={16} className="text-emerald-400 fill-emerald-400/20" />}
                              {state === "error" && <AlertCircle size={16} className="text-red-500" />}
                              {state === "pending" && <Circle size={16} className="text-zinc-300 dark:text-zinc-600" />}
                            </div>
                            <span className={cn("text-sm font-mono flex-1", isCurrent ? "text-zinc-800 dark:text-zinc-100 font-medium" : "text-zinc-500")}>
                              {motor.name}
                            </span>
                            <span className="text-sm text-zinc-400 font-mono flex-none">ID {motor.id}</span>
                            {state === "done" && <span className="text-xs text-emerald-400 flex-none">Configured</span>}
                            {state === "writing" && <span className="text-xs text-emerald-400 flex-none">Writing EEPROM…</span>}
                            {state === "error" && <span className="text-xs text-red-500 flex-none">Failed</span>}
                          </div>
                        );
                      })}
                    </div>

                    {!wizardError && wizardMotorState[wizardStep] === "waiting" && (
                      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 flex flex-col gap-3">
                        <div className="flex items-center gap-2">
                          <span className="size-2 rounded-full bg-emerald-400 animate-pulse flex-none" />
                          <p className="text-sm text-emerald-400">
                            <span className="font-medium">'{SETUP_MOTORS[wizardStep].name}'</span> motor only connected, then click below
                          </p>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                          <FieldRow label="Detected ID">
                            <WireInput value={wizardDetectedId} onChange={setWizardDetectedId} placeholder="e.g., 1" />
                          </FieldRow>
                          <FieldRow label="Target ID">
                            <WireInput value={String(SETUP_MOTORS[wizardStep].id)} />
                          </FieldRow>
                          <FieldRow label="Baud Rate">
                            <WireSelect value={wizardBaudRate} options={["1000000", "2000000", "3000000"]} onChange={setWizardBaudRate} />
                          </FieldRow>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <button
                            onClick={() => setWizardDetectedId(String((wizardStep + 1) * 11))}
                            className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-500 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800"
                          >
                            Auto-fill detected value
                          </button>
                          <WireToggle label="Only current motor connected" checked={wizardConnectionConfirmed} onChange={setWizardConnectionConfirmed} />
                        </div>
                        <button
                          onClick={wizardPressEnter}
                          disabled={!wizardConnectionConfirmed || !wizardDetectedId.trim()}
                          className="w-full px-4 py-3 rounded-lg border border-emerald-500/50 bg-emerald-500/10 text-emerald-400 text-sm font-medium cursor-pointer hover:bg-emerald-500/20 transition-colors flex items-center justify-center gap-2"
                        >
                          <CornerDownLeft size={14} /> Connection Complete (Enter)
                        </button>
                      </div>
                    )}

                    {wizardMotorState[wizardStep] === "writing" && (
                      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 flex items-center gap-3">
                        <Loader2 size={16} className="text-zinc-400 animate-spin flex-none" />
                        <p className="text-sm text-zinc-400">
                          '{SETUP_MOTORS[wizardStep].name}' motor writing ID {SETUP_MOTORS[wizardStep].id} / Baud {wizardBaudRate}…
                        </p>
                      </div>
                    )}

                    {wizardError && (
                      <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-2 flex items-center gap-3">
                        <AlertCircle size={14} className="text-red-500 flex-none" />
                        <p className="text-sm text-red-400 flex-1">{wizardError}</p>
                        <button onClick={wizardRetry} className="flex-none px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-500 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800 flex items-center gap-2">
                          <RotateCcw size={12} /> Retry
                        </button>
                      </div>
                    )}

                    {import.meta.env.DEV && (
                    <div className="flex items-center gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                      <span className="text-xs text-zinc-400">Demo:</span>
                      <button
                        onClick={wizardSimulateError}
                        disabled={wizardMotorState[wizardStep] !== "waiting"}
                        className="text-xs px-2 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-500 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        Simulate Error
                      </button>
                      <button
                        onClick={() => {
                          setWizardRunning(false);
                          setWizardMotorState(SETUP_MOTORS.map(() => "pending"));
                          setWizardStep(0);
                          setWizardError(null);
                          setWizardDetectedId("");
                          setWizardBaudRate("1000000");
                          setWizardConnectionConfirmed(false);
                        }}
                        className="text-xs px-2 py-0.5 rounded border border-red-500/30 text-red-500 cursor-pointer"
                      >
                        Stop
                      </button>
                    </div>
                    )}
                  </div>
                )}

                {!wizardRunning && wizardAllDone && (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                      <Check size={16} className="text-emerald-500" />
                      <p className="text-sm text-emerald-400 font-medium">
                        Motor setup complete — 6 motor IDs written to EEPROM
                      </p>
                    </div>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                      {SETUP_MOTORS.map((m) => (
                        <div key={m.name} className="text-center px-2 py-1.5 rounded bg-white dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700">
                          <div className="text-xs text-zinc-400 truncate">{m.name}</div>
                          <div className="text-sm font-mono text-zinc-700 dark:text-zinc-300">ID {m.id}</div>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        onClick={() => {
                          setWizardMotorState(SETUP_MOTORS.map(() => "pending"));
                          setWizardStep(0);
                          setWizardError(null);
                          setWizardDetectedId("");
                          setWizardBaudRate("1000000");
                          setWizardConnectionConfirmed(false);
                        }}
                        className="px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-500 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800"
                      >
                        Run Again
                      </button>
                      <button
                        onClick={() => setMotorTab("monitor")}
                        className="px-4 py-2 rounded-lg border border-emerald-500/50 bg-emerald-500/10 text-emerald-400 text-sm cursor-pointer"
                      >
                        Verify with Motor Monitor →
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ─── 모터 모니터 탭 ─────────────────────────────────────────── */}
            {motorTab === "monitor" && (
              <div className="flex flex-col gap-4">
                {/* Connection bar */}
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2 bg-zinc-50 dark:bg-zinc-800/30">
                    <WireToggle label="Freewheel" checked={freewheel} onChange={handleFreewheelToggle} />
                    <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-700 flex-none" />
                    <span className="text-sm text-zinc-500 flex-none">Port</span>
                    <div className="flex-1 min-w-0">
                      <WireSelect
                        value={monPort}
                        options={arms.length > 0 ? arms.map((a) => a.path ?? `/dev/${a.device}`) : [monPort]}
                        onChange={(v) => { if (!monConnected) setMonPort(v); }}
                      />
                    </div>
                    {!monConnected ? (
                      <button
                        onClick={() => { void handleMonConnect(); }}
                        disabled={monConnecting || !monPort || setupRunning}
                        title={setupRunning ? "Motor Setup is running — stop it first" : ""}
                        className="px-4 py-2 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 text-sm cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                      >
                        {monConnecting ? "Connecting…" : <><Zap size={12} className="inline mr-1" />Connect</>}
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => { void handleEmergencyStop(); }}
                          className="px-3 py-2 rounded-lg border border-red-500/50 bg-red-500/10 text-red-400 text-sm cursor-pointer whitespace-nowrap"
                        >
                          ⛔ E-Stop
                        </button>
                        <button
                          onClick={() => { void handleMonDisconnect(); }}
                          className="px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-500 text-sm cursor-pointer whitespace-nowrap"
                        >
                          Disconnect
                        </button>
                      </>
                    )}
                  </div>

                  {monConnected && (
                    <div className="px-3 py-2 border-t border-zinc-100 dark:border-zinc-800/50 flex items-center gap-2">
                      <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      <span className="text-sm text-zinc-400">{monPortLabel} · {monMotors.length} motors · polling 100ms</span>
                    </div>
                  )}
                </div>

                {monError && (
                  <div className="px-3 py-2 rounded border border-red-500/30 bg-red-500/5 text-sm text-red-400">
                    <AlertTriangle size={14} className="inline mr-1 shrink-0" />{monError}
                  </div>
                )}

                {monConnected && freewheel && (
                  <div className="px-3 py-2 rounded border border-amber-500/30 bg-amber-500/5 text-sm text-amber-400">
                    <span className="block flex items-center gap-1"><AlertTriangle size={14} className="shrink-0" />Freewheel enabled</span>
                    <span className="text-sm text-amber-400/60 block mt-0.5">Motor lock released. Move button disabled.</span>
                  </div>
                )}

                {monConnected && monMotors.length > 0 && (
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                    {monMotors.map((m) => (
                      <MotorCard
                        key={m.id}
                        motor={m}
                        freewheel={freewheel}
                        onMove={handleMoveMotor}
                        onClearCollision={handleClearCollision}
                        onTargetChange={handleTargetChange}
                      />
                    ))}
                  </div>
                )}

                {!monConnected && !monConnecting && (
                  <Card title="Real-time Motor Status">
                    <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
                      <div className="text-3xl opacity-30">
                        <Zap size={28} />
                      </div>
                      <p className="text-sm text-zinc-400">
                        {setupRunning
                          ? "Motor Setup is running. Stop it first."
                          : "Connect to port to see motor status (100ms polling)"}
                      </p>
                    </div>
                  </Card>
                )}
              </div>
            )}

            {/* ─── 캘리브레이션 탭 ──────────────────────────────────────── */}
            {motorTab === "calibration" && (
              <div className="flex flex-col gap-6">
                {arms.length === 0 && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/5">
                    <AlertTriangle size={13} className="text-amber-600 dark:text-amber-400 flex-none" />
                    <span className="text-sm text-amber-600 dark:text-amber-400 flex-1">No connected devices. Connect USB and refresh.</span>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <ModeToggle options={["Single Arm", "Bi-Arm"]} value={calibMode} onChange={setCalibMode} />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <Card title={calibMode === "Single Arm" ? "Single Arm Setup" : "Bi-Arm Setup"}>
                    <div className="flex flex-col gap-3">
                      {calibMode === "Single Arm" ? (
                        <>
                          {calibTypeMismatch && (
                            <div className="flex items-center gap-1.5 text-sm text-amber-400 px-1">
                              <AlertTriangle size={12} className="flex-none" />
                              Type and port do not match
                            </div>
                          )}
                          <FieldRow label="Arm Role Type">
                            <WireSelect value={calibArmType} options={armTypes} onChange={setCalibArmType} disabled={arms.length === 0} />
                          </FieldRow>
                          <FieldRow label="Arm Port">
                            <WireSelect
                              placeholder={calibPortOptions.length === 0 ? "No port detected" : undefined}
                              value={calibPort}
                              options={calibPortOptions}
                              onChange={setCalibPort}
                              disabled={arms.length === 0}
                            />
                          </FieldRow>
                          <FieldRow label="Arm ID">
                            <WireSelect
                              placeholder={calibArmIdOptions.length === 0 ? "No calibration files" : undefined}
                              value={calibArmId}
                              options={calibArmIdOptions}
                              onChange={setCalibArmId}
                              disabled={arms.length === 0}
                            />
                          </FieldRow>
                        </>
                      ) : (
                        <>
                          <FieldRow label="Arm Role Type">
                            <WireSelect value={calibBiType} options={["bi_so_follower", "bi_so_leader"]} onChange={setCalibBiType} disabled={arms.length === 0} />
                          </FieldRow>
                          <FieldRow label="Left Arm Port">
                            <WireSelect
                              placeholder={calibPortOptions.length === 0 ? "No port detected" : undefined}
                              value={calibBiLeftPort}
                              options={calibPortOptions}
                              onChange={setCalibBiLeftPort}
                              disabled={arms.length === 0}
                            />
                          </FieldRow>
                          <FieldRow label="Right Arm Port">
                            <WireSelect
                              placeholder={calibPortOptions.length === 0 ? "No port detected" : undefined}
                              value={calibBiRightPort}
                              options={calibPortOptions}
                              onChange={setCalibBiRightPort}
                              disabled={arms.length === 0}
                            />
                          </FieldRow>
                          <FieldRow label="Arm ID">
                            <WireInput value={calibBiId} onChange={setCalibBiId} disabled={arms.length === 0} />
                          </FieldRow>
                        </>
                      )}
                      <div className="flex justify-end">
                        {!calibrateRunning ? (
                          <button
                            type="button"
                            onClick={() => { void handleCalibrationStart(); }}
                            disabled={calibTypeMismatch || arms.length === 0}
                            className={`px-4 py-2 rounded border text-sm cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${calibTypeMismatch || arms.length === 0 ? "border-zinc-600 text-zinc-500 cursor-not-allowed" : "border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"}`}
                          >
                            <Play size={13} className="fill-current" /> Start Calibration
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => { void handleCalibrationStop(); }}
                            className="px-4 py-2 rounded border border-red-500/30 text-sm text-red-500 hover:bg-red-500/10 cursor-pointer whitespace-nowrap flex items-center gap-1.5"
                          >
                            <Square size={11} className="fill-current" /> Stop
                          </button>
                        )}
                      </div>
                    </div>
                  </Card>

                  <Card title="Existing Calibration Files" className="min-h-[300px]">
                    {calibFiles.length === 0 ? (
                      <div className="flex min-h-[220px] items-center justify-center">
                        <EmptyState icon={<Ruler size={28} />} message="No calibration files." />
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {calibFiles.map((file) => (
                          <div key={`${file.id}-${file.guessed_type ?? "unknown"}`} className="group flex items-center gap-2 p-2 rounded border border-zinc-200 dark:border-zinc-700">
                            <div className="flex-1 min-w-0">
                              <div className="text-sm text-zinc-700 dark:text-zinc-300 font-mono truncate">{file.id}</div>
                              <div className="text-xs text-zinc-400 truncate">
                                {(file.guessed_type ?? "unknown")} · {(file.modified ?? "-")}
                              </div>
                            </div>
                            <button
                              onClick={(e) => { e.stopPropagation(); void handleCalibrationDelete(file); }}
                              className="p-1 text-zinc-300 dark:text-zinc-600 hover:text-red-400 cursor-pointer"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}
