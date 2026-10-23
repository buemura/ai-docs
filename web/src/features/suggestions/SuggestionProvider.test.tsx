import { act, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useModels } from '../ai/ModelProvider'
import { useDocument } from '../document/DocumentProvider'
import { renderWithAi } from '../../test/renderWithAi'
import {
  controllableSseResponse,
  mockApi,
  sseFrame,
  sseResponse,
  suggestionBodies,
} from '../../test/sse'
import { useSuggestion } from './SuggestionProvider'
import type { ResolvedSuggestion } from './types'

type Api = {
  suggestion: ReturnType<typeof useSuggestion>
  document: ReturnType<typeof useDocument>
  models: ReturnType<typeof useModels>
}

function Probe({ onRender }: { onRender(api: Api): void }) {
  const api: Api = { suggestion: useSuggestion(), document: useDocument(), models: useModels() }
  useEffect(() => {
    onRender(api)
  })
  return null
}

function proposal(text: string): Response {
  return sseResponse([sseFrame('delta', { text }), sseFrame('done', { stop_reason: 'end_turn' })])
}

async function setup(
  content: string,
  options: { onResolved?: (r: ResolvedSuggestion) => void; onStart?: () => void } = {},
) {
  const latest: { current: Api | null } = { current: null }
  renderWithAi(<Probe onRender={(api) => (latest.current = api)} />, { content, ...options })
  const get = (): Api => {
    if (!latest.current) throw new Error('Probe has not rendered')
    return latest.current
  }
  await waitFor(() => expect(get().models.selectedModel).toBe('claude-sonnet-5-5'))
  return get
}

async function waitForStatus(get: () => Api, status: string) {
  await waitFor(() => expect(get().suggestion.suggestion?.status).toBe(status))
}

describe('SuggestionProvider — streaming', () => {
  it('streams a whole-document suggestion into review', async () => {
    const fetchMock = mockApi({ suggestions: () => proposal('Hello there\n') })
    const onStart = vi.fn()
    const get = await setup('Hello world\n', { onStart })

    act(() => get().suggestion.start({ instruction: '  Rephrase  ', target: 'auto' }))
    expect(onStart).toHaveBeenCalledTimes(1)
    expect(get().suggestion.isBusy).toBe(true)
    await waitForStatus(get, 'reviewing')

    expect(get().suggestion.suggestion).toMatchObject({
      scope: { kind: 'document' },
      baseText: 'Hello world\n',
      instruction: 'Rephrase',
      proposedText: 'Hello there\n',
    })
    expect(suggestionBodies(fetchMock)).toEqual([
      {
        model: 'claude-sonnet-5-5',
        document: 'Hello world\n',
        selection: null,
        instruction: 'Rephrase',
        history: [],
      },
    ])
  })

  it('targets the current selection', async () => {
    const fetchMock = mockApi({ suggestions: () => proposal('BBB') })
    const get = await setup('aaa bbb ccc')
    act(() => get().document.setSelection({ from: 4, to: 7 }))
    act(() => get().suggestion.start({ instruction: 'Shout', target: 'auto' }))
    await waitForStatus(get, 'reviewing')

    expect(get().suggestion.suggestion).toMatchObject({
      scope: { kind: 'selection', range: { from: 4, to: 7 } },
      baseText: 'bbb',
    })
    expect(suggestionBodies(fetchMock)[0]).toMatchObject({ selection: { start: 4, end: 7 } })
  })

  it('ignores blank instructions and starts while busy', async () => {
    const fetchMock = mockApi({ suggestions: () => proposal('x') })
    const get = await setup('text')
    act(() => get().suggestion.start({ instruction: '   ', target: 'auto' }))
    expect(get().suggestion.suggestion).toBeNull()

    act(() => get().suggestion.start({ instruction: 'One', target: 'auto' }))
    act(() => get().suggestion.start({ instruction: 'Two', target: 'auto' }))
    await waitForStatus(get, 'reviewing')
    expect(suggestionBodies(fetchMock)).toHaveLength(1)
  })

  it('stops a running stream', async () => {
    let stream: ReturnType<typeof controllableSseResponse> | undefined
    let signal: AbortSignal | null | undefined
    mockApi({
      suggestions: (init) => {
        signal = init?.signal
        stream = controllableSseResponse(signal)
        return stream.response
      },
    })
    const get = await setup('text')
    act(() => get().suggestion.start({ instruction: 'Go', target: 'auto' }))
    await waitFor(() => expect(stream).toBeDefined())
    act(() => stream?.push(sseFrame('delta', { text: 'par' })))
    await waitFor(() => expect(get().suggestion.suggestion?.proposedText).toBe('par'))

    act(() => get().suggestion.stop())
    expect(get().suggestion.suggestion).toMatchObject({
      status: 'error',
      error: { code: 'aborted', message: 'Stopped.' },
    })
    expect(signal?.aborted).toBe(true)
  })

  it('retries after an error', async () => {
    const responses = [
      sseResponse([sseFrame('error', { code: 'rate_limited', message: 'Slow down' })]),
      proposal('Better\n'),
    ]
    const fetchMock = mockApi({ suggestions: () => responses.shift() ?? proposal('unexpected') })
    const get = await setup('Good\n')
    act(() => get().suggestion.start({ instruction: 'Improve', target: 'auto' }))
    await waitForStatus(get, 'error')
    expect(get().suggestion.suggestion?.error).toEqual({
      code: 'rate_limited',
      message: 'Slow down',
    })

    act(() => get().suggestion.retry())
    await waitForStatus(get, 'reviewing')
    expect(get().suggestion.suggestion?.proposedText).toBe('Better\n')
    expect(suggestionBodies(fetchMock)).toHaveLength(2)
  })
})

