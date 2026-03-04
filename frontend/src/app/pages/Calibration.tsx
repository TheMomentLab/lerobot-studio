import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Link } from "react-router";
import { Trash2, Ruler, AlertTriangle, Play, Square, Bot } from "lucide-react";
import {
  PageHeader, Card, SectionHeader, WireSelect, WireInput, FieldRow,
  ProcessButtons, ModeToggle, StatusBadge, EmptyState, StickyControlBar, BlockerCard, RefreshButton
} from "../components/wireframe";
import { apiGet, apiPost, subscribeNonTrainChannel } from "../services/apiClient";
import { useLeStudioStore } from "../store";

// ─── Types ────────────────────────────────────────────────────────────────────

type ArmDevice = { device: string; path: string; symlink?: string | null };

type CalibFile = {
  id: string;
  guessed_type: string;
  modified?: string;
  size?: number;
};

type FileCheckResult = {
  exists: boolean;
  path: string;
  modified?: string;
  size?: number;
};

type ActionResponse = { ok: boolean; error?: string };

type MotorRow = { name: string; min: number; pos: number; max: number };

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_ARM_TYPES = ["so101_follower", "so100_follower", "so101_leader", "so100_leader"];
const MOTOR_ROW_RE = /^([a-zA-Z0-9_]+)\s+\|\s+(-?\d+)\s+\|\s+(-?\d+)\s+\|\s+(-?\d+)\s*$/;
const MOTOR_HEADER_RE = /^NAME\s+\|\s+MIN\s+\|\s+POS/i;
const MOTOR_SEPARATOR_RE = /^-{8,}\s*$/;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function armPath(arm: ArmDevice, idx: number): string {
  return arm.path || `/dev/${arm.device || `ttyUSB${idx}`}`;
}

function fileHasMatchingArm(file: CalibFile, arms: ArmDevice[]): boolean {
  const fileRole = file.guessed_type.toLowerCase().includes("leader") ? "leader" : "follower";
  const fileIndex = lastNumberToken(file.id);
  return arms.some((arm, idx) => {
    const label = arm.symlink || armPath(arm, idx);
    const labelLower = label.toLowerCase();
    const labelRole = labelLower.includes("leader") ? "leader" : labelLower.includes("follower") ? "follower" : null;
    if (labelRole !== fileRole) return false;
    if (fileIndex === null) return true;
    const armIndex = lastNumberToken(label) ?? lastNumberToken(armPath(arm, idx));
    return armIndex === fileIndex;
  });
}

