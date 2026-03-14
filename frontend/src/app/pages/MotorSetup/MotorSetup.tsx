import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  PageHeader,
  RefreshButton,
  SubTabs,
} from "../../components/wireframe";
import { UdevInstallGate } from "../../components/UdevInstallGate";
import { apiDelete, apiGet, apiPost } from "../../services/apiClient";
import { buildCalibrationListEntries } from "../../services/calibrationProfiles";
import { symToDisplayLabel, buildPortOptions } from "../../services/portLabels";
import { useLeStudioStore } from "../../store";
import type { LogLine } from "../../store/types";
import { SETUP_MOTORS, ARM_TYPES, MOTOR_SETUP_TYPES, toArmSymlink } from "./constants";
import { MotorCard } from "./components/MotorCard";
import { MappingTabPanel } from "./components/MappingTabPanel";
import { IdentifyArmModal } from "./components/IdentifyArmModal";
import { SetupTabPanel } from "./components/SetupTabPanel";
import { MonitorTabPanel } from "./components/MonitorTabPanel";
import { CalibrationTabPanel } from "./components/CalibrationTabPanel";
import type {
  ActionResponse,
  ArmDevice,
  CalibrationFileItem,
  CalibrationFileStatusResponse,
  CalibrationListResponse,
  DeviceResponse,
  MotorConnectResponse,
  MotorData,
  MotorPositionsResponse,
  RulesResponse,
} from "./types";

const ARM_ROLE_OPTIONS = ["Follower Arm 1", "Follower Arm 2", "Leader Arm 1", "Leader Arm 2"];
const CALIBRATION_FILE_SCOPE_OPTIONS = ["Single", "Bi"] as const;
type WizardMotorState = "pending" | "waiting" | "writing" | "done" | "error";

const MOTOR_PROMPT_RE = /Connect the controller board to the '([^']+)' motor only and press enter\./i;
const MOTOR_DONE_RE = /'([^']+)' motor id set to (\d+)/i;
const MOTOR_FOUND_RE = /Found one motor on baudrate=(\d+) with id_?=(\d+)/i;
const MOTOR_BAUD_RE = /Setting bus baud rate to (\d+)/i;
const MOTOR_ERROR_RE = /(Traceback|ConnectionError:|RuntimeError:|NotImplementedError|Failed to write|Error:)/i;
const MOTOR_EVENT_PREFIX = "[MOTOR_SETUP_EVENT] ";

type MotorSetupEvent = {
  event: string;
  motor?: string;
  target_id?: number | string;
  detected_id?: number | string;
  baud_rate?: number | string;
  message?: string;
};

function parseMotorSetupEvent(text: string): MotorSetupEvent | null {
  if (!text.startsWith(MOTOR_EVENT_PREFIX)) return null;
  try {
    return JSON.parse(text.slice(MOTOR_EVENT_PREFIX.length)) as MotorSetupEvent;
  } catch {
    return null;
  }
}

