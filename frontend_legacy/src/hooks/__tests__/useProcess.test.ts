import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiPost } from '../../lib/api'
import type { PreflightResponse } from '../../lib/types'
import { useProcess } from '../useProcess'

interface ProcessStoreSlice {
  appendLog: (processName: string, text: string, kind: string) => void
}

const useLeStudioStoreMock = vi.hoisted(() => vi.fn<(selector: (state: ProcessStoreSlice) => unknown) => unknown>())

vi.mock('../../store', () => ({
  useLeStudioStore: (selector: (state: ProcessStoreSlice) => unknown) => useLeStudioStoreMock(selector),
}))

vi.mock('../../lib/api', () => ({
  apiPost: vi.fn(),
}))

describe('useProcess', () => {
  const appendLog = vi.fn<(processName: string, text: string, kind: string) => void>()

  beforeEach(() => {
    appendLog.mockReset()
    useLeStudioStoreMock.mockImplementation((selector) => selector({ appendLog }))
    vi.mocked(apiPost).mockReset()
    vi.stubGlobal('fetch', vi.fn())
  })

  it('logs preflight checks and returns true when preflight passes', async () => {
    const preflight: PreflightResponse = {
      ok: true,
      checks: [
        { status: 'ok', label: 'camera', msg: 'connected' },
        { status: 'warn', label: 'disk', msg: 'space is low' },
      ],
    }
    vi.mocked(apiPost).mockResolvedValue(preflight)

    const { result } = renderHook(() => useProcess())
    const ok = await result.current.runPreflight({ robot_id: 'r1' }, 'record')

    expect(ok).toBe(true)
    expect(apiPost).toHaveBeenCalledWith('/api/preflight', { robot_id: 'r1' })
    expect(appendLog).toHaveBeenCalledWith('record', '[OK] camera: connected', 'stdout')
    expect(appendLog).toHaveBeenCalledWith('record', '[WARN] disk: space is low', 'info')
    expect(appendLog).toHaveBeenCalledWith('record', '[INFO] Preflight passed with warnings.', 'info')
  })

  it('logs failure message and returns false when preflight fails', async () => {
    const preflight: PreflightResponse = {
      ok: false,
      checks: [{ status: 'error', label: 'arm', msg: 'not detected' }],
    }
    vi.mocked(apiPost).mockResolvedValue(preflight)

    const { result } = renderHook(() => useProcess())
    const ok = await result.current.runPreflight({ robot_id: 'r1' }, 'teleop')

    expect(ok).toBe(false)
    expect(appendLog).toHaveBeenCalledWith('teleop', '[ERROR] arm: not detected', 'error')
    expect(appendLog).toHaveBeenCalledWith('teleop', '[ERROR] Preflight failed. Fix errors before starting.', 'error')
  })

  it('sends process input and stop requests through apiPost', async () => {
    vi.mocked(apiPost).mockResolvedValue({ ok: true })
    const { result } = renderHook(() => useProcess())

    await result.current.sendProcessInput('train', 'next')
    await result.current.stopProcess('train')

    expect(apiPost).toHaveBeenCalledWith('/api/process/train/input', { text: 'next' })
    expect(apiPost).toHaveBeenCalledWith('/api/process/train/stop')
  })

  it('returns helpful message for missing command endpoint', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue({ ok: false, status: 404 } as Response)

    const { result } = renderHook(() => useProcess())
    const response = await result.current.runProcessCommand('record', 'pause')

    expect(response.ok).toBe(false)
    expect(response.error).toContain('/api/process/record/command')
  })

  it('throws on non-404 command errors', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue({ ok: false, status: 500 } as Response)

    const { result } = renderHook(() => useProcess())
    await expect(result.current.runProcessCommand('record', 'pause')).rejects.toThrow('POST /api/process/record/command failed: 500')
  })

  it('returns parsed command response on success', async () => {
    const payload = { ok: true, command: 'pause' }
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => payload,
    } as Response)

    const { result } = renderHook(() => useProcess())
    const response = await result.current.runProcessCommand('record', 'pause')

    expect(fetchMock).toHaveBeenCalledWith('/api/process/record/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'pause' }),
    })
    expect(response).toEqual(payload)
  })
})
