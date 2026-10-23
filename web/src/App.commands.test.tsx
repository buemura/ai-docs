import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from './App'
import { jsonResponse, mockApi } from './test/sse'

const searchInput = () => screen.findByPlaceholderText('Type a command or search…')

describe('App commands', () => {
  it('opens and closes the palette with Ctrl+K', async () => {
    mockApi()
    const user = userEvent.setup()
    render(<App />)
    await user.keyboard('{Control>}k{/Control}')
    expect(await searchInput()).toBeInTheDocument()
    await user.keyboard('{Control>}k{/Control}')
    await waitFor(() =>
      expect(screen.queryByPlaceholderText('Type a command or search…')).not.toBeInTheDocument(),
    )
  })

  it('opens the palette from the header button and switches tabs', async () => {
    mockApi()
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Open command palette' }))
    await searchInput()
    await user.click(screen.getByRole('option', { name: 'Go to Preview' }))
    expect(screen.getByRole('tab', { name: 'Preview' })).toHaveAttribute('aria-selected', 'true')
  })

  it('disables AI commands and quick actions when models are unavailable', async () => {
    mockApi({ models: () => jsonResponse({ detail: 'down' }, 503) })
    const user = userEvent.setup()
    render(<App />)
    expect(await screen.findByRole('option', { name: 'AI unavailable' })).toBeInTheDocument()
    for (const chip of screen.getAllByRole('button', { name: /improve writing|fix grammar/i })) {
      expect(chip).toBeDisabled()
    }
    await user.keyboard('{Control>}k{/Control}')
    await searchInput()
    expect(screen.getByRole('option', { name: /improve writing/i })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('"Ask AI…" switches to the editor and focuses the instruction input', async () => {
    mockApi()
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('tab', { name: 'Preview' }))

    await user.keyboard('{Control>}k{/Control}')
    await searchInput()
    const askItem = screen.getByRole('option', { name: /ask ai/i })
    await waitFor(() => expect(askItem).toHaveAttribute('aria-disabled', 'false'))
    await user.click(askItem)

    expect(screen.getByRole('tab', { name: 'Editor' })).toHaveAttribute('aria-selected', 'true')
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'AI instruction' })).toHaveFocus(),
    )
  })

  it('switches the model from the palette', async () => {
    mockApi()
    const user = userEvent.setup()
    render(<App />)
    await user.keyboard('{Control>}k{/Control}')
    await searchInput()
    await user.click(await screen.findByRole('option', { name: /use claude haiku 5\.5/i }))
    await user.keyboard('{Control>}k{/Control}')
    await searchInput()
    const haiku = await screen.findByRole('option', { name: /use claude haiku 5\.5/i })
    expect(haiku).toHaveTextContent('✓')
  })
})
