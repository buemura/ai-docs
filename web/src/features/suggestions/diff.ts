import { diffLines } from 'diff'
import type { DiffSegment, Hunk, HunkStatus } from './types'

export function countLines(text: string): number {
  if (text === '') return 0
  const newlines = text.split('\n').length - 1
  return text.endsWith('\n') ? newlines : newlines + 1
}

export function splitLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split('\n')
  if (text.endsWith('\n')) lines.pop()
  return lines
}

type PendingHunk = Omit<Hunk, 'id' | 'status'>

export function computeSegments(oldText: string, newText: string): DiffSegment[] {
  const segments: DiffSegment[] = []
  let oldLine = 1
  let newLine = 1
  let hunkCount = 0
  let pending: PendingHunk | null = null

  const flush = () => {
    if (!pending) return
    hunkCount += 1
    segments.push({
      kind: 'change',
      hunk: { ...pending, id: `hunk-${hunkCount}`, status: 'pending' },
    })
    pending = null
  }

  for (const change of diffLines(oldText, newText)) {
    const lines = countLines(change.value)
    if (change.added || change.removed) {
      pending ??= { oldText: '', newText: '', oldStartLine: oldLine, newStartLine: newLine }
      if (change.removed) {
        pending.oldText += change.value
        oldLine += lines
      } else {
        pending.newText += change.value
        newLine += lines
      }
    } else {
      flush()
      segments.push({
        kind: 'equal',
        text: change.value,
        oldStartLine: oldLine,
        newStartLine: newLine,
      })
      oldLine += lines
      newLine += lines
    }
  }
  flush()
  return segments
}

export function applySegments(segments: DiffSegment[]): string {
  return segments
    .map((segment) => {
      if (segment.kind === 'equal') return segment.text
      return segment.hunk.status === 'accepted' ? segment.hunk.newText : segment.hunk.oldText
    })
    .join('')
}

export function getHunks(segments: DiffSegment[]): Hunk[] {
  return segments.flatMap((segment) => (segment.kind === 'change' ? [segment.hunk] : []))
}

export function setHunkStatuses(
  segments: DiffSegment[],
  hunkIds: readonly string[],
  status: HunkStatus,
): DiffSegment[] {
  const ids = new Set(hunkIds)
  return segments.map((segment) =>
    segment.kind === 'change' && ids.has(segment.hunk.id)
      ? { kind: 'change', hunk: { ...segment.hunk, status } }
      : segment,
  )
}

export function countByStatus(segments: DiffSegment[]): Record<HunkStatus, number> {
  const counts: Record<HunkStatus, number> = { pending: 0, accepted: 0, rejected: 0 }
  for (const hunk of getHunks(segments)) counts[hunk.status] += 1
  return counts
}
