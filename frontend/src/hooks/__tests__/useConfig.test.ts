import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiGet, apiPost } from '../../lib/api'
import type { LeStudioConfig } from '../../lib/types'
import { useConfig } from '../useConfig'

interface ConfigStoreSlice {
  config: LeStudioConfig
  setConfig: (cfg: LeStudioConfig) => void
  updateConfig: (partial: Partial<LeStudioConfig>) => void
}

const useLeStudioStoreMock = vi.hoisted(() => vi.fn<(selector: (state: ConfigStoreSlice) => unknown) => unknown>())

vi.mock('../../store', () => ({
  useLeStudioStore: (selector: (state: ConfigStoreSlice) => unknown) => useLeStudioStoreMock(selector),
}))

vi.mock('../../lib/api', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}))

const makeConfig = (overrides: Partial<LeStudioConfig> = {}): LeStudioConfig => ({
  robot_mode: 'single',
  robot_id: 'robot-1',
  teleop_id: 'teleop-1',
  follower_port: '/dev/ttyUSB0',
  leader_port: '/dev/ttyUSB1',
  left_follower_port: '',
  right_follower_port: '',
  left_leader_port: '',
  right_leader_port: '',
  left_robot_id: '',
  right_robot_id: '',
  left_teleop_id: '',
  right_teleop_id: '',
  cameras: {},
  camera_settings: { codec: 'mjpeg', width: 640, height: 480, fps: 30, jpeg_quality: 90 },
  record_task: 'pick-place',
  record_episodes: 5,
  record_repo_id: 'local/repo',
  record_resume: false,
  train_dataset_source: 'local',
  eval_policy_path: '',
  eval_repo_id: 'local/eval',
  eval_episodes: 1,
  eval_device: 'cpu',
  eval_task: 'task',
  profile_name: 'default',
  process_view_url: '',
  ...overrides,
})

describe('useConfig', () => {
  let storeState: ConfigStoreSlice

  beforeEach(() => {
    storeState = {
      config: makeConfig(),
      setConfig: vi.fn(),
      updateConfig: vi.fn(),
    }

    useLeStudioStoreMock.mockImplementation((selector) => selector(storeState))
    vi.mocked(apiGet).mockReset()
    vi.mocked(apiPost).mockReset()
  })

  it('returns current config from store', () => {
    const { result } = renderHook(() => useConfig())
    expect(result.current.config).toEqual(storeState.config)
  })

  it('loads config successfully and stores it', async () => {
    const loaded = makeConfig({ robot_id: 'robot-loaded' })
    vi.mocked(apiGet).mockResolvedValue(loaded)

    const { result } = renderHook(() => useConfig())
    const value = await result.current.loadConfig()

    expect(apiGet).toHaveBeenCalledWith('/api/config')
    expect(storeState.setConfig).toHaveBeenCalledWith(loaded)
    expect(value).toEqual(loaded)
  })

  it('propagates load errors and does not update store', async () => {
    const error = new Error('network failed')
    vi.mocked(apiGet).mockRejectedValue(error)

    const { result } = renderHook(() => useConfig())
    await expect(result.current.loadConfig()).rejects.toThrow('network failed')
    expect(storeState.setConfig).not.toHaveBeenCalled()
  })

  it('saves current config when no argument is provided', async () => {
    vi.mocked(apiPost).mockResolvedValue({ ok: true })

    const { result } = renderHook(() => useConfig())
    const saved = await result.current.saveConfig()

    expect(apiPost).toHaveBeenCalledWith('/api/config', storeState.config)
    expect(saved).toEqual(storeState.config)
  })

  it('builds config from partial updates and persists merged result', async () => {
    vi.mocked(apiPost).mockResolvedValue({ ok: true })
    const partial: Partial<LeStudioConfig> = { record_episodes: 12, record_resume: true }

    const { result } = renderHook(() => useConfig())
    const next = await result.current.buildConfig(partial)

    expect(storeState.updateConfig).toHaveBeenCalledWith(partial)
    expect(apiPost).toHaveBeenCalledWith('/api/config', {
      ...storeState.config,
      ...partial,
    })
    expect(next).toEqual({
      ...storeState.config,
      ...partial,
    })
  })
})
