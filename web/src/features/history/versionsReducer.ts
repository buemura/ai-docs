import type { ResolvedSuggestion } from '../suggestions/types'
import { MAX_VERSIONS, QUOTA_FALLBACK_KEEP, type Version, type VersionInput } from './types'

export type VersionsAction = { type: 'record'; version: Version }

export function appendVersion(
  versions: Version[],
  version: Version,
  max = MAX_VERSIONS,
): Version[] {
  const latest = versions.at(-1)
  if (latest && latest.content === version.content) return versions
  const next = [...versions, version]
  return next.length > max ? next.slice(next.length - max) : next
}

export function versionsReducer(state: Version[], action: VersionsAction): Version[] {
  switch (action.type) {
    case 'record':
      return appendVersion(state, action.version)
  }
}

export function trimForQuota(versions: Version[], keep = QUOTA_FALLBACK_KEEP): Version[] {
  return versions.slice(-keep)
}

export function versionsForResolution(
  resolved: ResolvedSuggestion,
  latestContent: string | null,
): VersionInput[] {
  const entries: VersionInput[] = []
  if (resolved.contentBefore !== latestContent) {
    entries.push({ source: 'manual', label: 'Manual edits', content: resolved.contentBefore })
  }
  const label = [...resolved.history.map((turn) => turn.instruction), resolved.instruction].join(
    ' → ',
  )
  entries.push({ source: 'ai', label, model: resolved.model, content: resolved.contentAfter })
  return entries
}
