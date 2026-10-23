# Phase 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the monorepo with both apps: a React 19 + Vite frontend and a FastAPI backend. Linting, formatting, tests and git hooks all work, the backend serves `GET /api/health`, and the Vite dev server proxies `/api` to the backend.

**Architecture:** One git repo with no workspace tooling. `frontend/` is a pnpm project scaffolded by `create-vite` (react-ts), with Tailwind v4, Vitest and a Zod-validated env module. `backend/` is a uv project with an `app` package (`create_app()` factory, `Settings` from `pydantic-settings`, routers under `/api`). A root `package.json` exists only to host Husky, whose hooks call into both apps.

**Tech Stack:** Node 24, pnpm, React 19, Vite, TypeScript (strict), Tailwind CSS v4 (`@tailwindcss/vite`, `@tailwindcss/typography`), Zod v4, Vitest + Testing Library + jsdom, ESLint 9 (flat config) + `eslint-config-prettier`, Prettier, Husky + lint-staged; Python 3.13, uv, FastAPI (`fastapi[standard]`), `pydantic-settings`, pytest + `pytest-asyncio`, ruff.

**Spec:** [docs/specs/00-overview.md](00-overview.md)

## Global Constraints

- Node 24 (`.nvmrc` = `24`), pnpm ≥ 10, Python 3.13, uv.
- Repo layout: `frontend/` (pnpm) and `backend/` (uv), with no workspace tooling. The root `package.json` only hosts Husky.
- React 19, TypeScript `strict: true`.
- Tailwind CSS v4 via `@tailwindcss/vite`; class-based dark variant: `@custom-variant dark (&:where(.dark, .dark *));`.
- Zod v4. `src/env.ts` exports `env: { VITE_API_BASE_URL: string }`, default `"/api"`.
- Backend config var `CORS_ORIGINS`: JSON list of str, default `["http://localhost:5173"]`.
- `GET /api/health` → `200 {"status": "ok"}`.
- Frontend checks: `pnpm --dir frontend lint`, `pnpm --dir frontend typecheck`, `pnpm --dir frontend test`. Backend checks: `cd backend && uv run ruff check . && uv run ruff format --check . && uv run pytest`.
- Code style: Prettier with no semicolons, single quotes, trailing commas, width 100 (matches the code in the overview).
- No real network calls in tests.
- Commit after every task using Conventional Commits.

---

## File Structure (end of phase)

```
.gitignore                 # root ignore for both apps
.nvmrc                     # "24"
package.json               # private; husky only
pnpm-lock.yaml
.husky/pre-commit          # lint-staged (frontend) + ruff (backend)
.husky/pre-push            # typecheck + tests (frontend), pytest (backend)
README.md                  # how to install, run, check
frontend/
  package.json             # scripts: dev/build/lint/format/format:check/typecheck/test; lint-staged config
  .prettierrc.json, .prettierignore
  eslint.config.js         # generated + eslint-config-prettier
  index.html               # title "AI Docs"
  vite.config.ts           # react + tailwind plugins, /api proxy, vitest config
  tsconfig.json, tsconfig.app.json, tsconfig.node.json   # generated (strict)
  src/
    main.tsx               # mounts <App />
    App.tsx                # trivial shell rendering "AI Docs"
    App.test.tsx
    index.css              # tailwind import, typography plugin, dark variant
    env.ts                 # Zod-validated env
    env.test.ts
    vite-env.d.ts          # ImportMetaEnv typing
    test/setup.ts          # jest-dom matchers, cleanup, localStorage.clear
backend/
  pyproject.toml           # deps + ruff + pytest config
  .python-version          # 3.13
  .env.example
  app/__init__.py
  app/config.py            # Settings, get_settings()
  app/main.py              # create_app(), module-level app
  app/api/__init__.py
  app/api/health.py        # router: GET /health
  tests/conftest.py        # settings + client fixtures, cache clearing
  tests/test_config.py
  tests/test_health.py
```

---

### Task 1: Repository bootstrap

**Files:**
- Create: `.gitignore`, `.nvmrc`, `package.json`

**Interfaces:**
- Consumes: nothing.
- Produces: a git repo at the project root; root `package.json` that later tasks add Husky to.

- [ ] **Step 1: Initialize git**

