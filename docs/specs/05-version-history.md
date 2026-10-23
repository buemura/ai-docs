# Phase 5 — Version History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record how the document changes with AI help: each resolved AI suggestion, and each manual snapshot, becomes a version. Users can browse versions in the AI Review tab, see a read-only split diff against the previous version, and restore any older version.

**Architecture:** A pure `versionsReducer` handles appends, dedupe against the latest version, and trimming to `MAX_VERSIONS`. `VersionsProvider` keeps that state, persists it to `localStorage` (`ai-docs:versions`), and creates the initial version. `SuggestionBridge` wraps phase 4's `SuggestionProvider` and turns each `ResolvedSuggestion` into versions. The UI (`VersionTimeline`, `VersionDetail`, `VersionHistory`) reuses phase 4's `computeSegments` and `SplitDiffView` in read-only mode. `AiReviewTab` stacks the active suggestion panel above the history.

**Tech Stack:** React 19, TypeScript (strict), Zod v4, Tailwind CSS v4, Vitest + Testing Library, `diff` (via phase 4's `computeSegments`).

**Spec:** [docs/specs/00-overview.md](00-overview.md) (sections "Frontend contract → features/history", "Provider nesting", "Suggestion lifecycle" step 6).

## Global Constraints

- Node 24, pnpm, React 19, Vite, TypeScript strict, Tailwind CSS v4 (class-based `dark` variant), Zod v4, Vitest + Testing Library + jsdom.
- No external state library: React context + `useReducer`; reducers and helpers are pure and unit-tested.
- Persistence is `localStorage` only, Zod-validated on read. Key: `ai-docs:versions`, value `Version[]`.
- `Version = { id: string; createdAt: number; source: 'initial' | 'manual' | 'ai' | 'restore'; label: string; model?: string; content: string }`.
- `useVersions()` exposes exactly `{ versions (oldest first), record(input), restore(versionId) }`. `record` is a no-op if `content` equals the latest version's content. `restore` = `setContent(version.content)` + `record({ source: 'restore', label: \`Restored "${label}"\`, content })`.
- `MAX_VERSIONS = 100`.
- All interactive controls are keyboard-reachable and have accessible names. Tests query by role/name.
- No real network calls in tests; frontend tests mock `fetch`.
- TDD for every task (failing test → minimal implementation → passing test), then a Conventional Commit.
- Checks: `pnpm --dir web lint`, `pnpm --dir web typecheck`, `pnpm --dir web test`.

## Pre-flight: verify the phase 4 contracts this plan consumes

Run from the repo root:

```bash
cd web
grep -n "export function useDocument" src/features/document/DocumentProvider.tsx
grep -n "export function SuggestionProvider" src/features/suggestions/SuggestionProvider.tsx
grep -n "export function SplitDiffView" src/features/suggestions/SplitDiffView.tsx
grep -n "readOnly" src/features/suggestions/SplitDiffView.tsx
grep -n "export function SuggestionPanel" src/features/suggestions/SuggestionPanel.tsx
grep -n "export function useModels" src/features/ai/ModelProvider.tsx
grep -n "export function computeSegments" src/features/suggestions/diff.ts
grep -n "SuggestionProvider\|SuggestionPanel\|export default" src/App.tsx
```

Expected: each command prints at least one matching line. This plan assumes:

1. `useDocument` is exported from `features/document/DocumentProvider.tsx`, and `DocumentProvider` initializes `content` **synchronously** from `localStorage` on its first render (lazy `useState` initializer). Task 2's first test enforces this.
2. `SplitDiffView` is a named export that accepts `{ segments: DiffSegment[]; readOnly?: boolean }`, and its hunk-action callbacks are optional when `readOnly` is true.
3. `SuggestionPanel` is a named export with no required props, and it renders its own empty state when no suggestion is active.
4. `useModels` is exported from `features/ai/ModelProvider.tsx`.
5. `src/App.tsx` default-exports `App` (`ThemeProvider` → `DocumentProvider` → `ModelProvider` → `AppShell`). `AppShell` holds `const [activeTab, setActiveTab] = useState<TabId>('editor')` and renders `<SuggestionProvider onStart={() => setActiveTab('review')}>` around `<Workspace activeTab={activeTab} onTabChange={setActiveTab} />`, whose `review` panel is `<SuggestionPanel />`.

If a name or path differs, use the real one in this plan's imports. Do not rename phase 4 code.

## File structure

| File | Responsibility |
|---|---|
| `web/src/features/history/types.ts` | Zod schemas, `Version` / `VersionSource` / `VersionInput` types, `MAX_VERSIONS`, storage key |
| `web/src/features/history/versionsReducer.ts` | Pure helpers: `appendVersion`, `versionsReducer`, `trimForQuota`, `versionsForResolution` |
| `web/src/features/history/VersionsProvider.tsx` | Context, load/save, initial version, `record`, `restore`, `useVersions` |
| `web/src/features/history/SuggestionBridge.tsx` | Wraps `SuggestionProvider`; turns resolved suggestions into versions |
| `web/src/features/history/relativeTime.ts` | `formatRelativeTime(timestamp, now)` |
| `web/src/features/history/VersionTimeline.tsx` | Newest-first list of versions, selectable |
| `web/src/features/history/VersionDetail.tsx` | Read-only diff against the previous version + Restore |
| `web/src/features/history/VersionHistory.tsx` | Section: heading, Save snapshot, timeline + detail |
| `web/src/features/history/AiReviewTab.tsx` | `SuggestionPanel` above `VersionHistory` |
| `web/src/App.tsx` | Final provider nesting; review panel → `AiReviewTab` |

`SuggestionBridge.tsx`, `relativeTime.ts`, and `VersionHistory.tsx` are additions to the overview's file map; they all live in `features/history/`.

---

### Task 1: Version types and pure reducer

**Files:**
- Create: `web/src/features/history/types.ts`
- Create: `web/src/features/history/versionsReducer.ts`
- Test: `web/src/features/history/types.test.ts`
- Test: `web/src/features/history/versionsReducer.test.ts`

**Interfaces:**
- Consumes: `ResolvedSuggestion`, `RefineTurn` from `features/suggestions/types.ts` (phase 4).
- Produces:
  - `VersionSourceSchema`, `VersionSchema`, `VersionsSchema` (Zod)
  - `type VersionSource = 'initial' | 'manual' | 'ai' | 'restore'`
  - `type Version = { id: string; createdAt: number; source: VersionSource; label: string; model?: string; content: string }`
  - `type VersionInput = Omit<Version, 'id' | 'createdAt'>`
  - `MAX_VERSIONS = 100`, `QUOTA_FALLBACK_KEEP = 20`, `VERSIONS_STORAGE_KEY = 'ai-docs:versions'`
  - `appendVersion(versions: Version[], version: Version, max?: number): Version[]`
  - `type VersionsAction = { type: 'record'; version: Version }`
  - `versionsReducer(state: Version[], action: VersionsAction): Version[]`
  - `trimForQuota(versions: Version[], keep?: number): Version[]`
  - `versionsForResolution(resolved: ResolvedSuggestion, latestContent: string | null): VersionInput[]`

- [ ] **Step 1: Write the failing tests**

`web/src/features/history/types.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { MAX_VERSIONS, VERSIONS_STORAGE_KEY, VersionSchema, VersionsSchema } from './types'

describe('VersionSchema', () => {
  it('accepts a valid version with and without a model', () => {
    const base = { id: 'a', createdAt: 1, source: 'ai', label: 'Shorter', content: '# Hi\n' }
    expect(VersionSchema.parse(base)).toEqual(base)
    expect(VersionSchema.parse({ ...base, model: 'claude-sonnet-5-5' }).model).toBe('claude-sonnet-5-5')
  })

  it('rejects an unknown source', () => {
    const result = VersionSchema.safeParse({
      id: 'a',
      createdAt: 1,
      source: 'robot',
      label: 'x',
      content: '',
    })
    expect(result.success).toBe(false)
  })

  it('rejects an empty id', () => {
    const result = VersionSchema.safeParse({
      id: '',
      createdAt: 1,
      source: 'manual',
      label: 'x',
      content: '',
    })
    expect(result.success).toBe(false)
  })

  it('parses an array of versions', () => {
    const list = [{ id: 'a', createdAt: 1, source: 'initial', label: 'Initial version', content: '' }]
    expect(VersionsSchema.parse(list)).toEqual(list)
  })

  it('exposes the shared constants', () => {
    expect(MAX_VERSIONS).toBe(100)
    expect(VERSIONS_STORAGE_KEY).toBe('ai-docs:versions')
  })
})
```

`web/src/features/history/versionsReducer.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { ResolvedSuggestion } from '../suggestions/types'
import type { Version, VersionSource } from './types'
import {
  appendVersion,
  trimForQuota,
  versionsForResolution,
  versionsReducer,
} from './versionsReducer'

function v(id: string, content: string, source: VersionSource = 'manual'): Version {
  return { id, createdAt: 0, source, label: id, content }
}

function resolved(overrides: Partial<ResolvedSuggestion> = {}): ResolvedSuggestion {
  return {
    instruction: 'Shorter',
    history: [],
    model: 'claude-sonnet-5-5',
    contentBefore: 'a\n',
    contentAfter: 'b\n',
    acceptedCount: 1,
    totalCount: 1,
    ...overrides,
  }
}

describe('appendVersion', () => {
  it('appends to the end (oldest first)', () => {
    const next = appendVersion([v('1', 'a')], v('2', 'b'))
    expect(next.map((x) => x.id)).toEqual(['1', '2'])
  })

  it('returns the same array when content equals the latest version', () => {
    const list = [v('1', 'a'), v('2', 'b')]
    expect(appendVersion(list, v('3', 'b'))).toBe(list)
  })

  it('allows content that matches an older, non-latest version', () => {
    const next = appendVersion([v('1', 'a'), v('2', 'b')], v('3', 'a'))
    expect(next.map((x) => x.id)).toEqual(['1', '2', '3'])
  })

  it('appends to an empty list', () => {
    expect(appendVersion([], v('1', 'a')).map((x) => x.id)).toEqual(['1'])
  })

  it('trims the oldest versions beyond MAX_VERSIONS, keeping the newest', () => {
    const list = Array.from({ length: 100 }, (_, i) => v(`v${i}`, `c${i}`))
    const next = appendVersion(list, v('new', 'fresh'))
    expect(next).toHaveLength(100)
    expect(next[0].id).toBe('v1')
    expect(next.at(-1)?.id).toBe('new')
  })

  it('honours a custom max', () => {
    const next = appendVersion([v('1', 'a'), v('2', 'b'), v('3', 'c')], v('4', 'd'), 3)
    expect(next.map((x) => x.id)).toEqual(['2', '3', '4'])
  })
})

describe('versionsReducer', () => {
  it('records a version via appendVersion', () => {
    const state = [v('1', 'a')]
    expect(versionsReducer(state, { type: 'record', version: v('2', 'b') }).map((x) => x.id)).toEqual([
      '1',
      '2',
    ])
    expect(versionsReducer(state, { type: 'record', version: v('2', 'a') })).toBe(state)
  })
})

describe('trimForQuota', () => {
  it('keeps the newest 20 versions by default', () => {
    const list = Array.from({ length: 30 }, (_, i) => v(`v${i}`, `c${i}`))
    const trimmed = trimForQuota(list)
    expect(trimmed).toHaveLength(20)
    expect(trimmed[0].id).toBe('v10')
    expect(trimmed.at(-1)?.id).toBe('v29')
  })

  it('returns everything when the list is already short', () => {
    const list = [v('1', 'a')]
    expect(trimForQuota(list)).toEqual(list)
  })
})

describe('versionsForResolution', () => {
  it('records only the AI version when nothing changed since the latest version', () => {
    expect(versionsForResolution(resolved(), 'a\n')).toEqual([
      { source: 'ai', label: 'Shorter', model: 'claude-sonnet-5-5', content: 'b\n' },
    ])
  })

  it('records manual edits first when the document drifted from the latest version', () => {
    expect(versionsForResolution(resolved({ contentBefore: 'a edited\n' }), 'a\n')).toEqual([
      { source: 'manual', label: 'Manual edits', content: 'a edited\n' },
      { source: 'ai', label: 'Shorter', model: 'claude-sonnet-5-5', content: 'b\n' },
    ])
  })

  it('records manual edits when there is no version yet', () => {
    expect(versionsForResolution(resolved(), null).map((x) => x.source)).toEqual(['manual', 'ai'])
  })

  it('labels the AI version with the refine chain', () => {
    const [ai] = versionsForResolution(
      resolved({
        instruction: 'Shorter',
        history: [
          { instruction: 'Formal', proposal: 'x' },
          { instruction: 'Add a summary', proposal: 'y' },
        ],
      }),
      'a\n',
    )
    expect(ai.label).toBe('Formal → Add a summary → Shorter')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --dir web test src/features/history/types.test.ts src/features/history/versionsReducer.test.ts`
Expected: FAIL with `Failed to resolve import "./types"` and `Failed to resolve import "./versionsReducer"`.

- [ ] **Step 3: Write the implementation**

`web/src/features/history/types.ts`:

```ts
import { z } from 'zod'

export const VERSIONS_STORAGE_KEY = 'ai-docs:versions'
export const MAX_VERSIONS = 100
export const QUOTA_FALLBACK_KEEP = 20

export const VersionSourceSchema = z.enum(['initial', 'manual', 'ai', 'restore'])

export const VersionSchema = z.object({
  id: z.string().min(1),
  createdAt: z.number(),
  source: VersionSourceSchema,
  label: z.string(),
  model: z.string().optional(),
  content: z.string(),
})

export const VersionsSchema = z.array(VersionSchema)

export type VersionSource = z.infer<typeof VersionSourceSchema>
export type Version = z.infer<typeof VersionSchema>
export type VersionInput = Omit<Version, 'id' | 'createdAt'>
```

`web/src/features/history/versionsReducer.ts`:

```ts
import type { ResolvedSuggestion } from '../suggestions/types'
import { MAX_VERSIONS, QUOTA_FALLBACK_KEEP, type Version, type VersionInput } from './types'

export type VersionsAction = { type: 'record'; version: Version }

export function appendVersion(versions: Version[], version: Version, max = MAX_VERSIONS): Version[] {
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
  const label = [...resolved.history.map((turn) => turn.instruction), resolved.instruction].join(' → ')
  entries.push({ source: 'ai', label, model: resolved.model, content: resolved.contentAfter })
  return entries
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --dir web test src/features/history/types.test.ts src/features/history/versionsReducer.test.ts`
Expected: PASS (both files, all tests green).

- [ ] **Step 5: Commit**

```bash
git add web/src/features/history/types.ts web/src/features/history/types.test.ts web/src/features/history/versionsReducer.ts web/src/features/history/versionsReducer.test.ts
git commit -m "feat(history): add version schema and pure versions reducer"
```

---

### Task 2: VersionsProvider and useVersions

**Files:**
- Create: `web/src/features/history/VersionsProvider.tsx`
- Test: `web/src/features/history/VersionsProvider.test.tsx`

**Interfaces:**
- Consumes: `loadJson`, `saveJson` (`lib/storage.ts`); `createId` (`lib/id.ts`); `useDocument`, `DocumentProvider` (`features/document/DocumentProvider.tsx`); everything from Task 1.
- Produces:
  - `VersionsProvider({ children }: { children: ReactNode }): JSX.Element`
  - `useVersions(): { versions: Version[]; record(input: VersionInput): void; restore(versionId: string): void }`. It throws if used outside the provider.
  - Behavior: loads `ai-docs:versions` (trimmed to `MAX_VERSIONS`). If none are stored, it starts with one `{ source: 'initial', label: 'Initial version', content: <current document> }`. It saves on every change. If a save fails, it saves `trimForQuota(versions)` once; in-memory state stays complete.

- [ ] **Step 1: Write the failing test**

`web/src/features/history/VersionsProvider.test.tsx`:

```tsx
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentProvider, useDocument } from '../document/DocumentProvider'
import type { Version } from './types'
import { useVersions, VersionsProvider } from './VersionsProvider'

const DOC_KEY = 'ai-docs:document'
const VERSIONS_KEY = 'ai-docs:versions'

function seedDocument(content: string) {
  localStorage.setItem(DOC_KEY, JSON.stringify({ content, updatedAt: 1 }))
}

function seedVersions(versions: Version[]) {
  localStorage.setItem(VERSIONS_KEY, JSON.stringify(versions))
}

function stored(): Version[] {
  return JSON.parse(localStorage.getItem(VERSIONS_KEY) ?? '[]') as Version[]
}

function Probe() {
  const { versions, record, restore } = useVersions()
  const { content } = useDocument()
  return (
    <div>
      <output data-testid="content">{content}</output>
      <output data-testid="versions">
        {JSON.stringify(versions.map(({ source, label, content: c }) => ({ source, label, content: c })))}
      </output>
      <button type="button" onClick={() => record({ source: 'manual', label: 'Snap', content: 'changed\n' })}>
        record
      </button>
      <button
        type="button"
        onClick={() => record({ source: 'manual', label: 'Dup', content: versions.at(-1)?.content ?? '' })}
      >
        dup
      </button>
      <button type="button" onClick={() => restore(versions[0].id)}>
        restore-first
      </button>
    </div>
  )
}

function renderProbe() {
  return render(
    <DocumentProvider>
      <VersionsProvider>
        <Probe />
      </VersionsProvider>
    </DocumentProvider>,
  )
}

function shownVersions() {
  return JSON.parse(screen.getByTestId('versions').textContent ?? '[]') as Array<Pick<Version, 'source' | 'label' | 'content'>>
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('VersionsProvider', () => {
  it('records an initial version of the stored document when history is empty', () => {
    seedDocument('# Hello\n')
    renderProbe()
    expect(shownVersions()).toEqual([{ source: 'initial', label: 'Initial version', content: '# Hello\n' }])
    expect(stored()).toHaveLength(1)
  })

  it('loads stored versions without adding an initial version', () => {
    seedDocument('# Hello\n')
    seedVersions([{ id: 'v1', createdAt: 1, source: 'ai', label: 'Shorter', content: '# Hi\n' }])
    renderProbe()
    expect(shownVersions()).toEqual([{ source: 'ai', label: 'Shorter', content: '# Hi\n' }])
  })

  it('falls back to an initial version when stored data is invalid', () => {
    seedDocument('# Hello\n')
    localStorage.setItem(VERSIONS_KEY, JSON.stringify([{ nope: true }]))
    renderProbe()
    expect(shownVersions().map((x) => x.source)).toEqual(['initial'])
  })

  it('records and persists a new version', async () => {
    seedDocument('# Hello\n')
    renderProbe()
    await userEvent.click(screen.getByRole('button', { name: 'record' }))
    expect(shownVersions().map((x) => x.label)).toEqual(['Initial version', 'Snap'])
    expect(stored().map((x) => x.label)).toEqual(['Initial version', 'Snap'])
    expect(stored()[1].id).not.toBe('')
    expect(typeof stored()[1].createdAt).toBe('number')
  })

  it('ignores a record whose content equals the latest version', async () => {
    seedDocument('# Hello\n')
    renderProbe()
    await userEvent.click(screen.getByRole('button', { name: 'dup' }))
    expect(shownVersions()).toHaveLength(1)
  })

  it('restores a version into the document and records a restore version', async () => {
    seedDocument('# Hello\n')
    renderProbe()
    await userEvent.click(screen.getByRole('button', { name: 'record' }))
    await userEvent.click(screen.getByRole('button', { name: 'restore-first' }))
    expect(screen.getByTestId('content').textContent).toBe('# Hello\n')
    expect(shownVersions().at(-1)).toEqual({
      source: 'restore',
      label: 'Restored "Initial version"',
      content: '# Hello\n',
    })
  })

  it('persists only the newest 20 versions when saving hits the storage quota', () => {
    seedDocument('# Hello\n')
    seedVersions(
      Array.from({ length: 30 }, (_, i) => ({
        id: `v${i}`,
        createdAt: i,
        source: 'manual' as const,
        label: `L${i}`,
        content: `c${i}`,
      })),
    )
    const realSetItem = Storage.prototype.setItem
    let failed = false
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === VERSIONS_KEY && !failed) {
        failed = true
        throw new DOMException('full', 'QuotaExceededError')
      }
      realSetItem.call(this, key, value)
    })
    act(() => {
      renderProbe()
    })
    expect(stored()).toHaveLength(20)
    expect(stored()[0].id).toBe('v10')
    expect(stored().at(-1)?.id).toBe('v29')
    expect(shownVersions()).toHaveLength(30)
  })

  it('throws when useVersions is used outside the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    function Orphan() {
      useVersions()
      return null
    }
    expect(() => render(<Orphan />)).toThrow('useVersions must be used within a VersionsProvider')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --dir web test src/features/history/VersionsProvider.test.tsx`
Expected: FAIL with `Failed to resolve import "./VersionsProvider"`.

- [ ] **Step 3: Write the implementation**

`web/src/features/history/VersionsProvider.tsx`:

```tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react'
import { createId } from '../../lib/id'
import { loadJson, saveJson } from '../../lib/storage'
import { useDocument } from '../document/DocumentProvider'
import { MAX_VERSIONS, VERSIONS_STORAGE_KEY, VersionsSchema, type Version, type VersionInput } from './types'
import { trimForQuota, versionsReducer } from './versionsReducer'

type VersionsContextValue = {
  versions: Version[]
  record(input: VersionInput): void
  restore(versionId: string): void
}

const VersionsContext = createContext<VersionsContextValue | null>(null)

function createVersion(input: VersionInput): Version {
  return { ...input, id: createId(), createdAt: Date.now() }
}

function loadInitialVersions(content: string): Version[] {
  const stored = loadJson(VERSIONS_STORAGE_KEY, VersionsSchema, [])
  if (stored.length > 0) return stored.slice(-MAX_VERSIONS)
  return [createVersion({ source: 'initial', label: 'Initial version', content })]
}

export function VersionsProvider({ children }: { children: ReactNode }) {
  const { content, setContent } = useDocument()
  const [versions, dispatch] = useReducer(versionsReducer, content, loadInitialVersions)

  useEffect(() => {
    if (!saveJson(VERSIONS_STORAGE_KEY, versions)) {
      saveJson(VERSIONS_STORAGE_KEY, trimForQuota(versions))
    }
  }, [versions])

  const record = useCallback((input: VersionInput) => {
    dispatch({ type: 'record', version: createVersion(input) })
  }, [])

  const restore = useCallback(
    (versionId: string) => {
      const target = versions.find((version) => version.id === versionId)
      if (!target) return
      setContent(target.content)
      record({ source: 'restore', label: `Restored "${target.label}"`, content: target.content })
    },
    [versions, setContent, record],
  )

  const value = useMemo(() => ({ versions, record, restore }), [versions, record, restore])

  return <VersionsContext value={value}>{children}</VersionsContext>
}

export function useVersions(): VersionsContextValue {
  const context = useContext(VersionsContext)
  if (!context) throw new Error('useVersions must be used within a VersionsProvider')
  return context
}
```

Note: if phase 2's `DocumentProvider` uses `<Context.Provider value>`, match that style here instead of `<VersionsContext value>` (both are valid in React 19).

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --dir web test src/features/history/VersionsProvider.test.tsx`
Expected: PASS (8 tests). If the first test shows phase 2's `initialContent` instead of `# Hello\n`, then `DocumentProvider` loads in an effect rather than a lazy initializer. Fix it in `DocumentProvider` (lazy `useState(() => loadJson(...))`) and add that change to this commit.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/history/VersionsProvider.tsx web/src/features/history/VersionsProvider.test.tsx
git commit -m "feat(history): add VersionsProvider with persistence and restore"
```

---

### Task 3: SuggestionBridge — record versions when a suggestion resolves

**Files:**
- Create: `web/src/features/history/SuggestionBridge.tsx`
- Test: `web/src/features/history/SuggestionBridge.test.tsx`

**Interfaces:**
- Consumes: `SuggestionProvider` (phase 4, props `{ children; onResolved?(r: ResolvedSuggestion): void; onStart?(): void }`); `useVersions` (Task 2); `versionsForResolution` (Task 1).
- Produces: `SuggestionBridge({ children, onStart }: { children: ReactNode; onStart?: () => void }): JSX.Element`.

- [ ] **Step 1: Write the failing test**

`web/src/features/history/SuggestionBridge.test.tsx`:

```tsx
import { act, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { DocumentProvider } from '../document/DocumentProvider'
import type { ResolvedSuggestion } from '../suggestions/types'
import { SuggestionBridge } from './SuggestionBridge'
import { useVersions, VersionsProvider } from './VersionsProvider'

const captured = vi.hoisted(
  () => ({}) as { onResolved?: (r: ResolvedSuggestion) => void; onStart?: () => void },
)

vi.mock('../suggestions/SuggestionProvider', () => ({
  SuggestionProvider: ({
    children,
    onResolved,
    onStart,
  }: {
    children: ReactNode
    onResolved?: (r: ResolvedSuggestion) => void
    onStart?: () => void
  }) => {
    captured.onResolved = onResolved
    captured.onStart = onStart
    return <>{children}</>
  },
}))

function VersionsProbe() {
  const { versions } = useVersions()
  return (
    <output data-testid="versions">
      {JSON.stringify(versions.map(({ source, label, model, content }) => ({ source, label, model, content })))}
    </output>
  )
}

function renderBridge(onStart?: () => void) {
  localStorage.setItem('ai-docs:document', JSON.stringify({ content: '# Hello\n', updatedAt: 1 }))
  return render(
    <DocumentProvider>
      <VersionsProvider>
        <SuggestionBridge onStart={onStart}>
          <VersionsProbe />
        </SuggestionBridge>
      </VersionsProvider>
    </DocumentProvider>,
  )
}

function shownVersions() {
  return JSON.parse(screen.getByTestId('versions').textContent ?? '[]') as unknown[]
}

function resolved(overrides: Partial<ResolvedSuggestion> = {}): ResolvedSuggestion {
  return {
    instruction: 'Shorter',
    history: [],
    model: 'claude-sonnet-5-5',
    contentBefore: '# Hello\n',
    contentAfter: '# Hi\n',
    acceptedCount: 1,
    totalCount: 1,
    ...overrides,
  }
}

describe('SuggestionBridge', () => {
  it('records an AI version labelled with the refine chain', () => {
    renderBridge()
    act(() => {
      captured.onResolved?.(resolved({ history: [{ instruction: 'Formal', proposal: 'x' }] }))
    })
    expect(shownVersions()).toEqual([
      { source: 'initial', label: 'Initial version', content: '# Hello\n' },
      { source: 'ai', label: 'Formal → Shorter', model: 'claude-sonnet-5-5', content: '# Hi\n' },
    ])
  })

  it('records manual edits before the AI version when the document drifted', () => {
    renderBridge()
    act(() => {
      captured.onResolved?.(resolved({ contentBefore: '# Hello edited\n' }))
    })
    expect(shownVersions()).toEqual([
      { source: 'initial', label: 'Initial version', content: '# Hello\n' },
      { source: 'manual', label: 'Manual edits', content: '# Hello edited\n' },
      { source: 'ai', label: 'Shorter', model: 'claude-sonnet-5-5', content: '# Hi\n' },
    ])
  })

  it('passes onStart through to SuggestionProvider', () => {
    const onStart = vi.fn()
    renderBridge(onStart)
    captured.onStart?.()
    expect(onStart).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --dir web test src/features/history/SuggestionBridge.test.tsx`
Expected: FAIL with `Failed to resolve import "./SuggestionBridge"`.

- [ ] **Step 3: Write the implementation**

`web/src/features/history/SuggestionBridge.tsx`:

```tsx
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --dir web test src/features/history/SuggestionBridge.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/features/history/SuggestionBridge.tsx web/src/features/history/SuggestionBridge.test.tsx
git commit -m "feat(history): record versions when AI suggestions resolve"
```

---

### Task 4: Relative time helper and VersionTimeline

**Files:**
- Create: `web/src/features/history/relativeTime.ts`
- Create: `web/src/features/history/VersionTimeline.tsx`
- Test: `web/src/features/history/relativeTime.test.ts`
- Test: `web/src/features/history/VersionTimeline.test.tsx`

**Interfaces:**
- Consumes: `Version`, `VersionSource` (Task 1).
- Produces:
  - `formatRelativeTime(timestamp: number, now: number, locale?: string): string` (`"just now"` under 45 s; otherwise `Intl.RelativeTimeFormat` with `numeric: 'auto'`)
  - `VersionTimeline(props: { versions: Version[]; selectedId: string | null; onSelect(id: string): void; getModelLabel?(id: string): string; now?: number }): JSX.Element`. It renders newest first as `<ol aria-label="Versions">`, one button per version, with `aria-current="true"` on the selected one.

- [ ] **Step 1: Write the failing tests**

`web/src/features/history/relativeTime.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { formatRelativeTime } from './relativeTime'

const NOW = Date.UTC(2026, 9, 22, 12, 0, 0)

describe('formatRelativeTime', () => {
  it('says "just now" for anything under 45 seconds', () => {
    expect(formatRelativeTime(NOW - 10_000, NOW)).toBe('just now')
    expect(formatRelativeTime(NOW, NOW)).toBe('just now')
  })

  it('formats minutes, hours and days in the past', () => {
    expect(formatRelativeTime(NOW - 2 * 60_000, NOW)).toBe('2 minutes ago')
    expect(formatRelativeTime(NOW - 3 * 3_600_000, NOW)).toBe('3 hours ago')
    expect(formatRelativeTime(NOW - 25 * 3_600_000, NOW)).toBe('yesterday')
    expect(formatRelativeTime(NOW - 3 * 86_400_000, NOW)).toBe('3 days ago')
  })
})
```

`web/src/features/history/VersionTimeline.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Version } from './types'
import { VersionTimeline } from './VersionTimeline'

const NOW = Date.UTC(2026, 9, 22, 12, 0, 0)

const versions: Version[] = [
  { id: 'a', createdAt: NOW - 3 * 3_600_000, source: 'initial', label: 'Initial version', content: '' },
  {
    id: 'b',
    createdAt: NOW - 2 * 60_000,
    source: 'ai',
    label: 'Make it shorter',
    model: 'claude-sonnet-5-5',
    content: 'x',
  },
  { id: 'c', createdAt: NOW - 5_000, source: 'manual', label: 'Snapshot', content: 'y' },
]

function renderTimeline(overrides: Partial<Parameters<typeof VersionTimeline>[0]> = {}) {
  const onSelect = vi.fn()
  render(
    <VersionTimeline
      versions={versions}
      selectedId="b"
      onSelect={onSelect}
      getModelLabel={(id) => (id === 'claude-sonnet-5-5' ? 'Claude Sonnet 5.5' : id)}
      now={NOW}
      {...overrides}
    />,
  )
  return { onSelect }
}

describe('VersionTimeline', () => {
  it('lists versions newest first with badge, label and relative time', () => {
    renderTimeline()
    const list = screen.getByRole('list', { name: 'Versions' })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(within(items[0]).getByText('Snapshot')).toBeInTheDocument()
    expect(within(items[0]).getByText('Manual')).toBeInTheDocument()
    expect(within(items[0]).getByText('just now')).toBeInTheDocument()
    expect(within(items[1]).getByText('Make it shorter')).toBeInTheDocument()
    expect(within(items[1]).getByText('AI')).toBeInTheDocument()
    expect(within(items[1]).getByText('2 minutes ago')).toBeInTheDocument()
    expect(within(items[2]).getByText('Initial')).toBeInTheDocument()
    expect(within(items[2]).getByText('3 hours ago')).toBeInTheDocument()
  })

  it('shows the model label for AI versions only', () => {
    renderTimeline()
    const items = screen.getAllByRole('listitem')
    expect(within(items[1]).getByText('Claude Sonnet 5.5')).toBeInTheDocument()
    expect(within(items[0]).queryByText('Claude Sonnet 5.5')).not.toBeInTheDocument()
  })

  it('marks the selected version with aria-current', () => {
    renderTimeline()
    const items = screen.getAllByRole('listitem')
    expect(within(items[1]).getByRole('button')).toHaveAttribute('aria-current', 'true')
    expect(within(items[0]).getByRole('button')).not.toHaveAttribute('aria-current')
  })

  it('calls onSelect with the clicked version id', async () => {
    const { onSelect } = renderTimeline()
    const items = screen.getAllByRole('listitem')
    await userEvent.click(within(items[2]).getByRole('button'))
    expect(onSelect).toHaveBeenCalledWith('a')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --dir web test src/features/history/relativeTime.test.ts src/features/history/VersionTimeline.test.tsx`
Expected: FAIL with `Failed to resolve import "./relativeTime"` and `Failed to resolve import "./VersionTimeline"`.

- [ ] **Step 3: Write the implementation**

`web/src/features/history/relativeTime.ts`:

```ts
const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['week', 604_800],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
]

export function formatRelativeTime(timestamp: number, now: number, locale = 'en'): string {
  const diffSeconds = Math.round((timestamp - now) / 1000)
  if (Math.abs(diffSeconds) < 45) return 'just now'
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  for (const [unit, seconds] of UNITS) {
    if (Math.abs(diffSeconds) >= seconds) return formatter.format(Math.round(diffSeconds / seconds), unit)
  }
  return formatter.format(diffSeconds, 'second')
}
```

`web/src/features/history/VersionTimeline.tsx`:

```tsx
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

export function VersionTimeline({
  versions,
  selectedId,
  onSelect,
  getModelLabel = identity,
  now = Date.now(),
}: VersionTimelineProps) {
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
              className={`w-full rounded-md border px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 ${
                selected
                  ? 'border-violet-400 bg-violet-50 dark:border-violet-500 dark:bg-violet-950/40'
                  : 'border-transparent hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <span className="flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${SOURCE_CLASS[version.source]}`}>
                  {SOURCE_LABEL[version.source]}
                </span>
                <time
                  dateTime={new Date(version.createdAt).toISOString()}
                  className="text-xs text-slate-500 dark:text-slate-400"
                >
                  {formatRelativeTime(version.createdAt, now)}
                </time>
              </span>
              <span className="mt-1 block truncate text-sm text-slate-900 dark:text-slate-100">{version.label}</span>
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --dir web test src/features/history/relativeTime.test.ts src/features/history/VersionTimeline.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/features/history/relativeTime.ts web/src/features/history/relativeTime.test.ts web/src/features/history/VersionTimeline.tsx web/src/features/history/VersionTimeline.test.tsx
git commit -m "feat(history): add version timeline with relative timestamps"
```

---

### Task 5: VersionDetail — read-only diff and restore

**Files:**
- Create: `web/src/features/history/VersionDetail.tsx`
- Test: `web/src/features/history/VersionDetail.test.tsx`

**Interfaces:**
- Consumes: `computeSegments` (`features/suggestions/diff.ts`); `SplitDiffView` (`features/suggestions/SplitDiffView.tsx`, `{ segments; readOnly? }`); `Version` (Task 1).
- Produces: `VersionDetail(props: { version: Version; previous: Version | null; isLatest: boolean; onRestore(): void }): JSX.Element`. It diffs `previous?.content ?? ''` → `version.content`, shows "No changes" when there are no change segments, and renders a "Restore this version" button that is disabled when `isLatest`.

- [ ] **Step 1: Write the failing test**

`web/src/features/history/VersionDetail.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { DiffSegment } from '../suggestions/types'
import type { Version } from './types'
import { VersionDetail } from './VersionDetail'

vi.mock('../suggestions/SplitDiffView', () => ({
  SplitDiffView: ({ segments, readOnly }: { segments: DiffSegment[]; readOnly?: boolean }) => (
    <div data-testid="diff" data-readonly={String(readOnly)}>
      {segments.map((segment) => segment.kind).join(',')}
    </div>
  ),
}))

function version(id: string, content: string, label = id): Version {
  return { id, createdAt: 0, source: 'manual', label, content }
}

describe('VersionDetail', () => {
  it('renders a read-only diff from the previous version', () => {
    render(
      <VersionDetail
        version={version('b', '# Title\n\nNew line\n', 'Make it shorter')}
        previous={version('a', '# Title\n\nOld line\n')}
        isLatest
        onRestore={vi.fn()}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Make it shorter' })).toBeInTheDocument()
    expect(screen.getByText('Compared with the previous version')).toBeInTheDocument()
    const diff = screen.getByTestId('diff')
    expect(diff).toHaveAttribute('data-readonly', 'true')
    expect(diff.textContent).toContain('change')
  })

  it('diffs the first version against an empty document', () => {
    render(<VersionDetail version={version('a', '# Hello\n')} previous={null} isLatest onRestore={vi.fn()} />)
    expect(screen.getByText('Compared with an empty document')).toBeInTheDocument()
    expect(screen.getByTestId('diff').textContent).toContain('change')
  })

  it('says "No changes" when the content is identical', () => {
    render(
      <VersionDetail version={version('b', 'same\n')} previous={version('a', 'same\n')} isLatest onRestore={vi.fn()} />,
    )
    expect(screen.getByText('No changes')).toBeInTheDocument()
    expect(screen.queryByTestId('diff')).not.toBeInTheDocument()
  })

  it('disables restore for the latest version', () => {
    render(<VersionDetail version={version('a', 'x')} previous={null} isLatest onRestore={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Restore this version' })).toBeDisabled()
  })

  it('calls onRestore for an older version', async () => {
    const onRestore = vi.fn()
    render(<VersionDetail version={version('a', 'x')} previous={null} isLatest={false} onRestore={onRestore} />)
    await userEvent.click(screen.getByRole('button', { name: 'Restore this version' }))
    expect(onRestore).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --dir web test src/features/history/VersionDetail.test.tsx`
Expected: FAIL with `Failed to resolve import "./VersionDetail"`.

- [ ] **Step 3: Write the implementation**

`web/src/features/history/VersionDetail.tsx`:

```tsx
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
  const segments = useMemo(
    () => computeSegments(previous?.content ?? '', version.content),
    [previous?.content, version.content],
  )
  const hasChanges = segments.some((segment) => segment.kind === 'change')

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-slate-900 dark:text-slate-100">{version.label}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {previous ? 'Compared with the previous version' : 'Compared with an empty document'}
          </p>
        </div>
        <button
          type="button"
          onClick={onRestore}
          disabled={isLatest}
          title={isLatest ? 'This is the current version' : undefined}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --dir web test src/features/history/VersionDetail.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/features/history/VersionDetail.tsx web/src/features/history/VersionDetail.test.tsx
git commit -m "feat(history): show read-only diff between versions with restore"
```

---

### Task 6: VersionHistory section with Save snapshot

**Files:**
- Create: `web/src/features/history/VersionHistory.tsx`
- Test: `web/src/features/history/VersionHistory.test.tsx`

**Interfaces:**
- Consumes: `useVersions` (Task 2), `useDocument` (phase 2), `VersionTimeline` (Task 4), `VersionDetail` (Task 5).
- Produces: `VersionHistory(props: { getModelLabel?(id: string): string }): JSX.Element`. It renders a `<section>` labelled by an `h2` "Version history" and a "Save snapshot" button. The button records `{ source: 'manual', label: 'Snapshot', content }` and is disabled while the document equals the latest version. The timeline and detail show the latest version by default.

- [ ] **Step 1: Write the failing test**

`web/src/features/history/VersionHistory.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DocumentProvider, useDocument } from '../document/DocumentProvider'
import type { DiffSegment } from '../suggestions/types'
import { VersionHistory } from './VersionHistory'
import { VersionsProvider } from './VersionsProvider'

vi.mock('../suggestions/SplitDiffView', () => ({
  SplitDiffView: ({ segments }: { segments: DiffSegment[] }) => (
    <div data-testid="diff">{segments.map((segment) => segment.kind).join(',')}</div>
  ),
}))

function DocumentProbe() {
  const { content, setContent } = useDocument()
  return (
    <div>
      <output data-testid="content">{content}</output>
      <button type="button" onClick={() => setContent('# Edited\n')}>
        edit
      </button>
    </div>
  )
}

function renderHistory() {
  localStorage.setItem('ai-docs:document', JSON.stringify({ content: '# Hello\n', updatedAt: 1 }))
  return render(
    <DocumentProvider>
      <VersionsProvider>
        <DocumentProbe />
        <VersionHistory />
      </VersionsProvider>
    </DocumentProvider>,
  )
}

function timelineItems() {
  return within(screen.getByRole('list', { name: 'Versions' })).getAllByRole('listitem')
}

describe('VersionHistory', () => {
  it('shows the heading and the initial version selected', () => {
    renderHistory()
    expect(screen.getByRole('heading', { name: 'Version history' })).toBeInTheDocument()
    const items = timelineItems()
    expect(items).toHaveLength(1)
    expect(within(items[0]).getByRole('button')).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('heading', { name: 'Initial version' })).toBeInTheDocument()
  })

  it('enables Save snapshot only when the document changed, and records a snapshot', async () => {
    renderHistory()
    const save = screen.getByRole('button', { name: 'Save snapshot' })
    expect(save).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'edit' }))
    expect(save).toBeEnabled()
    await userEvent.click(save)
    const items = timelineItems()
    expect(items).toHaveLength(2)
    expect(within(items[0]).getByText('Snapshot')).toBeInTheDocument()
    expect(save).toBeDisabled()
  })

  it('restores an older version into the document', async () => {
    renderHistory()
    await userEvent.click(screen.getByRole('button', { name: 'edit' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save snapshot' }))
    await userEvent.click(within(timelineItems()[1]).getByRole('button'))
    expect(screen.getByRole('heading', { name: 'Initial version' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Restore this version' }))
    expect(screen.getByTestId('content').textContent).toBe('# Hello\n')
    const items = timelineItems()
    expect(items).toHaveLength(3)
    expect(within(items[0]).getByText('Restored "Initial version"')).toBeInTheDocument()
    expect(within(items[0]).getByRole('button')).toHaveAttribute('aria-current', 'true')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --dir web test src/features/history/VersionHistory.test.tsx`
Expected: FAIL with `Failed to resolve import "./VersionHistory"`.

- [ ] **Step 3: Write the implementation**

`web/src/features/history/VersionHistory.tsx`:

```tsx
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
  const foundIndex = selectedId === null ? -1 : versions.findIndex((version) => version.id === selectedId)
  const selectedIndex = foundIndex === -1 ? versions.length - 1 : foundIndex
  const selected = versions[selectedIndex] ?? null
  const previous = selectedIndex > 0 ? versions[selectedIndex - 1] : null
  const hasUnsavedChanges = latest?.content !== content

  return (
    <section aria-labelledby="version-history-heading" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 id="version-history-heading" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          Version history
        </h2>
        <button
          type="button"
          onClick={() => record({ source: 'manual', label: 'Snapshot', content })}
          disabled={!hasUnsavedChanges}
          title={hasUnsavedChanges ? undefined : 'No changes since the last version'}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --dir web test src/features/history/VersionHistory.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/features/history/VersionHistory.tsx web/src/features/history/VersionHistory.test.tsx
git commit -m "feat(history): add version history section with snapshots"
```

---

### Task 7: AiReviewTab and final App wiring

**Files:**
- Create: `web/src/features/history/AiReviewTab.tsx`
- Modify: `web/src/App.tsx` (provider nesting and the `review` panel)
- Test: `web/src/App.history.test.tsx`

**Interfaces:**
- Consumes: `SuggestionPanel` (phase 4), `useModels` (phase 4), `ModelProvider` (phase 4), `ThemeProvider`, `DocumentProvider`, `TabId` (phase 2), `VersionsProvider` (Task 2), `SuggestionBridge` (Task 3), `VersionHistory` (Task 6).
- Produces: `AiReviewTab(): JSX.Element` (no props), and `App` with the overview's final provider nesting.

- [ ] **Step 1: Write the failing integration test**

`web/src/App.history.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const modelsResponse = {
  provider: 'anthropic',
  default_model: 'claude-sonnet-5-5',
  models: [
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
    { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
  ],
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(modelsResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('App version history', () => {
  it('shows the suggestion panel and version history in the AI Review tab', async () => {
    localStorage.setItem('ai-docs:document', JSON.stringify({ content: '# Hello\n', updatedAt: 1 }))
    render(<App />)
    await userEvent.click(screen.getByRole('tab', { name: /AI Review/ }))
    expect(await screen.findByRole('heading', { name: 'Version history' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Initial version' })).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('ai-docs:versions') ?? '[]')).toHaveLength(1)
  })

  it('labels AI versions with the model label from the catalog', async () => {
    localStorage.setItem('ai-docs:document', JSON.stringify({ content: '# Hi\n', updatedAt: 2 }))
    localStorage.setItem(
      'ai-docs:versions',
      JSON.stringify([
        { id: 'a', createdAt: 1, source: 'initial', label: 'Initial version', content: '# Hello\n' },
        { id: 'b', createdAt: 2, source: 'ai', label: 'Shorter', model: 'claude-haiku-5-5', content: '# Hi\n' },
      ]),
    )
    render(<App />)
    await userEvent.click(screen.getByRole('tab', { name: /AI Review/ }))
    const timeline = await screen.findByRole('list', { name: 'Versions' })
    expect(within(timeline).getByText('Claude Haiku 5.5')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --dir web test src/App.history.test.tsx`
Expected: FAIL. `Unable to find role="heading" and name "Version history"` (the review tab still renders only `SuggestionPanel`).

- [ ] **Step 3: Create AiReviewTab**

`web/src/features/history/AiReviewTab.tsx`:

```tsx
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
    <div className="flex flex-col gap-8">
      <SuggestionPanel />
      <VersionHistory getModelLabel={getModelLabel} />
    </div>
  )
}
```

- [ ] **Step 4: Wire App.tsx to the final provider nesting**

In `web/src/App.tsx`:

1. Replace the `SuggestionProvider` import with the history imports, and drop the `SuggestionPanel` import:

```tsx
import { AiReviewTab } from './features/history/AiReviewTab'
import { SuggestionBridge } from './features/history/SuggestionBridge'
import { VersionsProvider } from './features/history/VersionsProvider'
```

2. In `Workspace`'s `panels` object, change the review entry:

```tsx
review: <AiReviewTab />,
```

3. Replace `AppShell` (phase 4 defines it as the component that owns `activeTab` and wraps `Workspace` in `SuggestionProvider`). `VersionsProvider` goes outside the bridge, and `SuggestionBridge` replaces `SuggestionProvider`. `App` itself is unchanged; it still nests `ThemeProvider` → `DocumentProvider` → `ModelProvider` → `AppShell`:

```tsx
function AppShell() {
  const [activeTab, setActiveTab] = useState<TabId>('editor')
  const openReview = useCallback(() => setActiveTab('review'), [])

  return (
    <VersionsProvider>
      <SuggestionBridge onStart={openReview}>
        <Workspace activeTab={activeTab} onTabChange={setActiveTab} />
      </SuggestionBridge>
    </VersionsProvider>
  )
}
```

Make sure `useCallback` is imported from `react` alongside `useState`.

- [ ] **Step 5: Run the integration test to verify it passes**

Run: `pnpm --dir web test src/App.history.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Run the full frontend checks**

Run: `pnpm --dir web lint && pnpm --dir web typecheck && pnpm --dir web test`
Expected: lint and typecheck exit 0 with no errors, and every Vitest file passes, including phase 2–4 suites. If an earlier `App` test asserted the review tab contains only `SuggestionPanel`, update that assertion to match the new layout. Do not delete it.

- [ ] **Step 7: Manual smoke check**

Run (two terminals): `cd api && uv run fastapi dev app/main.py`, then `pnpm --dir web dev`. Open http://localhost:5173 and check:
1. AI Review → "Version history" lists "Initial version".
2. Edit text → Save snapshot → a "Manual / Snapshot" entry appears at the top.
3. Ask AI for a change → accept a hunk → once resolved, an "AI" entry labelled with the instruction and model appears.
4. Select "Initial version" → Restore → the editor shows the original text and a "Restored …" entry is on top.
5. Reload the page → the history persists.

- [ ] **Step 8: Commit**

```bash
git add web/src/features/history/AiReviewTab.tsx web/src/App.tsx web/src/App.history.test.tsx
git commit -m "feat(history): show version history in AI Review tab and wire providers"
```

---

## Self-review checklist (run after implementing)

- [ ] Spec coverage: versions recorded on AI resolve (Task 3), manual-edit capture before AI versions (Tasks 1 and 3), snapshot (Task 6), timeline newest first with badge/time/model (Task 4), read-only diff vs previous / empty (Task 5), restore disabled on latest (Task 5), persistence with quota fallback (Task 2), `MAX_VERSIONS` trimming (Task 1), final provider nesting (Task 7).
- [ ] `useVersions` exposes only `versions`, `record`, `restore`.
- [ ] `pnpm --dir web lint && pnpm --dir web typecheck && pnpm --dir web test` all green.
