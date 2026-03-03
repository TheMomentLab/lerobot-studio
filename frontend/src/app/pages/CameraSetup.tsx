import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Camera, X, AlertCircle } from "lucide-react";
import { apiGet, apiPost } from "../services/apiClient";
import {
  PageHeader, StatusBadge, WireBox, WireSelect, EmptyState, RefreshButton,
} from "../components/wireframe";
import { toVideoName } from "../hooks/useCameraFeeds";

type CameraDevice = {
  device: string;
  path: string;
  kernels?: string;
  symlink?: string | null;
  model?: string;
};

type DeviceResponse = {
  cameras?: CameraDevice[];
};

type RuleItem = {
  kernel?: string;
  symlink?: string;
  mode?: string;
  exists?: boolean;
};

type RulesCurrentResponse = {
  content?: string;
  camera_rules?: RuleItem[];
};

type RulesStatusResponse = {
  rules_installed?: boolean;
  install_needed?: boolean;
  needs_root_for_install?: boolean;
};

type VerifyResult = {
  role?: string;
  exists?: boolean;
  status?: string;
};

type RulesVerifyResponse = {
  results?: VerifyResult[];
};

type ApplyRulesResponse = {
  ok?: boolean;
  error?: string;
};

const CAMERA_ROLES = ["(none)", "top_cam_1", "top_cam_2", "top_cam_3", "wrist_cam_1", "wrist_cam_2"];

const ROLE_LABELS: Record<string, string> = {
  "(none)": "Not used",
  top_cam_1: "Top Camera 1",
  top_cam_2: "Top Camera 2",
  top_cam_3: "Top Camera 3",
  wrist_cam_1: "Wrist Camera 1",
  wrist_cam_2: "Wrist Camera 2",
};

function normalizeRole(raw: string | null | undefined): string {
  const cleaned = String(raw ?? "").trim().replace(/^\/+/, "");
  if (!cleaned) return "(none)";
  const role = cleaned.includes("/") ? cleaned.split("/").at(-1) ?? cleaned : cleaned;
  return CAMERA_ROLES.includes(role) ? role : "(none)";
}

