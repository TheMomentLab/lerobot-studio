import '@testing-library/jest-dom'
import { afterEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// WebSocket stub — useWebSocket opens a real WebSocket URL which fails in
// jsdom and schedules a 3-second reconnect timer. The stub prevents that.
// ---------------------------------------------------------------------------
class WebSocketStub {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  readyState = WebSocketStub.CLOSED
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: Event) => void) | null = null
  close() {}
  send() {}
}
vi.stubGlobal('WebSocket', WebSocketStub)

// ---------------------------------------------------------------------------
// fetch stub — App.tsx and its children fire apiGet calls on mount. Without
// a stub these would fail (no backend) and leave pending promises that
// prevent the test worker from exiting cleanly.
// blob() is also stubbed because useCameraFeeds calls res.blob() on snapshots.
// ---------------------------------------------------------------------------
vi.stubGlobal(
  'fetch',
  vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({}),
    blob: () => Promise.resolve(new Blob()),
  }),
)

// Restore all stubs between tests so they don’t leak across files.
afterEach(() => {
  vi.restoreAllMocks()
})
