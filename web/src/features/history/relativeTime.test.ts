import { describe, expect, it } from 'vitest'
import { formatRelativeTime } from './relativeTime'

const NOW = Date.UTC(2026, 9, 22, 12, 0, 0)

describe('formatRelativeTime', () => {
  it('says "just now" for anything under 45 seconds', () => {
    expect(formatRelativeTime(NOW - 10_000, NOW)).toBe('just now')
    expect(formatRelativeTime(NOW, NOW)).toBe('just now')
  })

  it('formats minutes, hours and days in the past', () => {
    expect(formatRelativeTime(NOW - 2 * 60_000, NOW)).toBe('2 minutes ago')
    expect(formatRelativeTime(NOW - 3 * 3_600_000, NOW)).toBe('3 hours ago')
    expect(formatRelativeTime(NOW - 25 * 3_600_000, NOW)).toBe('yesterday')
    expect(formatRelativeTime(NOW - 3 * 86_400_000, NOW)).toBe('3 days ago')
  })
})
