import { useCallback } from 'react'
import { useModels } from '../ai/ModelProvider'
import { useDocument } from '../document/DocumentProvider'
import { useSuggestion } from '../suggestions/SuggestionProvider'
import { resolvePresetTarget, type AiPreset } from './presets'

export function useRunPreset() {
  const { content, selection } = useDocument()
  const { selectedModel, status } = useModels()
  const { isBusy, start } = useSuggestion()
  const canRun = !isBusy && status === 'ready' && selectedModel !== null

  const runPreset = useCallback(
    (preset: AiPreset) => {
      if (!canRun) return
      start({
        instruction: preset.instruction,
        target: resolvePresetTarget(preset, content, selection),
      })
    },
    [canRun, content, selection, start],
  )

  const runPresetAt = useCallback(
    (preset: AiPreset, cursor: number) => {
      if (!canRun) return
      start({
        instruction: preset.instruction,
        target: resolvePresetTarget(preset, content, { from: cursor, to: cursor }),
      })
    },
    [canRun, content, start],
  )

  return { canRun, runPreset, runPresetAt }
}
