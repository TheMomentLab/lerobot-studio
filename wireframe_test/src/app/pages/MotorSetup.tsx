import React, { useState } from "react";
import { Link } from "react-router";
import {
  PageHeader, Card, StatusBadge, SectionHeader, WireSelect, WireInput, FieldRow,
  ProcessButtons, WireToggle, ModeToggle, EmptyState, StickyControlBar, BlockerCard
} from "../components/wireframe";
import { AlertCircle, AlertTriangle, ChevronRight, ChevronDown, ChevronUp, Bot, Zap, RefreshCw, Trash2, Ruler, Play, Check, Circle, Loader2, CornerDownLeft, RotateCcw } from "lucide-react";
import { cn } from "../components/ui/utils";

type MotorData = {
  id: number;
  pos: number;
  load: number;
  current: number;
  collision: boolean;
  target: number;
};

const MOCK_MOTORS: MotorData[] = [
  { id: 1, pos: 2048, load: 12, current: 8, collision: false, target: 2048 },
  { id: 2, pos: 1780, load: 45, current: 32, collision: false, target: 1780 },
  { id: 3, pos: 3100, load: 8, current: 5, collision: true, target: 3100 },
  { id: 4, pos: 2200, load: 15, current: 11, collision: false, target: 2200 },
  { id: 5, pos: 900, load: 22, current: 17, collision: false, target: 900 },
  { id: 6, pos: 2500, load: 6, current: 4, collision: false, target: 2500 },
];

const ARMS = [
  { id: "ttyUSB0", path: "/dev/ttyUSB0", serial: "AX12-0047", role: "Follower Arm 1" },
  { id: "ttyUSB1", path: "/dev/ttyUSB1", serial: "AX12-0048", role: "Leader Arm 1" },
];

const ARM_ROLES = ["(없음)", "Follower Arm 1", "Follower Arm 2", "Leader Arm 1", "Leader Arm 2"];

// Calibration data
type CalibFile = { id: string; type: string; modified: string; matched: boolean };
const CALIB_FILES: CalibFile[] = [
  { id: "follower_arm_1", type: "Follower", modified: "2026-03-01 13:45", matched: true },
  { id: "follower_arm_0", type: "Follower", modified: "2026-02-28 10:12", matched: false },
  { id: "leader_arm_1", type: "Leader", modified: "2026-03-01 13:50", matched: true },
  { id: "other_arm", type: "Other", modified: "2026-02-25 08:00", matched: false },
];
const MOTOR_NAMES = ["shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll", "gripper"];
// Setup wizard: motors in REVERSED order (gripper first, shoulder_pan last) — matches lerobot CLI
const SETUP_MOTORS = [
  { name: "gripper", id: 6 },
  { name: "wrist_roll", id: 5 },
  { name: "wrist_flex", id: 4 },
  { name: "elbow_flex", id: 3 },
  { name: "shoulder_lift", id: 2 },
  { name: "shoulder_pan", id: 1 },
];
const MOCK_RANGES = [
  { min: 300, pos: 2048, max: 3800 },
  { min: 400, pos: 1780, max: 3700 },
  { min: 500, pos: 2200, max: 3600 },
  { min: 200, pos: 1500, max: 3900 },
  { min: 100, pos: 2500, max: 3950 },
  { min: 800, pos: 2000, max: 3200 },
];

function RangeBar({ name, min, pos, max }: { name: string; min: number; pos: number; max: number }) {
  const TOTAL = 4095;
  const minPct = (min / TOTAL) * 100;
  const maxPct = (max / TOTAL) * 100;
  const posPct = (pos / TOTAL) * 100;
  const rangePct = maxPct - minPct;

  return (
    <div className="flex items-center gap-3 py-1">
      <span className="text-sm text-zinc-400 w-24 flex-none truncate">{name}</span>
      <div className="flex-1 relative h-3">
        <div className="absolute inset-y-1 inset-x-0 rounded-full bg-zinc-200 dark:bg-zinc-700" />
        <div
          className="absolute inset-y-1 rounded-full bg-zinc-500/40"
          style={{ left: `${minPct}%`, width: `${rangePct}%` }}
        />
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-emerald-400"
          style={{ left: `${posPct}%` }}
        />
      </div>
      <div className="flex gap-2 text-sm font-mono text-zinc-400 w-36 flex-none">
        <span className="text-zinc-500 w-10">MIN <span className="text-zinc-400">{min}</span></span>
        <span className="text-emerald-400 w-10">POS {pos}</span>
        <span className="text-zinc-500 w-10">MAX {max}</span>
      </div>
    </div>
  );
}

