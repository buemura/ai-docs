import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PresetChips } from './PresetChips'

describe('PresetChips', () => {
  it('renders quick actions that pick presets', async () => {
    const onPick = vi.fn()
    render(<PresetChips disabled={false} onPick={onPick} />)
    const group = screen.getByRole('group', { name: 'Quick AI actions' })
    expect(group).toBeInTheDocument()
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Improve writing',
      'Fix grammar & spelling',
      'Make more concise',
      'Professional tone',
    ])
    await userEvent.setup().click(screen.getByRole('button', { name: 'Fix grammar & spelling' }))
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'fix' }))
  })

  it('disables every chip when disabled', () => {
    render(<PresetChips disabled onPick={vi.fn()} />)
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled()
  })
})
