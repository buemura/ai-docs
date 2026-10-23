import type { TextRange } from '../document/schema'

export type { TextRange }

export type HunkStatus = 'pending' | 'accepted' | 'rejected'

export type Hunk = {
  id: string
  oldText: string
  newText: string
  oldStartLine: number
  newStartLine: number
  status: HunkStatus
}

export type DiffSegment =
  | { kind: 'equal'; text: string; oldStartLine: number; newStartLine: number }
  | { kind: 'change'; hunk: Hunk }

export type SuggestionScope = { kind: 'document' } | { kind: 'selection'; range: TextRange }

export type RefineTurn = { instruction: string; proposal: string }

export type SuggestionStatus = 'streaming' | 'reviewing' | 'error'

export type Suggestion = {
  id: string
  status: SuggestionStatus
  scope: SuggestionScope
  /** Target text when the suggestion was requested. */
  baseText: string
  /** The current turn's instruction. */
  instruction: string
  model: string
  /** Streamed text while streaming; normalized proposal once reviewing. */
  proposedText: string
  /** Empty until reviewing. */
  segments: DiffSegment[]
  /** Previous turns, oldest first (sent to the backend on refine). */
  history: RefineTurn[]
  stale: boolean
  error: { code: string; message: string } | null
  contentBeforeFirstAccept: string | null
}

export type SuggestionTarget = 'auto' | 'document' | TextRange

export type StartSuggestionInput = { instruction: string; target: SuggestionTarget }

export type ResolvedSuggestion = {
  instruction: string
  history: RefineTurn[]
  model: string
  contentBefore: string
  contentAfter: string
  acceptedCount: number
  totalCount: number
}
