# Phase 6 — Commands & Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users trigger AI suggestions without leaving the keyboard — AI presets, a Cmd/Ctrl+K command palette, `/` slash commands in the editor, quick-action chips — and finish the app with an error boundary, an audit of disabled/loading states, a README, and an end-to-end verification pass.

**Architecture:** A pure `presets.ts` module defines the AI presets and resolves each preset's target (selection, current paragraph, or document). A `useRunPreset` hook turns a preset into `useSuggestion().start(...)`. Three entry points use it: the `cmdk` command palette, `PresetChips` in the AskAiBar, and a CodeMirror completion source for `/` commands. The slash handler waits until the document state reflects the deleted `/word` before it starts the suggestion, so `baseText` is never stale. An `ErrorBoundary` wraps the whole app.

**Tech Stack:** React 19, TypeScript (strict), Tailwind CSS v4, `cmdk`, `@codemirror/autocomplete`, `@codemirror/state`, `@codemirror/view`, Vitest + Testing Library + jsdom.

**Spec:** [docs/specs/00-overview.md](00-overview.md). This phase implements the `features/commands/` row of its file map, the `AiPreset` / `AI_PRESETS` contract, and the UX note "phase 6 adds a '⌘K' hint button".

## Global Constraints

- Node 24, pnpm, React 19, TypeScript strict, Tailwind CSS v4 (class-based `dark` variant), Zod v4, Vitest + Testing Library + jsdom.
- The AI never edits the document directly. Every preset, palette action, and slash command goes through `useSuggestion().start(...)`, so the user still accepts or rejects each hunk.
- One suggestion at a time. Every AI trigger is disabled while `useSuggestion().isBusy` is true, and also while no model is selected or the model catalog isn't `ready`.
- `AiPreset = { id: string; label: string; slash: string; instruction: string; target: 'auto' | 'document' | 'block' }` and `AI_PRESETS: AiPreset[]` live in `web/src/features/commands/presets.ts`.
- Slash command `ask` is reserved. It focuses the AskAiBar instead of running a preset.
- All interactive controls are keyboard-reachable and have accessible names. Tests query by role and name.
- No real network calls in tests. Frontend tests mock `fetch`.
- TDD for every task: failing test → minimal implementation → passing test → commit. Conventional Commits.
- Frontend checks: `pnpm --dir web lint`, `pnpm --dir web typecheck`, `pnpm --dir web test`. Backend checks: `cd api && uv run ruff check . && uv run ruff format --check . && uv run pytest`.

## Assumptions about earlier phases (verify before starting)

Phases 1–5 are assumed to follow the overview contracts exactly. This plan also relies on these concrete details, which the overview doesn't pin down. Check each one before Task 1 and adjust import paths if a phase placed something differently:

1. `TextRange` is exported from `web/src/features/document/schema.ts`; `useDocument` from `web/src/features/document/DocumentProvider.tsx`.
2. `useTheme` is exported from `web/src/features/theme/ThemeProvider.tsx`.
3. `useModels` is exported from `web/src/features/ai/ModelProvider.tsx`.
4. `useSuggestion` is exported from `web/src/features/suggestions/SuggestionProvider.tsx`; `SuggestionTarget` from `web/src/features/suggestions/types.ts`.
5. `TabId` is exported from `web/src/features/layout/Tabs.tsx`, and `Tabs` renders `role="tab"` buttons with `aria-selected`.
6. `web/src/App.tsx` defines `AppShell`, which owns `const [activeTab, setActiveTab] = useState<TabId>('editor')` and renders `<VersionsProvider><SuggestionBridge onStart={…}><Workspace activeTab={activeTab} onTabChange={setActiveTab} /></SuggestionBridge></VersionsProvider>`. `Workspace({ activeTab, onTabChange })` renders `<AppHeader><ModelSelect /></AppHeader>`, `<AskAiBar />` (in the editor panel), and `<MarkdownEditor ... />`. `AppHeader` is `AppHeader({ children }: { children?: ReactNode })`.
7. `AskAiBar` (phase 4) takes no required props and contains one instruction `<input>` and a "Suggest" submit button.
8. The `test` script in `web/package.json` is `vitest run`, and `web/src/test/setup.ts` is registered in Vitest `setupFiles`.

---

### Task 1: AI presets and target resolution

**Files:**
- Create: `web/src/features/commands/presets.ts`
- Test: `web/src/features/commands/presets.test.ts`

**Interfaces:**
- Consumes: `TextRange` (`{ from: number; to: number }`) from `features/document/schema`; `SuggestionTarget` (`'auto' | 'document' | TextRange`) from `features/suggestions/types`.
- Produces:
  - `type AiPreset = { id: string; label: string; slash: string; instruction: string; target: 'auto' | 'document' | 'block' }`
  - `const AI_PRESETS: AiPreset[]` (9 presets; ids: `improve`, `fix`, `shorten`, `expand`, `tone-professional`, `tone-casual`, `tone-friendly`, `restructure`, `tldr`)
  - `const ASK_SLASH = 'ask'`
  - `function blockRangeAt(content: string, pos: number): TextRange`: the paragraph (consecutive non-blank lines) containing `pos`, without its trailing newline; `{ from: pos, to: pos }` when `pos` is on a blank line
  - `function resolvePresetTarget(preset: AiPreset, content: string, selection: TextRange): SuggestionTarget`

- [ ] **Step 1: Write the failing test**

`web/src/features/commands/presets.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { AI_PRESETS, ASK_SLASH, blockRangeAt, resolvePresetTarget, type AiPreset } from './presets'

describe('AI_PRESETS', () => {
  it('has unique ids and slash names', () => {
    const ids = AI_PRESETS.map((p) => p.id)
    const slashes = AI_PRESETS.map((p) => p.slash)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(slashes).size).toBe(slashes.length)
  })

  it('uses lowercase dash-separated slash names and never the reserved ask name', () => {
    for (const preset of AI_PRESETS) {
      expect(preset.slash).toMatch(/^[a-z][a-z-]*$/)
      expect(preset.slash).not.toBe(ASK_SLASH)
      expect(preset.instruction.trim().length).toBeGreaterThan(10)
    }
  })

  it('includes the core writing presets', () => {
    expect(AI_PRESETS.map((p) => p.id)).toEqual([
      'improve',
      'fix',
      'shorten',
      'expand',
      'tone-professional',
      'tone-casual',
      'tone-friendly',
      'restructure',
      'tldr',
    ])
  })
})

describe('blockRangeAt', () => {
  const doc = 'a\nb\n\nc'

  it('returns the multi-line paragraph containing the position', () => {
    expect(blockRangeAt(doc, 0)).toEqual({ from: 0, to: 3 })
    expect(blockRangeAt(doc, 2)).toEqual({ from: 0, to: 3 })
  })

  it('returns a later paragraph', () => {
    expect(blockRangeAt(doc, 5)).toEqual({ from: 5, to: 6 })
    expect(blockRangeAt(doc, 6)).toEqual({ from: 5, to: 6 })
  })

  it('returns an empty range on a blank line', () => {
    expect(blockRangeAt(doc, 4)).toEqual({ from: 4, to: 4 })
  })

  it('excludes the trailing newline and the heading above', () => {
    const text = '# T\n\npara one\npara two\n'
    expect(blockRangeAt(text, 8)).toEqual({ from: 5, to: 22 })
    expect(text.slice(5, 22)).toBe('para one\npara two')
  })

  it('treats whitespace-only lines as blank', () => {
    const text = 'one\n   \ntwo'
    expect(blockRangeAt(text, 9)).toEqual({ from: 8, to: 11 })
  })

  it('clamps out-of-range positions', () => {
    expect(blockRangeAt('abc', 99)).toEqual({ from: 0, to: 3 })
    expect(blockRangeAt('abc', -5)).toEqual({ from: 0, to: 3 })
    expect(blockRangeAt('', 0)).toEqual({ from: 0, to: 0 })
  })
})

describe('resolvePresetTarget', () => {
  const content = 'First para.\n\nSecond para.'
  const blockPreset: AiPreset = { id: 'b', label: 'B', slash: 'b', instruction: 'Do the block thing.', target: 'block' }
  const docPreset: AiPreset = { ...blockPreset, id: 'd', slash: 'd', target: 'document' }
  const autoPreset: AiPreset = { ...blockPreset, id: 'a', slash: 'a', target: 'auto' }

  it('prefers a non-empty selection for every preset kind', () => {
    const selection = { from: 0, to: 5 }
    expect(resolvePresetTarget(blockPreset, content, selection)).toEqual({ from: 0, to: 5 })
    expect(resolvePresetTarget(docPreset, content, selection)).toEqual({ from: 0, to: 5 })
    expect(resolvePresetTarget(autoPreset, content, selection)).toEqual({ from: 0, to: 5 })
  })

  it('resolves block presets to the paragraph at the cursor', () => {
    expect(resolvePresetTarget(blockPreset, content, { from: 15, to: 15 })).toEqual({ from: 13, to: 25 })
  })

  it('falls back to the whole document when the cursor is on a blank line', () => {
    expect(resolvePresetTarget(blockPreset, content, { from: 12, to: 12 })).toBe('document')
  })

  it('passes document and auto targets through when nothing is selected', () => {
    expect(resolvePresetTarget(docPreset, content, { from: 3, to: 3 })).toBe('document')
    expect(resolvePresetTarget(autoPreset, content, { from: 3, to: 3 })).toBe('auto')
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm --dir web test src/features/commands/presets.test.ts`
Expected: FAIL with `Failed to resolve import "./presets" from "src/features/commands/presets.test.ts"`.

