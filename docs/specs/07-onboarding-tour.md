# Phase 7 — Onboarding Tour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show first-time visitors a short guided tour that points at the real UI and explains how the app works: write Markdown, ask the AI, review its diff, and accept or reject changes. The tour runs once automatically and can be replayed from a "?" button in the header.

**Architecture:** A new `features/onboarding/` feature. `tourSteps.ts` holds the ordered list of steps. Each step names an anchor, which is a `data-tour="…"` attribute on an existing element. `tourReducer.ts` is the pure state machine (`idle` / `running` + step index). `placement.ts` is a pure helper that positions the card next to the anchor. `tourStorage.ts` stores which tour version was seen. `TourProvider` owns the reducer. It auto-starts on first visit, makes the rest of the app `inert` while the tour runs, renders `TourOverlay` in a portal, and restores focus when the tour ends. `TourOverlay` draws the spotlight (a fixed box with a large `box-shadow`) and the step card. `TourButton` in `AppHeader` replays the tour. The tour is passive: it never switches tabs mid-tour, never edits the document, and never triggers an AI request.

**Tech Stack:** React 19, TypeScript (strict), Tailwind CSS v4, Zod v4, Vitest + Testing Library + jsdom. No new dependencies.

**Spec:** [docs/specs/00-overview.md](00-overview.md). This phase adds the `features/onboarding/` row to its file map, the `ai-docs:onboarding` localStorage key, and the `TourProvider` level in the provider nesting.

## Global Constraints

- Node 24, pnpm, React 19, TypeScript strict, Tailwind CSS v4 (class-based `dark` variant), Zod v4, Vitest + Testing Library + jsdom.
- **No new dependencies.** Don't use a tour library. Use `getBoundingClientRect` for positioning; don't use floating-ui.
- **Passive tour.** Steps only explain. The tour never calls `useSuggestion().start(...)`, never edits the document, and never changes tabs except one switch to Editor when it starts.
- **One modal at a time.** While the tour runs, the app content is `inert` and the ⌘K shortcut is disabled.
- **Persistence:** key `ai-docs:onboarding`, value `{ seenVersion: number }`, Zod-validated through `loadJson`/`saveJson`. Both Skip and Done write `{ seenVersion: TOUR_VERSION }`. Bumping `TOUR_VERSION` shows the tour again to everyone.
- **Brevity:** at most 8 steps, and each body is at most 240 characters. A test enforces both.
- **Accessibility:**
  - The card is `role="dialog"`, `aria-modal="true"`, labelled by the step title, and described by the body.
  - Keys: Esc skips, → goes to Next (or Done on the last step), ← goes to Back.
  - The primary button gets focus on every step. Focus returns to the previously focused element when the tour ends.
  - Transitions only apply under `motion-safe:`.
- **Lint:** `eslint-plugin-react-hooks` v7 (`flat.recommended`) flags synchronous `setState` inside effects. Measurements therefore set state only from `requestAnimationFrame`, `ResizeObserver`, or event callbacks. Auto-start uses the reducer's lazy initializer, not an effect.
- Tests query by role and name. The `data-tour` attributes are layout hooks for the overlay. Only the anchor-coverage test reads them.
- TDD for every task: failing test → minimal implementation → passing test → commit. Use Conventional Commits.
- Frontend checks: `pnpm --dir web lint`, `pnpm --dir web typecheck`, `pnpm --dir web test`.

## Assumptions about earlier phases (verify before starting)

1. `loadJson` / `saveJson` are exported from `web/src/lib/storage.ts`.
2. `web/src/App.tsx` defines `AppShell`, which owns `activeTab` and renders `VersionsProvider → SuggestionBridge → Workspace`. `Workspace` renders `AppHeader` with `onOpenCommands`, the `Tabs`, the editor panel (`AskAiBar` with `PresetChips` as `quickActions`, plus `MarkdownEditor` inside `<div className="min-h-0 flex-1">`), and `CommandPalette`.
3. `AppHeader({ children, onOpenCommands })` renders `CommandPaletteButton` (when `onOpenCommands` is set), then `children`, then `ThemeToggle`, then `ExportButton`.
4. `useCommandPaletteShortcut(onToggle)` registers a capture-phase `keydown` listener on `window`.
5. `Tabs` renders a `role="tablist"` div. `ModelSelect` renders one `<select aria-label="AI model">` in each of its two branches. `PresetChips` renders `role="group"` with the name "Quick AI actions". `AskAiBar` renders `<form aria-label="Ask AI">`.
6. `web/src/test/setup.ts` clears `localStorage` in `afterEach`, and its hooks run before each test file's own hooks.
7. Providers use `<XContext.Provider value={value}>`, and `useX()` throws outside its provider.

---

### Task 1: Tour steps

**Files:**
- Create: `web/src/features/onboarding/tourSteps.ts`
- Test: `web/src/features/onboarding/tourSteps.test.ts`

**Interfaces:**
- Produces:
  - `type TourAnchor = 'editor' | 'ask-ai' | 'quick-actions' | 'model-select' | 'tabs' | 'commands' | 'export'`
  - `type TourStep = { id: string; anchor: TourAnchor | null; title: string; body: string }` (`anchor: null` means a centered card)
  - `const TOUR_VERSION = 1`
  - `const TOUR_STEPS: TourStep[]`
  - `function anchorSelector(anchor: TourAnchor): string` → `[data-tour="<anchor>"]`

- [ ] **Step 1: Write the failing test**

`web/src/features/onboarding/tourSteps.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { anchorSelector, TOUR_STEPS, TOUR_VERSION } from './tourSteps'

describe('TOUR_STEPS', () => {
  it('stays brief', () => {
    expect(TOUR_STEPS.length).toBeGreaterThan(0)
    expect(TOUR_STEPS.length).toBeLessThanOrEqual(8)
    for (const step of TOUR_STEPS) {
      expect(step.title.trim()).not.toBe('')
      expect(step.body.trim()).not.toBe('')
      expect(step.body.length).toBeLessThanOrEqual(240)
    }
  })

  it('has unique ids and anchors', () => {
    const ids = TOUR_STEPS.map((s) => s.id)
    const anchors = TOUR_STEPS.flatMap((s) => (s.anchor ? [s.anchor] : []))
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(anchors).size).toBe(anchors.length)
  })

  it('opens with a centered welcome and walks the UI in reading order', () => {
    expect(TOUR_STEPS.map((s) => s.anchor)).toEqual([
      null,
      'editor',
      'ask-ai',
      'quick-actions',
      'model-select',
      'tabs',
      'commands',
      'export',
    ])
  })

  it('has a positive version', () => {
    expect(TOUR_VERSION).toBeGreaterThanOrEqual(1)
  })
})

describe('anchorSelector', () => {
  it('builds a data-tour attribute selector', () => {
    expect(anchorSelector('ask-ai')).toBe('[data-tour="ask-ai"]')
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm --dir web exec vitest run src/features/onboarding/tourSteps.test.ts`
Expected: FAIL with `Failed to resolve import "./tourSteps"`.

