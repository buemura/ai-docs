import { diffWordsWithSpace } from 'diff'
import { useState, type ReactNode } from 'react'
import { splitLines } from './diff'
import type { DiffSegment, Hunk, HunkStatus } from './types'

export type SplitDiffViewProps = {
  segments: DiffSegment[]
  readOnly?: boolean
  onSetHunkStatus?(hunkId: string, status: HunkStatus): void
  contextLines?: number
}

type Row =
  | { kind: 'context'; key: string; oldNo: number; newNo: number; text: string }
  | { kind: 'collapsed'; key: string; segmentIndex: number; count: number }
  | { kind: 'hunk'; key: string; hunk: Hunk; index: number }
  | {
      kind: 'change'
      key: string
      hunk: Hunk
      oldNo: number | null
      oldLine: string | null
      newNo: number | null
      newLine: string | null
    }

function buildRows(segments: DiffSegment[], expanded: Set<number>, contextLines: number): Row[] {
  const rows: Row[] = []
  let hunkIndex = 0

  segments.forEach((segment, segmentIndex) => {
    if (segment.kind === 'equal') {
      const lines = splitLines(segment.text)
      const head = segmentIndex === 0 ? 0 : contextLines
      const tail = segmentIndex === segments.length - 1 ? 0 : contextLines
      const hidden = lines.length - head - tail
      const pushLine = (i: number) =>
        rows.push({
          kind: 'context',
          key: `e${segmentIndex}-${i}`,
          oldNo: segment.oldStartLine + i,
          newNo: segment.newStartLine + i,
          text: lines[i] ?? '',
        })

      if (expanded.has(segmentIndex) || hidden <= 1) {
        lines.forEach((_, i) => pushLine(i))
        return
      }
      for (let i = 0; i < head; i++) pushLine(i)
      rows.push({ kind: 'collapsed', key: `c${segmentIndex}`, segmentIndex, count: hidden })
      for (let i = lines.length - tail; i < lines.length; i++) pushLine(i)
      return
    }

    hunkIndex += 1
    const { hunk } = segment
    rows.push({ kind: 'hunk', key: `h-${hunk.id}`, hunk, index: hunkIndex })
    const oldLines = splitLines(hunk.oldText)
    const newLines = splitLines(hunk.newText)
    const count = Math.max(oldLines.length, newLines.length)
    for (let i = 0; i < count; i++) {
      const hasOld = i < oldLines.length
      const hasNew = i < newLines.length
      rows.push({
        kind: 'change',
        key: `${hunk.id}-${i}`,
        hunk,
        oldNo: hasOld ? hunk.oldStartLine + i : null,
        oldLine: hasOld ? (oldLines[i] ?? '') : null,
        newNo: hasNew ? hunk.newStartLine + i : null,
        newLine: hasNew ? (newLines[i] ?? '') : null,
      })
    }
  })
  return rows
}

function renderWords(oldLine: string, newLine: string, side: 'old' | 'new'): ReactNode {
  return diffWordsWithSpace(oldLine, newLine).map((part, i) => {
    if (part.added) {
      return side === 'new' ? (
        <ins key={i} className="rounded-sm bg-green-300/70 no-underline dark:bg-green-700/70">
          {part.value}
        </ins>
      ) : null
    }
    if (part.removed) {
      return side === 'old' ? (
        <del key={i} className="rounded-sm bg-red-300/70 no-underline dark:bg-red-700/70">
          {part.value}
        </del>
      ) : null
    }
    return <span key={i}>{part.value}</span>
  })
}

const numberCell =
  'select-none px-2 text-right align-top text-xs text-slate-400 dark:text-slate-500'
const textCell = 'whitespace-pre-wrap break-words px-2 align-top'
const statusLabel: Record<HunkStatus, string> = {
  pending: '',
  accepted: 'Accepted',
  rejected: 'Rejected',
}

