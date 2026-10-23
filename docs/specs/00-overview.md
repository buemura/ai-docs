# AI Docs — Overview & Shared Contracts

> This is the source of truth for every phase plan in `docs/specs/`. Phase plans implement it; when a phase plan and this document disagree, this document wins and the phase plan must be fixed.

## Goal

A single-page web app (no auth) where a user writes Markdown and an AI co-author proposes edits to the whole document or a selection. Proposals stream in, are shown as a GitHub-style split diff, and the user accepts/rejects each hunk (or all), or refines the proposal with a follow-up instruction. Every accepted AI change is recorded in a version history.

The AI never edits the document directly — every change passes through the user's accept decision.

## Decisions (locked)

| Topic | Decision |
|---|---|
| Repo layout | Monorepo, no workspace tooling: `frontend/` (pnpm) and `backend/` (uv). Root `package.json` only hosts Husky. |
| Editor | CodeMirror 6, raw Markdown source, thin React wrapper (no `@uiw/react-codemirror`). |
| Preview | `react-markdown` + `remark-gfm`, styled with `@tailwindcss/typography`. |
| Diff | `diff` (jsdiff) — line diff to build hunks, word diff for intra-line highlight. |
| Review granularity | Per-hunk accept/reject, plus Accept all / Reject all. A decided hunk can be flipped. |
| Transport | `POST /api/suggestions` returns Server-Sent Events. Client reads with `fetch` + `ReadableStream` (not `EventSource`, which cannot POST). |
| AI output format | The model returns **only the replacement text for the target** (selection or whole document). The client computes the diff. No structured edit ops. |
| Refine | A new request carrying the prior turns (`instruction`, `proposal`). Allowed only while no hunk of the current suggestion is accepted. |
| One suggestion at a time | While a suggestion is streaming or under review, new triggers are disabled until it is resolved or discarded. |
| State management | React context + `useReducer`; reducers and helpers are pure and unit-tested. No external state library. |
| Persistence | `localStorage` only, all values Zod-validated on read. |
| Theme | Light by default; toggle to dark; persisted. Tailwind v4 class-based dark variant. |
| LLM providers | Strategy pattern: `anthropic` (default) and `openrouter`, selected by `LLM_PROVIDER`. |
| Models | Logical IDs exposed to UI: `claude-sonnet-5-5` (default), `claude-haiku-5-5`. Each provider maps logical IDs to its own model IDs. |

## Tech stack

Frontend: Node 24, pnpm, React 19, Vite, TypeScript (strict), Tailwind CSS v4 (`@tailwindcss/vite`), Zod v4, Vitest + Testing Library + jsdom, ESLint 9 (flat config) + `eslint-config-prettier`, Prettier, Husky + lint-staged.
Frontend libs: `codemirror`, `@codemirror/lang-markdown`, `@codemirror/language-data`, `@codemirror/theme-one-dark`, `@codemirror/autocomplete` (phase 6), `react-markdown`, `remark-gfm`, `@tailwindcss/typography`, `diff`, `cmdk` (phase 6).

Backend: Python 3.13, uv, FastAPI (`fastapi[standard]`), Pydantic v2 + `pydantic-settings`, `anthropic` SDK, `httpx` (OpenRouter), pytest + `pytest-asyncio`, ruff.

## Phases

| # | Spec | Deliverable |
|---|---|---|
| 1 | [01-foundation.md](01-foundation.md) | Git repo, both apps scaffolded, lint/format/test/hooks working, `GET /api/health`, Vite proxy. |
| 2 | [02-editor-core.md](02-editor-core.md) | Usable Markdown editor without AI: tabs (Editor / Preview / AI Review placeholder), CodeMirror editor, preview, localStorage autosave, export `.md`, light/dark theme. |
| 3 | [03-backend-ai.md](03-backend-ai.md) | LLM provider strategy, `GET /api/models`, streaming `POST /api/suggestions` (SSE). Fully tested with a fake provider. |
| 4 | [04-ai-suggestions.md](04-ai-suggestions.md) | Model dropdown, "Ask AI" bar, streaming proposal, split diff review with per-hunk accept/reject, refine, stale detection. |
| 5 | [05-version-history.md](05-version-history.md) | Version timeline in the AI Review tab, diff between versions, restore, manual snapshots. |
| 6 | [06-commands-and-polish.md](06-commands-and-polish.md) | AI presets, command palette (Cmd/Ctrl+K), slash commands in the editor, keyboard shortcuts, README. |

