import React, { useState } from "react";
import { Link } from "react-router";
import { RefreshCw, Camera, X } from "lucide-react";
import {
  PageHeader, StatusBadge, WireBox, WireSelect,
} from "../components/wireframe";

const CAMERAS = [
  { id: "video0", path: "/dev/video0", port: "usb-2.1", model: "C920", role: "Top Camera 1" },
  { id: "video2", path: "/dev/video2", port: "usb-2.2", model: "C270", role: "Wrist Camera 1" },
  { id: "video4", path: "/dev/video4", port: "usb-2.4", model: "Unknown", role: "" },
];

const CAMERA_ROLES = ["Not used", "Top Camera 1", "Top Camera 2", "Top Camera 3", "Wrist Camera 1", "Wrist Camera 2"];

export function CameraSetup() {
  const [udevOpen, setUdevOpen] = useState(false);
  const [activePreviews, setActivePreviews] = useState<Record<string, boolean>>({});

  const togglePreview = (id: string) =>
    setActivePreviews((prev) => ({ ...prev, [id]: !prev[id] }));

  const mappedCount = CAMERAS.filter((c) => c.role && c.role !== "Not used").length;

  return (
    <div className="flex flex-col h-full">
      {/* Top nav bar */}
      <div className="flex items-center justify-between px-6 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-sm text-zinc-400">
        <Link to="/" className="inline-flex items-center gap-1 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">
          ← System Status
        </Link>
        <div className="flex items-center gap-2">
          <span className="text-zinc-300 dark:text-zinc-600">System Status</span>
          <span className="text-zinc-300 dark:text-zinc-600">›</span>
          <span className="text-zinc-700 dark:text-zinc-200 font-medium">Camera Setup</span>
          <span className="text-zinc-300 dark:text-zinc-600">›</span>
          <Link to="/motor-setup" className="hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">Motor Setup</Link>
        </div>
        <Link to="/motor-setup" className="inline-flex items-center gap-1 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">
          Motor Setup →
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-6 flex flex-col gap-4 max-w-[1600px] mx-auto w-full">
          <div className="flex items-start justify-between">
            <PageHeader
              title="Camera Setup"
              subtitle="카메라 매핑 및 역할 설정"
              status="warning"
              statusLabel="Incomplete"
            />
            <button className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all shadow-sm cursor-pointer">
              <RefreshCw size={14} className="text-zinc-400" />
              Refresh
            </button>
          </div>

          {/* udev 규칙 — 인라인 배지 + 토글 */}
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
                    { port: "usb-2.1", sym: "lerobot/top_cam_1", mode: "0666", status: "Active" },
                    { port: "usb-2.2", sym: "lerobot/wrist_cam_1", mode: "0666", status: "Active" },
                  ].map((row) => (
                    <tr key={row.sym}>
                      <td className="py-1.5 px-3 font-mono text-zinc-500">{row.port}</td>
                      <td className="py-1.5 px-3 font-mono text-zinc-400">{row.sym}</td>
                      <td className="py-1.5 px-3 font-mono text-zinc-500">{row.mode}</td>
                      <td className="py-1.5 px-3">
                        <span className="text-emerald-600 dark:text-emerald-400">{row.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 카메라 리스트 */}
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/30 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
              <span className="text-sm text-zinc-500">카메라 ({CAMERAS.length})</span>
              <div className="flex items-center gap-3 text-sm">
                <span className="flex items-center gap-1">
                  <span className="size-1.5 rounded-full bg-emerald-400" />
                  <span className="text-zinc-400">{mappedCount} / {CAMERAS.length} 매핑됨</span>
                </span>
              </div>
            </div>
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
              {CAMERAS.map((cam) => (
                <div key={cam.id}>
                  {/* 카메라 행 */}
                  <div className="flex items-center gap-4 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors border-b border-zinc-100 dark:border-zinc-800/50 last:border-0">
                    {/* 카메라 아이콘 — 클릭 시 프리뷰 토글 */}
                    <div
                      onClick={() => togglePreview(cam.id)}
                      className={`size-12 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center flex-none cursor-pointer overflow-hidden relative group${!cam.role || cam.role === "Not used" ? " opacity-40" : ""}`}
                    >
                      {activePreviews[cam.id] ? (
                        <WireBox className="absolute inset-0 border-0 rounded-none text-[8px]" label="LIVE" />
                      ) : (
                        <Camera size={14} className="text-zinc-500 group-hover:text-zinc-400 transition-colors" />
                      )}
                    </div>

                    {/* 정보 */}
                    <div className={`flex-1 min-w-0${!cam.role || cam.role === "Not used" ? " opacity-40" : ""}`}>
                      <div className="text-sm text-zinc-700 dark:text-zinc-300 font-mono truncate">{cam.path}</div>
                      <div className="text-sm text-zinc-400">Port: {cam.port} · {cam.model}</div>
                    </div>

                    {/* 역할 선택 */}
                    <div className="w-44 flex-none">
                      <WireSelect
                        value={cam.role || "Not used"}
                        options={CAMERA_ROLES}
                      />
                    </div>
                  </div>

                  {/* 확장 프리뷰 */}
                  {activePreviews[cam.id] && (
                    <div className="px-3 pb-3">
                      <div className="relative rounded border border-zinc-200 dark:border-zinc-700 overflow-hidden bg-zinc-100 dark:bg-zinc-800">
                        <WireBox className="w-full border-0 rounded-none" aspectRatio="16/9" label={`MJPEG stream — ${cam.model} (${cam.path})`} />
                        <button
                          onClick={() => togglePreview(cam.id)}
                          className="absolute top-2 right-2 size-6 rounded bg-black/50 flex items-center justify-center cursor-pointer hover:bg-black/70"
                        >
                          <X size={12} className="text-white" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
