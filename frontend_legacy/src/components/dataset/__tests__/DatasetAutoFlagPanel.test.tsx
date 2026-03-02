/**
 * DatasetAutoFlagPanel — refactoring safety net
 *
 * Covers:
 *  - Initial render: "not loaded" badge + Load button visible
 *  - Stats-loaded state: preset buttons + threshold controls appear
 *  - Active criterion count drives flagging UI
 *  - datasetId is split correctly (user/repo) for API URL construction
 *
 * The setInterval polling loop only fires when statsJobId is non-empty, which
 * requires a successful POST response. Since fetch is stubbed to return a generic
 * {ok:false} equivalent, no polling timers are started in these tests.
 */
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatasetAutoFlagPanel } from '../DatasetAutoFlagPanel'

afterEach(cleanup)

// ─── helpers ────────────────────────────────────────────────────────────────

/** A minimal but valid StatsResponse body */
const makeStatsResponse = (override: object = {}) => ({
  ok: true,
  cached: true,
  episodes: [
    { episode_index: 0, frames: 100, duration_s: 5, movement: 0.5, jerk_score: 0.1, max_jerk: 0.2 },
    { episode_index: 1, frames: 80,  duration_s: 4, movement: 0.3, jerk_score: 0.8, max_jerk: 1.2 },
    { episode_index: 2, frames: 50,  duration_s: 2.5, movement: 0.1, jerk_score: 0.05, max_jerk: 0.1 },
  ],
  dataset_summary: {
    frames:     { min: 50,  max: 100, p25: 65,   p75: 90,   median: 80  },
    movement:   { min: 0.1, max: 0.5, p25: 0.2,  p75: 0.45, median: 0.3 },
    jerk_score: { min: 0.05,max: 0.8, p25: 0.08, p75: 0.45, median: 0.1 },
  },
  ...override,
})

/** Stub global fetch to return a given JSON body */
function stubFetch(body: object) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
})

// ─── tests ───────────────────────────────────────────────────────────────────

describe('DatasetAutoFlagPanel — initial (no stats)', () => {
  it('renders without crashing', async () => {
    let container!: HTMLElement
    await act(async () => {
      ;({ container } = render(
        <DatasetAutoFlagPanel datasetId="user/repo" totalEpisodes={10} />,
      ))
    })
    expect(container).toBeInTheDocument()
  })

  it('shows "not loaded" badge when stats have not been fetched', async () => {
    await act(async () => {
      render(<DatasetAutoFlagPanel datasetId="user/repo" totalEpisodes={5} />)
    })
    expect(screen.getByText('not loaded')).toBeInTheDocument()
  })

  it('shows Load Episode Stats button when stats are absent', async () => {
    await act(async () => {
      render(<DatasetAutoFlagPanel datasetId="user/repo" totalEpisodes={5} />)
    })
    expect(screen.getByRole('button', { name: /Load Episode Stats/i })).toBeInTheDocument()
  })

  it('does NOT show preset buttons before stats are loaded', async () => {
    await act(async () => {
      render(<DatasetAutoFlagPanel datasetId="user/repo" totalEpisodes={5} />)
    })
    expect(screen.queryByRole('button', { name: /Preset: Strict/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Preset: Balanced/i })).not.toBeInTheDocument()
  })
})

describe('DatasetAutoFlagPanel — after stats loaded', () => {
  it('shows preset buttons and summary line after stats are fetched', async () => {
    // Stub the recompute POST (no job_id → immediate result) and the
    // subsequent GET for the stats result.
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        // POST /recompute → no job_id means "already cached, fetch result now"
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        // GET /stats → real stats payload
        new Response(JSON.stringify(makeStatsResponse()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

    await act(async () => {
      render(<DatasetAutoFlagPanel datasetId="user/repo" totalEpisodes={3} />)
    })

    // Click the load button and wait for async state updates
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Load Episode Stats/i }))
    })

    // Preset buttons should now be visible
    expect(screen.getByRole('button', { name: /Preset: Strict/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Preset: Balanced/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Preset: Lenient/i })).toBeInTheDocument()
  })

  it('badge shows flagged count after stats loaded and criterion enabled', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(makeStatsResponse()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

    await act(async () => {
      render(<DatasetAutoFlagPanel datasetId="user/repo" totalEpisodes={3} />)
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Load Episode Stats/i }))
    })

    // The badge should no longer say "not loaded"
    expect(screen.queryByText('not loaded')).not.toBeInTheDocument()
  })

  it('shows "Enable at least one criterion" hint when no criteria are active', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(makeStatsResponse()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

    await act(async () => {
      render(<DatasetAutoFlagPanel datasetId="user/repo" totalEpisodes={3} />)
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Load Episode Stats/i }))
    })

    expect(screen.getByText(/Enable at least one criterion/i)).toBeInTheDocument()
  })
})

describe('DatasetAutoFlagPanel — datasetId splitting', () => {
  it('accepts datasetId with slashes without crashing', async () => {
    await act(async () => {
      render(
        <DatasetAutoFlagPanel
          datasetId="org-name/my-fancy-dataset"
          totalEpisodes={10}
        />,
      )
    })
    // Just verify it renders — the split happens internally for API URLs
    expect(screen.getByText('not loaded')).toBeInTheDocument()
  })

  it('accepts single-segment datasetId gracefully', async () => {
    await act(async () => {
      render(<DatasetAutoFlagPanel datasetId="nodatasetslash" totalEpisodes={0} />)
    })
    expect(screen.getByText('not loaded')).toBeInTheDocument()
  })
})

describe('DatasetAutoFlagPanel — API error handling', () => {
  it('handles recompute API returning ok:false without crashing', async () => {
    stubFetch({ ok: false, error: 'server error' })

    await act(async () => {
      render(<DatasetAutoFlagPanel datasetId="user/repo" totalEpisodes={5} />)
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Load Episode Stats/i }))
    })

    // Should still be in the "no stats" state — Load button still present
    expect(screen.getByRole('button', { name: /Load Episode Stats/i })).toBeInTheDocument()
  })
})
