import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from './App'
import { DOCUMENT_STORAGE_KEY } from './features/document/schema'
import { mockApi, sseFrame, sseResponse } from './test/sse'

describe('App AI suggestions', () => {
  it('asks the AI, opens the review tab, and applies accepted changes', async () => {
    const user = userEvent.setup()
    localStorage.setItem(
      DOCUMENT_STORAGE_KEY,
      JSON.stringify({ content: '# Notes\n\nHello world\n', updatedAt: 0 }),
    )
    mockApi({
      suggestions: () =>
        sseResponse([
          sseFrame('delta', { text: '# Notes\n\nHello ' }),
          sseFrame('delta', { text: 'there\n' }),
          sseFrame('done', { stop_reason: 'end_turn' }),
        ]),
    })
    render(<App />)

    expect(await screen.findByRole('option', { name: 'Claude Sonnet 5.5' })).toBeInTheDocument()
    const input = screen.getByRole('textbox', { name: 'AI instruction' })
    await waitFor(() => expect(input).toBeEnabled())
    await user.type(input, 'Make it friendlier{Enter}')

    const reviewTab = screen.getByRole('tab', { name: /AI Review/ })
    await waitFor(() => expect(reviewTab).toHaveAttribute('aria-selected', 'true'))
    expect(await screen.findByRole('button', { name: 'Accept change 1' })).toBeInTheDocument()
    expect(reviewTab).toHaveTextContent('1')

    await user.click(screen.getByRole('button', { name: 'Accept all' }))
    expect(screen.getByText('No active suggestion.')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Preview' }))
    const preview = screen.getByRole('article', { name: 'Markdown preview' })
    expect(within(preview).getByText('Hello there')).toBeVisible()
  })
})