function parseMotorSetupLogs(lines: LogLine[]) {
  const states: WizardMotorState[] = SETUP_MOTORS.map(() => "pending");
  let currentStep = 0;
  let detectedId = "";
  let baudRate = "";
  let promptText = "";
  let error: string | null = null;

  for (const line of lines) {
    const text = line.text.trim();
    const event = parseMotorSetupEvent(text);
    if (event) {
      if (event.event === "detected") {
        if (event.baud_rate !== undefined) baudRate = String(event.baud_rate);
        if (event.detected_id !== undefined) detectedId = String(event.detected_id);
      }
      if (event.event === "baud_rate" && event.baud_rate !== undefined) {
        baudRate = String(event.baud_rate);
      }
      if (event.event === "prompt" && event.motor) {
        const idx = SETUP_MOTORS.findIndex((motor) => motor.name === event.motor);
        if (idx >= 0) {
          currentStep = idx;
          if (states[idx] !== "done") states[idx] = "waiting";
          promptText = event.message ?? `Connect only '${event.motor}' and press ENTER.`;
        }
      }
      if (event.event === "configured" && event.motor) {
        const idx = SETUP_MOTORS.findIndex((motor) => motor.name === event.motor);
        if (idx >= 0) {
          states[idx] = "done";
          const nextPending = states.findIndex((state) => state === "pending");
          currentStep = nextPending >= 0 ? nextPending : idx;
        }
      }
      if (event.event === "error" && event.message) {
        error = event.message;
      }
      continue;
    }

    const foundMatch = text.match(MOTOR_FOUND_RE);
    if (foundMatch) {
      baudRate = foundMatch[1];
      detectedId = foundMatch[2];
    }

    const baudMatch = text.match(MOTOR_BAUD_RE);
    if (baudMatch) {
      baudRate = baudMatch[1];
    }

    const promptMatch = text.match(MOTOR_PROMPT_RE);
    if (promptMatch) {
      const promptMotor = promptMatch[1];
      const idx = SETUP_MOTORS.findIndex((motor) => motor.name === promptMotor);
      if (idx >= 0) {
        currentStep = idx;
        if (states[idx] !== "done") states[idx] = "waiting";
        promptText = text;
      }
    }

    const doneMatch = text.match(MOTOR_DONE_RE);
    if (doneMatch) {
      const doneMotor = doneMatch[1];
      const idx = SETUP_MOTORS.findIndex((motor) => motor.name === doneMotor);
      if (idx >= 0) {
        states[idx] = "done";
        const nextPending = states.findIndex((state) => state === "pending");
        currentStep = nextPending >= 0 ? nextPending : idx;
      }
    }

    if ((line.kind === "error" || line.kind === "stderr") && MOTOR_ERROR_RE.test(text)) {
      error = text;
    }
  }

  if (!promptText) {
    const waitingIdx = states.findIndex((state) => state === "waiting");
    if (waitingIdx >= 0) {
      promptText = `Connect only '${SETUP_MOTORS[waitingIdx].name}' and press ENTER.`;
      currentStep = waitingIdx;
    }
  }

  const allDone = states.every((state) => state === "done");
  return { states, currentStep, detectedId, baudRate, promptText, error, allDone };
}

function alignArmTypeToRole(currentType: string, role: "leader" | "follower", availableTypes: string[]): string {
  if (currentType.includes(role)) return currentType;

  const swapped = currentType
    .replace("_leader", `_${role}`)
    .replace("_follower", `_${role}`);
  if (availableTypes.includes(swapped)) return swapped;

  const familyPrefix = currentType.split("_").slice(0, -1).join("_");
  const familyMatch = availableTypes.find((type) => type.startsWith(`${familyPrefix}_`) && type.endsWith(`_${role}`));
  if (familyMatch) return familyMatch;

  const fallback = availableTypes.find((type) => type.endsWith(`_${role}`));
  return fallback ?? currentType;
}

