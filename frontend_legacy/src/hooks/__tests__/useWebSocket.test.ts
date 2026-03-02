import { renderHook, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWebSocket } from '../useWebSocket'

interface WebSocketStoreSlice {
  appendLog: (processName: string, text: string, kind: string) => void
  setProcStatus: (status: Record<string, boolean>) => void
  setWsReady: (ready: boolean) => void
  setApiHealth: (key: string, value: boolean) => void
  setApiSupport: (key: string, value: boolean) => void
}

const useLeStudioStoreMock = vi.hoisted(() => vi.fn<(selector: (state: WebSocketStoreSlice) => unknown) => unknown>())

vi.mock('../../store', () => ({
  useLeStudioStore: (selector: (state: WebSocketStoreSlice) => unknown) => useLeStudioStoreMock(selector),
}))

type WsHandler<K extends keyof WebSocketEventMap> = ((this: WebSocket, ev: WebSocketEventMap[K]) => unknown) | null

class MockWebSocket {
  static instances: MockWebSocket[] = []

  readonly url: string
  onopen: WsHandler<'open'> = null
  onclose: WsHandler<'close'> = null
  onmessage: WsHandler<'message'> = null
  onerror: WsHandler<'error'> = null
  readonly close = vi.fn(() => undefined)

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  emitOpen() {
    this.onopen?.call(this as unknown as WebSocket, new Event('open'))
  }

  emitClose() {
    this.onclose?.call(this as unknown as WebSocket, new CloseEvent('close'))
  }

  emitMessage(payload: object) {
    const event = new MessageEvent('message', { data: JSON.stringify(payload) })
    this.onmessage?.call(this as unknown as WebSocket, event)
  }
}

class MockNotification {
  static permission: NotificationPermission = 'granted'
  static requestPermission = vi.fn<() => Promise<NotificationPermission>>().mockResolvedValue('granted')
  static calls: Array<{ title: string; options?: NotificationOptions }> = []
  onclick: (() => void) | null = null

  constructor(title: string, options?: NotificationOptions) {
    MockNotification.calls.push({ title, options })
  }
}

describe('useWebSocket', () => {
  const appendLog = vi.fn<(processName: string, text: string, kind: string) => void>()
  const setProcStatus = vi.fn<(status: Record<string, boolean>) => void>()
  const setWsReady = vi.fn<(ready: boolean) => void>()
  const setApiHealth = vi.fn<(key: string, value: boolean) => void>()
  const setApiSupport = vi.fn<(key: string, value: boolean) => void>()

  beforeEach(() => {
    appendLog.mockReset()
    setProcStatus.mockReset()
    setWsReady.mockReset()
    setApiHealth.mockReset()
    setApiSupport.mockReset()
    MockWebSocket.instances = []
    MockNotification.calls = []

    useLeStudioStoreMock.mockImplementation((selector) =>
      selector({
        appendLog,
        setProcStatus,
        setWsReady,
        setApiHealth,
        setApiSupport,
      }),
    )

    Object.defineProperty(globalThis, 'WebSocket', {
      value: MockWebSocket as unknown as typeof WebSocket,
      configurable: true,
      writable: true,
    })

    Object.defineProperty(window, 'Notification', {
      value: MockNotification,
      configurable: true,
      writable: true,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('connects websocket and toggles ready status', () => {
    const { unmount } = renderHook(() => useWebSocket())
    expect(MockWebSocket.instances).toHaveLength(1)

    act(() => {
      MockWebSocket.instances[0].emitOpen()
    })

    expect(setWsReady).toHaveBeenCalledWith(true)

    unmount()

    expect(setWsReady).toHaveBeenCalledWith(false)
    expect(MockWebSocket.instances[0].close).toHaveBeenCalledTimes(1)
  })

  it('handles output, status, API health/support, and metric messages', () => {
    renderHook(() => useWebSocket())
    const socket = MockWebSocket.instances[0]

    act(() => {
      socket.emitMessage({ type: 'output', process: 'train_install', text: '[ERROR] failed step', kind: 'error' })
      socket.emitMessage({ type: 'status', processes: { train: true, train_install: true, record: false } })
      socket.emitMessage({ type: 'api_health', key: 'resources', value: false })
      socket.emitMessage({ type: 'api_support', key: 'history', value: true })
      socket.emitMessage({
        type: 'metric',
        process: 'train',
        metric: { step: 10, total: 100, loss: 0.42, lr: 0.0003 },
      })
    })

    expect(appendLog).toHaveBeenCalledWith('train_install', '[ERROR] failed step', 'error')
    expect(appendLog).toHaveBeenCalledWith('train', '[ERROR] failed step', 'error')
    expect(appendLog).toHaveBeenCalledWith('train', 'step=10 cfg.steps=100 loss=0.42 lr=0.0003', 'info')
    expect(setProcStatus).toHaveBeenCalledWith({ train: true, train_install: true, record: false })
    expect(setApiHealth).toHaveBeenCalledWith('resources', false)
    expect(setApiSupport).toHaveBeenCalledWith('history', true)
  })

  it('reconnects after unexpected close', () => {
    vi.useFakeTimers()
    renderHook(() => useWebSocket())
    const firstSocket = MockWebSocket.instances[0]

    act(() => {
      firstSocket.emitClose()
    })

    expect(setWsReady).toHaveBeenCalledWith(false)

    act(() => {
      vi.advanceTimersByTime(3000)
    })

    expect(MockWebSocket.instances).toHaveLength(2)
  })
})