Run (from the project root `ai-docs/`):
```bash
git init -b main
```
Expected: `Initialized empty Git repository in …/ai-docs/.git/`

- [ ] **Step 2: Create `.gitignore`**

```gitignore
# Dependencies
node_modules/

# Build / test output
dist/
coverage/
*.tsbuildinfo

# Env files
.env
.env.local
.env.*.local

# Python
__pycache__/
*.py[cod]
.venv/
.pytest_cache/
.ruff_cache/

# Editors / OS
.DS_Store
.idea/
.vscode/*
!.vscode/extensions.json

# Logs
*.log
```

- [ ] **Step 3: Create `.nvmrc`**

```
24
```

- [ ] **Step 4: Create root `package.json`**

```json
{
  "name": "ai-docs",
  "private": true,
  "engines": {
    "node": ">=24"
  },
  "scripts": {}
}
```

- [ ] **Step 5: Verify Node version**

Run: `node --version`
Expected: `v24.x.x`. If not, run `nvm use` (or install Node 24) before continuing.

- [ ] **Step 6: Commit**

```bash
git add .gitignore .nvmrc package.json docs/
git commit -m "chore: bootstrap repository"
```

---

### Task 2: Frontend scaffold with Vitest and app shell

**Files:**
- Create (via scaffold): `frontend/` from `create-vite` `react-ts` template
- Delete: `frontend/src/App.css`, `frontend/src/assets/` (whole dir), `frontend/public/vite.svg`, `frontend/README.md`, `frontend/.gitignore`
- Replace: `frontend/src/App.tsx`, `frontend/src/main.tsx`, `frontend/src/index.css`, `frontend/index.html`, `frontend/vite.config.ts`
- Create: `frontend/src/test/setup.ts`, `frontend/src/App.test.tsx`
- Modify: `frontend/package.json` (scripts)

**Interfaces:**
- Consumes: Task 1 repo.
- Produces: `frontend/src/App.tsx` default export `App` (phase 2 replaces its body). `frontend/src/test/setup.ts` (jest-dom matchers on Vitest `expect`, `cleanup()` and `localStorage.clear()` after each test). `pnpm --dir frontend test` runs Vitest once.

- [ ] **Step 1: Scaffold the app**

Run from the project root:
```bash
pnpm create vite@latest frontend --template react-ts
```
If prompted with "Install with pnpm and start now?", answer **No**. Then:
```bash
pnpm --dir frontend install
```
If pnpm prints `Ignored build scripts: esbuild`, run `pnpm --dir frontend approve-builds` and approve `esbuild`.

- [ ] **Step 2: Verify React 19 and strict TS**

Run: `pnpm --dir frontend list react react-dom`
Expected: both `19.x`.
Run: `grep '"strict"' frontend/tsconfig.app.json`
Expected: `"strict": true,`

- [ ] **Step 3: Remove unused template files**

```bash
rm -rf frontend/src/App.css frontend/src/assets frontend/public/vite.svg frontend/README.md frontend/.gitignore
```
(The root `.gitignore` covers the frontend.)

- [ ] **Step 4: Install test dependencies**

```bash
pnpm --dir frontend add -D vitest jsdom @testing-library/react @testing-library/dom @testing-library/user-event @testing-library/jest-dom
```

- [ ] **Step 5: Replace `frontend/vite.config.ts`** (Tailwind is added in Task 3)

```ts
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    restoreMocks: true,
  },
})
```

- [ ] **Step 6: Create `frontend/src/test/setup.ts`**

```ts
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
  localStorage.clear()
})
```

- [ ] **Step 7: Add test scripts to `frontend/package.json`**

Set the `"scripts"` object to exactly:
```json
{
  "dev": "vite",
  "build": "tsc -b && vite build",
  "preview": "vite preview",
  "lint": "eslint .",
  "typecheck": "tsc -b",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 8: Write the failing test** — `frontend/src/App.test.tsx`

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('App', () => {
  it('renders the app name', () => {
    render(<App />)
    expect(screen.getByRole('heading', { level: 1, name: 'AI Docs' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 9: Run test to verify it fails**

Run: `pnpm --dir frontend test`
Expected: FAIL. `Unable to find an accessible element with the role "heading" and name "AI Docs"` (the template still renders "Vite + React").

- [ ] **Step 10: Replace `frontend/src/App.tsx`**

```tsx
export default function App() {
  return (
    <main className="min-h-screen bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <h1 className="p-6 text-2xl font-semibold">AI Docs</h1>
    </main>
  )
}
```

- [ ] **Step 11: Replace `frontend/src/main.tsx`**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('Root element #root not found')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 12: Replace `frontend/src/index.css`** with an empty placeholder (Task 3 fills it)

```css
/* Tailwind is configured in Task 3 */
```

- [ ] **Step 13: Replace `frontend/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AI Docs</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 14: Run tests and typecheck**

