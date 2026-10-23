# Phase 2 — Editor Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working Markdown editor with no AI yet: three tabs (Editor / Preview / AI Review placeholder), a CodeMirror 6 editor, a rendered preview, autosave to localStorage, export to a `.md` file, and a light/dark theme toggle.

**Architecture:** All state lives in React context providers (`ThemeProvider`, `DocumentProvider`). Pure helpers (`storage`, `theme`, `exportFilename`) carry the logic and are unit-tested on their own. The editor is a thin React wrapper around a CodeMirror `EditorView` that is created once. Props are synced into the view through `Compartment`s and minimal change transactions. All tab panels stay mounted, and inactive ones are only hidden, so the editor keeps its undo history and cursor when the user switches tabs.

**Tech Stack:** React 19, TypeScript (strict), Vite, Tailwind CSS v4 (+ `@tailwindcss/typography`), Zod v4, CodeMirror 6, `react-markdown` + `remark-gfm`, Vitest + Testing Library + jsdom.

**Spec:** [docs/specs/00-overview.md](00-overview.md). Read the "Frontend contract" section before starting. Names and signatures below are copied from it.

## Global Constraints

- Node 24, pnpm. Run all frontend commands from the repo root with `pnpm --dir frontend …`.
- TypeScript strict. No `any`.
- localStorage keys: `ai-docs:document` → `{ content: string; updatedAt: number }`, `ai-docs:theme` → `"light" | "dark"`. Every read is validated with Zod and never throws.
- Theme defaults to `light`. Dark mode adds the class `dark` on `document.documentElement` (Tailwind v4 class-based dark variant, set up in phase 1).
- Document autosave is debounced by **300 ms**.
- Export filename: slug of the first `# ` heading + `.md`, otherwise `document.md`.
- `TextRange = { from: number; to: number }` uses UTF-16 offsets, with `from <= to`.
- `TabId = 'editor' | 'preview' | 'review'`. Tab labels: `Editor`, `Preview`, `AI Review`.
- All interactive controls are keyboard-reachable and have accessible names. Tests query by role and name.
- TDD on every task: failing test → minimal implementation → passing test → commit (Conventional Commits).
- No network calls in this phase.

## Assumptions about phase 1 output

- `frontend/` exists with Vite + React 19 + TS, and the scripts `lint`, `typecheck`, `test` (`vitest run`), `build`, `dev`.
- `frontend/src/index.css` imports Tailwind, registers `@plugin "@tailwindcss/typography";`, and declares `@custom-variant dark (&:where(.dark, .dark *));`.
- `frontend/src/test/setup.ts` is registered in Vitest `setupFiles`. It imports `@testing-library/jest-dom/vitest` and clears `localStorage` after each test.
- `zod` is already a dependency (used by `src/env.ts`).

If any of these is missing, fix it in phase 1 before starting.

## File structure (this phase)

```
frontend/src/
  lib/storage.ts            + storage.test.ts          loadJson / saveJson
  lib/download.ts           + download.test.ts         downloadTextFile
  lib/id.ts                 + id.test.ts               createId
  features/theme/theme.ts   + theme.test.ts            Theme type, key, schema, pure helpers
  features/theme/ThemeProvider.tsx + ThemeProvider.test.tsx   context + useTheme
  features/theme/ThemeToggle.tsx   + ThemeToggle.test.tsx
  features/document/schema.ts                          TextRange, storage key + schema
  features/document/initialContent.ts                  welcome Markdown
  features/document/exportFilename.ts + exportFilename.test.ts
  features/document/DocumentProvider.tsx + DocumentProvider.test.tsx   context + useDocument
  features/document/ExportButton.tsx     + ExportButton.test.tsx
  features/editor/MarkdownEditor.tsx     + MarkdownEditor.test.tsx
  features/preview/MarkdownPreview.tsx   + MarkdownPreview.test.tsx
  features/layout/Tabs.tsx               + Tabs.test.tsx
  features/layout/AppHeader.tsx          + AppHeader.test.tsx
  App.tsx                                + App.test.tsx
  main.tsx                               (rewritten)
  test/setup.ts                          (append jsdom polyfills for CodeMirror)
```

---

### Task 1: Storage, download and id utilities

**Files:**
- Create: `frontend/src/lib/storage.ts`, `frontend/src/lib/download.ts`, `frontend/src/lib/id.ts`
- Test: `frontend/src/lib/storage.test.ts`, `frontend/src/lib/download.test.ts`, `frontend/src/lib/id.test.ts`

**Interfaces:**
- Consumes: `zod` (phase 1).
- Produces:
  - `loadJson<T>(key: string, schema: z.ZodType<T>, fallback: T): T` (never throws)
  - `saveJson(key: string, value: unknown): boolean` (returns `false` on a quota error or any other error)
  - `downloadTextFile(filename: string, text: string, mime?: string): void` (default mime `"text/markdown;charset=utf-8"`)
  - `createId(): string`

- [ ] **Step 1: Write the failing tests**

`frontend/src/lib/storage.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { loadJson, saveJson } from './storage'

const schema = z.object({ n: z.number() })

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('loadJson', () => {
  it('returns the fallback when the key is missing', () => {
    expect(loadJson('k', schema, { n: 0 })).toEqual({ n: 0 })
  })

  it('returns parsed data when it matches the schema', () => {
    localStorage.setItem('k', JSON.stringify({ n: 5 }))
    expect(loadJson('k', schema, { n: 0 })).toEqual({ n: 5 })
  })

  it('returns the fallback for invalid JSON', () => {
    localStorage.setItem('k', '{not json')
    expect(loadJson('k', schema, { n: 0 })).toEqual({ n: 0 })
  })

  it('returns the fallback when data does not match the schema', () => {
    localStorage.setItem('k', JSON.stringify({ n: 'five' }))
    expect(loadJson('k', schema, { n: 0 })).toEqual({ n: 0 })
  })

  it('returns the fallback when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(loadJson('k', schema, { n: 0 })).toEqual({ n: 0 })
  })
})

describe('saveJson', () => {
  it('stores the value as JSON and returns true', () => {
    expect(saveJson('k', { n: 1 })).toBe(true)
    expect(localStorage.getItem('k')).toBe('{"n":1}')
  })

  it('returns false when setItem throws (e.g. quota exceeded)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    expect(saveJson('k', { n: 1 })).toBe(false)
  })
})
```

`frontend/src/lib/download.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadTextFile } from './download'

describe('downloadTextFile', () => {
  const createObjectURL = vi.fn(() => 'blob:mock-url')
  const revokeObjectURL = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true })
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    createObjectURL.mockClear()
    revokeObjectURL.mockClear()
  })

  it('clicks a temporary anchor with the filename and a blob URL, then revokes it', () => {
    const clicked: HTMLAnchorElement[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this)
    })

    downloadTextFile('notes.md', '# Hi')

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const blob = (createObjectURL.mock.calls[0] as unknown[])[0] as Blob
    expect(blob.type).toBe('text/markdown;charset=utf-8')
    expect(clicked).toHaveLength(1)
    expect(clicked[0].download).toBe('notes.md')
    expect(clicked[0].href).toBe('blob:mock-url')
    expect(document.querySelector('a[download]')).toBeNull()

    vi.runAllTimers()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
  })

  it('uses a custom mime type when given', () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    downloadTextFile('a.txt', 'x', 'text/plain')
    const blob = (createObjectURL.mock.calls[0] as unknown[])[0] as Blob
    expect(blob.type).toBe('text/plain')
  })
})
```

