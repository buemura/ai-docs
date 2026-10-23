# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser-based Markdown editor with an AI co-author. The AI proposes replacement text for a selection or the whole document; the browser diffs it and the user accepts or rejects each hunk. Accepted changes are recorded in a version history. **The AI never edits the document directly.** Every change goes through the user's accept decision.

Monorepo with no workspace tooling: `web/` (React 19 + Vite, pnpm) and `api/` (FastAPI, uv). The root `package.json` only hosts Husky.

`docs/specs/00-overview.md` is the source of truth for shared contracts (API shapes, locked decisions, suggestion lifecycle). Phase specs `01`–`06` implement it, and when they disagree, `00` wins. Read it before changing the request/SSE contract or the suggestion flow.

## Commands

Prerequisites: Node 24 (`.nvmrc`), pnpm ≥ 10 (via `corepack enable`), Python 3.13, uv.

```bash
./start.sh                  # install everything, create api/.env, run API (:8000) + web (:5173)
./start.sh --skip-install   # just run both

# Frontend (run from repo root)
pnpm --dir web dev
pnpm --dir web test                                   # vitest run
pnpm --dir web exec vitest run src/features/suggestions/diff.test.ts   # single file
pnpm --dir web exec vitest run -t "test name"         # by name
pnpm --dir web lint
pnpm --dir web typecheck                              # tsc -b
pnpm --dir web format                                 # prettier

# Backend
make -C api dev                                       # fastapi dev with reload (PORT=… to override)
make -C api test                                      # pytest
make -C api test ARGS="tests/test_prompt.py -k name"  # single file / filter
make -C api lint                                      # ruff check
make -C api format                                    # ruff --fix + ruff format
make -C api check                                     # lint + format-check + tests (CI equivalent)
```

Git hooks: pre-commit runs lint-staged (ESLint + Prettier on `web/`) and `ruff check` + `ruff format --check` on `api/`. Pre-push runs web typecheck, web tests, and api pytest. Run `make -C api format` before committing Python changes.

Without an API key in `api/.env` the editor still works. AI requests fail with a clear "API key must be set" error (`ProviderConfigError` from `app/llm/factory.py`).

## Architecture

### Request flow

`POST /api/suggestions` takes `{model, document, selection, instruction, history}` and returns Server-Sent Events (`delta` → `done`, or `error`). The client reads the stream with `fetch` + `ReadableStream`, not `EventSource`, because `EventSource` can't POST. The Vite dev server proxies `/api` to `:8000`.

- **Selection offsets are UTF-16 code units** (JS string indices). The backend validates and slices them with `app/suggestions/utf16.py`. Don't use Python `str` indexing on them.
- Validation errors and unknown models return `422` **before** streaming starts. Once streaming has started, errors are sent as an SSE `error` event (`app/api/suggestions.py`).
- The model returns only the replacement text for the target. There are no structured edit ops. Prompt construction is in `app/suggestions/prompt.py`.

### Backend (`api/app/`)

- `llm/base.py` defines the `LLMProvider` Protocol (a strategy). `stream()` yields `TextDelta`s, then exactly one `StreamDone`, or raises `ProviderError`. The implementations are in `llm/providers/` (Anthropic SDK, OpenRouter via httpx), selected by `LLM_PROVIDER` in `llm/factory.py`.
- `llm/catalog.py` holds the logical model IDs exposed to the UI (`claude-sonnet-5-5`, `claude-haiku-5-5`). Each provider maps logical IDs to its own model IDs. Adding a model means updating the catalog and every provider's mapping.
- `get_provider` and `get_settings` are `lru_cache`d FastAPI dependencies. Tests override them via `app.dependency_overrides`; see the `api_client` fixture in `tests/conftest.py`, which uses the scripted `FakeProvider` from `tests/fakes.py`. The `_clear_settings_cache` fixture is autouse.
- `create_app(settings)` in `main.py` is an app factory.

### Frontend (`web/src/features/`)

The code is organized by feature. Each feature has React context + `useReducer` providers; there is no external state library. Reducers and helpers (`suggestionReducer.ts`, `versionsReducer.ts`, `diff.ts`, `locateRegion.ts`, `normalize.ts`) are pure and unit-tested. Keep logic there rather than in components.

Provider nesting (`App.tsx`): `ErrorBoundary → ThemeProvider → DocumentProvider → ModelProvider → VersionsProvider → SuggestionBridge (wraps SuggestionProvider) → Workspace`. `SuggestionBridge` connects suggestions to history: it turns `onResolved` into version records and opens the AI Review tab on start.

Suggestion lifecycle (`suggestions/SuggestionProvider.tsx`):
1. Trigger with an instruction and a target (`auto` means the selection if non-empty, else the document). The provider records `baseText` and the scope.
2. `delta`s accumulate into `proposedText`. On `done`, the proposal is normalized and diffed into segments/hunks, and the status becomes `reviewing`.
3. Each accept/reject recomputes the region text from the segments. `locateRegion` then finds the region in the *current* document (at the hint offset, else its unique occurrence) and replaces it. If the region is missing or ambiguous, the suggestion becomes `stale` and can only be discarded.
4. When no hunk is pending, the suggestion resolves. If anything was accepted, `onResolved` fires.

Invariants: only one suggestion can be active at a time (triggers are disabled while one is streaming or under review). Refine is allowed only while no hunk has been accepted, and only when the proposal is non-empty, because Anthropic rejects empty assistant turns.

Persistence is `localStorage` only, through `lib/storage.ts` (`loadJson`/`saveJson`). Every read is Zod-validated and falls back to a default on failure.

Commands (`features/commands/`): AI presets (`presets.ts`) feed the command palette (`cmdk`, ⌘K), the slash commands (a CodeMirror autocomplete extension in `slashCommands.ts`), and the quick-action chips.

The CodeMirror editor uses a thin custom React wrapper (`editor/MarkdownEditor.tsx`), not `@uiw/react-codemirror`. Tailwind v4 uses a class-based dark variant.

### Testing helpers

- Web: `src/test/renderWithAi.tsx` renders inside the Document → Model → Suggestion providers with a seeded document. `src/test/sse.ts` provides `sseFrame`, `sseResponse`, `controllableSseResponse`, and `MODELS_RESPONSE` for stubbing `fetch`. Integration-style tests live in `src/App.*.test.tsx`.
- API: use `api_client` + `fake_provider` for endpoint tests. Provider tests mock the SDK and HTTP layers.
