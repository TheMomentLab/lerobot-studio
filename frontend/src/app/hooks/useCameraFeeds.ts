import { useEffect, useMemo, useRef, useState } from "react";

export type CameraFeedTarget = {
  id: string;
  videoName: string;
};

type SnapshotJsonPayload = {
  data?: string;
};

export function toVideoName(devicePath: string): string {
  const trimmed = devicePath.trim();
  if (!trimmed) return "";
  const parts = trimmed.split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : trimmed;
}

export function useCameraFeeds(
  targets: CameraFeedTarget[],
  active: boolean,
  fps: number = 30,
  pausedFeeds: Record<string, boolean> = {},
): Record<string, string> {
  const [frames, setFrames] = useState<Record<string, string>>({});

  const pausedRef = useRef(pausedFeeds);
  useEffect(() => {
    pausedRef.current = pausedFeeds;
  }, [pausedFeeds]);

  const targetKey = useMemo(
    () => targets.map((target) => `${target.id}:${target.videoName}`).join(","),
    [targets],
  );

  useEffect(() => {
    if (!active || targets.length === 0) {
      setFrames({});
      return;
    }

    let cancelled = false;
    const interval = Math.max(66, Math.round(1000 / fps));
    const frameUrls: Record<string, string> = {};

    const fetchLoop = async (target: CameraFeedTarget) => {
      if (cancelled) return;

      let nextDelay = interval;

      if (!pausedRef.current[target.id]) {
        const startedAt = Date.now();

        try {
          const response = await fetch(`/api/camera/snapshot/${encodeURIComponent(target.videoName)}`, {
            method: "GET",
            cache: "no-store",
          });

          if (!cancelled && response.ok) {
            const contentType = response.headers.get("content-type") ?? "";

            if (contentType.startsWith("image/")) {
              const blob = await response.blob();
              const nextUrl = URL.createObjectURL(blob);
              const prevUrl = frameUrls[target.id];

              frameUrls[target.id] = nextUrl;
              setFrames((prev) => ({ ...prev, [target.id]: nextUrl }));

              if (prevUrl?.startsWith("blob:")) {
                URL.revokeObjectURL(prevUrl);
              }
            } else {
              const json = (await response.json()) as SnapshotJsonPayload;
              if (typeof json.data === "string") {
                frameUrls[target.id] = json.data;
                setFrames((prev) => ({ ...prev, [target.id]: json.data as string }));
              }
            }
            const elapsed = Date.now() - startedAt;
            nextDelay = Math.max(0, interval - elapsed);
          } else {
            const retryAfterHeader = response.headers.get("retry-after");
            const retryAfterSeconds = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : NaN;
            const retryAfterMs = Number.isFinite(retryAfterSeconds) ? retryAfterSeconds * 1000 : 0;
            nextDelay = Math.max(interval * 2, retryAfterMs, 500);
          }
        } catch (error) {
          void error;
          nextDelay = Math.max(interval * 2, 500);
        }

        if (!cancelled) {
          window.setTimeout(() => {
            void fetchLoop(target);
          }, nextDelay);
        }
      } else if (!cancelled) {
        window.setTimeout(() => {
          void fetchLoop(target);
        }, 200);
      }
    };

    targets.forEach((target) => {
      void fetchLoop(target);
    });

    return () => {
      cancelled = true;
      Object.values(frameUrls).forEach((url) => {
        if (url.startsWith("blob:")) {
          URL.revokeObjectURL(url);
        }
      });
    };
  }, [active, targetKey, fps, targets]);

  return frames;
}