`frontend/src/lib/id.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { createId } from './id'

describe('createId', () => {
  it('returns unique UUID strings', () => {
    const a = createId()
    const b = createId()
    expect(a).toMatch(/^[0-9a-f-]{36}$/)
    expect(a).not.toBe(b)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --dir frontend exec vitest run src/lib`
Expected: FAIL. Each file reports `Failed to resolve import "./storage"` (or `./download`, `./id`).

- [ ] **Step 3: Write the minimal implementation**

`frontend/src/lib/storage.ts`:
```ts
import type { z } from 'zod'

export function loadJson<T>(key: string, schema: z.ZodType<T>, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return fallback
    const parsed = schema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : fallback
  } catch {
    return fallback
  }
}

export function saveJson(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}
```

`frontend/src/lib/download.ts`:
```ts
export function downloadTextFile(
  filename: string,
  text: string,
  mime = 'text/markdown;charset=utf-8',
): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Revoke on the next tick so the browser has started the download.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
```

`frontend/src/lib/id.ts`:
```ts
export function createId(): string {
  return crypto.randomUUID()
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --dir frontend exec vitest run src/lib`
Expected: PASS (3 files, 10 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib
git commit -m "feat(frontend): add storage, download and id utilities"
```

---

### Task 2: Theme (pure helpers, provider, toggle)

**Files:**
- Create: `frontend/src/features/theme/theme.ts`, `frontend/src/features/theme/ThemeProvider.tsx`, `frontend/src/features/theme/ThemeToggle.tsx`
- Test: `frontend/src/features/theme/theme.test.ts`, `frontend/src/features/theme/ThemeProvider.test.tsx`, `frontend/src/features/theme/ThemeToggle.test.tsx`

**Interfaces:**
- Consumes: `loadJson`, `saveJson` from `src/lib/storage.ts` (Task 1).
- Produces:
  - `theme.ts`: `type Theme = 'light' | 'dark'`, `THEME_STORAGE_KEY = 'ai-docs:theme'`, `themeSchema`, `DEFAULT_THEME: Theme = 'light'`, `loadTheme(): Theme`, `nextTheme(t: Theme): Theme`, `applyTheme(theme: Theme, root?: HTMLElement): void`
  - `ThemeProvider.tsx`: `ThemeProvider({ children })`, `useTheme(): { theme: Theme; setTheme(t: Theme): void; toggleTheme(): void }` (throws outside the provider)
  - `ThemeToggle.tsx`: `ThemeToggle()`, a button with the accessible name "Switch to dark theme" / "Switch to light theme"

- [ ] **Step 1: Write the failing tests**

`frontend/src/features/theme/theme.test.ts`:
```ts
import { afterEach, describe, expect, it } from 'vitest'
import { applyTheme, DEFAULT_THEME, loadTheme, nextTheme, THEME_STORAGE_KEY } from './theme'

afterEach(() => {
  document.documentElement.className = ''
  document.documentElement.style.colorScheme = ''
})

describe('theme helpers', () => {
  it('defaults to light', () => {
    expect(DEFAULT_THEME).toBe('light')
    expect(loadTheme()).toBe('light')
  })

  it('loads a stored theme', () => {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify('dark'))
    expect(loadTheme()).toBe('dark')
  })

  it('falls back to light for an invalid stored value', () => {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify('purple'))
    expect(loadTheme()).toBe('light')
  })

  it('toggles between light and dark', () => {
    expect(nextTheme('light')).toBe('dark')
    expect(nextTheme('dark')).toBe('light')
  })

  it('applies the dark class and color-scheme to the root element', () => {
    applyTheme('dark')
    expect(document.documentElement).toHaveClass('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    applyTheme('light')
    expect(document.documentElement).not.toHaveClass('dark')
    expect(document.documentElement.style.colorScheme).toBe('light')
  })
})
```

`frontend/src/features/theme/ThemeProvider.test.tsx`:
```tsx
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { THEME_STORAGE_KEY } from './theme'
import { ThemeProvider, useTheme } from './ThemeProvider'

const wrapper = ({ children }: { children: ReactNode }) => <ThemeProvider>{children}</ThemeProvider>

afterEach(() => {
  document.documentElement.className = ''
})

describe('ThemeProvider', () => {
  it('starts in light mode without the dark class', () => {
    const { result } = renderHook(() => useTheme(), { wrapper })
    expect(result.current.theme).toBe('light')
    expect(document.documentElement).not.toHaveClass('dark')
  })

  it('toggleTheme switches to dark, applies the class and persists', () => {
    const { result } = renderHook(() => useTheme(), { wrapper })
    act(() => result.current.toggleTheme())
    expect(result.current.theme).toBe('dark')
    expect(document.documentElement).toHaveClass('dark')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('"dark"')
  })

  it('setTheme sets an explicit theme', () => {
    const { result } = renderHook(() => useTheme(), { wrapper })
    act(() => result.current.setTheme('dark'))
    act(() => result.current.setTheme('light'))
    expect(result.current.theme).toBe('light')
    expect(document.documentElement).not.toHaveClass('dark')
  })

  it('restores a persisted theme on mount', () => {
    localStorage.setItem(THEME_STORAGE_KEY, '"dark"')
    const { result } = renderHook(() => useTheme(), { wrapper })
    expect(result.current.theme).toBe('dark')
    expect(document.documentElement).toHaveClass('dark')
  })

  it('throws when used outside the provider', () => {
    expect(() => renderHook(() => useTheme())).toThrow(/ThemeProvider/)
  })
})
```

`frontend/src/features/theme/ThemeToggle.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { ThemeProvider } from './ThemeProvider'
import { ThemeToggle } from './ThemeToggle'

afterEach(() => {
  document.documentElement.className = ''
})

