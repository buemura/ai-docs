import { describe, expect, it, vi } from 'vitest'
import { MODELS_RESPONSE, jsonResponse, sseFrame, sseResponse } from '../../test/sse'
import { fetchModels, streamSuggestion } from './api'
import type { StreamEvent, SuggestionRequestBody } from './schemas'

const body: SuggestionRequestBody = {
  model: 'claude-sonnet-5-5',
  document: 'Hello',
  selection: null,
  instruction: 'Improve',
  history: [],
}

async function collect(signal: AbortSignal = new AbortController().signal): Promise<StreamEvent[]> {
  const events: StreamEvent[] = []
  for await (const event of streamSuggestion(body, signal)) events.push(event)
  return events
}

function stubFetch(impl: () => Promise<Response>) {
  const fetchMock = vi.fn(impl)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('fetchModels', () => {
  it('returns the validated catalog', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(MODELS_RESPONSE))
    await expect(fetchModels()).resolves.toEqual(MODELS_RESPONSE)
    expect(fetchMock).toHaveBeenCalledWith('/api/models', expect.anything())
  })

  it('throws on HTTP errors', async () => {
    stubFetch(async () => jsonResponse({ detail: 'boom' }, 500))
    await expect(fetchModels()).rejects.toThrow('HTTP 500')
  })

  it('throws on an invalid payload', async () => {
    stubFetch(async () => jsonResponse({ models: 'nope' }))
    await expect(fetchModels()).rejects.toThrow()
  })
})

describe('streamSuggestion', () => {
  it('posts the body and yields deltas then done', async () => {
    const fetchMock = stubFetch(async () =>
      sseResponse([
        sseFrame('delta', { text: 'Hel' }),
        sseFrame('delta', { text: 'lo!' }),
        sseFrame('done', { stop_reason: 'end_turn' }),
      ]),
    )
    expect(await collect()).toEqual([
      { type: 'delta', text: 'Hel' },
      { type: 'delta', text: 'lo!' },
      { type: 'done', stopReason: 'end_turn' },
    ])
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/suggestions',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(body) }),
    )
  })

  it('stops after the terminal event', async () => {
    stubFetch(async () =>
      sseResponse([
        sseFrame('done', { stop_reason: 'end_turn' }),
        sseFrame('delta', { text: 'late' }),
      ]),
    )
    expect(await collect()).toEqual([{ type: 'done', stopReason: 'end_turn' }])
  })

  it('passes server error events through', async () => {
    stubFetch(async () =>
      sseResponse([
        sseFrame('delta', { text: 'partial' }),
        sseFrame('error', { code: 'rate_limited', message: 'Slow down' }),
      ]),
    )
    expect(await collect()).toEqual([
      { type: 'delta', text: 'partial' },
      { type: 'error', code: 'rate_limited', message: 'Slow down' },
    ])
  })

  it('maps non-2xx responses to http_<status> using the detail message', async () => {
    stubFetch(async () => jsonResponse({ detail: 'Unknown model: x' }, 422))
    expect(await collect()).toEqual([
      { type: 'error', code: 'http_422', message: 'Unknown model: x' },
    ])
  })

  it('falls back to a generic message when the error body has no string detail', async () => {
    stubFetch(async () => jsonResponse({ detail: [{ msg: 'bad' }] }, 422))
    expect(await collect()).toEqual([
      { type: 'error', code: 'http_422', message: 'The AI service returned HTTP 422.' },
    ])
  })

  it('reports network failures', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch')
    })
    const [event] = await collect()
    expect(event).toMatchObject({ type: 'error', code: 'network_error' })
  })

  it('yields nothing when aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    stubFetch(async () => {
      throw new DOMException('Aborted', 'AbortError')
    })
    expect(await collect(controller.signal)).toEqual([])
  })

  it('reports a stream that ends without a terminal event', async () => {
    stubFetch(async () => sseResponse([sseFrame('delta', { text: 'cut' })]))
    expect(await collect()).toEqual([
      { type: 'delta', text: 'cut' },
      { type: 'error', code: 'stream_incomplete', message: 'The AI response ended unexpectedly.' },
    ])
  })

  it('reports malformed event payloads and ignores unknown events', async () => {
    stubFetch(async () =>
      sseResponse(['event: ping\ndata: {}\n\n', 'event: delta\ndata: not json\n\n']),
    )
    const events = await collect()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'error', code: 'invalid_event' })
  })
})
