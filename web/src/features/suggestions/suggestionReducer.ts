import { computeSegments, countByStatus, setHunkStatuses } from './diff'
import { normalizeProposal } from './normalize'
import type { HunkStatus, RefineTurn, Suggestion, SuggestionScope, TextRange } from './types'

export type SuggestionState = Suggestion | null

export type SuggestionAction =
  | {
      type: 'start'
      id: string
      scope: SuggestionScope
      baseText: string
      instruction: string
      model: string
      history: RefineTurn[]
    }
  | { type: 'refine'; id: string; instruction: string; scope: SuggestionScope; model: string }
  | { type: 'delta'; id: string; text: string }
  | { type: 'done'; id: string }
  | { type: 'error'; id: string; error: { code: string; message: string } }
  | {
      type: 'setHunkStatus'
      hunkIds: string[]
      status: HunkStatus
      contentBefore: string
      range: TextRange | null
    }
  | { type: 'markStale' }
  | { type: 'discard' }

export function hasAccepted(suggestion: Suggestion): boolean {
  return countByStatus(suggestion.segments).accepted > 0
}

function isStreaming(state: SuggestionState, id: string): state is Suggestion {
  return state !== null && state.id === id && state.status === 'streaming'
}

export function suggestionReducer(
  state: SuggestionState,
  action: SuggestionAction,
): SuggestionState {
  switch (action.type) {
    case 'start':
      return {
        id: action.id,
        status: 'streaming',
        scope: action.scope,
        baseText: action.baseText,
        instruction: action.instruction,
        model: action.model,
        proposedText: '',
        segments: [],
        history: action.history,
        stale: false,
        error: null,
        contentBeforeFirstAccept: null,
      }

    case 'refine':
      if (!state || state.status !== 'reviewing' || state.stale || hasAccepted(state)) return state
      return {
        ...state,
        id: action.id,
        status: 'streaming',
        scope: action.scope,
        instruction: action.instruction,
        model: action.model,
        history: [
          ...state.history,
          { instruction: state.instruction, proposal: state.proposedText },
        ],
        proposedText: '',
        segments: [],
        error: null,
      }

    case 'delta':
      if (!isStreaming(state, action.id)) return state
      return { ...state, proposedText: state.proposedText + action.text }

    case 'done': {
      if (!isStreaming(state, action.id)) return state
      const proposedText = normalizeProposal(state.proposedText, state.baseText)
      return {
        ...state,
        status: 'reviewing',
        proposedText,
        segments: computeSegments(state.baseText, proposedText),
      }
    }

    case 'error':
      if (!state || state.id !== action.id || state.status === 'reviewing') return state
      return { ...state, status: 'error', error: action.error }

    case 'setHunkStatus': {
      if (!state || state.status !== 'reviewing' || state.stale) return state
      const scope: SuggestionScope =
        action.range && state.scope.kind === 'selection'
          ? { kind: 'selection', range: action.range }
          : state.scope
      return {
        ...state,
        scope,
        segments: setHunkStatuses(state.segments, action.hunkIds, action.status),
        contentBeforeFirstAccept:
          state.contentBeforeFirstAccept ??
          (action.status === 'accepted' ? action.contentBefore : null),
      }
    }

    case 'markStale':
      if (!state || state.status !== 'reviewing') return state
      return { ...state, stale: true }

    case 'discard':
      return null
  }
}