- [ ] **Step 3: Write the minimal implementation**

`web/src/features/commands/presets.ts`:

```ts
import type { TextRange } from '../document/schema'
import type { SuggestionTarget } from '../suggestions/types'

export type AiPreset = {
  id: string
  label: string
  slash: string
  instruction: string
  target: 'auto' | 'document' | 'block'
}

export const ASK_SLASH = 'ask'

export const AI_PRESETS: AiPreset[] = [
  {
    id: 'improve',
    label: 'Improve writing',
    slash: 'improve',
    instruction: 'Improve clarity, flow, and word choice while keeping the meaning and the author’s voice.',
    target: 'block',
  },
  {
    id: 'fix',
    label: 'Fix grammar & spelling',
    slash: 'fix',
    instruction: 'Fix grammar, spelling, and punctuation mistakes only. Do not change the wording otherwise.',
    target: 'block',
  },
  {
    id: 'shorten',
    label: 'Make more concise',
    slash: 'shorten',
    instruction: 'Make this more concise. Remove redundancy and filler while keeping every key point.',
    target: 'block',
  },
  {
    id: 'expand',
    label: 'Expand with more detail',
    slash: 'expand',
    instruction: 'Expand this with more detail, explanation, or examples, keeping the same tone and style.',
    target: 'block',
  },
  {
    id: 'tone-professional',
    label: 'Professional tone',
    slash: 'tone-professional',
    instruction: 'Rewrite this in a clear, professional tone suitable for a business audience.',
    target: 'block',
  },
  {
    id: 'tone-casual',
    label: 'Casual tone',
    slash: 'tone-casual',
    instruction: 'Rewrite this in a relaxed, casual tone, as if talking to a colleague.',
    target: 'block',
  },
  {
    id: 'tone-friendly',
    label: 'Friendly tone',
    slash: 'tone-friendly',
    instruction: 'Rewrite this in a warm, friendly, and approachable tone.',
    target: 'block',
  },
  {
    id: 'restructure',
    label: 'Restructure document',
    slash: 'restructure',
    instruction:
      'Reorganize the document into a clearer structure with logical ordering and headings. Keep all of the information.',
    target: 'document',
  },
  {
    id: 'tldr',
    label: 'Add TL;DR summary',
    slash: 'tldr',
    instruction:
      'Add a short "TL;DR" section at the top of the document summarizing it in 1–3 sentences. Leave the rest unchanged.',
    target: 'document',
  },
]

export function blockRangeAt(content: string, pos: number): TextRange {
  const clamped = Math.max(0, Math.min(pos, content.length))
  const lineStartOf = (i: number) => content.lastIndexOf('\n', i - 1) + 1
  const lineEndOf = (i: number) => {
    const next = content.indexOf('\n', i)
    return next === -1 ? content.length : next
  }
  const isBlank = (start: number, end: number) => content.slice(start, end).trim() === ''

  let start = lineStartOf(clamped)
  let end = lineEndOf(clamped)
  if (isBlank(start, end)) return { from: clamped, to: clamped }

  while (start > 0) {
    const prevStart = lineStartOf(start - 1)
    if (isBlank(prevStart, start - 1)) break
    start = prevStart
  }
  while (end < content.length) {
    const nextEnd = lineEndOf(end + 1)
    if (isBlank(end + 1, nextEnd)) break
    end = nextEnd
  }
  return { from: start, to: end }
}

export function resolvePresetTarget(preset: AiPreset, content: string, selection: TextRange): SuggestionTarget {
  if (selection.from !== selection.to) return { from: selection.from, to: selection.to }
  if (preset.target === 'document') return 'document'
  if (preset.target === 'auto') return 'auto'
  const block = blockRangeAt(content, selection.from)
  return block.from === block.to ? 'document' : block
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --dir web test src/features/commands/presets.test.ts`
Expected: PASS, `Tests  13 passed (13)`.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/commands/presets.ts web/src/features/commands/presets.test.ts
git commit -m "feat(commands): add AI presets and preset target resolution"
```

---

### Task 2: `useRunPreset` hook

**Files:**
- Create: `web/src/features/commands/useRunPreset.ts`
- Test: `web/src/features/commands/useRunPreset.test.tsx`

**Interfaces:**
- Consumes: `useDocument()` → `{ content, selection }`; `useModels()` → `{ selectedModel, status }`; `useSuggestion()` → `{ isBusy, start(input: StartSuggestionInput) }`; `resolvePresetTarget` (Task 1).
- Produces: `function useRunPreset(): { canRun: boolean; runPreset(preset: AiPreset): void; runPresetAt(preset: AiPreset, cursor: number): void }`
  - `canRun` = `!isBusy && status === 'ready' && selectedModel !== null`
  - `runPreset` resolves the target from the current document selection; `runPresetAt` treats `cursor` as a collapsed selection. Both do nothing when `canRun` is false.

- [ ] **Step 1: Write the failing test**

`web/src/features/commands/useRunPreset.test.tsx`:

```tsx
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useModels } from '../ai/ModelProvider'
import { useDocument } from '../document/DocumentProvider'
import { useSuggestion } from '../suggestions/SuggestionProvider'
import { AI_PRESETS } from './presets'
import { useRunPreset } from './useRunPreset'

vi.mock('../document/DocumentProvider', () => ({ useDocument: vi.fn() }))
vi.mock('../ai/ModelProvider', () => ({ useModels: vi.fn() }))
vi.mock('../suggestions/SuggestionProvider', () => ({ useSuggestion: vi.fn() }))

const content = 'First para.\n\nSecond para.'
const improve = AI_PRESETS.find((p) => p.id === 'improve')!
const restructure = AI_PRESETS.find((p) => p.id === 'restructure')!
const start = vi.fn()

function mockDocument(selection = { from: 15, to: 15 }) {
  vi.mocked(useDocument).mockReturnValue({
    content,
    selection,
    setContent: vi.fn(),
    setSelection: vi.fn(),
    replaceRange: vi.fn(),
  } as ReturnType<typeof useDocument>)
}

