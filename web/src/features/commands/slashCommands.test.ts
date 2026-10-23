import { CompletionContext, type Completion, type CompletionResult } from '@codemirror/autocomplete'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { slashCommands, slashCompletionSource } from './slashCommands'

type ApplyFn = (view: EditorView, completion: Completion, from: number, to: number) => void

function complete(doc: string, pos = doc.length) {
  const state = EditorState.create({ doc, selection: { anchor: pos } })
  return slashCompletionSource(vi.fn())(
    new CompletionContext(state, pos, false),
  ) as CompletionResult | null
}

let view: EditorView | null = null
afterEach(() => {
  view?.destroy()
  view = null
})

describe('slashCompletionSource', () => {
  it('offers /ask and every preset at the start of a line', () => {
    const result = complete('/')
    expect(result?.from).toBe(0)
    const labels = result?.options.map((o) => o.label)
    expect(labels?.[0]).toBe('/ask')
    expect(labels).toEqual(
      expect.arrayContaining(['/improve', '/fix', '/shorten', '/restructure', '/tldr']),
    )
  })

  it('triggers after whitespace and covers the typed word', () => {
    const result = complete('Hello /fi')
    expect(result?.from).toBe(6)
    expect(result?.validFor).toBeInstanceOf(RegExp)
  })

  it('triggers on a later line', () => {
    expect(complete('Intro\n/tone-')?.from).toBe(6)
  })

  it('does not trigger inside a word, a path, or a URL', () => {
    expect(complete('path/to')).toBeNull()
    expect(complete('see http://x')).toBeNull()
    expect(complete('and/or')).toBeNull()
  })

  it('does not trigger when the slash word is not right before the cursor', () => {
    expect(complete('a /fix more')).toBeNull()
  })

  it('applying a preset deletes the slash text and reports the preset', () => {
    const onSelect = vi.fn()
    const doc = 'Para one\n/fix'
    view = new EditorView({
      state: EditorState.create({ doc, selection: { anchor: doc.length } }),
      parent: document.body,
    })
    const result = slashCompletionSource(onSelect)(
      new CompletionContext(view.state, doc.length, false),
    ) as CompletionResult
    const option = result.options.find((o) => o.label === '/fix')!
    ;(option.apply as ApplyFn)(view, option, result.from, doc.length)

    expect(view.state.doc.toString()).toBe('Para one\n')
    expect(view.state.selection.main.head).toBe(9)
    expect(onSelect).toHaveBeenCalledWith({
      kind: 'preset',
      preset: expect.objectContaining({ id: 'fix' }),
      content: 'Para one\n',
      cursor: 9,
    })
  })

  it('applying /ask deletes the slash text and reports an ask', () => {
    const onSelect = vi.fn()
    const doc = 'Hello /as'
    view = new EditorView({
      state: EditorState.create({ doc, selection: { anchor: doc.length } }),
      parent: document.body,
    })
    const result = slashCompletionSource(onSelect)(
      new CompletionContext(view.state, doc.length, false),
    ) as CompletionResult
    const option = result.options.find((o) => o.label === '/ask')!
    ;(option.apply as ApplyFn)(view, option, result.from, doc.length)

    expect(view.state.doc.toString()).toBe('Hello ')
    expect(onSelect).toHaveBeenCalledWith({ kind: 'ask', content: 'Hello ', cursor: 6 })
  })
})

describe('slashCommands', () => {
  it('builds an extension accepted by EditorState', () => {
    expect(() => EditorState.create({ doc: '', extensions: slashCommands(vi.fn()) })).not.toThrow()
  })
})
