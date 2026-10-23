import { describe, expect, it } from 'vitest'
import type { ResolvedSuggestion } from '../suggestions/types'
import type { Version, VersionSource } from './types'
import {
  appendVersion,
  trimForQuota,
  versionsForResolution,
  versionsReducer,
} from './versionsReducer'

function v(id: string, content: string, source: VersionSource = 'manual'): Version {
  return { id, createdAt: 0, source, label: id, content }
}

function resolved(overrides: Partial<ResolvedSuggestion> = {}): ResolvedSuggestion {
  return {
    instruction: 'Shorter',
    history: [],
    model: 'claude-sonnet-5-5',
    contentBefore: 'a\n',
    contentAfter: 'b\n',
    acceptedCount: 1,
    totalCount: 1,
    ...overrides,
  }
}

describe('appendVersion', () => {
  it('appends to the end (oldest first)', () => {
    const next = appendVersion([v('1', 'a')], v('2', 'b'))
    expect(next.map((x) => x.id)).toEqual(['1', '2'])
  })

  it('returns the same array when content equals the latest version', () => {
    const list = [v('1', 'a'), v('2', 'b')]
    expect(appendVersion(list, v('3', 'b'))).toBe(list)
  })

  it('allows content that matches an older, non-latest version', () => {
    const next = appendVersion([v('1', 'a'), v('2', 'b')], v('3', 'a'))
    expect(next.map((x) => x.id)).toEqual(['1', '2', '3'])
  })

  it('appends to an empty list', () => {
    expect(appendVersion([], v('1', 'a')).map((x) => x.id)).toEqual(['1'])
  })

  it('trims the oldest versions beyond MAX_VERSIONS, keeping the newest', () => {
    const list = Array.from({ length: 100 }, (_, i) => v(`v${i}`, `c${i}`))
    const next = appendVersion(list, v('new', 'fresh'))
    expect(next).toHaveLength(100)
    expect(next[0].id).toBe('v1')
    expect(next.at(-1)?.id).toBe('new')
  })

  it('honours a custom max', () => {
    const next = appendVersion([v('1', 'a'), v('2', 'b'), v('3', 'c')], v('4', 'd'), 3)
    expect(next.map((x) => x.id)).toEqual(['2', '3', '4'])
  })
})

describe('versionsReducer', () => {
  it('records a version via appendVersion', () => {
    const state = [v('1', 'a')]
    expect(
      versionsReducer(state, { type: 'record', version: v('2', 'b') }).map((x) => x.id),
    ).toEqual(['1', '2'])
    expect(versionsReducer(state, { type: 'record', version: v('2', 'a') })).toBe(state)
  })
})

describe('trimForQuota', () => {
  it('keeps the newest 20 versions by default', () => {
    const list = Array.from({ length: 30 }, (_, i) => v(`v${i}`, `c${i}`))
    const trimmed = trimForQuota(list)
    expect(trimmed).toHaveLength(20)
    expect(trimmed[0].id).toBe('v10')
    expect(trimmed.at(-1)?.id).toBe('v29')
  })

  it('returns everything when the list is already short', () => {
    const list = [v('1', 'a')]
    expect(trimForQuota(list)).toEqual(list)
  })
})

describe('versionsForResolution', () => {
  it('records only the AI version when nothing changed since the latest version', () => {
    expect(versionsForResolution(resolved(), 'a\n')).toEqual([
      { source: 'ai', label: 'Shorter', model: 'claude-sonnet-5-5', content: 'b\n' },
    ])
  })

  it('records manual edits first when the document drifted from the latest version', () => {
    expect(versionsForResolution(resolved({ contentBefore: 'a edited\n' }), 'a\n')).toEqual([
      { source: 'manual', label: 'Manual edits', content: 'a edited\n' },
      { source: 'ai', label: 'Shorter', model: 'claude-sonnet-5-5', content: 'b\n' },
    ])
  })

  it('records manual edits when there is no version yet', () => {
    expect(versionsForResolution(resolved(), null).map((x) => x.source)).toEqual(['manual', 'ai'])
  })

  it('labels the AI version with the refine chain', () => {
    const [ai] = versionsForResolution(
      resolved({
        instruction: 'Shorter',
        history: [
          { instruction: 'Formal', proposal: 'x' },
          { instruction: 'Add a summary', proposal: 'y' },
        ],
      }),
      'a\n',
    )
    expect(ai.label).toBe('Formal → Add a summary → Shorter')
  })
})
