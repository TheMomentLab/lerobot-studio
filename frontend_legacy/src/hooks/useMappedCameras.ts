import { useCallback, useMemo } from 'react'
import { apiGet } from '../lib/api'
import type { DevicesResponse } from '../lib/types'
import { useLeStudioStore } from '../store'

export const useMappedCameras = () => {
  const devices = useLeStudioStore((s) => s.devices)
  const setDevices = useLeStudioStore((s) => s.setDevices)

  const mapped = useMemo(() => {
    const out: Record<string, string> = {}
    devices.cameras.forEach((camera) => {
      if (camera.symlink) {
        out[camera.symlink] = `/dev/${camera.symlink}`
      }
    })
    return out
  }, [devices])

  const refreshDevices = useCallback(async () => {
    const data = await apiGet<DevicesResponse>('/api/devices')
    setDevices({ cameras: data.cameras ?? [], arms: data.arms ?? [] })
    return data
  }, [setDevices])

  return { mappedCameras: mapped, refreshDevices }
}
