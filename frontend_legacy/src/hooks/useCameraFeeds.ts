import { useEffect, useRef, useState } from 'react'

/**
 * Polls /api/camera/snapshot/{cam} for each camera and returns blob URLs.
 *
 * Unlike MJPEG <img src="/stream/...">, this approach:
 *  - Does NOT keep HTTP connections permanently open
 *  - Allows the browser page-load spinner to complete normally
 *  - Frees the connection pool for concurrent API calls
 *
 * @param camNames  List of camera symlink names (e.g. ["top_cam_1", "follower_cam_1"])
 * @param active    Whether the parent tab is active
 * @param fps       Target polling rate (default 30)
 * @param pausedFeeds  Map of cam -> true when that feed is paused
 */
export function useCameraFeeds(
  camNames: string[],
  active: boolean,
  fps: number = 30,
  pausedFeeds: Record<string, boolean> = {},
): Record<string, string> {
  const [frames, setFrames] = useState<Record<string, string>>({})

  // Keep a ref so the async fetch loop can read the latest paused state
  // without restarting the entire effect.
  const pausedRef = useRef(pausedFeeds)
  useEffect(() => { pausedRef.current = pausedFeeds })

  // Stable key for camNames so the effect only restarts when cameras change.
  const camKey = camNames.join(',')

  useEffect(() => {
    if (!active || camNames.length === 0) {
      setFrames({})
      return
    }

    let cancelled = false
    const interval = Math.max(66, Math.round(1000 / fps)) // min 66ms (~15fps floor)
    const blobUrls: Record<string, string> = {}

    const fetchLoop = async (cam: string) => {
      if (cancelled) return

      if (!pausedRef.current[cam]) {
        const start = Date.now()
        try {
          const res = await fetch(`/api/camera/snapshot/${encodeURIComponent(cam)}`)
          if (!cancelled && res.ok) {
            const blob = await res.blob()
            const newUrl = URL.createObjectURL(blob)
            const oldUrl = blobUrls[cam]
            blobUrls[cam] = newUrl
            setFrames((prev) => ({ ...prev, [cam]: newUrl }))
            if (oldUrl) URL.revokeObjectURL(oldUrl)
          }
        } catch {
          // Network error or abort — will retry next interval
        }
        const elapsed = Date.now() - start
        const delay = Math.max(0, interval - elapsed)
        if (!cancelled) setTimeout(() => fetchLoop(cam), delay)
      } else {
        // Feed paused — check again later
        if (!cancelled) setTimeout(() => fetchLoop(cam), 200)
      }
    }

    camNames.forEach((cam) => fetchLoop(cam))

    return () => {
      cancelled = true
      Object.values(blobUrls).forEach((url) => URL.revokeObjectURL(url))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, camKey, fps])

  return frames
}
