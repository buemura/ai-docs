import { useEffect, type RefObject } from 'react'

// Focus on the next macrotask so we run after Radix's dialog focus-restore when the palette closes.
export function useFocusRequest(
  ref: RefObject<HTMLElement | null>,
  requested: boolean,
  onHandled?: () => void,
) {
  useEffect(() => {
    if (!requested) return
    const id = window.setTimeout(() => {
      ref.current?.focus()
      onHandled?.()
    }, 0)
    return () => window.clearTimeout(id)
  }, [ref, requested, onHandled])
}
