import { describe, expect, it } from 'vitest'
import { streamOf } from '../../test/sse'
import { parseSse, type SseMessage } from './sse'

async function collect(chunks: (string | Uint8Array)[]): Promise<SseMessage[]> {
  const messages: SseMessage[] = []
  for await (const message of parseSse(streamOf(chunks))) messages.push(message)
  return messages
}

describe('parseSse', () => {
  it('parses complete frames', async () => {
    expect(
      await collect(['event: delta\ndata: {"text":"hi"}\n\nevent: done\ndata: {}\n\n']),
    ).toEqual([
      { event: 'delta', data: '{"text":"hi"}' },
      { event: 'done', data: '{}' },
    ])
  })

  it('reassembles frames split at every character', async () => {
    const frame = 'event: delta\ndata: {"text":"hi"}\n\n'
    expect(await collect([...frame])).toEqual([{ event: 'delta', data: '{"text":"hi"}' }])
  })

  it('accepts CRLF line endings, including a CR and LF split across chunks', async () => {
    expect(await collect(['event: delta\r', '\ndata: x\r\n\r', '\n'])).toEqual([
      { event: 'delta', data: 'x' },
    ])
  })

  it('joins multi-line data with newlines', async () => {
    expect(await collect(['data: one\ndata: two\n\n'])).toEqual([
      { event: 'message', data: 'one\ntwo' },
    ])
  })

  it('ignores comments and frames without data', async () => {
    expect(await collect([': keep-alive\n\nevent: ping\n\ndata: x\n\n'])).toEqual([
      { event: 'message', data: 'x' },
    ])
  })

  it('decodes multi-byte characters split across chunks', async () => {
    const bytes = new TextEncoder().encode('data: é\n\n')
    expect(await collect([bytes.slice(0, 7), bytes.slice(7)])).toEqual([
      { event: 'message', data: 'é' },
    ])
  })

  it('discards an unterminated frame at the end of the stream', async () => {
    expect(await collect(['data: complete\n\ndata: partial'])).toEqual([
      { event: 'message', data: 'complete' },
    ])
  })
})
