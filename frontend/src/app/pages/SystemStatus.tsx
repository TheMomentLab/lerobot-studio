import { useState, useEffect } from "react";
import { RefreshCw, Camera, Bot, ChevronDown, ChevronUp, Trash2, Info } from "lucide-react";
import {
  PageHeader, StatusBadge, ResourceBar, Chip,
} from "../components/wireframe";
import { apiGet, apiPost } from "../services/apiClient";
import { useHfAuth } from "../hf-auth-context";
import { useLeStudioStore } from "../store";
import {
  fromBackendHistory,
  fromBackendResources,
  type UiHistoryEntry,
  type UiResourcesData,
} from "../services/contracts";

// ─── Types ────────────────────────────────────────────────────────────────────
type CameraDevice = { device: string; symlink: string | null; path: string; kernels?: string; model?: string };
type ArmDevice = { device: string; symlink: string | null; path: string; serial?: string };

type GpuStatusResponse = { exists: boolean; utilization: number; memory_used: number; memory_total: number; memory_percent: number; };
// 표시할 프로세스 목록 (key: procStatus key, label: UI 표시명)
const PROCESS_DEFS = [
  { key: "teleop",       label: "Teleop" },
  { key: "record",       label: "Record" },
  { key: "calibrate",    label: "Calibrate" },
  { key: "motor_setup",  label: "Motor Setup" },
  { key: "train",        label: "Train" },
  { key: "eval",         label: "Eval" },
] as const;

export function SystemStatus() {
  const { hfAuth } = useHfAuth();
  const procStatus = useLeStudioStore((s) => s.procStatus);
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [arms, setArms] = useState<ArmDevice[]>([]);
  const [resources, setResources] = useState<UiResourcesData | null>(null);
  const [resourcesLoading, setResourcesLoading] = useState(true);
  const [historyItems, setHistoryItems] = useState<UiHistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [gpuStatus, setGpuStatus] = useState<GpuStatusResponse | null>(null);


  const processes = PROCESS_DEFS.map((def) => ({
    key: def.key,
    label: def.label,
    running: procStatus[def.key] === true,
  }));
  const runningCount = processes.filter((p) => p.running).length;

  const refreshStatus = () => {
    apiGet<{ cameras: CameraDevice[]; arms: ArmDevice[] }>("/api/devices").then((res) => {
      setCameras(res.cameras ?? []);
      setArms(res.arms ?? []);
    });
    setResourcesLoading(true);
    apiGet<unknown>("/api/system/resources")
      .then((res) => setResources(fromBackendResources(res)))
      .catch(() => setResources(null))
      .finally(() => setResourcesLoading(false));
    apiGet<unknown>("/api/history").then((res) => setHistoryItems(fromBackendHistory(res)));
    apiGet<GpuStatusResponse>("/api/gpu/status").then((res) => { if (res.exists) setGpuStatus(res); }).catch(() => {});
  };

  useEffect(() => {
    refreshStatus();
  }, []);

  const linkedCams = cameras.filter((c) => c.symlink != null).length;
  const linkedArms = arms.filter((a) => a.symlink != null).length;

  const handleClearHistory = () => {
    apiPost("/api/history/clear").then(() => setHistoryItems([]));
  };

  const handleRefresh = () => {
    refreshStatus();
  };


  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 sm:p-6 flex flex-col gap-3 sm:gap-4 max-w-[1600px] mx-auto w-full">
          <div className="flex items-start justify-between">
            <PageHeader
              title="System Status"
              subtitle="하드웨어 및 시스템 전체 준비 상태 대시보드"
            />
            <button onClick={handleRefresh} className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all shadow-sm cursor-pointer">
              <RefreshCw size={14} className="text-zinc-400" />
              Refresh All
            </button>
          </div>

          {/* Verdict Banner — 컴팩트 + 액션 링크 */}
          <div className="flex items-center gap-3 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40">
            <Info size={14} className="text-zinc-400 flex-none" />
            <span className="text-sm text-zinc-600 dark:text-zinc-300">점검 권장 항목</span>
            <div className="flex flex-wrap gap-1.5 ml-auto">
              <Chip
                label={hfAuth === "ready" ? "HF 토큰 정상" : hfAuth === "missing_token" ? "HF 토큰 없음" : hfAuth === "expired_token" ? "HF 토큰 만료" : "HF 인증 실패"}
                color={hfAuth === "ready" ? "green" : hfAuth === "missing_token" || hfAuth === "expired_token" ? "amber" : "red"}
                icon="→"
              />
            </div>
          </div>

          {/* 프로세스 상태 — 인라인 리스트 */}
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
              <span className="text-sm text-zinc-500">프로세스 ({processes.length})</span>
              <span className="flex items-center gap-1 text-sm">
                <span className="size-1.5 rounded-full bg-emerald-400" />
                <span className="text-zinc-400">{runningCount} running</span>
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-x divide-zinc-200 dark:divide-zinc-700">
              {processes.map((p) => (
                <div key={p.key} className={`flex items-center gap-2 px-3 py-2 ${p.running ? "bg-emerald-50/60 dark:bg-emerald-950/20" : ""}`}>
                  <span className="relative flex size-2 flex-none">
                    <span className={`rounded-full size-2 ${p.running ? "bg-emerald-400" : "bg-zinc-400 dark:bg-zinc-600"}`} />
                    {p.running && (
                      <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-75" />
                    )}
                  </span>
                  <span className={`text-sm truncate ${p.running ? "text-zinc-800 dark:text-zinc-200 font-medium" : "text-zinc-600 dark:text-zinc-400"}`}>{p.label}</span>
                  <span className={`ml-auto text-sm ${p.running ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-400 dark:text-zinc-500"}`}>{p.running ? "running" : "idle"}</span>
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
                {resourcesLoading ? (
                  <div className="text-sm text-zinc-400 py-2">로딩 중...</div>
                ) : resources === null ? (
                  <div className="flex items-center gap-2 py-2">
                    <span className="text-sm text-zinc-400">리소스 정보를 가져올 수 없습니다.</span>
                    <button
                      onClick={refreshStatus}
                      className="text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 underline transition-colors cursor-pointer"
                    >
                      다시 시도
                    </button>
                  </div>
                ) : (
                  <>
                    <ResourceBar label="CPU" value={resources.cpu_percent} max={100} />
                    <ResourceBar label="RAM" value={resources.ram_used} max={resources.ram_total ?? 32} unit="GB" />
                    <ResourceBar label="Disk (home)" value={resources.disk_used} max={resources.disk_total ?? 512} unit="GB" />
                    {gpuStatus && (
                      <>
                        <ResourceBar label="GPU" value={gpuStatus.utilization} max={100} />
                        <ResourceBar label="VRAM" value={Math.round(gpuStatus.memory_used / 1024 * 10) / 10} max={Math.round(gpuStatus.memory_total / 1024 * 10) / 10} unit="GB" />
                      </>
                    )}
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-zinc-400 w-24 flex-none">LeRobot Cache</span>
                      <div className="flex-1" />
                      <span className="text-sm text-zinc-400 w-20 text-right flex-none">{resources.cache_size} GB</span>
                    </div>
                  </>
                )}
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