describe('ThemeToggle', () => {
  it('toggles the theme and updates its accessible name', async () => {
    const user = userEvent.setup()
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'Switch to dark theme' }))
    expect(document.documentElement).toHaveClass('dark')
    await user.click(screen.getByRole('button', { name: 'Switch to light theme' }))
    expect(document.documentElement).not.toHaveClass('dark')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --dir frontend exec vitest run src/features/theme`
Expected: FAIL with `Failed to resolve import "./theme"` / `"./ThemeProvider"` / `"./ThemeToggle"`.

- [ ] **Step 3: Write the minimal implementation**

`frontend/src/features/theme/theme.ts`:
```ts
import { z } from 'zod'
import { loadJson } from '../../lib/storage'

export type Theme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'ai-docs:theme'
export const themeSchema = z.enum(['light', 'dark'])
export const DEFAULT_THEME: Theme = 'light'

export function loadTheme(): Theme {
  return loadJson(THEME_STORAGE_KEY, themeSchema, DEFAULT_THEME)
}

export function nextTheme(theme: Theme): Theme {
  return theme === 'dark' ? 'light' : 'dark'
}

export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  root.classList.toggle('dark', theme === 'dark')
  root.style.colorScheme = theme
}
```

`frontend/src/features/theme/ThemeProvider.tsx`:
```tsx
import { createContext, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { saveJson } from '../../lib/storage'
import { applyTheme, loadTheme, nextTheme, THEME_STORAGE_KEY, type Theme } from './theme'

type ThemeContextValue = {
  theme: Theme
  setTheme(theme: Theme): void
  toggleTheme(): void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(loadTheme)

  useLayoutEffect(() => {
    applyTheme(theme)
    saveJson(THEME_STORAGE_KEY, theme)
  }, [theme])

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, toggleTheme: () => setTheme(nextTheme) }),
    [theme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components -- hook is colocated with its provider
export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useTheme must be used inside <ThemeProvider>')
  return value
}
```

`frontend/src/features/theme/ThemeToggle.tsx`:
```tsx
import { useTheme } from './ThemeProvider'

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  const label = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      className="rounded-md px-2 py-1 text-lg hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-sky-500 dark:hover:bg-slate-800"
    >
      <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
    </button>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --dir frontend exec vitest run src/features/theme`
Expected: PASS (3 files, 11 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/theme
git commit -m "feat(frontend): add light/dark theme provider and toggle"
```

---

### Task 3: Document schema, welcome content and export filename

**Files:**
- Create: `frontend/src/features/document/schema.ts`, `frontend/src/features/document/initialContent.ts`, `frontend/src/features/document/exportFilename.ts`
- Test: `frontend/src/features/document/exportFilename.test.ts`

**Interfaces:**
- Consumes: `zod`.
- Produces:
  - `schema.ts`: `type TextRange = { from: number; to: number }`, `DOCUMENT_STORAGE_KEY = 'ai-docs:document'`, `storedDocumentSchema` (`{ content: string; updatedAt: number }`), `type StoredDocument`
  - `initialContent.ts`: `initialContent: string` (starts with `# Welcome to AI Docs`)
  - `exportFilename.ts`: `exportFilename(content: string): string`

- [ ] **Step 1: Write the failing test**

`frontend/src/features/document/exportFilename.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { exportFilename } from './exportFilename'

describe('exportFilename', () => {
  it.each([
    ['# Hello World\n\nBody', 'hello-world.md'],
    ['Intro line\n\n# My Doc\n', 'my-doc.md'],
    ['# Title ##', 'title.md'],
    ['# Café & Crème!', 'cafe-creme.md'],
    ['#   Spaced   Out  ', 'spaced-out.md'],
  ])('slugs the first H1: %j → %s', (content, expected) => {
    expect(exportFilename(content)).toBe(expected)
  })

  it.each([
    [''],
    ['No heading at all'],
    ['## Only a subheading'],
    ['#NoSpace'],
    ['# !!!'],
  ])('falls back to document.md for %j', (content) => {
    expect(exportFilename(content)).toBe('document.md')
  })

  it('caps the slug at 80 characters without a trailing dash', () => {
    const name = exportFilename(`# ${'word '.repeat(40)}`)
    const slug = name.replace(/\.md$/, '')
    expect(slug.length).toBeLessThanOrEqual(80)
    expect(slug.endsWith('-')).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --dir frontend exec vitest run src/features/document/exportFilename.test.ts`
Expected: FAIL with `Failed to resolve import "./exportFilename"`.

- [ ] **Step 3: Write the minimal implementation**

`frontend/src/features/document/schema.ts`:
```ts
import { z } from 'zod'

/** UTF-16 offsets into the document, from <= to. */
export type TextRange = { from: number; to: number }

export const DOCUMENT_STORAGE_KEY = 'ai-docs:document'

export const storedDocumentSchema = z.object({
  content: z.string(),
  updatedAt: z.number(),
})

export type StoredDocument = z.infer<typeof storedDocumentSchema>
```

`frontend/src/features/document/initialContent.ts`:
```ts
export const initialContent = `# Welcome to AI Docs

Write in **Markdown** here, and ask your AI co-author for help when you need it.

## What you can do

- Write and edit Markdown in the **Editor** tab
- See the rendered result in the **Preview** tab
- Review AI suggestions as side-by-side diffs in the **AI Review** tab

## Tips

1. Select a paragraph to limit the AI to that text.
2. Accept or reject each change, one hunk at a time.
3. Your work is saved in this browser automatically.

| Shortcut | Action |
| --- | --- |
| Ctrl/⌘ + Z | Undo |
| Ctrl/⌘ + Shift + Z | Redo |

\`\`\`ts
const coAuthor = 'always in your control'
\`\`\`
`
```

`frontend/src/features/document/exportFilename.ts`:
```ts
const MAX_SLUG_LENGTH = 80
const H1_PATTERN = /^#[ \t]+(.+?)[ \t#]*$/m

function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, '')
}

export function exportFilename(content: string): string {
  const match = H1_PATTERN.exec(content)
  const slug = match ? slugify(match[1]) : ''
  return `${slug || 'document'}.md`
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --dir frontend exec vitest run src/features/document/exportFilename.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/document
git commit -m "feat(frontend): add document schema, welcome content and export filename"
```

---

### Task 4: DocumentProvider with selection, replaceRange and autosave

**Files:**
- Create: `frontend/src/features/document/DocumentProvider.tsx`
- Test: `frontend/src/features/document/DocumentProvider.test.tsx`

**Interfaces:**
- Consumes: `loadJson`, `saveJson` (Task 1); `TextRange`, `DOCUMENT_STORAGE_KEY`, `storedDocumentSchema`, `initialContent` (Task 3).
- Produces:
  - `DocumentProvider({ children })`: loads `ai-docs:document` on mount (falls back to `initialContent`), autosaves `{ content, updatedAt: Date.now() }` 300 ms after the last change, and saves right away on `pagehide`.
  - `useDocument(): DocumentContextValue` (throws outside the provider), where
    ```ts
    type DocumentContextValue = {
      content: string
      selection: TextRange                 // from === to when collapsed
      setContent(content: string): void    // selection is clamped to the new length
      setSelection(range: TextRange): void // clamped to [0, content.length], from <= to
      replaceRange(range: TextRange, text: string): void // selection collapses to range.from + text.length
    }
    ```
  - The `DocumentContextValue` type is exported from the same file.

- [ ] **Step 1: Write the failing test**

`frontend/src/features/document/DocumentProvider.test.tsx`:
```tsx
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DocumentProvider, useDocument } from './DocumentProvider'
import { initialContent } from './initialContent'
import { DOCUMENT_STORAGE_KEY } from './schema'