- [ ] **Step 3: Write the minimal implementation**

`web/src/features/onboarding/tourSteps.ts`:

```ts
export type TourAnchor =
  | 'editor'
  | 'ask-ai'
  | 'quick-actions'
  | 'model-select'
  | 'tabs'
  | 'commands'
  | 'export'

export type TourStep = { id: string; anchor: TourAnchor | null; title: string; body: string }

// Bump when the UI changes enough that returning users should see the tour again.
export const TOUR_VERSION = 1

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    anchor: null,
    title: 'Welcome to AI Docs',
    body: 'Write Markdown and let an AI co-author suggest edits. Nothing changes until you accept it. This quick tour shows you around.',
  },
  {
    id: 'editor',
    anchor: 'editor',
    title: 'Your document',
    body: 'Write Markdown here. It autosaves in this browser. Type / for AI commands without leaving the keyboard.',
  },
  {
    id: 'ask-ai',
    anchor: 'ask-ai',
    title: 'Ask AI',
    body: 'Describe an edit and press Suggest (⌘↵ / Ctrl ↵). Select text first to edit just that part; otherwise the AI works on the whole document.',
  },
  {
    id: 'quick-actions',
    anchor: 'quick-actions',
    title: 'Quick actions',
    body: 'One-click presets for common edits, like improving or shortening the paragraph under your cursor.',
  },
  {
    id: 'model',
    anchor: 'model-select',
    title: 'Pick a model',
    body: 'Choose which model writes the suggestions. Your choice is remembered.',
  },
  {
    id: 'tabs',
    anchor: 'tabs',
    title: 'Preview and review',
    body: 'Preview renders your Markdown. AI Review shows each suggestion as a side-by-side diff: accept or reject changes one by one, refine the request, or restore an earlier version.',
  },
  {
    id: 'commands',
    anchor: 'commands',
    title: 'Command palette',
    body: 'Press ⌘K (Ctrl K on Windows and Linux) to run any action from the keyboard.',
  },
  {
    id: 'export',
    anchor: 'export',
    title: 'Take it with you',
    body: 'Download your document as a .md file. You can replay this tour anytime from the ? button.',
  },
]

export function anchorSelector(anchor: TourAnchor): string {
  return `[data-tour="${anchor}"]`
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --dir web exec vitest run src/features/onboarding/tourSteps.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/onboarding/tourSteps.ts web/src/features/onboarding/tourSteps.test.ts
git commit -m "feat(onboarding): define tour steps"
```

---

### Task 2: Tour reducer

**Files:**
- Create: `web/src/features/onboarding/tourReducer.ts`
- Test: `web/src/features/onboarding/tourReducer.test.ts`

**Interfaces:**
- Produces:
  - `type TourState = { status: 'idle' } | { status: 'running'; index: number; count: number }`
  - `type TourAction = { type: 'start'; count: number } | { type: 'next' } | { type: 'back' } | { type: 'end' }`
  - `const initialTourState: TourState`
  - `function tourReducer(state: TourState, action: TourAction): TourState`
- Rules:
  - `start` restarts at index 0. With `count: 0` it is a no-op.
  - `next` and `back` clamp to `[0, count - 1]` and do nothing while idle.
  - `next` on the last step does **not** end the tour. The overlay's Done button calls `end`, so persisting happens in exactly one place.

- [ ] **Step 1: Write the failing test**

`web/src/features/onboarding/tourReducer.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { initialTourState, tourReducer, type TourState } from './tourReducer'

const running = (index: number, count = 3): TourState => ({ status: 'running', index, count })

describe('tourReducer', () => {
  it('starts idle', () => {
    expect(initialTourState).toEqual({ status: 'idle' })
  })

  it('starts at the first step, also when restarted mid-tour', () => {
    expect(tourReducer(initialTourState, { type: 'start', count: 3 })).toEqual(running(0))
    expect(tourReducer(running(2), { type: 'start', count: 3 })).toEqual(running(0))
  })

  it('ignores a start with no steps', () => {
    expect(tourReducer(initialTourState, { type: 'start', count: 0 })).toEqual(initialTourState)
  })

  it('moves forward and back within bounds', () => {
    expect(tourReducer(running(0), { type: 'next' })).toEqual(running(1))
    expect(tourReducer(running(2), { type: 'next' })).toEqual(running(2))
    expect(tourReducer(running(1), { type: 'back' })).toEqual(running(0))
    expect(tourReducer(running(0), { type: 'back' })).toEqual(running(0))
  })

  it('ignores navigation while idle', () => {
    expect(tourReducer(initialTourState, { type: 'next' })).toEqual(initialTourState)
    expect(tourReducer(initialTourState, { type: 'back' })).toEqual(initialTourState)
  })

  it('ends from any step', () => {
    expect(tourReducer(running(1), { type: 'end' })).toEqual(initialTourState)
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm --dir web exec vitest run src/features/onboarding/tourReducer.test.ts`
Expected: FAIL with `Failed to resolve import "./tourReducer"`.

- [ ] **Step 3: Write the minimal implementation**

`web/src/features/onboarding/tourReducer.ts`:

```ts
export type TourState = { status: 'idle' } | { status: 'running'; index: number; count: number }

export type TourAction =
  | { type: 'start'; count: number }
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'end' }

export const initialTourState: TourState = { status: 'idle' }

export function tourReducer(state: TourState, action: TourAction): TourState {
  switch (action.type) {
    case 'start':
      return action.count > 0 ? { status: 'running', index: 0, count: action.count } : state
    case 'next':
      if (state.status !== 'running') return state
      return { ...state, index: Math.min(state.index + 1, state.count - 1) }
    case 'back':
      if (state.status !== 'running') return state
      return { ...state, index: Math.max(state.index - 1, 0) }
    case 'end':
      return initialTourState
  }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --dir web exec vitest run src/features/onboarding/tourReducer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/onboarding/tourReducer.ts web/src/features/onboarding/tourReducer.test.ts
git commit -m "feat(onboarding): add tour reducer"
```