function detectArmRoleText(text: string): "leader" | "follower" | null {
  if (text.includes("leader")) return "leader";
  if (text.includes("follower")) return "follower";
  return null;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function MotorSetup() {
  const procStatus = useLeStudioStore((s) => s.procStatus);
  const setProcStatus = useLeStudioStore((s) => s.setProcStatus);
  const appendLog = useLeStudioStore((s) => s.appendLog);
  const clearLog = useLeStudioStore((s) => s.clearLog);
  const addToast = useLeStudioStore((s) => s.addToast);
  const motorSetupLogLines = useLeStudioStore((s) => s.logLines.motor_setup);
  const globalDevices = useLeStudioStore((s) => s.devices);
  const prevDeviceCountRef = useRef({ cameras: -1, arms: -1 });

  // ── Device data ──────────────────────────────────────────────────────────
  const [arms, setArms] = useState<ArmDevice[]>([]);

  // ── Motor Setup (CLI) ────────────────────────────────────────────────────
  const setupRunning = Boolean(procStatus.motor_setup);
  const calibrateRunning = Boolean(procStatus.calibrate);
  const setupReconnected = useLeStudioStore((s) => !!s.procReconnected.motor_setup);
  const calibrateReconnected = useLeStudioStore((s) => !!s.procReconnected.calibrate);
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
  const [calibFileScope, setCalibFileScope] = useState<(typeof CALIBRATION_FILE_SCOPE_OPTIONS)[number]>("Single");
  const [calibSelectedFileStatus, setCalibSelectedFileStatus] = useState<CalibrationFileStatusResponse | null>(null);
  const [calibrationAssistantStage, setCalibrationAssistantStage] = useState<"idle" | "choose_file" | "center_arm" | "record_range" | "finishing">("idle");

  // ── Setup Wizard ──────────────────────────────────────────────────────────
  const [wizardRunning, setWizardRunning] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [wizardMotorState, setWizardMotorState] = useState<WizardMotorState[]>(
    SETUP_MOTORS.map(() => "pending")
  );
  const [wizardError, setWizardError] = useState<string | null>(null);

  // ── Mapping tab ───────────────────────────────────────────────────────────
  const [armRoleMap, setArmRoleMap] = useState<Record<string, string>>({});
  const [autoApplying, setAutoApplying] = useState(false);
  const autoApplyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Snapshot of the last successfully applied arm mapping (tracks udev state). */
  const lastAppliedArmMapRef = useRef<Record<string, string>>({});

  // ── UI state ──────────────────────────────────────────────────────────────
  const [motorTab, setMotorTab] = useState("mapping");
  const [identifyModalOpen, setIdentifyModalOpen] = useState(false);
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
      const symToLabel = Object.fromEntries(
        ARM_ROLE_OPTIONS.map((label) => [label.toLowerCase().replace(/ /g, "_"), label]),
      );
      const initialMap: Record<string, string> = {};
      for (const arm of nextArms) {
        initialMap[arm.device] = arm.symlink && symToLabel[arm.symlink] ? symToLabel[arm.symlink] : "(none)";
      }
      setArmRoleMap((prev) => {
        const next = { ...prev };
        for (const [device, role] of Object.entries(initialMap)) {
          if (!(device in next)) {
            next[device] = role;
          }
        }
        return next;
      });
      lastAppliedArmMapRef.current = initialMap;
    } catch {
      // ignore
    }
  }, []);

  const loadArmTypes = useCallback(async () => {
    try {
      const res = await apiGet<{ types?: string[] }>("/api/robots");
      if (Array.isArray(res.types) && res.types.length > 0) {
        const dynamicTypes = res.types
          .filter((type): type is string => typeof type === "string")
          .filter((type) => type.includes("_leader") || type.includes("_follower") || type === "lekiwi");
        const merged = Array.from(new Set([...ARM_TYPES, ...dynamicTypes]));
        setArmTypes(merged);
      }
    } catch {
      // keep defaults
    }
  }, []);

  useEffect(() => {
    void loadDevices();
    void loadArmTypes();
  }, [loadDevices, loadArmTypes]);

  useEffect(() => {
    if (identifyModalOpen) return;
    const prev = prevDeviceCountRef.current;
    const camCount = globalDevices.cameras.length;
    const armCount = globalDevices.arms.length;
    if (prev.cameras !== camCount || prev.arms !== armCount) {
      prevDeviceCountRef.current = { cameras: camCount, arms: armCount };
      if (prev.cameras >= 0) {
        void loadDevices();
      }
    }
  }, [globalDevices, identifyModalOpen, loadDevices]);

  // Auto-select port matching arm type keyword (follower/leader)
  const findPortByKeyword = useCallback(
    (keyword: string) => {
      const match = keyword
        ? arms.find((a) => (a.symlink ?? a.device ?? "").toLowerCase().includes(keyword))
        : undefined;
      const best = match ?? arms[0];
      return best ? (best.path ?? `/dev/${best.device ?? "ttyUSB0"}`) : "";
    },
    [arms],
  );

  useEffect(() => {
    if (arms.length === 0) return;
    const keyword = setupArmType.includes("follower") ? "follower" : setupArmType.includes("leader") ? "leader" : "";
    const p = findPortByKeyword(keyword);
    setSetupPort(p);
    if (!monConnected) setMonPort(p);
  }, [arms, setupArmType, monConnected, findPortByKeyword]);

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

  const handleSetupStart = useCallback(async () => {
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
      setProcStatus({ ...procStatus, motor_setup: true });
      addToast("Motor setup started", "success");
      setHasRun(true);
      startWizard();
    }
  }, [addToast, appendLog, clearLog, procStatus, setProcStatus, setupArmType, setupPort]);

  const handleSetupStop = useCallback(async () => {
    const res = await apiPost<ActionResponse>("/api/process/motor_setup/stop", {});
    if (!res.ok) {
      addToast(res.error ?? "Motor setup stop failed", "error");
      return;
    }
    setProcStatus({ ...procStatus, motor_setup: false });
    setWizardRunning(false);
    resetWizardState();
    addToast("Motor setup stopped", "success");
  }, [addToast, procStatus, setProcStatus]);

  const refreshCalibrationList = useCallback(async () => {
    try {
      const res = await apiGet<CalibrationListResponse>("/api/calibrate/list");
      const files = Array.isArray(res.files) ? res.files : [];
      setCalibFiles(files);
    } catch {
      setCalibFiles([]);
    }
  }, []);

  const filteredCalibFiles = useMemo(() => {
    return buildCalibrationListEntries(calibFiles, calibFileScope);
  }, [calibFileScope, calibFiles]);

  const refreshCalibrationFileStatus = useCallback(async () => {
    const selectedType = calibMode === "Bi-Arm" ? calibBiType : calibArmType;
    const selectedId = (calibMode === "Bi-Arm" ? calibBiId : calibArmId).trim();
    if (!selectedType || !selectedId) {
      setCalibSelectedFileStatus(null);
      return;
    }
    try {
      const status = await apiGet<CalibrationFileStatusResponse>(
        `/api/calibrate/file?robot_type=${encodeURIComponent(selectedType)}&robot_id=${encodeURIComponent(selectedId)}`,
      );
      setCalibSelectedFileStatus(status);
    } catch {
      setCalibSelectedFileStatus(null);
    }
  }, [calibArmId, calibArmType, calibBiId, calibBiType, calibMode]);

  useEffect(() => {
    void refreshCalibrationList();
  }, [refreshCalibrationList]);

  useEffect(() => {
    void refreshCalibrationFileStatus();
  }, [refreshCalibrationFileStatus]);

  useEffect(() => {
    setCalibFileScope(calibMode === "Bi-Arm" ? "Bi" : "Single");
  }, [calibMode]);

  // Auto-refresh calibration file list when calibrate process finishes
  const prevCalibrateRunning = useRef(false);
  useEffect(() => {
    if (prevCalibrateRunning.current && !calibrateRunning) {
      void refreshCalibrationList();
      void refreshCalibrationFileStatus();
      setCalibrationAssistantStage("idle");
    }
    if (!prevCalibrateRunning.current && calibrateRunning && calibrationAssistantStage === "idle") {
      const selectedExists = Boolean(calibSelectedFileStatus?.exists);
      setCalibrationAssistantStage(selectedExists ? "choose_file" : "center_arm");
    }
    prevCalibrateRunning.current = calibrateRunning;
  }, [calibSelectedFileStatus?.exists, calibrateRunning, calibrationAssistantStage, refreshCalibrationList, refreshCalibrationFileStatus]);

  const handleCalibrationStart = async () => {
    if (calibMode === "Single Arm" && calibFileNameError) {
      addToast(calibFileNameError, "error");
      return;
    }

    if (calibMode === "Single Arm" && calibTypeMismatch) {
      addToast("Calibration type does not match the selected port. Choose a leader type for a leader arm, or a follower type for a follower arm.", "error");
      return;
    }

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
          robot_id: calibArmId.trim(),
          port: calibPort,
        };

    clearLog("calibrate");
    const res = await apiPost<ActionResponse>("/api/calibrate/start", payload);
    if (!res.ok) {
      addToast(res.error ?? "Calibration start failed", "error");
      appendLog("calibrate", `[ERROR] ${res.error ?? "failed to start calibration"}`, "error");
      return;
    }

    addToast("Calibration started", "success");
    appendLog("calibrate", "[info] calibration started", "info");
    setCalibrationAssistantStage(Boolean(calibSelectedFileStatus?.exists) ? "choose_file" : "center_arm");
  };

  const handleCalibrationStop = async () => {
    const res = await apiPost<ActionResponse>("/api/process/calibrate/stop", {});
    if (!res.ok) {
      addToast(res.error ?? "Calibration stop failed", "error");
      return;
    }
    setProcStatus({ ...procStatus, calibrate: false });
    setCalibrationAssistantStage("idle");
    addToast("Calibration stopped", "success");
    await refreshCalibrationList();
    await refreshCalibrationFileStatus();
  };

  const handleCalibrationDelete = async (file: CalibrationFileItem) => {
    const noun = file.shared_profile ? "calibration profile" : "calibration file";
    if (!window.confirm(`Delete ${noun}?\n\n${file.id}\n\nThis cannot be undone.`)) return;
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

  const handleCalibrationInput = useCallback(async (text: string, nextStage?: "choose_file" | "center_arm" | "record_range" | "finishing") => {
    const res = await apiPost<ActionResponse>("/api/process/calibrate/input", { text });
    if (!res.ok) {
      addToast(res.error ?? "Failed to send calibration input", "error");
      return;
    }
    if (nextStage) {
      setCalibrationAssistantStage(nextStage);
    }
  }, [addToast]);

  const applyArmMapping = useCallback(async (roleMap: Record<string, string>) => {
    setAutoApplying(true);

    try {
      const currentRules = await apiGet<RulesResponse>("/api/udev/rules")
        .catch(() => apiGet<RulesResponse>("/api/rules/current"));

      // Preserve existing arm rules (includes disconnected arms)
      const armAssignments: Record<string, string> = {};
      for (const rule of Array.isArray(currentRules.arm_rules) ? currentRules.arm_rules : []) {
        const serial = String(rule.serial ?? "").trim();
        const role = String(rule.symlink ?? "").trim();
        if (serial && role && role !== "(none)") {
          armAssignments[serial] = role;
        }
      }

      for (const arm of arms) {
        if (!arm.serial) continue;
        const roleLabel = roleMap[arm.device] ?? "(none)";
        armAssignments[arm.serial] = toArmSymlink(roleLabel);
      }

      // Clear the target role from any other arm to prevent duplicate SYMLINK
      for (const arm of arms) {
        if (!arm.serial) continue;
        const symlink = toArmSymlink(roleMap[arm.device] ?? "(none)");
        if (symlink === "(none)") continue;
        for (const [serial, role] of Object.entries(armAssignments)) {
          if (role === symlink && serial !== arm.serial) {
            armAssignments[serial] = "(none)";
          }
        }
      }

      const cameraAssignments: Record<string, string> = {};
      for (const rule of Array.isArray(currentRules.camera_rules) ? currentRules.camera_rules : []) {
        const kernels = (rule.kernel ?? "").trim();
        const role = (rule.symlink ?? "").trim();
        if (kernels && role && role !== "(none)") {
          cameraAssignments[kernels] = role;
        }
      }

      const result = await apiPost<ActionResponse>("/api/rules/apply", {
        assignments: cameraAssignments,
        arm_assignments: armAssignments,
      });

      if (!result.ok) {
        addToast(result.error ?? "Failed to apply arm mapping.", "error");
        setArmRoleMap({ ...lastAppliedArmMapRef.current });
        return;
      }

      lastAppliedArmMapRef.current = { ...roleMap };
      await loadDevices();

      setArmRoleMap((prev) => {
        const merged = { ...prev };
        for (const [device, role] of Object.entries(roleMap)) {
          if (role !== "(none)" && (merged[device] === "(none)" || !merged[device])) {
            merged[device] = role;
          }
        }
        return merged;
      });
    } catch {
      addToast("Failed to apply arm mapping.", "error");
      setArmRoleMap({ ...lastAppliedArmMapRef.current });
    } finally {
      setAutoApplying(false);
    }
  }, [addToast, arms, loadDevices]);

  const scheduleAutoApply = useCallback((nextMap: Record<string, string>) => {
    if (autoApplyTimerRef.current) clearTimeout(autoApplyTimerRef.current);
    autoApplyTimerRef.current = setTimeout(() => {
      void applyArmMapping(nextMap);
    }, 400);
  }, [applyArmMapping]);

  useEffect(() => {
    return () => {
      if (autoApplyTimerRef.current) clearTimeout(autoApplyTimerRef.current);
    };
  }, []);

  // ─── Setup Wizard helpers ──────────────────────────────────────────────────

  const startWizard = () => {
    setWizardRunning(true);
    setWizardStep(0);
    setWizardMotorState(SETUP_MOTORS.map(() => "pending"));
    setWizardError(null);
  };

  const wizardPressEnter = async () => {
    if (!wizardRunning) return;

    const stdinRes = await apiPost<ActionResponse>("/api/process/motor_setup/input", { text: "" });
    if (!stdinRes.ok) {
      const reason = stdinRes.error ?? "Failed to send ENTER to motor_setup process";
      setWizardError(reason);
      addToast(reason, "error");
      return;
    }
    setWizardMotorState((prev) => prev.map((state, idx) => (
      idx === wizardStep && state !== "done" ? "writing" : state
    )));
    setWizardError(null);
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

  const resetWizardState = () => {
    setWizardMotorState(SETUP_MOTORS.map(() => "pending"));
    setWizardStep(0);
    setWizardError(null);
  };

  const exitWizard = useCallback(() => {
    setWizardRunning(false);
    resetWizardState();
  }, []);

  const restartWizard = useCallback(async () => {
    exitWizard();
    await handleSetupStart();
  }, [exitWizard, handleSetupStart]);

  const wizardAllDone = wizardMotorState.every((s) => s === "done");
  const setupProcessActive = setupRunning || setupReconnected;

  const monPortArm = arms.find((a) => a.path === monPort);
  const monPortLabel = monPortArm?.symlink ? symToDisplayLabel(monPortArm.symlink) : monPort;
  const selectedCalibArm = arms.find((arm) => arm.path === calibPort);
  const selectedCalibArmRole = detectArmRoleText(`${selectedCalibArm?.symlink ?? ""} ${selectedCalibArm?.device ?? ""}`.toLowerCase());

  const calibTypeMismatch =
    calibMode === "Single Arm" &&
    ((calibArmType.includes("follower") && selectedCalibArmRole === "leader") ||
      (calibArmType.includes("leader") && selectedCalibArmRole === "follower"));

  /** Port options with symlink labels for all port dropdowns */
  const portOptions = useMemo(() => buildPortOptions(arms), [arms]);
  const hasAnyArmMapping = useMemo(
    () => Object.values(armRoleMap).some((role) => role !== "(none)"),
    [armRoleMap],
  );

  const handleClearAllArmMappings = useCallback(() => {
    if (autoApplyTimerRef.current) clearTimeout(autoApplyTimerRef.current);
    const cleared: Record<string, string> = {};
    for (const key of Object.keys(armRoleMap)) {
      cleared[key] = "(none)";
    }
    setArmRoleMap(cleared);
    void applyArmMapping(cleared);
  }, [applyArmMapping, armRoleMap]);

  const ARM_SYMLINK_RE = /^(follower|leader)_arm_\d+$/i;
  const mappedArms = useMemo(() => arms.filter((a) => a.symlink && ARM_SYMLINK_RE.test(a.symlink)), [arms]);
  const hasMappedArms = mappedArms.length > 0;
  const calibPortOptions = useMemo(() => buildPortOptions(mappedArms), [mappedArms]);
  const autoSingleCalibId = useMemo(() => {
    const selectedArm = arms.find((arm) => arm.path === calibPort) ?? arms[0];
    const raw = selectedArm?.symlink?.trim()
      || selectedArm?.serial?.trim().toLowerCase()
      || `${calibArmType}_arm`;
    return raw
      .replace(/[^A-Za-z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 64);
  }, [arms, calibArmType, calibPort]);
  const autoBiCalibId = useMemo(() => {
    const leftArm = arms.find((arm) => arm.path === calibBiLeftPort);
    const leftRaw = leftArm?.symlink?.trim()
      || leftArm?.serial?.trim().toLowerCase()
      || "arm";
    // Strip trailing _N to get shared base (e.g. "follower_arm_1" → "follower_arm")
    // This matches teleop/record's derive_bi_calibration_profile_id() convention
    const base = leftRaw.replace(/_\d+$/, "");
    return base
      .replace(/[^A-Za-z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 64) || leftRaw;
  }, [arms, calibBiLeftPort, calibBiType]);
  const calibArmIdTrimmed = calibArmId.trim();
  const calibFileNameError = useMemo(() => {
    if (!calibArmIdTrimmed) return "Enter Calibration File Name.";
    if (calibArmIdTrimmed.length > 64) return "Calibration file name must be 1-64 characters.";
    if (calibArmIdTrimmed === "." || calibArmIdTrimmed === "..") return "Calibration file name is invalid.";
    if (!/^[A-Za-z0-9._-]+$/.test(calibArmIdTrimmed)) {
      return "Use only letters, numbers, dot (.), underscore (_), or hyphen (-).";
    }
    return "";
  }, [calibArmIdTrimmed]);
  const singleArmCalibTypes = useMemo(() => {
    const filtered = armTypes.filter((type) => !type.startsWith("bi_") && (type.includes("_leader") || type.includes("_follower")));
    return filtered.length > 0 ? filtered : ARM_TYPES;
  }, [armTypes]);
  const setupArmTypes = useMemo(() => {
    const filtered = armTypes.filter((type) => MOTOR_SETUP_TYPES.includes(type));
    return filtered.length > 0 ? filtered : MOTOR_SETUP_TYPES;
  }, [armTypes]);

  useEffect(() => {
    if (setupProcessActive && !wizardRunning) {
      startWizard();
    }
  }, [setupProcessActive, wizardRunning]);

  useEffect(() => {
    if (!wizardRunning) return;
    const parsed = parseMotorSetupLogs(motorSetupLogLines ?? []);
    setWizardMotorState(parsed.states);
    setWizardStep(parsed.currentStep);
    if (parsed.error) {
      setWizardError(parsed.error);
    } else if (setupProcessActive) {
      setWizardError(null);
    }
  }, [motorSetupLogLines, setupProcessActive, wizardRunning]);

  useEffect(() => {
    if (!wizardRunning || setupProcessActive) return;
    if (wizardAllDone) {
      setWizardRunning(false);
      return;
    }
    if (!wizardError) {
      setWizardError("Motor setup ended before all motors were configured. Check the console logs and retry.");
    }
  }, [setupProcessActive, wizardAllDone, wizardError, wizardRunning]);
  useEffect(() => {
    if (!setupArmTypes.includes(setupArmType)) {
      setSetupArmType(setupArmTypes[0] ?? "so101_follower");
    }
  }, [setupArmType, setupArmTypes]);
  const biArmCalibTypes = useMemo(() => {
    const defaults = ["bi_so_follower", "bi_so_leader"];
    const dynamic = armTypes.filter((type) => type.startsWith("bi_"));
    return Array.from(new Set([...defaults, ...dynamic]));
  }, [armTypes]);

  useEffect(() => {
    if (calibMode !== "Single Arm") return;
    const selectedArm = arms.find((arm) => arm.path === calibPort);
    const detectedRole = detectArmRoleText(`${selectedArm?.symlink ?? ""} ${selectedArm?.device ?? ""}`.toLowerCase());
    if (detectedRole === "leader" && calibArmType.includes("follower")) {
      setCalibArmType((prev) => alignArmTypeToRole(prev, "leader", singleArmCalibTypes));
    } else if (detectedRole === "follower" && calibArmType.includes("leader")) {
      setCalibArmType((prev) => alignArmTypeToRole(prev, "follower", singleArmCalibTypes));
    }
  }, [arms, calibArmType, calibMode, calibPort, singleArmCalibTypes]);

  useEffect(() => {
    if (calibMode !== "Single Arm") return;
    if (!autoSingleCalibId) return;
    if (calibArmId !== autoSingleCalibId) {
      setCalibArmId(autoSingleCalibId);
    }
  }, [autoSingleCalibId, calibArmId, calibMode]);

  useEffect(() => {
    if (calibMode !== "Bi-Arm") return;
    if (!autoBiCalibId) return;
    if (calibBiId !== autoBiCalibId) {
      setCalibBiId(autoBiCalibId);
    }
  }, [autoBiCalibId, calibBiId, calibMode]);

  useEffect(() => {
    if (!singleArmCalibTypes.includes(calibArmType)) {
      setCalibArmType(singleArmCalibTypes[0] ?? "so101_follower");
    }
  }, [calibArmType, singleArmCalibTypes]);

  useEffect(() => {
    if (!biArmCalibTypes.includes(calibBiType)) {
      setCalibBiType(biArmCalibTypes[0] ?? "bi_so_follower");
    }
  }, [biArmCalibTypes, calibBiType]);

  return (
    <div className="flex flex-col h-full">
      <UdevInstallGate>
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
                <RefreshButton onClick={() => { void loadDevices(); void loadArmTypes(); }} />
              </div>
            }
          />

          {((setupRunning && setupReconnected) || (calibrateRunning && calibrateReconnected)) && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-blue-500/30 bg-blue-500/5 text-sm text-blue-600 dark:text-blue-400">
              <span className="flex-none">⚡</span>
              <span>Reconnected — This {setupRunning && setupReconnected ? "motor setup" : "calibration"} process was recovered from a previous server session. You can still stop it.</span>
            </div>
          )}

          <div className="flex flex-col gap-6">
            <SubTabs
              tabs={[
                { key: "mapping", label: "Mapping" },
                { key: "setup", label: "Motor Setup" },
                { key: "monitor", label: "Motor Monitor" },
                { key: "calibration", label: "Calibration" },
              ]}
              activeKey={motorTab}
              onChange={setMotorTab}
              className="mx-auto"
            />

            {motorTab === "mapping" && (
              <MappingTabPanel
                arms={arms}
                armRoleMap={armRoleMap}
                onSetArmRoleMap={setArmRoleMap}
                hasAnyMapping={hasAnyArmMapping}
                onClearAllMappings={handleClearAllArmMappings}
                autoApplying={autoApplying}
                onRoleChange={scheduleAutoApply}
                onOpenIdentify={() => setIdentifyModalOpen(true)}
              />
            )}

            {motorTab === "setup" && (
              <SetupTabPanel
                wizardRunning={wizardRunning}
                wizardProcessActive={setupProcessActive}
                wizardAllDone={wizardAllDone}
                noPort={noPort}
                arms={arms}
                hasConflict={hasConflict}
                setupArmType={setupArmType}
                armTypes={setupArmTypes}
                setupPort={setupPort}
                portOptions={portOptions}
                wizardStep={wizardStep}
                wizardMotorState={wizardMotorState}
                wizardError={wizardError}
                onSetSetupArmType={setSetupArmType}
                onSetSetupPort={setSetupPort}
                onHandleSetupStart={() => { void handleSetupStart(); }}
                onWizardPressEnter={() => { void wizardPressEnter(); }}
                onWizardRetry={wizardRetry}
                onWizardRestart={() => { void restartWizard(); }}
                onWizardSimulateError={wizardSimulateError}
                onStopWizard={() => { void handleSetupStop(); }}
                onResetWizard={resetWizardState}
                onExitWizard={exitWizard}
                onSetMotorTab={setMotorTab}
              />
            )}

            {motorTab === "monitor" && (
              <MonitorTabPanel
                freewheel={freewheel}
                monConnected={monConnected}
                monConnecting={monConnecting}
                monPort={monPort}
                arms={arms}
                portOptions={portOptions}
                setupRunning={setupRunning}
                monPortLabel={monPortLabel}
                monMotors={monMotors}
                monError={monError}
                MotorCardComponent={MotorCard}
                onHandleFreewheelToggle={() => { void handleFreewheelToggle(); }}
                onHandleMonConnect={() => { void handleMonConnect(); }}
                onHandleEmergencyStop={() => { void handleEmergencyStop(); }}
                onHandleMonDisconnect={() => { void handleMonDisconnect(); }}
                onSetMonPort={setMonPort}
                onHandleMoveMotor={(id, target) => { void handleMoveMotor(id, target); }}
                onHandleClearCollision={(id) => { void handleClearCollision(id); }}
                onHandleTargetChange={handleTargetChange}
              />
            )}

            {motorTab === "calibration" && (
              <CalibrationTabPanel
                arms={arms}
                hasMappedArms={hasMappedArms}
                calibrateRunning={calibrateRunning}
                calibMode={calibMode}
                calibTypeMismatch={calibTypeMismatch}
                calibArmType={calibArmType}
                singleArmTypes={singleArmCalibTypes}
                calibPortOptions={calibPortOptions}
                calibPort={calibPort}
                calibArmId={calibArmId}
                calibArmIdAuto={calibMode === "Single Arm"}
                calibFileNameError={calibFileNameError}
                calibBiType={calibBiType}
                biArmTypes={biArmCalibTypes}
                calibBiLeftPort={calibBiLeftPort}
                calibBiRightPort={calibBiRightPort}
                calibBiId={calibBiId}
                calibBiIdAuto={calibMode === "Bi-Arm"}
                calibFiles={filteredCalibFiles}
                calibFileScope={calibFileScope}
                calibFileScopeOptions={[...CALIBRATION_FILE_SCOPE_OPTIONS]}
                selectedCalibrationExists={Boolean(calibSelectedFileStatus?.exists)}
                selectedCalibrationPath={calibSelectedFileStatus?.path ?? ""}
                validation={calibSelectedFileStatus?.validation}
                calibrationAssistantStage={calibrationAssistantStage}
                calibrateReconnected={calibrateReconnected}
                onSetCalibMode={setCalibMode}
                onSetCalibArmType={setCalibArmType}
                onSetCalibPort={setCalibPort}
                onSetCalibArmId={setCalibArmId}
                onSetCalibBiType={setCalibBiType}
                onSetCalibBiLeftPort={setCalibBiLeftPort}
                onSetCalibBiRightPort={setCalibBiRightPort}
                onSetCalibBiId={setCalibBiId}
                onSetCalibFileScope={setCalibFileScope}
                onHandleCalibrationStart={() => { void handleCalibrationStart(); }}
                onHandleCalibrationStop={() => { void handleCalibrationStop(); }}
                onHandleCalibrationDelete={(file) => { void handleCalibrationDelete(file); }}
                onUseSavedCalibration={() => { void handleCalibrationInput("", "finishing"); }}
                onRunNewCalibration={() => { void handleCalibrationInput("c", "center_arm"); }}
                onCalibrationArmCentered={() => { void handleCalibrationInput("", "record_range"); }}
                onCalibrationFinishRange={() => { void handleCalibrationInput("", "finishing"); }}
                onCalibrationSendEnter={() => { void handleCalibrationInput(""); }}
              />
            )}
          </div>
        </div>
      </div>

      <IdentifyArmModal
        open={identifyModalOpen}
        arms={arms}
        onClose={() => setIdentifyModalOpen(false)}
        onComplete={() => {
          setIdentifyModalOpen(false);
          void loadDevices();
        }}
      />
      </UdevInstallGate>
    </div>
  );
}
