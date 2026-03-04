import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  PageHeader,
  RefreshButton,
  SubTabs,
} from "../../components/wireframe";
import { apiDelete, apiGet, apiPost } from "../../services/apiClient";
import { useLeStudioStore } from "../../store";
import { SETUP_MOTORS, ARM_TYPES, toArmSymlink } from "./constants";
import { MotorCard } from "./components/MotorCard";
import { MappingTabPanel } from "./components/MappingTabPanel";
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
} from "./types";

// ─── Main Component ───────────────────────────────────────────────────────────

export function MotorSetup() {
  const procStatus = useLeStudioStore((s) => s.procStatus);
  const appendLog = useLeStudioStore((s) => s.appendLog);
  const clearLog = useLeStudioStore((s) => s.clearLog);
  const addToast = useLeStudioStore((s) => s.addToast);

  // ── Device data ──────────────────────────────────────────────────────────
  const [arms, setArms] = useState<ArmDevice[]>([]);

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

  // ── UI state ──────────────────────────────────────────────────────────────
  const [motorTab, setMotorTab] = useState("mapping");
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
    void loadArmTypes();
  }, [loadDevices, loadArmTypes]);

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

  const refreshCalibrationFileStatus = useCallback(async () => {
    if (!calibArmType || !calibArmId) return;
    try {
      await apiGet<CalibrationFileStatusResponse>(
        `/api/calibrate/file/status?robot_type=${encodeURIComponent(calibArmType)}&robot_id=${encodeURIComponent(calibArmId)}`,
      );
    } catch {
      // ignore
    }
  }, [calibArmId, calibArmType]);

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

  const applyArmMapping = async (roleMap: Record<string, string>) => {
    const armAssignments: Record<string, string> = {};
    for (const arm of arms) {
      if (!arm.serial) continue;
      const roleLabel = roleMap[arm.device] ?? "(none)";
      armAssignments[arm.serial] = toArmSymlink(roleLabel);
    }

    const result = await apiPost<ActionResponse>("/api/rules/apply", {
      assignments: {},
      arm_assignments: armAssignments,
    });

    if (!result.ok) {
      addToast(result.error ?? "Failed to apply arm mapping.", "error");
      return;
    }

    addToast("Arm mapping rules applied.", "success");
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

  const resetWizardState = () => {
    setWizardMotorState(SETUP_MOTORS.map(() => "pending"));
    setWizardStep(0);
    setWizardError(null);
    setWizardDetectedId("");
    setWizardBaudRate("1000000");
    setWizardConnectionConfirmed(false);
  };

  const stopWizard = () => {
    setWizardRunning(false);
    resetWizardState();
  };

  const wizardAllDone = wizardMotorState.every((s) => s === "done");

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
                <RefreshButton onClick={() => { void loadDevices(); void loadArmTypes(); }} />
              </div>
            }
          />

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
                onApplyMapping={(nextMap) => { void applyArmMapping(nextMap); }}
                identifyStep={identifyStep}
                identifyRole={identifyRole}
                armRoles={ARM_ROLES}
                onSetIdentifyStep={setIdentifyStep}
                onSetIdentifyRole={setIdentifyRole}
              />
            )}

            {motorTab === "setup" && (
              <SetupTabPanel
                wizardRunning={wizardRunning}
                wizardAllDone={wizardAllDone}
                noPort={noPort}
                arms={arms}
                hasConflict={hasConflict}
                setupArmType={setupArmType}
                armTypes={armTypes}
                setupPort={setupPort}
                wizardStep={wizardStep}
                wizardMotorState={wizardMotorState}
                wizardError={wizardError}
                wizardDetectedId={wizardDetectedId}
                wizardBaudRate={wizardBaudRate}
                wizardConnectionConfirmed={wizardConnectionConfirmed}
                onSetSetupArmType={setSetupArmType}
                onSetSetupPort={setSetupPort}
                onHandleSetupStart={() => { void handleSetupStart(); }}
                onSetWizardDetectedId={setWizardDetectedId}
                onSetWizardBaudRate={setWizardBaudRate}
                onSetWizardConnectionConfirmed={setWizardConnectionConfirmed}
                onWizardPressEnter={wizardPressEnter}
                onWizardRetry={wizardRetry}
                onWizardSimulateError={wizardSimulateError}
                onStopWizard={stopWizard}
                onResetWizard={resetWizardState}
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
                calibrateRunning={calibrateRunning}
                calibMode={calibMode}
                calibTypeMismatch={calibTypeMismatch}
                calibArmType={calibArmType}
                armTypes={armTypes}
                calibPortOptions={calibPortOptions}
                calibPort={calibPort}
                calibArmIdOptions={calibArmIdOptions}
                calibArmId={calibArmId}
                calibBiType={calibBiType}
                calibBiLeftPort={calibBiLeftPort}
                calibBiRightPort={calibBiRightPort}
                calibBiId={calibBiId}
                calibFiles={calibFiles}
                onSetCalibMode={setCalibMode}
                onSetCalibArmType={setCalibArmType}
                onSetCalibPort={setCalibPort}
                onSetCalibArmId={setCalibArmId}
                onSetCalibBiType={setCalibBiType}
                onSetCalibBiLeftPort={setCalibBiLeftPort}
                onSetCalibBiRightPort={setCalibBiRightPort}
                onSetCalibBiId={setCalibBiId}
                onHandleCalibrationStart={() => { void handleCalibrationStart(); }}
                onHandleCalibrationStop={() => { void handleCalibrationStop(); }}
                onHandleCalibrationDelete={(file) => { void handleCalibrationDelete(file); }}
              />
            )}
          </div>
        </div>
      </div>

    </div>
  );
}
