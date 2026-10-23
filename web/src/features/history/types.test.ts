import { describe, expect, it } from 'vitest'
import { MAX_VERSIONS, VERSIONS_STORAGE_KEY, VersionSchema, VersionsSchema } from './types'

describe('VersionSchema', () => {
  it('accepts a valid version with and without a model', () => {
    const base = { id: 'a', createdAt: 1, source: 'ai', label: 'Shorter', content: '# Hi\n' }
    expect(VersionSchema.parse(base)).toEqual(base)
    expect(VersionSchema.parse({ ...base, model: 'claude-sonnet-5-5' }).model).toBe(
      'claude-sonnet-5-5',
    )
  })

  it('rejects an unknown source', () => {
    const result = VersionSchema.safeParse({
      id: 'a',
      createdAt: 1,
      source: 'robot',
      label: 'x',
      content: '',
    })
    expect(result.success).toBe(false)
  })

  it('rejects an empty id', () => {
    const result = VersionSchema.safeParse({
      id: '',
      createdAt: 1,
      source: 'manual',
      label: 'x',
      content: '',
    })
    expect(result.success).toBe(false)
  })

  it('parses an array of versions', () => {
    const list = [
      { id: 'a', createdAt: 1, source: 'initial', label: 'Initial version', content: '' },
    ]
    expect(VersionsSchema.parse(list)).toEqual(list)
  })

  it('exposes the shared constants', () => {
    expect(MAX_VERSIONS).toBe(100)
    expect(VERSIONS_STORAGE_KEY).toBe('ai-docs:versions')
  })
})
