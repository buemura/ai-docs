import { describe, expect, it } from 'vitest'
import { anchorSelector, TOUR_STEPS, TOUR_VERSION } from './tourSteps'

describe('TOUR_STEPS', () => {
  it('stays brief', () => {
    expect(TOUR_STEPS.length).toBeGreaterThan(0)
    expect(TOUR_STEPS.length).toBeLessThanOrEqual(8)
    for (const step of TOUR_STEPS) {
      expect(step.title.trim()).not.toBe('')
      expect(step.body.trim()).not.toBe('')
      expect(step.body.length).toBeLessThanOrEqual(240)
    }
  })

  it('has unique ids and anchors', () => {
    const ids = TOUR_STEPS.map((s) => s.id)
    const anchors = TOUR_STEPS.flatMap((s) => (s.anchor ? [s.anchor] : []))
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(anchors).size).toBe(anchors.length)
  })

  it('opens with a centered welcome and walks the UI in reading order', () => {
    expect(TOUR_STEPS.map((s) => s.anchor)).toEqual([
      null,
      'editor',
      'ask-ai',
      'quick-actions',
      'model-select',
      'tabs',
      'commands',
      'export',
    ])
  })

  it('has a positive version', () => {
    expect(TOUR_VERSION).toBeGreaterThanOrEqual(1)
  })
})

describe('anchorSelector', () => {
  it('builds a data-tour attribute selector', () => {
    expect(anchorSelector('ask-ai')).toBe('[data-tour="ask-ai"]')
  })
})
