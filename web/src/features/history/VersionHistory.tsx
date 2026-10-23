import { useState } from 'react'
import { useDocument } from '../document/DocumentProvider'
import { VersionDetail } from './VersionDetail'
import { VersionTimeline } from './VersionTimeline'
import { useVersions } from './VersionsProvider'

type VersionHistoryProps = {
  getModelLabel?(id: string): string
}

export function VersionHistory({ getModelLabel }: VersionHistoryProps) {
  const { versions, record, restore } = useVersions()
  const { content } = useDocument()
  // null = follow the latest version
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const latest = versions.at(-1) ?? null
  const foundIndex =
    selectedId === null ? -1 : versions.findIndex((version) => version.id === selectedId)
  const selectedIndex = foundIndex === -1 ? versions.length - 1 : foundIndex
  const selected = versions[selectedIndex] ?? null
  const previous = selectedIndex > 0 ? versions[selectedIndex - 1] : null
  const hasUnsavedChanges = latest?.content !== content

  return (
    <section aria-labelledby="version-history-heading" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2
          id="version-history-heading"
          className="text-lg font-semibold text-slate-900 dark:text-slate-100"
        >
          Version history
        </h2>
        <button
          type="button"
          onClick={() => record({ source: 'manual', label: 'Snapshot', content })}
          disabled={!hasUnsavedChanges}
          title={hasUnsavedChanges ? undefined : 'No changes since the last version'}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Save snapshot
        </button>
      </div>
      {selected === null ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No versions yet.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <VersionTimeline
            versions={versions}
            selectedId={selected.id}
            onSelect={setSelectedId}
            getModelLabel={getModelLabel}
          />
          <VersionDetail
            key={selected.id}
            version={selected}
            previous={previous}
            isLatest={selected.id === latest?.id}
            onRestore={() => {
              restore(selected.id)
              setSelectedId(null)
            }}
          />
        </div>
      )}
    </section>
  )
}
