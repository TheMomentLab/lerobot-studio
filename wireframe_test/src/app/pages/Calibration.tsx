import React, { useState } from "react";
import { Link } from "react-router";
import { RefreshCw, Trash2, Ruler, AlertTriangle, Play } from "lucide-react";
import {
  PageHeader, Card, SectionHeader, WireSelect, WireInput, FieldRow,
  ProcessButtons, ModeToggle, StatusBadge, EmptyState, StickyControlBar, BlockerCard
} from "../components/wireframe";

type CalibFile = {
  id: string;
  type: string;
  modified: string;
  matched: boolean;
};

const CALIB_FILES: CalibFile[] = [
  { id: "follower_arm_1", type: "Follower", modified: "2026-03-01 13:45", matched: true },
  { id: "follower_arm_0", type: "Follower", modified: "2026-02-28 10:12", matched: false },
  { id: "leader_arm_1", type: "Leader", modified: "2026-03-01 13:50", matched: true },
  { id: "other_arm", type: "Other", modified: "2026-02-25 08:00", matched: false },
];

const MOTOR_NAMES = ["shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll", "gripper"];
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
        {/* Track */}
        <div className="absolute inset-y-1 inset-x-0 rounded-full bg-zinc-200 dark:bg-zinc-700" />
        {/* Range */}
        <div
          className="absolute inset-y-1 rounded-full bg-blue-400/40"
          style={{ left: `${minPct}%`, width: `${rangePct}%` }}
        />
        {/* Current pos */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-emerald-400"
          style={{ left: `${posPct}%` }}
        />
      </div>
      <div className="flex gap-2 text-sm font-mono text-zinc-400 w-36 flex-none">
        <span className="text-zinc-500 w-10">MIN <span className="text-zinc-400">{min}</span></span>
        <span className="text-emerald-600 dark:text-emerald-400 w-10">POS {pos}</span>
        <span className="text-zinc-500 w-10">MAX {max}</span>
      </div>
    </div>
  );
}

export function Calibration() {
  const [mode, setMode] = useState("Single Arm");
  const [running, setRunning] = useState(false);
  const [fileFilter, setFileFilter] = useState("All");
  const [advOpen, setAdvOpen] = useState(false);

  // Single Arm controlled fields
  const [armType, setArmType] = useState("so101_follower");
  const [port, setPort] = useState("/dev/lerobot/follower_arm");
  const [armId, setArmId] = useState("follower_arm_1");

  const typeMismatch =
    mode === "Single Arm" &&
    ((armType.includes("follower") && port.includes("leader")) ||
      (armType.includes("leader") && port.includes("follower")));

  const filteredFiles = fileFilter === "All"
    ? CALIB_FILES
    : CALIB_FILES.filter((f) => f.type === fileFilter);

  return (
    <div className="flex flex-col h-full">
      {/* Top nav bar */}
      <div className="flex items-center justify-between px-6 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-sm text-zinc-400">
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
        <Link to="/teleop" className="inline-flex items-center gap-1 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">
          Teleop →
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-6 flex flex-col gap-4 max-w-[1600px] mx-auto w-full">
          <div className="flex items-start justify-between">
            <PageHeader
              title="Calibration"
              subtitle="관절 범위 측정 → 캘리브레이션 파일 생성"
              status={running ? "running" : "ready"}
            />
            <ModeToggle
              options={["Single Arm", "Bi-Arm"]}
              value={mode}
              onChange={setMode}
            />
          </div>

          <div className="flex flex-col gap-6">
            {/* Row 1: Config + Files — 1:1 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card title={mode === "Single Arm" ? "Step 1 — Single Arm 설정" : "Step 1 — Bi-Arm 설정"}>
                <div className="flex flex-col gap-3">
                  {mode === "Single Arm" ? (
                    <>
                      {typeMismatch && (
                        <div className="flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-400 px-1">
                          <AlertTriangle size={12} className="flex-none" />
                          타입과 포트가 일치하지 않습니다
                        </div>
                      )}
                      <FieldRow label="팔 역할 타입">
                        <WireSelect
                          value={armType}
                          options={["so101_follower", "so100_leader", "so101_leader", "so100_follower"]}
                          onChange={setArmType}
                        />
                      </FieldRow>
                      <FieldRow label="팔 포트">
                        <WireSelect
                          value={port}
                          options={["/dev/lerobot/follower_arm", "/dev/lerobot/leader_arm"]}
                          onChange={setPort}
                        />
                      </FieldRow>
                      <FieldRow label="팔 ID">
                        <WireInput value={armId} onChange={setArmId} placeholder="캘리브레이션 파일명" />
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
                    running={running}
                    onStart={() => setRunning(true)}
                    onStop={() => setRunning(false)}
                    startLabel={<><Play size={13} className="fill-current" /> Start Calibration</>}
                    disabled={typeMismatch}
                  />
                </div>
              </Card>

              <Card
                title="기존 캘리브레이션 파일"
                action={
                  <div className="flex items-center gap-2">
                    <WireSelect
                      value={fileFilter}
                      options={["All", "Follower", "Leader", "Other"]}
                      onChange={setFileFilter}
                    />
                    <button className="text-zinc-400 cursor-pointer">
                      <RefreshCw size={12} />
                    </button>
                  </div>
                }
              >
                <div className="flex flex-col gap-1">
                  {filteredFiles.map((f) => (
                    <div
                      key={f.id}
                      onClick={() => setArmId(f.id)}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer group transition-colors ${
                        armId === f.id
                          ? "bg-blue-500/10 border border-blue-500/30"
                          : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50 border border-transparent"
                      }`}
                    >
                      <span className={`size-1.5 rounded-full flex-none ${f.matched ? "bg-emerald-400" : "bg-zinc-400"}`} title={f.matched ? "현재 연결된 팔과 매칭" : "매칭 안 됨"} />
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

            {/* Row 3: Range Viz — full width */}
            <Card
              title="실시간 모터 범위 시각화"
              badge={running ? <StatusBadge status="running" label="LIVE" pulse /> : undefined}
            >
              {running ? (
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
        </div>
      </StickyControlBar>
    </div>
  );
}