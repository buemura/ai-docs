import { describe, expect, it } from 'vitest'
import { locateRegion, resolveTarget } from './locateRegion'

describe('locateRegion', () => {
  it('matches exactly at the hint', () => {
    expect(locateRegion('xx abc yy', 'abc', 3)).toEqual({ from: 3, to: 6 })
  })

  it('prefers the hint even when the text occurs more than once', () => {
    expect(locateRegion('abc abc', 'abc', 4)).toEqual({ from: 4, to: 7 })
  })

  it('finds a unique occurrence that moved', () => {
    expect(locateRegion('XXabc', 'abc', 0)).toEqual({ from: 2, to: 5 })
  })

  it('returns null for ambiguous or missing text', () => {
    expect(locateRegion('abc abc', 'abc', 1)).toBeNull()
    expect(locateRegion('hello', 'abc', 0)).toBeNull()
  })

  it('handles empty expected text', () => {
    expect(locateRegion('hello', '', 2)).toEqual({ from: 2, to: 2 })
    expect(locateRegion('hello', '', 9)).toBeNull()
  })

  it('ignores a negative hint', () => {
    expect(locateRegion('abc', 'abc', -1)).toEqual({ from: 0, to: 3 })
  })
})

describe('resolveTarget', () => {
  const collapsed = { from: 2, to: 2 }

  it('returns null for the whole document', () => {
    expect(resolveTarget('document', { from: 0, to: 4 }, 10)).toBeNull()
  })

  it('uses the selection for auto, or the document when it is collapsed', () => {
    expect(resolveTarget('auto', { from: 1, to: 4 }, 10)).toEqual({ from: 1, to: 4 })
    expect(resolveTarget('auto', collapsed, 10)).toBeNull()
  })

  it('normalizes reversed ranges and clamps to the content length', () => {
    expect(resolveTarget({ from: 8, to: 3 }, collapsed, 10)).toEqual({ from: 3, to: 8 })
    expect(resolveTarget({ from: 5, to: 50 }, collapsed, 10)).toEqual({ from: 5, to: 10 })
    expect(resolveTarget({ from: 4, to: 4 }, collapsed, 10)).toBeNull()
  })
})
