/**
 * DatasetCurationPanel — refactoring safety net
 *
 * Covers:
 *  - Render smoke test
 *  - keep/remove counts per selection mode (good_only, filter, exclude_bad)
 *  - Derive button enable/disable logic
 *  - Warning banners (no match, all match)
 *
 * Deliberately avoids API calls / timers; only tests props-driven UI logic.
 */
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DatasetCurationPanel } from '../DatasetCurationPanel'
import type { DatasetEpisode } from '../../../lib/types'

afterEach(cleanup)

// ─── helpers ────────────────────────────────────────────────────────────────

/** Make N minimal DatasetEpisode fixtures */
const eps = (n: number): DatasetEpisode[] =>
  Array.from({ length: n }, (_, i) => ({
    episode_index: i,
    length: 10,
    tasks: [],
    video_files: {},
  }))

/** First n episodes tagged 'good' */
const goodTags = (n: number): Record<string, string> =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i), 'good']))

/** First n episodes tagged 'bad' */
const badTags = (n: number): Record<string, string> =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i), 'bad']))

// ─── tests ──────────────────────────────────────────────────────────────────

describe('DatasetCurationPanel', () => {
  it('renders without crashing', async () => {
    let container!: HTMLElement
    await act(async () => {
      ;({ container } = render(
        <DatasetCurationPanel
          filteredEpisodes={eps(5)}
          allEpisodes={eps(10)}
          tags={goodTags(5)}
          totalEpisodes={10}
          datasetId="user/repo"
        />,
      ))
    })
    expect(container).toBeInTheDocument()
  })

  it('default mode (good_only) shows count of good-tagged episodes as keep', async () => {
    await act(async () => {
      render(
        <DatasetCurationPanel
          filteredEpisodes={eps(3)}
          allEpisodes={eps(10)}
          tags={goodTags(4)}
          totalEpisodes={10}
          datasetId="user/repo"
        />,
      )
    })
    // Keep row: 4 good → "4 episodes"; Remove row: 6 → "6 episodes"
    expect(screen.getByText('4 episodes')).toBeInTheDocument()
    expect(screen.getByText('6 episodes')).toBeInTheDocument()
  })

  it('switching to "Current filter" uses filteredEpisodes prop', async () => {
    await act(async () => {
      render(
        <DatasetCurationPanel
          filteredEpisodes={eps(3)}
          allEpisodes={eps(10)}
          tags={goodTags(4)}
          totalEpisodes={10}
          datasetId="user/repo"
        />,
      )
    })
    fireEvent.click(screen.getByRole('button', { name: 'Current filter' }))
    // filteredEpisodes has 3 → keep = 3, remove = 7
    expect(screen.getByText('3 episodes')).toBeInTheDocument()
    expect(screen.getByText('7 episodes')).toBeInTheDocument()
  })

  it('"Exclude bad" keeps all episodes except bad-tagged ones', async () => {
    await act(async () => {
      render(
        <DatasetCurationPanel
          filteredEpisodes={eps(10)}
          allEpisodes={eps(10)}
          tags={badTags(2)}
          totalEpisodes={10}
          datasetId="user/repo"
        />,
      )
    })
    fireEvent.click(screen.getByRole('button', { name: 'Exclude bad' }))
    // 2 bad → remove 2, keep 8
    expect(screen.getByText('8 episodes')).toBeInTheDocument()
    expect(screen.getByText('2 episodes')).toBeInTheDocument()
  })

  it('Derive button is disabled without a valid repo ID', async () => {
    await act(async () => {
      render(
        <DatasetCurationPanel
          filteredEpisodes={eps(5)}
          allEpisodes={eps(10)}
          tags={goodTags(5)}
          totalEpisodes={10}
          datasetId="user/repo"
        />,
      )
    })
    expect(screen.getByRole('button', { name: /Create Derived Dataset/ })).toBeDisabled()
  })

  it('Derive button enables with valid "user/repo" ID when keep < total', async () => {
    await act(async () => {
      render(
        <DatasetCurationPanel
          filteredEpisodes={eps(5)}
          allEpisodes={eps(10)}
          tags={goodTags(5)}
          totalEpisodes={10}
          datasetId="user/repo"
        />,
      )
    })
    fireEvent.change(
      screen.getByPlaceholderText('yourname/my-dataset-curated'),
      { target: { value: 'user/my-curated' } },
    )
    expect(screen.getByRole('button', { name: /Create Derived Dataset/ })).not.toBeDisabled()
  })

  it('Derive button stays disabled even with valid ID when keep === total', async () => {
    await act(async () => {
      render(
        <DatasetCurationPanel
          filteredEpisodes={eps(10)}
          allEpisodes={eps(10)}
          tags={goodTags(10)}  // all 10 good → keep = total
          totalEpisodes={10}
          datasetId="user/repo"
        />,
      )
    })
    fireEvent.change(
      screen.getByPlaceholderText('yourname/my-dataset-curated'),
      { target: { value: 'user/my-curated' } },
    )
    expect(screen.getByRole('button', { name: /Create Derived Dataset/ })).toBeDisabled()
  })

  it('shows "No episodes match" warning when keep count is 0', async () => {
    await act(async () => {
      render(
        <DatasetCurationPanel
          filteredEpisodes={[]}
          allEpisodes={eps(10)}
          tags={{}}                // no good tags → good_only keeps 0
          totalEpisodes={10}
          datasetId="user/repo"
        />,
      )
    })
    expect(screen.getByText(/No episodes match this selection/)).toBeInTheDocument()
  })

  it('shows "identical to the original" warning when all episodes are kept', async () => {
    await act(async () => {
      render(
        <DatasetCurationPanel
          filteredEpisodes={eps(10)}
          allEpisodes={eps(10)}
          tags={goodTags(10)}      // all good → keep = total = 10
          totalEpisodes={10}
          datasetId="user/repo"
        />,
      )
    })
    expect(screen.getByText(/identical to the original/i)).toBeInTheDocument()
  })

  it('shows CLI preview section', async () => {
    await act(async () => {
      render(
        <DatasetCurationPanel
          filteredEpisodes={eps(5)}
          allEpisodes={eps(10)}
          tags={goodTags(5)}
          totalEpisodes={10}
          datasetId="user/repo"
        />,
      )
    })
    expect(screen.getByText(/CLI Preview/i)).toBeInTheDocument()
  })
})
