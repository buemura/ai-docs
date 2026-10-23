import { useCallback, type ReactNode } from 'react'
import { SuggestionProvider } from '../suggestions/SuggestionProvider'
import type { ResolvedSuggestion } from '../suggestions/types'
import { versionsForResolution } from './versionsReducer'
import { useVersions } from './VersionsProvider'

type SuggestionBridgeProps = {
  children: ReactNode
  onStart?: () => void
}

export function SuggestionBridge({ children, onStart }: SuggestionBridgeProps) {
  const { versions, record } = useVersions()
  const latestContent = versions.at(-1)?.content ?? null

  const handleResolved = useCallback(
    (resolved: ResolvedSuggestion) => {
      for (const entry of versionsForResolution(resolved, latestContent)) record(entry)
    },
    [latestContent, record],
  )

  return (
    <SuggestionProvider onResolved={handleResolved} onStart={onStart}>
      {children}
    </SuggestionProvider>
  )
}
