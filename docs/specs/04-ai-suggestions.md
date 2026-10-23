# Phase 4 — AI Suggestions & Diff Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user ask the AI to edit the selection or the whole document, watch the proposal stream in, review it as a GitHub-style split diff, and accept/reject each hunk (or all), refine it, or discard it.

**Architecture:** A thin API layer (`features/ai`) talks to the phase 3 backend: Zod-validated `GET /api/models` and an SSE reader for `POST /api/suggestions`. A `ModelProvider` holds the model catalog and the persisted selection. A pure reducer (`features/suggestions/suggestionReducer.ts`) owns the active suggestion's state machine (`streaming → reviewing | error`). `SuggestionProvider` runs the stream and applies hunk decisions to the document. Each decision recomputes the region text from the diff segments, finds the region in the current document, and replaces it. The UI is an `AskAiBar` above the editor, a `SplitDiffView` that phase 5 reuses read-only, and a `SuggestionPanel` in the AI Review tab.

**Tech Stack:** React 19, TypeScript (strict), Tailwind CSS v4, Zod v4, `diff` (jsdiff), Vitest + Testing Library + user-event, pnpm.

**Spec:** [docs/specs/00-overview.md](00-overview.md). Read its "Frontend contract", "Backend contract → Endpoints" and "UX notes" sections before starting.

## Global Constraints

- Node 24, pnpm, React 19, TypeScript strict, Tailwind v4 class-based dark mode (`dark:` variants), Zod v4.
- Every value read from the network or `localStorage` is Zod-validated. Use `loadJson` / `saveJson` from `src/lib/storage.ts`.
- localStorage key for the selected model: `ai-docs:model` (a JSON string).
- API base URL comes from `env.VITE_API_BASE_URL` (`src/env.ts`, default `/api`, trailing slashes already stripped).
- SSE events: `delta {"text"}`, `done {"stop_reason"}`, `error {"code","message"}`. Exactly one terminal event per stream. On `error`, discard streamed text.
- Request body: `{ model, document, selection: {start,end} | null, instruction, history: [{instruction, proposal}] }`. Offsets are UTF-16 (JS string indices).
- Non-2xx response → one `{ type: 'error', code: 'http_<status>' }` event. Network failure that isn't an abort → `network_error`. An abort yields nothing.
- Only one suggestion at a time. Triggers are disabled while a suggestion exists.
- Refine is allowed only while no hunk of the current suggestion is `accepted`.
- The AI never edits the document directly. Text changes only through accept decisions.
- Hunk buttons have accessible names `Accept change N` / `Reject change N` (1-based, in document order).
- No real network in tests. Mock `fetch` with `ReadableStream` bodies (helpers in `src/test/sse.ts`).
- Phase 2 facts this plan relies on: `TextRange` is exported from `features/document/schema.ts`; `DocumentProvider` and `useDocument` come from `features/document/DocumentProvider.tsx`; `replaceRange` collapses the selection to the end of the inserted text; `AppHeader` renders `children` before `ThemeToggle`; `Tabs` takes `badges`; `App.tsx` default-exports `App` and defines `AppShell`; colors use the `slate` palette. A hook colocated with its provider gets `// eslint-disable-next-line react-refresh/only-export-components -- hook is colocated with its provider`.
- Commands run from the repo root. Single test files run with `pnpm --dir web exec vitest run <path relative to web/>`.
- Commit after every task with Conventional Commits.

## File structure

```
web/src/
  test/sse.ts                              # fetch/SSE mocking helpers (Task 3)
  test/renderWithAi.tsx                    # provider harness + tiny driver components (Task 7)
  test/setup.ts                            # Modify: default fetch stub (Task 3)
  features/ai/
    schemas.ts       Zod schemas + ModelInfo, ModelsResponse, SuggestionRequestBody, StreamEvent
    sse.ts           parseSse(stream) → AsyncGenerator<{event, data}>
    api.ts           fetchModels, streamSuggestion
    ModelProvider.tsx ModelProvider, useModels, MODEL_STORAGE_KEY
    ModelSelect.tsx  header dropdown
  features/suggestions/
    types.ts         Hunk, DiffSegment, Suggestion, … (from the overview)
    diff.ts          computeSegments, applySegments, countByStatus, getHunks, setHunkStatuses, splitLines, countLines
    normalize.ts     normalizeProposal
    locateRegion.ts  locateRegion, resolveTarget
    suggestionReducer.ts  pure state machine
    SuggestionProvider.tsx SuggestionProvider, useSuggestion
    SplitDiffView.tsx before/after table (reused read-only in phase 5)
    AskAiBar.tsx     instruction input + Suggest
    SuggestionPanel.tsx AI Review tab content
  App.tsx            Modify: providers + panels
```

---

### Task 1: Suggestion types and diff engine

**Files:**
- Create: `web/src/features/suggestions/types.ts`
- Create: `web/src/features/suggestions/diff.ts`
- Test: `web/src/features/suggestions/diff.test.ts`
- Modify: `web/package.json` (adds `diff`, via pnpm)

**Interfaces:**
- Consumes: `TextRange` from `features/document/schema.ts` (phase 2).
- Produces:
  ```ts
  // types.ts — exactly as the overview, plus re-export of TextRange
  export type { TextRange }
  export type HunkStatus = 'pending' | 'accepted' | 'rejected'
  export type Hunk = { id: string; oldText: string; newText: string; oldStartLine: number; newStartLine: number; status: HunkStatus }
  export type DiffSegment = { kind: 'equal'; text: string; oldStartLine: number; newStartLine: number } | { kind: 'change'; hunk: Hunk }
  export type SuggestionScope, RefineTurn, SuggestionStatus, Suggestion, SuggestionTarget, StartSuggestionInput, ResolvedSuggestion
  // diff.ts
  export function countLines(text: string): number
  export function splitLines(text: string): string[]           // trailing "\n" does not produce an empty last line
  export function computeSegments(oldText: string, newText: string): DiffSegment[]   // hunk ids "hunk-1", "hunk-2", … in order
  export function applySegments(segments: DiffSegment[]): string
  export function getHunks(segments: DiffSegment[]): Hunk[]
  export function setHunkStatuses(segments: DiffSegment[], hunkIds: readonly string[], status: HunkStatus): DiffSegment[] // immutable
  export function countByStatus(segments: DiffSegment[]): Record<HunkStatus, number>
  ```

- [ ] **Step 1: Add the dependency**

Run: `pnpm --dir web add diff`
Then run: `pnpm --dir web list diff`
Expected: `diff 8.x` (v8 ships its own types). If a version below 8 is installed, also run `pnpm --dir web add -D @types/diff`.

- [ ] **Step 2: Write the types**

`web/src/features/suggestions/types.ts`:
```ts
import type { TextRange } from '../document/schema'

export type { TextRange }

export type HunkStatus = 'pending' | 'accepted' | 'rejected'

export type Hunk = {
  id: string
  oldText: string
  newText: string
  oldStartLine: number
  newStartLine: number
  status: HunkStatus
}

export type DiffSegment =
  | { kind: 'equal'; text: string; oldStartLine: number; newStartLine: number }
  | { kind: 'change'; hunk: Hunk }

export type SuggestionScope = { kind: 'document' } | { kind: 'selection'; range: TextRange }

export type RefineTurn = { instruction: string; proposal: string }

export type SuggestionStatus = 'streaming' | 'reviewing' | 'error'

export type Suggestion = {
  id: string
  status: SuggestionStatus
  scope: SuggestionScope
  /** Target text when the suggestion was requested. */
  baseText: string
  /** The current turn's instruction. */
  instruction: string
  model: string
  /** Streamed text while streaming; normalized proposal once reviewing. */
  proposedText: string
  /** Empty until reviewing. */
  segments: DiffSegment[]
  /** Previous turns, oldest first (sent to the backend on refine). */
  history: RefineTurn[]
  stale: boolean
  error: { code: string; message: string } | null
  contentBeforeFirstAccept: string | null
}

export type SuggestionTarget = 'auto' | 'document' | TextRange

export type StartSuggestionInput = { instruction: string; target: SuggestionTarget }

export type ResolvedSuggestion = {
  instruction: string
  history: RefineTurn[]
  model: string
  contentBefore: string
  contentAfter: string
  acceptedCount: number
  totalCount: number
}
```

- [ ] **Step 3: Write the failing test**

`web/src/features/suggestions/diff.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import {
  applySegments,
  computeSegments,
  countByStatus,
  countLines,
  getHunks,
  setHunkStatuses,
  splitLines,
} from './diff'

describe('countLines / splitLines', () => {
  it('counts lines with and without a trailing newline', () => {
    expect(countLines('')).toBe(0)
    expect(countLines('a')).toBe(1)
    expect(countLines('a\n')).toBe(1)
    expect(countLines('a\nb')).toBe(2)
    expect(countLines('a\nb\n')).toBe(2)
    expect(countLines('\n')).toBe(1)
  })

  it('splits lines without an empty trailing entry', () => {
    expect(splitLines('')).toEqual([])
    expect(splitLines('a\nb\n')).toEqual(['a', 'b'])
    expect(splitLines('a\nb')).toEqual(['a', 'b'])
    expect(splitLines('a\n\nb\n')).toEqual(['a', '', 'b'])
  })
})

describe('computeSegments', () => {
  it('returns only equal segments for identical text', () => {
    const segments = computeSegments('a\nb\n', 'a\nb\n')
    expect(getHunks(segments)).toHaveLength(0)
    expect(applySegments(segments)).toBe('a\nb\n')
  })

  it('groups a replaced line into one hunk with line numbers', () => {
    expect(computeSegments('a\nb\nc\n', 'a\nB\nc\n')).toEqual([
      { kind: 'equal', text: 'a\n', oldStartLine: 1, newStartLine: 1 },
      {
        kind: 'change',
        hunk: {
          id: 'hunk-1',
          oldText: 'b\n',
          newText: 'B\n',
          oldStartLine: 2,
          newStartLine: 2,
          status: 'pending',
        },
      },
      { kind: 'equal', text: 'c\n', oldStartLine: 3, newStartLine: 3 },
    ])
  })

  it('tracks line numbers across insertions and deletions', () => {
    const hunks = getHunks(computeSegments('a\nb\nc\nd\n', 'a\nx\ny\nb\nd\n'))
    expect(hunks.map((h) => [h.id, h.oldText, h.newText, h.oldStartLine, h.newStartLine])).toEqual([
      ['hunk-1', '', 'x\ny\n', 2, 2],
      ['hunk-2', 'c\n', '', 3, 5],
    ])
  })

  it('handles a last line without a trailing newline', () => {
    const hunks = getHunks(computeSegments('a\nb', 'a\nc'))
    expect(hunks.map((h) => [h.oldText, h.newText])).toEqual([['b', 'c']])
  })

  it('handles an empty original', () => {
    const hunks = getHunks(computeSegments('', 'hello\n'))
    expect(hunks.map((h) => [h.oldText, h.newText, h.oldStartLine, h.newStartLine])).toEqual([
      ['', 'hello\n', 1, 1],
    ])
  })
})

describe('applySegments / setHunkStatuses / countByStatus', () => {
  const segments = computeSegments('one\ntwo\nthree\n', 'ONE\ntwo\nTHREE\n')
  const [first, second] = getHunks(segments)

  it('keeps the original text while hunks are pending', () => {
    expect(applySegments(segments)).toBe('one\ntwo\nthree\n')
  })

  it('applies only accepted hunks', () => {
    const one = setHunkStatuses(segments, [first.id], 'accepted')
    expect(applySegments(one)).toBe('ONE\ntwo\nthree\n')
    const both = setHunkStatuses(one, [second.id], 'accepted')
    expect(applySegments(both)).toBe('ONE\ntwo\nTHREE\n')
    const rejected = setHunkStatuses(both, [second.id], 'rejected')
    expect(applySegments(rejected)).toBe('ONE\ntwo\nthree\n')
  })

  it('does not mutate the input segments', () => {
    setHunkStatuses(segments, [first.id, second.id], 'accepted')
    expect(getHunks(segments).map((h) => h.status)).toEqual(['pending', 'pending'])
  })

  it('counts hunks by status', () => {
    expect(countByStatus(segments)).toEqual({ pending: 2, accepted: 0, rejected: 0 })
    const mixed = setHunkStatuses(setHunkStatuses(segments, [first.id], 'accepted'), [second.id], 'rejected')
    expect(countByStatus(mixed)).toEqual({ pending: 0, accepted: 1, rejected: 1 })
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --dir web exec vitest run src/features/suggestions/diff.test.ts`
Expected: FAIL with `Failed to resolve import "./diff"`.

- [ ] **Step 5: Write the implementation**

`web/src/features/suggestions/diff.ts`:
```ts
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
    segments.push({ kind: 'change', hunk: { ...pending, id: `hunk-${hunkCount}`, status: 'pending' } })
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
      segments.push({ kind: 'equal', text: change.value, oldStartLine: oldLine, newStartLine: newLine })
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
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --dir web exec vitest run src/features/suggestions/diff.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 7: Commit**

```bash
git add web/package.json web/pnpm-lock.yaml web/src/features/suggestions/types.ts web/src/features/suggestions/diff.ts web/src/features/suggestions/diff.test.ts
git commit -m "feat(frontend): add suggestion types and line-diff hunk engine"
```

---

### Task 2: Proposal normalization, region location, target resolution

**Files:**
- Create: `web/src/features/suggestions/normalize.ts`
- Create: `web/src/features/suggestions/locateRegion.ts`
- Test: `web/src/features/suggestions/normalize.test.ts`
- Test: `web/src/features/suggestions/locateRegion.test.ts`

**Interfaces:**
- Consumes: `TextRange`, `SuggestionTarget` from `./types` (Task 1).
- Produces:
  ```ts
  export function normalizeProposal(proposal: string, baseText: string): string
  export function locateRegion(content: string, expected: string, hintFrom: number): TextRange | null
  export function resolveTarget(target: SuggestionTarget, selection: TextRange, contentLength: number): TextRange | null // null = whole document
  ```

- [ ] **Step 1: Write the failing tests**

`web/src/features/suggestions/normalize.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { normalizeProposal } from './normalize'

describe('normalizeProposal', () => {
  it('returns plain proposals unchanged when newline presence matches', () => {
    expect(normalizeProposal('Hello\n', 'Hi\n')).toBe('Hello\n')
    expect(normalizeProposal('Hello', 'Hi')).toBe('Hello')
  })

  it('strips a wrapping markdown fence', () => {
    expect(normalizeProposal('```markdown\nHello\n```', 'Hi\n')).toBe('Hello\n')
    expect(normalizeProposal('```\nHello\nWorld\n```\n', 'Hi\n')).toBe('Hello\nWorld\n')
    expect(normalizeProposal('```md\nHello\n```', 'Hi')).toBe('Hello')
  })

  it('keeps fences when the original text is itself a code block', () => {
    expect(normalizeProposal('```\ny = 2\n```', '```\ny = 1\n```')).toBe('```\ny = 2\n```')
  })

  it('does not strip fences in other languages', () => {
    expect(normalizeProposal('```js\nx\n```', 'Hi')).toBe('```js\nx\n```')
  })

  it('matches the trailing newline of the original', () => {
    expect(normalizeProposal('Hello', 'Hi\n')).toBe('Hello\n')
    expect(normalizeProposal('Hello\n\n', 'Hi')).toBe('Hello')
  })

  it('converts CRLF to LF', () => {
    expect(normalizeProposal('a\r\nb\r\n', 'x\n')).toBe('a\nb\n')
  })
})
```

`web/src/features/suggestions/locateRegion.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { locateRegion, resolveTarget } from './locateRegion'

