import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TourProvider, useTour } from './TourProvider'
import { ONBOARDING_STORAGE_KEY } from './tourStorage'
import { TOUR_VERSION, type TourStep } from './tourSteps'

const steps: TourStep[] = [
  { id: 'one', anchor: null, title: 'First', body: 'First body.' },
  { id: 'two', anchor: null, title: 'Second', body: 'Second body.' },
]

function Replay() {
  const { isActive, start } = useTour()
  return (
    <button type="button" onClick={start}>
      {isActive ? 'Touring' : 'Replay'}
    </button>
  )
}

function renderTour(onStart = vi.fn()) {
  render(
    <TourProvider steps={steps} onStart={onStart}>
      <Replay />
    </TourProvider>,
  )
  return { onStart }
}

const markSeen = (version = TOUR_VERSION) =>
  localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({ seenVersion: version }))

beforeEach(() => {
  localStorage.removeItem(ONBOARDING_STORAGE_KEY)
})

describe('TourProvider', () => {
  it('auto-starts on the first visit without calling onStart', () => {
    const { onStart } = renderTour()
    expect(screen.getByRole('dialog', { name: 'First' })).toBeInTheDocument()
    expect(onStart).not.toHaveBeenCalled()
  })

  it('makes the app inert while running', () => {
    renderTour()
    expect(screen.getByText('Touring').closest('[inert]')).not.toBeNull()
  })

  it('stays closed once the current version was seen', () => {
    markSeen()
    renderTour()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Replay' }).closest('[inert]')).toBeNull()
  })

  it('shows again after the tour version is bumped', () => {
    markSeen(TOUR_VERSION - 1)
    renderTour()
    expect(screen.getByRole('dialog', { name: 'First' })).toBeInTheDocument()
  })

  it('persists the seen version on skip and closes', async () => {
    const user = userEvent.setup()
    renderTour()
    await user.click(screen.getByRole('button', { name: 'Skip tour' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(ONBOARDING_STORAGE_KEY)!)).toEqual({
      seenVersion: TOUR_VERSION,
    })
  })

  it('walks to Done and persists', async () => {
    const user = userEvent.setup()
    renderTour()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByRole('dialog', { name: 'Second' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).not.toBeNull()
  })

  it('replays on start(), calls onStart, and restores focus when it ends', async () => {
    const user = userEvent.setup()
    markSeen()
    const { onStart } = renderTour()
    await user.click(screen.getByRole('button', { name: 'Replay' }))
    expect(onStart).toHaveBeenCalledOnce()
    expect(screen.getByRole('dialog', { name: 'First' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'Replay' })).toHaveFocus()
  })
})
