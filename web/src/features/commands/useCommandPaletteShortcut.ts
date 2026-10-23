import { useEffect } from 'react'

export function useCommandPaletteShortcut(onToggle: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return
    const handler = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'k'
      ) {
        event.preventDefault()
        onToggle()
      }
    }
    // Capture phase so CodeMirror and inputs can't swallow the shortcut.
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [onToggle, enabled])
}
