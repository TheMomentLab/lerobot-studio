import React, { useState, useEffect } from "react";
import { Link } from "react-router";
import { RefreshCw, Camera, Bot, ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import {
  PageHeader, StatusBadge, ResourceBar, Chip,
} from "../components/wireframe";
import { apiGet, apiPost } from "../services/apiClient";

// ─── Types ────────────────────────────────────────────────────────────────────
type CameraDevice = { device: string; symlink: string | null; path: string; kernels?: string; model?: string };
type ArmDevice = { device: string; symlink: string | null; path: string; serial?: string };
type ResourcesData = { cpu_percent: number; ram_used: number; ram_total: number; disk_used: number; disk_total: number; cache_size: number };
type HistoryEntry = { type: string; ts: string; meta: string };

const PROCESSES = [
  { name: "Teleop", status: "running" as const },
  { name: "Record", status: "idle" as const },
  { name: "Calibrate", status: "idle" as const },
  { name: "Motor Setup", status: "idle" as const },
  { name: "Train", status: "idle" as const },
  { name: "Eval", status: "idle" as const },
];

export function SystemStatus() {
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [arms, setArms] = useState<ArmDevice[]>([]);
  const [resources, setResources] = useState<ResourcesData | null>(null);
  const [historyItems, setHistoryItems] = useState<HistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(true);

  useEffect(() => {
    apiGet<{ cameras: CameraDevice[]; arms: ArmDevice[] }>("/api/devices").then((res) => {
      setCameras(res.cameras ?? []);
      setArms(res.arms ?? []);
    });
    apiGet<ResourcesData>("/api/system/resources").then(setResources);
    apiGet<{ ok: boolean; entries: HistoryEntry[] }>("/api/history").then((res) => setHistoryItems(res.entries));
  }, []);

  const linkedCams = cameras.filter((c) => c.symlink != null).length;
  const linkedArms = arms.filter((a) => a.symlink != null).length;

  const handleClearHistory = () => {
    apiPost("/api/history/clear").then(() => setHistoryItems([]));
  };

  const handleRefresh = () => {
    apiGet<{ cameras: CameraDevice[]; arms: ArmDevice[] }>("/api/devices").then((res) => {
      setCameras(res.cameras ?? []);
      setArms(res.arms ?? []);
    });
    apiGet<ResourcesData>("/api/system/resources").then(setResources);
    apiGet<{ ok: boolean; entries: HistoryEntry[] }>("/api/history").then((res) => setHistoryItems(res.entries));
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 sm:p-6 flex flex-col gap-3 sm:gap-4 max-w-[1600px] mx-auto w-full">
          <div className="flex items-start justify-between">
            <PageHeader
              title="System Status"
              subtitle="하드웨어 및 시스템 전체 준비 상태 대시보드"
              status="warning"
              statusLabel="Action Needed"
            />
            <button onClick={handleRefresh} className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all shadow-sm cursor-pointer">
              <RefreshCw size={14} className="text-zinc-400" />
              Refresh All
            </button>
          </div>

          {/* Verdict Banner — 컴팩트 + 액션 링크 */}
          <div className="flex items-center gap-3 px-3 py-2 rounded-lg border border-amber-500/40 bg-amber-500/10">
            <span className="text-amber-600 dark:text-amber-400 text-sm">⚠</span>
            <span className="text-sm text-amber-700 dark:text-amber-300">일부 항목이 준비되지 않았습니다</span>
            <div className="flex flex-wrap gap-1.5 ml-auto">
              <Link to="/camera-setup" className="hover:opacity-80 transition-opacity">
                <Chip label="디바이스 매핑 미완료" color="amber" icon="→" />
              </Link>
              <Chip label="HF 토큰 만료" color="amber" icon="→" />
            </div>
          </div>

          {/* 프로세스 상태 — 인라인 리스트 */}
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
              <span className="text-sm text-zinc-500">프로세스 ({PROCESSES.length})</span>
              <span className="flex items-center gap-1 text-sm">
                <span className="size-1.5 rounded-full bg-emerald-400" />
                <span className="text-zinc-400">{PROCESSES.filter((p) => p.status === "running").length} running</span>
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-x divide-zinc-200 dark:divide-zinc-700">
              {PROCESSES.map((p) => (
                <div key={p.name} className={`flex items-center gap-2 px-3 py-2 ${p.status === "running" ? "bg-emerald-50/60 dark:bg-emerald-950/20" : ""}`}>
                  <span className="relative flex size-2 flex-none">
                    <span className={`rounded-full size-2 ${p.status === "running" ? "bg-emerald-400" : "bg-zinc-400 dark:bg-zinc-600"}`} />
                    {p.status === "running" && (
                      <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-75" />
                    )}
                  </span>
                  <span className={`text-sm truncate ${p.status === "running" ? "text-zinc-800 dark:text-zinc-200 font-medium" : "text-zinc-600 dark:text-zinc-400"}`}>{p.name}</span>
                  <span className={`ml-auto text-sm ${p.status === "running" ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-400 dark:text-zinc-500"}`}>{p.status}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 카메라 + 팔 — 2열 리스트 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* 카메라 */}
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
              <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                <span className="text-sm text-zinc-500">카메라 ({cameras.length})</span>
                <span className="flex items-center gap-1 text-sm">
                  <span className="size-1.5 rounded-full bg-emerald-400" />
                  <span className="text-zinc-400">{linkedCams} / {cameras.length} linked</span>
                </span>
              </div>
              <div className="divide-y divide-zinc-100 dark:divide-zinc-700">
                {cameras.map((cam) => (
                  <div key={cam.device} className="flex items-center gap-2 sm:gap-3 px-3 py-1.5 sm:py-2">
                    <div className="size-7 rounded bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center hidden sm:flex">
                      <Camera size={14} className="text-zinc-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-zinc-700 dark:text-zinc-300 truncate">{cam.symlink ?? cam.device}</div>
                      <div className="text-sm text-zinc-400 truncate">{cam.path}{cam.model ? ` · ${cam.model}` : ""}</div>
                    </div>
                    <StatusBadge status={cam.symlink ? "ready" : "warning"} label={cam.symlink ? "linked" : "no link"} />
                  </div>
                ))}
              </div>
            </div>

            {/* 팔 */}
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
              <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                <span className="text-sm text-zinc-500">팔 ({arms.length})</span>
                <span className="flex items-center gap-1 text-sm">
                  <span className="size-1.5 rounded-full bg-emerald-400" />
                  <span className="text-zinc-400">{linkedArms} / {arms.length} linked</span>
                </span>
              </div>
              <div className="divide-y divide-zinc-100 dark:divide-zinc-700">
                {arms.map((arm) => (
                  <div key={arm.device} className="flex items-center gap-2 sm:gap-3 px-3 py-1.5 sm:py-2">
                    <div className="size-7 rounded bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center hidden sm:flex">
                      <Bot size={14} className="text-zinc-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-zinc-700 dark:text-zinc-300 truncate">{arm.symlink ?? arm.device}</div>
                      <div className="text-sm text-zinc-400 truncate">{arm.path}{arm.serial ? ` · S/N: ${arm.serial}` : ""}</div>
                    </div>
                    <StatusBadge status={arm.symlink ? "ready" : "warning"} label={arm.symlink ? "linked" : "no link"} />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 시스템 리소스 + 세션 히스토리 — 2열 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* 시스템 리소스 */}
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden flex flex-col">
              <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800 flex items-center">
                <span className="text-sm text-zinc-500">시스템 리소스</span>
              </div>
              <div className="p-3 flex flex-col gap-3 flex-1 justify-start">
                <ResourceBar label="CPU" value={resources?.cpu_percent ?? 0} max={100} />
                <ResourceBar label="RAM" value={resources?.ram_used ?? 0} max={resources?.ram_total ?? 32} unit="GB" />
                <ResourceBar label="Disk (home)" value={resources?.disk_used ?? 0} max={resources?.disk_total ?? 512} unit="GB" />
                <div className="flex items-center gap-3">
                  <span className="text-sm text-zinc-400 w-24 flex-none">LeRobot Cache</span>
                  <div className="flex-1" />
                  <span className="text-sm text-zinc-400 w-20 text-right flex-none">{resources?.cache_size ?? 0} GB</span>
                </div>
              </div>
            </div>

            {/* 세션 히스토리 */}
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden flex flex-col">
              <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                <button
                  onClick={() => setHistoryOpen(!historyOpen)}
                  className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-400 transition-colors cursor-pointer"
                >
                  {historyOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  세션 히스토리 ({historyItems.length})
                </button>
                {historyItems.length > 0 && (
                  <button
                    onClick={handleClearHistory}
                    className="flex items-center gap-1 text-sm text-zinc-500 hover:text-red-400 transition-colors cursor-pointer"
                  >
                    <Trash2 size={11} /> Clear
                  </button>
                )}
              </div>
              {historyOpen && (
                historyItems.length > 0 ? (
                  <div className="divide-y divide-zinc-100 dark:divide-zinc-700 overflow-y-auto max-h-[200px]">
                    {historyItems.map((h, i) => (
                      <div key={i} className="flex items-center gap-3 px-3 py-2">
                        <div className="size-2 rounded-full bg-zinc-300 dark:bg-zinc-600 flex-none" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-zinc-700 dark:text-zinc-300">{h.type}</span>
                            <span className="text-sm text-zinc-400">{h.ts}</span>
                          </div>
                          <div className="text-sm text-zinc-400">{h.meta}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="px-3 py-4 text-center text-sm text-zinc-500">히스토리가 없습니다</div>
                )
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