function mockModels(overrides: Partial<ReturnType<typeof useModels>> = {}) {
  vi.mocked(useModels).mockReturnValue({
    models: [{ id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' }],
    selectedModel: 'claude-sonnet-5-5',
    setSelectedModel: vi.fn(),
    status: 'ready',
    ...overrides,
  } as ReturnType<typeof useModels>)
}

function mockSuggestion(isBusy = false) {
  vi.mocked(useSuggestion).mockReturnValue({
    suggestion: null,
    isBusy,
    start,
    stop: vi.fn(),
    refine: vi.fn(),
    setHunkStatus: vi.fn(),
    acceptAll: vi.fn(),
    rejectAll: vi.fn(),
    discard: vi.fn(),
  } as unknown as ReturnType<typeof useSuggestion>)
}

describe('useRunPreset', () => {
  beforeEach(() => {
    start.mockReset()
    mockDocument()
    mockModels()
    mockSuggestion()
  })

  it('starts a block preset on the paragraph at the cursor', () => {
    const { result } = renderHook(() => useRunPreset())
    expect(result.current.canRun).toBe(true)
    result.current.runPreset(improve)
    expect(start).toHaveBeenCalledWith({ instruction: improve.instruction, target: { from: 13, to: 25 } })
  })

  it('uses a non-empty selection as the target', () => {
    mockDocument({ from: 0, to: 5 })
    const { result } = renderHook(() => useRunPreset())
    result.current.runPreset(restructure)
    expect(start).toHaveBeenCalledWith({ instruction: restructure.instruction, target: { from: 0, to: 5 } })
  })

  it('runPresetAt resolves the target from the given cursor', () => {
    mockDocument({ from: 0, to: 5 })
    const { result } = renderHook(() => useRunPreset())
    result.current.runPresetAt(improve, 2)
    expect(start).toHaveBeenCalledWith({ instruction: improve.instruction, target: { from: 0, to: 11 } })
  })

  it('cannot run while a suggestion is active', () => {
    mockSuggestion(true)
    const { result } = renderHook(() => useRunPreset())
    expect(result.current.canRun).toBe(false)
    result.current.runPreset(improve)
    result.current.runPresetAt(improve, 2)
    expect(start).not.toHaveBeenCalled()
  })

  it('cannot run without a ready model catalog and a selected model', () => {
    mockModels({ status: 'error' })
    expect(renderHook(() => useRunPreset()).result.current.canRun).toBe(false)
    mockModels({ status: 'loading' })
    expect(renderHook(() => useRunPreset()).result.current.canRun).toBe(false)
    mockModels({ selectedModel: null })
    expect(renderHook(() => useRunPreset()).result.current.canRun).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm --dir web test src/features/commands/useRunPreset.test.tsx`
Expected: FAIL with `Failed to resolve import "./useRunPreset"`.

- [ ] **Step 3: Write the minimal implementation**

`web/src/features/commands/useRunPreset.ts`:

```ts
import { useCallback } from 'react'
import { useModels } from '../ai/ModelProvider'
import { useDocument } from '../document/DocumentProvider'
import { useSuggestion } from '../suggestions/SuggestionProvider'
import { resolvePresetTarget, type AiPreset } from './presets'

export function useRunPreset() {
  const { content, selection } = useDocument()
  const { selectedModel, status } = useModels()
  const { isBusy, start } = useSuggestion()
  const canRun = !isBusy && status === 'ready' && selectedModel !== null

  const runPreset = useCallback(
    (preset: AiPreset) => {
      if (!canRun) return
      start({ instruction: preset.instruction, target: resolvePresetTarget(preset, content, selection) })
    },
    [canRun, content, selection, start],
  )

  const runPresetAt = useCallback(
    (preset: AiPreset, cursor: number) => {
      if (!canRun) return
      start({
        instruction: preset.instruction,
        target: resolvePresetTarget(preset, content, { from: cursor, to: cursor }),
      })
    },
    [canRun, content, start],
  )

  return { canRun, runPreset, runPresetAt }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --dir web test src/features/commands/useRunPreset.test.tsx`
Expected: PASS, `Tests  5 passed (5)`.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/commands/useRunPreset.ts web/src/features/commands/useRunPreset.test.tsx
git commit -m "feat(commands): add useRunPreset hook"
```

---

### Task 3: Command palette component

**Files:**
- Modify: `web/package.json` (add `cmdk`)
- Modify: `web/src/test/setup.ts` (jsdom polyfills)
- Create: `web/src/features/commands/CommandPalette.tsx`
- Test: `web/src/features/commands/CommandPalette.test.tsx`

**Interfaces:**
- Consumes: `useRunPreset()` (Task 2); `useDocument().content`; `useTheme()` → `{ theme, toggleTheme }`; `useModels()` → `{ models, selectedModel, setSelectedModel }`; `exportFilename(content)` from `features/document/exportFilename`; `downloadTextFile(filename, text)` from `lib/download`; `TabId` from `features/layout/Tabs`; `AI_PRESETS`.
- Produces:
  - `type CommandPaletteProps = { open: boolean; onOpenChange(open: boolean): void; onSwitchTab(tab: TabId): void; onAskAi(): void }`
  - `function CommandPalette(props: CommandPaletteProps): JSX.Element`: a `cmdk` dialog labelled "Command palette", with input placeholder `Type a command or search…`, groups **AI** ("Ask AI…" plus one item per preset, all disabled when `!canRun`), **View** ("Go to Editor" / "Go to Preview" / "Go to AI Review"), **Document** ("Switch to dark theme" or "Switch to light theme", "Export as Markdown"), **Model** ("Use <label>", with a ✓ on the selected model), and a keyboard-shortcut footer. Every action closes the palette (`onOpenChange(false)`) before it runs.

- [ ] **Step 1: Install cmdk and add jsdom polyfills**

Run: `pnpm --dir web add cmdk`
Expected: `dependencies: + cmdk 1.x.x`.

Append to `web/src/test/setup.ts`. cmdk needs `ResizeObserver` and `scrollIntoView`, and CodeMirror views in later tasks need `Range` rect methods. jsdom implements none of them:

```ts
// jsdom polyfills for cmdk (ResizeObserver, scrollIntoView) and CodeMirror (Range rects)
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}
if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = function scrollIntoView() {}
}
const emptyRect = { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, toJSON: () => ({}) }
if (typeof Range.prototype.getClientRects !== 'function') {
  Range.prototype.getClientRects = () =>
    ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList
}
if (typeof Range.prototype.getBoundingClientRect !== 'function') {
  Range.prototype.getBoundingClientRect = () => emptyRect as DOMRect
}
```

- [ ] **Step 2: Write the failing test**

`web/src/features/commands/CommandPalette.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadTextFile } from '../../lib/download'
import { useModels } from '../ai/ModelProvider'
import { useDocument } from '../document/DocumentProvider'
import { useTheme } from '../theme/ThemeProvider'
import { CommandPalette } from './CommandPalette'
import { useRunPreset } from './useRunPreset'

vi.mock('./useRunPreset', () => ({ useRunPreset: vi.fn() }))
vi.mock('../document/DocumentProvider', () => ({ useDocument: vi.fn() }))
vi.mock('../theme/ThemeProvider', () => ({ useTheme: vi.fn() }))
vi.mock('../ai/ModelProvider', () => ({ useModels: vi.fn() }))
vi.mock('../../lib/download', () => ({ downloadTextFile: vi.fn() }))

const runPreset = vi.fn()
const toggleTheme = vi.fn()
const setSelectedModel = vi.fn()

function setup({ canRun = true } = {}) {
  vi.mocked(useRunPreset).mockReturnValue({ canRun, runPreset, runPresetAt: vi.fn() })
  vi.mocked(useDocument).mockReturnValue({
    content: '# My Doc\n\nHello',
    selection: { from: 0, to: 0 },
    setContent: vi.fn(),
    setSelection: vi.fn(),
    replaceRange: vi.fn(),
  } as ReturnType<typeof useDocument>)
  vi.mocked(useTheme).mockReturnValue({ theme: 'light', setTheme: vi.fn(), toggleTheme })
  vi.mocked(useModels).mockReturnValue({
    models: [
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
      { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
    ],
    selectedModel: 'claude-sonnet-5-5',
    setSelectedModel,
    status: 'ready',
  } as ReturnType<typeof useModels>)

  const onOpenChange = vi.fn()
  const onSwitchTab = vi.fn()
  const onAskAi = vi.fn()
  render(<CommandPalette open onOpenChange={onOpenChange} onSwitchTab={onSwitchTab} onAskAi={onAskAi} />)
  return { onOpenChange, onSwitchTab, onAskAi, user: userEvent.setup() }
}

describe('CommandPalette', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists presets and filters them by search text', async () => {
    const { user } = setup()
    expect(screen.getByRole('option', { name: /improve writing/i })).toBeInTheDocument()
    await user.type(screen.getByPlaceholderText('Type a command or search…'), 'concise')
    expect(screen.getByRole('option', { name: /make more concise/i })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /improve writing/i })).not.toBeInTheDocument()
  })

  it('runs a preset and closes', async () => {
    const { user, onOpenChange } = setup()
    await user.click(screen.getByRole('option', { name: /make more concise/i }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(runPreset).toHaveBeenCalledWith(expect.objectContaining({ id: 'shorten' }))
  })

  it('disables AI commands when presets cannot run', async () => {
    const { user } = setup({ canRun: false })
    const item = screen.getByRole('option', { name: /improve writing/i })
    expect(item).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('option', { name: /ask ai/i })).toHaveAttribute('aria-disabled', 'true')
    await user.click(item)
    expect(runPreset).not.toHaveBeenCalled()
  })

  it('asks AI with a custom instruction', async () => {
    const { user, onAskAi, onOpenChange } = setup()
    await user.click(screen.getByRole('option', { name: /ask ai/i }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onAskAi).toHaveBeenCalledTimes(1)
  })

  it('switches tabs', async () => {
    const { user, onSwitchTab } = setup()
    await user.click(screen.getByRole('option', { name: 'Go to Preview' }))
    expect(onSwitchTab).toHaveBeenCalledWith('preview')
  })

  it('toggles the theme and exports the document', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('option', { name: 'Switch to dark theme' }))
    expect(toggleTheme).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('option', { name: 'Export as Markdown' }))
    expect(downloadTextFile).toHaveBeenCalledWith('my-doc.md', '# My Doc\n\nHello')
  })

  it('switches the model', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('option', { name: /use claude haiku 5\.5/i }))
    expect(setSelectedModel).toHaveBeenCalledWith('claude-haiku-5-5')
  })

  it('shows a keyboard shortcut summary', () => {
    setup()
    expect(screen.getByText(/slash commands/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run the test to confirm it fails**

Run: `pnpm --dir web test src/features/commands/CommandPalette.test.tsx`
Expected: FAIL with `Failed to resolve import "./CommandPalette"`.

- [ ] **Step 4: Write the minimal implementation**

`web/src/features/commands/CommandPalette.tsx`:

```tsx
import { Command } from 'cmdk'
import { downloadTextFile } from '../../lib/download'
import { useModels } from '../ai/ModelProvider'
import { useDocument } from '../document/DocumentProvider'
import { exportFilename } from '../document/exportFilename'
import type { TabId } from '../layout/Tabs'
import { useTheme } from '../theme/ThemeProvider'
import { AI_PRESETS } from './presets'
import { useRunPreset } from './useRunPreset'

export type CommandPaletteProps = {
  open: boolean
  onOpenChange(open: boolean): void
  onSwitchTab(tab: TabId): void
  onAskAi(): void
}

const TABS: { id: TabId; label: string }[] = [
  { id: 'editor', label: 'Editor' },
  { id: 'preview', label: 'Preview' },
  { id: 'review', label: 'AI Review' },
]

const itemClass =
  'flex cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-2 text-sm text-zinc-800 dark:text-zinc-100 data-[selected=true]:bg-zinc-100 dark:data-[selected=true]:bg-zinc-800 data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-50'
const groupClass =
  '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-zinc-500'

export function CommandPalette({ open, onOpenChange, onSwitchTab, onAskAi }: CommandPaletteProps) {
  const { content } = useDocument()
  const { theme, toggleTheme } = useTheme()
  const { models, selectedModel, setSelectedModel } = useModels()
  const { canRun, runPreset } = useRunPreset()

  const run = (action: () => void) => {
    onOpenChange(false)
    action()
  }

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Command palette"
      overlayClassName="fixed inset-0 z-40 bg-black/30"
      contentClassName="fixed left-1/2 top-24 z-50 w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
    >
      <Command.Input
        placeholder="Type a command or search…"
        className="w-full border-b border-zinc-200 bg-transparent px-4 py-3 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:border-zinc-700 dark:text-zinc-100"
      />
      <Command.List className="max-h-80 overflow-y-auto p-2">
        <Command.Empty className="px-3 py-6 text-center text-sm text-zinc-500">No results.</Command.Empty>

        <Command.Group heading="AI" className={groupClass}>
          <Command.Item
            value="Ask AI…"
            keywords={['custom', 'instruction', 'ask']}
            disabled={!canRun}
            onSelect={() => run(onAskAi)}
            className={itemClass}
          >
            <span>Ask AI…</span>
            <span className="text-xs text-zinc-400">/ask</span>
          </Command.Item>
          {AI_PRESETS.map((preset) => (
            <Command.Item
              key={preset.id}
              value={preset.label}
              keywords={[preset.slash]}
              disabled={!canRun}
              onSelect={() => run(() => runPreset(preset))}
              className={itemClass}
            >
              <span>{preset.label}</span>
              <span className="text-xs text-zinc-400">/{preset.slash}</span>
            </Command.Item>
          ))}
        </Command.Group>

        <Command.Group heading="View" className={groupClass}>
          {TABS.map((tab) => (
            <Command.Item
              key={tab.id}
              value={`Go to ${tab.label}`}
              onSelect={() => run(() => onSwitchTab(tab.id))}
              className={itemClass}
            >
              Go to {tab.label}
            </Command.Item>
          ))}
        </Command.Group>

        <Command.Group heading="Document" className={groupClass}>
          <Command.Item
            value="Toggle theme"
            keywords={['dark', 'light', 'theme']}
            onSelect={() => run(toggleTheme)}
            className={itemClass}
          >
            {theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          </Command.Item>
          <Command.Item
            value="Export as Markdown"
            keywords={['download', 'save', 'md']}
            onSelect={() => run(() => downloadTextFile(exportFilename(content), content))}
            className={itemClass}
          >
            Export as Markdown
          </Command.Item>
        </Command.Group>

        {models.length > 0 && (
          <Command.Group heading="Model" className={groupClass}>
            {models.map((model) => (
              <Command.Item
                key={model.id}
                value={`Use ${model.label}`}
                keywords={['model', model.id]}
                onSelect={() => run(() => setSelectedModel(model.id))}
                className={itemClass}
              >
                <span>Use {model.label}</span>
                {model.id === selectedModel && <span aria-hidden="true">✓</span>}
              </Command.Item>
            ))}
          </Command.Group>
        )}
      </Command.List>
      <footer className="flex flex-wrap gap-x-4 gap-y-1 border-t border-zinc-200 px-4 py-2 text-xs text-zinc-500 dark:border-zinc-700">
        <span>
          <kbd>⌘K</kbd> / <kbd>Ctrl K</kbd> toggle
        </span>
        <span>
          <kbd>↑</kbd> <kbd>↓</kbd> navigate
        </span>
        <span>
          <kbd>↵</kbd> run
        </span>
        <span>
          <kbd>Esc</kbd> close
        </span>
        <span>
          Type <kbd>/</kbd> in the editor for slash commands
        </span>
      </footer>
    </Command.Dialog>
  )
}
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `pnpm --dir web test src/features/commands/CommandPalette.test.tsx`
Expected: PASS, `Tests  8 passed (8)`. Radix may log a "Missing `Description`" warning on stderr. That's expected and not a failure.

- [ ] **Step 6: Run the whole suite to confirm the polyfills broke nothing**

Run: `pnpm --dir web test`
Expected: all test files pass.

- [ ] **Step 7: Commit**

```bash
git add web/package.json web/pnpm-lock.yaml web/src/test/setup.ts web/src/features/commands/CommandPalette.tsx web/src/features/commands/CommandPalette.test.tsx
git commit -m "feat(commands): add cmdk command palette"
```

---

### Task 4: AskAiBar quick-action chips and focus requests

**Files:**
- Create: `web/src/features/commands/PresetChips.tsx`
- Create: `web/src/features/commands/useFocusRequest.ts`
- Modify: `web/src/features/suggestions/AskAiBar.tsx`
- Test: `web/src/features/commands/PresetChips.test.tsx`
- Test: `web/src/features/commands/useFocusRequest.test.tsx`

**Interfaces:**
- Consumes: `AI_PRESETS`, `AiPreset` (Task 1).
- Produces:
  - `function PresetChips(props: { disabled: boolean; onPick(preset: AiPreset): void }): JSX.Element`: a `role="group"` named "Quick AI actions" with buttons for presets `improve`, `fix`, `shorten`, `tone-professional`.
  - `function useFocusRequest(ref: RefObject<HTMLElement | null>, requested: boolean, onHandled?: () => void): void`: when `requested` is true, focuses `ref.current` on the next macrotask (`setTimeout(…, 0)`, which runs after Radix's dialog focus-restore), then calls `onHandled`.
  - `AskAiBar` gains optional props `{ focusRequested?: boolean; onFocusHandled?(): void; quickActions?: ReactNode }`. Its instruction input gets the accessible name **"AI instruction"**.

- [ ] **Step 1: Write the failing tests**

`web/src/features/commands/PresetChips.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PresetChips } from './PresetChips'

describe('PresetChips', () => {
  it('renders quick actions that pick presets', async () => {
    const onPick = vi.fn()
    render(<PresetChips disabled={false} onPick={onPick} />)
    const group = screen.getByRole('group', { name: 'Quick AI actions' })
    expect(group).toBeInTheDocument()
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Improve writing',
      'Fix grammar & spelling',
      'Make more concise',
      'Professional tone',
    ])
    await userEvent.setup().click(screen.getByRole('button', { name: 'Fix grammar & spelling' }))
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'fix' }))
  })

  it('disables every chip when disabled', () => {
    render(<PresetChips disabled onPick={vi.fn()} />)
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled()
  })
})
```

`web/src/features/commands/useFocusRequest.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useFocusRequest } from './useFocusRequest'

function Harness({ requested, onHandled }: { requested: boolean; onHandled?: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  useFocusRequest(ref, requested, onHandled)
  return <input ref={ref} aria-label="target" />
}

describe('useFocusRequest', () => {
  it('focuses the element and reports when handled', async () => {
    const onHandled = vi.fn()
    render(<Harness requested onHandled={onHandled} />)
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'target' })).toHaveFocus())
    expect(onHandled).toHaveBeenCalledTimes(1)
  })

  it('does nothing when not requested', async () => {
    const onHandled = vi.fn()
    render(<Harness requested={false} onHandled={onHandled} />)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(screen.getByRole('textbox', { name: 'target' })).not.toHaveFocus()
    expect(onHandled).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm --dir web test src/features/commands/PresetChips.test.tsx src/features/commands/useFocusRequest.test.tsx`
Expected: FAIL with `Failed to resolve import "./PresetChips"` and `Failed to resolve import "./useFocusRequest"`.

- [ ] **Step 3: Write the minimal implementation**

`web/src/features/commands/PresetChips.tsx`:

```tsx
import { AI_PRESETS, type AiPreset } from './presets'

const CHIP_IDS = ['improve', 'fix', 'shorten', 'tone-professional']
const CHIPS = CHIP_IDS.map((id) => AI_PRESETS.find((p) => p.id === id)).filter((p): p is AiPreset => p !== undefined)

export function PresetChips({ disabled, onPick }: { disabled: boolean; onPick(preset: AiPreset): void }) {
  return (
    <div role="group" aria-label="Quick AI actions" className="flex flex-wrap gap-2">
      {CHIPS.map((preset) => (
        <button
          key={preset.id}
          type="button"
          disabled={disabled}
          onClick={() => onPick(preset)}
          title={`/${preset.slash}`}
          className="rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          {preset.label}
        </button>
      ))}
    </div>
  )
}
```

`web/src/features/commands/useFocusRequest.ts`:

```ts
import { useEffect, type RefObject } from 'react'

// Focus on the next macrotask so we run after Radix's dialog focus-restore when the palette closes.
export function useFocusRequest(ref: RefObject<HTMLElement | null>, requested: boolean, onHandled?: () => void) {
  useEffect(() => {
    if (!requested) return
    const id = window.setTimeout(() => {
      ref.current?.focus()
      onHandled?.()
    }, 0)
    return () => window.clearTimeout(id)
  }, [ref, requested, onHandled])
}
```

- [ ] **Step 4: Modify `AskAiBar`**

In `web/src/features/suggestions/AskAiBar.tsx`:

1. Add these imports:
   ```tsx
   import { useRef, type ReactNode } from 'react'
   import { useFocusRequest } from '../commands/useFocusRequest'
   ```
   (Merge `useRef` into the existing `react` import if there is one.)
2. Add (or extend) the props type and the function signature:
   ```tsx
   export type AskAiBarProps = {
     focusRequested?: boolean
     onFocusHandled?(): void
     quickActions?: ReactNode
   }

   export function AskAiBar({ focusRequested = false, onFocusHandled, quickActions }: AskAiBarProps) {
   ```
3. At the top of the component body:
   ```tsx
   const inputRef = useRef<HTMLInputElement>(null)
   useFocusRequest(inputRef, focusRequested, onFocusHandled)
   ```
4. On the existing instruction `<input>`, add `ref={inputRef}` and `aria-label="AI instruction"`. If phase 4 labelled it some other way (e.g. `<label>` text), replace that with `aria-label="AI instruction"`, and update any phase 4 test that queried the old name to use `{ name: 'AI instruction' }`.
5. Render the slot directly below the input/button row, inside the bar's root element:
   ```tsx
   {quickActions && <div className="mt-2">{quickActions}</div>}
   ```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `pnpm --dir web test src/features/commands src/features/suggestions`
Expected: PASS for the new tests and all existing `AskAiBar` tests.

Run: `pnpm --dir web typecheck`
Expected: exits 0 with no errors.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/commands/PresetChips.tsx web/src/features/commands/PresetChips.test.tsx web/src/features/commands/useFocusRequest.ts web/src/features/commands/useFocusRequest.test.tsx web/src/features/suggestions/AskAiBar.tsx web/src/features/suggestions
git commit -m "feat(commands): add quick-action chips and focus requests to AskAiBar"
```

---

### Task 5: Slash command completion source

**Files:**
- Modify: `web/package.json` (add `@codemirror/autocomplete` as a direct dependency)
- Create: `web/src/features/commands/slashCommands.ts`
- Test: `web/src/features/commands/slashCommands.test.ts`

**Interfaces:**
- Consumes: `AI_PRESETS`, `AiPreset`, `ASK_SLASH` (Task 1).
- Produces:
  - `type SlashSelection = { kind: 'preset'; preset: AiPreset; content: string; cursor: number } | { kind: 'ask'; content: string; cursor: number }`. `content` is the editor document **after** the `/word` was deleted; `cursor` is where it was.
  - `function slashCompletionSource(onSelect: (s: SlashSelection) => void): CompletionSource`: triggers on `/[\w-]*` right before the cursor, at line start or after whitespace. Options: `/ask` first, then `/<preset.slash>` for each preset.
  - `function slashCommands(onSelect: (s: SlashSelection) => void): Extension`, which is `autocompletion({ override: [slashCompletionSource(onSelect)], icons: false })`.

- [ ] **Step 1: Install the direct dependency**

Run: `pnpm --dir web add @codemirror/autocomplete`
Expected: `dependencies: + @codemirror/autocomplete 6.x.x`. It's already a transitive dependency of `codemirror`, but pnpm's strict layout requires a direct dependency in order to import it.

- [ ] **Step 2: Write the failing test**

`web/src/features/commands/slashCommands.test.ts`:

```ts
import { CompletionContext, type Completion, type CompletionResult } from '@codemirror/autocomplete'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { slashCommands, slashCompletionSource } from './slashCommands'

type ApplyFn = (view: EditorView, completion: Completion, from: number, to: number) => void

function complete(doc: string, pos = doc.length) {
  const state = EditorState.create({ doc, selection: { anchor: pos } })
  return slashCompletionSource(vi.fn())(new CompletionContext(state, pos, false)) as CompletionResult | null
}

let view: EditorView | null = null
afterEach(() => {
  view?.destroy()
  view = null
})

describe('slashCompletionSource', () => {
  it('offers /ask and every preset at the start of a line', () => {
    const result = complete('/')
    expect(result?.from).toBe(0)
    const labels = result?.options.map((o) => o.label)
    expect(labels?.[0]).toBe('/ask')
    expect(labels).toEqual(expect.arrayContaining(['/improve', '/fix', '/shorten', '/restructure', '/tldr']))
  })

  it('triggers after whitespace and covers the typed word', () => {
    const result = complete('Hello /fi')
    expect(result?.from).toBe(6)
    expect(result?.validFor).toBeInstanceOf(RegExp)
  })

  it('triggers on a later line', () => {
    expect(complete('Intro\n/tone-')?.from).toBe(6)
  })

  it('does not trigger inside a word, a path, or a URL', () => {
    expect(complete('path/to')).toBeNull()
    expect(complete('see http://x')).toBeNull()
    expect(complete('and/or')).toBeNull()
  })

  it('does not trigger when the slash word is not right before the cursor', () => {
    expect(complete('a /fix more')).toBeNull()
  })

  it('applying a preset deletes the slash text and reports the preset', () => {
    const onSelect = vi.fn()
    const doc = 'Para one\n/fix'
    view = new EditorView({
      state: EditorState.create({ doc, selection: { anchor: doc.length } }),
      parent: document.body,
    })
    const result = slashCompletionSource(onSelect)(
      new CompletionContext(view.state, doc.length, false),
    ) as CompletionResult
    const option = result.options.find((o) => o.label === '/fix')!
    ;(option.apply as ApplyFn)(view, option, result.from, doc.length)

    expect(view.state.doc.toString()).toBe('Para one\n')
    expect(view.state.selection.main.head).toBe(9)
    expect(onSelect).toHaveBeenCalledWith({
      kind: 'preset',
      preset: expect.objectContaining({ id: 'fix' }),
      content: 'Para one\n',
      cursor: 9,
    })
  })

  it('applying /ask deletes the slash text and reports an ask', () => {
    const onSelect = vi.fn()
    const doc = 'Hello /as'
    view = new EditorView({
      state: EditorState.create({ doc, selection: { anchor: doc.length } }),
      parent: document.body,
    })
    const result = slashCompletionSource(onSelect)(
      new CompletionContext(view.state, doc.length, false),
    ) as CompletionResult
    const option = result.options.find((o) => o.label === '/ask')!
    ;(option.apply as ApplyFn)(view, option, result.from, doc.length)

    expect(view.state.doc.toString()).toBe('Hello ')
    expect(onSelect).toHaveBeenCalledWith({ kind: 'ask', content: 'Hello ', cursor: 6 })
  })
})

describe('slashCommands', () => {
  it('builds an extension accepted by EditorState', () => {
    expect(() => EditorState.create({ doc: '', extensions: slashCommands(vi.fn()) })).not.toThrow()
  })
})
```

- [ ] **Step 3: Run the test to confirm it fails**

Run: `pnpm --dir web test src/features/commands/slashCommands.test.ts`
Expected: FAIL with `Failed to resolve import "./slashCommands"`.

- [ ] **Step 4: Write the minimal implementation**

`web/src/features/commands/slashCommands.ts`:

```ts
import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from '@codemirror/autocomplete'
import type { Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { AI_PRESETS, ASK_SLASH, type AiPreset } from './presets'

export type SlashSelection =
  | { kind: 'preset'; preset: AiPreset; content: string; cursor: number }
  | { kind: 'ask'; content: string; cursor: number }

const SLASH_BEFORE_CURSOR = /(?:^|\s)\/[\w-]*$/
const SLASH_WORD = /^\/[\w-]*$/

function removeSlashText(view: EditorView, from: number, to: number) {
  view.dispatch({ changes: { from, to, insert: '' }, selection: { anchor: from }, userEvent: 'delete.slash' })
  return { content: view.state.doc.toString(), cursor: from }
}

export function slashCompletionSource(onSelect: (selection: SlashSelection) => void): CompletionSource {
  const askOption: Completion = {
    label: `/${ASK_SLASH}`,
    detail: 'Ask AI with your own instruction',
    type: 'function',
    apply: (view, _completion, from, to) => onSelect({ kind: 'ask', ...removeSlashText(view, from, to) }),
  }
  const presetOptions: Completion[] = AI_PRESETS.map((preset) => ({
    label: `/${preset.slash}`,
    detail: preset.label,
    type: 'function',
    apply: (view, _completion, from, to) => onSelect({ kind: 'preset', preset, ...removeSlashText(view, from, to) }),
  }))
  const options = [askOption, ...presetOptions]

  return (context: CompletionContext): CompletionResult | null => {
    const match = context.matchBefore(SLASH_BEFORE_CURSOR)
    if (!match) return null
    const from = match.text.startsWith('/') ? match.from : match.from + 1
    return { from, options, validFor: SLASH_WORD }
  }
}

export function slashCommands(onSelect: (selection: SlashSelection) => void): Extension {
  return autocompletion({ override: [slashCompletionSource(onSelect)], icons: false })
}
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `pnpm --dir web test src/features/commands/slashCommands.test.ts`
Expected: PASS, `Tests  8 passed (8)`.

- [ ] **Step 6: Commit**

```bash
git add web/package.json web/pnpm-lock.yaml web/src/features/commands/slashCommands.ts web/src/features/commands/slashCommands.test.ts
git commit -m "feat(commands): add slash command completion source"
```

---

### Task 6: Slash command handler (wait for the document to sync)

**Files:**
- Create: `web/src/features/commands/useSlashCommandHandler.ts`
- Test: `web/src/features/commands/useSlashCommandHandler.test.tsx`

**Why:** The slash `apply` function deletes `/word` inside CodeMirror. `DocumentProvider.content` only catches up on the next React render. Calling `start()` right away would compute `baseText` from the stale content, which still contains `/fix`. The handler stores the selection and runs it only once `content` equals the post-deletion document.

**Interfaces:**
- Consumes: `SlashSelection` (Task 5); `runPresetAt(preset, cursor)` from `useRunPreset` (Task 2).
- Produces: `function useSlashCommandHandler(options: { content: string; runPresetAt(preset: AiPreset, cursor: number): void; onAsk(): void }): (selection: SlashSelection) => void`. The returned handler is referentially stable across renders.

- [ ] **Step 1: Write the failing test**

`web/src/features/commands/useSlashCommandHandler.test.tsx`:

```tsx
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AI_PRESETS } from './presets'
import { useSlashCommandHandler } from './useSlashCommandHandler'

const fix = AI_PRESETS.find((p) => p.id === 'fix')!

function setup(initialContent: string) {
  const runPresetAt = vi.fn()
  const onAsk = vi.fn()
  const hook = renderHook(
    ({ content }: { content: string }) => useSlashCommandHandler({ content, runPresetAt, onAsk }),
    { initialProps: { content: initialContent } },
  )
  return { ...hook, runPresetAt, onAsk }
}

describe('useSlashCommandHandler', () => {
  it('waits until the document content reflects the deleted slash text', () => {
    const { result, rerender, runPresetAt } = setup('Para\n/fix')
    act(() => result.current({ kind: 'preset', preset: fix, content: 'Para\n', cursor: 5 }))
    expect(runPresetAt).not.toHaveBeenCalled()

    rerender({ content: 'Para\n' })
    expect(runPresetAt).toHaveBeenCalledTimes(1)
    expect(runPresetAt).toHaveBeenCalledWith(fix, 5)

    rerender({ content: 'Para\n' })
    expect(runPresetAt).toHaveBeenCalledTimes(1)
  })

  it('runs immediately when the content is already in sync', () => {
    const { result, runPresetAt } = setup('Para\n')
    act(() => result.current({ kind: 'preset', preset: fix, content: 'Para\n', cursor: 5 }))
    expect(runPresetAt).toHaveBeenCalledWith(fix, 5)
  })

  it('calls onAsk for /ask', () => {
    const { result, rerender, onAsk, runPresetAt } = setup('Hi /ask')
    act(() => result.current({ kind: 'ask', content: 'Hi ', cursor: 3 }))
    rerender({ content: 'Hi ' })
    expect(onAsk).toHaveBeenCalledTimes(1)
    expect(runPresetAt).not.toHaveBeenCalled()
  })

  it('returns a stable handler', () => {
    const { result, rerender } = setup('a')
    const first = result.current
    rerender({ content: 'b' })
    expect(result.current).toBe(first)
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm --dir web test src/features/commands/useSlashCommandHandler.test.tsx`
Expected: FAIL with `Failed to resolve import "./useSlashCommandHandler"`.

- [ ] **Step 3: Write the minimal implementation**

`web/src/features/commands/useSlashCommandHandler.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AiPreset } from './presets'
import type { SlashSelection } from './slashCommands'

type Options = {
  content: string
  runPresetAt(preset: AiPreset, cursor: number): void
  onAsk(): void
}

export function useSlashCommandHandler({ content, runPresetAt, onAsk }: Options) {
  const pendingRef = useRef<SlashSelection | null>(null)
  const [, setTick] = useState(0)

  // Runs after every render; fires the pending command once React state matches the editor.
  useEffect(() => {
    const pending = pendingRef.current
    if (!pending || pending.content !== content) return
    pendingRef.current = null
    if (pending.kind === 'ask') onAsk()
    else runPresetAt(pending.preset, pending.cursor)
  })

  return useCallback((selection: SlashSelection) => {
    pendingRef.current = selection
    setTick((tick) => tick + 1)
  }, [])
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --dir web test src/features/commands/useSlashCommandHandler.test.tsx`
Expected: PASS, `Tests  4 passed (4)`.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/commands/useSlashCommandHandler.ts web/src/features/commands/useSlashCommandHandler.test.tsx
git commit -m "feat(commands): run slash commands once document state syncs"
```

---

### Task 7: Wire commands into the app shell

**Files:**
- Create: `web/src/features/commands/useCommandPaletteShortcut.ts`
- Create: `web/src/features/commands/CommandPaletteButton.tsx`
- Modify: `web/src/features/layout/AppHeader.tsx`
- Modify: `web/src/App.tsx` (`Workspace`)
- Test: `web/src/App.commands.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1–6; `Workspace`'s `activeTab` / `onTabChange` props; `useDocument().content`; `MarkdownEditor`'s `extensions?: Extension[]` prop.
- Produces:
  - `function useCommandPaletteShortcut(onToggle: () => void): void`: a capture-phase `keydown` listener on `window` for Mod-K (`metaKey || ctrlKey`, no Alt/Shift) that calls `preventDefault()`.
  - `function shortcutLabel(userAgent?: string): string`: returns `'⌘K'` on Apple platforms, otherwise `'Ctrl K'`.
  - `function CommandPaletteButton(props: { onClick(): void }): JSX.Element`: a button with accessible name "Open command palette".
  - `AppHeader` keeps its `children` slot and gains an optional prop `onOpenCommands?: () => void`; it renders `CommandPaletteButton` when the prop is provided.

- [ ] **Step 1: Write the failing integration test**

`web/src/App.commands.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const MODELS = {
  provider: 'anthropic',
  default_model: 'claude-sonnet-5-5',
  models: [
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
    { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
  ],
}

function mockFetch({ modelsOk }: { modelsOk: boolean }) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (modelsOk && String(input).endsWith('/models')) {
      return new Response(JSON.stringify(MODELS), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response('unavailable', { status: 503 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const searchInput = () => screen.findByPlaceholderText('Type a command or search…')

describe('App commands', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('opens and closes the palette with Ctrl+K', async () => {
    mockFetch({ modelsOk: true })
    const user = userEvent.setup()
    render(<App />)
    await user.keyboard('{Control>}k{/Control}')
    expect(await searchInput()).toBeInTheDocument()
    await user.keyboard('{Control>}k{/Control}')
    await waitFor(() => expect(screen.queryByPlaceholderText('Type a command or search…')).not.toBeInTheDocument())
  })

  it('opens the palette from the header button and switches tabs', async () => {
    mockFetch({ modelsOk: true })
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Open command palette' }))
    await searchInput()
    await user.click(screen.getByRole('option', { name: 'Go to Preview' }))
    expect(screen.getByRole('tab', { name: 'Preview' })).toHaveAttribute('aria-selected', 'true')
  })

  it('disables AI commands and quick actions when models are unavailable', async () => {
    const fetchMock = mockFetch({ modelsOk: false })
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    for (const chip of screen.getAllByRole('button', { name: /improve writing|fix grammar/i })) {
      expect(chip).toBeDisabled()
    }
    await user.keyboard('{Control>}k{/Control}')
    await searchInput()
    expect(screen.getByRole('option', { name: /improve writing/i })).toHaveAttribute('aria-disabled', 'true')
  })

  it('"Ask AI…" switches to the editor and focuses the instruction input', async () => {
    mockFetch({ modelsOk: true })
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('tab', { name: 'Preview' }))

    await user.keyboard('{Control>}k{/Control}')
    await searchInput()
    const askItem = screen.getByRole('option', { name: /ask ai/i })
    await waitFor(() => expect(askItem).toHaveAttribute('aria-disabled', 'false'))
    await user.click(askItem)

    expect(screen.getByRole('tab', { name: 'Editor' })).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'AI instruction' })).toHaveFocus())
  })

  it('switches the model from the palette', async () => {
    mockFetch({ modelsOk: true })
    const user = userEvent.setup()
    render(<App />)
    await user.keyboard('{Control>}k{/Control}')
    await searchInput()
    await user.click(await screen.findByRole('option', { name: /use claude haiku 5\.5/i }))
    await user.keyboard('{Control>}k{/Control}')
    await searchInput()
    const haiku = await screen.findByRole('option', { name: /use claude haiku 5\.5/i })
    expect(haiku).toHaveTextContent('✓')
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm --dir web test src/App.commands.test.tsx`
Expected: FAIL. Ctrl+K does nothing (`Unable to find an element with the placeholder text of: Type a command or search…`), and there's no "Open command palette" button.

- [ ] **Step 3: Create the shortcut hook and header button**

`web/src/features/commands/useCommandPaletteShortcut.ts`:

```ts
import { useEffect } from 'react'

export function useCommandPaletteShortcut(onToggle: () => void) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        onToggle()
      }
    }
    // Capture phase so CodeMirror and inputs can't swallow the shortcut.
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [onToggle])
}
```

`web/src/features/commands/CommandPaletteButton.tsx`:

```tsx
export function shortcutLabel(userAgent: string = navigator.userAgent): string {
  return /Mac|iPhone|iPad/.test(userAgent) ? '⌘K' : 'Ctrl K'
}

export function CommandPaletteButton({ onClick }: { onClick(): void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Open command palette"
      className="flex items-center gap-2 rounded-md border border-zinc-300 px-2.5 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
    >
      <span>Commands</span>
      <kbd className="rounded bg-zinc-100 px-1.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
        {shortcutLabel()}
      </kbd>
    </button>
  )
}
```

- [ ] **Step 4: Modify `AppHeader`**

In `web/src/features/layout/AppHeader.tsx`:

1. `import { CommandPaletteButton } from '../commands/CommandPaletteButton'`
2. Replace the inline props type with an exported one and destructure both props:
   ```tsx
   export type AppHeaderProps = { children?: ReactNode; onOpenCommands?: () => void }

   export function AppHeader({ children, onOpenCommands }: AppHeaderProps) {
   ```
3. Render `{onOpenCommands && <CommandPaletteButton onClick={onOpenCommands} />}` as the first item in the header's right-hand controls group, before `{children}` (which holds `ModelSelect`).

- [ ] **Step 5: Modify `Workspace` in `web/src/App.tsx`**

1. Add imports (merge them with existing imports from the same modules):
   ```tsx
   import { useCallback, useMemo, useState } from 'react'
   import { CommandPalette } from './features/commands/CommandPalette'
   import { PresetChips } from './features/commands/PresetChips'
   import { slashCommands } from './features/commands/slashCommands'
   import { useCommandPaletteShortcut } from './features/commands/useCommandPaletteShortcut'
   import { useRunPreset } from './features/commands/useRunPreset'
   import { useSlashCommandHandler } from './features/commands/useSlashCommandHandler'
   ```
2. At the top of `Workspace`'s body (it receives `activeTab` and `onTabChange` as props; reuse the existing `useDocument()` call if `content` is already destructured):
   ```tsx
   const { content } = useDocument()
   const { canRun, runPreset, runPresetAt } = useRunPreset()
   const [paletteOpen, setPaletteOpen] = useState(false)
   const [askAiFocusRequested, setAskAiFocusRequested] = useState(false)

   const togglePalette = useCallback(() => setPaletteOpen((open) => !open), [])
   useCommandPaletteShortcut(togglePalette)

   const focusAskAi = useCallback(() => {
     onTabChange('editor')
     setAskAiFocusRequested(true)
   }, [onTabChange])
   const clearAskAiFocus = useCallback(() => setAskAiFocusRequested(false), [])

   const handleSlash = useSlashCommandHandler({ content, runPresetAt, onAsk: focusAskAi })
   const editorExtensions = useMemo(() => [slashCommands(handleSlash)], [handleSlash])
   ```
3. JSX changes:
   - `<AppHeader>` → `<AppHeader onOpenCommands={() => setPaletteOpen(true)}>` (keep `<ModelSelect />` as its child)
   - `<AskAiBar />` →
     ```tsx
     <AskAiBar
       focusRequested={askAiFocusRequested}
       onFocusHandled={clearAskAiFocus}
       quickActions={<PresetChips disabled={!canRun} onPick={runPreset} />}
     />
     ```
   - Add `extensions={editorExtensions}` to the existing `<MarkdownEditor ... />` element.
   - Add the palette once, as the last child of `Workspace`'s root element:
     ```tsx
     <CommandPalette
       open={paletteOpen}
       onOpenChange={setPaletteOpen}
       onSwitchTab={onTabChange}
       onAskAi={focusAskAi}
     />
     ```

- [ ] **Step 6: Run the integration test and the whole suite**

Run: `pnpm --dir web test src/App.commands.test.tsx`
Expected: PASS, `Tests  5 passed (5)`.

Run: `pnpm --dir web test && pnpm --dir web typecheck && pnpm --dir web lint`
Expected: all tests pass, and typecheck and lint exit 0. If an existing `App.test.tsx` from an earlier phase asserted an exact list of header buttons, add "Open command palette" to it.

- [ ] **Step 7: Commit**

```bash
git add web/src/features/commands/useCommandPaletteShortcut.ts web/src/features/commands/CommandPaletteButton.tsx web/src/features/layout/AppHeader.tsx web/src/App.tsx web/src/App.commands.test.tsx
git commit -m "feat(commands): wire command palette, slash commands, and quick actions into the app"
```

---

### Task 8: Error boundary

**Files:**
- Create: `web/src/features/layout/ErrorBoundary.tsx`
- Modify: `web/src/App.tsx`
- Test: `web/src/features/layout/ErrorBoundary.test.tsx`

**Interfaces:**
- Produces: `class ErrorBoundary extends Component<{ children: ReactNode; onReload?: () => void }>`. On a render error it shows `role="alert"` with the heading "Something went wrong", the error message, a note that the document is saved in this browser, and a "Reload" button that calls `onReload` (default: `window.location.reload()`).

- [ ] **Step 1: Write the failing test**

`web/src/features/layout/ErrorBoundary.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'

function Boom(): never {
  throw new Error('kaboom')
}

describe('ErrorBoundary', () => {
  afterEach(() => vi.restoreAllMocks())

  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>fine</p>
      </ErrorBoundary>,
    )
    expect(screen.getByText('fine')).toBeInTheDocument()
  })

  it('renders a recovery screen when a child throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const onReload = vi.fn()
    render(
      <ErrorBoundary onReload={onReload}>
        <Boom />
      </ErrorBoundary>,
    )
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Something went wrong')
    expect(alert).toHaveTextContent('kaboom')
    expect(alert).toHaveTextContent(/saved in this browser/i)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reload' }))
    expect(onReload).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm --dir web test src/features/layout/ErrorBoundary.test.tsx`
Expected: FAIL with `Failed to resolve import "./ErrorBoundary"`.

- [ ] **Step 3: Write the minimal implementation**

`web/src/features/layout/ErrorBoundary.tsx`:

```tsx
import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode; onReload?: () => void }
type State = { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error', error, info.componentStack)
  }

  private handleReload = () => {
    if (this.props.onReload) this.props.onReload()
    else window.location.reload()
  }

  override render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex min-h-screen items-center justify-center bg-white p-6 dark:bg-zinc-950">
        <div
          role="alert"
          className="max-w-md rounded-xl border border-red-200 bg-red-50 p-6 text-zinc-800 dark:border-red-900 dark:bg-red-950/40 dark:text-zinc-100"
        >
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="mt-2 text-sm">Your document is saved in this browser. Reload the page to continue.</p>
          <pre className="mt-3 overflow-x-auto rounded bg-white/70 p-2 text-xs dark:bg-black/30">
            {this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={this.handleReload}
            className="mt-4 rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
          >
            Reload
          </button>
        </div>
      </div>
    )
  }
}
```

- [ ] **Step 4: Wrap the app**

In `web/src/App.tsx`, import `{ ErrorBoundary } from './features/layout/ErrorBoundary'`, and make `<ErrorBoundary>` the outermost element returned by `App`, around `<ThemeProvider>`:

```tsx
<ErrorBoundary>
  <ThemeProvider>
    {/* existing provider tree, unchanged */}
  </ThemeProvider>
</ErrorBoundary>
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `pnpm --dir web test src/features/layout/ErrorBoundary.test.tsx && pnpm --dir web test`
Expected: PASS. All tests pass.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/layout/ErrorBoundary.tsx web/src/features/layout/ErrorBoundary.test.tsx web/src/App.tsx
git commit -m "feat(layout): add app-wide error boundary"
```

---

### Task 9: README and end-to-end verification

**Files:**
- Modify (replace contents): `README.md`

**Interfaces:** none (documentation and verification only).

- [ ] **Step 1: Write the README**

Replace `README.md` with:

````markdown
# AI Docs

A collaborative Markdown editor with an AI co-author. Write in the editor, ask the AI to improve a selection or the whole document, review its proposal as a split diff, and accept or reject each change — or refine the proposal with a follow-up instruction. Every accepted AI change is recorded in a version history.

## Features

- **Markdown editor** (CodeMirror 6) with a live **Preview** tab.
- **AI suggestions**, streamed over SSE, for the current selection, the current paragraph, or the whole document.
- **Split diff review** (Before / After) with per-hunk Accept / Reject, Accept all / Reject all, Refine, and Discard.
- **Version history** in the AI Review tab: see how the document evolved, diff any version against its predecessor, restore it.
- **Command palette** (`⌘K` / `Ctrl K`): AI presets, Ask AI, switch tabs, toggle theme, export, switch model.
- **Slash commands**: type `/` in the editor (e.g. `/fix`, `/shorten`, `/tone-professional`, `/restructure`, `/ask`).
- **Model switcher**: Claude Sonnet 5.5 (default) or Claude Haiku 5.5, switchable at any time.
- Autosave to `localStorage`, **Export** as `.md`, light theme by default with a dark mode toggle.

## Requirements

- Node 24 and pnpm (`corepack enable`)
- Python 3.13 and [uv](https://docs.astral.sh/uv/)
- An Anthropic API key or an OpenRouter API key

## Setup

```bash
pnpm install                       # root: installs Husky git hooks
pnpm --dir web install
cd api && uv sync && cp .env.example .env   # then edit .env
```

## Running

```bash
# terminal 1 — API on http://localhost:8000
cd api && uv run fastapi dev app/main.py

# terminal 2 — app on http://localhost:5173 (proxies /api to :8000)
pnpm --dir web dev
```

## Configuration

Backend (`api/.env`):

| Variable | Default | Description |
|---|---|---|
| `LLM_PROVIDER` | `anthropic` | `anthropic` or `openrouter` |
| `ANTHROPIC_API_KEY` | — | Required when `LLM_PROVIDER=anthropic` |
| `OPENROUTER_API_KEY` | — | Required when `LLM_PROVIDER=openrouter` |
| `LLM_DEFAULT_MODEL` | `claude-sonnet-5-5` | `claude-sonnet-5-5` or `claude-haiku-5-5` |
| `LLM_EFFORT` | `low` | Anthropic effort: `low`, `medium`, `high` |
| `LLM_MAX_TOKENS` | `64000` | Max output tokens per suggestion |
| `CORS_ORIGINS` | `["http://localhost:5173"]` | JSON list of allowed origins |

Frontend (`web/.env`, optional):

| Variable | Default | Description |
|---|---|---|
| `VITE_API_BASE_URL` | `/api` | Base URL of the backend API |

## Scripts

| Command | What it does |
|---|---|
| `pnpm --dir web dev` | Vite dev server |
| `pnpm --dir web build` | Production build |
| `pnpm --dir web test` | Vitest |
| `pnpm --dir web lint` | ESLint |
| `pnpm --dir web typecheck` | TypeScript |
| `cd api && uv run pytest` | Backend tests |
| `cd api && uv run ruff check . && uv run ruff format --check .` | Backend lint/format |

Git hooks: pre-commit runs lint-staged (ESLint + Prettier) and ruff; pre-push runs the frontend and backend test suites.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `⌘K` / `Ctrl K` | Toggle command palette |
| `/` in the editor | Slash commands |
| `↑` `↓` `↵` `Esc` | Navigate / run / close in the palette and slash menu |

## Architecture

```
web/ (React 19 + Vite)                 api/ (FastAPI)
  Editor | Preview | AI Review tabs           GET  /api/health
  DocumentProvider  — content + selection     GET  /api/models
  SuggestionProvider — active AI proposal     POST /api/suggestions  (SSE: delta / done / error)
  VersionsProvider  — history                   └─ LLMProvider strategy
  ModelProvider / ThemeProvider                     ├─ AnthropicProvider
  localStorage persistence                          └─ OpenRouterProvider
```

The model returns only the replacement text for the target; the browser computes the diff, so every change is reviewed before it touches the document. Specs and implementation plans live in [`docs/specs/`](docs/specs/00-overview.md).
````

- [ ] **Step 2: Run every automated check**

Run: `pnpm --dir web lint && pnpm --dir web typecheck && pnpm --dir web test && pnpm --dir web build`
Expected: lint and typecheck exit 0, all test files pass, and `vite build` prints `✓ built in …`.

Run: `cd api && uv run ruff check . && uv run ruff format --check . && uv run pytest`
Expected: `All checks passed!`, `N files already formatted`, and all tests passed.

- [ ] **Step 3: Manual end-to-end verification**

Start both apps (see README → Running) with a real API key in `api/.env`, open http://localhost:5173, and check each item. Fix anything that fails before moving on.

1. A fresh load (clear site data first) shows the welcome document in the Editor tab, with the light theme.
2. Type text, reload the page: the text persists.
3. The Preview tab renders headings, lists, a GFM table, and code blocks.
4. The model dropdown lists Claude Sonnet 5.5 (selected) and Claude Haiku 5.5. Switching persists across reloads.
5. Select a sentence, type "make it funnier" in Ask AI, press Suggest. The app switches to AI Review, text streams in, and a split diff appears when it finishes.
6. Accept one hunk and reject another: the document reflects exactly the accepted hunk. Flip a decision and confirm the document updates.
7. Start a new suggestion, then Refine with "shorter": a new proposal streams in and replaces the diff.
8. Start a suggestion, edit the target paragraph in the editor during review, then accept a hunk: the stale banner appears and only Discard is offered.
9. Stop during streaming: the suggestion shows "Stopped" and can be discarded.
10. Version history lists the initial version, a "Manual edits" version, and the AI version labelled with the instruction. Selecting one shows its diff, and Restore brings the content back and adds a "Restored …" entry.
11. `⌘K` / `Ctrl K` opens the palette from the editor, the preview, and the AI Review tab. Run "Make more concise" with the cursor in a paragraph: only that paragraph is targeted.
12. In the palette, "Ask AI…" from the Preview tab switches to Editor and focuses the instruction input.
13. In the palette, Switch to dark theme, Export as Markdown (downloads `<first-heading-slug>.md`), and Use Claude Haiku 5.5 all work.
14. In the editor, type `/` at the start of a line: the menu lists `/ask` and the presets. Choose `/fix`: the `/fix` text disappears and a suggestion starts for that paragraph only. On an empty line, `/restructure` targets the whole document. `/ask` focuses the Ask AI input. Typing `and/or` or a URL does not open the menu.
15. While a suggestion is active, the quick-action chips, palette AI items, and Suggest button are all disabled.
16. Stop the backend: the model dropdown shows its error state, and all AI triggers are disabled while the rest of the app keeps working.
17. Dark mode: editor, preview, diff view, palette, and error states are readable. Tab through the header, AskAiBar, tabs, and review controls: everything is reachable and has a visible focus ring.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document features, setup, configuration, and architecture"
```

---

## Self-review checklist (completed while writing)

- Spec coverage: `AiPreset`/`AI_PRESETS` (T1); preset target `block` → `blockRangeAt` (T1/T2); command palette with AI/View/Document/Model groups and Mod-K (T3/T7); header "⌘K" hint button (T7); slash commands, including `/ask` (T5/T6/T7); AskAiBar chips and focus (T4/T7); keyboard shortcut summary (T3 footer, README); disabled/loading states audit (T2 `canRun`, T7 integration test, manual checks 15–16); ErrorBoundary (T8); README (T9); end-to-end checklist (T9).
- Names are consistent across tasks: `useRunPreset → { canRun, runPreset, runPresetAt }`, `SlashSelection`, `useSlashCommandHandler`, `useFocusRequest`, `PresetChips`, `CommandPalette`, `CommandPaletteButton`, `useCommandPaletteShortcut`, `ErrorBoundary`.
