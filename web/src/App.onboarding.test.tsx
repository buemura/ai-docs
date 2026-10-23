import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from './App'
import { ONBOARDING_STORAGE_KEY } from './features/onboarding/tourStorage'
import { anchorSelector, TOUR_STEPS } from './features/onboarding/tourSteps'

beforeEach(() => {
  localStorage.removeItem(ONBOARDING_STORAGE_KEY)
})

describe('App onboarding tour', () => {
  it('greets first-time visitors and does not return after Done', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<App />)
    expect(screen.getByRole('dialog', { name: 'Welcome to AI Docs' })).toBeInTheDocument()

    for (let i = 1; i < TOUR_STEPS.length; i++) {
      await user.click(screen.getByRole('button', { name: 'Next' }))
      expect(screen.getByRole('dialog', { name: TOUR_STEPS[i].title })).toBeInTheDocument()
    }
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    unmount()
    render(<App />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('has every step anchor in the rendered app', () => {
    render(<App />)
    for (const step of TOUR_STEPS) {
      if (step.anchor) expect(document.querySelector(anchorSelector(step.anchor))).not.toBeNull()
    }
  })

  it('replays from the header and switches to the Editor tab', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('tab', { name: 'Preview' }))
    await user.click(screen.getByRole('button', { name: 'Take the tour' }))
    expect(screen.getByRole('dialog', { name: 'Welcome to AI Docs' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Editor' })).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'Take the tour' })).toHaveFocus()
  })

  it('ignores the command palette shortcut while touring', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.keyboard('{Control>}k{/Control}')
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Welcome to AI Docs' })).toBeInTheDocument()
  })
})