function MotorCard({ motor, freewheel }: { motor: MotorData; freewheel: boolean }) {
  const [target, setTarget] = useState(motor.target);
  const loadColor = motor.load > 80 ? "text-red-400" : motor.load > 50 ? "text-amber-400" : "text-zinc-400";
  const currentColor = motor.current > 60 ? "text-red-400" : motor.current > 40 ? "text-amber-400" : "text-zinc-400";

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
          <div className="text-sm font-mono text-zinc-700 dark:text-zinc-300">{motor.pos}</div>
        </div>
        <div className="text-center">
          <div className="text-sm text-zinc-400 mb-0.5">LOAD</div>
          <div className={`text-sm font-mono ${loadColor}`}>{motor.load}%</div>
        </div>
        <div className="text-center">
          <div className="text-sm text-zinc-400 mb-0.5">CURR</div>
          <div className={`text-sm font-mono ${currentColor}`}>{motor.current}mA</div>
        </div>
      </div>

      {/* Target control */}
      <div className="flex items-center gap-1 mt-1">
        <button
          onClick={() => setTarget(Math.max(0, target - 10))}
          className="size-7 flex items-center justify-center rounded border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer text-sm"
        >
          ▼
        </button>
        <input
          type="number"
          value={target}
          onChange={(e) => setTarget(Number(e.target.value))}
          min={0}
          max={4095}
          className="flex-1 h-7 px-1.5 text-center text-sm font-mono rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 text-zinc-700 dark:text-zinc-300 outline-none focus:border-zinc-400 dark:focus:border-zinc-500"
        />
        <button
          onClick={() => setTarget(Math.min(4095, target + 10))}
          className="size-7 flex items-center justify-center rounded border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer text-sm"
        >
          ▲
        </button>
        <button
          disabled={freewheel || motor.collision}
          className="px-2 h-7 rounded border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          Move
        </button>
      </div>

      {motor.collision && (
        <button className="text-sm text-red-400 hover:text-red-500 underline cursor-pointer">
          Clear Collision
        </button>
      )}
    </div>
  );
}

