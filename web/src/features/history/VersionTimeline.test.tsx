import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Version } from './types'
import { VersionTimeline } from './VersionTimeline'

const NOW = Date.UTC(2026, 9, 22, 12, 0, 0)

const versions: Version[] = [
  {
    id: 'a',
    createdAt: NOW - 3 * 3_600_000,
    source: 'initial',
    label: 'Initial version',
    content: '',
  },
  {
    id: 'b',
    createdAt: NOW - 2 * 60_000,
    source: 'ai',
    label: 'Make it shorter',
    model: 'claude-sonnet-5-5',
    content: 'x',
  },
  { id: 'c', createdAt: NOW - 5_000, source: 'manual', label: 'Snapshot', content: 'y' },
]

function renderTimeline(overrides: Partial<Parameters<typeof VersionTimeline>[0]> = {}) {
  const onSelect = vi.fn()
  render(
    <VersionTimeline
      versions={versions}
      selectedId="b"
      onSelect={onSelect}
      getModelLabel={(id) => (id === 'claude-sonnet-5-5' ? 'Claude Sonnet 5.5' : id)}
      now={NOW}
      {...overrides}
    />,
  )
  return { onSelect }
}

describe('VersionTimeline', () => {
  it('lists versions newest first with badge, label and relative time', () => {
    renderTimeline()
    const list = screen.getByRole('list', { name: 'Versions' })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(within(items[0]).getByText('Snapshot')).toBeInTheDocument()
    expect(within(items[0]).getByText('Manual')).toBeInTheDocument()
    expect(within(items[0]).getByText('just now')).toBeInTheDocument()
    expect(within(items[1]).getByText('Make it shorter')).toBeInTheDocument()
    expect(within(items[1]).getByText('AI')).toBeInTheDocument()
    expect(within(items[1]).getByText('2 minutes ago')).toBeInTheDocument()
    expect(within(items[2]).getByText('Initial')).toBeInTheDocument()
    expect(within(items[2]).getByText('3 hours ago')).toBeInTheDocument()
  })

  it('shows the model label for AI versions only', () => {
    renderTimeline()
    const items = screen.getAllByRole('listitem')
    expect(within(items[1]).getByText('Claude Sonnet 5.5')).toBeInTheDocument()
    expect(within(items[0]).queryByText('Claude Sonnet 5.5')).not.toBeInTheDocument()
  })

  it('marks the selected version with aria-current', () => {
    renderTimeline()
    const items = screen.getAllByRole('listitem')
    expect(within(items[1]).getByRole('button')).toHaveAttribute('aria-current', 'true')
    expect(within(items[0]).getByRole('button')).not.toHaveAttribute('aria-current')
  })

  it('calls onSelect with the clicked version id', async () => {
    const { onSelect } = renderTimeline()
    const items = screen.getAllByRole('listitem')
    await userEvent.click(within(items[2]).getByRole('button'))
    expect(onSelect).toHaveBeenCalledWith('a')
  })
})
