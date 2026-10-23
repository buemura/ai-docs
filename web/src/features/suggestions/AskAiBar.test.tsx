import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SelectRange, renderWithAi } from '../../test/renderWithAi'
import {
  controllableSseResponse,
  jsonResponse,
  mockApi,
  sseFrame,
  sseResponse,
  suggestionBodies,
} from '../../test/sse'
import { AskAiBar } from './AskAiBar'

const done = () =>
  sseResponse([sseFrame('delta', { text: 'x' }), sseFrame('done', { stop_reason: 'end_turn' })])

describe('AskAiBar', () => {
  it('shows the scope and enables Suggest once a model and instruction exist', async () => {
    const user = userEvent.setup()
    mockApi({ suggestions: done })
    renderWithAi(
      <>
        <AskAiBar />
        <SelectRange from={0} to={5} />
      </>,
      { content: 'Hello world' },
    )
    expect(screen.getByText('Whole document')).toBeInTheDocument()
    const input = screen.getByRole('textbox', { name: 'AI instruction' })
    await waitFor(() => expect(input).toBeEnabled())
    expect(screen.getByRole('button', { name: 'Suggest' })).toBeDisabled()

    await user.type(input, 'Tighten')
    expect(screen.getByRole('button', { name: 'Suggest' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Select range' }))
    expect(screen.getByText('Selection')).toBeInTheDocument()
  })

  it('submits with the button, sends the instruction and clears the input', async () => {
    const user = userEvent.setup()
    const fetchMock = mockApi({ suggestions: done })
    const onStart = vi.fn()
    renderWithAi(<AskAiBar />, { content: 'Hello', onStart })
    const input = screen.getByRole('textbox', { name: 'AI instruction' })
    await waitFor(() => expect(input).toBeEnabled())

    await user.type(input, 'Make it formal')
    await user.click(screen.getByRole('button', { name: 'Suggest' }))
    expect(onStart).toHaveBeenCalledTimes(1)
    expect(input).toHaveValue('')
    await waitFor(() =>
      expect(suggestionBodies(fetchMock)[0]).toMatchObject({
        instruction: 'Make it formal',
        selection: null,
      }),
    )
  })

  it('submits with Mod-Enter', async () => {
    const user = userEvent.setup()
    const fetchMock = mockApi({ suggestions: done })
    renderWithAi(<AskAiBar />, { content: 'Hello' })
    const input = screen.getByRole('textbox', { name: 'AI instruction' })
    await waitFor(() => expect(input).toBeEnabled())
    await user.type(input, 'Fix typos{Control>}{Enter}{/Control}')
    await waitFor(() => expect(suggestionBodies(fetchMock)).toHaveLength(1))
  })

  it('is disabled while a suggestion is active', async () => {
    const user = userEvent.setup()
    mockApi({ suggestions: (init) => controllableSseResponse(init?.signal).response })
    renderWithAi(<AskAiBar />, { content: 'Hello' })
    const input = screen.getByRole('textbox', { name: 'AI instruction' })
    await waitFor(() => expect(input).toBeEnabled())
    await user.type(input, 'Go{Enter}')
    await waitFor(() => expect(input).toBeDisabled())
    expect(screen.getByRole('button', { name: 'Suggest' })).toBeDisabled()
  })

  it('is disabled when the AI is unavailable', async () => {
    mockApi({ models: () => jsonResponse({ detail: 'down' }, 503) })
    renderWithAi(<AskAiBar />, { content: 'Hello' })
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'AI instruction' })).toHaveAttribute(
        'placeholder',
        'AI unavailable',
      ),
    )
    expect(screen.getByRole('textbox', { name: 'AI instruction' })).toBeDisabled()
  })
})
