import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Camera, Eye, EyeOff, X, AlertCircle } from "lucide-react";
import { apiGet, apiPost } from "../services/apiClient";
import {
  PageHeader, WireBox, WireSelect, EmptyState, RefreshButton,
} from "../components/wireframe";
import { toVideoName, useCameraFeeds } from "../hooks/useCameraFeeds";

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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activePreviews, setActivePreviews] = useState<Record<string, boolean>>({});
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [cameraAssignments, setCameraAssignments] = useState<Record<string, string>>({});

  const togglePreview = (id: string) =>
    setActivePreviews((prev) => ({ ...prev, [id]: !prev[id] }));

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const devices = await apiGet<DeviceResponse>("/api/devices");
      const nextCameras = Array.isArray(devices.cameras) ? devices.cameras : [];
      setCameras(nextCameras);

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

  const applyMapping = async (nextAssignments: Record<string, string>) => {
    setSaving(true);
    setError(null);
    try {
      const assignments: Record<string, string> = {};
      for (const cam of cameras) {
        if (!cam.kernels) continue;
        const role = nextAssignments[cam.device] ?? "(none)";
        assignments[cam.kernels] = role;
      }

      const result = await apiPost<ApplyRulesResponse>("/api/rules/apply", {
        assignments,
        arm_assignments: {},
      });

      if (!result.ok) {
        setError(result.error ?? "failed to apply mapping");
      } else {
        await refresh();
      }
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "failed to apply mapping";
      setError(friendlyError(message));
    } finally {
      setSaving(false);
    }
  };

  const previewTargets = useMemo(
    () => cameras
      .filter((cam) => activePreviews[cam.device])
      .map((cam) => ({ id: cam.device, videoName: toVideoName(cam.path) })),
    [cameras, activePreviews],
  );
  const previewFrames = useCameraFeeds(previewTargets, previewTargets.length > 0, 10);

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
          {/* Camera list */}
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Cameras ({cameras.length})</span>
            </div>
            <div className="px-4 flex-1">
              <div className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800/50 border-b border-zinc-100 dark:border-zinc-800/50">
                {cameras.map((cam) => {
                  const role = cameraAssignments[cam.device] ?? "(none)";
                  const dimmed = role === "(none)";
                  return (
                    <div key={cam.device}>
                      <div className={`flex items-center gap-3 py-2.5${dimmed ? " opacity-40" : ""}`}>
                        <button
                          onClick={() => togglePreview(cam.device)}
                          className="size-7 rounded bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors group"
                          title={activePreviews[cam.device] ? "Close preview" : "Preview camera"}
                        >
                          {activePreviews[cam.device] ? (
                            <EyeOff size={14} className="text-blue-500" />
                          ) : (
                            <Eye size={14} className="text-zinc-400 group-hover:text-blue-500 transition-colors" />
                          )}
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-zinc-700 dark:text-zinc-300 font-mono truncate">{cam.path}</div>
                          <div className="text-sm text-zinc-400">Port: {cam.kernels ?? "?"} · {cam.model ?? "Unknown"}</div>
                        </div>
                        <div className="w-44 flex-none" onClick={(e) => e.stopPropagation()}>
                          <WireSelect
                            value={labelForRole(role)}
                            options={CAMERA_ROLES.map(labelForRole)}
                            onChange={(nextLabel) => {
                              const nextRole = Object.entries(ROLE_LABELS).find(([, label]) => label === nextLabel)?.[0] ?? "(none)";
                              const next = { ...cameraAssignments, [cam.device]: nextRole };
                              setCameraAssignments(next);
                              void applyMapping(next);
                            }}
                          />
                        </div>
                      </div>
                      {activePreviews[cam.device] && (
                        <div className="pb-3">
                          <div className="relative rounded border border-zinc-200 dark:border-zinc-700 overflow-hidden bg-zinc-100 dark:bg-zinc-800 max-w-lg mx-auto">
                            <div className="aspect-video bg-zinc-950">
                              {previewFrames[cam.device] ? (
                                <img
                                  src={previewFrames[cam.device]}
                                  alt={`Preview ${cam.model ?? cam.device} ${cam.path}`}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <span className="text-sm text-zinc-500">Connecting...</span>
                                </div>
                              )}
                            </div>
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
    </div>
  );
}
