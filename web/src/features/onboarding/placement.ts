export type Rect = { top: number; left: number; width: number; height: number }
export type Size = { width: number; height: number }

export const SPOTLIGHT_PADDING = 6
const GAP = 12
const MARGIN = 16

export function placeCard(
  anchor: Rect | null,
  card: Size,
  viewport: Size,
): { top: number; left: number } {
  const centeredTop = Math.max(MARGIN, (viewport.height - card.height) / 2)
  if (!anchor) {
    return { top: centeredTop, left: Math.max(MARGIN, (viewport.width - card.width) / 2) }
  }

  const left = clamp(
    anchor.left + anchor.width / 2 - card.width / 2,
    MARGIN,
    viewport.width - card.width - MARGIN,
  )
  const below = anchor.top + anchor.height + SPOTLIGHT_PADDING + GAP
  if (below + card.height <= viewport.height - MARGIN) return { top: below, left }
  const above = anchor.top - SPOTLIGHT_PADDING - GAP - card.height
  if (above >= MARGIN) return { top: above, left }
  return { top: centeredTop, left }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}