export function SplitDiffView({
  segments,
  readOnly = false,
  onSetHunkStatus,
  contextLines = 3,
}: SplitDiffViewProps) {
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set())
  const rows = buildRows(segments, expanded, contextLines)

  const expand = (segmentIndex: number) =>
    setExpanded((previous) => new Set(previous).add(segmentIndex))

  return (
    <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
      <table className="w-full table-fixed border-collapse font-mono text-sm">
        <colgroup>
          <col className="w-12" />
          <col />
          <col className="w-12" />
          <col />
        </colgroup>
        <thead>
          <tr className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <th colSpan={2} scope="colgroup" className="px-3 py-2">
              Before
            </th>
            <th
              colSpan={2}
              scope="colgroup"
              className="border-l border-slate-200 px-3 py-2 dark:border-slate-700"
            >
              After
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            switch (row.kind) {
              case 'context':
                return (
                  <tr key={row.key}>
                    <td className={numberCell}>{row.oldNo}</td>
                    <td className={textCell}>{row.text || ' '}</td>
                    <td className={`${numberCell} border-l border-slate-200 dark:border-slate-700`}>
                      {row.newNo}
                    </td>
                    <td className={textCell}>{row.text || ' '}</td>
                  </tr>
                )
              case 'collapsed':
                return (
                  <tr key={row.key} className="bg-slate-50 dark:bg-slate-900">
                    <td colSpan={4} className="px-3 py-1">
                      <button
                        type="button"
                        onClick={() => expand(row.segmentIndex)}
                        className="text-xs text-sky-700 hover:underline focus-visible:outline-2 focus-visible:outline-sky-500 dark:text-sky-400"
                      >
                        Show {row.count} unchanged lines
                      </button>
                    </td>
                  </tr>
                )
              case 'hunk':
                return (
                  <tr
                    key={row.key}
                    className="border-t border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800"
                  >
                    <td colSpan={4} className="px-3 py-1">
                      <div className="flex items-center gap-2 font-sans text-xs">
                        <span className="font-semibold">Change {row.index}</span>
                        {!readOnly && row.hunk.status !== 'pending' && (
                          <span
                            className={
                              row.hunk.status === 'accepted'
                                ? 'rounded bg-green-100 px-1.5 py-0.5 text-green-800 dark:bg-green-900 dark:text-green-200'
                                : 'rounded bg-slate-200 px-1.5 py-0.5 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
                            }
                          >
                            {statusLabel[row.hunk.status]}
                          </span>
                        )}
                        {!readOnly && (
                          <div className="ml-auto flex gap-1">
                            <button
                              type="button"
                              aria-label={`Accept change ${row.index}`}
                              aria-pressed={row.hunk.status === 'accepted'}
                              onClick={() => onSetHunkStatus?.(row.hunk.id, 'accepted')}
                              className="rounded border border-green-600 px-2 py-0.5 text-green-700 hover:bg-green-50 aria-pressed:bg-green-600 aria-pressed:text-white dark:text-green-300 dark:hover:bg-green-950"
                            >
                              Accept
                            </button>
                            <button
                              type="button"
                              aria-label={`Reject change ${row.index}`}
                              aria-pressed={row.hunk.status === 'rejected'}
                              onClick={() => onSetHunkStatus?.(row.hunk.id, 'rejected')}
                              className="rounded border border-slate-400 px-2 py-0.5 text-slate-700 hover:bg-slate-200 aria-pressed:bg-slate-600 aria-pressed:text-white dark:text-slate-200 dark:hover:bg-slate-700"
                            >
                              Reject
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              case 'change': {
                const paired = row.oldLine !== null && row.newLine !== null
                const dimOld = row.hunk.status === 'accepted' ? ' opacity-60' : ''
                const dimNew = row.hunk.status === 'rejected' ? ' opacity-50 line-through' : ''
                const oldBg =
                  row.oldLine !== null
                    ? 'bg-red-50 dark:bg-red-950/40'
                    : 'bg-slate-50 dark:bg-slate-900'
                const newBg =
                  row.newLine !== null
                    ? 'bg-green-50 dark:bg-green-950/40'
                    : 'bg-slate-50 dark:bg-slate-900'
                return (
                  <tr key={row.key}>
                    <td
                      className={`${numberCell} ${row.oldLine !== null ? 'bg-red-50 dark:bg-red-950/40' : ''}`}
                    >
                      {row.oldNo}
                    </td>
                    <td className={`${textCell}${dimOld} ${oldBg}`}>
                      {row.oldLine === null
                        ? ' '
                        : paired
                          ? renderWords(row.oldLine, row.newLine ?? '', 'old')
                          : row.oldLine || ' '}
                    </td>
                    <td
                      className={`${numberCell} border-l border-slate-200 dark:border-slate-700 ${row.newLine !== null ? 'bg-green-50 dark:bg-green-950/40' : ''}`}
                    >
                      {row.newNo}
                    </td>
                    <td className={`${textCell}${dimNew} ${newBg}`}>
                      {row.newLine === null
                        ? ' '
                        : paired
                          ? renderWords(row.oldLine ?? '', row.newLine, 'new')
                          : row.newLine || ' '}
                    </td>
                  </tr>
                )
              }
            }
          })}
        </tbody>
      </table>
    </div>
  )
}
