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

## Quick start

```bash
./start.sh                  # installs all dependencies, creates api/.env, starts both apps
./start.sh --skip-install   # later runs: just start both apps
```

The script checks the prerequisites, installs the root, web, and API dependencies, creates `api/.env` from `.env.example` if it is missing, then starts the API on http://localhost:8000 and, once it is healthy, the web app on http://localhost:5173. Ctrl-C stops both. Set your API key in `api/.env`.

Without an API key the app still works as an editor; AI requests return a clear "API key must be set" error.

## Manual setup

```bash
pnpm install                       # root: installs the Husky git hooks
pnpm --dir web install
make -C api install env            # uv sync, then copy .env.example to .env
```

```bash
# Terminal 1: API on http://localhost:8000
make -C api dev

# Terminal 2: web app on http://localhost:5173 (proxies /api to the API)
pnpm --dir web dev
```

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

| Command                    | What it does                                   |
| -------------------------- | ---------------------------------------------- |
| `./start.sh`               | Install everything and run both apps           |
| `pnpm --dir web dev`       | Vite dev server                                |
| `pnpm --dir web build`     | Production build                               |
| `pnpm --dir web test`      | Frontend tests (Vitest)                        |
| `pnpm --dir web lint`      | ESLint                                         |
| `pnpm --dir web typecheck` | TypeScript                                     |
| `make -C api dev`          | API with auto-reload (`PORT=…` to change port) |
| `make -C api test`         | Backend tests (`ARGS="-k name"` to filter)     |
| `make -C api lint`         | Ruff lint                                      |
| `make -C api format`       | Ruff autofix and format                        |
| `make -C api check`        | Backend lint, format check, and tests          |
| `make -C api help`         | List all API targets                           |

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
