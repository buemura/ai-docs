# AI collab editor

This project is a AI collaborative editor. It is a browser-based Markdown editor with an AI co-author. You write; the AI
proposes edits to your selection or document as GitHub-style diffs; you accept, reject or refine
every change.

Specs and implementation plans live in [`docs/specs/`](docs/specs/00-overview.md).

## Prerequisites

- Node 24 (`nvm use`) and pnpm ≥ 10 (pinned via `packageManager`; `corepack enable` picks it up)
- Python 3.13 and [uv](https://docs.astral.sh/uv/)

## Setup

```bash
pnpm install                  # root: installs git hooks (husky)
pnpm --dir web install
cd api && uv sync && cp .env.example .env
```

## Run

```bash
# Terminal 1: API on http://localhost:8000
cd api && uv run fastapi dev app/main.py

# Terminal 2: web app on http://localhost:5173 (proxies /api to the API)
pnpm --dir web dev
```

## Checks

```bash
pnpm --dir web lint
pnpm --dir web typecheck
pnpm --dir web test
cd api && uv run ruff check . && uv run ruff format --check . && uv run pytest
```

Git hooks run these automatically: lint/format on commit, typecheck and tests on push.
