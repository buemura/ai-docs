import { useCallback } from 'react'
import { useModels } from '../ai/ModelProvider'
import { SuggestionPanel } from '../suggestions/SuggestionPanel'
import { VersionHistory } from './VersionHistory'

export function AiReviewTab() {
  const { models } = useModels()
  const getModelLabel = useCallback(
    (id: string) => models.find((model) => model.id === id)?.label ?? id,
    [models],
  )

  return (
    <div className="flex flex-col gap-4 pb-8">
      <SuggestionPanel />
      <div className="px-4">
        <VersionHistory getModelLabel={getModelLabel} />
      </div>
    </div>
  )
}
