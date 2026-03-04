import { useState, useEffect } from "react";
import { Camera, Bot, Cpu, Download, Trash2, AlertCircle, AlertTriangle, CheckCircle2, Link as LinkIcon, History, Shield } from "lucide-react";
import {
  PageHeader, ResourceBar, EmptyState, RefreshButton,
} from "../components/wireframe";
import { apiGet, apiPost } from "../services/apiClient";
import {
  fromBackendHistory,
  fromBackendResources,
  type HistoryCategory,
  type UiHistoryEntry,
  type UiResourcesData,
} from "../services/contracts";
import { useHfAuth } from "../hf-auth-context";

// ─── Types ────────────────────────────────────────────────────────────────────
type CameraDevice = { device: string; symlink: string | null; path: string; kernels?: string; model?: string };
type ArmDevice = { device: string; symlink: string | null; path: string; serial?: string };

type GpuStatusResponse = { exists: boolean; utilization: number; memory_used: number; memory_total: number; memory_percent: number; };

type RulesStatusResponse = {
  rules_installed?: boolean;
  install_needed?: boolean;
  needs_root_for_install?: boolean;
  sudo_noninteractive?: boolean;
  gui_auth_available?: boolean;
  manual_commands?: string[];
};
type RuleItem = { kernel?: string; symlink?: string; mode?: string; exists?: boolean; };
type RulesCurrentResponse = { camera_rules?: RuleItem[]; };

