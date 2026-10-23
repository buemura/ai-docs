import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { useDocument } from '../document/DocumentProvider'
import { DocumentContent, StartSuggestion, renderWithAi } from '../../test/renderWithAi'
import {
  controllableSseResponse,
  mockApi,
  sseFrame,
  sseResponse,
  suggestionBodies,
} from '../../test/sse'
import { SuggestionPanel } from './SuggestionPanel'

const proposal = (text: string) =>
  sseResponse([sseFrame('delta', { text }), sseFrame('done', { stop_reason: 'end_turn' })])

function Overwrite() {
  const { setContent } = useDocument()
  return (
    <button type="button" onClick={() => setContent('something else\n')}>
      Overwrite document
    </button>
  )
}

function renderPanel(content: string, onResolved = vi.fn()) {
  renderWithAi(
    <>
      <StartSuggestion instruction="Shout" />
      <Overwrite />
      <SuggestionPanel />
      <DocumentContent />
    </>,
    { content, onResolved },
  )
  return onResolved
}

async function startSuggestion(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Start suggestion' })).toBeEnabled(),
  )
  // The model catalog loads asynchronously; retry the click until a suggestion appears.
  await waitFor(async () => {
    await user.click(screen.getByRole('button', { name: 'Start suggestion' }))
    expect(screen.queryByText('No active suggestion.')).not.toBeInTheDocument()
  })
}

describe('SuggestionPanel', () => {
  it('shows an empty state', () => {
    mockApi()
    renderPanel('Hello\n')
    expect(screen.getByText('No active suggestion.')).toBeInTheDocument()
  })

  it('streams text and can be stopped, then retried or discarded', async () => {
    const user = userEvent.setup()
    let stream: ReturnType<typeof controllableSseResponse> | undefined
    mockApi({
      suggestions: (init) => {
        stream = controllableSseResponse(init?.signal)
        return stream.response
      },
    })
    renderPanel('Hello\n')
    await startSuggestion(user)
    expect(screen.getByText('AI is writing…')).toBeInTheDocument()
    stream?.push(sseFrame('delta', { text: 'HEL' }))
    expect(await screen.findByText('HEL')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Stopped.')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(screen.getByText('No active suggestion.')).toBeInTheDocument()
  })

  it('shows server errors with Retry', async () => {
    const user = userEvent.setup()
    const responses = [
      sseResponse([sseFrame('error', { code: 'rate_limited', message: 'Slow down' })]),
      proposal('HELLO\n'),
    ]
    mockApi({ suggestions: () => responses.shift() ?? proposal('unexpected') })
    renderPanel('Hello\n')
    await startSuggestion(user)
    expect(await screen.findByRole('alert')).toHaveTextContent('Slow down')
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('button', { name: 'Accept change 1' })).toBeInTheDocument()
  })

  it('reviews hunks and accepts all', async () => {
    const user = userEvent.setup()
    mockApi({ suggestions: () => proposal('ONE\ntwo\nTHREE\n') })
    const onResolved = renderPanel('one\ntwo\nthree\n')
    await startSuggestion(user)
    expect(await screen.findByText('2 of 2 changes pending')).toBeInTheDocument()
    expect(screen.getByText(/Whole document · Claude Sonnet 5\.5/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Accept change 1' }))
    expect(screen.getByText('1 of 2 changes pending')).toBeInTheDocument()
    expect(screen.getByTestId('document-content').textContent).toBe('ONE\ntwo\nthree\n')

    await user.click(screen.getByRole('button', { name: 'Accept all' }))
    expect(screen.getByTestId('document-content').textContent).toBe('ONE\ntwo\nTHREE\n')
    expect(screen.getByText('No active suggestion.')).toBeInTheDocument()
    expect(onResolved).toHaveBeenCalledTimes(1)
  })

  it('says when there is nothing to change', async () => {
    const user = userEvent.setup()
    mockApi({ suggestions: () => proposal('Hello\n') })
    renderPanel('Hello\n')
    await startSuggestion(user)
    expect(await screen.findByRole('status')).toHaveTextContent('No changes suggested.')
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.getByText('No active suggestion.')).toBeInTheDocument()
  })

  it('warns when the suggestion is stale', async () => {
    const user = userEvent.setup()
    mockApi({ suggestions: () => proposal('HELLO\n') })
    renderPanel('Hello\n')
    await startSuggestion(user)
    await screen.findByRole('button', { name: 'Accept change 1' })
    await user.click(screen.getByRole('button', { name: 'Overwrite document' }))
    await user.click(screen.getByRole('button', { name: 'Accept change 1' }))
    expect(screen.getByRole('alert')).toHaveTextContent('The document changed')
    expect(screen.queryByRole('button', { name: 'Accept change 1' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Accept all' })).toBeDisabled()
  })

  it('refines, and blocks refining after an accept', async () => {
    const user = userEvent.setup()
    const responses = [proposal('A\nb\nC\n'), proposal('AA\nb\nCC\n')]
    const fetchMock = mockApi({ suggestions: () => responses.shift() ?? proposal('unexpected') })
    renderPanel('a\nb\nc\n')
    await startSuggestion(user)
    await screen.findByRole('button', { name: 'Accept change 1' })

    await user.type(screen.getByRole('textbox', { name: 'Refine instruction' }), 'Double it')
    await user.click(screen.getByRole('button', { name: 'Refine' }))
    await waitFor(() => expect(suggestionBodies(fetchMock)).toHaveLength(2))
    expect(suggestionBodies(fetchMock)[1]).toMatchObject({
      instruction: 'Double it',
      history: [{ instruction: 'Shout', proposal: 'A\nb\nC\n' }],
    })

    await user.click(await screen.findByRole('button', { name: 'Accept change 1' }))
    expect(screen.getByRole('textbox', { name: 'Refine instruction' })).toBeDisabled()
    expect(screen.getByText('Refine is unavailable after accepting a change.')).toBeInTheDocument()
  })
})
