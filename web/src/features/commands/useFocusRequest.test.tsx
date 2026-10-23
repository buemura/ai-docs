import { render, screen, waitFor } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useFocusRequest } from './useFocusRequest'

function Harness({ requested, onHandled }: { requested: boolean; onHandled?: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  useFocusRequest(ref, requested, onHandled)
  return <input ref={ref} aria-label="target" />
}

describe('useFocusRequest', () => {
  it('focuses the element and reports when handled', async () => {
    const onHandled = vi.fn()
    render(<Harness requested onHandled={onHandled} />)
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'target' })).toHaveFocus())
    expect(onHandled).toHaveBeenCalledTimes(1)
  })

  it('does nothing when not requested', async () => {
    const onHandled = vi.fn()
    render(<Harness requested={false} onHandled={onHandled} />)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(screen.getByRole('textbox', { name: 'target' })).not.toHaveFocus()
    expect(onHandled).not.toHaveBeenCalled()
  })
})