Run: `pnpm --dir frontend test`
Expected: PASS, `1 passed`.
Run: `pnpm --dir frontend typecheck`
Expected: exits 0 with no output.

- [ ] **Step 15: Commit**

```bash
git add frontend
git commit -m "chore(frontend): scaffold react-ts app with vitest"
```

---

### Task 3: Tailwind v4, typography and dark variant

**Files:**
- Modify: `frontend/vite.config.ts`
- Replace: `frontend/src/index.css`

**Interfaces:**
- Consumes: Task 2 scaffold.
- Produces: Tailwind utilities, `prose` classes (`@tailwindcss/typography`), and a `dark:` variant that is active when an ancestor has class `dark` (phase 2's ThemeProvider toggles `dark` on `<html>`).

- [ ] **Step 1: Install Tailwind**

```bash
pnpm --dir frontend add -D tailwindcss @tailwindcss/vite @tailwindcss/typography
```

- [ ] **Step 2: Replace `frontend/vite.config.ts`**

```ts
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    restoreMocks: true,
  },
})
```

- [ ] **Step 3: Replace `frontend/src/index.css`**

```css
@import 'tailwindcss';
@plugin '@tailwindcss/typography';

@custom-variant dark (&:where(.dark, .dark *));

html,
body,
#root {
  height: 100%;
}
```

- [ ] **Step 4: Verify the production build compiles the CSS**

Run: `pnpm --dir frontend build`
Expected: exits 0; output lists `dist/index.html`, `dist/assets/index-*.css`, `dist/assets/index-*.js`.

Run: `grep -o 'dark' frontend/dist/assets/index-*.css | head -1`
Expected: `dark`. This confirms the `dark:` utilities used in `App.tsx` were generated against the class variant.

- [ ] **Step 5: Manually verify the dev server**

Run: `pnpm --dir frontend dev`, open http://localhost:5173.
Expected: white page with an "AI Docs" heading in the system sans font, with no Vite boilerplate. In DevTools, add class `dark` to `<html>`: the background turns near-black and the text light. Stop the server.

- [ ] **Step 6: Run tests**

Run: `pnpm --dir frontend test`
Expected: PASS, `1 passed`.

- [ ] **Step 7: Commit**

```bash
git add frontend
git commit -m "feat(frontend): add tailwind v4 with typography and class dark mode"
```

---

### Task 4: Zod-validated environment module

**Files:**
- Create: `frontend/src/env.ts`, `frontend/src/env.test.ts`
- Replace: `frontend/src/vite-env.d.ts`

**Interfaces:**
- Consumes: Task 2 Vitest setup.
- Produces:
  ```ts
  export type Env = { VITE_API_BASE_URL: string }
  export function parseEnv(source: Record<string, unknown>): Env // throws Error('Invalid environment variables: …')
  export const env: Env // parsed from import.meta.env; default VITE_API_BASE_URL = "/api", trailing slashes stripped
  ```
  Phase 4's `api.ts` builds URLs as `` `${env.VITE_API_BASE_URL}/models` ``.

- [ ] **Step 1: Install Zod**

```bash
pnpm --dir frontend add zod
```
Run: `pnpm --dir frontend list zod`
Expected: `zod 4.x`.

- [ ] **Step 2: Write the failing test** — `frontend/src/env.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { parseEnv } from './env'

describe('parseEnv', () => {
  it('defaults VITE_API_BASE_URL to /api', () => {
    expect(parseEnv({})).toEqual({ VITE_API_BASE_URL: '/api' })
  })

  it('uses a provided VITE_API_BASE_URL', () => {
    expect(parseEnv({ VITE_API_BASE_URL: 'http://localhost:8000/api' })).toEqual({
      VITE_API_BASE_URL: 'http://localhost:8000/api',
    })
  })

  it('strips trailing slashes', () => {
    expect(parseEnv({ VITE_API_BASE_URL: 'http://localhost:8000/api/' }).VITE_API_BASE_URL).toBe(
      'http://localhost:8000/api',
    )
  })

  it('ignores unrelated variables', () => {
    expect(parseEnv({ MODE: 'test', DEV: true, VITE_OTHER: 'x' })).toEqual({
      VITE_API_BASE_URL: '/api',
    })
  })

  it('throws on an empty VITE_API_BASE_URL', () => {
    expect(() => parseEnv({ VITE_API_BASE_URL: '   ' })).toThrow(/Invalid environment variables/)
  })

  it('throws on a non-string VITE_API_BASE_URL', () => {
    expect(() => parseEnv({ VITE_API_BASE_URL: 42 })).toThrow(/Invalid environment variables/)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --dir frontend test src/env.test.ts`
Expected: FAIL with `Failed to resolve import "./env"`.

- [ ] **Step 4: Implement `frontend/src/env.ts`**

```ts
import { z } from 'zod'

const envSchema = z.object({
  VITE_API_BASE_URL: z
    .string()
    .trim()
    .min(1)
    .default('/api')
    .transform((value) => value.replace(/\/+$/, '')),
})

export type Env = z.infer<typeof envSchema>

export function parseEnv(source: Record<string, unknown>): Env {
  const result = envSchema.safeParse(source)
  if (!result.success) {
    throw new Error(`Invalid environment variables:\n${z.prettifyError(result.error)}`)
  }
  return result.data
}

export const env: Env = parseEnv(import.meta.env)
```

- [ ] **Step 5: Replace `frontend/src/vite-env.d.ts`**

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
```

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm --dir frontend test`
Expected: PASS, `7 passed` (6 env + 1 App).
Run: `pnpm --dir frontend typecheck`
Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add frontend
git commit -m "feat(frontend): add zod-validated env module"
```

---

### Task 5: ESLint, Prettier and lint-staged

**Files:**
- Modify: `frontend/eslint.config.js` (generated), `frontend/package.json`
- Create: `frontend/.prettierrc.json`, `frontend/.prettierignore`

**Interfaces:**
- Consumes: Tasks 2–4 source files.
- Produces: `pnpm --dir frontend lint`, `pnpm --dir frontend format`, `pnpm --dir frontend format:check`, and a `lint-staged` config used by the Husky pre-commit hook in Task 8 (`pnpm --dir frontend exec lint-staged`).

- [ ] **Step 1: Install tooling**

```bash
pnpm --dir frontend add -D prettier eslint-config-prettier lint-staged
```

- [ ] **Step 2: Create `frontend/.prettierrc.json`**

```json
{
  "semi": false,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100
}
```

- [ ] **Step 3: Create `frontend/.prettierignore`**

```
dist
coverage
pnpm-lock.yaml
```

- [ ] **Step 4: Add Prettier compatibility to `frontend/eslint.config.js`**

Keep the generated file. Make two edits:
1. Add this import after the existing imports:
   ```js
   import prettier from 'eslint-config-prettier'
   ```
2. Add `prettier` as the **last element** of the exported config array, so it turns off formatting rules that conflict with Prettier. For example, if the file ends with
   ```js
     },
   ])
   ```
   change it to
   ```js
     },
     prettier,
   ])
   ```
   Also make sure the ignore list includes `coverage`. If the file has `globalIgnores(['dist'])`, change it to `globalIgnores(['dist', 'coverage'])`. If it uses `{ ignores: ['dist'] }`, change it to `{ ignores: ['dist', 'coverage'] }`.

- [ ] **Step 5: Add format scripts and lint-staged config to `frontend/package.json`**

Add to `"scripts"`:
```json
"format": "prettier --write .",
"format:check": "prettier --check ."
```
Add a top-level key:
```json
"lint-staged": {
  "*.{ts,tsx,js}": ["eslint --fix", "prettier --write"],
  "*.{json,css,md,html}": ["prettier --write"]
}
```

- [ ] **Step 6: Format the codebase and verify**

Run: `pnpm --dir frontend format`
Expected: lists the files it formatted, with no errors.
Run: `pnpm --dir frontend format:check`
Expected: `All matched files use Prettier code style!`
Run: `pnpm --dir frontend lint`
Expected: exits 0 with no problems reported.

- [ ] **Step 7: Verify lint catches errors**

Temporarily append `const unused = 1` to `frontend/src/App.tsx`, then run `pnpm --dir frontend lint`.
Expected: FAIL with `'unused' is assigned a value but never used` (`@typescript-eslint/no-unused-vars`). Remove the line and re-run lint; it should exit 0.

- [ ] **Step 8: Run tests**

Run: `pnpm --dir frontend test`
Expected: PASS, `7 passed`.

- [ ] **Step 9: Commit**

```bash
git add frontend
git commit -m "chore(frontend): configure eslint, prettier and lint-staged"
```

---

### Task 6: Backend scaffold and settings

**Files:**
- Create (via `uv init`): `backend/pyproject.toml`, `backend/.python-version`
- Delete: `backend/main.py`, `backend/README.md` (generated by `uv init`)
- Modify: `backend/pyproject.toml` (append tool config)
- Create: `backend/app/__init__.py`, `backend/app/config.py`, `backend/tests/conftest.py`, `backend/tests/test_config.py`

**Interfaces:**
- Consumes: Task 1 repo.
- Produces:
  ```python
  # app/config.py
  class Settings(BaseSettings):
      cors_origins: list[str]  # env CORS_ORIGINS (JSON list), default ["http://localhost:5173"]
  def get_settings() -> Settings: ...  # functools.lru_cache'd
  ```
  Phase 3 adds fields to `Settings`. `tests/conftest.py` provides an autouse fixture that clears the `get_settings` cache, and a `settings` fixture (`Settings(_env_file=None)` with `CORS_ORIGINS` removed from the environment).

- [ ] **Step 1: Initialize the uv project**

```bash
mkdir backend
cd backend
uv init --app --vcs none --python 3.13 --name ai-docs-backend
rm -f main.py README.md
```
Expected: `Initialized project 'ai-docs-backend'`. `backend/.python-version` contains `3.13`.

- [ ] **Step 2: Add dependencies**

From `backend/`:
```bash
uv add "fastapi[standard]" pydantic-settings
uv add --dev pytest pytest-asyncio ruff
```
Expected: each command prints `Resolved N packages` and creates or updates `uv.lock` and `.venv/`.

- [ ] **Step 3: Append tool config to `backend/pyproject.toml`**

```toml
[tool.ruff]
line-length = 100
target-version = "py313"

