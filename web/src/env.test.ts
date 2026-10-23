import { describe, expect, it } from 'vitest'
import { parseEnv } from './env'

describe('parseEnv', () => {
  it('defaults VITE_API_BASE_URL to /api', () => {
    expect(parseEnv({})).toEqual({ VITE_API_BASE_URL: '/api' })
  })

  it('uses a provided VITE_API_BASE_URL', () => {
    expect(parseEnv({ VITE_API_BASE_URL: 'http://localhost:8000/api' })).toEqual({
      VITE_API_BASE_URL: 'http://localhost:8000/api',
    })
  })

  it('strips trailing slashes', () => {
    expect(parseEnv({ VITE_API_BASE_URL: 'http://localhost:8000/api/' }).VITE_API_BASE_URL).toBe(
      'http://localhost:8000/api',
    )
  })

  it('ignores unrelated variables', () => {
    expect(parseEnv({ MODE: 'test', DEV: true, VITE_OTHER: 'x' })).toEqual({
      VITE_API_BASE_URL: '/api',
    })
  })

  it('throws on an empty VITE_API_BASE_URL', () => {
    expect(() => parseEnv({ VITE_API_BASE_URL: '   ' })).toThrow(/Invalid environment variables/)
  })

  it('throws on a non-string VITE_API_BASE_URL', () => {
    expect(() => parseEnv({ VITE_API_BASE_URL: 42 })).toThrow(/Invalid environment variables/)
  })
})
