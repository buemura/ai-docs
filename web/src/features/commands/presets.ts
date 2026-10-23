import type { TextRange } from '../document/schema'
import type { SuggestionTarget } from '../suggestions/types'

export type AiPreset = {
  id: string
  label: string
  slash: string
  instruction: string
  target: 'auto' | 'document' | 'block'
}

export const ASK_SLASH = 'ask'

export const AI_PRESETS: AiPreset[] = [
  {
    id: 'improve',
    label: 'Improve writing',
    slash: 'improve',
    instruction:
      'Improve clarity, flow, and word choice while keeping the meaning and the author’s voice.',
    target: 'block',
  },
  {
    id: 'fix',
    label: 'Fix grammar & spelling',
    slash: 'fix',
    instruction:
      'Fix grammar, spelling, and punctuation mistakes only. Do not change the wording otherwise.',
    target: 'block',
  },
  {
    id: 'shorten',
    label: 'Make more concise',
    slash: 'shorten',
    instruction:
      'Make this more concise. Remove redundancy and filler while keeping every key point.',
    target: 'block',
  },
  {
    id: 'expand',
    label: 'Expand with more detail',
    slash: 'expand',
    instruction:
      'Expand this with more detail, explanation, or examples, keeping the same tone and style.',
    target: 'block',
  },
  {
    id: 'tone-professional',
    label: 'Professional tone',
    slash: 'tone-professional',
    instruction: 'Rewrite this in a clear, professional tone suitable for a business audience.',
    target: 'block',
  },
  {
    id: 'tone-casual',
    label: 'Casual tone',
    slash: 'tone-casual',
    instruction: 'Rewrite this in a relaxed, casual tone, as if talking to a colleague.',
    target: 'block',
  },
  {
    id: 'tone-friendly',
    label: 'Friendly tone',
    slash: 'tone-friendly',
    instruction: 'Rewrite this in a warm, friendly, and approachable tone.',
    target: 'block',
  },
  {
    id: 'restructure',
    label: 'Restructure document',
    slash: 'restructure',
    instruction:
      'Reorganize the document into a clearer structure with logical ordering and headings. Keep all of the information.',
    target: 'document',
  },
  {
    id: 'tldr',
    label: 'Add TL;DR summary',
    slash: 'tldr',
    instruction:
      'Add a short "TL;DR" section at the top of the document summarizing it in 1–3 sentences. Leave the rest unchanged.',
    target: 'document',
  },
]

export function blockRangeAt(content: string, pos: number): TextRange {
  const clamped = Math.max(0, Math.min(pos, content.length))
  const lineStartOf = (i: number) => content.lastIndexOf('\n', i - 1) + 1
  const lineEndOf = (i: number) => {
    const next = content.indexOf('\n', i)
    return next === -1 ? content.length : next
  }
  const isBlank = (start: number, end: number) => content.slice(start, end).trim() === ''

  let start = lineStartOf(clamped)
  let end = lineEndOf(clamped)
  if (isBlank(start, end)) return { from: clamped, to: clamped }

  while (start > 0) {
    const prevStart = lineStartOf(start - 1)
    if (isBlank(prevStart, start - 1)) break
    start = prevStart
  }
  while (end < content.length) {
    const nextEnd = lineEndOf(end + 1)
    if (isBlank(end + 1, nextEnd)) break
    end = nextEnd
  }
  return { from: start, to: end }
}

export function resolvePresetTarget(
  preset: AiPreset,
  content: string,
  selection: TextRange,
): SuggestionTarget {
  if (selection.from !== selection.to) return { from: selection.from, to: selection.to }
  if (preset.target === 'document') return 'document'
  if (preset.target === 'auto') return 'auto'
  const block = blockRangeAt(content, selection.from)
  return block.from === block.to ? 'document' : block
}