function labelForRole(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

/** Convert technical error messages to user-friendly English */
function friendlyError(raw: string): string {
  if (/unexpected end of json/i.test(raw) || /json\.parse/i.test(raw) || /failed to execute.*json/i.test(raw))
    return "Unable to process server response. Please check if the backend is running.";
  if (/failed to fetch/i.test(raw) || /network/i.test(raw) || /ECONNREFUSED/i.test(raw))
    return "Cannot connect to server. Please check your network connection.";
  if (/timeout/i.test(raw))
    return "Server response timeout. Please try again later.";
  if (/404/i.test(raw))
    return "Requested API not found. Please check the backend version.";
  if (/500|internal server/i.test(raw))
    return "Internal server error. Please check the backend logs.";
  return raw;
}

export function CameraSetup() {
  const [udevOpen, setUdevOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [activePreviews, setActivePreviews] = useState<Record<string, boolean>>({});
  const [previewLoadError, setPreviewLoadError] = useState<Record<string, boolean>>({});
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [cameraAssignments, setCameraAssignments] = useState<Record<string, string>>({});
  const [cameraRules, setCameraRules] = useState<RuleItem[]>([]);
  const [rulesStatus, setRulesStatus] = useState<RulesStatusResponse | null>(null);
  const [verifyResults, setVerifyResults] = useState<VerifyResult[]>([]);

  const togglePreview = (id: string) =>
    setActivePreviews((prev) => {
      const nextOpen = !prev[id];
      if (nextOpen) {
        setPreviewLoadError((prevError) => ({ ...prevError, [id]: false }));
      }
      return { ...prev, [id]: nextOpen };
    });

  const fetchReadableRules = async (): Promise<RulesCurrentResponse> => {
    try {
      return await apiGet<RulesCurrentResponse>("/api/udev/rules");
    } catch {
      return await apiGet<RulesCurrentResponse>("/api/rules/current");
    }
  };

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const [devices, rules, status, verify] = await Promise.all([
        apiGet<DeviceResponse>("/api/devices"),
        fetchReadableRules(),
        apiGet<RulesStatusResponse>("/api/rules/status"),
        apiGet<RulesVerifyResponse>("/api/rules/verify"),
      ]);
      const nextCameras = Array.isArray(devices.cameras) ? devices.cameras : [];
      setCameras(nextCameras);
      setCameraRules(Array.isArray(rules.camera_rules) ? rules.camera_rules : []);
      setRulesStatus(status);
      setVerifyResults(Array.isArray(verify.results) ? verify.results : []);

      const nextAssignments: Record<string, string> = {};
      for (const cam of nextCameras) {
        nextAssignments[cam.device] = normalizeRole(cam.symlink);
      }
      setCameraAssignments(nextAssignments);
    } catch (refreshError) {
      const message = refreshError instanceof Error ? refreshError.message : "failed to load camera data";
      setError(friendlyError(message));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const handleSaveMapping = async () => {
    setSaving(true);
    setSaveMessage(null);
    setError(null);
    try {
      const assignments: Record<string, string> = {};
      for (const cam of cameras) {
        if (!cam.kernels) continue;
        const role = cameraAssignments[cam.device] ?? "(none)";
        assignments[cam.kernels] = role;
      }

      const result = await apiPost<ApplyRulesResponse>("/api/rules/apply", {
        assignments,
        arm_assignments: {},
      });

      if (!result.ok) {
        setError(result.error ?? "failed to apply mapping");
      } else {
        setSaveMessage("Mapping rules applied successfully.");
        await refresh();
      }
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "failed to apply mapping";
      setError(friendlyError(message));
    } finally {
      setSaving(false);
    }
  };

  const mappedCount = useMemo(
    () => cameras.filter((cam) => (cameraAssignments[cam.device] ?? "(none)") !== "(none)").length,
    [cameras, cameraAssignments],
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 flex flex-col gap-4 max-w-[1600px] mx-auto w-full">
          <PageHeader
            title="Camera Setup"
            subtitle="Camera mapping and role assignment"
            action={<RefreshButton onClick={() => { void refresh(); }} />}
          />

          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-red-500/30 bg-red-500/5">
              <AlertCircle size={13} className="text-red-600 dark:text-red-400 flex-none" />
              <span className="text-sm text-red-600 dark:text-red-400 flex-1">{error}</span>
            </div>
          )}
          {saveMessage && (
            <div className="px-3 py-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-sm text-emerald-700 dark:text-emerald-300">
              {saveMessage}
            </div>
          )}

          {/* udev rules — inline badges + toggle */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-500">udev rules</span>
              <StatusBadge status={cameraRules.length > 0 ? "ready" : "warning"} label={cameraRules.length > 0 ? "Detected" : "Not applied"} />
              {rulesStatus?.needs_root_for_install && (
                <StatusBadge status="warning" label="Root required" />
              )}
              {rulesStatus?.install_needed && (
                <StatusBadge status="warning" label="Installation needed" />
              )}
            </div>
            <button
              onClick={() => setUdevOpen(!udevOpen)}
              className="text-sm text-zinc-400 hover:text-zinc-300 cursor-pointer"
            >
              {udevOpen ? "Hide" : "Show details"}
            </button>
          </div>

          {udevOpen && (
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden flex flex-col gap-0">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/30">
                    {["Port", "Symlink", "Mode", "Status"].map((h) => (
                      <th key={h} className="text-left py-1.5 px-3 text-zinc-400 font-normal">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
                  {cameraRules.map((row) => (
                    <tr key={`${row.kernel ?? "?"}-${row.symlink ?? "?"}`}>
                      <td className="py-1.5 px-3 font-mono text-zinc-500">{row.kernel ?? "-"}</td>
                      <td className="py-1.5 px-3 font-mono text-zinc-400">{row.symlink ?? "-"}</td>
                      <td className="py-1.5 px-3 font-mono text-zinc-500">{row.mode ?? "-"}</td>
                      <td className="py-1.5 px-3">
                        <span className={row.exists ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>
                          {row.exists ? "Active" : "Not applied"}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {cameraRules.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-3 px-3 text-sm text-zinc-500">No camera udev rules yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
              <div className="border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/20 px-3 py-2 flex items-center justify-between">
                <span className="text-xs text-zinc-500">Rule verification</span>
                {verifyResults.length === 0 ? (
                  <span className="text-xs text-zinc-400">No verification results.</span>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {verifyResults.map((row, idx) => {
                      const ok = row.status === "ok" || row.exists === true;
                      return (
                        <span
                          key={`${row.role ?? "unknown"}-${idx}`}
                          className={ok
                            ? "px-2 py-0.5 rounded border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs"
                            : "px-2 py-0.5 rounded border border-amber-500/30 text-amber-600 dark:text-amber-400 text-xs"}
                        >
                          {(row.role ?? "unknown")}: {ok ? "OK" : "Not applied"}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Camera list */}
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
            <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
              <span className="text-sm text-zinc-500">Cameras ({cameras.length})</span>
              <div className="flex items-center gap-3 text-sm">
                <span className="flex items-center gap-1">
                  <span className="size-1.5 rounded-full bg-emerald-400" />
                  <span className="text-zinc-400">{mappedCount} / {cameras.length} mapped</span>
                </span>
                <button
                  onClick={() => { void handleSaveMapping(); }}
                  disabled={saving || loading}
                  className="px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-60 cursor-pointer"
                >
                  {saving ? "Applying..." : "Apply mapping"}
                </button>
              </div>
            </div>
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
              {cameras.map((cam) => {
                const role = cameraAssignments[cam.device] ?? "(none)";
                const dimmed = role === "(none)";
                return (
                <div key={cam.device}>
                  {/* Camera row */}
                  <div onClick={() => togglePreview(cam.device)} className="flex items-center gap-4 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors border-b border-zinc-100 dark:border-zinc-800/50 last:border-0 cursor-pointer">
                    {/* Camera icon — click to toggle preview */}
                    <div
                      className={`size-12 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center flex-none overflow-hidden relative group${dimmed ? " opacity-40" : ""}`}
                    >
                      {activePreviews[cam.device] ? (
                        <WireBox className="absolute inset-0 border-0 rounded-none text-[8px]" label="LIVE" />
                      ) : (
                        <Camera size={14} className="text-zinc-500 group-hover:text-zinc-400 transition-colors" />
                      )}
                    </div>

                    {/* Info */}
                    <div className={`flex-1 min-w-0${dimmed ? " opacity-40" : ""}`}>
                      <div className="text-sm text-zinc-700 dark:text-zinc-300 font-mono truncate">{cam.path}</div>
                      <div className="text-sm text-zinc-400">Port: {cam.kernels ?? "?"} · {cam.model ?? "Unknown"}</div>
                    </div>

                    {/* Role selection */}
                    <div className="w-44 flex-none" onClick={(e) => e.stopPropagation()}>
                      <WireSelect
                        value={labelForRole(role)}
                        options={CAMERA_ROLES.map(labelForRole)}
                        onChange={(nextLabel) => {
                          const nextRole = Object.entries(ROLE_LABELS).find(([, label]) => label === nextLabel)?.[0] ?? "(none)";
                          setCameraAssignments((prev) => ({ ...prev, [cam.device]: nextRole }));
                        }}
                      />
                    </div>
                  </div>

                  {/* Expanded preview */}
                  {activePreviews[cam.device] && (
                    <div className="px-3 pb-3">
                      <div className="relative rounded border border-zinc-200 dark:border-zinc-700 overflow-hidden bg-zinc-100 dark:bg-zinc-800 max-w-lg mx-auto">
                        {previewLoadError[cam.device] ? (
                          <WireBox className="w-full border-0 rounded-none" aspectRatio="16/9" label={`MJPEG stream — ${cam.model ?? cam.device} (${cam.path})`} />
                        ) : (
                          <img
                            src={`/stream/${encodeURIComponent(toVideoName(cam.path))}?preview=1`}
                            alt={`MJPEG stream ${cam.model ?? cam.device} ${cam.path}`}
                            className="w-full aspect-video object-cover bg-zinc-950"
                            onError={() => {
                              setPreviewLoadError((prev) => ({ ...prev, [cam.device]: true }));
                            }}
                          />
                        )}
                        <button
                          onClick={() => togglePreview(cam.device)}
                          className="absolute top-2 right-2 size-6 rounded bg-black/50 flex items-center justify-center cursor-pointer hover:bg-black/70"
                        >
                          <X size={12} className="text-white" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                );
              })}
              {!loading && cameras.length === 0 && (
                <EmptyState
                  icon={<Camera size={28} />}
                  message="No cameras detected. Connect devices and click Refresh."
                  messageClassName="max-w-none whitespace-nowrap"
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
