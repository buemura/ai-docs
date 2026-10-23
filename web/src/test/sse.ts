import { vi } from 'vitest'
import type { ModelsResponse } from '../features/ai/schemas'

const encoder = new TextEncoder()

export function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export function streamOf(chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk)
      }
      controller.close()
    },
  })
}

export function sseResponse(frames: string[]): Response {
  return new Response(streamOf(frames), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** An SSE response that stays open until `close()`; errors when `signal` aborts. */
export function controllableSseResponse(signal?: AbortSignal | null) {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
  })
  signal?.addEventListener('abort', () =>
    controller?.error(new DOMException('Aborted', 'AbortError')),
  )
  return {
    response: new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }),
    push(frame: string) {
      controller?.enqueue(encoder.encode(frame))
    },
    close() {
      controller?.close()
    },
  }
}

export const MODELS_RESPONSE: ModelsResponse = {
  provider: 'anthropic',
  default_model: 'claude-sonnet-5-5',
  models: [
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
    { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
  ],
}

type Handler = (init: RequestInit | undefined) => Response | Promise<Response>

/** Stub global fetch: /models defaults to MODELS_RESPONSE, /suggestions uses the given handler. */
export function mockApi(handlers: { models?: Handler; suggestions?: Handler } = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/models')) {
      return handlers.models ? handlers.models(init) : jsonResponse(MODELS_RESPONSE)
    }
    if (url.endsWith('/suggestions') && handlers.suggestions) return handlers.suggestions(init)
    throw new TypeError(`Unexpected fetch: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** Parsed JSON bodies of every POST /suggestions call made through a mockApi fetch. */
export function suggestionBodies(fetchMock: ReturnType<typeof mockApi>): unknown[] {
  return fetchMock.mock.calls
    .filter(([input]) => String(input).endsWith('/suggestions'))
    .map(([, init]) => JSON.parse(String(init?.body)))
}
