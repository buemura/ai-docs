import { describe, expect, it } from 'vitest'
import {
  applySegments,
  computeSegments,
  countByStatus,
  countLines,
  getHunks,
  setHunkStatuses,
  splitLines,
} from './diff'

describe('countLines / splitLines', () => {
  it('counts lines with and without a trailing newline', () => {
    expect(countLines('')).toBe(0)
    expect(countLines('a')).toBe(1)
    expect(countLines('a\n')).toBe(1)
    expect(countLines('a\nb')).toBe(2)
    expect(countLines('a\nb\n')).toBe(2)
    expect(countLines('\n')).toBe(1)
  })

  it('splits lines without an empty trailing entry', () => {
    expect(splitLines('')).toEqual([])
    expect(splitLines('a\nb\n')).toEqual(['a', 'b'])
    expect(splitLines('a\nb')).toEqual(['a', 'b'])
    expect(splitLines('a\n\nb\n')).toEqual(['a', '', 'b'])
  })
})

describe('computeSegments', () => {
  it('returns only equal segments for identical text', () => {
    const segments = computeSegments('a\nb\n', 'a\nb\n')
    expect(getHunks(segments)).toHaveLength(0)
    expect(applySegments(segments)).toBe('a\nb\n')
  })

  it('groups a replaced line into one hunk with line numbers', () => {
    expect(computeSegments('a\nb\nc\n', 'a\nB\nc\n')).toEqual([
      { kind: 'equal', text: 'a\n', oldStartLine: 1, newStartLine: 1 },
      {
        kind: 'change',
        hunk: {
          id: 'hunk-1',
          oldText: 'b\n',
          newText: 'B\n',
          oldStartLine: 2,
          newStartLine: 2,
          status: 'pending',
        },
      },
      { kind: 'equal', text: 'c\n', oldStartLine: 3, newStartLine: 3 },
    ])
  })

  it('tracks line numbers across insertions and deletions', () => {
    const hunks = getHunks(computeSegments('a\nb\nc\nd\n', 'a\nx\ny\nb\nd\n'))
    expect(hunks.map((h) => [h.id, h.oldText, h.newText, h.oldStartLine, h.newStartLine])).toEqual([
      ['hunk-1', '', 'x\ny\n', 2, 2],
      ['hunk-2', 'c\n', '', 3, 5],
    ])
  })

  it('handles a last line without a trailing newline', () => {
    const hunks = getHunks(computeSegments('a\nb', 'a\nc'))
    expect(hunks.map((h) => [h.oldText, h.newText])).toEqual([['b', 'c']])
  })

  it('handles an empty original', () => {
    const hunks = getHunks(computeSegments('', 'hello\n'))
    expect(hunks.map((h) => [h.oldText, h.newText, h.oldStartLine, h.newStartLine])).toEqual([
      ['', 'hello\n', 1, 1],
    ])
  })
})

describe('applySegments / setHunkStatuses / countByStatus', () => {
  const segments = computeSegments('one\ntwo\nthree\n', 'ONE\ntwo\nTHREE\n')
  const [first, second] = getHunks(segments)

  it('keeps the original text while hunks are pending', () => {
    expect(applySegments(segments)).toBe('one\ntwo\nthree\n')
  })

  it('applies only accepted hunks', () => {
    const one = setHunkStatuses(segments, [first.id], 'accepted')
    expect(applySegments(one)).toBe('ONE\ntwo\nthree\n')
    const both = setHunkStatuses(one, [second.id], 'accepted')
    expect(applySegments(both)).toBe('ONE\ntwo\nTHREE\n')
    const rejected = setHunkStatuses(both, [second.id], 'rejected')
    expect(applySegments(rejected)).toBe('ONE\ntwo\nthree\n')
  })

  it('does not mutate the input segments', () => {
    setHunkStatuses(segments, [first.id, second.id], 'accepted')
    expect(getHunks(segments).map((h) => h.status)).toEqual(['pending', 'pending'])
  })

  it('counts hunks by status', () => {
    expect(countByStatus(segments)).toEqual({ pending: 2, accepted: 0, rejected: 0 })
    const mixed = setHunkStatuses(
      setHunkStatuses(segments, [first.id], 'accepted'),
      [second.id],
      'rejected',
    )
    expect(countByStatus(mixed)).toEqual({ pending: 0, accepted: 1, rejected: 1 })
  })
})
