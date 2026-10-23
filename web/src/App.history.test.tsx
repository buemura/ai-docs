import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from './App'
import { mockApi, sseFrame, sseResponse } from './test/sse'

describe('App version history', () => {
  it('shows the suggestion panel and version history in the AI Review tab', async () => {
    mockApi()
    localStorage.setItem('ai-docs:document', JSON.stringify({ content: '# Hello\n', updatedAt: 1 }))
    render(<App />)
    await userEvent.click(screen.getByRole('tab', { name: /AI Review/ }))
    expect(await screen.findByRole('heading', { name: 'Version history' })).toBeInTheDocument()
    expect(screen.getByText('No active suggestion.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Initial version' })).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('ai-docs:versions') ?? '[]')).toHaveLength(1)
  })

  it('labels AI versions with the model label from the catalog', async () => {
    mockApi()
    localStorage.setItem('ai-docs:document', JSON.stringify({ content: '# Hi\n', updatedAt: 2 }))
    localStorage.setItem(
      'ai-docs:versions',
      JSON.stringify([
        {
          id: 'a',
          createdAt: 1,
          source: 'initial',
          label: 'Initial version',
          content: '# Hello\n',
        },
        {
          id: 'b',
          createdAt: 2,
          source: 'ai',
          label: 'Shorter',
          model: 'claude-haiku-5-5',
          content: '# Hi\n',
        },
      ]),
    )
    render(<App />)
    await userEvent.click(screen.getByRole('tab', { name: /AI Review/ }))
    const timeline = await screen.findByRole('list', { name: 'Versions' })
    expect(within(timeline).getByText('Claude Haiku 5.5')).toBeInTheDocument()
  })

  it('records an AI version when a suggestion is accepted', async () => {
    const user = userEvent.setup()
    mockApi({
      suggestions: () =>
        sseResponse([
          sseFrame('delta', { text: '# Hello there\n' }),
          sseFrame('done', { stop_reason: 'end_turn' }),
        ]),
    })
    localStorage.setItem('ai-docs:document', JSON.stringify({ content: '# Hello\n', updatedAt: 1 }))
    render(<App />)
    const input = screen.getByRole('textbox', { name: 'AI instruction' })
    await waitFor(() => expect(input).toBeEnabled())
    await user.type(input, 'Make it friendlier{Enter}')
    await user.click(await screen.findByRole('button', { name: 'Accept all' }))

    const items = within(screen.getByRole('list', { name: 'Versions' })).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(within(items[0]).getByText('AI')).toBeInTheDocument()
    expect(within(items[0]).getByText('Make it friendlier')).toBeInTheDocument()
    expect(within(items[0]).getByText('Claude Sonnet 5.5')).toBeInTheDocument()
  })
})