[tool.ruff.lint]
select = ["E", "F", "I", "UP", "B", "SIM", "ASYNC"]

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["."]
asyncio_mode = "auto"
asyncio_default_fixture_loop_scope = "function"
```

- [ ] **Step 4: Create the package** — `backend/app/__init__.py`

```python
```
(An empty file.)

- [ ] **Step 5: Write the failing test** — `backend/tests/test_config.py`

```python
import pytest

from app.config import Settings, get_settings


def test_cors_origins_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    assert Settings(_env_file=None).cors_origins == ["http://localhost:5173"]


def test_cors_origins_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CORS_ORIGINS", '["http://a.test", "http://b.test"]')
    assert Settings(_env_file=None).cors_origins == ["http://a.test", "http://b.test"]


def test_get_settings_is_cached() -> None:
    assert get_settings() is get_settings()
```

- [ ] **Step 6: Run test to verify it fails**

Run (from `backend/`): `uv run pytest tests/test_config.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.config'`.

- [ ] **Step 7: Implement `backend/app/config.py`**

```python
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    cors_origins: list[str] = ["http://localhost:5173"]


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

- [ ] **Step 8: Create `backend/tests/conftest.py`**

```python
from collections.abc import Iterator

import pytest

from app.config import Settings, get_settings


@pytest.fixture(autouse=True)
def _clear_settings_cache() -> Iterator[None]:
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def settings(monkeypatch: pytest.MonkeyPatch) -> Settings:
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    return Settings(_env_file=None)
```

- [ ] **Step 9: Run tests and linters**

Run (from `backend/`): `uv run pytest -v`
Expected: PASS, `3 passed`.
Run: `uv run ruff check . && uv run ruff format --check .`
Expected: `All checks passed!` and `N files already formatted`. If format reports files, run `uv run ruff format .` and re-check.

- [ ] **Step 10: Commit**

```bash
cd ..
git add backend
git commit -m "chore(backend): scaffold uv project with settings"
```

---

### Task 7: FastAPI app factory, CORS and health endpoint

**Files:**
- Create: `backend/app/main.py`, `backend/app/api/__init__.py`, `backend/app/api/health.py`, `backend/tests/test_health.py`, `backend/.env.example`
- Modify: `backend/tests/conftest.py` (add `client` fixture)

**Interfaces:**
- Consumes: `Settings`, `get_settings` (Task 6).
- Produces:
  ```python
  # app/main.py
  def create_app(settings: Settings | None = None) -> FastAPI: ...  # mounts routers under /api
  app: FastAPI  # module-level, for `fastapi dev app/main.py`
  # app/api/health.py
  router: APIRouter  # GET /health -> HealthResponse(status="ok")
  # tests/conftest.py
  client  # fixture: TestClient(create_app(settings))
  ```
  Phase 3 adds `app.include_router(models_router, prefix="/api")` and `app.include_router(suggestions_router, prefix="/api")` inside `create_app`, and widens CORS `allow_methods` if needed (GET and POST are already allowed).

- [ ] **Step 1: Add the `client` fixture to `backend/tests/conftest.py`**

Replace the file with:
```python
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import create_app


