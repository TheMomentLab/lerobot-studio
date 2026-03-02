/**
 * useMappedCameras — Derive symlink→path map from Zustand devices store.
 *
 * Ported from frontend_legacy/src/hooks/useMappedCameras.ts
 * adapted to current frontend store shape.
 */
import { useMemo } from "react";
import { apiGet } from "../services/apiClient";
import { useLeStudioStore } from "../store";
import type { DevicesResponse } from "../store/types";

export type MappedCameraEntry = [symlink: string, path: string];

export function useMappedCameras() {
  const devices = useLeStudioStore((s) => s.devices);
  const setDevices = useLeStudioStore((s) => s.setDevices);

  const mappedCameras: Record<string, string> = useMemo(() => {
    const out: Record<string, string> = {};
    for (const camera of devices.cameras) {
      if (camera.symlink) {
        out[camera.symlink] = `/dev/${camera.symlink}`;
      }
    }
    return out;
  }, [devices]);

  const mappedCamEntries: MappedCameraEntry[] = useMemo(
    () => Object.entries(mappedCameras),
    [mappedCameras],
  );

  const refreshDevices = async () => {
    const data = await apiGet<DevicesResponse>("/api/devices");
    setDevices({ cameras: data.cameras ?? [], arms: data.arms ?? [] });
    return data;
  };

  return { mappedCameras, mappedCamEntries, refreshDevices };
}