---

### Task 3: Card placement

**Files:**
- Create: `web/src/features/onboarding/placement.ts`
- Test: `web/src/features/onboarding/placement.test.ts`

**Interfaces:**
- Produces:
  - `type Rect = { top: number; left: number; width: number; height: number }`
  - `type Size = { width: number; height: number }`
  - `const SPOTLIGHT_PADDING = 6`
  - `function placeCard(anchor: Rect | null, card: Size, viewport: Size): { top: number; left: number }`
- Rules (with `GAP = 12` and `MARGIN = 16`):
  1. No anchor: center the card in the viewport. Top and left are never less than `MARGIN`.
  2. With an anchor, `left` centers the card horizontally on the anchor, clamped to `[MARGIN, viewport.width - card.width - MARGIN]`. If the card is wider than the viewport, use `MARGIN`.
  3. Place the card below the spotlight (`anchor.bottom + SPOTLIGHT_PADDING + GAP`) if it fits above `viewport.height - MARGIN`.
  4. Otherwise place it above the spotlight if that keeps `top >= MARGIN`.
  5. Otherwise (the anchor is taller than the viewport allows, like the editor), center it vertically in the viewport. The card then sits over the anchor.

- [ ] **Step 1: Write the failing test**

`web/src/features/onboarding/placement.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { placeCard } from './placement'

const viewport = { width: 1000, height: 800 }
const card = { width: 320, height: 160 }

describe('placeCard', () => {
  it('centers the card when there is no anchor', () => {
    expect(placeCard(null, card, viewport)).toEqual({ top: 320, left: 340 })
  })

  it('places the card below a small anchor, centered on it', () => {
    expect(placeCard({ top: 50, left: 300, width: 200, height: 30 }, card, viewport)).toEqual({
      top: 98,
      left: 240,
    })
  })

  it('clamps horizontally to the viewport margins', () => {
    expect(placeCard({ top: 10, left: 950, width: 40, height: 30 }, card, viewport).left).toBe(664)
    expect(placeCard({ top: 10, left: 0, width: 40, height: 30 }, card, viewport).left).toBe(16)
  })

  it('flips above an anchor near the bottom', () => {
    expect(placeCard({ top: 700, left: 400, width: 200, height: 40 }, card, viewport)).toEqual({
      top: 522,
      left: 340,
    })
  })

  it('centers vertically over an anchor too tall to sit beside', () => {
    expect(placeCard({ top: 100, left: 0, width: 1000, height: 700 }, card, viewport)).toEqual({
      top: 320,
      left: 340,
    })
  })

  it('pins to the margin when the viewport is narrower than the card', () => {
    const narrow = { width: 300, height: 600 }
    expect(placeCard(null, card, narrow).left).toBe(16)
    expect(placeCard({ top: 10, left: 100, width: 50, height: 20 }, card, narrow).left).toBe(16)
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm --dir web exec vitest run src/features/onboarding/placement.test.ts`
Expected: FAIL with `Failed to resolve import "./placement"`.

- [ ] **Step 3: Write the minimal implementation**

`web/src/features/onboarding/placement.ts`:

```ts
export type Rect = { top: number; left: number; width: number; height: number }
export type Size = { width: number; height: number }

export const SPOTLIGHT_PADDING = 6
const GAP = 12
const MARGIN = 16

export function placeCard(anchor: Rect | null, card: Size, viewport: Size): { top: number; left: number } {
  const centeredTop = Math.max(MARGIN, (viewport.height - card.height) / 2)
  if (!anchor) {
    return { top: centeredTop, left: Math.max(MARGIN, (viewport.width - card.width) / 2) }
  }

  const left = clamp(
    anchor.left + anchor.width / 2 - card.width / 2,
    MARGIN,
    viewport.width - card.width - MARGIN,
  )
  const below = anchor.top + anchor.height + SPOTLIGHT_PADDING + GAP
  if (below + card.height <= viewport.height - MARGIN) return { top: below, left }
  const above = anchor.top - SPOTLIGHT_PADDING - GAP - card.height
  if (above >= MARGIN) return { top: above, left }
  return { top: centeredTop, left }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --dir web exec vitest run src/features/onboarding/placement.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/onboarding/placement.ts web/src/features/onboarding/placement.test.ts
git commit -m "feat(onboarding): position the tour card next to its anchor"
```

---

### Task 4: Seen-version storage

**Files:**
- Create: `web/src/features/onboarding/tourStorage.ts`
- Test: `web/src/features/onboarding/tourStorage.test.ts`

**Interfaces:**
- Consumes: `loadJson`, `saveJson` from `lib/storage`; `TOUR_VERSION` from `./tourSteps`.
- Produces:
  - `const ONBOARDING_STORAGE_KEY = 'ai-docs:onboarding'`
  - `function hasSeenTour(): boolean`: true when the stored `seenVersion >= TOUR_VERSION`. A missing or invalid value counts as not seen.
  - `function markTourSeen(): void`: writes `{ seenVersion: TOUR_VERSION }`.

- [ ] **Step 1: Write the failing test**

`web/src/features/onboarding/tourStorage.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { hasSeenTour, markTourSeen, ONBOARDING_STORAGE_KEY } from './tourStorage'
import { TOUR_VERSION } from './tourSteps'

beforeEach(() => {
  // test/setup.ts seeds the key so other suites skip the tour; start clean here.
  localStorage.removeItem(ONBOARDING_STORAGE_KEY)
})

describe('tourStorage', () => {
  it('reports unseen when nothing is stored', () => {
    expect(hasSeenTour()).toBe(false)
  })

  it('round-trips the current version', () => {
    markTourSeen()
    expect(JSON.parse(localStorage.getItem(ONBOARDING_STORAGE_KEY)!)).toEqual({ seenVersion: TOUR_VERSION })
    expect(hasSeenTour()).toBe(true)
  })

  it('treats an older version as unseen', () => {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({ seenVersion: TOUR_VERSION - 1 }))
    expect(hasSeenTour()).toBe(false)
  })

  it('treats invalid data as unseen', () => {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({ seenVersion: 'yes' }))
    expect(hasSeenTour()).toBe(false)
    localStorage.setItem(ONBOARDING_STORAGE_KEY, '{not json')
    expect(hasSeenTour()).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm --dir web exec vitest run src/features/onboarding/tourStorage.test.ts`