function lastNumberToken(input: string): number | null {
  const match = input.match(/(\d+)(?!.*\d)/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function truncatePath(fullPath: string): string {
  const homeMatch = fullPath.match(/^\/home\/[^/]+\//);
  if (homeMatch) return fullPath.replace(homeMatch[0], "~/");
  return fullPath;
}

// ─── RangeBar ─────────────────────────────────────────────────────────────────

function RangeBar({ name, min, pos, max }: MotorRow) {
  const TOTAL = 4095;
  const clamp = (v: number) => Math.max(0, Math.min(TOTAL, v));
  const minPct = (clamp(min) / TOTAL) * 100;
  const maxPct = (clamp(max) / TOTAL) * 100;
  const posPct = (clamp(pos) / TOTAL) * 100;
  const rangePct = maxPct - minPct;

  return (
    <div className="flex items-center gap-3 py-1">
      <span className="text-sm text-zinc-400 w-24 flex-none truncate">{name}</span>
      <div className="flex-1 relative h-3">
        <div className="absolute inset-y-1 inset-x-0 rounded-full bg-zinc-200 dark:bg-zinc-700" />
        <div className="absolute inset-y-1 rounded-full bg-blue-400/40" style={{ left: `${minPct}%`, width: `${rangePct}%` }} />
        <div className="absolute top-0 bottom-0 w-0.5 bg-emerald-400" style={{ left: `${posPct}%` }} />
      </div>
      <div className="flex gap-2 text-sm font-mono text-zinc-400 w-36 flex-none">
        <span className="text-zinc-500 w-10">MIN <span className="text-zinc-400">{min}</span></span>
        <span className="text-emerald-600 dark:text-emerald-400 w-10">POS {pos}</span>
        <span className="text-zinc-500 w-10">MAX {max}</span>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function Calibration() {
  const procStatus = useLeStudioStore((s) => s.procStatus);
  const addToast = useLeStudioStore((s) => s.addToast);

  const running = Boolean(procStatus.calibrate);

  // ── Config ────────────────────────────────────────────────────────────────
  const [mode, setMode] = useState("Single Arm");
  const isBiArm = mode === "Bi-Arm";

  // Single Arm fields
  const [armType, setArmType] = useState("so101_follower");
  const [port, setPort] = useState("");
  const [armId, setArmId] = useState("my_arm_1");

  // Bi-Arm fields
  const [biType, setBiType] = useState("bi_so_follower");
  const [biId, setBiId] = useState("bimanual_follower");
  const [biLeftPort, setBiLeftPort] = useState("");
  const [biRightPort, setBiRightPort] = useState("");

  // ── Data ──────────────────────────────────────────────────────────────────
  const [arms, setArms] = useState<ArmDevice[]>([]);
  const [armTypes, setArmTypes] = useState<string[]>(DEFAULT_ARM_TYPES);
  const [files, setFiles] = useState<CalibFile[]>([]);
  const [fileFilter, setFileFilter] = useState("All");
  const [fileStatus, setFileStatus] = useState<"found" | "missing" | "">("");
  const [fileMeta, setFileMeta] = useState("");

  // ── Live motor ranges from calibrate stdout ───────────────────────────────
  const [motorRows, setMotorRows] = useState<MotorRow[]>([]);
  const motorRowsRef = useRef<Map<string, MotorRow>>(new Map());

  // ── UI ────────────────────────────────────────────────────────────────────
  const [advOpen, setAdvOpen] = useState(false);

  const typeMismatch =
    !isBiArm &&
    ((armType.includes("follower") && port.includes("leader")) ||
      (armType.includes("leader") && port.includes("follower")));

  const conflictRunning = Object.entries(procStatus)
    .filter(([k, v]) => k !== "calibrate" && v)
    .map(([k]) => k);

  const blocked = conflictRunning.length > 0 || arms.length === 0;

  // ─── Data loading ──────────────────────────────────────────────────────────

  const loadDevices = useCallback(async () => {
    try {
      const res = await apiGet<{ arms?: ArmDevice[] }>("/api/devices");
      const nextArms = Array.isArray(res.arms) ? res.arms : [];
      setArms(nextArms);
      if (nextArms.length > 0 && !port) {
        setPort(armPath(nextArms[0], 0));
        if (nextArms.length > 1) {
          setBiLeftPort(armPath(nextArms[0], 0));
          setBiRightPort(armPath(nextArms[1], 1));
        } else {
          setBiLeftPort(armPath(nextArms[0], 0));
          setBiRightPort(armPath(nextArms[0], 0));
        }
      }
    } catch { /* ignore */ }
  }, [port]);

  const loadArmTypes = useCallback(async () => {
    try {
      const [robots, teleops] = await Promise.all([
        apiGet<{ types?: string[] }>("/api/robots"),
        apiGet<{ types?: string[] }>("/api/teleops"),
      ]);
      const merged = Array.from(new Set([...(robots.types ?? []), ...(teleops.types ?? [])]));
      if (merged.length > 0) setArmTypes(merged);
    } catch { /* keep defaults */ }
  }, []);

  const refreshFiles = useCallback(async () => {
    try {
      const res = await apiGet<{ files: CalibFile[] }>("/api/calibrate/list");
      setFiles(res.files ?? []);
    } catch { setFiles([]); }
  }, []);

  const checkFile = useCallback(async () => {
    if (!armId || !armType) return;
    try {
      const res = await apiGet<FileCheckResult>(
        `/api/calibrate/file?robot_type=${encodeURIComponent(armType)}&robot_id=${encodeURIComponent(armId)}`
      );
      if (res.exists) {
        setFileStatus("found");
        setFileMeta(`${truncatePath(res.path)}\nModified: ${res.modified ?? ""} (${res.size ?? ""} bytes)`);
      } else {
        setFileStatus("missing");
        setFileMeta(`Will create new file:\n${truncatePath(res.path)}`);
      }
    } catch { setFileStatus(""); }
  }, [armId, armType]);

  useEffect(() => {
    void loadDevices();
    void loadArmTypes();
    void refreshFiles();
  }, [loadDevices, loadArmTypes, refreshFiles]);

  useEffect(() => {
    void checkFile();
  }, [checkFile]);

  // ─── Subscribe to calibrate stdout for live motor ranges ──────────────────

  useEffect(() => {
    if (!running) {
      motorRowsRef.current.clear();
      setMotorRows([]);
      return;
    }

    const unsub = subscribeNonTrainChannel("calibrate", (event) => {
      const line = event.payload.line;
      if (!line || MOTOR_HEADER_RE.test(line) || MOTOR_SEPARATOR_RE.test(line)) return;
      const match = line.match(MOTOR_ROW_RE);
      if (!match) return;
      const row: MotorRow = {
        name: match[1],
        min: Number(match[2]),
        pos: Number(match[3]),
        max: Number(match[4]),
      };
      if (!Number.isFinite(row.min) || !Number.isFinite(row.pos) || !Number.isFinite(row.max)) return;
      motorRowsRef.current.set(row.name, row);
      setMotorRows(Array.from(motorRowsRef.current.values()));
    });

    return unsub;
  }, [running]);

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handleStart = async () => {
    const payload = isBiArm
      ? { robot_mode: "bi", bi_type: biType, left_port: biLeftPort, right_port: biRightPort, robot_id: biId }
      : { robot_type: armType, robot_id: armId, port };

    const res = await apiPost<ActionResponse>("/api/calibrate/start", payload);
    if (!res.ok) {
      addToast(res.error ?? "Failed to start calibration", "error");
    } else {
      addToast("Calibration started", "success");
      motorRowsRef.current.clear();
      setMotorRows([]);
    }
  };

  const handleStop = async () => {
    await apiPost("/api/process/calibrate/stop", {});
    addToast("Calibration stop requested", "info");
    await refreshFiles();
    await checkFile();
  };

  const handleDeleteFile = async (file: CalibFile) => {
    if (!window.confirm(`Delete calibration file?\n\n${file.id} (${file.guessed_type})\n\nThis cannot be undone.`)) return;
    const res = await apiGet<ActionResponse>(
      `/api/calibrate/file?robot_type=${encodeURIComponent(file.guessed_type)}&robot_id=${encodeURIComponent(file.id)}`
    );
    if (!res.ok) {
      addToast("Failed to delete calibration file", "error");
      return;
    }
    // Use DELETE via fetch directly since apiGet doesn't support DELETE
    const deleteRes = await fetch(
      `/api/calibrate/file?robot_type=${encodeURIComponent(file.guessed_type)}&robot_id=${encodeURIComponent(file.id)}`,
      { method: "DELETE" }
    );
    const deleteData = await deleteRes.json() as ActionResponse;
    if (!deleteData.ok) {
      addToast(deleteData.error ?? "Failed to delete calibration file", "error");
    } else {
      addToast("Calibration file deleted", "success");
      await refreshFiles();
      await checkFile();
    }
  };

  const armPortOptions = useMemo(
    () => arms.length > 0 ? arms.map((a, i) => armPath(a, i)) : [port].filter(Boolean),
    [arms, port]
  );

  const filteredFiles = useMemo(
    () => fileFilter === "All" ? files : files.filter((f) => f.guessed_type === fileFilter),
    [files, fileFilter]
  );

  const armIdOptions = useMemo(() => {
    const role = armType.includes("leader") ? "leader" : armType.includes("follower") ? "follower" : "";
    const roleMatched = role
      ? files.filter((f) => f.guessed_type.toLowerCase().includes(role))
      : files;
    const ids = Array.from(new Set(roleMatched.map((f) => f.id).filter(Boolean)));

    if (armId && !ids.includes(armId)) {
      ids.unshift(armId);
    }
    if (ids.length === 0) {
      ids.push(armId || "my_arm_1");
    }
    return ids;
  }, [armId, armType, files]);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* Top nav bar */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center px-6 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-sm text-zinc-400">
        <Link to="/motor-setup" className="inline-flex items-center gap-1 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">
          ← Motor Setup
        </Link>
        <div className="flex items-center gap-2">
          <span className="text-zinc-300 dark:text-zinc-600">Motor Setup</span>
          <span className="text-zinc-300 dark:text-zinc-600">›</span>
          <span className="text-zinc-700 dark:text-zinc-200 font-medium">Calibration</span>
          <span className="text-zinc-300 dark:text-zinc-600">›</span>
          <Link to="/teleop" className="hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">Teleop</Link>
        </div>
        <Link to="/teleop" className="justify-self-end inline-flex items-center gap-1 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">
          Teleop ->
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-6 flex flex-col gap-4 max-w-[1600px] mx-auto w-full">
          <PageHeader
            title="Calibration"
            subtitle="Measure joint ranges - Generate calibration file",
            action={
              <div className="flex items-center gap-3">
                <ModeToggle options={["Single Arm", "Bi-Arm"]} value={mode} onChange={setMode} />
                <RefreshButton onClick={() => { void loadDevices(); void refreshFiles(); }} />
              </div>
            }
          />

          {/* Blockers */}
          {!running && conflictRunning.length > 0 && (
            <BlockerCard
              title="Calibration blocked",
              severity="error"
              reasons={conflictRunning.map((p) => `${p} process is running`)}
            />
          )}
          {!running && arms.length === 0 && (
            <BlockerCard title="Calibration blocked" reasons={["No arms detected. Connect USB and refresh."]} />
          )}

          <div className="flex flex-col gap-6">
            {/* Row 1: Config + Files */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

              {/* Config Card */}
              <Card title={isBiArm ? "Step 1 — Bi-Arm Setup" : "Step 1 — Single Arm Setup"}>
                <div className="flex flex-col gap-3">
                  {isBiArm ? (
                    <>
                      <FieldRow label="Arm role type">
                        <WireSelect
                          value={biType}
                          options={["bi_so_follower", "bi_so_leader"]}
                          onChange={(v) => {
                            setBiType(v);
                            setBiId(v.includes("leader") ? "bimanual_leader" : "bimanual_follower");
                          }}
                        />
                      </FieldRow>
                      <FieldRow label="Left arm port">
                        <WireSelect
                          value={biLeftPort}
                          options={armPortOptions}
                          onChange={setBiLeftPort}
                        />
                      </FieldRow>
                      <FieldRow label="Right arm port">
                        <WireSelect
                          value={biRightPort}
                          options={armPortOptions}
                          onChange={setBiRightPort}
                        />
                      </FieldRow>
                      <FieldRow label="Arm ID">
                        <WireInput value={biId} onChange={setBiId} placeholder="e.g. bimanual_follower" />
                      </FieldRow>
                      <p className="text-sm text-zinc-400">Calibrate both arms sequentially.</p>
                    </>
                  ) : (
                    <>
                      {typeMismatch && (
                        <div className="flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-400 px-1">
                          <AlertTriangle size={12} className="flex-none" />
                          Type and port do not match
                        </div>
                      )}
                      <FieldRow label="Arm role type">
                        <WireSelect
                          value={armType}
                          options={armTypes.filter((t) => !t.startsWith("bi_"))}
                          onChange={setArmType}
                        />
                      </FieldRow>
                      <FieldRow label="Arm port">
                        <WireSelect
                          value={port}
                          options={armPortOptions}
                          onChange={setPort}
                        />
                      </FieldRow>
                      <FieldRow label="Arm ID">
                        <WireSelect value={armId} options={armIdOptions} onChange={setArmId} />
                      </FieldRow>

                      {/* File status */}
                      {fileStatus && (
                        <div className={`px-3 py-2 rounded border text-sm ${
                          fileStatus === "found"
                            ? "border-emerald-500/30 bg-emerald-500/5"
                            : "border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/30"
                        }`}>
                          <div className="flex items-center gap-2 mb-1">
                            <StatusBadge status={fileStatus === "found" ? "ready" : "warning"} label={fileStatus === "found" ? "Found" : "Missing"} />
                            <span className="text-sm text-zinc-400">{armId}.json</span>
                          </div>
                          <div className="text-sm text-zinc-500 font-mono whitespace-pre-line">{fileMeta}</div>
                        </div>
                      )}
                    </>
                  )}

                  <div className="flex justify-end">
                    {!running ? (
                      <button
                        type="button"
                        onClick={() => { void handleStart(); }}
                        disabled={typeMismatch || blocked}
                        className={`px-4 py-2 rounded border text-sm cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${typeMismatch || blocked ? "border-zinc-600 text-zinc-500 cursor-not-allowed" : "border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"}`}
                      >
                        <Play size={13} className="fill-current" /> Start Calibration
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { void handleStop(); }}
                        className="px-4 py-2 rounded border border-red-500/30 text-sm text-red-500 hover:bg-red-500/10 cursor-pointer whitespace-nowrap flex items-center gap-1.5"
                      >
                        <Square size={11} className="fill-current" /> Stop
                      </button>
                    )}
                </div>
              </Card>

              {/* Files Card */}
              <Card
                title="Existing calibration files",
                action={
                  <div className="flex items-center gap-2">
                    <WireSelect
                      value={fileFilter}
                      options={["All", ...Array.from(new Set(files.map((f) => f.guessed_type)))]}
                      onChange={setFileFilter}
                    />
                    <button onClick={() => { void refreshFiles(); }} className="text-zinc-400 cursor-pointer hover:text-zinc-300">
                      <RefreshCw size={12} />
                    </button>
                  </div>
                }
              >
                <div className="flex flex-col gap-1">
                  {filteredFiles.length === 0 ? (
                    <p className="text-sm text-zinc-500 py-2">No calibration files.</p>
                  ) : filteredFiles.map((f) => (
                    <div
                      key={`${f.id}-${f.guessed_type}`}
                      onClick={() => { setArmId(f.id); if (armTypes.includes(f.guessed_type)) setArmType(f.guessed_type); }}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer group transition-colors ${
                        armId === f.id
                          ? "bg-blue-500/10 border border-blue-500/30"
                          : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50 border border-transparent"
                      }`}
                    >
                      <span
                        className={`size-1.5 rounded-full flex-none ${fileHasMatchingArm(f, arms) ? "bg-emerald-400" : "bg-zinc-400"}`}
                        title={fileHasMatchingArm(f, arms) ? "Matches connected arm" : "No match"}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-zinc-700 dark:text-zinc-300 truncate">{f.id}</div>
                        <div className="text-sm text-zinc-400 truncate">{f.guessed_type} · {f.modified ?? ""}</div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); void handleDeleteFile(f); }}
                        className="p-1 text-zinc-300 dark:text-zinc-600 hover:text-red-400 cursor-pointer"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            {/* Connected Arms */}
            {arms.length > 0 && (
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800">
                  <span className="text-sm text-zinc-500">Connected arms ({arms.length})</span>
                </div>
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
                  {arms.map((arm, i) => (
                    <div key={arm.device} className="flex items-center gap-3 px-3 py-2">
                      <div className="size-7 rounded bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                        <Bot size={14} className="text-zinc-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-zinc-700 dark:text-zinc-300 font-mono truncate">{armPath(arm, i)}</div>
                        {arm.symlink && <div className="text-sm text-zinc-400">{arm.symlink}</div>}
                      </div>
                      <StatusBadge status={arm.symlink ? "ready" : "warning"} label={arm.symlink ? "linked" : "no link"} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Live Motor Ranges */}
            <Card
              title="Live motor range visualization",
              badge={running ? <StatusBadge status="running" label="LIVE" pulse /> : undefined}
            >
              {running && motorRows.length > 0 ? (
                <div className="flex flex-col gap-1 py-1">
                  {motorRows.map((row) => (
                    <RangeBar key={row.name} {...row} />
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={<Ruler size={28} />}
                  message={running ? "Waiting for motor range data…" : "Press Start Calibration to see live ranges."}
                />
              )}
            </Card>
          </div>
        </div>
      </div>

      {/* Sticky control bar */}
      <StickyControlBar>
        <div className="flex items-center gap-3">
          <StatusBadge
            status={running ? "running" : "ready"}
            label={running ? "CALIBRATING" : "READY"}
            pulse={running}
          />
          {fileStatus === "found" && !running && (
            <span className="text-sm text-zinc-400">
              Calibration file found · <Link to="/teleop" className="text-emerald-500 hover:underline">Go to Teleop -&gt;</Link>
            </span>
          )}
        </div>
      </StickyControlBar>
    </div>
  );
}
