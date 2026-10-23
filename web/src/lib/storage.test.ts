import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { loadJson, saveJson } from './storage'

const schema = z.object({ n: z.number() })

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('loadJson', () => {
  it('returns the fallback when the key is missing', () => {
    expect(loadJson('k', schema, { n: 0 })).toEqual({ n: 0 })
  })

  it('returns parsed data when it matches the schema', () => {
    localStorage.setItem('k', JSON.stringify({ n: 5 }))
    expect(loadJson('k', schema, { n: 0 })).toEqual({ n: 5 })
  })

  it('returns the fallback for invalid JSON', () => {
    localStorage.setItem('k', '{not json')
    expect(loadJson('k', schema, { n: 0 })).toEqual({ n: 0 })
  })

  it('returns the fallback when data does not match the schema', () => {
    localStorage.setItem('k', JSON.stringify({ n: 'five' }))
    expect(loadJson('k', schema, { n: 0 })).toEqual({ n: 0 })
  })

  it('returns the fallback when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(loadJson('k', schema, { n: 0 })).toEqual({ n: 0 })
  })
})

describe('saveJson', () => {
  it('stores the value as JSON and returns true', () => {
    expect(saveJson('k', { n: 1 })).toBe(true)
    expect(localStorage.getItem('k')).toBe('{"n":1}')
  })

  it('returns false when setItem throws (e.g. quota exceeded)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    expect(saveJson('k', { n: 1 })).toBe(false)
  })
})