Expected: FAIL with `Failed to resolve import "./tourStorage"`.

- [ ] **Step 3: Write the minimal implementation**

`web/src/features/onboarding/tourStorage.ts`:

```ts
import { z } from 'zod'
import { loadJson, saveJson } from '../../lib/storage'
import { TOUR_VERSION } from './tourSteps'

export const ONBOARDING_STORAGE_KEY = 'ai-docs:onboarding'

const onboardingSchema = z.object({ seenVersion: z.number().int().nonnegative() })

export function hasSeenTour(): boolean {
  return loadJson(ONBOARDING_STORAGE_KEY, onboardingSchema, { seenVersion: 0 }).seenVersion >= TOUR_VERSION
}

export function markTourSeen(): void {
  saveJson(ONBOARDING_STORAGE_KEY, { seenVersion: TOUR_VERSION })
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --dir web exec vitest run src/features/onboarding/tourStorage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/onboarding/tourStorage.ts web/src/features/onboarding/tourStorage.test.ts
git commit -m "feat(onboarding): persist the seen tour version"
```

---

### Task 5: Tour overlay

**Files:**
- Create: `web/src/features/onboarding/useAnchorRect.ts`
- Create: `web/src/features/onboarding/TourOverlay.tsx`
- Test: `web/src/features/onboarding/TourOverlay.test.tsx`

**Interfaces:**
- Consumes: `TourStep`, `anchorSelector` (Task 1); `placeCard`, `SPOTLIGHT_PADDING`, `Rect`, `Size` (Task 3).
- Produces:
  - `function useAnchorRect(anchor: TourAnchor | null): Rect | null`
    - Finds `anchorSelector(anchor)` in an effect and scrolls it into view (`block`/`inline: 'nearest'`). At phone width the header overflows, so otherwise Export would be off-screen.
    - Measures on the next animation frame, on `ResizeObserver` callbacks, on window `resize`, and on capture-phase `scroll`.
    - Returns `null` when there is no anchor, the element is missing, or its rect has zero size.
    - State is keyed by anchor, so a stale rect from the previous step is never returned.
  - `function useElementSize(ref: RefObject<HTMLElement | null>, fallback: Size): Size` returns the `ResizeObserver`-measured size, or `fallback` until the first callback.
  - `function useViewportSize(): Size` uses `useSyncExternalStore` on window `resize`.
  - `type TourOverlayProps = { step: TourStep; index: number; count: number; onNext(): void; onBack(): void; onEnd(): void }`
  - `function TourOverlay(props: TourOverlayProps)`
- Markup:
  - The root is `fixed inset-0 z-50`. It contains:
    - A transparent click-catcher whose `onMouseDown` calls `preventDefault`, so a stray click doesn't move focus off the card.
    - **Either** a spotlight `div` (`data-testid="tour-spotlight"`, `aria-hidden`, `pointer-events-none`, `ring-2 ring-sky-500`, `shadow-[0_0_0_9999px_rgb(2_6_23/0.55)]`) placed at the anchor rect grown by `SPOTLIGHT_PADDING`, **or** a full dim layer when there is no anchor rect.
    - The card.
  - The card is `role="dialog"`, `aria-modal="true"`, `aria-labelledby` the title `<h2>`, and `aria-describedby` the body `<p>`. It is `fixed w-80 max-w-[calc(100vw-2rem)]`, positioned with `placeCard(anchorRect, cardSize, viewport)`. The card size fallback is `{ width: 320, height: 200 }`.
  - Card content, in order:
    1. A counter `Step {index + 1} of {count}`.
    2. The title and body.
    3. Buttons: **Skip tour** (calls `onEnd`; hidden on the last step), **Back** (`disabled` on the first step), and the primary **Next** (or **Done** on the last step, which calls `onEnd`).
  - Light and dark styling: `bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100`. The primary button uses the same classes as the "Suggest" button. Position changes animate only under `motion-safe:transition-all`.
- Keyboard: `onKeyDown` on the card. Escape calls `onEnd`. → calls `onNext`, or `onEnd` on the last step. ← calls `onBack`. Each calls `preventDefault`. Don't map Enter: the focused button already handles it, and mapping it would double-fire.
- Focus: an effect focuses the primary button whenever `index` changes.

- [ ] **Step 1: Write the failing test**

