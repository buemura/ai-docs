import type { SuggestionTarget, TextRange } from './types'

/**
 * Find where `expected` currently sits in `content`: exactly at `hintFrom`,
 * otherwise its single occurrence anywhere. Returns null when the text is
 * gone or ambiguous; the caller then marks the suggestion stale.
 */
export function locateRegion(
  content: string,
  expected: string,
  hintFrom: number,
): TextRange | null {
  const hint = Math.max(0, hintFrom)
  if (expected === '') return hint <= content.length ? { from: hint, to: hint } : null
  if (content.startsWith(expected, hint)) return { from: hint, to: hint + expected.length }

  const first = content.indexOf(expected)
  if (first === -1) return null
  if (content.indexOf(expected, first + 1) !== -1) return null
  return { from: first, to: first + expected.length }
}

/** Resolve a trigger target into a non-empty range, or null for the whole document. */
export function resolveTarget(
  target: SuggestionTarget,
  selection: TextRange,
  contentLength: number,
): TextRange | null {
  if (target === 'document') return null
  const range = target === 'auto' ? selection : target
  const from = Math.max(0, Math.min(range.from, range.to))
  const to = Math.min(contentLength, Math.max(range.from, range.to))
  return from < to ? { from, to } : null
}