Each phase ends with working, tested software. Phases 2 and 3 are independent of each other; 4 needs 2 and 3; 5 needs 4; 6 needs 4 (and uses 5's tab layout).

## Architecture

```
Browser (React SPA, :5173)                         FastAPI (:8000)
┌─────────────────────────────────────────┐        ┌──────────────────────────────┐
│ Header: ModelSelect · ThemeToggle ·     │        │ GET  /api/health             │
│         ExportButton                    │  /api  │ GET  /api/models             │
│ Tabs:  Editor | Preview | AI Review     │──────▶ │ POST /api/suggestions (SSE)  │
│                                         │ (Vite  │        │                     │
│ DocumentProvider  (content, selection)  │ proxy) │  build_completion_request    │
│ SuggestionProvider (active suggestion)  │        │        │                     │
│ VersionsProvider  (history)             │        │  LLMProvider (strategy)      │
│ ModelProvider     (catalog, selected)   │        │   ├─ AnthropicProvider       │
│ ThemeProvider                           │        │   └─ OpenRouterProvider      │
│ localStorage ◀── persistence            │        └──────────────────────────────┘
└─────────────────────────────────────────┘
```

Suggestion lifecycle:

1. User triggers (button / palette / slash) with an instruction and a target (`auto` = selection if non-empty, else document).
2. Client records `baseText` (the target's current text) and the scope, then POSTs to `/api/suggestions`.
3. `delta` events append to `proposedText` (shown live in the AI Review tab, which opens automatically).
4. On `done`, the client normalizes the proposal and computes diff segments → status `reviewing`.
5. Each accept/reject recomputes the region text from the segments, locates the region in the current document, and replaces it. If the region can't be located → `stale` (user can only discard).
6. When no hunk is `pending`, the suggestion is resolved. If any hunk was accepted, `onResolved` fires (phase 5 records versions), and the active suggestion is cleared.

## Backend contract

### Configuration (env, via `pydantic-settings`, `.env` supported)

| Var | Type / default | Phase |
|---|---|---|
| `CORS_ORIGINS` | JSON list of str, default `["http://localhost:5173"]` | 1 |
| `LLM_PROVIDER` | `"anthropic"` \| `"openrouter"`, default `"anthropic"` | 3 |
| `ANTHROPIC_API_KEY` | str \| None | 3 |
| `OPENROUTER_API_KEY` | str \| None | 3 |
| `LLM_DEFAULT_MODEL` | str, default `"claude-sonnet-5-5"` (must be a catalog ID) | 3 |
| `LLM_EFFORT` | `"low"` \| `"medium"` \| `"high"`, default `"low"` (Anthropic `output_config.effort`; interactive latency matters) | 3 |
| `LLM_MAX_TOKENS` | int, default `64000` | 3 |

### Endpoints

`GET /api/health` → `200 {"status": "ok"}`

`GET /api/models` →
```json
{
  "provider": "anthropic",
  "default_model": "claude-sonnet-5-5",
  "models": [
    {"id": "claude-sonnet-5-5", "label": "Claude Sonnet 5.5"},
    {"id": "claude-haiku-5-5", "label": "Claude Haiku 5.5"}
  ]
}
```

`POST /api/suggestions` — request body:
```json
{
  "model": "claude-sonnet-5-5",
  "document": "# Title\n\nFull markdown…",
  "selection": {"start": 10, "end": 42},
  "instruction": "Make this more concise",
  "history": [{"instruction": "Rewrite formally", "proposal": "…previous proposal…"}]
}
```
- `selection`: `null` → whole document is the target. Offsets are UTF-16 code-unit offsets into `document` (what JS `String` uses); `0 <= start < end <= len(document)` measured in UTF-16 units. The backend slices using a UTF-16-safe helper.
- `history[].proposal` must be non-empty (the Anthropic API rejects empty assistant turns); the client disables refine when the proposal is empty.
- `instruction`: 1–2000 chars after strip. `document`: max 200 000 chars. `history`: max 10 turns.
- Validation errors → `422` (FastAPI default). Unknown `model` → `422` with `{"detail": "Unknown model: <id>"}`. Both happen **before** streaming starts.

Response: `200`, `Content-Type: text/event-stream`, headers `Cache-Control: no-cache`, `X-Accel-Buffering: no`. Events (each `data` is one JSON line):
```
event: delta
data: {"text": "partial text"}

event: done
data: {"stop_reason": "end_turn"}

event: error
data: {"code": "rate_limited", "message": "Human-readable message"}
```
Exactly one terminal event (`done` or `error`) ends every stream. Error codes: `auth_error`, `rate_limited`, `provider_unavailable`, `refused`, `bad_request`, `internal_error`. On `error`, the client discards any streamed text.

### Prompt contract (phase 3, `app/suggestions/prompt.py`)

- System prompt: the model is a co-author editing a Markdown document; it outputs **only** the rewritten target text — no preamble, no explanation, no code fences around the output; it makes the minimal changes needed to satisfy the instruction and preserves everything else verbatim (including Markdown syntax and trailing newline).
- First user message: the full document in `<document>…</document>`. With a selection, the target is marked inline with `<target>` / `</target>` tags inside the document, plus the target repeated in `<target_text>…</target_text>`. Then `<instruction>…</instruction>`, and a closing line: rewrite only the target (or the whole document when there is no selection).
- Refine history: for each turn in `history`, the first user message uses that turn's instruction, followed by `assistant: <proposal>`, then `user: Refine your previous rewrite: <next instruction>`. The final message is always `user` (no assistant prefill).

### Python interfaces

```python
# app/llm/types.py
Role = Literal["user", "assistant"]

@dataclass(frozen=True)
class ChatMessage:
    role: Role
    content: str

@dataclass(frozen=True)
class CompletionRequest:
    model: str            # logical catalog ID, e.g. "claude-sonnet-5-5"
    system: str
    messages: list[ChatMessage]
    max_tokens: int

@dataclass(frozen=True)
class TextDelta:
    text: str

@dataclass(frozen=True)
class StreamDone:
    stop_reason: str

StreamEvent = TextDelta | StreamDone

ErrorCode = Literal["auth_error", "rate_limited", "provider_unavailable", "refused", "bad_request", "internal_error"]

class ProviderError(Exception):
    def __init__(self, code: ErrorCode, message: str) -> None: ...
    code: ErrorCode
    message: str

@dataclass(frozen=True)
class ModelInfo:
    id: str
    label: str

# app/llm/catalog.py
MODELS: tuple[ModelInfo, ...]  # sonnet 5.5 first, haiku 5.5 second
def get_model(model_id: str) -> ModelInfo | None: ...

# app/llm/base.py
class LLMProvider(Protocol):
    name: str
    def stream(self, request: CompletionRequest) -> AsyncIterator[StreamEvent]: ...
    # Yields TextDelta* then exactly one StreamDone, or raises ProviderError.

# app/llm/factory.py
def build_provider(settings: Settings) -> LLMProvider: ...
def get_provider() -> LLMProvider: ...   # FastAPI dependency; cached per process

# app/suggestions/schemas.py  (Pydantic)
class Selection(BaseModel): start: int; end: int
class RefineTurn(BaseModel): instruction: str; proposal: str
class SuggestionRequest(BaseModel):
    model: str; document: str; selection: Selection | None = None
    instruction: str; history: list[RefineTurn] = []

# app/suggestions/prompt.py
SYSTEM_PROMPT: str
def utf16_slice(text: str, start: int, end: int) -> str: ...
def build_completion_request(req: SuggestionRequest, max_tokens: int) -> CompletionRequest: ...

# app/suggestions/utf16.py  (utf16_len, utf16_slice; re-exported from prompt.py to avoid a schemas↔prompt cycle)

# app/llm/factory.py also defines ProviderConfigError (selected provider's API key missing) → endpoints return 503 {"detail": ...}

# app/suggestions/sse.py
def format_sse(event: str, data: dict[str, object]) -> str: ...  # "event: x\ndata: {json}\n\n"
```

Provider model mapping: Anthropic uses the logical ID as-is (`claude-sonnet-5-5`, `claude-haiku-5-5`). OpenRouter maps to `anthropic/claude-sonnet-5.5` and `anthropic/claude-haiku-5.5` — **verify these slugs on openrouter.ai/models during phase 3** and update the constant if they differ.

Anthropic specifics: `AsyncAnthropic().beta.messages.stream(...)` with `output_config={"effort": LLM_EFFORT}`. Adaptive thinking is the default on both models (omit `thinking`); thinking display is omitted by default, so `text_stream` carries only answer text. For `claude-sonnet-5-5` add server-side refusal fallback: `betas=["server-side-fallback-2026-07-01"], fallbacks="default"` (not supported for Haiku 5.5). After the stream, `stop_reason == "refusal"` → `ProviderError("refused", …)`. Map SDK errors most-specific-first: `AuthenticationError`/`PermissionDeniedError` → `auth_error`, `RateLimitError` → `rate_limited`, `BadRequestError` → `bad_request`, other `APIStatusError` → `provider_unavailable`, `APIConnectionError` → `provider_unavailable`.

## Frontend contract

### Environment (`src/env.ts`)

```ts
export const env: { VITE_API_BASE_URL: string } // Zod-validated import.meta.env, default "/api"
```

### localStorage keys

| Key | Value (Zod schema in the owning feature) | Phase |
|---|---|---|
| `ai-docs:document` | `{ content: string; updatedAt: number }` | 2 |
| `ai-docs:theme` | `"light" \| "dark"` | 2 |
| `ai-docs:model` | `string` | 4 |
| `ai-docs:versions` | `Version[]` | 5 |

### File map

```
frontend/src/
  main.tsx, App.tsx, index.css, env.ts
  test/setup.ts                                   # jest-dom, localStorage reset
  lib/storage.ts        loadJson, saveJson
  lib/download.ts       downloadTextFile
  lib/id.ts             createId
  features/theme/       theme.ts, ThemeProvider.tsx, ThemeToggle.tsx
  features/document/    schema.ts, initialContent.ts, exportFilename.ts,
                        DocumentProvider.tsx, ExportButton.tsx
  features/editor/      MarkdownEditor.tsx
  features/preview/     MarkdownPreview.tsx
  features/layout/      Tabs.tsx, AppHeader.tsx
  features/ai/          schemas.ts, sse.ts, api.ts, ModelProvider.tsx, ModelSelect.tsx      (4)
  features/suggestions/ types.ts, diff.ts, normalize.ts, locateRegion.ts,
                        suggestionReducer.ts, SuggestionProvider.tsx,
                        AskAiBar.tsx, SplitDiffView.tsx, SuggestionPanel.tsx               (4)
  features/history/     types.ts, versionsReducer.ts, VersionsProvider.tsx,
                        VersionTimeline.tsx, VersionDetail.tsx, AiReviewTab.tsx             (5)
  features/commands/    presets.ts, CommandPalette.tsx, slashCommands.ts                    (6)
```
Tests sit next to their source as `*.test.ts(x)`.

### TypeScript interfaces

```ts
// lib/storage.ts
export function loadJson<T>(key: string, schema: z.ZodType<T>, fallback: T): T // never throws
export function saveJson(key: string, value: unknown): boolean                   // false on quota/any error
// lib/download.ts
export function downloadTextFile(filename: string, text: string, mime?: string): void // default "text/markdown;charset=utf-8"
// lib/id.ts
export function createId(): string // crypto.randomUUID()

// features/theme
export type Theme = 'light' | 'dark'
export function useTheme(): { theme: Theme; setTheme(t: Theme): void; toggleTheme(): void }
// ThemeProvider sets/removes class "dark" on document.documentElement.

// features/document
export type TextRange = { from: number; to: number }          // UTF-16 offsets, from <= to
export type DocumentContextValue = {
  content: string
  selection: TextRange                                         // from === to when collapsed
  setContent(content: string): void
  setSelection(range: TextRange): void
  replaceRange(range: TextRange, text: string): void
}
export function useDocument(): DocumentContextValue
export function exportFilename(content: string): string        // slug of first "# " heading + ".md", else "document.md"
// DocumentProvider autosaves to ai-docs:document (debounced 300 ms) and loads on mount (fallback: initialContent).

// features/editor
export type MarkdownEditorProps = {
  value: string
  onChange(value: string): void
  onSelectionChange?(range: TextRange): void
  dark: boolean
  extensions?: Extension[]            // extra CodeMirror extensions (phase 6 slash commands)
}
// External value changes (value !== view doc) are dispatched into the view without echoing onChange.

// features/layout
export type AppHeaderProps = { children?: ReactNode; onOpenCommands?: () => void } // children slot holds ModelSelect; onOpenCommands added in phase 6
export type TabId = 'editor' | 'preview' | 'review'
export function Tabs(props: { active: TabId; onChange(id: TabId): void; panels: Record<TabId, ReactNode>; badges?: Partial<Record<TabId, ReactNode>> }): JSX.Element

// features/ai
export type ModelInfo = { id: string; label: string }
export type ModelsResponse = { provider: string; default_model: string; models: ModelInfo[] }
export type SuggestionRequestBody = {
  model: string; document: string; selection: { start: number; end: number } | null
  instruction: string; history: { instruction: string; proposal: string }[]
}
export type StreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; stopReason: string }
  | { type: 'error'; code: string; message: string }
export function parseSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<{ event: string; data: string }>
export async function fetchModels(signal?: AbortSignal): Promise<ModelsResponse>
export function streamSuggestion(body: SuggestionRequestBody, signal: AbortSignal): AsyncGenerator<StreamEvent>
  // Non-2xx response → yields one { type: 'error', code: 'http_<status>', message } and returns.
  // Network failure (not abort) → yields { type: 'error', code: 'network_error', ... }.
export function useModels(): { models: ModelInfo[]; selectedModel: string | null; setSelectedModel(id: string): void; status: 'loading' | 'ready' | 'error' }

// features/suggestions/types.ts
export type HunkStatus = 'pending' | 'accepted' | 'rejected'
export type Hunk = { id: string; oldText: string; newText: string; oldStartLine: number; newStartLine: number; status: HunkStatus }
export type DiffSegment = { kind: 'equal'; text: string; oldStartLine: number; newStartLine: number } | { kind: 'change'; hunk: Hunk }
export type SuggestionScope = { kind: 'document' } | { kind: 'selection'; range: TextRange }
export type RefineTurn = { instruction: string; proposal: string }
export type SuggestionStatus = 'streaming' | 'reviewing' | 'error'
export type Suggestion = {
  id: string
  status: SuggestionStatus
  scope: SuggestionScope
  baseText: string           // target text when requested
  instruction: string        // current turn's instruction
  model: string
  proposedText: string       // streamed / normalized proposal
  segments: DiffSegment[]    // [] until reviewing
  history: RefineTurn[]      // previous turns (for refine)
  stale: boolean
  error: { code: string; message: string } | null
  contentBeforeFirstAccept: string | null
}
export type SuggestionTarget = 'auto' | 'document' | TextRange
export type StartSuggestionInput = { instruction: string; target: SuggestionTarget }
export type ResolvedSuggestion = {
  instruction: string; history: RefineTurn[]; model: string
  contentBefore: string; contentAfter: string; acceptedCount: number; totalCount: number
}

// features/suggestions/diff.ts
export function computeSegments(oldText: string, newText: string): DiffSegment[]
export function applySegments(segments: DiffSegment[]): string   // equal text + (accepted ? newText : oldText)
export function countByStatus(segments: DiffSegment[]): Record<HunkStatus, number>
// features/suggestions/normalize.ts
export function normalizeProposal(proposal: string, baseText: string): string
  // strips a wrapping ``` / ```markdown fence; matches baseText's trailing-newline presence
// features/suggestions/locateRegion.ts
export function locateRegion(content: string, expected: string, hintFrom: number): TextRange | null
  // exact match at hintFrom, else unique occurrence anywhere, else null. expected === '' → { from: hintFrom, to: hintFrom } if hintFrom <= content.length

// features/suggestions/SuggestionProvider.tsx
export function SuggestionProvider(props: { children: ReactNode; onResolved?(r: ResolvedSuggestion): void; onStart?(): void }): JSX.Element
export function useSuggestion(): {
  suggestion: Suggestion | null
  isBusy: boolean                                   // suggestion !== null
  start(input: StartSuggestionInput): void
  stop(): void                                      // abort streaming → error state "Stopped"
  refine(instruction: string): void
  setHunkStatus(hunkId: string, status: HunkStatus): void
  acceptAll(): void
  rejectAll(): void
  retry(): void                                     // error state → re-run the same instruction/history (added in phase 4)
  discard(): void                                   // fires onResolved first if any hunk was already accepted
}

// features/history
export type VersionSource = 'initial' | 'manual' | 'ai' | 'restore'
export type Version = { id: string; createdAt: number; source: VersionSource; label: string; model?: string; content: string }
export function useVersions(): {
  versions: Version[]                                // oldest first
  record(input: Omit<Version, 'id' | 'createdAt'>): void  // no-op if content equals the latest version's content
  restore(versionId: string): void                   // setContent(version.content) + record({source:'restore', label:`Restored "${label}"`})
}
export const MAX_VERSIONS = 100

// features/commands/presets.ts
export type AiPreset = { id: string; label: string; slash: string; instruction: string; target: 'auto' | 'document' | 'block' }
export const AI_PRESETS: AiPreset[]
```

### Provider nesting (`App.tsx`, final form)

```tsx
<ThemeProvider>
  <DocumentProvider>
    <ModelProvider>                       {/* phase 4 */}
      <AppShell />                        {/* owns activeTab state */}
    </ModelProvider>
  </DocumentProvider>
</ThemeProvider>

// AppShell
<VersionsProvider>                        {/* phase 5 */}
  <SuggestionBridge onStart={() => setActiveTab('review')}>  {/* phase 5; phase 4 uses SuggestionProvider directly */}
    <Workspace activeTab={activeTab} onTabChange={setActiveTab} />  {/* header, tabs, panels; phase 6 adds palette + slash commands here */}
  </SuggestionBridge>
</VersionsProvider>
```

## UX notes

- Header: app name, ModelSelect, ThemeToggle, ExportButton (phase 6 adds a "⌘K" hint button).
- Editor tab: AskAiBar above the editor (instruction input + "Suggest" button; label shows "Selection" or "Whole document" depending on the current selection).
- Starting a suggestion switches to the AI Review tab (via `onStart`). The Review tab badge shows the number of pending hunks.
- AI Review tab: top section = active suggestion (streaming text with Stop, or split diff with per-hunk Accept/Reject, Accept all / Reject all, Refine input, Discard; stale banner). Below = version history (phase 5).
- Split diff: two columns (Before / After) with line numbers; unchanged regions collapsed to 3 context lines with "Show N unchanged lines" expander; removed lines red-tinted, added lines green-tinted, word-level highlights inside paired lines.
- All interactive controls are keyboard-reachable and have accessible names; tests query by role/name.

## Global conventions

- Commit after every task with Conventional Commits (`feat:`, `test:`, `chore:`…).
- TDD: failing test → minimal implementation → passing test → commit.
- Frontend checks: `pnpm --dir frontend lint`, `pnpm --dir frontend typecheck`, `pnpm --dir frontend test`. Backend checks: `cd backend && uv run ruff check . && uv run ruff format --check . && uv run pytest`.
- No real network calls in tests. Backend tests use a `FakeProvider`; frontend tests mock `fetch`.
