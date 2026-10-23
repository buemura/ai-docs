# AI collab editor

This project is a AI collaborative editor. It is a browser-based Markdown editor with an AI co-author. You write; the AI
proposes edits to your selection or document as GitHub-style diffs; you accept, reject or refine
every change. Every accepted AI change is recorded in a version history.

## Features

- **Markdown editor** (CodeMirror 6) with a live **Preview** tab.
- **AI suggestions**, streamed over SSE, for the current selection, the current paragraph, or the whole document.
- **Split diff review** (Before / After) with per-hunk Accept / Reject, Accept all / Reject all, Refine, and Discard.
- **Version history** in the AI Review tab: see how the document evolved, diff any version against its predecessor, and restore it.
- **Command palette** (`⌘K` / `Ctrl K`): AI presets, Ask AI, switch tabs, toggle theme, export, switch model.
- **Slash commands**: type `/` in the editor (e.g. `/fix`, `/shorten`, `/tone-professional`, `/restructure`, `/ask`).
- **Quick actions** under the Ask AI bar for the most common presets.
- **Model switcher**: Claude Sonnet 5.5 (default) or Claude Haiku 5.5, switchable at any time.
- Autosave to `localStorage`, **Export** as `.md`, and a light theme by default with a dark mode toggle.

## Requirements

- Node 24 (`nvm use`) and pnpm ≥ 10 (pinned via `packageManager`; `corepack enable` picks it up)
- Python 3.13 and [uv](https://docs.astral.sh/uv/)
- An Anthropic API key or an OpenRouter API key

## Setup

```bash
pnpm install                                 # root: installs the Husky git hooks
pnpm --dir web install
cd api && uv sync && cp .env.example .env    # then set your API key in .env
```

## Running

```bash
# Terminal 1: API on http://localhost:8000
cd api && uv run fastapi dev app/main.py

# Terminal 2: web app on http://localhost:5173 (proxies /api to the API)
pnpm --dir web dev
```

Without an API key the app still works as an editor; AI requests return a clear "API key must be set" error.

## Configuration

Backend (`api/.env`):

| Variable             | Default                     | Description                                  |
| -------------------- | --------------------------- | -------------------------------------------- |
| `LLM_PROVIDER`       | `anthropic`                 | `anthropic` or `openrouter`                  |
| `ANTHROPIC_API_KEY`  | —                           | Required when `LLM_PROVIDER=anthropic`       |
| `OPENROUTER_API_KEY` | —                           | Required when `LLM_PROVIDER=openrouter`      |
| `LLM_DEFAULT_MODEL`  | `claude-sonnet-5-5`         | `claude-sonnet-5-5` or `claude-haiku-5-5`    |
| `LLM_EFFORT`         | `low`                       | Anthropic effort: `low`, `medium`, or `high` |
| `LLM_MAX_TOKENS`     | `64000`                     | Maximum output tokens per suggestion         |
| `CORS_ORIGINS`       | `["http://localhost:5173"]` | JSON list of allowed browser origins         |

Frontend (`web/.env`, optional):

| Variable            | Default | Description                 |
| ------------------- | ------- | --------------------------- |
| `VITE_API_BASE_URL` | `/api`  | Base URL of the backend API |

## Scripts

| Command                                                         | What it does                  |
| --------------------------------------------------------------- | ----------------------------- |
| `pnpm --dir web dev`                                            | Vite dev server               |
| `pnpm --dir web build`                                          | Production build              |
| `pnpm --dir web test`                                           | Frontend tests (Vitest)       |
| `pnpm --dir web lint`                                           | ESLint                        |
| `pnpm --dir web typecheck`                                      | TypeScript                    |
| `cd api && uv run pytest`                                       | Backend tests                 |
| `cd api && uv run ruff check . && uv run ruff format --check .` | Backend lint and format check |

Git hooks: pre-commit runs lint-staged (ESLint + Prettier) and ruff; pre-push runs the frontend typecheck and tests, and the backend tests.

## Keyboard shortcuts

| Shortcut                          | Action                                                |
| --------------------------------- | ----------------------------------------------------- |
| `⌘K` / `Ctrl K`                   | Toggle the command palette                            |
| `/` in the editor                 | Slash commands                                        |
| `⌘↵` / `Ctrl ↵` in the Ask AI bar | Send the instruction                                  |
| `↑` `↓` `↵` `Esc`                 | Navigate, run, or close in the palette and slash menu |

## Architecture

```
web/ (React 19 + Vite)                       api/ (FastAPI)
  Editor | Preview | AI Review tabs            GET  /api/health
  DocumentProvider   — content + selection     GET  /api/models
  SuggestionProvider — active AI proposal      POST /api/suggestions  (SSE: delta / done / error)
  VersionsProvider   — history                   └─ LLMProvider strategy
  ModelProvider / ThemeProvider                      ├─ AnthropicProvider
  localStorage persistence                           └─ OpenRouterProvider
```

The model returns only the replacement text for the target; the browser computes the diff, so every change is reviewed before it touches the document. Specs and implementation plans live in [`docs/specs/`](docs/specs/00-overview.md).
