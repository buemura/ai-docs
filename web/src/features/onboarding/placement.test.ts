import { describe, expect, it } from 'vitest'
import { placeCard } from './placement'

const viewport = { width: 1000, height: 800 }
const card = { width: 320, height: 160 }

describe('placeCard', () => {
  it('centers the card when there is no anchor', () => {
    expect(placeCard(null, card, viewport)).toEqual({ top: 320, left: 340 })
  })

  it('places the card below a small anchor, centered on it', () => {
    expect(placeCard({ top: 50, left: 300, width: 200, height: 30 }, card, viewport)).toEqual({
      top: 98,
      left: 240,
    })
  })

  it('clamps horizontally to the viewport margins', () => {
    expect(placeCard({ top: 10, left: 950, width: 40, height: 30 }, card, viewport).left).toBe(664)
    expect(placeCard({ top: 10, left: 0, width: 40, height: 30 }, card, viewport).left).toBe(16)
  })

  it('flips above an anchor near the bottom', () => {
    expect(placeCard({ top: 700, left: 400, width: 200, height: 40 }, card, viewport)).toEqual({
      top: 522,
      left: 340,
    })
  })

  it('centers vertically over an anchor too tall to sit beside', () => {
    expect(placeCard({ top: 100, left: 0, width: 1000, height: 700 }, card, viewport)).toEqual({
      top: 320,
      left: 340,
    })
  })

  it('pins to the margin when the viewport is narrower than the card', () => {
    const narrow = { width: 300, height: 600 }
    expect(placeCard(null, card, narrow).left).toBe(16)
    expect(placeCard({ top: 10, left: 100, width: 50, height: 20 }, card, narrow).left).toBe(16)
  })
})
