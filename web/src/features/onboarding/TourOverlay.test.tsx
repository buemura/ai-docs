import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TourOverlay } from './TourOverlay'
import type { TourStep } from './tourSteps'

const centered: TourStep = { id: 'a', anchor: null, title: 'Hello', body: 'Intro text.' }
const anchored: TourStep = { id: 'b', anchor: 'export', title: 'Export', body: 'Download it.' }

function renderOverlay(props: Partial<Parameters<typeof TourOverlay>[0]> = {}) {
  const handlers = { onNext: vi.fn(), onBack: vi.fn(), onEnd: vi.fn() }
  render(<TourOverlay step={centered} index={1} count={3} {...handlers} {...props} />)
  return handlers
}

describe('TourOverlay', () => {
  it('renders the step as a labelled modal dialog with a counter', () => {
    renderOverlay()
    const dialog = screen.getByRole('dialog', { name: 'Hello' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleDescription('Intro text.')
    expect(dialog).toHaveTextContent('Step 2 of 3')
  })

  it('focuses the primary button', () => {
    renderOverlay()
    expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus()
  })

  it('wires Next, Back and Skip', async () => {
    const user = userEvent.setup()
    const { onNext, onBack, onEnd } = renderOverlay()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(screen.getByRole('button', { name: 'Skip tour' }))
    expect(onNext).toHaveBeenCalledOnce()
    expect(onBack).toHaveBeenCalledOnce()
    expect(onEnd).toHaveBeenCalledOnce()
  })

  it('disables Back on the first step', () => {
    renderOverlay({ index: 0 })
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled()
  })

  it('shows Done instead of Next and Skip on the last step', async () => {
    const user = userEvent.setup()
    const { onNext, onEnd } = renderOverlay({ index: 2 })
    expect(screen.queryByRole('button', { name: 'Skip tour' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(onEnd).toHaveBeenCalledOnce()
    expect(onNext).not.toHaveBeenCalled()
  })

  it('supports Escape and arrow keys', async () => {
    const user = userEvent.setup()
    const { onNext, onBack, onEnd } = renderOverlay()
    await user.keyboard('{ArrowRight}{ArrowLeft}{Escape}')
    expect(onNext).toHaveBeenCalledOnce()
    expect(onBack).toHaveBeenCalledOnce()
    expect(onEnd).toHaveBeenCalledOnce()
  })

  it('ends on ArrowRight from the last step', async () => {
    const user = userEvent.setup()
    const { onNext, onEnd } = renderOverlay({ index: 2 })
    await user.keyboard('{ArrowRight}')
    expect(onEnd).toHaveBeenCalledOnce()
    expect(onNext).not.toHaveBeenCalled()
  })

  it('falls back to a centered card when the anchor is missing', () => {
    renderOverlay({ step: anchored })
    expect(screen.getByRole('dialog', { name: 'Export' })).toBeInTheDocument()
    expect(screen.queryByTestId('tour-spotlight')).not.toBeInTheDocument()
  })

  it('spotlights the anchor element', async () => {
    const target = document.createElement('button')
    target.dataset.tour = 'export'
    target.getBoundingClientRect = () => ({ top: 10, left: 900, width: 80, height: 30 }) as DOMRect
    document.body.append(target)
    try {
      renderOverlay({ step: anchored })
      const spotlight = await screen.findByTestId('tour-spotlight')
      await waitFor(() =>
        expect(spotlight).toHaveStyle({ top: '4px', left: '894px', width: '92px', height: '42px' }),
      )
    } finally {
      target.remove()
    }
  })
})
