/**
 * App smoke test — verifies the App shell mounts without crashing.
 *
 * All 9 tab components are mocked to lightweight stubs so this test does
 * not depend on backend connectivity, camera feeds, or WebSocket state.
 * The real App wiring (store, routing, theme, keyboard shortcuts) still runs.
 */
import { render, cleanup, act } from '@testing-library/react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { MantineProvider } from '@mantine/core'

// ---------------------------------------------------------------------------
// Stub all 9 tabs — each is a heavy component with its own effects/polling.
// We only need to verify the App shell (AppShell, ToastLayer, tab routing)
// renders without errors.
// ---------------------------------------------------------------------------
vi.mock('./tabs/StatusTab', () => ({ StatusTab: () => null }))
vi.mock('./tabs/TeleopTab', () => ({ TeleopTab: () => null }))
vi.mock('./tabs/RecordTab', () => ({ RecordTab: () => null }))
vi.mock('./tabs/CalibrateTab', () => ({ CalibrateTab: () => null }))
vi.mock('./tabs/MotorSetupTab', () => ({ MotorSetupTab: () => null }))
vi.mock('./tabs/DeviceSetupTab', () => ({ DeviceSetupTab: () => null }))
vi.mock('./tabs/DatasetTab', () => ({ DatasetTab: () => null }))
vi.mock('./tabs/TrainTab', () => ({ TrainTab: () => null }))
vi.mock('./tabs/EvalTab', () => ({ EvalTab: () => null }))

// Stub the WebSocket hook — prevents reconnect timers from being scheduled.
vi.mock('./hooks/useWebSocket', () => ({ useWebSocket: vi.fn() }))

import App from './App'

afterEach(cleanup)

describe('App component', () => {
  it('renders without crashing', async () => {
    let container!: HTMLElement
    await act(async () => {
      ;({ container } = render(
        <MantineProvider>
          <App />
        </MantineProvider>,
      ))
    })
    expect(container).toBeInTheDocument()
  })
})
