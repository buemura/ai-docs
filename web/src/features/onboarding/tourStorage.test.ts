import { beforeEach, describe, expect, it } from 'vitest'
import { hasSeenTour, markTourSeen, ONBOARDING_STORAGE_KEY } from './tourStorage'
import { TOUR_VERSION } from './tourSteps'

beforeEach(() => {
  // test/setup.ts seeds the key so other suites skip the tour; start clean here.
  localStorage.removeItem(ONBOARDING_STORAGE_KEY)
})

describe('tourStorage', () => {
  it('reports unseen when nothing is stored', () => {
    expect(hasSeenTour()).toBe(false)
  })

  it('round-trips the current version', () => {
    markTourSeen()
    expect(JSON.parse(localStorage.getItem(ONBOARDING_STORAGE_KEY)!)).toEqual({
      seenVersion: TOUR_VERSION,
    })
    expect(hasSeenTour()).toBe(true)
  })

  it('treats an older version as unseen', () => {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({ seenVersion: TOUR_VERSION - 1 }))
    expect(hasSeenTour()).toBe(false)
  })

  it('treats invalid data as unseen', () => {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({ seenVersion: 'yes' }))
    expect(hasSeenTour()).toBe(false)
    localStorage.setItem(ONBOARDING_STORAGE_KEY, '{not json')
    expect(hasSeenTour()).toBe(false)
  })
})
