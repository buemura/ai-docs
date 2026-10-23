import { describe, expect, it } from 'vitest'
import { createId } from './id'

describe('createId', () => {
  it('returns unique UUID strings', () => {
    const a = createId()
    const b = createId()
    expect(a).toMatch(/^[0-9a-f-]{36}$/)
    expect(a).not.toBe(b)
  })
})