@pytest.fixture(autouse=True)
def _clear_settings_cache() -> Iterator[None]:
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def settings(monkeypatch: pytest.MonkeyPatch) -> Settings:
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    return Settings(_env_file=None)


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(settings)) as test_client:
        yield test_client
```

- [ ] **Step 2: Write the failing test** — `backend/tests/test_health.py`

```python
from fastapi.testclient import TestClient


def test_health_returns_ok(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_cors_allows_configured_origin(client: TestClient) -> None:
    response = client.options(
        "/api/health",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_cors_ignores_unknown_origin(client: TestClient) -> None:
    response = client.options(
        "/api/health",
        headers={
            "Origin": "http://evil.test",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert "access-control-allow-origin" not in response.headers
```

- [ ] **Step 3: Run test to verify it fails**

Run (from `backend/`): `uv run pytest -v`
Expected: collection error `ModuleNotFoundError: No module named 'app.main'`.

- [ ] **Step 4: Create `backend/app/api/__init__.py`**

```python
```
(An empty file.)

- [ ] **Step 5: Implement `backend/app/api/health.py`**

```python
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    status: Literal["ok"]


@router.get("/health")
def health() -> HealthResponse:
    return HealthResponse(status="ok")
```

- [ ] **Step 6: Implement `backend/app/main.py`**

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.health import router as health_router
from app.config import Settings, get_settings


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(title="AI Docs API")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )
    app.include_router(health_router, prefix="/api")
    return app


app = create_app()
```

- [ ] **Step 7: Run tests to verify they pass**

Run (from `backend/`): `uv run pytest -v`
Expected: PASS, `6 passed`.

- [ ] **Step 8: Create `backend/.env.example`**

```dotenv
# Copy to backend/.env and adjust. All values are optional in phase 1.

# Allowed browser origins (JSON list). The Vite dev server proxies /api, so this
# only matters when the frontend calls the backend directly.
CORS_ORIGINS=["http://localhost:5173"]
```

- [ ] **Step 9: Manually verify the server and the proxy**

Terminal 1 (from `backend/`): `uv run fastapi dev app/main.py`
Expected: `Uvicorn running on http://127.0.0.1:8000`.
Run: `curl -s http://localhost:8000/api/health`
Expected: `{"status":"ok"}`

Terminal 2: `pnpm --dir frontend dev`
Run: `curl -s http://localhost:5173/api/health`
Expected: `{"status":"ok"}`. The Vite proxy forwards `/api` to the backend.
Stop both servers.

- [ ] **Step 10: Lint and commit**

Run (from `backend/`): `uv run ruff check . && uv run ruff format --check .`
Expected: `All checks passed!` and every file already formatted.
```bash
cd ..
git add backend
git commit -m "feat(backend): add app factory with cors and health endpoint"
```

---

### Task 8: Git hooks and README

**Files:**
- Modify: `package.json` (root: husky dev dependency, `prepare` script)
- Create: `pnpm-lock.yaml` (root, generated), `.husky/pre-commit`, `.husky/pre-push`, `README.md`

**Interfaces:**
- Consumes: frontend scripts `lint-staged`, `typecheck`, `test` (Tasks 2, 5); backend `ruff`, `pytest` (Tasks 6–7).
- Produces: a pre-commit hook (fast: staged-file lint/format plus ruff) and a pre-push hook (typecheck plus all tests). Every later phase relies on these running.

- [ ] **Step 1: Install Husky at the root**

From the project root:
```bash
pnpm add -D husky
pnpm exec husky init
```
Expected: `.husky/pre-commit` is created, and the root `package.json` now has `"prepare": "husky"` in its scripts.

- [ ] **Step 2: Replace `.husky/pre-commit`**

```sh
pnpm --dir frontend exec lint-staged
cd backend && uv run ruff check . && uv run ruff format --check .
```

- [ ] **Step 3: Create `.husky/pre-push`**

```sh
pnpm --dir frontend typecheck
pnpm --dir frontend test
cd backend && uv run pytest -q
```

- [ ] **Step 4: Make the hooks executable**

```bash
chmod +x .husky/pre-commit .husky/pre-push
```

- [ ] **Step 5: Verify the root `package.json`**

It must read (the husky version may differ):
```json
{
  "name": "ai-docs",
  "private": true,
  "engines": {
    "node": ">=24"
  },
  "scripts": {
    "prepare": "husky"
  },
  "devDependencies": {
    "husky": "^9.1.7"
  }
}
```

- [ ] **Step 6: Run the hooks manually**

Run: `sh .husky/pre-push`
Expected: typecheck exits 0, Vitest prints `7 passed`, and pytest prints `6 passed`.

- [ ] **Step 7: Create `README.md`**

````markdown
# AI Docs

Collaborative Markdown editor with an AI co-author that proposes edits as reviewable diffs.

Specs and implementation plans live in [`docs/specs/`](docs/specs/00-overview.md).

## Prerequisites

- Node 24 (`nvm use`) and pnpm ≥ 10
- Python 3.13 and [uv](https://docs.astral.sh/uv/)

## Setup

```bash
pnpm install                  # root: installs git hooks (husky)
pnpm --dir frontend install
cd backend && uv sync && cp .env.example .env
```

## Run

```bash
# Terminal 1: API on http://localhost:8000
cd backend && uv run fastapi dev app/main.py

# Terminal 2: web app on http://localhost:5173 (proxies /api to the API)
pnpm --dir frontend dev
```

## Checks

```bash
pnpm --dir frontend lint
pnpm --dir frontend typecheck
pnpm --dir frontend test
cd backend && uv run ruff check . && uv run ruff format --check . && uv run pytest
```

Git hooks run these automatically: lint/format on commit, typecheck and tests on push.
````

- [ ] **Step 8: Commit (exercises the pre-commit hook)**

```bash
pnpm --dir frontend exec prettier --write ../README.md
git add package.json pnpm-lock.yaml .husky README.md
git commit -m "chore: add husky hooks and readme"
```
Expected: before the commit is created, lint-staged output appears (`→ No staged files match any configured task` or `✔ Running tasks for staged files...`), followed by `All checks passed!` from ruff. Then the commit succeeds.

- [ ] **Step 9: Verify the hook blocks bad code**

Temporarily append `import os` to `backend/app/config.py`, then run `git add backend/app/config.py && git commit -m "test: hook"`.
Expected: the commit is **rejected** with ruff `F401 [*] 'os' imported but unused`. Revert with `git checkout backend/app/config.py` (unstage it first with `git restore --staged backend/app/config.py`).

---

## Phase Exit Criteria

- `git log --oneline` shows 8 commits (one per task).
- `pnpm --dir frontend lint && pnpm --dir frontend typecheck && pnpm --dir frontend test` passes (7 tests).
- `cd backend && uv run ruff check . && uv run ruff format --check . && uv run pytest` passes (6 tests).
- With both dev servers running, `curl http://localhost:5173/api/health` returns `{"status":"ok"}`.
