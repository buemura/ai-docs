import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DocumentProvider, useDocument } from '../document/DocumentProvider'
import type { DiffSegment } from '../suggestions/types'
import { VersionHistory } from './VersionHistory'
import { VersionsProvider } from './VersionsProvider'

vi.mock('../suggestions/SplitDiffView', () => ({
  SplitDiffView: ({ segments }: { segments: DiffSegment[] }) => (
    <div data-testid="diff">{segments.map((segment) => segment.kind).join(',')}</div>
  ),
}))

function DocumentProbe() {
  const { content, setContent } = useDocument()
  return (
    <div>
      <output data-testid="content">{content}</output>
      <button type="button" onClick={() => setContent('# Edited\n')}>
        edit
      </button>
    </div>
  )
}

function renderHistory() {
  localStorage.setItem('ai-docs:document', JSON.stringify({ content: '# Hello\n', updatedAt: 1 }))
  return render(
    <DocumentProvider>
      <VersionsProvider>
        <DocumentProbe />
        <VersionHistory />
      </VersionsProvider>
    </DocumentProvider>,
  )
}

function timelineItems() {
  return within(screen.getByRole('list', { name: 'Versions' })).getAllByRole('listitem')
}

describe('VersionHistory', () => {
  it('shows the heading and the initial version selected', () => {
    renderHistory()
    expect(screen.getByRole('heading', { name: 'Version history' })).toBeInTheDocument()
    const items = timelineItems()
    expect(items).toHaveLength(1)
    expect(within(items[0]).getByRole('button')).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('heading', { name: 'Initial version' })).toBeInTheDocument()
  })

  it('enables Save snapshot only when the document changed, and records a snapshot', async () => {
    renderHistory()
    const save = screen.getByRole('button', { name: 'Save snapshot' })
    expect(save).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'edit' }))
    expect(save).toBeEnabled()
    await userEvent.click(save)
    const items = timelineItems()
    expect(items).toHaveLength(2)
    expect(within(items[0]).getByText('Snapshot')).toBeInTheDocument()
    expect(save).toBeDisabled()
  })

  it('restores an older version into the document', async () => {
    renderHistory()
    await userEvent.click(screen.getByRole('button', { name: 'edit' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save snapshot' }))
    await userEvent.click(within(timelineItems()[1]).getByRole('button'))
    expect(screen.getByRole('heading', { name: 'Initial version' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Restore this version' }))
    expect(screen.getByTestId('content').textContent).toBe('# Hello\n')
    const items = timelineItems()
    expect(items).toHaveLength(3)
    expect(within(items[0]).getByText('Restored "Initial version"')).toBeInTheDocument()
    expect(within(items[0]).getByRole('button')).toHaveAttribute('aria-current', 'true')
  })
})