`web/src/features/onboarding/TourOverlay.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TourOverlay } from './TourOverlay'
import type { TourStep } from './tourSteps'

const centered: TourStep = { id: 'a', anchor: null, title: 'Hello', body: 'Intro text.' }
const anchored: TourStep = { id: 'b', anchor: 'export', title: 'Export', body: 'Download it.' }

function renderOverlay(props: Partial<Parameters<typeof TourOverlay>[0]> = {}) {
  const handlers = { onNext: vi.fn(), onBack: vi.fn(), onEnd: vi.fn() }
  render(<TourOverlay step={centered} index={1} count={3} {...handlers} {...props} />)
  return handlers
}

describe('TourOverlay', () => {
  it('renders the step as a labelled modal dialog with a counter', () => {
    renderOverlay()
    const dialog = screen.getByRole('dialog', { name: 'Hello' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleDescription('Intro text.')
    expect(dialog).toHaveTextContent('Step 2 of 3')
  })

  it('focuses the primary button', () => {
    renderOverlay()
    expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus()
  })

  it('wires Next, Back and Skip', async () => {
    const user = userEvent.setup()
    const { onNext, onBack, onEnd } = renderOverlay()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(screen.getByRole('button', { name: 'Skip tour' }))
    expect(onNext).toHaveBeenCalledOnce()
    expect(onBack).toHaveBeenCalledOnce()
    expect(onEnd).toHaveBeenCalledOnce()
  })

  it('disables Back on the first step', () => {
    renderOverlay({ index: 0 })
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled()
  })

  it('shows Done instead of Next and Skip on the last step', async () => {
    const user = userEvent.setup()
    const { onNext, onEnd } = renderOverlay({ index: 2 })
    expect(screen.queryByRole('button', { name: 'Skip tour' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(onEnd).toHaveBeenCalledOnce()
    expect(onNext).not.toHaveBeenCalled()
  })

  it('supports Escape and arrow keys', async () => {
    const user = userEvent.setup()
    const { onNext, onBack, onEnd } = renderOverlay()
    await user.keyboard('{ArrowRight}{ArrowLeft}{Escape}')
    expect(onNext).toHaveBeenCalledOnce()
    expect(onBack).toHaveBeenCalledOnce()
    expect(onEnd).toHaveBeenCalledOnce()
  })

  it('ends on ArrowRight from the last step', async () => {
    const user = userEvent.setup()
    const { onNext, onEnd } = renderOverlay({ index: 2 })
    await user.keyboard('{ArrowRight}')
    expect(onEnd).toHaveBeenCalledOnce()
    expect(onNext).not.toHaveBeenCalled()
  })

  it('falls back to a centered card when the anchor is missing', () => {
    renderOverlay({ step: anchored })
    expect(screen.getByRole('dialog', { name: 'Export' })).toBeInTheDocument()
    expect(screen.queryByTestId('tour-spotlight')).not.toBeInTheDocument()
  })

  it('spotlights the anchor element', async () => {
    const target = document.createElement('button')
    target.dataset.tour = 'export'
    target.getBoundingClientRect = () => ({ top: 10, left: 900, width: 80, height: 30 }) as DOMRect
    document.body.append(target)
    try {
      renderOverlay({ step: anchored })
      const spotlight = await screen.findByTestId('tour-spotlight')
      await waitFor(() =>
        expect(spotlight).toHaveStyle({ top: '4px', left: '894px', width: '92px', height: '42px' }),
      )
    } finally {
      target.remove()
    }
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm --dir web exec vitest run src/features/onboarding/TourOverlay.test.tsx`
Expected: FAIL with `Failed to resolve import "./TourOverlay"`.

- [ ] **Step 3: Write the minimal implementation**

`web/src/features/onboarding/useAnchorRect.ts`:

```ts
import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react'
import type { Rect, Size } from './placement'
import { anchorSelector, type TourAnchor } from './tourSteps'

type Measured = { anchor: TourAnchor; rect: Rect | null }

export function useAnchorRect(anchor: TourAnchor | null): Rect | null {
  const [measured, setMeasured] = useState<Measured | null>(null)

  useEffect(() => {
    if (!anchor) return
    const element = document.querySelector(anchorSelector(anchor))
    if (!element) return
    // On narrow screens the anchor may be scrolled out of view (e.g. an overflowing header).
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    const measure = () => setMeasured({ anchor, rect: toRect(element.getBoundingClientRect()) })
    // Measure asynchronously: setState directly in the effect body trips react-hooks/set-state-in-effect.
    const frame = requestAnimationFrame(measure)
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [anchor])

  return measured && measured.anchor === anchor ? measured.rect : null
}

export function useElementSize(ref: RefObject<HTMLElement | null>, fallback: Size): Size {
  const [size, setSize] = useState<Size | null>(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(() => {
      const { width, height } = element.getBoundingClientRect()
      setSize({ width, height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])

  return size ?? fallback
}

function subscribeResize(onChange: () => void) {
  window.addEventListener('resize', onChange)
  return () => window.removeEventListener('resize', onChange)
}

export function useViewportSize(): Size {
  const width = useSyncExternalStore(subscribeResize, () => window.innerWidth)
  const height = useSyncExternalStore(subscribeResize, () => window.innerHeight)
  return { width, height }
}

function toRect(rect: DOMRect): Rect | null {
  if (rect.width <= 0 || rect.height <= 0) return null
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
}
```

`web/src/features/onboarding/TourOverlay.tsx`:

```tsx
import { useEffect, useId, useRef, type KeyboardEvent } from 'react'
import { placeCard, SPOTLIGHT_PADDING } from './placement'
import type { TourStep } from './tourSteps'
import { useAnchorRect, useElementSize, useViewportSize } from './useAnchorRect'

const CARD_FALLBACK_SIZE = { width: 320, height: 200 }

export type TourOverlayProps = {
  step: TourStep
  index: number
  count: number
  onNext(): void
  onBack(): void
  onEnd(): void
}

export function TourOverlay({ step, index, count, onNext, onBack, onEnd }: TourOverlayProps) {
  const titleId = useId()
  const bodyId = useId()
  const cardRef = useRef<HTMLDivElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
  const anchorRect = useAnchorRect(step.anchor)
  const cardSize = useElementSize(cardRef, CARD_FALLBACK_SIZE)
  const viewport = useViewportSize()
  const isFirst = index === 0
  const isLast = index === count - 1
  const position = placeCard(anchorRect, cardSize, viewport)

  useEffect(() => {
    primaryRef.current?.focus()
  }, [index])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const actions: Record<string, () => void> = {
      Escape: onEnd,
      ArrowRight: isLast ? onEnd : onNext,
      ArrowLeft: onBack,
    }
    const action = actions[event.key]
    if (!action) return
    event.preventDefault()
    action()
  }

  return (
    <div className="fixed inset-0 z-50">
      <div aria-hidden="true" className="absolute inset-0" onMouseDown={(event) => event.preventDefault()} />
      {anchorRect ? (
        <div
          data-testid="tour-spotlight"
          aria-hidden="true"
          className="pointer-events-none fixed rounded-lg shadow-[0_0_0_9999px_rgb(2_6_23/0.55)] ring-2 ring-sky-500 motion-safe:transition-all"
          style={{
            top: anchorRect.top - SPOTLIGHT_PADDING,
            left: anchorRect.left - SPOTLIGHT_PADDING,
            width: anchorRect.width + SPOTLIGHT_PADDING * 2,
            height: anchorRect.height + SPOTLIGHT_PADDING * 2,
          }}
        />
      ) : (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-slate-950/55" />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onKeyDown={handleKeyDown}
        style={{ top: position.top, left: position.left }}
        className="fixed w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white p-4 text-slate-900 shadow-xl motion-safe:transition-all dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      >
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Step {index + 1} of {count}
        </p>
        <h2 id={titleId} className="mt-1 text-base font-semibold">
          {step.title}
        </h2>
        <p id={bodyId} className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          {step.body}
        </p>
        <div className="mt-4 flex items-center gap-2">
          {!isLast && (
            <button
              type="button"
              onClick={onEnd}
              className="rounded-md px-2 py-1 text-sm text-slate-500 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-sky-500 dark:text-slate-400 dark:hover:text-slate-100"
            >
              Skip tour
            </button>
          )}
          <button
            type="button"
            onClick={onBack}
            disabled={isFirst}
            className="ml-auto rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-sky-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800"
          >
            Back
          </button>
          <button
            ref={primaryRef}
            type="button"
            onClick={isLast ? onEnd : onNext}
            className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
          >
            {isLast ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --dir web exec vitest run src/features/onboarding/TourOverlay.test.tsx`
