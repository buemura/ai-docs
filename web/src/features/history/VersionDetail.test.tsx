import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { DiffSegment } from '../suggestions/types'
import type { Version } from './types'
import { VersionDetail } from './VersionDetail'

vi.mock('../suggestions/SplitDiffView', () => ({
  SplitDiffView: ({ segments, readOnly }: { segments: DiffSegment[]; readOnly?: boolean }) => (
    <div data-testid="diff" data-readonly={String(readOnly)}>
      {segments.map((segment) => segment.kind).join(',')}
    </div>
  ),
}))

function version(id: string, content: string, label = id): Version {
  return { id, createdAt: 0, source: 'manual', label, content }
}

describe('VersionDetail', () => {
  it('renders a read-only diff from the previous version', () => {
    render(
      <VersionDetail
        version={version('b', '# Title\n\nNew line\n', 'Make it shorter')}
        previous={version('a', '# Title\n\nOld line\n')}
        isLatest
        onRestore={vi.fn()}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Make it shorter' })).toBeInTheDocument()
    expect(screen.getByText('Compared with the previous version')).toBeInTheDocument()
    const diff = screen.getByTestId('diff')
    expect(diff).toHaveAttribute('data-readonly', 'true')
    expect(diff.textContent).toContain('change')
  })

  it('diffs the first version against an empty document', () => {
    render(
      <VersionDetail
        version={version('a', '# Hello\n')}
        previous={null}
        isLatest
        onRestore={vi.fn()}
      />,
    )
    expect(screen.getByText('Compared with an empty document')).toBeInTheDocument()
    expect(screen.getByTestId('diff').textContent).toContain('change')
  })

  it('says "No changes" when the content is identical', () => {
    render(
      <VersionDetail
        version={version('b', 'same\n')}
        previous={version('a', 'same\n')}
        isLatest
        onRestore={vi.fn()}
      />,
    )
    expect(screen.getByText('No changes')).toBeInTheDocument()
    expect(screen.queryByTestId('diff')).not.toBeInTheDocument()
  })

  it('disables restore for the latest version', () => {
    render(
      <VersionDetail version={version('a', 'x')} previous={null} isLatest onRestore={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: 'Restore this version' })).toBeDisabled()
  })

  it('calls onRestore for an older version', async () => {
    const onRestore = vi.fn()
    render(
      <VersionDetail
        version={version('a', 'x')}
        previous={null}
        isLatest={false}
        onRestore={onRestore}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Restore this version' }))
    expect(onRestore).toHaveBeenCalledOnce()
  })
})