describe('SuggestionProvider — review', () => {
  it('applies accepted hunks to the document and resolves when nothing is pending', async () => {
    mockApi({ suggestions: () => proposal('ONE\ntwo\nTHREE\n') })
    const onResolved = vi.fn()
    const get = await setup('one\ntwo\nthree\n', { onResolved })
    act(() => get().suggestion.start({ instruction: 'Shout', target: 'auto' }))
    await waitForStatus(get, 'reviewing')

    act(() => get().suggestion.setHunkStatus('hunk-1', 'accepted'))
    expect(get().document.content).toBe('ONE\ntwo\nthree\n')
    expect(get().suggestion.suggestion?.contentBeforeFirstAccept).toBe('one\ntwo\nthree\n')
    expect(onResolved).not.toHaveBeenCalled()

    act(() => get().suggestion.setHunkStatus('hunk-2', 'rejected'))
    expect(get().document.content).toBe('ONE\ntwo\nthree\n')
    expect(get().suggestion.suggestion).toBeNull()
    expect(onResolved).toHaveBeenCalledWith({
      instruction: 'Shout',
      history: [],
      model: 'claude-sonnet-5-5',
      contentBefore: 'one\ntwo\nthree\n',
      contentAfter: 'ONE\ntwo\nthree\n',
      acceptedCount: 1,
      totalCount: 2,
    })
  })

  it('flips an accepted hunk back to rejected', async () => {
    mockApi({ suggestions: () => proposal('A\nb\nC\n') })
    const get = await setup('a\nb\nc\n')
    act(() => get().suggestion.start({ instruction: 'Caps', target: 'auto' }))
    await waitForStatus(get, 'reviewing')
    act(() => get().suggestion.setHunkStatus('hunk-1', 'accepted'))
    expect(get().document.content).toBe('A\nb\nc\n')
    act(() => get().suggestion.setHunkStatus('hunk-1', 'rejected'))
    expect(get().document.content).toBe('a\nb\nc\n')
  })

  it('accepts all hunks inside a selection without touching surrounding text', async () => {
    mockApi({ suggestions: () => proposal('fixed\n') })
    const onResolved = vi.fn()
    const get = await setup('keep\nfix me\nkeep\n', { onResolved })
    act(() => get().document.setSelection({ from: 5, to: 12 }))
    act(() => get().suggestion.start({ instruction: 'Fix', target: 'auto' }))
    await waitForStatus(get, 'reviewing')

    act(() => get().suggestion.acceptAll())
    expect(get().document.content).toBe('keep\nfixed\nkeep\n')
    expect(get().suggestion.suggestion).toBeNull()
    expect(onResolved).toHaveBeenCalledWith(
      expect.objectContaining({
        contentBefore: 'keep\nfix me\nkeep\n',
        contentAfter: 'keep\nfixed\nkeep\n',
        acceptedCount: 1,
        totalCount: 1,
      }),
    )
  })

  it('rejects all without changing the document or calling onResolved', async () => {
    mockApi({ suggestions: () => proposal('Other\n') })
    const onResolved = vi.fn()
    const get = await setup('Mine\n', { onResolved })
    act(() => get().suggestion.start({ instruction: 'Change', target: 'auto' }))
    await waitForStatus(get, 'reviewing')
    act(() => get().suggestion.rejectAll())
    expect(get().document.content).toBe('Mine\n')
    expect(get().suggestion.suggestion).toBeNull()
    expect(onResolved).not.toHaveBeenCalled()
  })

  it('marks the suggestion stale when its region was edited away', async () => {
    mockApi({ suggestions: () => proposal('ONE\ntwo\n') })
    const get = await setup('one\ntwo\n')
    act(() => get().suggestion.start({ instruction: 'Shout', target: 'auto' }))
    await waitForStatus(get, 'reviewing')
    act(() => get().document.setContent('changed entirely\n'))
    act(() => get().suggestion.setHunkStatus('hunk-1', 'accepted'))
    expect(get().suggestion.suggestion?.stale).toBe(true)
    expect(get().document.content).toBe('changed entirely\n')
  })

  it('discard after an accept reports the accepted work', async () => {
    mockApi({ suggestions: () => proposal('A\nb\nC\n') })
    const onResolved = vi.fn()
    const get = await setup('a\nb\nc\n', { onResolved })
    act(() => get().suggestion.start({ instruction: 'Caps', target: 'auto' }))
    await waitForStatus(get, 'reviewing')
    act(() => get().suggestion.setHunkStatus('hunk-1', 'accepted'))
    act(() => get().suggestion.discard())
    expect(get().suggestion.suggestion).toBeNull()
    expect(get().document.content).toBe('A\nb\nc\n')
    expect(onResolved).toHaveBeenCalledWith(
      expect.objectContaining({
        contentBefore: 'a\nb\nc\n',
        contentAfter: 'A\nb\nc\n',
        acceptedCount: 1,
        totalCount: 2,
      }),
    )
  })

  it('refines with history', async () => {
    const responses = [proposal('Draft one\n'), proposal('Draft two\n')]
    const fetchMock = mockApi({ suggestions: () => responses.shift() ?? proposal('unexpected') })
    const onStart = vi.fn()
    const get = await setup('Original\n', { onStart })
    act(() => get().suggestion.start({ instruction: 'Rewrite', target: 'auto' }))
    await waitForStatus(get, 'reviewing')

    act(() => get().suggestion.refine('Shorter'))
    await waitFor(() => expect(get().suggestion.suggestion?.proposedText).toBe('Draft two\n'))
    expect(get().suggestion.suggestion?.status).toBe('reviewing')
    expect(onStart).toHaveBeenCalledTimes(2)
    expect(suggestionBodies(fetchMock)[1]).toEqual({
      model: 'claude-sonnet-5-5',
      document: 'Original\n',
      selection: null,
      instruction: 'Shorter',
      history: [{ instruction: 'Rewrite', proposal: 'Draft one\n' }],
    })
  })

  it('does not refine after a hunk was accepted', async () => {
    const fetchMock = mockApi({ suggestions: () => proposal('A\nb\nC\n') })
    const get = await setup('a\nb\nc\n')
    act(() => get().suggestion.start({ instruction: 'Caps', target: 'auto' }))
    await waitForStatus(get, 'reviewing')
    act(() => get().suggestion.setHunkStatus('hunk-1', 'accepted'))
    act(() => get().suggestion.refine('Again'))
    expect(suggestionBodies(fetchMock)).toHaveLength(1)
    expect(get().suggestion.suggestion?.status).toBe('reviewing')
  })
})
