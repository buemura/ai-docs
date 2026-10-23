import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { computeSegments, setHunkStatuses } from './diff'
import { SplitDiffView } from './SplitDiffView'

const lines = (count: number, transform: (n: number) => string = (n) => `line ${n}`) =>
  Array.from({ length: count }, (_, i) => `${transform(i + 1)}\n`).join('')

describe('SplitDiffView', () => {
  it('renders before/after columns, line numbers and change labels', () => {
    render(
      <SplitDiffView
        segments={computeSegments('a\nb\nc\n', 'a\nB\nc\n')}
        onSetHunkStatus={vi.fn()}
      />,
    )
    expect(screen.getByRole('columnheader', { name: 'Before' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'After' })).toBeInTheDocument()
    expect(screen.getByText('Change 1')).toBeInTheDocument()
    expect(screen.getAllByText('a')).toHaveLength(2)
    expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(2)
  })

  it('reports accept and reject decisions per hunk', async () => {
    const user = userEvent.setup()
    const onSetHunkStatus = vi.fn()
    render(
      <SplitDiffView
        segments={computeSegments('one\ntwo\nthree\n', 'ONE\ntwo\nTHREE\n')}
        onSetHunkStatus={onSetHunkStatus}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Accept change 1' }))
    await user.click(screen.getByRole('button', { name: 'Reject change 2' }))
    expect(onSetHunkStatus).toHaveBeenNthCalledWith(1, 'hunk-1', 'accepted')
    expect(onSetHunkStatus).toHaveBeenNthCalledWith(2, 'hunk-2', 'rejected')
  })

  it('shows the decided state', () => {
    const segments = setHunkStatuses(computeSegments('a\n', 'b\n'), ['hunk-1'], 'accepted')
    render(<SplitDiffView segments={segments} onSetHunkStatus={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Accept change 1' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Reject change 1' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.getByText('Accepted')).toBeInTheDocument()
  })

  it('hides actions in read-only mode', () => {
    render(<SplitDiffView segments={computeSegments('a\n', 'b\n')} readOnly />)
    expect(screen.getByText('Change 1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /change 1/i })).not.toBeInTheDocument()
  })

  it('collapses long unchanged regions and expands them on demand', async () => {
    const user = userEvent.setup()
    const before = lines(20)
    const after = lines(20, (n) => (n === 10 ? 'LINE 10' : `line ${n}`))
    render(<SplitDiffView segments={computeSegments(before, after)} readOnly />)

    expect(screen.queryAllByText('line 1')).toHaveLength(0)
    expect(screen.getAllByText('line 7')).toHaveLength(2)
    expect(screen.getAllByText('line 13')).toHaveLength(2)
    expect(screen.queryAllByText('line 14')).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Show 6 unchanged lines' }))
    expect(screen.getAllByText('line 1')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Show 7 unchanged lines' })).toBeInTheDocument()
  })

  it('highlights changed words inside paired lines', () => {
    const { container } = render(
      <SplitDiffView segments={computeSegments('the quick fox\n', 'the slow fox\n')} readOnly />,
    )
    expect(container.querySelector('del')?.textContent).toBe('quick')
    expect(container.querySelector('ins')?.textContent).toBe('slow')
  })
})
