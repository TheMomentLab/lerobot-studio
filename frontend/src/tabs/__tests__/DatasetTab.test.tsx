/**
 * DatasetTab — refactoring safety net
 *
 * Strategy:
 *  - Mock DatasetCurationPanel and DatasetAutoFlagPanel so their internal
 *    setInterval / API calls never fire.
 *  - Stub global fetch to return safe empty-ish responses.
 *  - Tests only verify the outer shell of DatasetTab: headers, list state,
 *    HuggingFace Hub card, and tab visibility toggling.
 *
 * These tests are intentionally coarse-grained. Their job is to catch
 * regressions after the component extraction refactoring, not to re-test
 * sub-component behaviour (that's covered by their own test files).
 */
import { render, screen, cleanup, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MantineProvider } from '@mantine/core'
import { DatasetTab } from '../DatasetTab'

// ─── Mock heavy sub-components ───────────────────────────────────────────────
// Prevents setInterval / fetch side-effects from child panels leaking into
// DatasetTab tests.

vi.mock('../../components/dataset/DatasetCurationPanel', () => ({
  DatasetCurationPanel: () => <div data-testid="curation-panel" />,
}))

vi.mock('../../components/dataset/DatasetAutoFlagPanel', () => ({
  DatasetAutoFlagPanel: () => <div data-testid="autoflag-panel" />,
}))

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** A response factory that returns an empty/safe JSON body */
const okJson = (body: object = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })



/** A factory that mimics /api/hf/token/status → no token saved */
const noTokenResponse = () =>
  okJson({ ok: true, has_token: false, source: 'none', masked_token: '' })

/**
 * Wire up fetch to handle the two requests DatasetTab fires on mount
 * when active=true:
 *   1. GET /api/datasets
 *   2. GET /api/hf/token/status
 */
function stubMountFetch(datasetsBody: object = { datasets: [] }) {
  vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    if (url.includes('/api/hf/token/status')) return Promise.resolve(noTokenResponse())
    if (url.includes('/api/datasets')) return Promise.resolve(okJson(datasetsBody))
    return Promise.resolve(okJson({}))
  })
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

afterEach(cleanup)
beforeEach(() => {
  vi.restoreAllMocks()
})

const renderWithMantine = (ui: React.ReactNode) =>
  render(<MantineProvider>{ui}</MantineProvider>)

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('DatasetTab — inactive (active=false)', () => {
  it('renders without crashing', async () => {
    let container!: HTMLElement
    await act(async () => {
      ;({ container } = renderWithMantine(<DatasetTab active={false} />))
    })
    expect(container).toBeInTheDocument()
  })

  it('section is present but without the "active" class', async () => {
    await act(async () => {
      renderWithMantine(<DatasetTab active={false} />)
    })
    const section = document.getElementById('tab-dataset')
    expect(section).toBeInTheDocument()
    expect(section?.className).not.toContain('active')
  })

  it('does NOT call /api/datasets when inactive (only HubSearchCard token check fires)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, has_token: false, source: 'none', masked_token: '' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    await act(async () => {
      renderWithMantine(<DatasetTab active={false} />)
    })
    // /api/datasets must NOT be called when inactive (useEffect guards on `active`)
    const datasetCalls = spy.mock.calls.filter((args) => {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url
      return url.includes('/api/datasets')
    })
    expect(datasetCalls).toHaveLength(0)
  })
})

describe('DatasetTab — active (active=true)', () => {
  it('section has the "active" class', async () => {
    stubMountFetch()
    await act(async () => {
      renderWithMantine(<DatasetTab active={true} />)
    })
    const section = document.getElementById('tab-dataset')
    expect(section?.className).toContain('active')
  })

  it('renders "Dataset Viewer" heading', async () => {
    stubMountFetch()
    await act(async () => {
      renderWithMantine(<DatasetTab active={true} />)
    })
    expect(screen.getByRole('heading', { name: /Dataset Viewer/i })).toBeInTheDocument()
  })

  it('renders "Local Datasets" heading', async () => {
    stubMountFetch()
    await act(async () => {
      renderWithMantine(<DatasetTab active={true} />)
    })
    expect(screen.getByText(/Local Datasets/i)).toBeInTheDocument()
  })

  it('shows "No datasets found" message when API returns empty list', async () => {
    stubMountFetch({ datasets: [] })
    await act(async () => {
      renderWithMantine(<DatasetTab active={true} />)
    })
    expect(screen.getByText(/No datasets found/i)).toBeInTheDocument()
  })

  it('shows Refresh List button', async () => {
    stubMountFetch()
    await act(async () => {
      renderWithMantine(<DatasetTab active={true} />)
    })
    expect(screen.getByRole('button', { name: /Refresh List/i })).toBeInTheDocument()
  })

  it('renders HuggingFace Hub section (hubCard)', async () => {
    stubMountFetch()
    await act(async () => {
      renderWithMantine(<DatasetTab active={true} />)
    })
    // The hub h3 and the <strong> in the empty-state note both match.
    // Use getAllByText to tolerate multiple occurrences.
    const matches = screen.getAllByText(/HuggingFace Hub/i)
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('shows "No dataset selected" state in episode viewer area', async () => {
    stubMountFetch()
    await act(async () => {
      renderWithMantine(<DatasetTab active={true} />)
    })
    // When no dataset is selected, the right panel shows a placeholder
    expect(screen.getByText(/No dataset selected/i)).toBeInTheDocument()
  })
})

describe('DatasetTab — dataset list rendering', () => {
  it('shows dataset IDs when API returns datasets', async () => {
    stubMountFetch({
      datasets: [
        { id: 'user/dataset-alpha', total_episodes: 5, total_frames: 500, size_mb: 10 },
        { id: 'user/dataset-beta',  total_episodes: 3, total_frames: 300, size_mb: 6 },
      ],
    })
    await act(async () => {
      renderWithMantine(<DatasetTab active={true} />)
    })
    expect(screen.getByText('user/dataset-alpha')).toBeInTheDocument()
    expect(screen.getByText('user/dataset-beta')).toBeInTheDocument()
  })

  it('status verdict shows dataset count when datasets are loaded', async () => {
    stubMountFetch({
      datasets: [
        { id: 'user/ds1', total_episodes: 2, total_frames: 200, size_mb: 4 },
        { id: 'user/ds2', total_episodes: 1, total_frames: 100, size_mb: 2 },
      ],
    })
    await act(async () => {
      renderWithMantine(<DatasetTab active={true} />)
    })
    expect(screen.getByText('2 Datasets')).toBeInTheDocument()
  })
})
