import { Pause, Play } from "lucide-react";
import { WireBox } from "../../../components/wireframe";

type CameraMapping = { role: string; path: string };

type RecordingRunningViewProps = {
  camerasMapped: CameraMapping[];
  cameraFrames: Record<string, string | null>;
  cameraStats: Record<string, { fps: number; mbps: number }>;
  pausedFeeds: Record<string, boolean>;
  currentEp: number;
  totalEps: number;
  progress: number;
  lastEvent: string | null;
  cameraStatsRows: Array<{ role: string; fps: number }>;
  onToggleFeed: (role: string) => void;
  onSave: () => void;
  onDiscard: () => void;
};

export function RecordingRunningView({
  camerasMapped,
  cameraFrames,
  cameraStats,
  pausedFeeds,
  currentEp,
  totalEps,
  progress,
  lastEvent,
  cameraStatsRows,
  onToggleFeed,
  onSave: _onSave,
  onDiscard: _onDiscard,
}: RecordingRunningViewProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800">
        <span className="text-sm text-zinc-400 flex-none">Episode</span>
        <span className="text-sm font-mono text-zinc-800 dark:text-zinc-200">{currentEp} / {totalEps}</span>
        <div className="flex-1 h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-sm text-zinc-500 flex-none">{progress}%</span>
        {lastEvent && (
          <span className="text-sm text-zinc-500 flex-none ml-2 truncate max-w-48">
            Last: {lastEvent}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2 text-sm text-zinc-400">
        {cameraStatsRows.map((row) => (
          <span key={row.role} className={row.fps < 25 ? "text-amber-600 dark:text-amber-400" : ""}>
            {row.role}: {row.fps.toFixed(1)} fps
          </span>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {camerasMapped.map((cam) => {
          const frameSrc = cameraFrames[cam.role];
          return (
            <div key={cam.role} className="relative rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-800">
              <div className="aspect-video bg-zinc-200 dark:bg-zinc-900 relative">
                {!pausedFeeds[cam.role] ? (
                  frameSrc ? (
                    <img src={frameSrc} alt={`${cam.role} stream`} className="absolute inset-0 h-full w-full object-cover" />
                  ) : (
                    <WireBox
                      className="absolute inset-0 border-0 rounded-none"
                      label={`MJPEG stream — ${cam.role}`}
                    />
                  )
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-zinc-600">
                    <span className="text-sm flex items-center gap-1"><Pause size={10} className="fill-current" /> Paused</span>
                  </div>
                )}

                <div className="absolute top-2 left-2 flex items-center gap-1.5">
                  <span className="px-1.5 py-0.5 rounded bg-red-500/80 text-white text-sm font-mono">REC</span>
                  <span className="px-1.5 py-0.5 rounded bg-black/60 text-white text-sm font-mono">{Math.round(cameraStats[cam.role]?.fps ?? 30)} fps</span>
                </div>
                <button
                  onClick={() => onToggleFeed(cam.role)}
                  className="absolute top-2 right-2 p-1.5 rounded bg-black/50 text-white cursor-pointer hover:bg-black/70 transition-colors"
                >
                  {pausedFeeds[cam.role]
                    ? <Play size={10} className="fill-current" />
                    : <Pause size={10} className="fill-current" />}
                </button>
              </div>
              <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-900">
                <div className="text-sm text-zinc-600 dark:text-zinc-300">{cam.role}</div>
                <div className="text-sm text-zinc-400 font-mono">{cam.path}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2 text-sm text-zinc-400">
        {[
          { key: "→", desc: "Save Episode" },
          { key: "←", desc: "Discard" },
          { key: "Esc", desc: "End Recording" },
        ].map((s) => (
          <div key={s.key} className="flex items-center gap-1.5">
            <kbd className="px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 font-mono text-zinc-500 bg-zinc-50 dark:bg-zinc-900">
              {s.key}
            </kbd>
            <span>{s.desc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