export function MotorSetup() {
  const [setupRunning, setSetupRunning] = useState(false);
  const [monitorConnected, setMonitorConnected] = useState(false);
  const [freewheel, setFreewheel] = useState(false);
  const [udevOpen, setUdevOpen] = useState(false);
  const [identifyStep, setIdentifyStep] = useState<"idle" | "waiting" | "found" | "conflict">("idle");
  const [identifyRole, setIdentifyRole] = useState("(없음)");
  const [conflictTarget, setConflictTarget] = useState("");
  // Calibration states
  const [calibMode, setCalibMode] = useState("Single Arm");
  const [calibRunning, setCalibRunning] = useState(false);
  const [calibFileFilter, setCalibFileFilter] = useState("All");
  const [calibArmType, setCalibArmType] = useState("so101_follower");
  const [calibPort, setCalibPort] = useState("/dev/lerobot/follower_arm");
  const [calibArmId, setCalibArmId] = useState("follower_arm_1");
  const calibTypeMismatch =
    calibMode === "Single Arm" &&
    ((calibArmType.includes("follower") && calibPort.includes("leader")) ||
      (calibArmType.includes("leader") && calibPort.includes("follower")));
  const calibFilteredFiles = calibFileFilter === "All"
    ? CALIB_FILES
    : CALIB_FILES.filter((f) => f.type === calibFileFilter);
  // Setup wizard states
  const [wizardStep, setWizardStep] = useState(0); // 0-5 = motor index in SETUP_MOTORS
  const [wizardMotorState, setWizardMotorState] = useState<("pending" | "waiting" | "writing" | "done" | "error")[]>(
    SETUP_MOTORS.map(() => "pending")
  );
  const [wizardError, setWizardError] = useState<string | null>(null);
  const [wizardDetectedId, setWizardDetectedId] = useState("");
  const [wizardBaudRate, setWizardBaudRate] = useState("1000000");
  const [wizardConnectionConfirmed, setWizardConnectionConfirmed] = useState(false);
  // Demo states
  const [noPort, setNoPort] = useState(false);
  const [hasConflict, setHasConflict] = useState(false);
  const [motorTab, setMotorTab] = useState("identify");
  // Mapping states
  const [armRoles, setArmRoles] = useState<Record<string, string>>(
    Object.fromEntries(ARMS.map(a => [a.id, a.role]))
  );
  const [mappingApplied, setMappingApplied] = useState(true);
  const mappedCount = Object.values(armRoles).filter(r => r !== "(없음)").length;

  // Wizard helpers
  const startWizard = () => {
    setSetupRunning(true);
    setWizardStep(0);
    setWizardMotorState(SETUP_MOTORS.map((_, i) => i === 0 ? "waiting" : "pending"));
    setWizardError(null);
    setWizardDetectedId("");
    setWizardBaudRate("1000000");
    setWizardConnectionConfirmed(false);
  };
  const wizardPressEnter = () => {
    if (!setupRunning) return;
    if (!wizardConnectionConfirmed) {
      setWizardError("현재 단계 모터만 연결되었는지 먼저 확인해 주세요.");
      return;
    }
    if (!wizardDetectedId.trim()) {
      setWizardError("감지된 모터 ID를 입력해 주세요.");
      return;
    }

    const newState = [...wizardMotorState];
    newState[wizardStep] = "writing";
    setWizardMotorState(newState);
    setWizardError(null);
    // Simulate EEPROM write (1s)
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
      // All done?
      if (nextStep >= SETUP_MOTORS.length) {
        setTimeout(() => setSetupRunning(false), 500);
      }
    }, 1000);
  };
  const wizardSimulateError = () => {
    const newState = [...wizardMotorState];
    newState[wizardStep] = "error";
    setWizardMotorState(newState);
    setWizardError(`'${SETUP_MOTORS[wizardStep].name}' EEPROM 기록에 실패했습니다.`);
  };
  const wizardRetry = () => {
    const newState = [...wizardMotorState];
    newState[wizardStep] = "waiting";
    setWizardMotorState(newState);
    setWizardError(null);
  };
  const wizardAllDone = wizardMotorState.every((s) => s === "done");

  return (
    <div className="flex flex-col h-full">
      {/* Top nav bar */}
      <div className="flex items-center justify-between px-6 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-sm text-zinc-400">
        <Link to="/camera-setup" className="inline-flex items-center gap-1 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">
          ← Camera Setup
        </Link>
        <div className="flex items-center gap-2">
          <span className="text-zinc-300 dark:text-zinc-600">Camera Setup</span>
          <span className="text-zinc-300 dark:text-zinc-600">›</span>
          <span className="text-zinc-700 dark:text-zinc-200 font-medium">Motor Setup</span>
          <span className="text-zinc-300 dark:text-zinc-600">›</span>
          <Link to="/teleop" className="hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">Teleop</Link>
        </div>
        <Link to="/teleop" className="inline-flex items-center gap-1 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">
          Teleop →
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-6 flex flex-col gap-4 max-w-[1600px] mx-auto w-full">
          <PageHeader
            title="Motor Setup"
            subtitle="팔 매핑, 모터 ID 설정 및 검증"
            status={setupRunning ? "running" : hasConflict ? "blocked" : "ready"}
            action={
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <span className="hidden sm:inline">Demo:</span>
                <button onClick={() => setNoPort(v => !v)} className={`px-2 py-0.5 rounded border cursor-pointer text-sm ${noPort ? "border-amber-500/50 text-amber-400 bg-amber-500/10" : "border-zinc-200 dark:border-zinc-700 text-zinc-500"}`}>
                  no port
                </button>
                <button onClick={() => setHasConflict(v => !v)} className={`px-2 py-0.5 rounded border cursor-pointer text-sm ${hasConflict ? "border-red-500/50 text-red-400 bg-red-500/10" : "border-zinc-200 dark:border-zinc-700 text-zinc-500"}`}>
                  conflict
                </button>
              </div>
            }
          />

          <div className="flex flex-col gap-6">
            <div className="flex gap-1 bg-zinc-100 dark:bg-zinc-800/50 p-1 rounded-lg w-fit mx-auto">
              {[
                { key: "identify", label: "팔 식별" },
                { key: "mapping", label: "매핑" },
                { key: "setup", label: "모터 설정" },
                { key: "monitor", label: "모터 모니터" },
                { key: "calibration", label: "캘리브레이션" },
              ].map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setMotorTab(tab.key)}
                  className={cn(
                    "px-3.5 py-1.5 rounded-md text-sm font-medium transition-all",
                    motorTab === tab.key
                      ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm"
                      : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* udev 규칙 상태 — 공통 */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm text-zinc-500">udev 규칙</span>
                <StatusBadge status="ready" label="설치됨" />
              </div>
              <button
                onClick={() => setUdevOpen(!udevOpen)}
                className="text-sm text-zinc-400 hover:text-zinc-300 cursor-pointer"
              >
                {udevOpen ? "숨기기" : "상세 보기"}
              </button>
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
                    {[
                      { port: "usb-2.3", sym: "lerobot/follower_arm", mode: "0666", status: "Active" },
                      { port: "usb-2.4", sym: "lerobot/leader_arm", mode: "0666", status: "Active" },
                    ].map((row) => (
                      <tr key={row.sym}>
                        <td className="py-1.5 px-3 font-mono text-zinc-500">{row.port}</td>
                        <td className="py-1.5 px-3 font-mono text-zinc-400">{row.sym}</td>
                        <td className="py-1.5 px-3 font-mono text-zinc-500">{row.mode}</td>
                        <td className="py-1.5 px-3">
                          <span className="text-emerald-400">{row.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {motorTab === "identify" && (<div className="flex flex-col gap-4">
              {/* 현재 연결된 팔 목록 */}
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800 flex items-center">
                  <span className="text-sm text-zinc-500">연결된 팔 ({ARMS.length})</span>
                </div>
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
                  {ARMS.map((arm) => (
                    <div key={arm.id} className="flex items-center gap-3 px-3 py-2">
                      <div className="size-7 rounded bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                        <Bot size={14} className="text-zinc-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-zinc-700 dark:text-zinc-300 font-mono truncate">{arm.path}</div>
                        <div className="text-sm text-zinc-400">S/N: {arm.serial}</div>
                      </div>
                      <span className="text-sm text-zinc-400">{arm.role}</span>
                    </div>
                  ))}
                </div>
                {/* idle — Start Identify */}
                {identifyStep === "idle" && (
                  <div className="px-3 py-2 border-t border-zinc-100 dark:border-zinc-800/50 flex items-center gap-3">
                    <span className="text-sm text-zinc-500">팔 하나를 USB에서 분리 후 Start를 눌러주세요.</span>
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

              {/* Step: waiting — 재연결 대기 (1.5s 폴링) */}
              {identifyStep === "waiting" && (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2 px-3 py-2 rounded border border-amber-500/30 bg-amber-500/5">
                    <span className="size-2 rounded-full bg-amber-400 animate-pulse" />
                    <span className="text-sm text-amber-400">팔을 다시 연결해주세요… 변경 감지 중 (1.5s 폴링)</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setIdentifyStep("found")}
                      className="text-sm text-zinc-400 hover:text-zinc-600 cursor-pointer underline w-fit"
                    >
                      (데모: 감지됨)
                    </button>
                    <button
                      onClick={() => setIdentifyStep("idle")}
                      className="text-sm text-red-400 hover:text-red-500 cursor-pointer w-fit"
                    >
                      취소
                    </button>
                  </div>
                </div>
              )}

              {/* Step: found — 감지된 팔 정보 + 역할 할당 */}
              {identifyStep === "found" && (
                <div className="flex flex-col gap-3">
                  <div className="px-3 py-2.5 rounded border border-emerald-500/30 bg-emerald-500/5">
                    <p className="text-sm text-emerald-400 mb-1.5">✓ 팔이 감지되었습니다. 아래에서 역할을 할당하세요.</p>
                    <div className="grid grid-cols-3 gap-3 text-sm">
                      <div>
                        <span className="text-zinc-500 block mb-0.5">Device</span>
                        <span className="text-zinc-300 font-mono">/dev/ttyUSB0</span>
                      </div>
                      <div>
                        <span className="text-zinc-500 block mb-0.5">Serial</span>
                        <span className="text-zinc-300 font-mono">AX12-0047</span>
                      </div>
                      <div>
                        <span className="text-zinc-500 block mb-0.5">Kernel</span>
                        <span className="text-zinc-300 font-mono">USB ACM 0</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <WireSelect
                      value={identifyRole}
                      options={ARM_ROLES}
                      onChange={setIdentifyRole}
                    />
                    <button
                      onClick={() => {
                        // 역할 충돌 시뮬레이션: "Follower Arm 1"은 이미 ttyUSB0에 할당됨
                        if (identifyRole === "Follower Arm 1") {
                          setConflictTarget("/dev/ttyUSB1 (AX12-0048)");
                          setIdentifyStep("conflict");
                        } else {
                          setIdentifyStep("idle");
                          setIdentifyRole("(없음)");
                        }
                      }}
                      disabled={identifyRole === "(없음)"}
                      className={`px-4 py-2 rounded-lg border text-sm cursor-pointer whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed ${
                        identifyRole === "(없음)"
                          ? "border-zinc-200 dark:border-zinc-700 text-zinc-500"
                          : "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
                      }`}
                    >
                      Assign
                    </button>
                  </div>
                </div>
              )}

              {/* Step: conflict — 역할 충돌 확인 */}
              {identifyStep === "conflict" && (
                <div className="flex flex-col gap-3">
                  <div className="px-3 py-2.5 rounded border border-amber-500/30 bg-amber-500/5">
                    <div className="flex items-center gap-1.5 mb-2">
                      <AlertCircle size={12} className="text-amber-400 flex-none" />
                      <span className="text-sm text-amber-400 font-medium">역할 충돌</span>
                    </div>
                    <p className="text-sm text-zinc-400 mb-2">
                      "{identifyRole}" 역할이 이미 <span className="text-zinc-300">{conflictTarget}</span>에 할당되어 있습니다.
                    </p>
                    <div className="flex flex-col gap-1 text-sm text-zinc-400 px-2 py-1.5 rounded bg-zinc-800/30">
                      <div className="flex items-center gap-2">
                        <span className="text-zinc-500">/dev/ttyUSB0:</span>
                        <span className="text-zinc-500 line-through">—</span>
                        <ChevronRight size={10} className="text-zinc-600" />
                        <span className="text-emerald-400">{identifyRole}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-zinc-500">{conflictTarget.split(" ")[0]}:</span>
                        <span className="text-zinc-500 line-through">{identifyRole}</span>
                        <ChevronRight size={10} className="text-zinc-600" />
                        <span className="text-amber-400">(이전 역할)</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setIdentifyStep("idle");
                        setIdentifyRole("(없음)");
                      }}
                      className="px-4 py-2 rounded-lg border border-emerald-500/50 bg-emerald-500/10 text-emerald-400 text-sm cursor-pointer"
                    >
                      역할 스왑 확인
                    </button>
                    <button
                      onClick={() => setIdentifyStep("found")}
                      className="px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                    >
                      돌아가기
                    </button>
                  </div>
                </div>
              )}
            </div>)}

            {motorTab === "mapping" && (<div className="flex flex-col gap-4">

              {/* 팔 매핑 리스트 */}
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                  <span className="text-sm text-zinc-500">팔 매핑 ({ARMS.length})</span>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="flex items-center gap-1">
                      <span className={`size-1.5 rounded-full ${mappedCount === ARMS.length ? "bg-emerald-400" : "bg-zinc-400"}`} />
                      <span className="text-zinc-400">{mappedCount} / {ARMS.length} 완료</span>
                    </span>
                    {mappingApplied && mappedCount > 0 && (
                      <span className="flex items-center gap-1">
                        <span className="size-1.5 rounded-full bg-emerald-400" />
                        <span className="text-zinc-400">applied</span>
                      </span>
                    )}
                  </div>
                </div>
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
                  {ARMS.map((arm) => (
                    <div key={arm.id} className="flex items-center gap-3 px-3 py-2.5">
                      <div className="size-7 rounded bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                        <Bot size={14} className="text-zinc-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-zinc-700 dark:text-zinc-300 font-mono truncate">{arm.path}</div>
                        <div className="text-sm text-zinc-400">S/N: {arm.serial}</div>
                      </div>
                      <div className="w-44 flex-none">
                        <WireSelect
                          value={armRoles[arm.id] || "(없음)"}
                          options={ARM_ROLES}
                          onChange={(v) => {
                            setArmRoles(prev => ({ ...prev, [arm.id]: v }));
                            setMappingApplied(false);
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="px-3 py-2 border-t border-zinc-100 dark:border-zinc-800/50 flex items-center justify-end">
                  <button
                    onClick={() => setMappingApplied(true)}
                    disabled={mappingApplied || mappedCount === 0}
                    className="px-3 py-1.5 rounded-lg border text-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
                  >
                    <Check size={12} className="inline mr-1" />
                    적용
                  </button>
                </div>
              </div>
            </div>)}

            {motorTab === "setup" && (<div className="flex flex-col gap-4">
              {/* Phase A: 설정 폼 (미실행 시) */}
              {!setupRunning && !wizardAllDone && (
                <div className="flex flex-col gap-3">
                  <FieldRow label="팔 역할 타입">
                    <WireSelect
                      value="so101_follower"
                      options={["so101_follower", "so100_leader", "so101_leader", "so100_follower"]}
                    />
                  </FieldRow>
                  <FieldRow label="팔 포트">
                    <WireSelect
                      placeholder={noPort ? "감지된 포트 없음" : undefined}
                      value={noPort ? "" : "/dev/lerobot/follower_arm"}
                      options={noPort ? [] : ["/dev/lerobot/follower_arm", "/dev/lerobot/leader_arm", "/dev/ttyUSB0"]}
                    />
                  </FieldRow>
                  <div className="flex flex-col gap-2 mt-2">
                    <button
                      onClick={startWizard}
                      disabled={noPort || hasConflict}
                      className="w-full px-4 py-2.5 rounded-lg border border-emerald-500/50 bg-emerald-500/10 text-emerald-400 text-sm font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      <Play size={13} className="fill-current" /> Start Motor Setup
                    </button>
                    {noPort && <BlockerCard title="설정 차단" reasons={["포트를 감지할 수 없습니다. USB 연결을 확인하세요."]} />}
                    {hasConflict && !noPort && (
                      <BlockerCard
                        title="설정 차단"
                        severity="error"
                        reasons={[{ text: "Teleop 프로세스가 실행 중입니다", to: "/teleop" }]}
                      />
                    )}
                  </div>
                </div>
              )}

              {/* Phase B: 인터랙티브 위저드 (실행 중) */}
              {setupRunning && (
                <div className="flex flex-col gap-4">
                  {/* 프로그레스 바 */}
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-zinc-500 flex-none">진행</span>
                    <div className="flex-1 h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                        style={{ width: `${(wizardMotorState.filter(s => s === "done").length / SETUP_MOTORS.length) * 100}%` }}
                      />
                    </div>
                    <span className="text-sm text-zinc-400 flex-none font-mono">
                      {wizardMotorState.filter(s => s === "done").length} / {SETUP_MOTORS.length}
                    </span>
                  </div>

                  {/* 모터 목록 */}
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden divide-y divide-zinc-100 dark:divide-zinc-800/50">
                    {SETUP_MOTORS.map((motor, i) => {
                      const state = wizardMotorState[i];
                      const isCurrent = i === wizardStep && setupRunning;
                      return (
                        <div
                          key={motor.name}
                          className={cn(
                            "flex items-center gap-3 px-4 py-2.5 transition-colors",
                            isCurrent && "bg-emerald-500/5 dark:bg-emerald-500/10",
                            state === "done" && "opacity-60"
                          )}
                        >
                          {/* 상태 아이콘 */}
                          <div className="flex-none">
                            {state === "done" && <Check size={16} className="text-emerald-500" />}
                            {state === "writing" && <Loader2 size={16} className="text-emerald-400 animate-spin" />}
                            {state === "waiting" && <Circle size={16} className="text-emerald-400 fill-emerald-400/20" />}
                            {state === "error" && <AlertCircle size={16} className="text-red-500" />}
                            {state === "pending" && <Circle size={16} className="text-zinc-300 dark:text-zinc-600" />}
                          </div>

                          {/* 모터 이름 */}
                          <span className={cn(
                            "text-sm font-mono flex-1",
                            isCurrent ? "text-zinc-800 dark:text-zinc-100 font-medium" : "text-zinc-500"
                          )}>
                            {motor.name}
                          </span>

                          {/* ID */}
                          <span className="text-sm text-zinc-400 font-mono flex-none">
                            ID {motor.id}
                          </span>

                          {/* 완료 표시 */}
                          {state === "done" && (
                            <span className="text-xs text-emerald-400 flex-none">설정됨</span>
                          )}
                          {state === "writing" && (
                            <span className="text-xs text-emerald-400 flex-none">EEPROM 기록 중…</span>
                          )}
                          {state === "error" && (
                            <span className="text-xs text-red-500 flex-none">실패</span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* 현재 단계 안내 */}
                  {!wizardError && wizardMotorState[wizardStep] === "waiting" && (
                    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 flex flex-col gap-3">
                      <div className="flex items-center gap-2">
                        <span className="size-2 rounded-full bg-emerald-400 animate-pulse flex-none" />
                        <p className="text-sm text-emerald-400">
                          <span className="font-medium">'{SETUP_MOTORS[wizardStep].name}'</span> 모터만 연결하고 아래 버튼을 누르세요
                        </p>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        <FieldRow label="감지된 ID">
                          <WireInput value={wizardDetectedId} onChange={setWizardDetectedId} placeholder="예: 1" />
                        </FieldRow>
                        <FieldRow label="대상 ID">
                          <WireInput value={String(SETUP_MOTORS[wizardStep].id)} />
                        </FieldRow>
                        <FieldRow label="Baud Rate">
                          <WireSelect
                            value={wizardBaudRate}
                            options={["1000000", "2000000", "3000000"]}
                            onChange={setWizardBaudRate}
                          />
                        </FieldRow>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <button
                          onClick={() => setWizardDetectedId(String((wizardStep + 1) * 11))}
                          className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-500 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800"
                        >
                          감지값 자동 채우기
                        </button>
                        <WireToggle
                          label="현재 단계 모터만 연결됨"
                          checked={wizardConnectionConfirmed}
                          onChange={setWizardConnectionConfirmed}
                        />
                      </div>
                      <button
                        onClick={wizardPressEnter}
                        disabled={!wizardConnectionConfirmed || !wizardDetectedId.trim()}
                        className="w-full px-4 py-3 rounded-lg border border-emerald-500/50 bg-emerald-500/10 text-emerald-400 text-sm font-medium cursor-pointer hover:bg-emerald-500/20 transition-colors flex items-center justify-center gap-2"
                      >
                        <CornerDownLeft size={14} />
                        연결 완료 (Enter)
                      </button>
                    </div>
                  )}

                  {/* EEPROM 기록 중 */}
                  {wizardMotorState[wizardStep] === "writing" && (
                    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 flex items-center gap-3">
                      <Loader2 size={16} className="text-zinc-400 animate-spin flex-none" />
                      <p className="text-sm text-zinc-400">
                        '{SETUP_MOTORS[wizardStep].name}' 모터에 ID {SETUP_MOTORS[wizardStep].id} / Baud {wizardBaudRate} 기록 중…
                      </p>
                    </div>
                  )}

                  {/* 에러 */}
                  {wizardError && (
                    <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-2 flex items-center gap-3">
                      <AlertCircle size={14} className="text-red-500 flex-none" />
                      <p className="text-sm text-red-400 flex-1">{wizardError}</p>
                      <button
                        onClick={wizardRetry}
                        className="flex-none px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-500 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800 flex items-center gap-2"
                      >
                        <RotateCcw size={12} />
                        재시도
                      </button>
                    </div>
                  )}

                  {/* 데모: 에러 시뮬레이션 + 중지 */}
                  <div className="flex items-center gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                    <span className="text-xs text-zinc-400">Demo:</span>
                    <button
                      onClick={wizardSimulateError}
                      disabled={wizardMotorState[wizardStep] !== "waiting"}
                      className="text-xs px-2 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-500 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      에러 시뮬
                    </button>
                    <button
                      onClick={() => {
                        setSetupRunning(false);
                        setWizardMotorState(SETUP_MOTORS.map(() => "pending"));
                        setWizardStep(0);
                        setWizardError(null);
                        setWizardDetectedId("");
                        setWizardBaudRate("1000000");
                        setWizardConnectionConfirmed(false);
                      }}
                      className="text-xs px-2 py-0.5 rounded border border-red-500/30 text-red-500 cursor-pointer"
                    >
                      중지
                    </button>
                  </div>
                </div>
              )}

              {/* Phase C: 완료 */}
              {!setupRunning && wizardAllDone && (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <Check size={16} className="text-emerald-500" />
                    <p className="text-sm text-emerald-400 font-medium">
                      모터 설정 완료 — 6개 모터 ID가 EEPROM에 기록되었습니다
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
                      다시 실행
                    </button>
                    <button
                      onClick={() => setMotorTab("monitor")}
                      className="px-4 py-2 rounded-lg border border-emerald-500/50 bg-emerald-500/10 text-emerald-400 text-sm cursor-pointer"
                    >
                      모터 모니터로 검증 →
                    </button>
                  </div>
                </div>
              )}
            </div>)}

            {motorTab === "monitor" && (<div className="flex flex-col gap-4">
              {/* Connection bar */}
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 bg-zinc-50 dark:bg-zinc-800/30">
                  <WireToggle
                    label="Freewheel"
                    checked={freewheel}
                    onChange={setFreewheel}
                  />
                  <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-700 flex-none" />
                  <span className="text-sm text-zinc-500 flex-none">Port</span>
                  <div className="flex-1 min-w-0">
                    <WireSelect
                      value="/dev/lerobot/follower_arm"
                      options={["/dev/lerobot/follower_arm", "/dev/lerobot/leader_arm"]}
                    />
                  </div>
                  <button
                    onClick={() => { if (monitorConnected) setFreewheel(false); setMonitorConnected(!monitorConnected); }}
                    className={`px-4 py-2 rounded-lg border text-sm cursor-pointer whitespace-nowrap ${
                      monitorConnected
                        ? "border-red-500/50 bg-red-500/10 text-red-400"
                        : "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
                    }`}
                  >
                    {monitorConnected ? "Disconnect" : "Connect"}
                  </button>
                </div>
              </div>

              {monitorConnected && (
                <>
                  <div className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-sm text-zinc-400">follower_arm · 6 motors · polling 100ms</span>
                  </div>

                  {freewheel && (
                    <div className="px-3 py-2 rounded border border-amber-500/30 bg-amber-500/5 text-sm text-amber-400">
                      <span className="block">⚠ Freewheel 활성화</span>
                      <span className="text-sm text-amber-400/60 block mt-0.5">모터 잠금이 해제되었습니다. Move 버튼이 비활성화됩니다.</span>
                    </div>
                  )}

                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                    {MOCK_MOTORS.map((m) => (
                      <MotorCard key={m.id} motor={m} freewheel={freewheel} />
                    ))}
                  </div>
                </>
              )}

              {!monitorConnected && (
                <Card title="실시간 모터 상태">
                  <EmptyState
                    icon={<Zap size={28} />}
                    message="포트에 연결하면 각 모터 상태가 표시됩니다 (100ms 폴링)"
                  />
                </Card>
              )}
            </div>)}

            {motorTab === "calibration" && (<div className="flex flex-col gap-6">
              <div className="flex items-center justify-between">
                <ModeToggle
                  options={["Single Arm", "Bi-Arm"]}
                  value={calibMode}
                  onChange={setCalibMode}
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card title={calibMode === "Single Arm" ? "Single Arm 설정" : "Bi-Arm 설정"}>
                  <div className="flex flex-col gap-3">
                    {calibMode === "Single Arm" ? (
                      <>
                        {calibTypeMismatch && (
                          <div className="flex items-center gap-1.5 text-sm text-amber-400 px-1">
                            <AlertTriangle size={12} className="flex-none" />
                            타입과 포트가 일치하지 않습니다
                          </div>
                        )}
                        <FieldRow label="팔 역할 타입">
                          <WireSelect
                            value={calibArmType}
                            options={["so101_follower", "so100_leader", "so101_leader", "so100_follower"]}
                            onChange={setCalibArmType}
                          />
                        </FieldRow>
                        <FieldRow label="팔 포트">
                          <WireSelect
                            value={calibPort}
                            options={["/dev/lerobot/follower_arm", "/dev/lerobot/leader_arm"]}
                            onChange={setCalibPort}
                          />
                        </FieldRow>
                        <FieldRow label="팔 ID">
                          <WireInput value={calibArmId} onChange={setCalibArmId} placeholder="캘리브레이션 파일명" />
                        </FieldRow>
                        <div className="px-3 py-2 rounded border border-emerald-500/30 bg-emerald-500/5">
                          <div className="flex items-center gap-2 mb-1">
                            <StatusBadge status="ready" label="Found" />
                            <span className="text-sm text-zinc-400">follower_arm_1.json</span>
                          </div>
                          <div className="text-sm text-zinc-400">Modified: 2026-03-01 13:45 · 2.1 KB</div>
                        </div>
                      </>
                    ) : (
                      <>
                        <FieldRow label="디바이스 타입">
                          <WireSelect value="so101" options={["so101", "so100", "aloha"]} />
                        </FieldRow>
                        <FieldRow label="팔 ID">
                          <WireInput value="biarm_1" />
                        </FieldRow>
                        <FieldRow label="Left Arm Port">
                          <WireSelect value="/dev/lerobot/leader_arm" options={["/dev/lerobot/leader_arm", "/dev/ttyUSB0"]} />
                        </FieldRow>
                        <FieldRow label="Right Arm Port">
                          <WireSelect value="/dev/lerobot/follower_arm" options={["/dev/lerobot/follower_arm", "/dev/ttyUSB1"]} />
                        </FieldRow>
                        <p className="text-sm text-zinc-400">Both arms are calibrated sequentially in a single run.</p>
                      </>
                    )}
                    <ProcessButtons
                      running={calibRunning}
                      onStart={() => setCalibRunning(true)}
                      onStop={() => setCalibRunning(false)}
                      startLabel={<><Play size={13} className="fill-current" /> Start Calibration</>}
                      disabled={calibTypeMismatch}
                    />
                  </div>
                </Card>

                <Card
                  title="기존 캘리브레이션 파일"
                  action={
                    <div className="flex items-center gap-2">
                      <WireSelect
                        value={calibFileFilter}
                        options={["All", "Follower", "Leader", "Other"]}
                        onChange={setCalibFileFilter}
                      />
                      <button className="text-zinc-400 cursor-pointer">
                        <RefreshCw size={12} />
                      </button>
                    </div>
                  }
                >
                  <div className="flex flex-col gap-1">
                    {calibFilteredFiles.map((f) => (
                      <div
                        key={f.id}
                        onClick={() => setCalibArmId(f.id)}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer group transition-colors ${
                          calibArmId === f.id
                            ? "bg-zinc-100 dark:bg-zinc-800/50 border border-zinc-300 dark:border-zinc-600"
                            : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50 border border-transparent"
                        }`}
                      >
                        <span className={`size-1.5 rounded-full flex-none ${f.matched ? "bg-emerald-400" : "bg-zinc-400"}`} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-zinc-700 dark:text-zinc-300 truncate">{f.id}</div>
                          <div className="text-sm text-zinc-400 truncate">{f.type} · {f.modified}</div>
                        </div>
                        <button className="p-1 text-zinc-300 dark:text-zinc-600 hover:text-red-400 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 cursor-pointer">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>

              <Card
                title="실시간 모터 범위 시각화"
                badge={calibRunning ? <StatusBadge status="running" label="LIVE" pulse /> : undefined}
              >
                {calibRunning ? (
                  <div className="flex flex-col gap-1 py-1">
                    {MOTOR_NAMES.map((name, i) => (
                      <RangeBar key={name} name={name} {...MOCK_RANGES[i]} />
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    icon={<Ruler size={28} />}
                    message="Waiting for calibration… Start process to see live ranges."
                  />
                )}
              </Card>
            </div>)}
          </div>
        </div>
      </div>

      {/* Sticky control bar */}
      <StickyControlBar>
        <div className="flex items-center gap-3">
          <StatusBadge
            status={setupRunning ? "running" : "ready"}
            label={setupRunning ? "RUNNING" : "READY"}
            pulse={setupRunning}
          />
        </div>
      </StickyControlBar>
    </div>
  );
}
