import { describe, expect, it } from 'vitest'
import { getHunks } from './diff'
import {
  hasAccepted,
  suggestionReducer,
  type SuggestionAction,
  type SuggestionState,
} from './suggestionReducer'

const start: SuggestionAction = {
  type: 'start',
  id: 's1',
  scope: { kind: 'selection', range: { from: 4, to: 12 } },
  baseText: 'one\ntwo\n',
  instruction: 'Shout',
  model: 'claude-sonnet-5-5',
  history: [],
}

function reduce(actions: SuggestionAction[], initial: SuggestionState = null): SuggestionState {
  return actions.reduce<SuggestionState>(
    (state, action) => suggestionReducer(state, action),
    initial,
  )
}

const reviewing = reduce([
  start,
  { type: 'delta', id: 's1', text: 'ONE\ntwo\n' },
  { type: 'done', id: 's1' },
])

describe('suggestionReducer', () => {
  it('starts a streaming suggestion', () => {
    expect(reduce([start])).toEqual({
      id: 's1',
      status: 'streaming',
      scope: { kind: 'selection', range: { from: 4, to: 12 } },
      baseText: 'one\ntwo\n',
      instruction: 'Shout',
      model: 'claude-sonnet-5-5',
      proposedText: '',
      segments: [],
      history: [],
      stale: false,
      error: null,
      contentBeforeFirstAccept: null,
    })
  })

  it('appends deltas from the current stream only', () => {
    const state = reduce([
      start,
      { type: 'delta', id: 's1', text: 'ON' },
      { type: 'delta', id: 'other', text: 'XX' },
      { type: 'delta', id: 's1', text: 'E' },
    ])
    expect(state?.proposedText).toBe('ONE')
  })

  it('normalizes the proposal and computes segments when done', () => {
    const state = reduce([
      start,
      { type: 'delta', id: 's1', text: '```markdown\nONE\ntwo' },
      { type: 'delta', id: 's1', text: '\n```' },
      { type: 'done', id: 's1' },
    ])
    expect(state?.status).toBe('reviewing')
    expect(state?.proposedText).toBe('ONE\ntwo\n')
    expect(getHunks(state?.segments ?? []).map((h) => [h.oldText, h.newText])).toEqual([
      ['one\n', 'ONE\n'],
    ])
  })

  it('ignores deltas after done', () => {
    const state = reduce([{ type: 'delta', id: 's1', text: 'more' }], reviewing)
    expect(state?.proposedText).toBe('ONE\ntwo\n')
  })

  it('records errors while streaming but not while reviewing', () => {
    const error = { code: 'rate_limited', message: 'Slow down' }
    const failed = reduce([start, { type: 'error', id: 's1', error }])
    expect(failed?.status).toBe('error')
    expect(failed?.error).toEqual(error)
    expect(reduce([{ type: 'error', id: 's1', error }], reviewing)).toBe(reviewing)
  })

  it('updates hunk status, the first-accept snapshot and the selection range', () => {
    const accepted = reduce(
      [
        {
          type: 'setHunkStatus',
          hunkIds: ['hunk-1'],
          status: 'accepted',
          contentBefore: 'doc v1',
          range: { from: 4, to: 12 },
        },
      ],
      reviewing,
    )
    expect(getHunks(accepted?.segments ?? [])[0]?.status).toBe('accepted')
    expect(accepted?.contentBeforeFirstAccept).toBe('doc v1')
    expect(accepted && hasAccepted(accepted)).toBe(true)

    const again = reduce(
      [
        {
          type: 'setHunkStatus',
          hunkIds: ['hunk-1'],
          status: 'rejected',
          contentBefore: 'doc v2',
          range: { from: 6, to: 14 },
        },
      ],
      accepted,
    )
    expect(again?.contentBeforeFirstAccept).toBe('doc v1')
    expect(again?.scope).toEqual({ kind: 'selection', range: { from: 6, to: 14 } })
  })

  it('does not take a first-accept snapshot on reject', () => {
    const rejected = reduce(
      [
        {
          type: 'setHunkStatus',
          hunkIds: ['hunk-1'],
          status: 'rejected',
          contentBefore: 'doc',
          range: null,
        },
      ],
      reviewing,
    )
    expect(rejected?.contentBeforeFirstAccept).toBeNull()
  })

  it('freezes hunk decisions once stale', () => {
    const stale = reduce([{ type: 'markStale' }], reviewing)
    expect(stale?.stale).toBe(true)
    const after = reduce(
      [
        {
          type: 'setHunkStatus',
          hunkIds: ['hunk-1'],
          status: 'accepted',
          contentBefore: 'doc',
          range: null,
        },
      ],
      stale,
    )
    expect(after).toBe(stale)
  })

  it('refines by pushing the current turn into history', () => {
    const refined = reduce(
      [
        {
          type: 'refine',
          id: 's2',
          instruction: 'Quieter',
          scope: { kind: 'selection', range: { from: 5, to: 13 } },
          model: 'claude-haiku-5-5',
        },
      ],
      reviewing,
    )
    expect(refined).toMatchObject({
      id: 's2',
      status: 'streaming',
      instruction: 'Quieter',
      model: 'claude-haiku-5-5',
      baseText: 'one\ntwo\n',
      proposedText: '',
      segments: [],
      history: [{ instruction: 'Shout', proposal: 'ONE\ntwo\n' }],
      scope: { kind: 'selection', range: { from: 5, to: 13 } },
    })
  })

  it('refuses to refine after a hunk was accepted', () => {
    const accepted = reduce(
      [
        {
          type: 'setHunkStatus',
          hunkIds: ['hunk-1'],
          status: 'accepted',
          contentBefore: 'doc',
          range: null,
        },
      ],
      reviewing,
    )
    const refined = reduce(
      [{ type: 'refine', id: 's2', instruction: 'x', scope: { kind: 'document' }, model: 'm' }],
      accepted,
    )
    expect(refined).toBe(accepted)
  })

  it('discards', () => {
    expect(reduce([{ type: 'discard' }], reviewing)).toBeNull()
  })
})
