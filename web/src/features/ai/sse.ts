export type SseMessage = { event: string; data: string }

const LINE_BREAK = /\r\n|\r|\n/

/** Minimal Server-Sent Events parser over a fetch response body. */
export async function* parseSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<SseMessage> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let eventName = ''
  let dataLines: string[] = []

  const processLine = (line: string): SseMessage | null => {
    if (line === '') {
      const message =
        dataLines.length > 0 ? { event: eventName || 'message', data: dataLines.join('\n') } : null
      eventName = ''
      dataLines = []
      return message
    }
    if (line.startsWith(':')) return null
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') eventName = value
    else if (field === 'data') dataLines.push(value)
    return null
  }

  try {
    for (;;) {
      const { value, done } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      for (;;) {
        const match = LINE_BREAK.exec(buffer)
        if (!match) break
        // A trailing "\r" may be the first half of "\r\n": wait for the next chunk.
        if (!done && match[0] === '\r' && match.index === buffer.length - 1) break
        const line = buffer.slice(0, match.index)
        buffer = buffer.slice(match.index + match[0].length)
        const message = processLine(line)
        if (message) yield message
      }
      if (done) return
    }
  } finally {
    reader.releaseLock()
  }
}
