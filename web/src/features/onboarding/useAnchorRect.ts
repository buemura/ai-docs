import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react'
import type { Rect, Size } from './placement'
import { anchorSelector, type TourAnchor } from './tourSteps'

type Measured = { anchor: TourAnchor; rect: Rect | null }

export function useAnchorRect(anchor: TourAnchor | null): Rect | null {
  const [measured, setMeasured] = useState<Measured | null>(null)

  useEffect(() => {
    if (!anchor) return
    const element = document.querySelector(anchorSelector(anchor))
    if (!element) return
    // On narrow screens the anchor may be scrolled out of view (e.g. an overflowing header).
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    const measure = () => setMeasured({ anchor, rect: toRect(element.getBoundingClientRect()) })
    // Measure asynchronously: setState directly in the effect body trips react-hooks/set-state-in-effect.
    const frame = requestAnimationFrame(measure)
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [anchor])

  return measured && measured.anchor === anchor ? measured.rect : null
}

export function useElementSize(ref: RefObject<HTMLElement | null>, fallback: Size): Size {
  const [size, setSize] = useState<Size | null>(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(() => {
      const { width, height } = element.getBoundingClientRect()
      setSize({ width, height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])

  return size ?? fallback
}

function subscribeResize(onChange: () => void) {
  window.addEventListener('resize', onChange)
  return () => window.removeEventListener('resize', onChange)
}

export function useViewportSize(): Size {
  const width = useSyncExternalStore(subscribeResize, () => window.innerWidth)
  const height = useSyncExternalStore(subscribeResize, () => window.innerHeight)
  return { width, height }
}

function toRect(rect: DOMRect): Rect | null {
  if (rect.width <= 0 || rect.height <= 0) return null
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
}