const wrapper = ({ children }: { children: ReactNode }) => (
  <DocumentProvider>{children}</DocumentProvider>
)

function stored(): { content: string; updatedAt: number } | null {
  const raw = localStorage.getItem(DOCUMENT_STORAGE_KEY)
  return raw === null ? null : JSON.parse(raw)
}

describe('DocumentProvider', () => {
  describe('loading', () => {
    it('uses the welcome content when nothing is stored', () => {
      const { result } = renderHook(() => useDocument(), { wrapper })
      expect(result.current.content).toBe(initialContent)
      expect(result.current.selection).toEqual({ from: 0, to: 0 })
    })

    it('restores stored content', () => {
      localStorage.setItem(DOCUMENT_STORAGE_KEY, JSON.stringify({ content: 'Saved', updatedAt: 1 }))
      const { result } = renderHook(() => useDocument(), { wrapper })
      expect(result.current.content).toBe('Saved')
    })

    it('ignores invalid stored data', () => {
      localStorage.setItem(DOCUMENT_STORAGE_KEY, JSON.stringify({ content: 42 }))
      const { result } = renderHook(() => useDocument(), { wrapper })
      expect(result.current.content).toBe(initialContent)
    })
  })

  describe('editing', () => {
    beforeEach(() => {
      localStorage.setItem(DOCUMENT_STORAGE_KEY, JSON.stringify({ content: 'Hello world', updatedAt: 1 }))
    })

    it('setContent replaces the content and clamps the selection', () => {
      const { result } = renderHook(() => useDocument(), { wrapper })
      act(() => result.current.setSelection({ from: 6, to: 11 }))
      act(() => result.current.setContent('Hi'))
      expect(result.current.content).toBe('Hi')
      expect(result.current.selection).toEqual({ from: 2, to: 2 })
    })

    it('setSelection clamps and orders the range', () => {
      const { result } = renderHook(() => useDocument(), { wrapper })
      act(() => result.current.setSelection({ from: 50, to: 3 }))
      expect(result.current.selection).toEqual({ from: 3, to: 11 })
    })

    it('replaceRange splices text and collapses the selection after it', () => {
      const { result } = renderHook(() => useDocument(), { wrapper })
      act(() => result.current.replaceRange({ from: 6, to: 11 }, 'there'))
      expect(result.current.content).toBe('Hello there')
      expect(result.current.selection).toEqual({ from: 11, to: 11 })
    })

    it('replaceRange applies to the latest content when called twice in one batch', () => {
      const { result } = renderHook(() => useDocument(), { wrapper })
      act(() => {
        result.current.replaceRange({ from: 0, to: 5 }, 'Howdy')
        result.current.replaceRange({ from: 11, to: 11 }, '!')
      })
      expect(result.current.content).toBe('Howdy world!')
    })
  })

  describe('autosave', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('saves 300 ms after the last change', () => {
      const { result } = renderHook(() => useDocument(), { wrapper })
      act(() => result.current.setContent('Draft'))
      act(() => vi.advanceTimersByTime(299))
      expect(stored()).toBeNull()
      act(() => vi.advanceTimersByTime(1))
      expect(stored()).toEqual({ content: 'Draft', updatedAt: Date.parse('2026-01-01T00:00:00.300Z') })
    })

    it('restarts the debounce on every change', () => {
      const { result } = renderHook(() => useDocument(), { wrapper })
      act(() => result.current.setContent('a'))
      act(() => vi.advanceTimersByTime(200))
      act(() => result.current.setContent('ab'))
      act(() => vi.advanceTimersByTime(200))
      expect(stored()).toBeNull()
      act(() => vi.advanceTimersByTime(100))
      expect(stored()?.content).toBe('ab')
    })

    it('flushes immediately on pagehide', () => {
      const { result } = renderHook(() => useDocument(), { wrapper })
      act(() => result.current.setContent('Leaving'))
      act(() => {
        window.dispatchEvent(new Event('pagehide'))
      })
      expect(stored()?.content).toBe('Leaving')
    })
  })

  it('throws when used outside the provider', () => {
    expect(() => renderHook(() => useDocument())).toThrow(/DocumentProvider/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --dir frontend exec vitest run src/features/document/DocumentProvider.test.tsx`
Expected: FAIL with `Failed to resolve import "./DocumentProvider"`.

- [ ] **Step 3: Write the minimal implementation**

`frontend/src/features/document/DocumentProvider.tsx`:
```tsx
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react'
import { loadJson, saveJson } from '../../lib/storage'
import { initialContent } from './initialContent'
import { DOCUMENT_STORAGE_KEY, storedDocumentSchema, type TextRange } from './schema'

export type DocumentContextValue = {
  content: string
  selection: TextRange
  setContent(content: string): void
  setSelection(range: TextRange): void
  replaceRange(range: TextRange, text: string): void
}

type State = { content: string; selection: TextRange }

type Action =
  | { type: 'setContent'; content: string }
  | { type: 'setSelection'; range: TextRange }
  | { type: 'replaceRange'; range: TextRange; text: string }

const AUTOSAVE_DELAY_MS = 300

function clampRange(range: TextRange, length: number): TextRange {
  const a = Math.min(Math.max(range.from, 0), length)
  const b = Math.min(Math.max(range.to, 0), length)
  return { from: Math.min(a, b), to: Math.max(a, b) }
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'setContent':
      return {
        content: action.content,
        selection: clampRange(state.selection, action.content.length),
      }
    case 'setSelection':
      return { ...state, selection: clampRange(action.range, state.content.length) }
    case 'replaceRange': {
      const { from, to } = clampRange(action.range, state.content.length)
      const content = state.content.slice(0, from) + action.text + state.content.slice(to)
      const cursor = from + action.text.length
      return { content, selection: { from: cursor, to: cursor } }
    }
  }
}

function loadInitialState(): State {
  const stored = loadJson(DOCUMENT_STORAGE_KEY, storedDocumentSchema.nullable(), null)
  return { content: stored?.content ?? initialContent, selection: { from: 0, to: 0 } }
}

function persist(content: string): void {
  saveJson(DOCUMENT_STORAGE_KEY, { content, updatedAt: Date.now() })
}

const DocumentContext = createContext<DocumentContextValue | null>(null)

export function DocumentProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadInitialState)
  const latestContent = useRef(state.content)
  const hasUnsavedChange = useRef(false)

  useEffect(() => {
    latestContent.current = state.content
    hasUnsavedChange.current = true
    const timer = setTimeout(() => {
      persist(state.content)
      hasUnsavedChange.current = false
    }, AUTOSAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [state.content])

  useEffect(() => {
    const flush = () => {
      if (!hasUnsavedChange.current) return
      persist(latestContent.current)
      hasUnsavedChange.current = false
    }
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [])

  const value = useMemo<DocumentContextValue>(
    () => ({
      content: state.content,
      selection: state.selection,
      setContent: (content) => dispatch({ type: 'setContent', content }),
      setSelection: (range) => dispatch({ type: 'setSelection', range }),
      replaceRange: (range, text) => dispatch({ type: 'replaceRange', range, text }),
    }),
    [state],
  )

  return <DocumentContext.Provider value={value}>{children}</DocumentContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components -- hook is colocated with its provider
export function useDocument(): DocumentContextValue {
  const value = useContext(DocumentContext)
  if (!value) throw new Error('useDocument must be used inside <DocumentProvider>')
  return value
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --dir frontend exec vitest run src/features/document/DocumentProvider.test.tsx`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/document/DocumentProvider.tsx frontend/src/features/document/DocumentProvider.test.tsx
git commit -m "feat(frontend): add DocumentProvider with selection and debounced autosave"
```

---

### Task 5: ExportButton

**Files:**
- Create: `frontend/src/features/document/ExportButton.tsx`
- Test: `frontend/src/features/document/ExportButton.test.tsx`

**Interfaces:**
- Consumes: `useDocument` (Task 4), `exportFilename` (Task 3), `downloadTextFile` (Task 1).
- Produces: `ExportButton()`, a button with the accessible name "Export Markdown" that downloads the current content.

- [ ] **Step 1: Write the failing test**

`frontend/src/features/document/ExportButton.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { downloadTextFile } from '../../lib/download'
import { DocumentProvider } from './DocumentProvider'
import { ExportButton } from './ExportButton'
import { DOCUMENT_STORAGE_KEY } from './schema'

vi.mock('../../lib/download', () => ({ downloadTextFile: vi.fn() }))

describe('ExportButton', () => {
  it('downloads the current document with a filename from its title', async () => {
    const content = '# My Notes\n\nhello'
    localStorage.setItem(DOCUMENT_STORAGE_KEY, JSON.stringify({ content, updatedAt: 1 }))
    const user = userEvent.setup()
    render(
      <DocumentProvider>
        <ExportButton />
      </DocumentProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Export Markdown' }))

    expect(downloadTextFile).toHaveBeenCalledWith('my-notes.md', content)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --dir frontend exec vitest run src/features/document/ExportButton.test.tsx`
Expected: FAIL with `Failed to resolve import "./ExportButton"`.

- [ ] **Step 3: Write the minimal implementation**

`frontend/src/features/document/ExportButton.tsx`:
```tsx
import { downloadTextFile } from '../../lib/download'
import { useDocument } from './DocumentProvider'
import { exportFilename } from './exportFilename'

export function ExportButton() {
  const { content } = useDocument()
  return (
    <button
      type="button"
      onClick={() => downloadTextFile(exportFilename(content), content)}
      className="rounded-md border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-sky-500 dark:border-slate-700 dark:hover:bg-slate-800"
    >
      Export Markdown
    </button>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --dir frontend exec vitest run src/features/document/ExportButton.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/document/ExportButton.tsx frontend/src/features/document/ExportButton.test.tsx
git commit -m "feat(frontend): add Markdown export button"
```

---

### Task 6: MarkdownEditor (CodeMirror 6 wrapper)

**Files:**
- Create: `frontend/src/features/editor/MarkdownEditor.tsx`
- Modify: `frontend/src/test/setup.ts` (append the jsdom polyfills CodeMirror needs)
- Modify: `frontend/package.json` (dependencies, via pnpm)
- Test: `frontend/src/features/editor/MarkdownEditor.test.tsx`

**Interfaces:**
- Consumes: `TextRange` from `features/document/schema.ts` (Task 3).
- Produces:
  ```ts
  export type MarkdownEditorProps = {
    value: string
    onChange(value: string): void
    onSelectionChange?(range: TextRange): void
    dark: boolean
    extensions?: Extension[]   // from @codemirror/state; callers must memoize the array
  }
  export function MarkdownEditor(props: MarkdownEditorProps): JSX.Element
  ```
  - The editor content element has `aria-label="Markdown editor"`.
  - User edits call `onChange(fullDoc)`. When `value` changes from outside, the change is applied as a minimal transaction (common prefix and suffix kept, so the cursor maps sensibly) and does **not** call `onChange`.
  - `onSelectionChange` fires with the main selection (`from <= to`) whenever the selection or the document changes.
  - `dark` swaps `oneDark` in and out through a Compartment. `extensions` is reconfigured through a second Compartment (phase 6 adds slash commands this way).

- [ ] **Step 1: Install the CodeMirror packages**

Run:
```bash
pnpm --dir frontend add codemirror @codemirror/state @codemirror/view @codemirror/lang-markdown @codemirror/language-data @codemirror/theme-one-dark
```
Expected: `dependencies` in `frontend/package.json` now lists all six packages.

- [ ] **Step 2: Add the jsdom polyfills CodeMirror needs**

jsdom doesn't implement layout APIs that CodeMirror calls when it measures. Append to `frontend/src/test/setup.ts`:
```ts
// CodeMirror measures text with Range rects, which jsdom does not implement.
const emptyRect = {
  x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0,
  toJSON() { return this },
} as DOMRect
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => emptyRect
}
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () =>
    ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList
}
```

- [ ] **Step 3: Write the failing test**

`frontend/src/features/editor/MarkdownEditor.test.tsx`:
```tsx
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MarkdownEditor, type MarkdownEditorProps } from './MarkdownEditor'

function setup(overrides: Partial<MarkdownEditorProps> = {}) {
  const props: MarkdownEditorProps = {
    value: 'Hello',
    onChange: vi.fn(),
    onSelectionChange: vi.fn(),
    dark: false,
    ...overrides,
  }
  const utils = render(<MarkdownEditor {...props} />)
  const getView = () => {
    const dom = utils.container.querySelector<HTMLElement>('.cm-editor')
    if (!dom) throw new Error('editor not rendered')
    const view = EditorView.findFromDOM(dom)
    if (!view) throw new Error('view not found')
    return view
  }
  return { ...utils, props, getView }
}

describe('MarkdownEditor', () => {
  it('renders the value in an accessibly labelled editor', () => {
    setup()
    expect(screen.getByLabelText('Markdown editor')).toHaveTextContent('Hello')
  })

  it('calls onChange with the full document after a user edit', () => {
    const { props, getView } = setup()
    act(() => {
      getView().dispatch({ changes: { from: 5, insert: ' world' } })
    })
    expect(props.onChange).toHaveBeenCalledWith('Hello world')
  })

  it('reports selection changes as an ordered range', () => {
    const { props, getView } = setup()
    act(() => {
      getView().dispatch({ selection: { anchor: 4, head: 1 } })
    })
    expect(props.onSelectionChange).toHaveBeenLastCalledWith({ from: 1, to: 4 })
  })

  it('applies external value changes without calling onChange', () => {
    const { props, rerender, getView } = setup()
    rerender(<MarkdownEditor {...props} value="Hello there" />)
    expect(getView().state.doc.toString()).toBe('Hello there')
    expect(props.onChange).not.toHaveBeenCalled()
  })

  it('keeps the cursor in place when external text is appended after it', () => {
    const { props, rerender, getView } = setup()
    act(() => {
      getView().dispatch({ selection: { anchor: 2 } })
    })
    rerender(<MarkdownEditor {...props} value="Hello!" />)
    expect(getView().state.selection.main.head).toBe(2)
  })

  it('switches the dark theme on and off', () => {
    const { props, rerender, getView } = setup()
    expect(getView().state.facet(EditorView.darkTheme)).toBe(false)
    rerender(<MarkdownEditor {...props} dark />)
    expect(getView().state.facet(EditorView.darkTheme)).toBe(true)
    rerender(<MarkdownEditor {...props} dark={false} />)
    expect(getView().state.facet(EditorView.darkTheme)).toBe(false)
  })

  it('reconfigures extra extensions when the prop changes', () => {
    const { props, rerender, getView } = setup()
    expect(getView().state.readOnly).toBe(false)
    rerender(<MarkdownEditor {...props} extensions={[EditorState.readOnly.of(true)]} />)
    expect(getView().state.readOnly).toBe(true)
  })

  it('destroys the view on unmount', () => {
    const { unmount, container } = setup()
    unmount()
    expect(container.querySelector('.cm-editor')).toBeNull()
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --dir frontend exec vitest run src/features/editor`
Expected: FAIL with `Failed to resolve import "./MarkdownEditor"`.

- [ ] **Step 5: Write the minimal implementation**

`frontend/src/features/editor/MarkdownEditor.tsx`:
```tsx
import { markdown } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { Annotation, Compartment, EditorState, type Extension } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorView } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { useEffect, useRef, useState } from 'react'
import type { TextRange } from '../document/schema'

export type MarkdownEditorProps = {
  value: string
  onChange(value: string): void
  onSelectionChange?(range: TextRange): void
  dark: boolean
  extensions?: Extension[]
}

const NO_EXTENSIONS: Extension[] = []

/** Marks transactions that come from the `value` prop so they are not echoed to onChange. */
const External = Annotation.define<boolean>()

const baseTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '15px' },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', lineHeight: '1.6' },
  '.cm-content': { padding: '16px 0' },
  '&.cm-focused': { outline: 'none' },
})

/** Smallest single change that turns `current` into `next` (shared prefix/suffix kept). */
function minimalChange(current: string, next: string) {
  const max = Math.min(current.length, next.length)
  let start = 0
  while (start < max && current[start] === next[start]) start++
  let endCurrent = current.length
  let endNext = next.length
  while (endCurrent > start && endNext > start && current[endCurrent - 1] === next[endNext - 1]) {
    endCurrent--
    endNext--
  }
  return { from: start, to: endCurrent, insert: next.slice(start, endNext) }
}

export function MarkdownEditor({
  value,
  onChange,
  onSelectionChange,
  dark,
  extensions = NO_EXTENSIONS,
}: MarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const onSelectionChangeRef = useRef(onSelectionChange)
  const [compartments] = useState(() => ({ theme: new Compartment(), extra: new Compartment() }))

  useEffect(() => {
    onChangeRef.current = onChange
    onSelectionChangeRef.current = onSelectionChange
  })

  // Create the view once. Later prop changes are synced by the effects below.
  useEffect(() => {
    if (!hostRef.current) return
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          markdown({ codeLanguages: languages }),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': 'Markdown editor' }),
          baseTheme,
          compartments.theme.of(dark ? oneDark : []),
          compartments.extra.of(extensions),
          EditorView.updateListener.of((update) => {
            const external = update.transactions.some((tr) => tr.annotation(External))
            if (update.docChanged && !external) {
              onChangeRef.current(update.state.doc.toString())
            }
            if (update.selectionSet || update.docChanged) {
              const { from, to } = update.state.selection.main
              onSelectionChangeRef.current?.({ from, to })
            }
          }),
        ],
      }),
    })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the view is created once; props are synced below
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === value) return
    view.dispatch({ changes: minimalChange(current, value), annotations: External.of(true) })
  }, [value])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: compartments.theme.reconfigure(dark ? oneDark : []) })
  }, [dark, compartments])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: compartments.extra.reconfigure(extensions) })
  }, [extensions, compartments])

  return <div ref={hostRef} className="h-full min-h-0 overflow-hidden" />
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --dir frontend exec vitest run src/features/editor`
Expected: PASS (8 tests).

- [ ] **Step 7: Commit**

```bash
git add frontend/package.json frontend/pnpm-lock.yaml frontend/src/test/setup.ts frontend/src/features/editor
git commit -m "feat(frontend): add CodeMirror 6 markdown editor wrapper"
```

---

### Task 7: MarkdownPreview

**Files:**
- Create: `frontend/src/features/preview/MarkdownPreview.tsx`
- Modify: `frontend/package.json` (dependencies, via pnpm)
- Test: `frontend/src/features/preview/MarkdownPreview.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `MarkdownPreview({ content }: { content: string })`. It renders GitHub-flavored Markdown inside `<article aria-label="Markdown preview" class="prose …">`. Empty or whitespace-only content shows "Nothing to preview yet." Links open in a new tab with `rel="noreferrer"`.

- [ ] **Step 1: Install the Markdown packages**

Run: `pnpm --dir frontend add react-markdown remark-gfm`
Expected: both packages appear in `dependencies`.

- [ ] **Step 2: Write the failing test**

`frontend/src/features/preview/MarkdownPreview.test.tsx`:
```tsx
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MarkdownPreview } from './MarkdownPreview'

describe('MarkdownPreview', () => {
  it('renders headings, emphasis and lists', () => {
    render(<MarkdownPreview content={'# Title\n\nSome **bold** text\n\n- one\n- two'} />)
    const article = screen.getByRole('article', { name: 'Markdown preview' })
    expect(within(article).getByRole('heading', { level: 1, name: 'Title' })).toBeInTheDocument()
    expect(within(article).getByText('bold').tagName).toBe('STRONG')
    expect(within(article).getAllByRole('listitem')).toHaveLength(2)
  })

  it('supports GitHub-flavored tables and task lists', () => {
    render(<MarkdownPreview content={'| A | B |\n| - | - |\n| 1 | 2 |\n\n- [x] done'} />)
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('checkbox')).toBeChecked()
  })

  it('opens links in a new tab', () => {
    render(<MarkdownPreview content="[site](https://example.com)" />)
    const link = screen.getByRole('link', { name: 'site' })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer')
  })

  it('shows an empty state for blank content', () => {
    render(<MarkdownPreview content={'  \n'} />)
    expect(screen.getByText('Nothing to preview yet.')).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --dir frontend exec vitest run src/features/preview`
Expected: FAIL with `Failed to resolve import "./MarkdownPreview"`.

- [ ] **Step 4: Write the minimal implementation**

`frontend/src/features/preview/MarkdownPreview.tsx`:
```tsx
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

const remarkPlugins = [remarkGfm]

const components: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
}

export function MarkdownPreview({ content }: { content: string }) {
  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      <article
        aria-label="Markdown preview"
        className="prose prose-slate mx-auto max-w-3xl dark:prose-invert"
      >
        {content.trim() === '' ? (
          <p className="text-slate-500">Nothing to preview yet.</p>
        ) : (
          <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
            {content}
          </ReactMarkdown>
        )}
      </article>
    </div>
  )
}
```

If ESLint flags `_node` as unused, rename it to `node` and add `void node` at the top of the arrow body. Do not disable the rule for the whole file.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --dir frontend exec vitest run src/features/preview`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/pnpm-lock.yaml frontend/src/features/preview
git commit -m "feat(frontend): add markdown preview with GFM support"
```

---

### Task 8: Tabs and AppHeader

**Files:**
- Create: `frontend/src/features/layout/Tabs.tsx`, `frontend/src/features/layout/AppHeader.tsx`
- Test: `frontend/src/features/layout/Tabs.test.tsx`, `frontend/src/features/layout/AppHeader.test.tsx`

**Interfaces:**
- Consumes: `ThemeToggle` (Task 2), `ExportButton` (Task 5).
- Produces:
  - `type TabId = 'editor' | 'preview' | 'review'`
  - `Tabs(props: { active: TabId; onChange(id: TabId): void; panels: Record<TabId, ReactNode>; badges?: Partial<Record<TabId, ReactNode>> })`. It renders a `tablist` named "Document views" with tabs `Editor`, `Preview`, `AI Review` in that order. Arrow Left/Right wraps around, and Home/End jump to the ends; each of these calls `onChange` and moves focus. **All panels stay mounted**, and inactive ones get the `hidden` attribute.
  - `AppHeader({ children }: { children?: ReactNode })`. It renders `<header>` with the heading "AI Docs", then `children` (phase 4 passes `ModelSelect`, phase 6 a palette button), then `ThemeToggle` and `ExportButton`.

- [ ] **Step 1: Write the failing tests**

`frontend/src/features/layout/Tabs.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Tabs, type TabId } from './Tabs'

const panels = {
  editor: <p>Editor panel</p>,
  preview: <p>Preview panel</p>,
  review: <p>Review panel</p>,
}

function Harness({ onChange }: { onChange?: (id: TabId) => void }) {
  const [active, setActive] = useState<TabId>('editor')
  return (
    <Tabs
      active={active}
      onChange={(id) => {
        setActive(id)
        onChange?.(id)
      }}
      panels={panels}
      badges={{ review: <span>3</span> }}
    />
  )
}

describe('Tabs', () => {
  it('renders the three tabs in order with the active one selected', () => {
    render(<Harness />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Editor', 'Preview', 'AI Review3'])
    expect(screen.getByRole('tab', { name: 'Editor' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tablist', { name: 'Document views' })).toBeInTheDocument()
  })

  it('keeps every panel mounted and hides the inactive ones', () => {
    render(<Harness />)
    expect(screen.getByText('Editor panel')).toBeVisible()
    expect(screen.getByText('Preview panel')).not.toBeVisible()
    expect(screen.getByText('Review panel')).not.toBeVisible()
  })

  it('activates a tab on click', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await user.click(screen.getByRole('tab', { name: 'Preview' }))
    expect(onChange).toHaveBeenCalledWith('preview')
    expect(screen.getByText('Preview panel')).toBeVisible()
    expect(screen.getByRole('tabpanel', { name: 'Preview' })).toBeVisible()
  })

  it('supports arrow, Home and End keys with focus following selection', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('tab', { name: 'Editor' }))
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: /AI Review/ })).toHaveFocus()
    expect(screen.getByRole('tab', { name: /AI Review/ })).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Editor' })).toHaveFocus()
    await user.keyboard('{End}')
    expect(screen.getByRole('tab', { name: /AI Review/ })).toHaveFocus()
    await user.keyboard('{Home}')
    expect(screen.getByRole('tab', { name: 'Editor' })).toHaveFocus()
  })

  it('makes only the active tab tabbable', () => {
    render(<Harness />)
    expect(screen.getByRole('tab', { name: 'Editor' })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('tab', { name: 'Preview' })).toHaveAttribute('tabindex', '-1')
  })
})
```

`frontend/src/features/layout/AppHeader.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DocumentProvider } from '../document/DocumentProvider'
import { ThemeProvider } from '../theme/ThemeProvider'
import { AppHeader } from './AppHeader'

describe('AppHeader', () => {
  it('shows the app name, extra controls, theme toggle and export button', () => {
    render(
      <ThemeProvider>
        <DocumentProvider>
          <AppHeader>
            <button type="button">Extra</button>
          </AppHeader>
        </DocumentProvider>
      </ThemeProvider>,
    )
    const header = screen.getByRole('banner')
    expect(header).toHaveTextContent('AI Docs')
    expect(screen.getByRole('button', { name: 'Extra' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export Markdown' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --dir frontend exec vitest run src/features/layout`
Expected: FAIL with `Failed to resolve import "./Tabs"` / `"./AppHeader"`.

- [ ] **Step 3: Write the minimal implementation**

`frontend/src/features/layout/Tabs.tsx`:
```tsx
import { useRef, type KeyboardEvent, type ReactNode } from 'react'

export type TabId = 'editor' | 'preview' | 'review'

type TabsProps = {
  active: TabId
  onChange(id: TabId): void
  panels: Record<TabId, ReactNode>
  badges?: Partial<Record<TabId, ReactNode>>
}

const TABS: { id: TabId; label: string }[] = [
  { id: 'editor', label: 'Editor' },
  { id: 'preview', label: 'Preview' },
  { id: 'review', label: 'AI Review' },
]

export function Tabs({ active, onChange, panels, badges }: TabsProps) {
  const tabRefs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({})

  const select = (id: TabId) => {
    onChange(id)
    tabRefs.current[id]?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = TABS.length - 1
    const target =
      event.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
      : event.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
      : event.key === 'Home' ? 0
      : event.key === 'End' ? last
      : null
    if (target === null) return
    event.preventDefault()
    select(TABS[target].id)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        role="tablist"
        aria-label="Document views"
        className="flex gap-1 border-b border-slate-200 px-4 dark:border-slate-800"
      >
        {TABS.map((tab, index) => {
          const selected = tab.id === active
          return (
            <button
              key={tab.id}
              ref={(el) => {
                tabRefs.current[tab.id] = el
              }}
              type="button"
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(tab.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-sky-500 ${
                selected
                  ? 'border-sky-600 text-sky-700 dark:border-sky-400 dark:text-sky-300'
                  : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              {tab.label}
              {badges?.[tab.id]}
            </button>
          )
        })}
      </div>
      {TABS.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`panel-${tab.id}`}
          aria-labelledby={`tab-${tab.id}`}
          hidden={tab.id !== active}
          className="min-h-0 flex-1"
        >
          {panels[tab.id]}
        </div>
      ))}
    </div>
  )
}
```

Note: `hidden` must win over `flex-1`. Tailwind v4 preflight sets `[hidden]:where(:not([hidden='until-found'])) { display: none !important }`, so hidden panels stay hidden.

`frontend/src/features/layout/AppHeader.tsx`:
```tsx
import type { ReactNode } from 'react'
import { ExportButton } from '../document/ExportButton'
import { ThemeToggle } from '../theme/ThemeToggle'

export function AppHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-2 dark:border-slate-800">
      <h1 className="text-base font-semibold tracking-tight">AI Docs</h1>
      <div className="ml-auto flex items-center gap-2">
        {children}
        <ThemeToggle />
        <ExportButton />
      </div>
    </header>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --dir frontend exec vitest run src/features/layout`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/layout
git commit -m "feat(frontend): add accessible tabs and app header"
```

---

### Task 9: Wire the App shell and verify end to end

**Files:**
- Modify: `frontend/src/App.tsx` (replace its content)
- Modify: `frontend/src/main.tsx` (replace its content)
- Test: `frontend/src/App.test.tsx` (replace any phase 1 smoke test)

**Interfaces:**
- Consumes: `ThemeProvider`, `useTheme` (Task 2); `DocumentProvider`, `useDocument` (Task 4); `MarkdownEditor` (Task 6); `MarkdownPreview` (Task 7); `Tabs`, `TabId`, `AppHeader` (Task 8).
- Produces: `App` (default export), which renders `ThemeProvider > DocumentProvider > AppShell`. `AppShell` (local, not exported) holds the active `TabId` state. Phases 4–6 extend `AppShell` and the provider nesting shown in the overview.

- [ ] **Step 1: Write the failing test**

`frontend/src/App.test.tsx`:
```tsx
import { EditorView } from '@codemirror/view'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import App from './App'
import { DOCUMENT_STORAGE_KEY } from './features/document/schema'

function getEditorView(container: HTMLElement): EditorView {
  const dom = container.querySelector<HTMLElement>('.cm-editor')
  const view = dom && EditorView.findFromDOM(dom)
  if (!view) throw new Error('editor view not found')
  return view
}

afterEach(() => {
  document.documentElement.className = ''
})

describe('App', () => {
  it('shows the header and three tabs with the editor active', () => {
    render(<App />)
    expect(screen.getByRole('banner')).toHaveTextContent('AI Docs')
    expect(screen.getByRole('tab', { name: 'Editor' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Preview' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'AI Review' })).toBeInTheDocument()
    expect(screen.getByLabelText('Markdown editor')).toHaveTextContent('Welcome to AI Docs')
  })

  it('renders edits from the editor in the preview and autosaves them', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    const view = getEditorView(container)
    act(() => {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '# Fresh title\n' } })
    })

    await user.click(screen.getByRole('tab', { name: 'Preview' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Fresh title' })).toBeVisible()

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(DOCUMENT_STORAGE_KEY) ?? 'null')?.content).toBe(
        '# Fresh title\n',
      )
    })
  })

  it('shows the AI Review placeholder', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('tab', { name: 'AI Review' }))
    expect(screen.getByText('AI suggestions will appear here.')).toBeVisible()
  })

  it('toggles dark mode for the page and the editor', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    await user.click(screen.getByRole('button', { name: 'Switch to dark theme' }))
    expect(document.documentElement).toHaveClass('dark')
    expect(getEditorView(container).state.facet(EditorView.darkTheme)).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --dir frontend exec vitest run src/App.test.tsx`
Expected: FAIL. The phase 1 `App` has no tabs, so `Unable to find role="banner"` (or `tab`) is reported.

- [ ] **Step 3: Write the implementation**

`frontend/src/App.tsx`:
```tsx
import { useState } from 'react'
import { DocumentProvider, useDocument } from './features/document/DocumentProvider'
import { MarkdownEditor } from './features/editor/MarkdownEditor'
import { AppHeader } from './features/layout/AppHeader'
import { Tabs, type TabId } from './features/layout/Tabs'
import { MarkdownPreview } from './features/preview/MarkdownPreview'
import { ThemeProvider, useTheme } from './features/theme/ThemeProvider'

function AppShell() {
  const { content, setContent, setSelection } = useDocument()
  const { theme } = useTheme()
  const [activeTab, setActiveTab] = useState<TabId>('editor')

  return (
    <div className="flex h-dvh flex-col bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <AppHeader />
      <main className="min-h-0 flex-1">
        <Tabs
          active={activeTab}
          onChange={setActiveTab}
          panels={{
            editor: (
              <MarkdownEditor
                value={content}
                onChange={setContent}
                onSelectionChange={setSelection}
                dark={theme === 'dark'}
              />
            ),
            preview: <MarkdownPreview content={content} />,
            review: (
              <p className="p-6 text-sm text-slate-500 dark:text-slate-400">
                AI suggestions will appear here.
              </p>
            ),
          }}
        />
      </main>
    </div>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <DocumentProvider>
        <AppShell />
      </DocumentProvider>
    </ThemeProvider>
  )
}
```

`frontend/src/main.tsx`:
```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --dir frontend exec vitest run src/App.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the full frontend checks**

Run:
```bash
pnpm --dir frontend lint && pnpm --dir frontend typecheck && pnpm --dir frontend test && pnpm --dir frontend build
```
Expected: lint reports 0 problems, typecheck exits 0, all test files pass, and the Vite build finishes with `✓ built in …`. Fix any lint findings in the files from this phase before continuing.

- [ ] **Step 6: Manual smoke test**

Run: `pnpm --dir frontend dev`, then open http://localhost:5173 and check:
1. The welcome document appears in the Editor tab with Markdown syntax highlighting, and long lines wrap.
2. Typing, then switching to Preview, shows the rendered result, including the table and the checkbox list.
3. Switching back to Editor keeps the cursor position and undo history (Ctrl/⌘+Z works).
4. The theme toggle switches the page and the editor to dark. After a reload, the dark theme and the edited text are both still there.
5. "Export Markdown" downloads `welcome-to-ai-docs.md` (or a slug of your H1) with the current content.
6. The keyboard alone works: Tab reaches the tab list, and the arrow keys switch tabs.

Stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/App.tsx frontend/src/App.test.tsx frontend/src/main.tsx
git commit -m "feat(frontend): wire editor, preview and AI review tabs into the app shell"
```

---

## Self-review checklist (done while writing)

- Spec coverage: storage/download/id (T1), theme light default + persisted + `dark` class (T2), schema/initial content/export filename (T3), DocumentProvider with selection, replaceRange, 300 ms autosave (T4), export (T5), CodeMirror wrapper with Compartments, external sync, selection reporting (T6), preview with GFM + typography (T7), tabs with badges + header slot (T8), app wiring with AI Review placeholder (T9).
- Names match the overview: `loadJson`, `saveJson`, `downloadTextFile`, `createId`, `Theme`, `useTheme`, `TextRange`, `DocumentContextValue`, `useDocument`, `exportFilename`, `MarkdownEditorProps`, `TabId`, `Tabs`.
- Additions beyond the overview, used by later phases: `AppHeader({ children })` slot; `aria-label="Markdown editor"` on the editor content; `MarkdownPreview({ content })`; `replaceRange` collapses the selection to `range.from + text.length`; panels stay mounted.
