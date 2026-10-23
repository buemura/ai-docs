import { useMemo } from 'react'
import { computeSegments } from '../suggestions/diff'
import { SplitDiffView } from '../suggestions/SplitDiffView'
import type { Version } from './types'

type VersionDetailProps = {
  version: Version
  previous: Version | null
  isLatest: boolean
  onRestore(): void
}

export function VersionDetail({ version, previous, isLatest, onRestore }: VersionDetailProps) {
  const previousContent = previous?.content ?? ''
  const segments = useMemo(
    () => computeSegments(previousContent, version.content),
    [previousContent, version.content],
  )
  const hasChanges = segments.some((segment) => segment.kind === 'change')

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-slate-900 dark:text-slate-100">
            {version.label}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {previous ? 'Compared with the previous version' : 'Compared with an empty document'}
          </p>
        </div>
        <button
          type="button"
          onClick={onRestore}
          disabled={isLatest}
          title={isLatest ? 'This is the current version' : undefined}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Restore this version
        </button>
      </div>
      {hasChanges ? (
        <SplitDiffView segments={segments} readOnly />
      ) : (
        <p className="text-sm text-slate-500 dark:text-slate-400">No changes</p>
      )}
    </div>
  )
}