Expected: PASS. The spotlight test depends on `requestAnimationFrame`, which jsdom provides. If it doesn't run in this Vitest/jsdom version, add a `requestAnimationFrame` → `setTimeout(cb, 0)` shim to `test/setup.ts` instead of changing the hook.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/onboarding/useAnchorRect.ts web/src/features/onboarding/TourOverlay.tsx web/src/features/onboarding/TourOverlay.test.tsx
git commit -m "feat(onboarding): add spotlight tour overlay"
```

---

### Task 6: Tour provider

**Files:**
- Create: `web/src/features/onboarding/TourProvider.tsx`
- Test: `web/src/features/onboarding/TourProvider.test.tsx`

**Interfaces:**
- Consumes: `tourReducer`, `initialTourState` (Task 2); `hasSeenTour`, `markTourSeen` (Task 4); `TourOverlay` (Task 5); `TOUR_STEPS`, `TourStep` (Task 1).
- Produces:
  - `type TourContextValue = { isActive: boolean; start(): void }`
  - `function TourProvider({ children, onStart, steps = TOUR_STEPS }: { children: ReactNode; onStart?(): void; steps?: TourStep[] })`
  - `function useTour(): TourContextValue` (throws outside the provider, like the other `useX` hooks)
- Behavior:
  - **Auto-start:** `useReducer(tourReducer, steps.length, init)`, where `init` returns `running` at index 0 when `!hasSeenTour()` and `steps.length > 0`, else `idle`. No effect is involved. `onStart` is **not** called on auto-start, because the app already opens on the Editor tab.
  - **`start()`:** saves `document.activeElement` (when it is an `HTMLElement`) to a ref, calls `onStart?.()`, and dispatches `start`.
  - **`end()`:** calls `markTourSeen()` and dispatches `end`. A `useEffect` on `status` focuses the saved element once the status is `idle`, then clears the ref. It runs after commit, when `inert` has already been removed.
  - **Render:**
    - Wrap `children` in `<div inert={isActive} className="contents">`. `contents` keeps the layout unchanged, and `inert` blocks pointer, focus, and screen-reader access to the app.
    - While running, render `createPortal(<TourOverlay … />, document.body)` outside the inert wrapper.
    - Memoize the context value.
- Edge case: if `localStorage` is unavailable, `hasSeenTour()` returns false on every load and `markTourSeen()` fails silently. The tour then shows on every visit. That's acceptable.

- [ ] **Step 1: Write the failing test**

`web/src/features/onboarding/TourProvider.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TourProvider, useTour } from './TourProvider'
import { ONBOARDING_STORAGE_KEY } from './tourStorage'
import { TOUR_VERSION, type TourStep } from './tourSteps'

const steps: TourStep[] = [
  { id: 'one', anchor: null, title: 'First', body: 'First body.' },
  { id: 'two', anchor: null, title: 'Second', body: 'Second body.' },
]

function Replay() {
  const { isActive, start } = useTour()
  return (
    <button type="button" onClick={start}>
      {isActive ? 'Touring' : 'Replay'}
    </button>
  )
}

function renderTour(onStart = vi.fn()) {
  render(
    <TourProvider steps={steps} onStart={onStart}>
      <Replay />
    </TourProvider>,
  )
  return { onStart }
}

const markSeen = (version = TOUR_VERSION) =>
  localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({ seenVersion: version }))

beforeEach(() => {
  localStorage.removeItem(ONBOARDING_STORAGE_KEY)
})

