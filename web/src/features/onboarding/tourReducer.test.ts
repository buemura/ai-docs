import { describe, expect, it } from 'vitest'
import { initialTourState, tourReducer, type TourState } from './tourReducer'

const running = (index: number, count = 3): TourState => ({ status: 'running', index, count })

describe('tourReducer', () => {
  it('starts idle', () => {
    expect(initialTourState).toEqual({ status: 'idle' })
  })

  it('starts at the first step, also when restarted mid-tour', () => {
    expect(tourReducer(initialTourState, { type: 'start', count: 3 })).toEqual(running(0))
    expect(tourReducer(running(2), { type: 'start', count: 3 })).toEqual(running(0))
  })

  it('ignores a start with no steps', () => {
    expect(tourReducer(initialTourState, { type: 'start', count: 0 })).toEqual(initialTourState)
  })

  it('moves forward and back within bounds', () => {
    expect(tourReducer(running(0), { type: 'next' })).toEqual(running(1))
    expect(tourReducer(running(2), { type: 'next' })).toEqual(running(2))
    expect(tourReducer(running(1), { type: 'back' })).toEqual(running(0))
    expect(tourReducer(running(0), { type: 'back' })).toEqual(running(0))
  })

  it('ignores navigation while idle', () => {
    expect(tourReducer(initialTourState, { type: 'next' })).toEqual(initialTourState)
    expect(tourReducer(initialTourState, { type: 'back' })).toEqual(initialTourState)
  })

  it('ends from any step', () => {
    expect(tourReducer(running(1), { type: 'end' })).toEqual(initialTourState)
  })
})
