import { z } from 'zod'
import { loadJson, saveJson } from '../../lib/storage'
import { TOUR_VERSION } from './tourSteps'

export const ONBOARDING_STORAGE_KEY = 'ai-docs:onboarding'

const onboardingSchema = z.object({ seenVersion: z.number().int().nonnegative() })

export function hasSeenTour(): boolean {
  return (
    loadJson(ONBOARDING_STORAGE_KEY, onboardingSchema, { seenVersion: 0 }).seenVersion >=
    TOUR_VERSION
  )
}

export function markTourSeen(): void {
  saveJson(ONBOARDING_STORAGE_KEY, { seenVersion: TOUR_VERSION })
}
