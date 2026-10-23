import { useEffect, useState } from 'react'
import { formatRelativeTime } from './relativeTime'
import type { Version, VersionSource } from './types'

type VersionTimelineProps = {
  versions: Version[]
  selectedId: string | null
  onSelect(id: string): void
  getModelLabel?(id: string): string
  now?: number
}

const SOURCE_LABEL: Record<VersionSource, string> = {
  initial: 'Initial',
  manual: 'Manual',
  ai: 'AI',
  restore: 'Restore',
}

const SOURCE_CLASS: Record<VersionSource, string> = {
  initial: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  manual: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  ai: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200',
  restore: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
}

const identity = (id: string) => id

/** Current time, refreshed every `intervalMs` so relative timestamps stay accurate. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

export function VersionTimeline({
  versions,
  selectedId,
  onSelect,
  getModelLabel = identity,
  now: nowOverride,
}: VersionTimelineProps) {
  const liveNow = useNow(60_000)
  const now = nowOverride ?? liveNow
  const newestFirst = [...versions].reverse()
  return (
    <ol aria-label="Versions" className="flex flex-col gap-1">
      {newestFirst.map((version) => {
        const selected = version.id === selectedId
        return (
          <li key={version.id}>
            <button
              type="button"
              onClick={() => onSelect(version.id)}
              aria-current={selected ? 'true' : undefined}
              className={`w-full rounded-md border px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 ${
                selected
                  ? 'border-sky-400 bg-sky-50 dark:border-sky-500 dark:bg-sky-950/40'
                  : 'border-transparent hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <span className="flex items-center gap-2">
                <span
                  className={`rounded px-1.5 py-0.5 text-xs font-medium ${SOURCE_CLASS[version.source]}`}
                >
                  {SOURCE_LABEL[version.source]}
                </span>
                <time
                  dateTime={new Date(version.createdAt).toISOString()}
                  className="text-xs text-slate-500 dark:text-slate-400"
                >
                  {formatRelativeTime(version.createdAt, now)}
                </time>
              </span>
              <span className="mt-1 block truncate text-sm text-slate-900 dark:text-slate-100">
                {version.label}
              </span>
              {version.model && (
                <span className="block text-xs text-slate-500 dark:text-slate-400">
                  {getModelLabel(version.model)}
                </span>
              )}
            </button>
          </li>
        )
      })}
    </ol>
  )
}
