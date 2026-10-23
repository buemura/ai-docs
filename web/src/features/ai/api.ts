import { env } from '../../env'
import {
  deltaPayloadSchema,
  donePayloadSchema,
  errorPayloadSchema,
  modelsResponseSchema,
  type ModelsResponse,
  type StreamEvent,
  type SuggestionRequestBody,
} from './schemas'
import { parseSse, type SseMessage } from './sse'

const NETWORK_ERROR: StreamEvent = {
  type: 'error',
  code: 'network_error',
  message: 'Could not reach the AI service. Check that the backend is running.',
}

const INVALID_EVENT: StreamEvent = {
  type: 'error',
  code: 'invalid_event',
  message: 'Received an unreadable response from the AI service.',
}

const STREAM_INCOMPLETE: StreamEvent = {
  type: 'error',
  code: 'stream_incomplete',
  message: 'The AI response ended unexpectedly.',
}

function apiUrl(path: string): string {
  return `${env.VITE_API_BASE_URL}${path}`
}

export async function fetchModels(signal?: AbortSignal): Promise<ModelsResponse> {
  const response = await fetch(apiUrl('/models'), { signal })
  if (!response.ok) throw new Error(`Failed to load models (HTTP ${response.status})`)
  return modelsResponseSchema.parse(await response.json())
}

export async function* streamSuggestion(
  body: SuggestionRequestBody,
  signal: AbortSignal,
): AsyncGenerator<StreamEvent> {
  let response: Response
  try {
    response = await fetch(apiUrl('/suggestions'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal,
    })
  } catch {
    if (!signal.aborted) yield NETWORK_ERROR
    return
  }

  if (!response.ok) {
    yield {
      type: 'error',
      code: `http_${response.status}`,
      message: await readErrorMessage(response),
    }
    return
  }
  if (!response.body) {
    yield STREAM_INCOMPLETE
    return
  }

  try {
    for await (const message of parseSse(response.body)) {
      const event = toStreamEvent(message)
      if (!event) continue
      yield event
      if (event.type !== 'delta') return
    }
  } catch {
    if (!signal.aborted) yield NETWORK_ERROR
    return
  }
  if (!signal.aborted) yield STREAM_INCOMPLETE
}

function toStreamEvent(message: SseMessage): StreamEvent | null {
  if (!['delta', 'done', 'error'].includes(message.event)) return null
  let payload: unknown
  try {
    payload = JSON.parse(message.data)
  } catch {
    return INVALID_EVENT
  }
  switch (message.event) {
    case 'delta': {
      const parsed = deltaPayloadSchema.safeParse(payload)
      return parsed.success ? { type: 'delta', text: parsed.data.text } : INVALID_EVENT
    }
    case 'done': {
      const parsed = donePayloadSchema.safeParse(payload)
      return parsed.success ? { type: 'done', stopReason: parsed.data.stop_reason } : INVALID_EVENT
    }
    default: {
      const parsed = errorPayloadSchema.safeParse(payload)
      return parsed.success
        ? { type: 'error', code: parsed.data.code, message: parsed.data.message }
        : INVALID_EVENT
    }
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const data: unknown = await response.json()
    if (data && typeof data === 'object' && 'detail' in data && typeof data.detail === 'string') {
      return data.detail
    }
  } catch {
    // Body is not JSON; fall through to the generic message.
  }
  return `The AI service returned HTTP ${response.status}.`
}