describe('locateRegion', () => {
  it('matches exactly at the hint', () => {
    expect(locateRegion('xx abc yy', 'abc', 3)).toEqual({ from: 3, to: 6 })
  })

  it('prefers the hint even when the text occurs more than once', () => {
    expect(locateRegion('abc abc', 'abc', 4)).toEqual({ from: 4, to: 7 })
  })

  it('finds a unique occurrence that moved', () => {
    expect(locateRegion('XXabc', 'abc', 0)).toEqual({ from: 2, to: 5 })
  })

  it('returns null for ambiguous or missing text', () => {
    expect(locateRegion('abc abc', 'abc', 1)).toBeNull()
    expect(locateRegion('hello', 'abc', 0)).toBeNull()
  })

  it('handles empty expected text', () => {
    expect(locateRegion('hello', '', 2)).toEqual({ from: 2, to: 2 })
    expect(locateRegion('hello', '', 9)).toBeNull()
  })

  it('ignores a negative hint', () => {
    expect(locateRegion('abc', 'abc', -1)).toEqual({ from: 0, to: 3 })
  })
})

describe('resolveTarget', () => {
  const collapsed = { from: 2, to: 2 }

  it('returns null for the whole document', () => {
    expect(resolveTarget('document', { from: 0, to: 4 }, 10)).toBeNull()
  })

  it('uses the selection for auto, or the document when it is collapsed', () => {
    expect(resolveTarget('auto', { from: 1, to: 4 }, 10)).toEqual({ from: 1, to: 4 })
    expect(resolveTarget('auto', collapsed, 10)).toBeNull()
  })

  it('normalizes reversed ranges and clamps to the content length', () => {
    expect(resolveTarget({ from: 8, to: 3 }, collapsed, 10)).toEqual({ from: 3, to: 8 })
    expect(resolveTarget({ from: 5, to: 50 }, collapsed, 10)).toEqual({ from: 5, to: 10 })
    expect(resolveTarget({ from: 4, to: 4 }, collapsed, 10)).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --dir web exec vitest run src/features/suggestions/normalize.test.ts src/features/suggestions/locateRegion.test.ts`
Expected: FAIL with `Failed to resolve import "./normalize"` and `Failed to resolve import "./locateRegion"`.

- [ ] **Step 3: Write the implementations**

`web/src/features/suggestions/normalize.ts`:
```ts
const WRAPPING_FENCE = /^\s*```(?:markdown|md)?[ \t]*\n([\s\S]*?)\n?```\s*$/

/**
 * Clean up a model proposal before diffing: drop a ```markdown wrapper the
 * model was told not to add, and match the original's trailing newline so the
 * diff doesn't show a spurious last-line change.
 */
export function normalizeProposal(proposal: string, baseText: string): string {
  let text = proposal.replace(/\r\n/g, '\n')
  const fenced = WRAPPING_FENCE.exec(text)
  if (fenced && !baseText.trimStart().startsWith('```')) text = fenced[1] ?? ''

  if (baseText.endsWith('\n')) {
    if (!text.endsWith('\n')) text += '\n'
  } else {
    text = text.replace(/\n+$/, '')
  }
  return text
}
```

`web/src/features/suggestions/locateRegion.ts`:
```ts
import type { SuggestionTarget, TextRange } from './types'

/**
 * Find where `expected` currently sits in `content`: exactly at `hintFrom`,
 * otherwise its single occurrence anywhere. Returns null when the text is
 * gone or ambiguous; the caller then marks the suggestion stale.
 */
export function locateRegion(content: string, expected: string, hintFrom: number): TextRange | null {
  const hint = Math.max(0, hintFrom)
  if (expected === '') return hint <= content.length ? { from: hint, to: hint } : null
  if (content.startsWith(expected, hint)) return { from: hint, to: hint + expected.length }

  const first = content.indexOf(expected)
  if (first === -1) return null
  if (content.indexOf(expected, first + 1) !== -1) return null
  return { from: first, to: first + expected.length }
}

/** Resolve a trigger target into a non-empty range, or null for the whole document. */
export function resolveTarget(
  target: SuggestionTarget,
  selection: TextRange,
  contentLength: number,
): TextRange | null {
  if (target === 'document') return null
  const range = target === 'auto' ? selection : target
  const from = Math.max(0, Math.min(range.from, range.to))
  const to = Math.min(contentLength, Math.max(range.from, range.to))
  return from < to ? { from, to } : null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --dir web exec vitest run src/features/suggestions/normalize.test.ts src/features/suggestions/locateRegion.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/features/suggestions/normalize.ts web/src/features/suggestions/normalize.test.ts web/src/features/suggestions/locateRegion.ts web/src/features/suggestions/locateRegion.test.ts
git commit -m "feat(frontend): add proposal normalization and region location"
```

---

### Task 3: API schemas and SSE parser

**Files:**
- Create: `web/src/features/ai/schemas.ts`
- Create: `web/src/features/ai/sse.ts`
- Create: `web/src/test/sse.ts`
- Modify: `web/src/test/setup.ts` (default fetch stub)
- Test: `web/src/features/ai/sse.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  ```ts
  // schemas.ts
  export const modelInfoSchema, modelsResponseSchema, deltaPayloadSchema, donePayloadSchema, errorPayloadSchema
  export type ModelInfo = { id: string; label: string }
  export type ModelsResponse = { provider: string; default_model: string; models: ModelInfo[] }
  export type SuggestionRequestBody = { model; document; selection: { start; end } | null; instruction; history: { instruction; proposal }[] }
  export type StreamEvent = { type: 'delta'; text } | { type: 'done'; stopReason } | { type: 'error'; code; message }
  // sse.ts
  export type SseMessage = { event: string; data: string }
  export function parseSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<SseMessage>
  // test/sse.ts (test-only)
  export function sseFrame(event: string, data: unknown): string
  export function streamOf(chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array>
  export function sseResponse(frames: string[]): Response
  export function jsonResponse(data: unknown, status?: number): Response
  export function controllableSseResponse(signal?: AbortSignal | null): { response: Response; push(frame: string): void; close(): void }
  export const MODELS_RESPONSE: ModelsResponse
  export function mockApi(handlers: { models?: Handler; suggestions?: Handler }): Mock  // stubs global fetch
  ```

- [ ] **Step 1: Write the schemas**

`web/src/features/ai/schemas.ts`:
```ts
import { z } from 'zod'

export const modelInfoSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
})

export const modelsResponseSchema = z.object({
  provider: z.string(),
  default_model: z.string(),
  models: z.array(modelInfoSchema),
})

export const deltaPayloadSchema = z.object({ text: z.string() })
export const donePayloadSchema = z.object({ stop_reason: z.string() })
export const errorPayloadSchema = z.object({ code: z.string(), message: z.string() })

export type ModelInfo = z.infer<typeof modelInfoSchema>
export type ModelsResponse = z.infer<typeof modelsResponseSchema>

export type SuggestionRequestBody = {
  model: string
  document: string
  selection: { start: number; end: number } | null
  instruction: string
  history: { instruction: string; proposal: string }[]
}

export type StreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; stopReason: string }
  | { type: 'error'; code: string; message: string }
```

- [ ] **Step 2: Write the test helpers**

`web/src/test/sse.ts`:
```ts
import { vi } from 'vitest'
import type { ModelsResponse } from '../features/ai/schemas'

const encoder = new TextEncoder()

export function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export function streamOf(chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk)
      }
      controller.close()
    },
  })
}

export function sseResponse(frames: string[]): Response {
  return new Response(streamOf(frames), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** An SSE response that stays open until `close()`; errors when `signal` aborts. */
export function controllableSseResponse(signal?: AbortSignal | null) {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
  })
  signal?.addEventListener('abort', () => controller?.error(new DOMException('Aborted', 'AbortError')))
  return {
    response: new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    push(frame: string) {
      controller?.enqueue(encoder.encode(frame))
    },
    close() {
      controller?.close()
    },
  }
}

export const MODELS_RESPONSE: ModelsResponse = {
  provider: 'anthropic',
  default_model: 'claude-sonnet-5-5',
  models: [
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
    { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
  ],
}

type Handler = (init: RequestInit | undefined) => Response | Promise<Response>

/** Stub global fetch: /models defaults to MODELS_RESPONSE, /suggestions uses the given handler. */
export function mockApi(handlers: { models?: Handler; suggestions?: Handler } = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/models')) {
      return handlers.models ? handlers.models(init) : jsonResponse(MODELS_RESPONSE)
    }
    if (url.endsWith('/suggestions') && handlers.suggestions) return handlers.suggestions(init)
    throw new TypeError(`Unexpected fetch: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** Parsed JSON bodies of every POST /suggestions call made through a mockApi fetch. */
export function suggestionBodies(fetchMock: ReturnType<typeof mockApi>): unknown[] {
  return fetchMock.mock.calls
    .filter(([input]) => String(input).endsWith('/suggestions'))
    .map(([, init]) => JSON.parse(String(init?.body)))
}
```

- [ ] **Step 3: Stub fetch by default in the test setup**

Append to `web/src/test/setup.ts` (keep the existing content). Add `beforeEach` and `vi` to the existing `vitest` import if they aren't already imported:
```ts
import { beforeEach, vi } from 'vitest'

// No test may hit the network. Tests that need the API call mockApi() from ./sse.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('fetch is not mocked in this test'))),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})
```
If `afterEach` isn't imported in the file yet, add it to the same import.

- [ ] **Step 4: Write the failing parser test**

`web/src/features/ai/sse.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { streamOf } from '../../test/sse'
import { parseSse, type SseMessage } from './sse'

async function collect(chunks: (string | Uint8Array)[]): Promise<SseMessage[]> {
  const messages: SseMessage[] = []
  for await (const message of parseSse(streamOf(chunks))) messages.push(message)
  return messages
}

describe('parseSse', () => {
  it('parses complete frames', async () => {
    expect(
      await collect(['event: delta\ndata: {"text":"hi"}\n\nevent: done\ndata: {}\n\n']),
    ).toEqual([
      { event: 'delta', data: '{"text":"hi"}' },
      { event: 'done', data: '{}' },
    ])
  })

  it('reassembles frames split at every character', async () => {
    const frame = 'event: delta\ndata: {"text":"hi"}\n\n'
    expect(await collect([...frame])).toEqual([{ event: 'delta', data: '{"text":"hi"}' }])
  })

  it('accepts CRLF line endings, including a CR and LF split across chunks', async () => {
    expect(await collect(['event: delta\r', '\ndata: x\r\n\r', '\n'])).toEqual([
      { event: 'delta', data: 'x' },
    ])
  })

  it('joins multi-line data with newlines', async () => {
    expect(await collect(['data: one\ndata: two\n\n'])).toEqual([
      { event: 'message', data: 'one\ntwo' },
    ])
  })

  it('ignores comments and frames without data', async () => {
    expect(await collect([': keep-alive\n\nevent: ping\n\ndata: x\n\n'])).toEqual([
      { event: 'message', data: 'x' },
    ])
  })

  it('decodes multi-byte characters split across chunks', async () => {
    const bytes = new TextEncoder().encode('data: é\n\n')
    expect(await collect([bytes.slice(0, 7), bytes.slice(7)])).toEqual([
      { event: 'message', data: 'é' },
    ])
  })

  it('discards an unterminated frame at the end of the stream', async () => {
    expect(await collect(['data: complete\n\ndata: partial'])).toEqual([
      { event: 'message', data: 'complete' },
    ])
  })
})
```

- [ ] **Step 5: Run test to verify it fails**

Run: `pnpm --dir web exec vitest run src/features/ai/sse.test.ts`
Expected: FAIL with `Failed to resolve import "./sse"`.

- [ ] **Step 6: Write the parser**

`web/src/features/ai/sse.ts`:
```ts
export type SseMessage = { event: string; data: string }

const LINE_BREAK = /\r\n|\r|\n/

/** Minimal Server-Sent Events parser over a fetch response body. */
export async function* parseSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<SseMessage> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let eventName = ''
  let dataLines: string[] = []

  const processLine = (line: string): SseMessage | null => {
    if (line === '') {
      const message =
        dataLines.length > 0 ? { event: eventName || 'message', data: dataLines.join('\n') } : null
      eventName = ''
      dataLines = []
      return message
    }
    if (line.startsWith(':')) return null
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') eventName = value
    else if (field === 'data') dataLines.push(value)
    return null
  }

  try {
    for (;;) {
      const { value, done } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      for (;;) {
        const match = LINE_BREAK.exec(buffer)
        if (!match) break
        // A trailing "\r" may be the first half of "\r\n": wait for the next chunk.
        if (!done && match[0] === '\r' && match.index === buffer.length - 1) break
        const line = buffer.slice(0, match.index)
        buffer = buffer.slice(match.index + match[0].length)
        const message = processLine(line)
        if (message) yield message
      }
      if (done) return
    }
  } finally {
    reader.releaseLock()
  }
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm --dir web exec vitest run src/features/ai/sse.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 8: Run the whole suite to confirm the fetch stub breaks nothing**

Run: `pnpm --dir web test`
Expected: all test files PASS.

- [ ] **Step 9: Commit**

```bash
git add web/src/features/ai/schemas.ts web/src/features/ai/sse.ts web/src/features/ai/sse.test.ts web/src/test/sse.ts web/src/test/setup.ts
git commit -m "feat(frontend): add AI API schemas and SSE stream parser"
```

---

### Task 4: API client (`fetchModels`, `streamSuggestion`)

**Files:**
- Create: `web/src/features/ai/api.ts`
- Test: `web/src/features/ai/api.test.ts`

**Interfaces:**
- Consumes: `env` from `src/env.ts` (phase 1); schemas and `parseSse` (Task 3).
- Produces:
  ```ts
  export async function fetchModels(signal?: AbortSignal): Promise<ModelsResponse>   // throws on non-2xx or invalid shape
  export function streamSuggestion(body: SuggestionRequestBody, signal: AbortSignal): AsyncGenerator<StreamEvent>
  // Ends after the first done/error event. Error codes it creates itself: http_<status>, network_error,
  // invalid_event, stream_incomplete. An abort yields nothing.
  ```

- [ ] **Step 1: Write the failing test**

`web/src/features/ai/api.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest'
import { MODELS_RESPONSE, jsonResponse, sseFrame, sseResponse } from '../../test/sse'
import { fetchModels, streamSuggestion } from './api'
import type { StreamEvent, SuggestionRequestBody } from './schemas'

const body: SuggestionRequestBody = {
  model: 'claude-sonnet-5-5',
  document: 'Hello',
  selection: null,
  instruction: 'Improve',
  history: [],
}

async function collect(signal: AbortSignal = new AbortController().signal): Promise<StreamEvent[]> {
  const events: StreamEvent[] = []
  for await (const event of streamSuggestion(body, signal)) events.push(event)
  return events
}

function stubFetch(impl: () => Promise<Response>) {
  const fetchMock = vi.fn(impl)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('fetchModels', () => {
  it('returns the validated catalog', async () => {
    const fetchMock = stubFetch(async () => jsonResponse(MODELS_RESPONSE))
    await expect(fetchModels()).resolves.toEqual(MODELS_RESPONSE)
    expect(fetchMock).toHaveBeenCalledWith('/api/models', expect.anything())
  })

  it('throws on HTTP errors', async () => {
    stubFetch(async () => jsonResponse({ detail: 'boom' }, 500))
    await expect(fetchModels()).rejects.toThrow('HTTP 500')
  })

  it('throws on an invalid payload', async () => {
    stubFetch(async () => jsonResponse({ models: 'nope' }))
    await expect(fetchModels()).rejects.toThrow()
  })
})

describe('streamSuggestion', () => {
  it('posts the body and yields deltas then done', async () => {
    const fetchMock = stubFetch(async () =>
      sseResponse([
        sseFrame('delta', { text: 'Hel' }),
        sseFrame('delta', { text: 'lo!' }),
        sseFrame('done', { stop_reason: 'end_turn' }),
      ]),
    )
    expect(await collect()).toEqual([
      { type: 'delta', text: 'Hel' },
      { type: 'delta', text: 'lo!' },
      { type: 'done', stopReason: 'end_turn' },
    ])
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/suggestions',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(body) }),
    )
  })

  it('stops after the terminal event', async () => {
    stubFetch(async () =>
      sseResponse([sseFrame('done', { stop_reason: 'end_turn' }), sseFrame('delta', { text: 'late' })]),
    )
    expect(await collect()).toEqual([{ type: 'done', stopReason: 'end_turn' }])
  })

  it('passes server error events through', async () => {
    stubFetch(async () =>
      sseResponse([
        sseFrame('delta', { text: 'partial' }),
        sseFrame('error', { code: 'rate_limited', message: 'Slow down' }),
      ]),
    )
    expect(await collect()).toEqual([
      { type: 'delta', text: 'partial' },
      { type: 'error', code: 'rate_limited', message: 'Slow down' },
    ])
  })

  it('maps non-2xx responses to http_<status> using the detail message', async () => {
    stubFetch(async () => jsonResponse({ detail: 'Unknown model: x' }, 422))
    expect(await collect()).toEqual([{ type: 'error', code: 'http_422', message: 'Unknown model: x' }])
  })

  it('falls back to a generic message when the error body has no string detail', async () => {
    stubFetch(async () => jsonResponse({ detail: [{ msg: 'bad' }] }, 422))
    expect(await collect()).toEqual([
      { type: 'error', code: 'http_422', message: 'The AI service returned HTTP 422.' },
    ])
  })

  it('reports network failures', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch')
    })
    const [event] = await collect()
    expect(event).toMatchObject({ type: 'error', code: 'network_error' })
  })

  it('yields nothing when aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    stubFetch(async () => {
      throw new DOMException('Aborted', 'AbortError')
    })
    expect(await collect(controller.signal)).toEqual([])
  })

  it('reports a stream that ends without a terminal event', async () => {
    stubFetch(async () => sseResponse([sseFrame('delta', { text: 'cut' })]))
    expect(await collect()).toEqual([
      { type: 'delta', text: 'cut' },
      { type: 'error', code: 'stream_incomplete', message: 'The AI response ended unexpectedly.' },
    ])
  })

  it('reports malformed event payloads and ignores unknown events', async () => {
    stubFetch(async () => sseResponse(['event: ping\ndata: {}\n\n', 'event: delta\ndata: not json\n\n']))
    const events = await collect()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'error', code: 'invalid_event' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir web exec vitest run src/features/ai/api.test.ts`
Expected: FAIL with `Failed to resolve import "./api"`.

- [ ] **Step 3: Write the implementation**

`web/src/features/ai/api.ts`:
```ts
import { env } from '../../env'
import {
  deltaPayloadSchema,
  donePayloadSchema,
  errorPayloadSchema,
  modelsResponseSchema,
  type ModelsResponse,
  type StreamEvent,
  type SuggestionRequestBody,
} from './schemas'
import { parseSse, type SseMessage } from './sse'

const NETWORK_ERROR: StreamEvent = {
  type: 'error',
  code: 'network_error',
  message: 'Could not reach the AI service. Check that the backend is running.',
}

const INVALID_EVENT: StreamEvent = {
  type: 'error',
  code: 'invalid_event',
  message: 'Received an unreadable response from the AI service.',
}

const STREAM_INCOMPLETE: StreamEvent = {
  type: 'error',
  code: 'stream_incomplete',
  message: 'The AI response ended unexpectedly.',
}

function apiUrl(path: string): string {
  return `${env.VITE_API_BASE_URL}${path}`
}

export async function fetchModels(signal?: AbortSignal): Promise<ModelsResponse> {
  const response = await fetch(apiUrl('/models'), { signal })
  if (!response.ok) throw new Error(`Failed to load models (HTTP ${response.status})`)
  return modelsResponseSchema.parse(await response.json())
}

export async function* streamSuggestion(
  body: SuggestionRequestBody,
  signal: AbortSignal,
): AsyncGenerator<StreamEvent> {
  let response: Response
  try {
    response = await fetch(apiUrl('/suggestions'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal,
    })
  } catch {
    if (!signal.aborted) yield NETWORK_ERROR
    return
  }

  if (!response.ok) {
    yield { type: 'error', code: `http_${response.status}`, message: await readErrorMessage(response) }
    return
  }
  if (!response.body) {
    yield STREAM_INCOMPLETE
    return
  }

  try {
    for await (const message of parseSse(response.body)) {
      const event = toStreamEvent(message)
      if (!event) continue
      yield event
      if (event.type !== 'delta') return
    }
  } catch {
    if (!signal.aborted) yield NETWORK_ERROR
    return
  }
  if (!signal.aborted) yield STREAM_INCOMPLETE
}

function toStreamEvent(message: SseMessage): StreamEvent | null {
  if (!['delta', 'done', 'error'].includes(message.event)) return null
  let payload: unknown
  try {
    payload = JSON.parse(message.data)
  } catch {
    return INVALID_EVENT
  }
  switch (message.event) {
    case 'delta': {
      const parsed = deltaPayloadSchema.safeParse(payload)
      return parsed.success ? { type: 'delta', text: parsed.data.text } : INVALID_EVENT
    }
    case 'done': {
      const parsed = donePayloadSchema.safeParse(payload)
      return parsed.success ? { type: 'done', stopReason: parsed.data.stop_reason } : INVALID_EVENT
    }
    default: {
      const parsed = errorPayloadSchema.safeParse(payload)
      return parsed.success
        ? { type: 'error', code: parsed.data.code, message: parsed.data.message }
        : INVALID_EVENT
    }
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const data: unknown = await response.json()
    if (data && typeof data === 'object' && 'detail' in data && typeof data.detail === 'string') {
      return data.detail
    }
  } catch {
    // Body is not JSON; fall through to the generic message.
  }
  return `The AI service returned HTTP ${response.status}.`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir web exec vitest run src/features/ai/api.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/features/ai/api.ts web/src/features/ai/api.test.ts
git commit -m "feat(frontend): add models and streaming suggestion API client"
```

---

### Task 5: ModelProvider, ModelSelect, header wiring

**Files:**
- Create: `web/src/features/ai/ModelProvider.tsx`
- Create: `web/src/features/ai/ModelSelect.tsx`
- Test: `web/src/features/ai/ModelProvider.test.tsx`
- Test: `web/src/features/ai/ModelSelect.test.tsx`
- Modify: `web/src/App.tsx` (wrap in `ModelProvider`, pass `<ModelSelect />` to `AppHeader`)

**Interfaces:**
- Consumes: `fetchModels` (Task 4), `loadJson`/`saveJson` (phase 2), `AppHeader` children slot (phase 2).
- Produces:
  ```ts
  export const MODEL_STORAGE_KEY = 'ai-docs:model'
  export type ModelsContextValue = { models: ModelInfo[]; selectedModel: string | null; setSelectedModel(id: string): void; status: 'loading' | 'ready' | 'error' }
  export function ModelProvider(props: { children: ReactNode }): JSX.Element
  export function useModels(): ModelsContextValue      // throws outside the provider
  export function ModelSelect(): JSX.Element           // <select aria-label="AI model">
  ```
  `selectedModel` is the stored ID if the catalog has it, otherwise the server default, otherwise the first model. It is `null` unless `status === 'ready'`.

- [ ] **Step 1: Write the failing tests**

`web/src/features/ai/ModelProvider.test.tsx`:
```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { jsonResponse, mockApi } from '../../test/sse'
import { MODEL_STORAGE_KEY, ModelProvider, useModels } from './ModelProvider'

function Probe() {
  const { status, selectedModel, models, setSelectedModel } = useModels()
  return (
    <div>
      <p>status: {status}</p>
      <p>selected: {selectedModel ?? 'none'}</p>
      <p>count: {models.length}</p>
      <button type="button" onClick={() => setSelectedModel('claude-haiku-5-5')}>
        pick haiku
      </button>
    </div>
  )
}

function renderProvider() {
  return render(
    <ModelProvider>
      <Probe />
    </ModelProvider>,
  )
}

describe('ModelProvider', () => {
  it('loads the catalog and selects the server default', async () => {
    mockApi()
    renderProvider()
    expect(screen.getByText('status: loading')).toBeInTheDocument()
    expect(await screen.findByText('status: ready')).toBeInTheDocument()
    expect(screen.getByText('selected: claude-sonnet-5-5')).toBeInTheDocument()
    expect(screen.getByText('count: 2')).toBeInTheDocument()
  })

  it('restores a stored model', async () => {
    localStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify('claude-haiku-5-5'))
    mockApi()
    renderProvider()
    expect(await screen.findByText('selected: claude-haiku-5-5')).toBeInTheDocument()
  })

  it('falls back to the server default when the stored model is unknown', async () => {
    localStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify('retired-model'))
    mockApi()
    renderProvider()
    expect(await screen.findByText('selected: claude-sonnet-5-5')).toBeInTheDocument()
  })

  it('persists a new selection', async () => {
    const user = userEvent.setup()
    mockApi()
    renderProvider()
    await screen.findByText('status: ready')
    await user.click(screen.getByRole('button', { name: 'pick haiku' }))
    expect(screen.getByText('selected: claude-haiku-5-5')).toBeInTheDocument()
    expect(localStorage.getItem(MODEL_STORAGE_KEY)).toBe('"claude-haiku-5-5"')
  })

  it('reports an error when the catalog cannot be loaded', async () => {
    mockApi({ models: () => jsonResponse({ detail: 'down' }, 503) })
    renderProvider()
    expect(await screen.findByText('status: error')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('selected: none')).toBeInTheDocument())
  })
})
```

`web/src/features/ai/ModelSelect.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { jsonResponse, mockApi } from '../../test/sse'
import { MODEL_STORAGE_KEY, ModelProvider } from './ModelProvider'
import { ModelSelect } from './ModelSelect'

function renderSelect() {
  return render(
    <ModelProvider>
      <ModelSelect />
    </ModelProvider>,
  )
}

describe('ModelSelect', () => {
  it('lists the models and changes the selection', async () => {
    const user = userEvent.setup()
    mockApi()
    renderSelect()
    await screen.findByRole('option', { name: 'Claude Haiku 5.5' })
    const select = screen.getByRole('combobox', { name: 'AI model' })
    expect(select).toHaveValue('claude-sonnet-5-5')
    expect(select).toBeEnabled()

    await user.selectOptions(select, 'claude-haiku-5-5')
    expect(select).toHaveValue('claude-haiku-5-5')
    expect(localStorage.getItem(MODEL_STORAGE_KEY)).toBe('"claude-haiku-5-5"')
  })

  it('is disabled while loading', () => {
    mockApi({ models: () => new Promise<Response>(() => {}) })
    renderSelect()
    expect(screen.getByRole('combobox', { name: 'AI model' })).toBeDisabled()
    expect(screen.getByRole('option', { name: 'Loading models…' })).toBeInTheDocument()
  })

  it('shows "AI unavailable" when the catalog fails to load', async () => {
    mockApi({ models: () => jsonResponse({ detail: 'down' }, 503) })
    renderSelect()
    expect(await screen.findByRole('option', { name: 'AI unavailable' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'AI model' })).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --dir web exec vitest run src/features/ai/ModelProvider.test.tsx src/features/ai/ModelSelect.test.tsx`
Expected: FAIL with `Failed to resolve import "./ModelProvider"`.

- [ ] **Step 3: Write the implementation**

`web/src/features/ai/ModelProvider.tsx`:
```tsx
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { z } from 'zod'
import { loadJson, saveJson } from '../../lib/storage'
import { fetchModels } from './api'
import type { ModelInfo } from './schemas'

export const MODEL_STORAGE_KEY = 'ai-docs:model'

type CatalogState = {
  status: 'loading' | 'ready' | 'error'
  models: ModelInfo[]
  defaultModel: string | null
}

export type ModelsContextValue = {
  models: ModelInfo[]
  selectedModel: string | null
  setSelectedModel(id: string): void
  status: CatalogState['status']
}

const ModelsContext = createContext<ModelsContextValue | null>(null)

function pickModel(catalog: CatalogState, stored: string): string | null {
  if (catalog.status !== 'ready') return null
  const ids = catalog.models.map((model) => model.id)
  if (ids.includes(stored)) return stored
  if (catalog.defaultModel && ids.includes(catalog.defaultModel)) return catalog.defaultModel
  return ids[0] ?? null
}

export function ModelProvider({ children }: { children: ReactNode }) {
  const [catalog, setCatalog] = useState<CatalogState>({
    status: 'loading',
    models: [],
    defaultModel: null,
  })
  const [storedModel, setStoredModel] = useState(() => loadJson(MODEL_STORAGE_KEY, z.string(), ''))

  useEffect(() => {
    const controller = new AbortController()
    fetchModels(controller.signal)
      .then((response) =>
        setCatalog({ status: 'ready', models: response.models, defaultModel: response.default_model }),
      )
      .catch(() => {
        if (!controller.signal.aborted) setCatalog({ status: 'error', models: [], defaultModel: null })
      })
    return () => controller.abort()
  }, [])

  const setSelectedModel = useCallback((id: string) => {
    setStoredModel(id)
    saveJson(MODEL_STORAGE_KEY, id)
  }, [])

  const value = useMemo<ModelsContextValue>(
    () => ({
      models: catalog.models,
      status: catalog.status,
      selectedModel: pickModel(catalog, storedModel),
      setSelectedModel,
    }),
    [catalog, storedModel, setSelectedModel],
  )

  return <ModelsContext.Provider value={value}>{children}</ModelsContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components -- hook is colocated with its provider
export function useModels(): ModelsContextValue {
  const value = useContext(ModelsContext)
  if (!value) throw new Error('useModels must be used inside <ModelProvider>')
  return value
}
```

`web/src/features/ai/ModelSelect.tsx`:
```tsx
import { useModels } from './ModelProvider'

const selectClass =
  'rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'

export function ModelSelect() {
  const { models, selectedModel, setSelectedModel, status } = useModels()

  if (status !== 'ready') {
    return (
      <select aria-label="AI model" disabled className={selectClass} value="">
        <option value="">{status === 'loading' ? 'Loading models…' : 'AI unavailable'}</option>
      </select>
    )
  }

  return (
    <select
      aria-label="AI model"
      className={selectClass}
      value={selectedModel ?? ''}
      onChange={(event) => setSelectedModel(event.target.value)}
    >
      {models.map((model) => (
        <option key={model.id} value={model.id}>
          {model.label}
        </option>
      ))}
    </select>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --dir web exec vitest run src/features/ai/ModelProvider.test.tsx src/features/ai/ModelSelect.test.tsx`
Expected: PASS (8 tests).

- [ ] **Step 5: Wire into the app**

In `web/src/App.tsx` (phase 2 version):
1. Add the imports:
   ```tsx
   import { ModelProvider } from './features/ai/ModelProvider'
   import { ModelSelect } from './features/ai/ModelSelect'
   ```
2. Replace `<AppHeader />` with:
   ```tsx
   <AppHeader>
     <ModelSelect />
   </AppHeader>
   ```
3. Wrap `<AppShell />` in `App` with `ModelProvider`:
   ```tsx
   export default function App() {
     return (
       <ThemeProvider>
         <DocumentProvider>
           <ModelProvider>
             <AppShell />
           </ModelProvider>
         </DocumentProvider>
       </ThemeProvider>
     )
   }
   ```

- [ ] **Step 6: Run the full suite**

Run: `pnpm --dir web test`
Expected: all test files PASS. The phase 2 `App.test.tsx` still passes: fetch is stubbed to reject, so the select shows "AI unavailable".

- [ ] **Step 7: Commit**

```bash
git add web/src/features/ai/ModelProvider.tsx web/src/features/ai/ModelProvider.test.tsx web/src/features/ai/ModelSelect.tsx web/src/features/ai/ModelSelect.test.tsx web/src/App.tsx
git commit -m "feat(frontend): add model catalog provider and header model dropdown"
```

---

### Task 6: Suggestion reducer

**Files:**
- Create: `web/src/features/suggestions/suggestionReducer.ts`
- Test: `web/src/features/suggestions/suggestionReducer.test.ts`

**Interfaces:**
- Consumes: `computeSegments`, `setHunkStatuses`, `countByStatus` (Task 1); `normalizeProposal` (Task 2); types (Task 1).
- Produces:
  ```ts
  export type SuggestionState = Suggestion | null
  export type SuggestionAction =
    | { type: 'start'; id; scope; baseText; instruction; model; history: RefineTurn[] }
    | { type: 'refine'; id; instruction; scope; model }      // reviewing, not stale, nothing accepted → streaming; pushes current turn to history
    | { type: 'delta'; id; text }                            // only while streaming with the same id
    | { type: 'done'; id }                                   // normalizes proposal, computes segments → reviewing
    | { type: 'error'; id; error: { code; message } }        // same id, not reviewing → error
    | { type: 'setHunkStatus'; hunkIds: string[]; status: HunkStatus; contentBefore: string; range: TextRange | null }
    | { type: 'markStale' }
    | { type: 'discard' }
  export function suggestionReducer(state: SuggestionState, action: SuggestionAction): SuggestionState
  export function hasAccepted(suggestion: Suggestion): boolean
  ```

- [ ] **Step 1: Write the failing test**

`web/src/features/suggestions/suggestionReducer.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { getHunks } from './diff'
import { hasAccepted, suggestionReducer, type SuggestionAction, type SuggestionState } from './suggestionReducer'

const start: SuggestionAction = {
  type: 'start',
  id: 's1',
  scope: { kind: 'selection', range: { from: 4, to: 12 } },
  baseText: 'one\ntwo\n',
  instruction: 'Shout',
  model: 'claude-sonnet-5-5',
  history: [],
}

function reduce(actions: SuggestionAction[], initial: SuggestionState = null): SuggestionState {
  return actions.reduce<SuggestionState>((state, action) => suggestionReducer(state, action), initial)
}

const reviewing = reduce([start, { type: 'delta', id: 's1', text: 'ONE\ntwo\n' }, { type: 'done', id: 's1' }])

describe('suggestionReducer', () => {
  it('starts a streaming suggestion', () => {
    expect(reduce([start])).toEqual({
      id: 's1',
      status: 'streaming',
      scope: { kind: 'selection', range: { from: 4, to: 12 } },
      baseText: 'one\ntwo\n',
      instruction: 'Shout',
      model: 'claude-sonnet-5-5',
      proposedText: '',
      segments: [],
      history: [],
      stale: false,
      error: null,
      contentBeforeFirstAccept: null,
    })
  })

  it('appends deltas from the current stream only', () => {
    const state = reduce([
      start,
      { type: 'delta', id: 's1', text: 'ON' },
      { type: 'delta', id: 'other', text: 'XX' },
      { type: 'delta', id: 's1', text: 'E' },
    ])
    expect(state?.proposedText).toBe('ONE')
  })

  it('normalizes the proposal and computes segments when done', () => {
    const state = reduce([
      start,
      { type: 'delta', id: 's1', text: '```markdown\nONE\ntwo' },
      { type: 'delta', id: 's1', text: '\n```' },
      { type: 'done', id: 's1' },
    ])
    expect(state?.status).toBe('reviewing')
    expect(state?.proposedText).toBe('ONE\ntwo\n')
    expect(getHunks(state?.segments ?? []).map((h) => [h.oldText, h.newText])).toEqual([['one\n', 'ONE\n']])
  })

  it('ignores deltas after done', () => {
    const state = reduce([{ type: 'delta', id: 's1', text: 'more' }], reviewing)
    expect(state?.proposedText).toBe('ONE\ntwo\n')
  })

  it('records errors while streaming but not while reviewing', () => {
    const error = { code: 'rate_limited', message: 'Slow down' }
    const failed = reduce([start, { type: 'error', id: 's1', error }])
    expect(failed?.status).toBe('error')
    expect(failed?.error).toEqual(error)
    expect(reduce([{ type: 'error', id: 's1', error }], reviewing)).toBe(reviewing)
  })

  it('updates hunk status, the first-accept snapshot and the selection range', () => {
    const accepted = reduce(
      [
        {
          type: 'setHunkStatus',
          hunkIds: ['hunk-1'],
          status: 'accepted',
          contentBefore: 'doc v1',
          range: { from: 4, to: 12 },
        },
      ],
      reviewing,
    )
    expect(getHunks(accepted?.segments ?? [])[0]?.status).toBe('accepted')
    expect(accepted?.contentBeforeFirstAccept).toBe('doc v1')
    expect(accepted && hasAccepted(accepted)).toBe(true)

    const again = reduce(
      [
        {
          type: 'setHunkStatus',
          hunkIds: ['hunk-1'],
          status: 'rejected',
          contentBefore: 'doc v2',
          range: { from: 6, to: 14 },
        },
      ],
      accepted,
    )
    expect(again?.contentBeforeFirstAccept).toBe('doc v1')
    expect(again?.scope).toEqual({ kind: 'selection', range: { from: 6, to: 14 } })
  })

  it('does not take a first-accept snapshot on reject', () => {
    const rejected = reduce(
      [{ type: 'setHunkStatus', hunkIds: ['hunk-1'], status: 'rejected', contentBefore: 'doc', range: null }],
      reviewing,
    )
    expect(rejected?.contentBeforeFirstAccept).toBeNull()
  })

  it('freezes hunk decisions once stale', () => {
    const stale = reduce([{ type: 'markStale' }], reviewing)
    expect(stale?.stale).toBe(true)
    const after = reduce(
      [{ type: 'setHunkStatus', hunkIds: ['hunk-1'], status: 'accepted', contentBefore: 'doc', range: null }],
      stale,
    )
    expect(after).toBe(stale)
  })

  it('refines by pushing the current turn into history', () => {
    const refined = reduce(
      [
        {
          type: 'refine',
          id: 's2',
          instruction: 'Quieter',
          scope: { kind: 'selection', range: { from: 5, to: 13 } },
          model: 'claude-haiku-5-5',
        },
      ],
      reviewing,
    )
    expect(refined).toMatchObject({
      id: 's2',
      status: 'streaming',
      instruction: 'Quieter',
      model: 'claude-haiku-5-5',
      baseText: 'one\ntwo\n',
      proposedText: '',
      segments: [],
      history: [{ instruction: 'Shout', proposal: 'ONE\ntwo\n' }],
      scope: { kind: 'selection', range: { from: 5, to: 13 } },
    })
  })

  it('refuses to refine after a hunk was accepted', () => {
    const accepted = reduce(
      [{ type: 'setHunkStatus', hunkIds: ['hunk-1'], status: 'accepted', contentBefore: 'doc', range: null }],
      reviewing,
    )
    const refined = reduce(
      [{ type: 'refine', id: 's2', instruction: 'x', scope: { kind: 'document' }, model: 'm' }],
      accepted,
    )
    expect(refined).toBe(accepted)
  })

  it('discards', () => {
    expect(reduce([{ type: 'discard' }], reviewing)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir web exec vitest run src/features/suggestions/suggestionReducer.test.ts`
Expected: FAIL with `Failed to resolve import "./suggestionReducer"`.

- [ ] **Step 3: Write the implementation**

`web/src/features/suggestions/suggestionReducer.ts`:
```ts
import { computeSegments, countByStatus, setHunkStatuses } from './diff'
import { normalizeProposal } from './normalize'
import type { HunkStatus, RefineTurn, Suggestion, SuggestionScope, TextRange } from './types'

export type SuggestionState = Suggestion | null

export type SuggestionAction =
  | {
      type: 'start'
      id: string
      scope: SuggestionScope
      baseText: string
      instruction: string
      model: string
      history: RefineTurn[]
    }
  | { type: 'refine'; id: string; instruction: string; scope: SuggestionScope; model: string }
  | { type: 'delta'; id: string; text: string }
  | { type: 'done'; id: string }
  | { type: 'error'; id: string; error: { code: string; message: string } }
  | {
      type: 'setHunkStatus'
      hunkIds: string[]
      status: HunkStatus
      contentBefore: string
      range: TextRange | null
    }
  | { type: 'markStale' }
  | { type: 'discard' }

export function hasAccepted(suggestion: Suggestion): boolean {
  return countByStatus(suggestion.segments).accepted > 0
}

function isStreaming(state: SuggestionState, id: string): state is Suggestion {
  return state !== null && state.id === id && state.status === 'streaming'
}

export function suggestionReducer(state: SuggestionState, action: SuggestionAction): SuggestionState {
  switch (action.type) {
    case 'start':
      return {
        id: action.id,
        status: 'streaming',
        scope: action.scope,
        baseText: action.baseText,
        instruction: action.instruction,
        model: action.model,
        proposedText: '',
        segments: [],
        history: action.history,
        stale: false,
        error: null,
        contentBeforeFirstAccept: null,
      }

    case 'refine':
      if (!state || state.status !== 'reviewing' || state.stale || hasAccepted(state)) return state
      return {
        ...state,
        id: action.id,
        status: 'streaming',
        scope: action.scope,
        instruction: action.instruction,
        model: action.model,
        history: [...state.history, { instruction: state.instruction, proposal: state.proposedText }],
        proposedText: '',
        segments: [],
        error: null,
      }

    case 'delta':
      if (!isStreaming(state, action.id)) return state
      return { ...state, proposedText: state.proposedText + action.text }

    case 'done': {
      if (!isStreaming(state, action.id)) return state
      const proposedText = normalizeProposal(state.proposedText, state.baseText)
      return {
        ...state,
        status: 'reviewing',
        proposedText,
        segments: computeSegments(state.baseText, proposedText),
      }
    }

    case 'error':
      if (!state || state.id !== action.id || state.status === 'reviewing') return state
      return { ...state, status: 'error', error: action.error }

    case 'setHunkStatus': {
      if (!state || state.status !== 'reviewing' || state.stale) return state
      const scope: SuggestionScope =
        action.range && state.scope.kind === 'selection'
          ? { kind: 'selection', range: action.range }
          : state.scope
      return {
        ...state,
        scope,
        segments: setHunkStatuses(state.segments, action.hunkIds, action.status),
        contentBeforeFirstAccept:
          state.contentBeforeFirstAccept ??
          (action.status === 'accepted' ? action.contentBefore : null),
      }
    }

    case 'markStale':
      if (!state || state.status !== 'reviewing') return state
      return { ...state, stale: true }

    case 'discard':
      return null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir web exec vitest run src/features/suggestions/suggestionReducer.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/features/suggestions/suggestionReducer.ts web/src/features/suggestions/suggestionReducer.test.ts
git commit -m "feat(frontend): add pure suggestion state machine"
```

---

### Task 7: SuggestionProvider and useSuggestion

**Files:**
- Create: `web/src/features/suggestions/SuggestionProvider.tsx`
- Create: `web/src/test/renderWithAi.tsx`
- Test: `web/src/features/suggestions/SuggestionProvider.test.tsx`

**Interfaces:**
- Consumes: `useDocument` (phase 2), `useModels` (Task 5), `streamSuggestion` (Task 4), `createId` (phase 2), diff helpers (Task 1), `locateRegion`/`resolveTarget` (Task 2), reducer (Task 6).
- Produces:
  ```ts
  export type SuggestionContextValue = {
    suggestion: Suggestion | null
    isBusy: boolean
    start(input: StartSuggestionInput): void   // no-op if busy, no model, or blank instruction; calls onStart
    stop(): void                               // abort → status 'error', code 'aborted', message 'Stopped.'
    retry(): void                              // error → re-run same instruction/history on the relocated base text
    refine(instruction: string): void          // reviewing, not stale, nothing accepted; calls onStart
    setHunkStatus(hunkId: string, status: HunkStatus): void
    acceptAll(): void                          // all pending hunks
    rejectAll(): void                          // all pending hunks
    discard(): void                            // aborts; if any hunk was accepted, calls onResolved first
  }
  export function SuggestionProvider(props: { children: ReactNode; onResolved?(r: ResolvedSuggestion): void; onStart?(): void }): JSX.Element
  export function useSuggestion(): SuggestionContextValue
  // test/renderWithAi.tsx (test-only)
  export function renderWithAi(ui: ReactNode, options?: { content?: string; onResolved?; onStart? }): RenderResult
  export function DocumentContent(): JSX.Element    // <pre data-testid="document-content">
  export function StartSuggestion(props: { instruction?: string; target?: SuggestionTarget }): JSX.Element // button "Start suggestion"
  export function SelectRange(props: { from: number; to: number }): JSX.Element // button "Select range"
  ```
  `retry` is an addition to the overview API. The panel's Retry button needs it, because `discard()` + `start()` in one handler would see a stale `suggestion` closure.

  Decision algorithm (`setHunkStatus` / `acceptAll` / `rejectAll`):
  1. `current = applySegments(segments)`, `next = applySegments(segments with new statuses)`.
  2. `region = locateRegion(content, current, hint)`, where `hint` is the selection's `from` (or 0 for the document). If it's `null`, mark stale and stop.
  3. If `next !== current`, call `replaceRange(region, next)`. Then dispatch `setHunkStatus` with `range = { from: region.from, to: region.from + next.length }`.
  4. If no hunk is pending: call `onResolved` when `accepted > 0`, then discard.

- [ ] **Step 1: Write the test harness**

`web/src/test/renderWithAi.tsx`:
```tsx
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ModelProvider } from '../features/ai/ModelProvider'
import { DocumentProvider, useDocument } from '../features/document/DocumentProvider'
import { DOCUMENT_STORAGE_KEY } from '../features/document/schema'
import { SuggestionProvider, useSuggestion } from '../features/suggestions/SuggestionProvider'
import type { ResolvedSuggestion, SuggestionTarget } from '../features/suggestions/types'

type Options = {
  content?: string
  onResolved?: (resolved: ResolvedSuggestion) => void
  onStart?: () => void
}

/** Render `ui` inside Document → Model → Suggestion providers with a seeded document. */
export function renderWithAi(ui: ReactNode, { content = '', onResolved, onStart }: Options = {}) {
  localStorage.setItem(DOCUMENT_STORAGE_KEY, JSON.stringify({ content, updatedAt: 0 }))
  return render(
    <DocumentProvider>
      <ModelProvider>
        <SuggestionProvider onResolved={onResolved} onStart={onStart}>
          {ui}
        </SuggestionProvider>
      </ModelProvider>
    </DocumentProvider>,
  )
}

export function DocumentContent() {
  const { content } = useDocument()
  return <pre data-testid="document-content">{content}</pre>
}

export function StartSuggestion({
  instruction = 'Improve',
  target = 'auto',
}: {
  instruction?: string
  target?: SuggestionTarget
}) {
  const { start } = useSuggestion()
  return (
    <button type="button" onClick={() => start({ instruction, target })}>
      Start suggestion
    </button>
  )
}

export function SelectRange({ from, to }: { from: number; to: number }) {
  const { setSelection } = useDocument()
  return (
    <button type="button" onClick={() => setSelection({ from, to })}>
      Select range
    </button>
  )
}
```

- [ ] **Step 2: Write the failing test**

`web/src/features/suggestions/SuggestionProvider.test.tsx`:
```tsx
import { act, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useModels } from '../ai/ModelProvider'
import { useDocument } from '../document/DocumentProvider'
import { renderWithAi } from '../../test/renderWithAi'
import {
  controllableSseResponse,
  mockApi,
  sseFrame,
  sseResponse,
  suggestionBodies,
} from '../../test/sse'
import { useSuggestion } from './SuggestionProvider'
import type { ResolvedSuggestion } from './types'

type Api = {
  suggestion: ReturnType<typeof useSuggestion>
  document: ReturnType<typeof useDocument>
  models: ReturnType<typeof useModels>
}

function Probe({ onRender }: { onRender(api: Api): void }) {
  const api: Api = { suggestion: useSuggestion(), document: useDocument(), models: useModels() }
  useEffect(() => {
    onRender(api)
  })
  return null
}

function proposal(text: string): Response {
  return sseResponse([sseFrame('delta', { text }), sseFrame('done', { stop_reason: 'end_turn' })])
}

async function setup(
  content: string,
  options: { onResolved?: (r: ResolvedSuggestion) => void; onStart?: () => void } = {},
) {
  const latest: { current: Api | null } = { current: null }
  renderWithAi(<Probe onRender={(api) => (latest.current = api)} />, { content, ...options })
  const get = (): Api => {
    if (!latest.current) throw new Error('Probe has not rendered')
    return latest.current
  }
  await waitFor(() => expect(get().models.selectedModel).toBe('claude-sonnet-5-5'))
  return get
}

async function waitForStatus(get: () => Api, status: string) {
  await waitFor(() => expect(get().suggestion.suggestion?.status).toBe(status))
}

describe('SuggestionProvider — streaming', () => {
  it('streams a whole-document suggestion into review', async () => {
    const fetchMock = mockApi({ suggestions: () => proposal('Hello there\n') })
    const onStart = vi.fn()
    const get = await setup('Hello world\n', { onStart })

    act(() => get().suggestion.start({ instruction: '  Rephrase  ', target: 'auto' }))
    expect(onStart).toHaveBeenCalledTimes(1)
    expect(get().suggestion.isBusy).toBe(true)
    await waitForStatus(get, 'reviewing')

    expect(get().suggestion.suggestion).toMatchObject({
      scope: { kind: 'document' },
      baseText: 'Hello world\n',
      instruction: 'Rephrase',
      proposedText: 'Hello there\n',
    })
    expect(suggestionBodies(fetchMock)).toEqual([
      {
        model: 'claude-sonnet-5-5',
        document: 'Hello world\n',
        selection: null,
        instruction: 'Rephrase',
        history: [],
      },
    ])
  })

  it('targets the current selection', async () => {
    const fetchMock = mockApi({ suggestions: () => proposal('BBB') })
    const get = await setup('aaa bbb ccc')
    act(() => get().document.setSelection({ from: 4, to: 7 }))
    act(() => get().suggestion.start({ instruction: 'Shout', target: 'auto' }))
    await waitForStatus(get, 'reviewing')

    expect(get().suggestion.suggestion).toMatchObject({
      scope: { kind: 'selection', range: { from: 4, to: 7 } },
      baseText: 'bbb',
    })
    expect(suggestionBodies(fetchMock)[0]).toMatchObject({ selection: { start: 4, end: 7 } })
  })

  it('ignores blank instructions and starts while busy', async () => {
    const fetchMock = mockApi({ suggestions: () => proposal('x') })
    const get = await setup('text')
    act(() => get().suggestion.start({ instruction: '   ', target: 'auto' }))
    expect(get().suggestion.suggestion).toBeNull()

    act(() => get().suggestion.start({ instruction: 'One', target: 'auto' }))
    act(() => get().suggestion.start({ instruction: 'Two', target: 'auto' }))
    await waitForStatus(get, 'reviewing')
    expect(suggestionBodies(fetchMock)).toHaveLength(1)
  })

  it('stops a running stream', async () => {
    let stream: ReturnType<typeof controllableSseResponse> | undefined
    let signal: AbortSignal | null | undefined
    mockApi({
      suggestions: (init) => {
        signal = init?.signal
        stream = controllableSseResponse(signal)
        return stream.response
      },
    })
    const get = await setup('text')
    act(() => get().suggestion.start({ instruction: 'Go', target: 'auto' }))
    await waitFor(() => expect(stream).toBeDefined())
    act(() => stream?.push(sseFrame('delta', { text: 'par' })))
    await waitFor(() => expect(get().suggestion.suggestion?.proposedText).toBe('par'))

    act(() => get().suggestion.stop())
    expect(get().suggestion.suggestion).toMatchObject({
      status: 'error',
      error: { code: 'aborted', message: 'Stopped.' },
    })
    expect(signal?.aborted).toBe(true)
  })

  it('retries after an error', async () => {
    const responses = [
      sseResponse([sseFrame('error', { code: 'rate_limited', message: 'Slow down' })]),
      proposal('Better\n'),
    ]
    const fetchMock = mockApi({ suggestions: () => responses.shift() ?? proposal('unexpected') })
    const get = await setup('Good\n')
    act(() => get().suggestion.start({ instruction: 'Improve', target: 'auto' }))
    await waitForStatus(get, 'error')
    expect(get().suggestion.suggestion?.error).toEqual({ code: 'rate_limited', message: 'Slow down' })

    act(() => get().suggestion.retry())
    await waitForStatus(get, 'reviewing')
    expect(get().suggestion.suggestion?.proposedText).toBe('Better\n')
    expect(suggestionBodies(fetchMock)).toHaveLength(2)
  })
})

describe('SuggestionProvider — review', () => {
  it('applies accepted hunks to the document and resolves when nothing is pending', async () => {
    mockApi({ suggestions: () => proposal('ONE\ntwo\nTHREE\n') })
    const onResolved = vi.fn()
    const get = await setup('one\ntwo\nthree\n', { onResolved })
    act(() => get().suggestion.start({ instruction: 'Shout', target: 'auto' }))
    await waitForStatus(get, 'reviewing')

    act(() => get().suggestion.setHunkStatus('hunk-1', 'accepted'))
    expect(get().document.content).toBe('ONE\ntwo\nthree\n')
    expect(get().suggestion.suggestion?.contentBeforeFirstAccept).toBe('one\ntwo\nthree\n')
    expect(onResolved).not.toHaveBeenCalled()

    act(() => get().suggestion.setHunkStatus('hunk-2', 'rejected'))
    expect(get().document.content).toBe('ONE\ntwo\nthree\n')
    expect(get().suggestion.suggestion).toBeNull()
    expect(onResolved).toHaveBeenCalledWith({
      instruction: 'Shout',
      history: [],
      model: 'claude-sonnet-5-5',
      contentBefore: 'one\ntwo\nthree\n',
      contentAfter: 'ONE\ntwo\nthree\n',
      acceptedCount: 1,
      totalCount: 2,
    })
  })

  it('flips an accepted hunk back to rejected', async () => {
    mockApi({ suggestions: () => proposal('A\nb\nC\n') })
    const get = await setup('a\nb\nc\n')
    act(() => get().suggestion.start({ instruction: 'Caps', target: 'auto' }))
    await waitForStatus(get, 'reviewing')
    act(() => get().suggestion.setHunkStatus('hunk-1', 'accepted'))
    expect(get().document.content).toBe('A\nb\nc\n')
    act(() => get().suggestion.setHunkStatus('hunk-1', 'rejected'))
    expect(get().document.content).toBe('a\nb\nc\n')
  })

  it('accepts all hunks inside a selection without touching surrounding text', async () => {
    mockApi({ suggestions: () => proposal('fixed\n') })
    const onResolved = vi.fn()
    const get = await setup('keep\nfix me\nkeep\n', { onResolved })
    act(() => get().document.setSelection({ from: 5, to: 12 }))
    act(() => get().suggestion.start({ instruction: 'Fix', target: 'auto' }))
    await waitForStatus(get, 'reviewing')

    act(() => get().suggestion.acceptAll())
    expect(get().document.content).toBe('keep\nfixed\nkeep\n')
    expect(get().suggestion.suggestion).toBeNull()
    expect(onResolved).toHaveBeenCalledWith(
      expect.objectContaining({
        contentBefore: 'keep\nfix me\nkeep\n',
        contentAfter: 'keep\nfixed\nkeep\n',
        acceptedCount: 1,
        totalCount: 1,
      }),
    )
  })

  it('rejects all without changing the document or calling onResolved', async () => {
    mockApi({ suggestions: () => proposal('Other\n') })
    const onResolved = vi.fn()
    const get = await setup('Mine\n', { onResolved })
    act(() => get().suggestion.start({ instruction: 'Change', target: 'auto' }))
    await waitForStatus(get, 'reviewing')
    act(() => get().suggestion.rejectAll())
    expect(get().document.content).toBe('Mine\n')
    expect(get().suggestion.suggestion).toBeNull()
    expect(onResolved).not.toHaveBeenCalled()
  })

  it('marks the suggestion stale when its region was edited away', async () => {
    mockApi({ suggestions: () => proposal('ONE\ntwo\n') })
    const get = await setup('one\ntwo\n')
    act(() => get().suggestion.start({ instruction: 'Shout', target: 'auto' }))
    await waitForStatus(get, 'reviewing')
    act(() => get().document.setContent('changed entirely\n'))
    act(() => get().suggestion.setHunkStatus('hunk-1', 'accepted'))
    expect(get().suggestion.suggestion?.stale).toBe(true)
    expect(get().document.content).toBe('changed entirely\n')
  })

  it('discard after an accept reports the accepted work', async () => {
    mockApi({ suggestions: () => proposal('A\nb\nC\n') })
    const onResolved = vi.fn()
    const get = await setup('a\nb\nc\n', { onResolved })
    act(() => get().suggestion.start({ instruction: 'Caps', target: 'auto' }))
    await waitForStatus(get, 'reviewing')
    act(() => get().suggestion.setHunkStatus('hunk-1', 'accepted'))
    act(() => get().suggestion.discard())
    expect(get().suggestion.suggestion).toBeNull()
    expect(get().document.content).toBe('A\nb\nc\n')
    expect(onResolved).toHaveBeenCalledWith(
      expect.objectContaining({ contentBefore: 'a\nb\nc\n', contentAfter: 'A\nb\nc\n', acceptedCount: 1, totalCount: 2 }),
    )
  })

  it('refines with history', async () => {
    const responses = [proposal('Draft one\n'), proposal('Draft two\n')]
    const fetchMock = mockApi({ suggestions: () => responses.shift() ?? proposal('unexpected') })
    const onStart = vi.fn()
    const get = await setup('Original\n', { onStart })
    act(() => get().suggestion.start({ instruction: 'Rewrite', target: 'auto' }))
    await waitForStatus(get, 'reviewing')

    act(() => get().suggestion.refine('Shorter'))
    await waitFor(() => expect(get().suggestion.suggestion?.proposedText).toBe('Draft two\n'))
    expect(get().suggestion.suggestion?.status).toBe('reviewing')
    expect(onStart).toHaveBeenCalledTimes(2)
    expect(suggestionBodies(fetchMock)[1]).toEqual({
      model: 'claude-sonnet-5-5',
      document: 'Original\n',
      selection: null,
      instruction: 'Shorter',
      history: [{ instruction: 'Rewrite', proposal: 'Draft one\n' }],
    })
  })

  it('does not refine after a hunk was accepted', async () => {
    const fetchMock = mockApi({ suggestions: () => proposal('A\nb\nC\n') })
    const get = await setup('a\nb\nc\n')
    act(() => get().suggestion.start({ instruction: 'Caps', target: 'auto' }))
    await waitForStatus(get, 'reviewing')
    act(() => get().suggestion.setHunkStatus('hunk-1', 'accepted'))
    act(() => get().suggestion.refine('Again'))
    expect(suggestionBodies(fetchMock)).toHaveLength(1)
    expect(get().suggestion.suggestion?.status).toBe('reviewing')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --dir web exec vitest run src/features/suggestions/SuggestionProvider.test.tsx`
Expected: FAIL with `Failed to resolve import "../features/suggestions/SuggestionProvider"` (from `renderWithAi.tsx`).

- [ ] **Step 4: Write the implementation**

`web/src/features/suggestions/SuggestionProvider.tsx`:
```tsx
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react'
import { createId } from '../../lib/id'
import { streamSuggestion } from '../ai/api'
import { useModels } from '../ai/ModelProvider'
import type { SuggestionRequestBody } from '../ai/schemas'
import { useDocument } from '../document/DocumentProvider'
import { applySegments, countByStatus, getHunks, setHunkStatuses } from './diff'
import { locateRegion, resolveTarget } from './locateRegion'
import { hasAccepted, suggestionReducer } from './suggestionReducer'
import type {
  HunkStatus,
  RefineTurn,
  ResolvedSuggestion,
  StartSuggestionInput,
  Suggestion,
  SuggestionScope,
  TextRange,
} from './types'

export type SuggestionContextValue = {
  suggestion: Suggestion | null
  isBusy: boolean
  start(input: StartSuggestionInput): void
  stop(): void
  retry(): void
  refine(instruction: string): void
  setHunkStatus(hunkId: string, status: HunkStatus): void
  acceptAll(): void
  rejectAll(): void
  discard(): void
}

export type SuggestionProviderProps = {
  children: ReactNode
  onResolved?(resolved: ResolvedSuggestion): void
  onStart?(): void
}

const SuggestionContext = createContext<SuggestionContextValue | null>(null)

function toRequestBody(
  document: string,
  scope: SuggestionScope,
  instruction: string,
  model: string,
  history: RefineTurn[],
): SuggestionRequestBody {
  return {
    model,
    document,
    selection: scope.kind === 'selection' ? { start: scope.range.from, end: scope.range.to } : null,
    instruction,
    history,
  }
}

function scopeForRegion(content: string, region: TextRange): SuggestionScope {
  const wholeDocument = region.from === 0 && region.to === content.length
  return wholeDocument || region.from === region.to
    ? { kind: 'document' }
    : { kind: 'selection', range: region }
}

function regionHint(suggestion: Suggestion): number {
  return suggestion.scope.kind === 'selection' ? suggestion.scope.range.from : 0
}

function toResolved(suggestion: Suggestion, contentBefore: string, contentAfter: string, accepted: number): ResolvedSuggestion {
  return {
    instruction: suggestion.instruction,
    history: suggestion.history,
    model: suggestion.model,
    contentBefore,
    contentAfter,
    acceptedCount: accepted,
    totalCount: getHunks(suggestion.segments).length,
  }
}

export function SuggestionProvider({ children, onResolved, onStart }: SuggestionProviderProps) {
  const { content, selection, replaceRange } = useDocument()
  const { selectedModel } = useModels()
  const [suggestion, dispatch] = useReducer(suggestionReducer, null)
  const runRef = useRef<{ id: string; controller: AbortController } | null>(null)

  useEffect(() => {
    const runs = runRef
    return () => runs.current?.controller.abort()
  }, [])

  const runStream = useCallback(async (id: string, body: SuggestionRequestBody) => {
    runRef.current?.controller.abort()
    const controller = new AbortController()
    runRef.current = { id, controller }
    for await (const event of streamSuggestion(body, controller.signal)) {
      if (controller.signal.aborted) break
      if (event.type === 'delta') dispatch({ type: 'delta', id, text: event.text })
      else if (event.type === 'done') dispatch({ type: 'done', id })
      else dispatch({ type: 'error', id, error: { code: event.code, message: event.message } })
    }
    if (runRef.current?.id === id) runRef.current = null
  }, [])

  const start = useCallback(
    (input: StartSuggestionInput) => {
      const instruction = input.instruction.trim()
      if (suggestion || runRef.current || !selectedModel || !instruction) return
      const range = resolveTarget(input.target, selection, content.length)
      const scope: SuggestionScope = range ? { kind: 'selection', range } : { kind: 'document' }
      const baseText = range ? content.slice(range.from, range.to) : content
      const id = createId()
      dispatch({ type: 'start', id, scope, baseText, instruction, model: selectedModel, history: [] })
      onStart?.()
      void runStream(id, toRequestBody(content, scope, instruction, selectedModel, []))
    },
    [suggestion, selectedModel, selection, content, onStart, runStream],
  )

  const retry = useCallback(() => {
    if (!suggestion || suggestion.status !== 'error' || !selectedModel) return
    const region = locateRegion(content, suggestion.baseText, regionHint(suggestion))
    if (!region) {
      dispatch({
        type: 'error',
        id: suggestion.id,
        error: {
          code: 'target_changed',
          message: 'The text this suggestion targets has changed. Discard it and ask again.',
        },
      })
      return
    }
    const scope = scopeForRegion(content, region)
    const id = createId()
    dispatch({
      type: 'start',
      id,
      scope,
      baseText: suggestion.baseText,
      instruction: suggestion.instruction,
      model: selectedModel,
      history: suggestion.history,
    })
    onStart?.()
    void runStream(id, toRequestBody(content, scope, suggestion.instruction, selectedModel, suggestion.history))
  }, [suggestion, selectedModel, content, onStart, runStream])

  const stop = useCallback(() => {
    const run = runRef.current
    if (!run) return
    run.controller.abort()
    runRef.current = null
    dispatch({ type: 'error', id: run.id, error: { code: 'aborted', message: 'Stopped.' } })
  }, [])

  const refine = useCallback(
    (rawInstruction: string) => {
      const instruction = rawInstruction.trim()
      if (
        !suggestion ||
        suggestion.status !== 'reviewing' ||
        suggestion.stale ||
        hasAccepted(suggestion) ||
        suggestion.proposedText === '' || // backend rejects empty refine proposals (phase 3)
        !selectedModel ||
        !instruction
      ) {
        return
      }
      const region = locateRegion(content, suggestion.baseText, regionHint(suggestion))
      if (!region) {
        dispatch({ type: 'markStale' })
        return
      }
      const scope = scopeForRegion(content, region)
      const history = [
        ...suggestion.history,
        { instruction: suggestion.instruction, proposal: suggestion.proposedText },
      ]
      const id = createId()
      dispatch({ type: 'refine', id, instruction, scope, model: selectedModel })
      onStart?.()
      void runStream(id, toRequestBody(content, scope, instruction, selectedModel, history))
    },
    [suggestion, selectedModel, content, onStart, runStream],
  )

  const decide = useCallback(
    (hunkIds: string[], status: HunkStatus) => {
      if (!suggestion || suggestion.status !== 'reviewing' || suggestion.stale || hunkIds.length === 0) {
        return
      }
      const currentText = applySegments(suggestion.segments)
      const nextSegments = setHunkStatuses(suggestion.segments, hunkIds, status)
      const nextText = applySegments(nextSegments)
      const region = locateRegion(content, currentText, regionHint(suggestion))
      if (!region) {
        dispatch({ type: 'markStale' })
        return
      }
      if (nextText !== currentText) replaceRange(region, nextText)
      dispatch({
        type: 'setHunkStatus',
        hunkIds,
        status,
        contentBefore: content,
        range: { from: region.from, to: region.from + nextText.length },
      })

      const counts = countByStatus(nextSegments)
      if (counts.pending > 0) return
      if (counts.accepted > 0) {
        const contentAfter = content.slice(0, region.from) + nextText + content.slice(region.to)
        onResolved?.(
          toResolved(suggestion, suggestion.contentBeforeFirstAccept ?? content, contentAfter, counts.accepted),
        )
      }
      dispatch({ type: 'discard' })
    },
    [suggestion, content, replaceRange, onResolved],
  )

  const setHunkStatus = useCallback(
    (hunkId: string, status: HunkStatus) => decide([hunkId], status),
    [decide],
  )

  const pendingIds = useCallback(
    () =>
      suggestion
        ? getHunks(suggestion.segments)
            .filter((hunk) => hunk.status === 'pending')
            .map((hunk) => hunk.id)
        : [],
    [suggestion],
  )

  const acceptAll = useCallback(() => decide(pendingIds(), 'accepted'), [decide, pendingIds])
  const rejectAll = useCallback(() => decide(pendingIds(), 'rejected'), [decide, pendingIds])

  const discard = useCallback(() => {
    runRef.current?.controller.abort()
    runRef.current = null
    if (suggestion?.status === 'reviewing') {
      const { accepted } = countByStatus(suggestion.segments)
      if (accepted > 0) {
        onResolved?.(toResolved(suggestion, suggestion.contentBeforeFirstAccept ?? content, content, accepted))
      }
    }
    dispatch({ type: 'discard' })
  }, [suggestion, content, onResolved])

  const value = useMemo<SuggestionContextValue>(
    () => ({
      suggestion,
      isBusy: suggestion !== null,
      start,
      stop,
      retry,
      refine,
      setHunkStatus,
      acceptAll,
      rejectAll,
      discard,
    }),
    [suggestion, start, stop, retry, refine, setHunkStatus, acceptAll, rejectAll, discard],
  )

  return <SuggestionContext.Provider value={value}>{children}</SuggestionContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components -- hook is colocated with its provider
export function useSuggestion(): SuggestionContextValue {
  const value = useContext(SuggestionContext)
  if (!value) throw new Error('useSuggestion must be used inside <SuggestionProvider>')
  return value
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --dir web exec vitest run src/features/suggestions/SuggestionProvider.test.tsx`
Expected: PASS (14 tests).

- [ ] **Step 6: Lint the new files**

Run: `pnpm --dir web lint`
Expected: 0 errors. If `react-refresh/only-export-components` warns about `src/test/renderWithAi.tsx`, add `/* eslint-disable react-refresh/only-export-components -- test helpers */` as the file's first line.

- [ ] **Step 7: Commit**

```bash
git add web/src/features/suggestions/SuggestionProvider.tsx web/src/features/suggestions/SuggestionProvider.test.tsx web/src/test/renderWithAi.tsx
git commit -m "feat(frontend): add SuggestionProvider streaming, review and refine flow"
```

---

### Task 8: SplitDiffView

**Files:**
- Create: `web/src/features/suggestions/SplitDiffView.tsx`
- Test: `web/src/features/suggestions/SplitDiffView.test.tsx`

**Interfaces:**
- Consumes: `splitLines`, `computeSegments` (tests), `setHunkStatuses` (tests) from Task 1; `diffWordsWithSpace` from `diff`.
- Produces:
  ```ts
  export type SplitDiffViewProps = {
    segments: DiffSegment[]
    readOnly?: boolean                                          // phase 5 history uses this
    onSetHunkStatus?(hunkId: string, status: HunkStatus): void
    contextLines?: number                                       // default 3
  }
  export function SplitDiffView(props: SplitDiffViewProps): JSX.Element
  ```
  Renders a `<table>` with column headers "Before" and "After". Each hunk gets a header row labelled `Change N`. When not read-only, that row has buttons with `aria-label="Accept change N"` / `"Reject change N"` and `aria-pressed`. Unchanged runs longer than the context are collapsed behind a `Show N unchanged lines` button. Paired changed lines mark changed words with `<del>` (Before) and `<ins>` (After).

- [ ] **Step 1: Write the failing test**

`web/src/features/suggestions/SplitDiffView.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { computeSegments, setHunkStatuses } from './diff'
import { SplitDiffView } from './SplitDiffView'

const lines = (count: number, transform: (n: number) => string = (n) => `line ${n}`) =>
  Array.from({ length: count }, (_, i) => `${transform(i + 1)}\n`).join('')

describe('SplitDiffView', () => {
  it('renders before/after columns, line numbers and change labels', () => {
    render(<SplitDiffView segments={computeSegments('a\nb\nc\n', 'a\nB\nc\n')} onSetHunkStatus={vi.fn()} />)
    expect(screen.getByRole('columnheader', { name: 'Before' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'After' })).toBeInTheDocument()
    expect(screen.getByText('Change 1')).toBeInTheDocument()
    expect(screen.getAllByText('a')).toHaveLength(2)
    expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(2)
  })

  it('reports accept and reject decisions per hunk', async () => {
    const user = userEvent.setup()
    const onSetHunkStatus = vi.fn()
    render(
      <SplitDiffView
        segments={computeSegments('one\ntwo\nthree\n', 'ONE\ntwo\nTHREE\n')}
        onSetHunkStatus={onSetHunkStatus}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Accept change 1' }))
    await user.click(screen.getByRole('button', { name: 'Reject change 2' }))
    expect(onSetHunkStatus).toHaveBeenNthCalledWith(1, 'hunk-1', 'accepted')
    expect(onSetHunkStatus).toHaveBeenNthCalledWith(2, 'hunk-2', 'rejected')
  })

  it('shows the decided state', () => {
    const segments = setHunkStatuses(computeSegments('a\n', 'b\n'), ['hunk-1'], 'accepted')
    render(<SplitDiffView segments={segments} onSetHunkStatus={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Accept change 1' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Reject change 1' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('Accepted')).toBeInTheDocument()
  })

  it('hides actions in read-only mode', () => {
    render(<SplitDiffView segments={computeSegments('a\n', 'b\n')} readOnly />)
    expect(screen.getByText('Change 1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /change 1/i })).not.toBeInTheDocument()
  })

  it('collapses long unchanged regions and expands them on demand', async () => {
    const user = userEvent.setup()
    const before = lines(20)
    const after = lines(20, (n) => (n === 10 ? 'LINE 10' : `line ${n}`))
    render(<SplitDiffView segments={computeSegments(before, after)} readOnly />)

    expect(screen.queryAllByText('line 1')).toHaveLength(0)
    expect(screen.getAllByText('line 7')).toHaveLength(2)
    expect(screen.getAllByText('line 13')).toHaveLength(2)
    expect(screen.queryAllByText('line 14')).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Show 6 unchanged lines' }))
    expect(screen.getAllByText('line 1')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Show 7 unchanged lines' })).toBeInTheDocument()
  })

  it('highlights changed words inside paired lines', () => {
    const { container } = render(
      <SplitDiffView segments={computeSegments('the quick fox\n', 'the slow fox\n')} readOnly />,
    )
    expect(container.querySelector('del')?.textContent).toBe('quick')
    expect(container.querySelector('ins')?.textContent).toBe('slow')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir web exec vitest run src/features/suggestions/SplitDiffView.test.tsx`
Expected: FAIL with `Failed to resolve import "./SplitDiffView"`.

- [ ] **Step 3: Write the implementation**

`web/src/features/suggestions/SplitDiffView.tsx`:
```tsx
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

const numberCell = 'select-none px-2 text-right align-top text-xs text-slate-400 dark:text-slate-500'
const textCell = 'whitespace-pre-wrap break-words px-2 align-top'
const statusLabel: Record<HunkStatus, string> = { pending: '', accepted: 'Accepted', rejected: 'Rejected' }

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
            <th colSpan={2} scope="colgroup" className="border-l border-slate-200 px-3 py-2 dark:border-slate-700">
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
                    <td className={textCell}>{row.text || ' '}</td>
                    <td className={`${numberCell} border-l border-slate-200 dark:border-slate-700`}>{row.newNo}</td>
                    <td className={textCell}>{row.text || ' '}</td>
                  </tr>
                )
              case 'collapsed':
                return (
                  <tr key={row.key} className="bg-slate-50 dark:bg-slate-900">
                    <td colSpan={4} className="px-3 py-1">
                      <button
                        type="button"
                        onClick={() => expand(row.segmentIndex)}
                        className="text-xs text-blue-700 hover:underline focus-visible:outline-2 focus-visible:outline-blue-500 dark:text-blue-400"
                      >
                        Show {row.count} unchanged lines
                      </button>
                    </td>
                  </tr>
                )
              case 'hunk':
                return (
                  <tr key={row.key} className="border-t border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800">
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
                return (
                  <tr key={row.key}>
                    <td className={`${numberCell} ${row.oldLine !== null ? 'bg-red-50 dark:bg-red-950/40' : ''}`}>
                      {row.oldNo}
                    </td>
                    <td className={`${textCell}${dimOld} ${row.oldLine !== null ? 'bg-red-50 dark:bg-red-950/40' : 'bg-slate-50 dark:bg-slate-900'}`}>
                      {row.oldLine === null
                        ? ' '
                        : paired
                          ? renderWords(row.oldLine, row.newLine ?? '', 'old')
                          : row.oldLine || ' '}
                    </td>
                    <td className={`${numberCell} border-l border-slate-200 dark:border-slate-700 ${row.newLine !== null ? 'bg-green-50 dark:bg-green-950/40' : ''}`}>
                      {row.newNo}
                    </td>
                    <td className={`${textCell}${dimNew} ${row.newLine !== null ? 'bg-green-50 dark:bg-green-950/40' : 'bg-slate-50 dark:bg-slate-900'}`}>
                      {row.newLine === null
                        ? ' '
                        : paired
                          ? renderWords(row.oldLine ?? '', row.newLine, 'new')
                          : row.newLine || ' '}
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir web exec vitest run src/features/suggestions/SplitDiffView.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/features/suggestions/SplitDiffView.tsx web/src/features/suggestions/SplitDiffView.test.tsx
git commit -m "feat(frontend): add split-pane diff view with per-hunk actions"
```

---

### Task 9: AskAiBar

**Files:**
- Create: `web/src/features/suggestions/AskAiBar.tsx`
- Test: `web/src/features/suggestions/AskAiBar.test.tsx`

**Interfaces:**
- Consumes: `useDocument` (phase 2), `useModels` (Task 5), `useSuggestion` (Task 7), test harness (Task 7).
- Produces: `export function AskAiBar(): JSX.Element`. A `<form aria-label="Ask AI">` with a scope chip ("Selection" / "Whole document"), an input `aria-label="AI instruction"`, and a "Suggest" submit button. Enter or Mod-Enter submits with `target: 'auto'` and clears the input. Disabled while busy or when no model is selected.

- [ ] **Step 1: Write the failing test**

`web/src/features/suggestions/AskAiBar.test.tsx`:
```tsx
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SelectRange, renderWithAi } from '../../test/renderWithAi'
import {
  controllableSseResponse,
  jsonResponse,
  mockApi,
  sseFrame,
  sseResponse,
  suggestionBodies,
} from '../../test/sse'
import { AskAiBar } from './AskAiBar'

const done = () =>
  sseResponse([sseFrame('delta', { text: 'x' }), sseFrame('done', { stop_reason: 'end_turn' })])

describe('AskAiBar', () => {
  it('shows the scope and enables Suggest once a model and instruction exist', async () => {
    const user = userEvent.setup()
    mockApi({ suggestions: done })
    renderWithAi(
      <>
        <AskAiBar />
        <SelectRange from={0} to={5} />
      </>,
      { content: 'Hello world' },
    )
    expect(screen.getByText('Whole document')).toBeInTheDocument()
    const input = screen.getByRole('textbox', { name: 'AI instruction' })
    await waitFor(() => expect(input).toBeEnabled())
    expect(screen.getByRole('button', { name: 'Suggest' })).toBeDisabled()

    await user.type(input, 'Tighten')
    expect(screen.getByRole('button', { name: 'Suggest' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Select range' }))
    expect(screen.getByText('Selection')).toBeInTheDocument()
  })

  it('submits with the button, sends the instruction and clears the input', async () => {
    const user = userEvent.setup()
    const fetchMock = mockApi({ suggestions: done })
    const onStart = vi.fn()
    renderWithAi(<AskAiBar />, { content: 'Hello', onStart })
    const input = screen.getByRole('textbox', { name: 'AI instruction' })
    await waitFor(() => expect(input).toBeEnabled())

    await user.type(input, 'Make it formal')
    await user.click(screen.getByRole('button', { name: 'Suggest' }))
    expect(onStart).toHaveBeenCalledTimes(1)
    expect(input).toHaveValue('')
    await waitFor(() =>
      expect(suggestionBodies(fetchMock)[0]).toMatchObject({ instruction: 'Make it formal', selection: null }),
    )
  })

  it('submits with Mod-Enter', async () => {
    const user = userEvent.setup()
    const fetchMock = mockApi({ suggestions: done })
    renderWithAi(<AskAiBar />, { content: 'Hello' })
    const input = screen.getByRole('textbox', { name: 'AI instruction' })
    await waitFor(() => expect(input).toBeEnabled())
    await user.type(input, 'Fix typos{Control>}{Enter}{/Control}')
    await waitFor(() => expect(suggestionBodies(fetchMock)).toHaveLength(1))
  })

  it('is disabled while a suggestion is active', async () => {
    const user = userEvent.setup()
    mockApi({ suggestions: (init) => controllableSseResponse(init?.signal).response })
    renderWithAi(<AskAiBar />, { content: 'Hello' })
    const input = screen.getByRole('textbox', { name: 'AI instruction' })
    await waitFor(() => expect(input).toBeEnabled())
    await user.type(input, 'Go{Enter}')
    await waitFor(() => expect(input).toBeDisabled())
    expect(screen.getByRole('button', { name: 'Suggest' })).toBeDisabled()
  })

  it('is disabled when the AI is unavailable', async () => {
    mockApi({ models: () => jsonResponse({ detail: 'down' }, 503) })
    renderWithAi(<AskAiBar />, { content: 'Hello' })
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'AI instruction' })).toHaveAttribute(
        'placeholder',
        'AI unavailable',
      ),
    )
    expect(screen.getByRole('textbox', { name: 'AI instruction' })).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir web exec vitest run src/features/suggestions/AskAiBar.test.tsx`
Expected: FAIL with `Failed to resolve import "./AskAiBar"`.

- [ ] **Step 3: Write the implementation**

`web/src/features/suggestions/AskAiBar.tsx`:
```tsx
import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { useModels } from '../ai/ModelProvider'
import { useDocument } from '../document/DocumentProvider'
import { useSuggestion } from './SuggestionProvider'

export function AskAiBar() {
  const { selection } = useDocument()
  const { start, isBusy } = useSuggestion()
  const { selectedModel, status } = useModels()
  const [instruction, setInstruction] = useState('')

  const hasSelection = selection.from !== selection.to
  const unavailable = isBusy || !selectedModel
  const canSubmit = !unavailable && instruction.trim().length > 0

  const placeholder = isBusy
    ? 'Finish reviewing the current suggestion first…'
    : status === 'loading'
      ? 'Loading models…'
      : !selectedModel
        ? 'AI unavailable'
        : 'Ask AI to edit, e.g. “make this more concise”'

  const submit = () => {
    if (!canSubmit) return
    start({ instruction: instruction.trim(), target: 'auto' })
    setInstruction('')
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    submit()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <form
      aria-label="Ask AI"
      onSubmit={handleSubmit}
      className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900"
    >
      <span
        aria-live="polite"
        className="shrink-0 rounded bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-200"
      >
        {hasSelection ? 'Selection' : 'Whole document'}
      </span>
      <input
        aria-label="AI instruction"
        value={instruction}
        onChange={(event) => setInstruction(event.target.value)}
        onKeyDown={handleKeyDown}
        disabled={unavailable}
        placeholder={placeholder}
        className="min-w-0 flex-1 rounded-md bg-transparent px-2 py-1 text-sm outline-none placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed"
      />
      <button
        type="submit"
        disabled={!canSubmit}
        className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Suggest
      </button>
    </form>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir web exec vitest run src/features/suggestions/AskAiBar.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/features/suggestions/AskAiBar.tsx web/src/features/suggestions/AskAiBar.test.tsx
git commit -m "feat(frontend): add Ask AI instruction bar"
```

---

### Task 10: SuggestionPanel

**Files:**
- Create: `web/src/features/suggestions/SuggestionPanel.tsx`
- Test: `web/src/features/suggestions/SuggestionPanel.test.tsx`

**Interfaces:**
- Consumes: `useSuggestion` (Task 7), `SplitDiffView` (Task 8), `countByStatus`/`getHunks` (Task 1), test harness (Task 7).
- Produces: `export function SuggestionPanel(): JSX.Element`, a `<section aria-label="AI suggestion">` with these states:
  - empty: "No active suggestion."
  - streaming: "AI is writing…", the live text, and a "Stop" button.
  - error: `role="alert"` with the message, plus "Retry" and "Discard".
  - reviewing, no hunks: `role="status"` "No changes suggested." and "Dismiss".
  - reviewing: "N of M changes pending", "Accept all", "Reject all", "Discard", `SplitDiffView`, and a refine form (input `aria-label="Refine instruction"`, button "Refine", disabled after any accept with a hint).
  - stale: `role="alert"` banner; diff becomes read-only; Accept/Reject all disabled.

- [ ] **Step 1: Write the failing test**

`web/src/features/suggestions/SuggestionPanel.test.tsx`:
```tsx
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useDocument } from '../document/DocumentProvider'
import { describe, expect, it, vi } from 'vitest'
import { DocumentContent, StartSuggestion, renderWithAi } from '../../test/renderWithAi'
import {
  controllableSseResponse,
  mockApi,
  sseFrame,
  sseResponse,
  suggestionBodies,
} from '../../test/sse'
import { SuggestionPanel } from './SuggestionPanel'

const proposal = (text: string) =>
  sseResponse([sseFrame('delta', { text }), sseFrame('done', { stop_reason: 'end_turn' })])

function Overwrite() {
  const { setContent } = useDocument()
  return (
    <button type="button" onClick={() => setContent('something else\n')}>
      Overwrite document
    </button>
  )
}

function renderPanel(content: string, onResolved = vi.fn()) {
  renderWithAi(
    <>
      <StartSuggestion instruction="Shout" />
      <Overwrite />
      <SuggestionPanel />
      <DocumentContent />
    </>,
    { content, onResolved },
  )
  return onResolved
}

async function startSuggestion(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => expect(screen.getByRole('button', { name: 'Start suggestion' })).toBeEnabled())
  // The model catalog loads asynchronously; retry the click until a suggestion appears.
  await waitFor(async () => {
    await user.click(screen.getByRole('button', { name: 'Start suggestion' }))
    expect(screen.queryByText('No active suggestion.')).not.toBeInTheDocument()
  })
}

describe('SuggestionPanel', () => {
  it('shows an empty state', () => {
    mockApi()
    renderPanel('Hello\n')
    expect(screen.getByText('No active suggestion.')).toBeInTheDocument()
  })

  it('streams text and can be stopped, then retried or discarded', async () => {
    const user = userEvent.setup()
    let stream: ReturnType<typeof controllableSseResponse> | undefined
    mockApi({
      suggestions: (init) => {
        stream = controllableSseResponse(init?.signal)
        return stream.response
      },
    })
    renderPanel('Hello\n')
    await startSuggestion(user)
    expect(screen.getByText('AI is writing…')).toBeInTheDocument()
    stream?.push(sseFrame('delta', { text: 'HEL' }))
    expect(await screen.findByText('HEL')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Stopped.')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(screen.getByText('No active suggestion.')).toBeInTheDocument()
  })

  it('shows server errors with Retry', async () => {
    const user = userEvent.setup()
    const responses = [
      sseResponse([sseFrame('error', { code: 'rate_limited', message: 'Slow down' })]),
      proposal('HELLO\n'),
    ]
    mockApi({ suggestions: () => responses.shift() ?? proposal('unexpected') })
    renderPanel('Hello\n')
    await startSuggestion(user)
    expect(await screen.findByRole('alert')).toHaveTextContent('Slow down')
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('button', { name: 'Accept change 1' })).toBeInTheDocument()
  })

  it('reviews hunks and accepts all', async () => {
    const user = userEvent.setup()
    mockApi({ suggestions: () => proposal('ONE\ntwo\nTHREE\n') })
    const onResolved = renderPanel('one\ntwo\nthree\n')
    await startSuggestion(user)
    expect(await screen.findByText('2 of 2 changes pending')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Accept change 1' }))
    expect(screen.getByText('1 of 2 changes pending')).toBeInTheDocument()
    expect(screen.getByTestId('document-content').textContent).toBe('ONE\ntwo\nthree\n')

    await user.click(screen.getByRole('button', { name: 'Accept all' }))
    expect(screen.getByTestId('document-content').textContent).toBe('ONE\ntwo\nTHREE\n')
    expect(screen.getByText('No active suggestion.')).toBeInTheDocument()
    expect(onResolved).toHaveBeenCalledTimes(1)
  })

  it('says when there is nothing to change', async () => {
    const user = userEvent.setup()
    mockApi({ suggestions: () => proposal('Hello\n') })
    renderPanel('Hello\n')
    await startSuggestion(user)
    expect(await screen.findByRole('status')).toHaveTextContent('No changes suggested.')
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.getByText('No active suggestion.')).toBeInTheDocument()
  })

  it('warns when the suggestion is stale', async () => {
    const user = userEvent.setup()
    mockApi({ suggestions: () => proposal('HELLO\n') })
    renderPanel('Hello\n')
    await startSuggestion(user)
    await screen.findByRole('button', { name: 'Accept change 1' })
    await user.click(screen.getByRole('button', { name: 'Overwrite document' }))
    await user.click(screen.getByRole('button', { name: 'Accept change 1' }))
    expect(screen.getByRole('alert')).toHaveTextContent('The document changed')
    expect(screen.queryByRole('button', { name: 'Accept change 1' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Accept all' })).toBeDisabled()
  })

  it('refines, and blocks refining after an accept', async () => {
    const user = userEvent.setup()
    const responses = [proposal('A\nb\nC\n'), proposal('AA\nb\nCC\n')]
    const fetchMock = mockApi({ suggestions: () => responses.shift() ?? proposal('unexpected') })
    renderPanel('a\nb\nc\n')
    await startSuggestion(user)
    await screen.findByRole('button', { name: 'Accept change 1' })

    await user.type(screen.getByRole('textbox', { name: 'Refine instruction' }), 'Double it')
    await user.click(screen.getByRole('button', { name: 'Refine' }))
    await waitFor(() => expect(suggestionBodies(fetchMock)).toHaveLength(2))
    expect(suggestionBodies(fetchMock)[1]).toMatchObject({
      instruction: 'Double it',
      history: [{ instruction: 'Shout', proposal: 'A\nb\nC\n' }],
    })

    await user.click(await screen.findByRole('button', { name: 'Accept change 1' }))
    expect(screen.getByRole('textbox', { name: 'Refine instruction' })).toBeDisabled()
    expect(screen.getByText('Refine is unavailable after accepting a change.')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir web exec vitest run src/features/suggestions/SuggestionPanel.test.tsx`
Expected: FAIL with `Failed to resolve import "./SuggestionPanel"`.

- [ ] **Step 3: Write the implementation**

`web/src/features/suggestions/SuggestionPanel.tsx`:
```tsx
import { useState, type FormEvent } from 'react'
import { countByStatus, getHunks } from './diff'
import { SplitDiffView } from './SplitDiffView'
import { useSuggestion } from './SuggestionProvider'
import type { Suggestion } from './types'

const buttonBase =
  'rounded-md px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-50'
const primaryButton = `${buttonBase} bg-blue-600 text-white hover:bg-blue-700`
const secondaryButton = `${buttonBase} border border-slate-300 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800`

export function SuggestionPanel() {
  const { suggestion } = useSuggestion()

  if (!suggestion) {
    return (
      <section
        aria-label="AI suggestion"
        className="m-4 rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400"
      >
        <p className="font-medium">No active suggestion.</p>
        <p className="mt-1">
          In the Editor tab, select some text (or nothing, for the whole document), describe the change, and press Suggest.
        </p>
      </section>
    )
  }

  return (
    <section aria-label="AI suggestion" className="flex flex-col gap-4 p-4">
      <SuggestionHeader suggestion={suggestion} />
      {suggestion.status === 'streaming' && <StreamingView suggestion={suggestion} />}
      {suggestion.status === 'error' && <ErrorView suggestion={suggestion} />}
      {suggestion.status === 'reviewing' && <ReviewView suggestion={suggestion} />}
    </section>
  )
}

function SuggestionHeader({ suggestion }: { suggestion: Suggestion }) {
  const scope = suggestion.scope.kind === 'selection' ? 'Selection' : 'Whole document'
  const refinement = suggestion.history.length > 0 ? ` · refinement ${suggestion.history.length}` : ''
  return (
    <header className="flex flex-col gap-1">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {scope} · {suggestion.model}
        {refinement}
      </p>
      <h2 className="text-base font-semibold">“{suggestion.instruction}”</h2>
    </header>
  )
}

function StreamingView({ suggestion }: { suggestion: Suggestion }) {
  const { stop } = useSuggestion()
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="animate-pulse text-sm text-slate-500 dark:text-slate-400">AI is writing…</p>
        <button type="button" onClick={stop} className={secondaryButton}>
          Stop
        </button>
      </div>
      <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-sm dark:border-slate-700 dark:bg-slate-900">
        {suggestion.proposedText}
      </pre>
    </div>
  )
}

function ErrorView({ suggestion }: { suggestion: Suggestion }) {
  const { retry, discard } = useSuggestion()
  const stopped = suggestion.error?.code === 'aborted'
  return (
    <div className="flex flex-col gap-3">
      <div
        role="alert"
        className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
      >
        <p className="font-medium">
          {stopped ? 'Suggestion stopped' : 'The AI could not complete this suggestion'}
        </p>
        <p>{suggestion.error?.message}</p>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={retry} className={primaryButton}>
          Retry
        </button>
        <button type="button" onClick={discard} className={secondaryButton}>
          Discard
        </button>
      </div>
    </div>
  )
}

function ReviewView({ suggestion }: { suggestion: Suggestion }) {
  const { setHunkStatus, acceptAll, rejectAll, discard, refine } = useSuggestion()
  const [refineText, setRefineText] = useState('')
  const hunks = getHunks(suggestion.segments)
  const counts = countByStatus(suggestion.segments)

  if (hunks.length === 0) {
    return (
      <div role="status" className="flex items-center justify-between rounded-md border border-slate-200 p-3 text-sm dark:border-slate-700">
        <p>No changes suggested.</p>
        <button type="button" onClick={discard} className={secondaryButton}>
          Dismiss
        </button>
      </div>
    )
  }

  const refineBlocked = counts.accepted > 0 || suggestion.stale
  const decisionsBlocked = suggestion.stale || counts.pending === 0

  const submitRefine = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const text = refineText.trim()
    if (!text || refineBlocked) return
    refine(text)
    setRefineText('')
  }

  return (
    <div className="flex flex-col gap-3">
      {suggestion.stale && (
        <div
          role="alert"
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
        >
          The document changed where this suggestion applies, so it can no longer be applied. Discard
          it and ask again.
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-slate-600 dark:text-slate-300">
          {counts.pending} of {hunks.length} changes pending
        </p>
        <button type="button" onClick={acceptAll} disabled={decisionsBlocked} className={primaryButton}>
          Accept all
        </button>
        <button type="button" onClick={rejectAll} disabled={decisionsBlocked} className={secondaryButton}>
          Reject all
        </button>
        <button type="button" onClick={discard} className={secondaryButton}>
          Discard
        </button>
      </div>
      <SplitDiffView segments={suggestion.segments} readOnly={suggestion.stale} onSetHunkStatus={setHunkStatus} />
      <form onSubmit={submitRefine} className="flex flex-col gap-1">
        <div className="flex gap-2">
          <input
            aria-label="Refine instruction"
            value={refineText}
            onChange={(event) => setRefineText(event.target.value)}
            disabled={refineBlocked}
            placeholder="Refine, e.g. “keep the first sentence, make it friendlier”"
            className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm focus-visible:outline-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900"
          />
          <button type="submit" disabled={refineBlocked || !refineText.trim()} className={secondaryButton}>
            Refine
          </button>
        </div>
        {counts.accepted > 0 && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Refine is unavailable after accepting a change.
          </p>
        )}
      </form>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir web exec vitest run src/features/suggestions/SuggestionPanel.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/features/suggestions/SuggestionPanel.tsx web/src/features/suggestions/SuggestionPanel.test.tsx
git commit -m "feat(frontend): add AI Review suggestion panel"
```

---

### Task 11: Wire suggestions into the app

**Files:**
- Modify: `web/src/App.tsx` (replace its content)
- Modify: `web/src/App.test.tsx` (replace the placeholder test)
- Test: `web/src/App.suggestions.test.tsx`

**Interfaces:**
- Consumes: everything above plus phase 2's `Tabs`, `AppHeader`, `MarkdownEditor`, `MarkdownPreview`, `useTheme`.
- Produces: `App` with `SuggestionProvider` inside `AppShell` (so `onStart` can switch to the review tab), `AskAiBar` above the editor, and `SuggestionPanel` in the review tab. The review tab badge shows the pending hunk count, or `…` while streaming. Phase 5 moves `SuggestionProvider` into a `SuggestionBridge` and replaces the review panel with `AiReviewTab`.

- [ ] **Step 1: Write the failing integration test**

`web/src/App.suggestions.test.tsx`:
```tsx
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from './App'
import { DOCUMENT_STORAGE_KEY } from './features/document/schema'
import { mockApi, sseFrame, sseResponse } from './test/sse'

describe('App AI suggestions', () => {
  it('asks the AI, opens the review tab, and applies accepted changes', async () => {
    const user = userEvent.setup()
    localStorage.setItem(
      DOCUMENT_STORAGE_KEY,
      JSON.stringify({ content: '# Notes\n\nHello world\n', updatedAt: 0 }),
    )
    mockApi({
      suggestions: () =>
        sseResponse([
          sseFrame('delta', { text: '# Notes\n\nHello ' }),
          sseFrame('delta', { text: 'there\n' }),
          sseFrame('done', { stop_reason: 'end_turn' }),
        ]),
    })
    render(<App />)

    expect(await screen.findByRole('option', { name: 'Claude Sonnet 5.5' })).toBeInTheDocument()
    const input = screen.getByRole('textbox', { name: 'AI instruction' })
    await waitFor(() => expect(input).toBeEnabled())
    await user.type(input, 'Make it friendlier{Enter}')

    const reviewTab = screen.getByRole('tab', { name: /AI Review/ })
    await waitFor(() => expect(reviewTab).toHaveAttribute('aria-selected', 'true'))
    expect(await screen.findByRole('button', { name: 'Accept change 1' })).toBeInTheDocument()
    expect(reviewTab).toHaveTextContent('1')

    await user.click(screen.getByRole('button', { name: 'Accept all' }))
    expect(screen.getByText('No active suggestion.')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Preview' }))
    const preview = screen.getByRole('article', { name: 'Markdown preview' })
    expect(within(preview).getByText('Hello there')).toBeVisible()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir web exec vitest run src/App.suggestions.test.tsx`
Expected: FAIL with `Unable to find an accessible element with the role "textbox" and name "AI instruction"`.

- [ ] **Step 3: Replace `App.tsx`**

`web/src/App.tsx`:
```tsx
import { useState } from 'react'
import { ModelProvider } from './features/ai/ModelProvider'
import { ModelSelect } from './features/ai/ModelSelect'
import { DocumentProvider, useDocument } from './features/document/DocumentProvider'
import { MarkdownEditor } from './features/editor/MarkdownEditor'
import { AppHeader } from './features/layout/AppHeader'
import { Tabs, type TabId } from './features/layout/Tabs'
import { MarkdownPreview } from './features/preview/MarkdownPreview'
import { AskAiBar } from './features/suggestions/AskAiBar'
import { countByStatus } from './features/suggestions/diff'
import { SuggestionPanel } from './features/suggestions/SuggestionPanel'
import { SuggestionProvider, useSuggestion } from './features/suggestions/SuggestionProvider'
import { ThemeProvider, useTheme } from './features/theme/ThemeProvider'

function Workspace({
  activeTab,
  onTabChange,
}: {
  activeTab: TabId
  onTabChange(id: TabId): void
}) {
  const { content, setContent, setSelection } = useDocument()
  const { theme } = useTheme()
  const { suggestion } = useSuggestion()

  const pending = suggestion ? countByStatus(suggestion.segments).pending : 0
  const reviewBadge = suggestion?.status === 'streaming' ? '…' : pending > 0 ? pending : null

  return (
    <div className="flex h-dvh flex-col bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <AppHeader>
        <ModelSelect />
      </AppHeader>
      <main className="min-h-0 flex-1">
        <Tabs
          active={activeTab}
          onChange={onTabChange}
          badges={reviewBadge === null ? undefined : { review: reviewBadge }}
          panels={{
            editor: (
              <div className="flex h-full flex-col">
                <AskAiBar />
                <div className="min-h-0 flex-1">
                  <MarkdownEditor
                    value={content}
                    onChange={setContent}
                    onSelectionChange={setSelection}
                    dark={theme === 'dark'}
                  />
                </div>
              </div>
            ),
            preview: <MarkdownPreview content={content} />,
            review: <SuggestionPanel />,
          }}
        />
      </main>
    </div>
  )
}

function AppShell() {
  const [activeTab, setActiveTab] = useState<TabId>('editor')
  return (
    <SuggestionProvider onStart={() => setActiveTab('review')}>
      <Workspace activeTab={activeTab} onTabChange={setActiveTab} />
    </SuggestionProvider>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <DocumentProvider>
        <ModelProvider>
          <AppShell />
        </ModelProvider>
      </DocumentProvider>
    </ThemeProvider>
  )
}
```
If phase 2's `App.tsx` uses different wrapper classes (e.g. around `MarkdownEditor` so CodeMirror fills the height), keep them. Only the providers, `AskAiBar`, `ModelSelect`, badges and the review panel are required changes.

- [ ] **Step 4: Update the phase 2 placeholder test**

In `web/src/App.test.tsx`, replace the `it('shows the AI Review placeholder', …)` test with:
```tsx
  it('shows the empty AI Review panel', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('tab', { name: 'AI Review' }))
    expect(screen.getByText('No active suggestion.')).toBeVisible()
  })
```

- [ ] **Step 5: Run the app tests**

Run: `pnpm --dir web exec vitest run src/App.test.tsx src/App.suggestions.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 6: Run all frontend checks**

Run:
```bash
pnpm --dir web lint && pnpm --dir web typecheck && pnpm --dir web test && pnpm --dir web build
```
Expected: lint 0 errors, typecheck exits 0, all test files pass, and the Vite build prints `✓ built in …`.

- [ ] **Step 7: Manual end-to-end check with the real backend**

In one terminal: `cd api && uv run fastapi dev app/main.py` (needs `ANTHROPIC_API_KEY` in `api/.env`). In another: `pnpm --dir web dev`. Open http://localhost:5173 and verify:
1. The header dropdown lists Claude Sonnet 5.5 (selected) and Claude Haiku 5.5. Switching models survives a reload.
2. With nothing selected, the chip says "Whole document". Select a paragraph and it says "Selection".
3. Type "make this more concise" and press Enter. The app switches to AI Review, text streams in, and Stop works.
4. After streaming, the split diff shows Before/After with highlighted words. The tab badge shows the pending count.
5. Accept one hunk. The Editor tab shows the change immediately, and the other hunk is still pending.
6. Refine is disabled after the accept. Start a new suggestion, refine it with "keep it more formal", and check that a new proposal streams in.
7. Edit the target paragraph in the editor while a suggestion is under review, then click Accept. The stale banner appears.
8. Stop the backend and ask again. The panel shows the network error with Retry/Discard, and the dropdown shows "AI unavailable" after a reload.

- [ ] **Step 8: Commit**

```bash
git add web/src/App.tsx web/src/App.test.tsx web/src/App.suggestions.test.tsx
git commit -m "feat(frontend): wire AI suggestions, review tab and model picker into the app"
```

---

## Self-review

- **Spec coverage.**
  - Model dropdown with persistence and fallback: T5.
  - SSE transport with Zod-validated events and the overview's error mapping: T3–T4.
  - Ask AI bar, auto target, Mod-Enter: T9.
  - Streaming view with Stop: T7, T10.
  - Split diff with line numbers, collapsed context, word highlights and per-hunk accept/reject: T1, T8.
  - Accept all / Reject all: T7, T10.
  - Refine with history, blocked after an accept: T6, T7, T10.
  - Stale detection: T2, T7, T10.
  - `onResolved` with before/after content for phase 5: T7.
  - Review tab auto-open and badge: T11.
  - `readOnly` diff for phase 5: T8.
- **Contract additions beyond the overview** (phases 5 and 6 may use them):
  - `useSuggestion().retry()`.
  - `discard()` reports accepted work through `onResolved`, so history doesn't miss partially reviewed suggestions.
  - `diff.ts` also exports `getHunks`, `setHunkStatuses`, `splitLines`, `countLines`.
  - `locateRegion.ts` also exports `resolveTarget`.
  - `ModelProvider.tsx` exports `MODEL_STORAGE_KEY`.
  - Test helpers live in `src/test/sse.ts` and `src/test/renderWithAi.tsx`.
- **Type consistency.**
  - `SuggestionAction` names are used the same way in T6 and T7.
  - The `StreamEvent` field is `stopReason` on the client and `stop_reason` on the wire.
  - Hunk IDs are `hunk-N`, matching the accessible names `Accept change N`.
