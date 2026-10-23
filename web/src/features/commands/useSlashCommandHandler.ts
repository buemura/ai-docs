import { useCallback, useEffect, useRef, useState } from 'react'
import type { AiPreset } from './presets'
import type { SlashSelection } from './slashCommands'

type Options = {
  content: string
  runPresetAt(preset: AiPreset, cursor: number): void
  onAsk(): void
}

export function useSlashCommandHandler({ content, runPresetAt, onAsk }: Options) {
  const pendingRef = useRef<SlashSelection | null>(null)
  const [, setTick] = useState(0)

  // Runs after every render; fires the pending command once React state matches the editor.
  useEffect(() => {
    const pending = pendingRef.current
    if (!pending || pending.content !== content) return
    pendingRef.current = null
    if (pending.kind === 'ask') onAsk()
    else runPresetAt(pending.preset, pending.cursor)
  })

  return useCallback((selection: SlashSelection) => {
    pendingRef.current = selection
    setTick((tick) => tick + 1)
  }, [])
}