describe('TourProvider', () => {
  it('auto-starts on the first visit without calling onStart', () => {
    const { onStart } = renderTour()
    expect(screen.getByRole('dialog', { name: 'First' })).toBeInTheDocument()
    expect(onStart).not.toHaveBeenCalled()
  })

  it('makes the app inert while running', () => {
    renderTour()
    expect(screen.getByText('Touring').closest('[inert]')).not.toBeNull()
  })

  it('stays closed once the current version was seen', () => {
    markSeen()
    renderTour()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Replay' }).closest('[inert]')).toBeNull()
  })

  it('shows again after the tour version is bumped', () => {
    markSeen(TOUR_VERSION - 1)
    renderTour()
    expect(screen.getByRole('dialog', { name: 'First' })).toBeInTheDocument()
  })

  it('persists the seen version on skip and closes', async () => {
    const user = userEvent.setup()
    renderTour()
    await user.click(screen.getByRole('button', { name: 'Skip tour' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(ONBOARDING_STORAGE_KEY)!)).toEqual({ seenVersion: TOUR_VERSION })
  })

  it('walks to Done and persists', async () => {
    const user = userEvent.setup()
    renderTour()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByRole('dialog', { name: 'Second' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).not.toBeNull()
  })

  it('replays on start(), calls onStart, and restores focus when it ends', async () => {
    const user = userEvent.setup()
    markSeen()
    const { onStart } = renderTour()
    await user.click(screen.getByRole('button', { name: 'Replay' }))
    expect(onStart).toHaveBeenCalledOnce()
    expect(screen.getByRole('dialog', { name: 'First' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'Replay' })).toHaveFocus()
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm --dir web exec vitest run src/features/onboarding/TourProvider.test.tsx`
Expected: FAIL with `Failed to resolve import "./TourProvider"`.

- [ ] **Step 3: Write the minimal implementation**

`web/src/features/onboarding/TourProvider.tsx`:

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
import { createPortal } from 'react-dom'
import { TourOverlay } from './TourOverlay'
import { initialTourState, tourReducer, type TourState } from './tourReducer'
import { hasSeenTour, markTourSeen } from './tourStorage'
import { TOUR_STEPS, type TourStep } from './tourSteps'

type TourContextValue = { isActive: boolean; start(): void }

const TourContext = createContext<TourContextValue | null>(null)

function initTour(count: number): TourState {
  return count > 0 && !hasSeenTour() ? { status: 'running', index: 0, count } : initialTourState
}

export function TourProvider({
  children,
  onStart,
  steps = TOUR_STEPS,
}: {
  children: ReactNode
  onStart?(): void
  steps?: TourStep[]
}) {
  const [state, dispatch] = useReducer(tourReducer, steps.length, initTour)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const isActive = state.status === 'running'

  const start = useCallback(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    onStart?.()
    dispatch({ type: 'start', count: steps.length })
  }, [onStart, steps.length])

  const end = useCallback(() => {
    markTourSeen()
    dispatch({ type: 'end' })
  }, [])
  const next = useCallback(() => dispatch({ type: 'next' }), [])
  const back = useCallback(() => dispatch({ type: 'back' }), [])

  // Restore focus after commit, once the app is no longer inert.
  useEffect(() => {
    if (state.status !== 'idle' || !returnFocusRef.current) return
    returnFocusRef.current.focus()
    returnFocusRef.current = null
  }, [state.status])

  const value = useMemo(() => ({ isActive, start }), [isActive, start])

  return (
    <TourContext.Provider value={value}>
      <div inert={isActive} className="contents">
        {children}
      </div>
      {state.status === 'running' &&
        createPortal(
          <TourOverlay
            step={steps[state.index]}
            index={state.index}
            count={state.count}
            onNext={next}
            onBack={back}
            onEnd={end}
          />,
          document.body,
        )}
    </TourContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- hook colocated with its provider
export function useTour(): TourContextValue {
  const context = useContext(TourContext)
  if (!context) throw new Error('useTour must be used within TourProvider')
  return context
}
```

Match the `react-refresh` disable comment and the error message to how `useDocument` and `useTheme` do it in this repo.

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm --dir web exec vitest run src/features/onboarding/TourProvider.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/onboarding/TourProvider.tsx web/src/features/onboarding/TourProvider.test.tsx
git commit -m "feat(onboarding): add tour provider with first-visit auto-start"
```

---

### Task 7: Wire the tour into the app

**Files:**
- Create: `web/src/features/onboarding/TourButton.tsx`
- Create: `web/src/App.onboarding.test.tsx`
- Modify: `web/src/test/setup.ts`. Seed the onboarding key so existing suites never see the tour.
- Modify: `web/src/App.tsx` (`TourProvider` in `AppShell`, `onStartTour`, shortcut gating, `data-tour="editor"`)
- Modify: `web/src/features/layout/AppHeader.tsx` (+ `AppHeader.test.tsx`)
- Modify: `web/src/features/commands/useCommandPaletteShortcut.ts`
- Modify (anchors only): `features/suggestions/AskAiBar.tsx`, `features/commands/PresetChips.tsx`, `features/ai/ModelSelect.tsx`, `features/layout/Tabs.tsx`, `features/commands/CommandPaletteButton.tsx`, `features/document/ExportButton.tsx`

**Interfaces:**
- `TourButton({ onClick }: { onClick(): void })` renders a `<button type="button" aria-label="Take the tour" title="Take the tour">` with an `aria-hidden` "?" glyph. It uses the same classes as `ThemeToggle`.
- `AppHeaderProps` gains `onStartTour?: () => void`. When it is set, `TourButton` renders right before `ThemeToggle`.
- `useCommandPaletteShortcut(onToggle, enabled = true)`: when `enabled` is false, no listener is registered.
- Anchors (attribute only, no other changes):

  | Anchor | Element |
  |---|---|
  | `editor` | the `<div className="min-h-0 flex-1">` wrapping `MarkdownEditor` in `App.tsx` |
  | `ask-ai` | `<form aria-label="Ask AI">` in `AskAiBar` |
  | `quick-actions` | the `role="group"` div in `PresetChips` |
  | `model-select` | **both** `<select>` branches in `ModelSelect` |
  | `tabs` | the `role="tablist"` div in `Tabs` |
  | `commands` | the button in `CommandPaletteButton` |
  | `export` | the button in `ExportButton` |

- `AppShell` final form:

  ```tsx
  function AppShell() {
    const [activeTab, setActiveTab] = useState<TabId>('editor')
    const openReview = useCallback(() => setActiveTab('review'), [])
    const openEditor = useCallback(() => setActiveTab('editor'), [])

    return (
      <TourProvider onStart={openEditor}>
        <VersionsProvider>
          <SuggestionBridge onStart={openReview}>
            <Workspace activeTab={activeTab} onTabChange={setActiveTab} />
          </SuggestionBridge>
        </VersionsProvider>
      </TourProvider>
    )
  }
  ```

  In `Workspace`, use `const { isActive: touring, start: startTour } = useTour()`, `useCommandPaletteShortcut(togglePalette, !touring)`, and `<AppHeader onOpenCommands={…} onStartTour={startTour}>`.

- [ ] **Step 1: Seed the key in test setup**

Do this first so the existing App suites keep passing once the provider is wired in. In `web/src/test/setup.ts`, add the imports and extend the existing `beforeEach`:

```ts
import { ONBOARDING_STORAGE_KEY } from '../features/onboarding/tourStorage'
import { TOUR_VERSION } from '../features/onboarding/tourSteps'

beforeEach(() => {
  // Every suite starts as a returning user; onboarding tests remove this key to see the tour.
  localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({ seenVersion: TOUR_VERSION }))
  vi.stubGlobal(/* …unchanged… */)
})
```

Run `pnpm --dir web test`. Expected: PASS. `lib/storage.test.ts` clears `localStorage` in its own `beforeEach`, so it isn't affected.

- [ ] **Step 2: Write the failing tests**

Add the following to `web/src/features/layout/AppHeader.test.tsx`. You'll also need to import `userEvent` and `vi`:

```tsx
it('shows a tour button only when onStartTour is given', async () => {
  const user = userEvent.setup()
  const onStartTour = vi.fn()
  const { rerender } = render(
    <ThemeProvider>
      <DocumentProvider>
        <AppHeader />
      </DocumentProvider>
    </ThemeProvider>,
  )
  expect(screen.queryByRole('button', { name: 'Take the tour' })).not.toBeInTheDocument()
  rerender(
    <ThemeProvider>
      <DocumentProvider>
        <AppHeader onStartTour={onStartTour} />
      </DocumentProvider>
    </ThemeProvider>,
  )
  await user.click(screen.getByRole('button', { name: 'Take the tour' }))
  expect(onStartTour).toHaveBeenCalledOnce()
})
```

`web/src/App.onboarding.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from './App'
import { ONBOARDING_STORAGE_KEY } from './features/onboarding/tourStorage'
import { anchorSelector, TOUR_STEPS } from './features/onboarding/tourSteps'

beforeEach(() => {
  localStorage.removeItem(ONBOARDING_STORAGE_KEY)
})

describe('App onboarding tour', () => {
  it('greets first-time visitors and does not return after Done', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<App />)
    expect(screen.getByRole('dialog', { name: 'Welcome to AI Docs' })).toBeInTheDocument()

    for (let i = 1; i < TOUR_STEPS.length; i++) {
      await user.click(screen.getByRole('button', { name: 'Next' }))
      expect(screen.getByRole('dialog', { name: TOUR_STEPS[i].title })).toBeInTheDocument()
    }
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    unmount()
    render(<App />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('has every step anchor in the rendered app', () => {
    render(<App />)
    for (const step of TOUR_STEPS) {
      if (step.anchor) expect(document.querySelector(anchorSelector(step.anchor))).not.toBeNull()
    }
  })

  it('replays from the header and switches to the Editor tab', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('tab', { name: 'Preview' }))
    await user.click(screen.getByRole('button', { name: 'Take the tour' }))
    expect(screen.getByRole('dialog', { name: 'Welcome to AI Docs' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Editor' })).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'Take the tour' })).toHaveFocus()
  })

  it('ignores the command palette shortcut while touring', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.keyboard('{Control>}k{/Control}')
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Welcome to AI Docs' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `pnpm --dir web exec vitest run src/App.onboarding.test.tsx src/features/layout/AppHeader.test.tsx`
Expected: FAIL. There's no dialog, no "Take the tour" button, and no anchors yet.

- [ ] **Step 4: Implement**

1. Create `TourButton.tsx` as described in Interfaces.
2. Add `onStartTour` to `AppHeader` and render `{onStartTour && <TourButton onClick={onStartTour} />}` right before `<ThemeToggle />`.
3. Add the `enabled` parameter to `useCommandPaletteShortcut`: `if (!enabled) return` at the top of the effect, with `enabled` in the deps.
4. Add the seven `data-tour` attributes from the anchor table.
5. Update `AppShell` and `Workspace` in `App.tsx` as shown above.

- [ ] **Step 5: Run the full frontend checks**

Run: `pnpm --dir web lint && pnpm --dir web typecheck && pnpm --dir web test`
Expected: all PASS, and the existing `App.*.test.tsx` suites pass unchanged.

- [ ] **Step 6: Commit**

```bash
git add web/src
git commit -m "feat(onboarding): show the tour on first visit and replay it from the header"
```

---

### Task 8: Docs and manual verification

**Files:**
- Check: `docs/specs/00-overview.md` was updated together with this spec. It has the phase 7 row, the `ai-docs:onboarding` key, the file map entry, `TourProvider` in the provider nesting, and the UX notes. Fix anything the implementation changed.
- Modify: `README.md`: a Features bullet ("Guided first-run tour, replayable from **?**") and the tour keys in Keyboard shortcuts (`←` `→` `Esc` while the tour is open).
- Modify: `CLAUDE.md`: add `TourProvider` to the provider nesting line, and add `tourReducer.ts` and `placement.ts` to the list of pure, tested helpers.

- [ ] **Step 1: Update the docs listed above.**
- [ ] **Step 2: Manual check in the browser** (`./start.sh --skip-install`, a fresh profile, or clear the `ai-docs:onboarding` key):
  1. On first load, the welcome card is centered over a dimmed app.
  2. Each Next spotlights the right element. The card never leaves the viewport at 1440×900, 1024×768, or 390×844 (phone width).
  3. The editor step's card sits over the editor (centered fallback) and stays readable.
  4. Resizing the window mid-tour keeps the spotlight aligned.
  5. Esc, → and ← work. Tab never leaves the card for the app behind it. Clicking the dimmed area does nothing.
  6. ⌘K does nothing during the tour and works after it.
  7. Dark theme: the card, ring, and dimming all look right.
  8. With OS "reduce motion" on, there are no transitions.
  9. After a reload, the tour doesn't reappear. "?" replays it and returns focus to "?" afterwards.
  10. Starting "?" while a suggestion is under review switches to Editor. After the tour, the AI Review tab still holds the suggestion and its badge.
- [ ] **Step 3: Commit**

```bash
git add README.md CLAUDE.md docs/specs/00-overview.md
git commit -m "docs: document the onboarding tour"
```

---

## Out of scope

- Interactive steps that wait for a user action, and steps that run a real AI suggestion.
- Per-feature "what's new" hints. Bumping `TOUR_VERSION` is the only re-show mechanism.
- Analytics on tour completion.
- Localization of tour copy.

## Self-review checklist (completed while writing)

- Spec coverage:
  - Anchored coachmarks: T5 (overlay, spotlight, placement) and T7 (anchors).
  - No dependencies: T3 and T5 use only the DOM and React.
  - Passive tour: T1 copy only; the T6 provider never touches suggestions or the document.
  - Auto-start on first visit with versioned persistence: T4 and T6.
  - Replay from the header: T7.
  - Accessibility (dialog semantics, keys, focus, inert, reduced motion): T5 and T6, plus the T8 manual checks.
  - ⌘K conflict: T7.
  - Existing suites unaffected: the T7 Step 1 seed.
- Names are consistent across tasks: `TourStep`, `TourAnchor`, `TOUR_STEPS`, `TOUR_VERSION`, `anchorSelector`, `tourReducer`, `initialTourState`, `placeCard`, `SPOTLIGHT_PADDING`, `ONBOARDING_STORAGE_KEY`, `hasSeenTour`, `markTourSeen`, `useAnchorRect`, `useElementSize`, `useViewportSize`, `TourOverlay`, `TourProvider`, `useTour`, `TourButton`, `onStartTour`.
- Placement numbers in T3 were checked by hand. Example: below = 50 + 30 + 6 + 12 = 98, and left = 300 + 100 − 160 = 240.