export function SystemStatus() {
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [arms, setArms] = useState<ArmDevice[]>([]);
  const [resources, setResources] = useState<UiResourcesData | null>(null);
  const [resourcesLoading, setResourcesLoading] = useState(true);
  const [historyItems, setHistoryItems] = useState<UiHistoryEntry[]>([]);
  const [expandedHistory, setExpandedHistory] = useState<Set<number>>(new Set());
  const [gpuStatus, setGpuStatus] = useState<GpuStatusResponse | null>(null);
  const [udevRules, setUdevRules] = useState<RuleItem[]>([]);
  const [udevStatus, setUdevStatus] = useState<RulesStatusResponse | null>(null);
  const [udevInstalling, setUdevInstalling] = useState(false);
  const { hfAuth } = useHfAuth();

  const canOneClickInstall = !!(
    udevStatus
    && !udevStatus.rules_installed
    && (udevStatus.sudo_noninteractive || udevStatus.gui_auth_available)
  );

  const handleInstallUdev = async () => {
    setUdevInstalling(true);
    try {
      await apiPost("/api/rules/apply", { assignments: {}, arm_assignments: {} });
      refreshStatus();
    } catch { /* ignore */ }
    finally { setUdevInstalling(false); }
  };

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
    // udev rules
    apiGet<RulesCurrentResponse>("/api/udev/rules")
      .catch(() => apiGet<RulesCurrentResponse>("/api/rules/current"))
      .then((res) => setUdevRules(Array.isArray(res.camera_rules) ? res.camera_rules : []))
      .catch(() => {});
    apiGet<RulesStatusResponse>("/api/rules/status").then(setUdevStatus).catch(() => {});
  };

  useEffect(() => {
    refreshStatus();
  }, []);


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
          <PageHeader
            title="System Status"
            subtitle="Hardware and system readiness dashboard"
            action={<RefreshButton onClick={handleRefresh} />}
          />

          {/* Prerequisites — HF token + udev rules */}
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-card overflow-hidden">
            <div className="px-4 py-3 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-2">
              <Shield size={13} className="text-zinc-400" />
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Prerequisites</span>
            </div>
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
              {/* HF Token */}
              <div className="flex items-center gap-3 px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-zinc-700 dark:text-zinc-300">Hugging Face Token</div>
                  <div className="text-xs text-zinc-400">
                    {hfAuth === "ready" ? "Authenticated — push/pull enabled" : "Required for dataset upload and model download"}
                  </div>
                </div>
                {hfAuth === "ready"
                  ? <CheckCircle2 size={18} className="text-emerald-500 dark:text-emerald-400 flex-none" />
                  : <AlertTriangle size={16} className="text-amber-500 dark:text-amber-400 flex-none" />
                }
              </div>
              {/* udev Rules */}
              <div className="flex flex-col gap-1.5 px-3 py-2">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-zinc-700 dark:text-zinc-300">udev Rules</div>
                    <div className="text-xs text-zinc-400">
                      {udevRules.length > 0
                        ? `${udevRules.length} rule${udevRules.length !== 1 ? "s" : ""} — stable device symlinks`
                        : "Ensures persistent camera/arm paths across reboots"
                      }
                    </div>
                  </div>
                  {udevRules.length > 0 ? (
                    <CheckCircle2 size={18} className="text-emerald-500 dark:text-emerald-400 flex-none" />
                  ) : canOneClickInstall ? (
                    <button
                      onClick={handleInstallUdev}
                      disabled={udevInstalling}
                      className="flex items-center gap-1.5 px-3 py-1 rounded border border-amber-500/30 bg-amber-500/5 text-sm text-amber-500 dark:text-amber-400 hover:bg-amber-500/10 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex-none"
                    >
                      <Download size={12} />
                      {udevInstalling ? "Installing..." : "Install"}
                    </button>
                  ) : (
                    <AlertTriangle size={16} className="text-amber-500 dark:text-amber-400 flex-none" />
                  )}
                </div>
                {udevRules.length === 0 && !canOneClickInstall && udevStatus?.needs_root_for_install && (
                  <div className="text-xs text-zinc-400">
                    Run: <code className="font-mono text-xs bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded px-1.5 py-0.5">lestudio install-udev</code>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Cameras + Arms — 2-column list */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Cameras */}
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-card overflow-hidden">
              <div className="px-4 py-3 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-2">
                <Camera size={13} className="text-zinc-400" />
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Cameras ({cameras.length})</span>
              </div>
              {cameras.length === 0 ? (
                <div className="p-3 flex flex-col gap-3 flex-1 justify-start">
                  <EmptyState
                    icon={<Camera size={28} />}
                    message="No cameras connected."
                    messageClassName="max-w-none whitespace-nowrap"
                  />
                </div>
              ) : (
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
                  {[...cameras].sort((a, b) => (b.symlink ? 1 : 0) - (a.symlink ? 1 : 0)).map((cam) => (
                    <div key={cam.device} className="flex items-center gap-2 sm:gap-3 px-3 py-1.5 sm:py-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-zinc-700 dark:text-zinc-300 truncate">{cam.symlink ?? cam.device}</div>
                        <div className="text-sm text-zinc-400 truncate">{cam.path}{cam.model ? ` · ${cam.model}` : ""}</div>
                      </div>
                      {cam.symlink && <LinkIcon size={16} className="text-zinc-400 flex-none" />}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Arms */}
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-card overflow-hidden">
              <div className="px-4 py-3 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-2">
                <Bot size={13} className="text-zinc-400" />
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Arms ({arms.length})</span>
              </div>
              {arms.length === 0 ? (
                <div className="p-3 flex flex-col gap-3 flex-1 justify-start">
                  <EmptyState
                    icon={<Bot size={28} />}
                    message="No arms connected."
                    messageClassName="max-w-none whitespace-nowrap"
                  />
                </div>
              ) : (
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
                  {[...arms].sort((a, b) => (b.symlink ? 1 : 0) - (a.symlink ? 1 : 0)).map((arm) => (
                    <div key={arm.device} className="flex items-center gap-2 sm:gap-3 px-3 py-1.5 sm:py-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-zinc-700 dark:text-zinc-300 truncate">{arm.symlink ?? arm.device}</div>
                        <div className="text-sm text-zinc-400 truncate">{arm.path}{arm.serial ? ` · S/N: ${arm.serial}` : ""}</div>
                      </div>
                      {arm.symlink && <LinkIcon size={16} className="text-zinc-400 flex-none" />}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* System Resources + Session History — 2-column */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* System Resources */}
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-card overflow-hidden flex flex-col">
              <div className="px-4 py-3 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-2">
                <Cpu size={13} className="text-zinc-400" />
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">System Resources</span>
              </div>
              <div className="p-3 flex flex-col gap-3 flex-1 justify-start">
                {resourcesLoading ? (
                  <div className="text-sm text-zinc-400 py-2">Loading...</div>
                ) : resources === null ? (
                  <EmptyState
                    icon={<AlertCircle size={28} />}
                    message="Unable to fetch resource information."
                    messageClassName="max-w-none whitespace-nowrap"
                  />
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

            {/* Session History */}
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-card overflow-hidden flex flex-col">
              <div className="px-4 py-3 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  <History size={13} className="text-zinc-400" />
                  Session History ({historyItems.length})
                </span>
                {historyItems.length > 0 && (
                  <button
                    onClick={handleClearHistory}
                    className="text-zinc-500 hover:text-red-400 transition-colors cursor-pointer"
                  >
                    <Trash2 size={11} />
                  </button>
                )}
              </div>
              {historyItems.length > 0 ? (
                  <div className="divide-y divide-zinc-100 dark:divide-zinc-800/50 overflow-y-auto max-h-[200px]">
                    {historyItems.map((h, i) => (
                      <HistoryRow
                        key={i}
                        entry={h}
                        expanded={expandedHistory.has(i)}
                        onToggle={() => {
                          setExpandedHistory((prev) => {
                            const next = new Set(prev);
                            if (next.has(i)) next.delete(i); else next.add(i);
                            return next;
                          });
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="p-3">
                    <EmptyState
                      icon={<History size={28} />}
                      message="No history."
                      messageClassName="max-w-none whitespace-nowrap"
                    />
                  </div>
                )
              }
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── History Row ─────────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<HistoryCategory, string> = {
  eval: "bg-blue-400",
  train: "bg-purple-400",
  teleop: "bg-emerald-400",
  record: "bg-amber-400",
  motor: "bg-zinc-400",
  other: "bg-zinc-400",
};

const CATEGORY_LABELS: Record<HistoryCategory, string> = {
  eval: "Eval",
  train: "Train",
  teleop: "Teleop",
  record: "Record",
  motor: "Motor",
  other: "Event",
};

function formatTimeShort(ts: string): string {
  const match = ts.match(/T?(\d{2}:\d{2})/);
  return match ? match[1] : ts;
}

function formatDateLabel(ts: string): string {
  const match = ts.match(/(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

function HistoryRow({ entry, expanded, onToggle }: {
  entry: UiHistoryEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isEnd = entry.type.endsWith("_end");
  const hasDetail = entry.meta && entry.meta !== "{}" && entry.meta !== "\"{}\"";

  return (
    <button
      type="button"
      onClick={hasDetail ? onToggle : undefined}
      className={[
        "flex items-start gap-2.5 px-3 py-1.5 w-full text-left transition-colors",
        hasDetail ? "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/40" : "cursor-default",
      ].join(" ")}
    >
      {/* Category dot */}
      <div className={`size-2 rounded-full mt-1.5 flex-none ${CATEGORY_COLORS[entry.category]}`} />

      <div className="flex-1 min-w-0">
        {/* Summary line */}
        <div className="flex items-center gap-1.5 text-sm">
          <span className="font-medium text-zinc-600 dark:text-zinc-400 flex-none">
            {CATEGORY_LABELS[entry.category]}
          </span>
          {isEnd ? (
            <span className="text-zinc-400 dark:text-zinc-500">finished</span>
          ) : (
            <span className="text-zinc-700 dark:text-zinc-300 truncate">{entry.summary}</span>
          )}
          <span className="ml-auto text-xs text-zinc-400 flex-none tabular-nums">{formatTimeShort(entry.ts)}</span>
        </div>

        {/* Expanded detail */}
        {expanded && hasDetail && (
          <div className="mt-1 text-xs text-zinc-400 dark:text-zinc-500 font-mono break-all whitespace-pre-wrap leading-relaxed">
            {entry.meta}
          </div>
        )}
      </div>
    </button>
  );
}
