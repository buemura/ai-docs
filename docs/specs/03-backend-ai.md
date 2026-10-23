# Phase 3 — Backend AI Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pluggable LLM provider layer (Anthropic, OpenRouter), `GET /api/models`, and a streaming `POST /api/suggestions` Server-Sent Events endpoint, all covered by tests that never hit the network.

**Architecture:** `app/llm/` holds provider-neutral types, the model catalog, the `LLMProvider` Protocol, two strategy implementations, and a factory that picks one from `LLM_PROVIDER`. `app/suggestions/` turns a validated `SuggestionRequest` into a provider-neutral `CompletionRequest` (prompt building, UTF-16-safe selection slicing) and formats SSE frames. `app/api/` exposes thin routers; the suggestions router adapts provider events into `delta` / `done` / `error` SSE events.

**Tech Stack:** Python 3.13, uv, FastAPI, Pydantic v2, pydantic-settings, `anthropic` SDK (async, beta messages stream), `httpx` (OpenRouter + `MockTransport` in tests), pytest + pytest-asyncio (`asyncio_mode = "auto"`), ruff.

**Spec:** [docs/specs/00-overview.md](00-overview.md) — read the "Backend contract" section before starting. This plan implements it exactly.

## Global Constraints

- Python 3.13; dependencies managed with `uv` from inside `api/`.
- No real network calls in tests. Anthropic is tested with an injected fake client; OpenRouter with `httpx.MockTransport`; endpoints with a `FakeProvider` through `app.dependency_overrides[get_provider]`.
- Logical model IDs: `claude-sonnet-5-5` (default, label `Claude Sonnet 5.5`) and `claude-haiku-5-5` (label `Claude Haiku 5.5`), in that order.
- Env vars: `LLM_PROVIDER` (`anthropic` | `openrouter`, default `anthropic`), `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `LLM_DEFAULT_MODEL` (default `claude-sonnet-5-5`, must be a catalog ID), `LLM_EFFORT` (`low` | `medium` | `high`, default `low`), `LLM_MAX_TOKENS` (default `64000`).
- A missing API key must NOT fail at settings load; `build_provider` raises a clear `ProviderConfigError`, surfaced as HTTP `503`.
- Request limits: `instruction` 1–2000 chars after strip; `document` max 200 000 chars; `history` max 10 turns; `selection` offsets are UTF-16 code units, `0 <= start < end <= utf16_len(document)`.
- Unknown `model` → `422 {"detail": "Unknown model: <id>"}` before streaming starts.
- SSE response: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`. Events `delta {"text"}`, `done {"stop_reason"}`, `error {"code","message"}`; exactly one terminal event per stream.
- Error codes: `auth_error`, `rate_limited`, `provider_unavailable`, `refused`, `bad_request`, `internal_error`.
- Anthropic: `AsyncAnthropic().beta.messages.stream(...)`, `output_config={"effort": LLM_EFFORT}`, omit `thinking` (adaptive is the default). Only for `claude-sonnet-5-5`: `betas=["server-side-fallback-2026-07-01"], fallbacks="default"`. `stop_reason == "refusal"` → `ProviderError("refused", …)`.
- OpenRouter slugs: `anthropic/claude-sonnet-5.5`, `anthropic/claude-haiku-5.5` — verify on openrouter.ai/models (Task 6).
- Every check passes before each commit: `uv run ruff check . && uv run ruff format --check . && uv run pytest`.

## Assumed from Phase 1

- `api/pyproject.toml` (uv project) with `fastapi[standard]`, `pydantic-settings`, dev deps `pytest`, `pytest-asyncio`, `ruff`, and `[tool.pytest.ini_options] asyncio_mode = "auto"`.
- `api/app/main.py` exposes `create_app() -> FastAPI` (CORS from settings, includes `app.api.health.router` under prefix `/api`) and a module-level `app = create_app()`.
- `api/app/config.py` has `Settings(BaseSettings)` with `cors_origins: list[str]` and `model_config = SettingsConfigDict(env_file=".env", extra="ignore")`, plus `get_settings()` decorated with `@lru_cache`.
- `api/app/api/__init__.py` exists.

If any of these differ, adapt the import lines only — do not change the contracts in this plan.

## File Structure

```
api/
  .env.example                       # modify: LLM vars
  app/
    main.py                          # modify: include models + suggestions routers, ProviderConfigError handler
    config.py                        # modify: LLM settings
    api/
      models.py                      # GET /api/models
      suggestions.py                 # POST /api/suggestions (SSE)
    llm/
      __init__.py
      types.py                       # ChatMessage, CompletionRequest, TextDelta, StreamDone, ProviderError, ModelInfo
      catalog.py                     # MODELS, get_model
      base.py                        # LLMProvider Protocol
      anthropic_provider.py          # AnthropicProvider
      openrouter_provider.py         # OpenRouterProvider
      factory.py                     # ProviderConfigError, build_provider, get_provider
    suggestions/
      __init__.py
      utf16.py                       # utf16_len, utf16_slice
      schemas.py                     # Selection, RefineTurn, SuggestionRequest
      prompt.py                      # SYSTEM_PROMPT, build_completion_request (re-exports utf16_slice)
      sse.py                         # format_sse
  tests/
    conftest.py                      # modify/create: fake_provider, api_client fixtures
    fakes.py                         # FakeProvider
    test_llm_core.py
    test_llm_config.py
    test_suggestion_schemas.py
    test_prompt.py
    test_anthropic_provider.py
    test_openrouter_provider.py
    test_factory.py
    test_models_api.py
    test_sse.py
    test_suggestions_api.py
```

`utf16.py` is a small addition to the overview's file list: `schemas.py` needs `utf16_len` for validation and `prompt.py` imports `schemas.py`, so the helpers live in their own module to avoid a cycle. `prompt.py` re-exports `utf16_slice`, so `from app.suggestions.prompt import utf16_slice` still works as the overview says.

---

### Task 1: LLM core types, catalog, and provider Protocol

**Files:**
- Create: `api/app/llm/__init__.py`
- Create: `api/app/llm/types.py`
- Create: `api/app/llm/catalog.py`
- Create: `api/app/llm/base.py`
- Test: `api/tests/test_llm_core.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `app.llm.types`: `Role`, `ErrorCode`, `ChatMessage(role, content)`, `CompletionRequest(model, system, messages, max_tokens)`, `TextDelta(text)`, `StreamDone(stop_reason)`, `StreamEvent = TextDelta | StreamDone`, `ProviderError(code, message)` with `.code` / `.message`, `ModelInfo(id, label)`.
  - `app.llm.catalog`: `MODELS: tuple[ModelInfo, ...]`, `get_model(model_id: str) -> ModelInfo | None`.
  - `app.llm.base`: `LLMProvider` Protocol with `name: str` and `stream(request: CompletionRequest) -> AsyncIterator[StreamEvent]`.

- [ ] **Step 1: Write the failing test**

`api/tests/test_llm_core.py`:

```python
from app.llm.catalog import MODELS, get_model
from app.llm.types import (
    ChatMessage,
    CompletionRequest,
    ModelInfo,
    ProviderError,
    StreamDone,
    TextDelta,
)


def test_catalog_lists_sonnet_first_then_haiku() -> None:
    assert MODELS == (
        ModelInfo(id="claude-sonnet-5-5", label="Claude Sonnet 5.5"),
        ModelInfo(id="claude-haiku-5-5", label="Claude Haiku 5.5"),
    )


def test_get_model_returns_info_for_known_id() -> None:
    assert get_model("claude-haiku-5-5") == ModelInfo(
        id="claude-haiku-5-5", label="Claude Haiku 5.5"
    )


def test_get_model_returns_none_for_unknown_id() -> None:
    assert get_model("gpt-4o") is None


def test_provider_error_carries_code_and_message() -> None:
    error = ProviderError("rate_limited", "Slow down")

    assert error.code == "rate_limited"
    assert error.message == "Slow down"
    assert str(error) == "Slow down"


def test_stream_events_compare_by_value() -> None:
    assert TextDelta("hi") == TextDelta("hi")
    assert StreamDone("end_turn") == StreamDone("end_turn")


def test_completion_request_holds_messages() -> None:
    request = CompletionRequest(
        model="claude-sonnet-5-5",
        system="sys",
        messages=[ChatMessage(role="user", content="hello")],
        max_tokens=10,
    )

    assert request.messages[0].role == "user"
    assert request.messages[0].content == "hello"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && uv run pytest tests/test_llm_core.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.llm'`

- [ ] **Step 3: Write minimal implementation**

`api/app/llm/__init__.py`:

```python
```

(empty file)

`api/app/llm/types.py`:

```python
from dataclasses import dataclass
from typing import Literal

Role = Literal["user", "assistant"]

ErrorCode = Literal[
    "auth_error",
    "rate_limited",
    "provider_unavailable",
    "refused",
    "bad_request",
    "internal_error",
]


@dataclass(frozen=True)
class ChatMessage:
    role: Role
    content: str


@dataclass(frozen=True)
class CompletionRequest:
    model: str
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


class ProviderError(Exception):
    """A provider failure that is safe to show to the user."""

    def __init__(self, code: ErrorCode, message: str) -> None:
        super().__init__(message)
        self.code: ErrorCode = code
        self.message = message


@dataclass(frozen=True)
class ModelInfo:
    id: str
    label: str
```

`api/app/llm/catalog.py`:

```python
from app.llm.types import ModelInfo

MODELS: tuple[ModelInfo, ...] = (
    ModelInfo(id="claude-sonnet-5-5", label="Claude Sonnet 5.5"),
    ModelInfo(id="claude-haiku-5-5", label="Claude Haiku 5.5"),
)

_MODELS_BY_ID = {model.id: model for model in MODELS}


def get_model(model_id: str) -> ModelInfo | None:
    return _MODELS_BY_ID.get(model_id)
```

`api/app/llm/base.py`:

```python
from collections.abc import AsyncIterator
from typing import Protocol

from app.llm.types import CompletionRequest, StreamEvent


class LLMProvider(Protocol):
    """Strategy interface for LLM backends.

    `stream` yields zero or more TextDelta events followed by exactly one
    StreamDone, or raises ProviderError.
    """

    name: str

    def stream(self, request: CompletionRequest) -> AsyncIterator[StreamEvent]: ...
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && uv run pytest tests/test_llm_core.py -v`
Expected: PASS (6 passed)

- [ ] **Step 5: Lint and commit**

```bash
cd api && uv run ruff check . && uv run ruff format .
cd .. && git add api/app/llm api/tests/test_llm_core.py
git commit -m "feat(backend): add LLM core types, model catalog and provider protocol"
```

---

### Task 2: LLM settings

**Files:**
- Modify: `api/app/config.py`
- Test: `api/tests/test_llm_config.py`

**Interfaces:**
- Consumes: `app.llm.catalog.get_model`.
- Produces: `Settings` gains `llm_provider: Literal["anthropic", "openrouter"]`, `anthropic_api_key: str | None`, `openrouter_api_key: str | None`, `llm_default_model: str`, `llm_effort: Literal["low", "medium", "high"]`, `llm_max_tokens: int`. Type aliases `ProviderName` and `Effort` exported from `app.config`. `get_settings()` unchanged.

- [ ] **Step 1: Write the failing test**

`api/tests/test_llm_config.py`:

```python
import pytest
from pydantic import ValidationError

from app.config import Settings

LLM_ENV_VARS = (
    "LLM_PROVIDER",
    "ANTHROPIC_API_KEY",
    "OPENROUTER_API_KEY",
    "LLM_DEFAULT_MODEL",
    "LLM_EFFORT",
    "LLM_MAX_TOKENS",
)


@pytest.fixture(autouse=True)
def clean_llm_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for var in LLM_ENV_VARS:
        monkeypatch.delenv(var, raising=False)


def test_llm_defaults() -> None:
    settings = Settings(_env_file=None)

    assert settings.llm_provider == "anthropic"
    assert settings.anthropic_api_key is None
    assert settings.openrouter_api_key is None
    assert settings.llm_default_model == "claude-sonnet-5-5"
    assert settings.llm_effort == "low"
    assert settings.llm_max_tokens == 64000


def test_reads_llm_values_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "openrouter")
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test")
    monkeypatch.setenv("LLM_DEFAULT_MODEL", "claude-haiku-5-5")
    monkeypatch.setenv("LLM_EFFORT", "medium")
    monkeypatch.setenv("LLM_MAX_TOKENS", "8000")

    settings = Settings(_env_file=None)

    assert settings.llm_provider == "openrouter"
    assert settings.openrouter_api_key == "sk-or-test"
    assert settings.llm_default_model == "claude-haiku-5-5"
    assert settings.llm_effort == "medium"
    assert settings.llm_max_tokens == 8000


def test_rejects_unknown_default_model() -> None:
    with pytest.raises(ValidationError, match="Unknown model: gpt-4o"):
        Settings(_env_file=None, llm_default_model="gpt-4o")


def test_rejects_unknown_provider() -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, llm_provider="cohere")


def test_rejects_unknown_effort() -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, llm_effort="max")


def test_missing_api_key_is_allowed_at_load_time() -> None:
    settings = Settings(_env_file=None, llm_provider="anthropic")

    assert settings.anthropic_api_key is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && uv run pytest tests/test_llm_config.py -v`
Expected: FAIL with `AttributeError: 'Settings' object has no attribute 'llm_provider'` (and validation tests failing with `DID NOT RAISE`)

- [ ] **Step 3: Write minimal implementation**

Replace `api/app/config.py` with the version below. Keep phase 1's `cors_origins` field and default exactly as they were.

```python
from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.llm.catalog import get_model

ProviderName = Literal["anthropic", "openrouter"]
Effort = Literal["low", "medium", "high"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    cors_origins: list[str] = ["http://localhost:5173"]

    llm_provider: ProviderName = "anthropic"
    anthropic_api_key: str | None = None
    openrouter_api_key: str | None = None
    llm_default_model: str = "claude-sonnet-5-5"
    llm_effort: Effort = "low"
    llm_max_tokens: int = Field(default=64000, ge=1, le=128000)

    @field_validator("llm_default_model")
    @classmethod
    def _default_model_in_catalog(cls, value: str) -> str:
        if get_model(value) is None:
            raise ValueError(f"Unknown model: {value}")
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && uv run pytest -v`
Expected: PASS — all tests, including phase 1's health/config tests and the 6 new ones in `test_llm_config.py`.

- [ ] **Step 5: Lint and commit**

```bash
cd api && uv run ruff check . && uv run ruff format .
cd .. && git add api/app/config.py api/tests/test_llm_config.py
git commit -m "feat(backend): add LLM provider settings"
```

---

### Task 3: Suggestion request schemas with UTF-16 offset validation

**Files:**
- Create: `api/app/suggestions/__init__.py`
- Create: `api/app/suggestions/utf16.py`
- Create: `api/app/suggestions/schemas.py`
- Test: `api/tests/test_suggestion_schemas.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `app.suggestions.utf16`: `utf16_len(text: str) -> int`, `utf16_slice(text: str, start: int, end: int) -> str` (raises `ValueError` if a boundary splits a surrogate pair).
  - `app.suggestions.schemas`: `MAX_DOCUMENT_CHARS = 200_000`, `MAX_INSTRUCTION_CHARS = 2_000`, `MAX_HISTORY_TURNS = 10`, `Selection(start, end)`, `RefineTurn(instruction, proposal)`, `SuggestionRequest(model, document, selection=None, instruction, history=[])`. `instruction` is stored stripped.

- [ ] **Step 1: Write the failing test**

`api/tests/test_suggestion_schemas.py`:

```python
import pytest
from pydantic import ValidationError

from app.suggestions.schemas import (
    MAX_DOCUMENT_CHARS,
    MAX_HISTORY_TURNS,
    MAX_INSTRUCTION_CHARS,
    SuggestionRequest,
)
from app.suggestions.utf16 import utf16_len, utf16_slice


def make(**overrides: object) -> SuggestionRequest:
    data: dict[str, object] = {
        "model": "claude-sonnet-5-5",
        "document": "Hello world",
        "instruction": "Make it shorter",
    }
    data.update(overrides)
    return SuggestionRequest.model_validate(data)


class TestUtf16:
    def test_len_counts_surrogate_pairs_as_two_units(self) -> None:
        assert utf16_len("a😀b") == 4

    def test_slice_uses_utf16_offsets(self) -> None:
        assert utf16_slice("a😀b", 1, 3) == "😀"
        assert utf16_slice("a😀b", 3, 4) == "b"

    def test_slice_rejects_split_surrogate_pair(self) -> None:
        with pytest.raises(ValueError):
            utf16_slice("a😀b", 1, 2)


class TestSuggestionRequest:
    def test_accepts_minimal_request(self) -> None:
        request = make()

        assert request.selection is None
        assert request.history == []

    def test_strips_instruction(self) -> None:
        assert make(instruction="  Fix tone \n").instruction == "Fix tone"

    @pytest.mark.parametrize("instruction", ["", "   \n"])
    def test_rejects_blank_instruction(self, instruction: str) -> None:
        with pytest.raises(ValidationError, match="instruction must not be empty"):
            make(instruction=instruction)

    def test_rejects_too_long_instruction(self) -> None:
        with pytest.raises(ValidationError):
            make(instruction="x" * (MAX_INSTRUCTION_CHARS + 1))

    def test_accepts_instruction_at_limit_after_strip(self) -> None:
        request = make(instruction=" " + "x" * MAX_INSTRUCTION_CHARS + " ")

        assert len(request.instruction) == MAX_INSTRUCTION_CHARS

    def test_rejects_too_long_document(self) -> None:
        with pytest.raises(ValidationError):
            make(document="x" * (MAX_DOCUMENT_CHARS + 1))

    def test_accepts_valid_selection(self) -> None:
        request = make(selection={"start": 6, "end": 11})

        assert request.selection is not None
        assert (request.selection.start, request.selection.end) == (6, 11)

    @pytest.mark.parametrize(
        "selection",
        [{"start": 3, "end": 3}, {"start": 5, "end": 2}, {"start": -1, "end": 2}],
    )
    def test_rejects_invalid_selection_bounds(self, selection: dict[str, int]) -> None:
        with pytest.raises(ValidationError):
            make(selection=selection)

    def test_selection_end_is_measured_in_utf16_units(self) -> None:
        # "😀" is one Python char but two UTF-16 code units.
        assert make(document="😀", selection={"start": 0, "end": 2}).selection

        with pytest.raises(ValidationError, match="selection is out of range"):
            make(document="😀", selection={"start": 0, "end": 3})

    def test_rejects_selection_splitting_a_character(self) -> None:
        with pytest.raises(ValidationError, match="splits a character"):
            make(document="a😀b", selection={"start": 1, "end": 2})

    def test_accepts_history_up_to_limit(self) -> None:
        turn = {"instruction": "Shorter", "proposal": "Hi"}

        assert len(make(history=[turn] * MAX_HISTORY_TURNS).history) == 10

    def test_rejects_history_over_limit(self) -> None:
        turn = {"instruction": "Shorter", "proposal": "Hi"}

        with pytest.raises(ValidationError):
            make(history=[turn] * (MAX_HISTORY_TURNS + 1))

    def test_rejects_empty_history_proposal(self) -> None:
        with pytest.raises(ValidationError):
            make(history=[{"instruction": "Shorter", "proposal": ""}])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && uv run pytest tests/test_suggestion_schemas.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.suggestions'`

- [ ] **Step 3: Write minimal implementation**

`api/app/suggestions/__init__.py`: empty file.

`api/app/suggestions/utf16.py`:

```python
"""Helpers for offsets measured in UTF-16 code units (what JavaScript strings use)."""


def utf16_len(text: str) -> int:
    return len(text.encode("utf-16-le")) // 2


def utf16_slice(text: str, start: int, end: int) -> str:
    """Slice `text` by UTF-16 code-unit offsets.

    Raises ValueError when a boundary falls inside a surrogate pair.
    """
    encoded = text.encode("utf-16-le")
    try:
        return encoded[start * 2 : end * 2].decode("utf-16-le")
    except UnicodeDecodeError as exc:
        raise ValueError("selection splits a character") from exc
```

`api/app/suggestions/schemas.py`:

```python
from typing import Self

from pydantic import BaseModel, Field, field_validator, model_validator

from app.suggestions.utf16 import utf16_len, utf16_slice

MAX_DOCUMENT_CHARS = 200_000
MAX_INSTRUCTION_CHARS = 2_000
MAX_HISTORY_TURNS = 10


class Selection(BaseModel):
    start: int = Field(ge=0)
    end: int = Field(ge=0)

    @model_validator(mode="after")
    def _start_before_end(self) -> Self:
        if self.start >= self.end:
            raise ValueError("selection.start must be less than selection.end")
        return self


class RefineTurn(BaseModel):
    instruction: str = Field(min_length=1, max_length=MAX_INSTRUCTION_CHARS)
    proposal: str = Field(min_length=1, max_length=MAX_DOCUMENT_CHARS)


class SuggestionRequest(BaseModel):
    model: str = Field(min_length=1)
    document: str = Field(max_length=MAX_DOCUMENT_CHARS)
    selection: Selection | None = None
    instruction: str
    history: list[RefineTurn] = Field(default_factory=list, max_length=MAX_HISTORY_TURNS)

    @field_validator("instruction")
    @classmethod
    def _clean_instruction(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("instruction must not be empty")
        if len(value) > MAX_INSTRUCTION_CHARS:
            raise ValueError(
                f"instruction must be at most {MAX_INSTRUCTION_CHARS} characters"
            )
        return value

    @model_validator(mode="after")
    def _selection_within_document(self) -> Self:
        if self.selection is None:
            return self
        if self.selection.end > utf16_len(self.document):
            raise ValueError("selection is out of range")
        # Raises ValueError("selection splits a character") on a bad boundary.
        utf16_slice(self.document, 0, self.selection.start)
        utf16_slice(self.document, self.selection.start, self.selection.end)
        return self
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && uv run pytest tests/test_suggestion_schemas.py -v`
Expected: PASS (19 passed)

- [ ] **Step 5: Lint and commit**

```bash
cd api && uv run ruff check . && uv run ruff format .
cd .. && git add api/app/suggestions api/tests/test_suggestion_schemas.py
git commit -m "feat(backend): add suggestion request schemas with UTF-16 selection validation"
```

---

### Task 4: Prompt builder

**Files:**
- Create: `api/app/suggestions/prompt.py`
- Test: `api/tests/test_prompt.py`

**Interfaces:**
- Consumes: `SuggestionRequest`, `RefineTurn` (Task 3); `utf16_len`, `utf16_slice` (Task 3); `ChatMessage`, `CompletionRequest` (Task 1).
- Produces: `app.suggestions.prompt.SYSTEM_PROMPT: str`, `build_completion_request(req: SuggestionRequest, max_tokens: int) -> CompletionRequest`, and a re-export of `utf16_slice`.

Message layout (from the overview's prompt contract):
- No history: `[user(first message with req.instruction)]`.
- With history `[t1, t2]` and current instruction `c`: `[user(first message with t1.instruction), assistant(t1.proposal), user("Refine your previous rewrite: " + t2.instruction), assistant(t2.proposal), user("Refine your previous rewrite: " + c)]`.

- [ ] **Step 1: Write the failing test**

`api/tests/test_prompt.py`:

```python
from app.suggestions.prompt import (
    SYSTEM_PROMPT,
    build_completion_request,
    utf16_slice,
)
from app.suggestions.schemas import SuggestionRequest


def make(**overrides: object) -> SuggestionRequest:
    data: dict[str, object] = {
        "model": "claude-haiku-5-5",
        "document": "# Doc\n\nHello world!\n",
        "instruction": "Fix it",
    }
    data.update(overrides)
    return SuggestionRequest.model_validate(data)


def test_reexports_utf16_slice() -> None:
    assert utf16_slice("a😀b", 1, 3) == "😀"


def test_system_prompt_demands_only_the_rewritten_text() -> None:
    lowered = SYSTEM_PROMPT.lower()

    assert "only" in lowered
    assert "code fence" in lowered
    assert "markdown" in lowered


def test_passes_model_system_and_max_tokens_through() -> None:
    completion = build_completion_request(make(), max_tokens=1234)

    assert completion.model == "claude-haiku-5-5"
    assert completion.system == SYSTEM_PROMPT
    assert completion.max_tokens == 1234


def test_whole_document_prompt() -> None:
    completion = build_completion_request(make(), max_tokens=100)

    assert [m.role for m in completion.messages] == ["user"]
    content = completion.messages[0].content
    assert "<document>\n# Doc\n\nHello world!\n\n</document>" in content
    assert "<instruction>\nFix it\n</instruction>" in content
    assert "Rewrite the whole document" in content
    assert "<target>" not in content
    assert "<target_text>" not in content


def test_selection_prompt_marks_target_inline_and_repeats_it() -> None:
    # "world" starts at UTF-16 offset 13 in "# Doc\n\nHello world!\n".
    completion = build_completion_request(
        make(selection={"start": 13, "end": 18}), max_tokens=100
    )

    content = completion.messages[0].content
    assert "Hello <target>world</target>!" in content
    assert "<target_text>\nworld\n</target_text>" in content
    assert "<instruction>\nFix it\n</instruction>" in content
    assert "Rewrite only the text inside <target>" in content


def test_selection_offsets_are_utf16() -> None:
    completion = build_completion_request(
        make(document="Hi 😀 there", selection={"start": 3, "end": 5}),
        max_tokens=100,
    )

    assert "Hi <target>😀</target> there" in completion.messages[0].content


def test_refine_history_builds_alternating_turns() -> None:
    request = make(
        instruction="Even shorter",
        history=[
            {"instruction": "Rewrite formally", "proposal": "Greetings."},
            {"instruction": "Shorter", "proposal": "Hi."},
        ],
    )

    completion = build_completion_request(request, max_tokens=100)

    messages = completion.messages
    assert [m.role for m in messages] == [
        "user",
        "assistant",
        "user",
        "assistant",
        "user",
    ]
    assert "<instruction>\nRewrite formally\n</instruction>" in messages[0].content
    assert messages[1].content == "Greetings."
    assert messages[2].content == "Refine your previous rewrite: Shorter"
    assert messages[3].content == "Hi."
    assert messages[4].content == "Refine your previous rewrite: Even shorter"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && uv run pytest tests/test_prompt.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.suggestions.prompt'`

- [ ] **Step 3: Write minimal implementation**

`api/app/suggestions/prompt.py`:

```python
from app.llm.types import ChatMessage, CompletionRequest
from app.suggestions.schemas import Selection, SuggestionRequest
from app.suggestions.utf16 import utf16_len, utf16_slice

__all__ = ["SYSTEM_PROMPT", "build_completion_request", "utf16_slice"]

SYSTEM_PROMPT = """\
You are a co-author helping the user edit a Markdown document. The user stays \
in control: you propose a rewrite, and they review it as a diff before \
accepting any change.

Output only the rewritten target text, exactly as it should appear in the \
document. Do not add a preamble, an explanation, a summary of your changes, \
or a code fence around the output.

Make the smallest changes that satisfy the instruction. Keep everything the \
instruction does not ask you to change verbatim, including Markdown syntax \
(headings, lists, links, emphasis, code blocks), line breaks, and whether the \
text ends with a trailing newline."""

REFINE_PREFIX = "Refine your previous rewrite: "


def _first_user_message(
    document: str, selection: Selection | None, instruction: str
) -> str:
    if selection is None:
        return (
            f"<document>\n{document}\n</document>\n\n"
            f"<instruction>\n{instruction}\n</instruction>\n\n"
            "Rewrite the whole document according to the instruction. "
            "Output only the rewritten document."
        )

    before = utf16_slice(document, 0, selection.start)
    target = utf16_slice(document, selection.start, selection.end)
    after = utf16_slice(document, selection.end, utf16_len(document))
    return (
        f"<document>\n{before}<target>{target}</target>{after}\n</document>\n\n"
        f"<target_text>\n{target}\n</target_text>\n\n"
        f"<instruction>\n{instruction}\n</instruction>\n\n"
        "Rewrite only the text inside <target> according to the instruction. "
        "The rest of the document is context; do not include it in your output. "
        "Output only the rewritten target text."
    )


def build_completion_request(
    req: SuggestionRequest, max_tokens: int
) -> CompletionRequest:
    instructions = [turn.instruction for turn in req.history] + [req.instruction]
    messages = [
        ChatMessage(
            role="user",
            content=_first_user_message(req.document, req.selection, instructions[0]),
        )
    ]
    for turn, next_instruction in zip(req.history, instructions[1:], strict=True):
        messages.append(ChatMessage(role="assistant", content=turn.proposal))
        messages.append(
            ChatMessage(role="user", content=f"{REFINE_PREFIX}{next_instruction}")
        )

    return CompletionRequest(
        model=req.model,
        system=SYSTEM_PROMPT,
        messages=messages,
        max_tokens=max_tokens,
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && uv run pytest tests/test_prompt.py -v`
Expected: PASS (7 passed)

- [ ] **Step 5: Lint and commit**

```bash
cd api && uv run ruff check . && uv run ruff format .
cd .. && git add api/app/suggestions/prompt.py api/tests/test_prompt.py
git commit -m "feat(backend): build completion requests from suggestion requests"
```

---

### Task 5: Anthropic provider

**Files:**
- Modify: `api/pyproject.toml` (via `uv add anthropic`)
- Create: `api/app/llm/anthropic_provider.py`
- Test: `api/tests/test_anthropic_provider.py`

**Interfaces:**
- Consumes: `CompletionRequest`, `TextDelta`, `StreamDone`, `ProviderError`, `StreamEvent` (Task 1); `Effort` (Task 2).
- Produces: `app.llm.anthropic_provider.AnthropicProvider(*, api_key: str | None = None, effort: Effort = "low", client: Any | None = None)` with `name = "anthropic"` and `async def stream(request) -> AsyncIterator[StreamEvent]`. Constants `MODEL_IDS: dict[str, str]`, `SERVER_FALLBACK_MODELS: frozenset[str]`, `SERVER_FALLBACK_BETA = "server-side-fallback-2026-07-01"`.

- [ ] **Step 1: Add the SDK and check its signature**

```bash
cd api && uv add anthropic
uv run python -c "import inspect; from anthropic.resources.beta.messages import AsyncMessages; p = inspect.signature(AsyncMessages.stream).parameters; print('fallbacks' in p, 'output_config' in p, 'betas' in p)"
```

Expected: `True True True`. If `fallbacks` or `output_config` prints `False`, run `uv add "anthropic@latest"` and re-check. If either is still `False`, pass that field through `extra_body={...}` in `_params` below instead of as a keyword, and adjust the expected dict in the Sonnet test the same way.

- [ ] **Step 2: Write the failing test**

`api/tests/test_anthropic_provider.py`:

```python
from types import SimpleNamespace
from typing import Any

import anthropic
import httpx
import pytest

from app.llm.anthropic_provider import SERVER_FALLBACK_BETA, AnthropicProvider
from app.llm.types import (
    ChatMessage,
    CompletionRequest,
    ProviderError,
    StreamDone,
    StreamEvent,
    TextDelta,
)

REQUEST_URL = "https://api.anthropic.com/v1/messages"


def make_request(model: str = "claude-sonnet-5-5") -> CompletionRequest:
    return CompletionRequest(
        model=model,
        system="Be a co-author.",
        messages=[ChatMessage(role="user", content="Fix this")],
        max_tokens=1024,
    )


class FakeStream:
    """Mimics the async context manager returned by client.beta.messages.stream."""

    def __init__(
        self,
        chunks: list[str],
        *,
        stop_reason: str = "end_turn",
        enter_error: Exception | None = None,
        mid_error: Exception | None = None,
    ) -> None:
        self._chunks = chunks
        self._stop_reason = stop_reason
        self._enter_error = enter_error
        self._mid_error = mid_error

    async def __aenter__(self) -> "FakeStream":
        if self._enter_error is not None:
            raise self._enter_error
        return self

    async def __aexit__(self, *exc_info: object) -> None:
        return None

    @property
    def text_stream(self) -> Any:
        return self._text()

    async def _text(self) -> Any:
        for chunk in self._chunks:
            yield chunk
        if self._mid_error is not None:
            raise self._mid_error

    async def get_final_message(self) -> SimpleNamespace:
        return SimpleNamespace(stop_reason=self._stop_reason)


class FakeMessages:
    def __init__(self, stream: FakeStream) -> None:
        self._stream = stream
        self.calls: list[dict[str, Any]] = []

    def stream(self, **params: Any) -> FakeStream:
        self.calls.append(params)
        return self._stream


def make_provider(
    stream: FakeStream, effort: str = "low"
) -> tuple[AnthropicProvider, FakeMessages]:
    messages = FakeMessages(stream)
    client = SimpleNamespace(beta=SimpleNamespace(messages=messages))
    return AnthropicProvider(client=client, effort=effort), messages  # type: ignore[arg-type]


async def collect(
    provider: AnthropicProvider, request: CompletionRequest
) -> list[StreamEvent]:
    return [event async for event in provider.stream(request)]


def status_error(cls: type[anthropic.APIStatusError], status: int) -> Exception:
    response = httpx.Response(status, request=httpx.Request("POST", REQUEST_URL))
    return cls("boom", response=response, body=None)


async def test_streams_text_deltas_then_done() -> None:
    provider, _ = make_provider(FakeStream(["Hello", " world"]))

    assert await collect(provider, make_request()) == [
        TextDelta("Hello"),
        TextDelta(" world"),
        StreamDone("end_turn"),
    ]


async def test_sonnet_request_uses_effort_and_server_side_fallback() -> None:
    provider, messages = make_provider(FakeStream(["ok"]), effort="medium")

    await collect(provider, make_request("claude-sonnet-5-5"))

    assert messages.calls == [
        {
            "model": "claude-sonnet-5-5",
            "max_tokens": 1024,
            "system": "Be a co-author.",
            "messages": [{"role": "user", "content": "Fix this"}],
            "output_config": {"effort": "medium"},
            "betas": [SERVER_FALLBACK_BETA],
            "fallbacks": "default",
        }
    ]


async def test_haiku_request_has_no_server_side_fallback() -> None:
    provider, messages = make_provider(FakeStream(["ok"]))

    await collect(provider, make_request("claude-haiku-5-5"))

    call = messages.calls[0]
    assert call["model"] == "claude-haiku-5-5"
    assert call["output_config"] == {"effort": "low"}
    assert "betas" not in call
    assert "fallbacks" not in call


async def test_refusal_raises_refused_after_streamed_text() -> None:
    provider, _ = make_provider(FakeStream(["Par"], stop_reason="refusal"))
    events: list[StreamEvent] = []

    with pytest.raises(ProviderError) as exc_info:
        async for event in provider.stream(make_request()):
            events.append(event)

    assert events == [TextDelta("Par")]
    assert exc_info.value.code == "refused"


@pytest.mark.parametrize(
    ("error", "code"),
    [
        (status_error(anthropic.AuthenticationError, 401), "auth_error"),
        (status_error(anthropic.PermissionDeniedError, 403), "auth_error"),
        (status_error(anthropic.RateLimitError, 429), "rate_limited"),
        (status_error(anthropic.BadRequestError, 400), "bad_request"),
        (status_error(anthropic.InternalServerError, 500), "provider_unavailable"),
        (
            anthropic.APIConnectionError(request=httpx.Request("POST", REQUEST_URL)),
            "provider_unavailable",
        ),
    ],
)
async def test_maps_sdk_errors(error: Exception, code: str) -> None:
    provider, _ = make_provider(FakeStream([], enter_error=error))

    with pytest.raises(ProviderError) as exc_info:
        await collect(provider, make_request())

    assert exc_info.value.code == code


async def test_maps_errors_raised_mid_stream() -> None:
    error = status_error(anthropic.InternalServerError, 500)
    provider, _ = make_provider(FakeStream(["Hel"], mid_error=error))

    with pytest.raises(ProviderError) as exc_info:
        await collect(provider, make_request())

    assert exc_info.value.code == "provider_unavailable"


async def test_unknown_model_is_bad_request_without_calling_the_api() -> None:
    provider, messages = make_provider(FakeStream(["ok"]))

    with pytest.raises(ProviderError) as exc_info:
        await collect(provider, make_request("gpt-4o"))

    assert exc_info.value.code == "bad_request"
    assert messages.calls == []
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd api && uv run pytest tests/test_anthropic_provider.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.llm.anthropic_provider'`

- [ ] **Step 4: Write minimal implementation**

`api/app/llm/anthropic_provider.py`:

```python
from collections.abc import AsyncIterator
from typing import Any

import anthropic
from anthropic import AsyncAnthropic

from app.config import Effort
from app.llm.types import CompletionRequest, ProviderError, StreamDone, StreamEvent, TextDelta

# Logical catalog ID -> Anthropic model ID.
MODEL_IDS: dict[str, str] = {
    "claude-sonnet-5-5": "claude-sonnet-5-5",
    "claude-haiku-5-5": "claude-haiku-5-5",
}

# Server-side refusal fallback is available for Sonnet 5.5, not for Haiku 5.5.
SERVER_FALLBACK_MODELS = frozenset({"claude-sonnet-5-5"})
SERVER_FALLBACK_BETA = "server-side-fallback-2026-07-01"


class AnthropicProvider:
    name = "anthropic"

    def __init__(
        self,
        *,
        api_key: str | None = None,
        effort: Effort = "low",
        client: Any | None = None,
    ) -> None:
        self._client = client if client is not None else AsyncAnthropic(api_key=api_key)
        self._effort = effort

    def _params(self, request: CompletionRequest) -> dict[str, Any]:
        model_id = MODEL_IDS.get(request.model)
        if model_id is None:
            raise ProviderError("bad_request", f"Unknown model: {request.model}")

        params: dict[str, Any] = {
            "model": model_id,
            "max_tokens": request.max_tokens,
            "system": request.system,
            "messages": [
                {"role": message.role, "content": message.content}
                for message in request.messages
            ],
            "output_config": {"effort": self._effort},
        }
        if request.model in SERVER_FALLBACK_MODELS:
            params["betas"] = [SERVER_FALLBACK_BETA]
            params["fallbacks"] = "default"
        return params

    async def stream(self, request: CompletionRequest) -> AsyncIterator[StreamEvent]:
        params = self._params(request)
        try:
            async with self._client.beta.messages.stream(**params) as stream:
                async for text in stream.text_stream:
                    yield TextDelta(text)
                final = await stream.get_final_message()
        except (anthropic.AuthenticationError, anthropic.PermissionDeniedError) as exc:
            raise ProviderError(
                "auth_error", "The AI provider rejected the API key."
            ) from exc
        except anthropic.RateLimitError as exc:
            raise ProviderError(
                "rate_limited",
                "The AI provider is rate limiting requests. Try again shortly.",
            ) from exc
        except anthropic.BadRequestError as exc:
            raise ProviderError(
                "bad_request", "The AI provider rejected the request."
            ) from exc
        except anthropic.APIStatusError as exc:
            raise ProviderError(
                "provider_unavailable",
                "The AI provider is unavailable. Try again later.",
            ) from exc
        except anthropic.APIConnectionError as exc:
            raise ProviderError(
                "provider_unavailable", "Could not reach the AI provider."
            ) from exc

        if final.stop_reason == "refusal":
            raise ProviderError(
                "refused",
                "The model declined this request. Try rephrasing the instruction.",
            )
        yield StreamDone(stop_reason=final.stop_reason or "end_turn")
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd api && uv run pytest tests/test_anthropic_provider.py -v`
Expected: PASS (12 passed)

- [ ] **Step 6: Lint and commit**

```bash
cd api && uv run ruff check . && uv run ruff format .
cd .. && git add api/pyproject.toml api/uv.lock api/app/llm/anthropic_provider.py api/tests/test_anthropic_provider.py
git commit -m "feat(backend): add Anthropic streaming provider"
```

---

### Task 6: OpenRouter provider

**Files:**
- Modify: `api/pyproject.toml` (via `uv add httpx`)
- Create: `api/app/llm/openrouter_provider.py`
- Test: `api/tests/test_openrouter_provider.py`

**Interfaces:**
- Consumes: `CompletionRequest`, `TextDelta`, `StreamDone`, `ProviderError`, `StreamEvent` (Task 1).
- Produces: `app.llm.openrouter_provider.OpenRouterProvider(*, api_key: str, client: httpx.AsyncClient | None = None)` with `name = "openrouter"` and `async def stream(request) -> AsyncIterator[StreamEvent]`. Constants `OPENROUTER_URL`, `MODEL_SLUGS: dict[str, str]`.

- [ ] **Step 1: Add httpx and verify model slugs**

```bash
cd api && uv add httpx
```

Open https://openrouter.ai/models, search "claude sonnet 5.5" and "claude haiku 5.5", and note the exact slugs. If they differ from `anthropic/claude-sonnet-5.5` / `anthropic/claude-haiku-5.5`, use the real slugs in `MODEL_SLUGS` (Step 4) and in the payload assertion in Step 2.

- [ ] **Step 2: Write the failing test**

`api/tests/test_openrouter_provider.py`:

```python
import json
from collections.abc import Callable

import httpx
import pytest

from app.llm.openrouter_provider import OPENROUTER_URL, OpenRouterProvider
from app.llm.types import (
    ChatMessage,
    CompletionRequest,
    ProviderError,
    StreamDone,
    StreamEvent,
    TextDelta,
)


def make_request(model: str = "claude-sonnet-5-5") -> CompletionRequest:
    return CompletionRequest(
        model=model,
        system="Be a co-author.",
        messages=[ChatMessage(role="user", content="Fix this")],
        max_tokens=1024,
    )


def chunk(content: str | None = None, finish_reason: str | None = None) -> str:
    delta = {} if content is None else {"content": content}
    payload = {"choices": [{"delta": delta, "finish_reason": finish_reason}]}
    return "data: " + json.dumps(payload)


def sse_body(*lines: str) -> bytes:
    return ("\n".join(lines) + "\n").encode()


def stream_response(body: bytes, status: int = 200) -> httpx.Response:
    return httpx.Response(
        status, headers={"content-type": "text/event-stream"}, content=body
    )


def make_provider(
    handler: Callable[[httpx.Request], httpx.Response],
) -> OpenRouterProvider:
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return OpenRouterProvider(api_key="sk-or-test", client=client)


async def collect(
    provider: OpenRouterProvider, request: CompletionRequest
) -> list[StreamEvent]:
    return [event async for event in provider.stream(request)]


async def test_streams_deltas_ignores_comments_and_stops_at_done() -> None:
    captured: dict[str, httpx.Request] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        return stream_response(
            sse_body(
                ": OPENROUTER PROCESSING",
                "",
                chunk("Hello"),
                "",
                chunk(" world"),
                "",
                chunk(finish_reason="stop"),
                "",
                "data: [DONE]",
                "",
                chunk("ignored after done"),
            )
        )

    events = await collect(make_provider(handler), make_request())

    assert events == [TextDelta("Hello"), TextDelta(" world"), StreamDone("end_turn")]
    request = captured["request"]
    assert str(request.url) == OPENROUTER_URL
    assert request.headers["authorization"] == "Bearer sk-or-test"
    assert json.loads(request.read()) == {
        "model": "anthropic/claude-sonnet-5.5",
        "stream": True,
        "max_tokens": 1024,
        "messages": [
            {"role": "system", "content": "Be a co-author."},
            {"role": "user", "content": "Fix this"},
        ],
    }


async def test_maps_haiku_to_its_slug() -> None:
    captured: dict[str, httpx.Request] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        return stream_response(sse_body(chunk("ok", "stop"), "data: [DONE]"))

    await collect(make_provider(handler), make_request("claude-haiku-5-5"))

    assert json.loads(captured["request"].read())["model"] == "anthropic/claude-haiku-5.5"


async def test_length_finish_reason_maps_to_max_tokens() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return stream_response(sse_body(chunk("Hi", "length"), "data: [DONE]"))

    events = await collect(make_provider(handler), make_request())

    assert events == [TextDelta("Hi"), StreamDone("max_tokens")]


async def test_content_filter_raises_refused() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return stream_response(sse_body(chunk(finish_reason="content_filter")))

    with pytest.raises(ProviderError) as exc_info:
        await collect(make_provider(handler), make_request())

    assert exc_info.value.code == "refused"


@pytest.mark.parametrize(
    ("status", "code"),
    [
        (400, "bad_request"),
        (401, "auth_error"),
        (403, "auth_error"),
        (402, "provider_unavailable"),
        (429, "rate_limited"),
        (503, "provider_unavailable"),
    ],
)
async def test_maps_http_status_errors(status: int, code: str) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json={"error": {"code": status, "message": "nope"}})

    with pytest.raises(ProviderError) as exc_info:
        await collect(make_provider(handler), make_request())

    assert exc_info.value.code == code


async def test_mid_stream_error_chunk_raises_after_streamed_text() -> None:
    error_chunk = "data: " + json.dumps(
        {
            "error": {"code": 429, "message": "Rate limited upstream"},
            "choices": [{"delta": {}, "finish_reason": "error"}],
        }
    )

    def handler(request: httpx.Request) -> httpx.Response:
        return stream_response(sse_body(chunk("Hel"), "", error_chunk))

    events: list[StreamEvent] = []
    with pytest.raises(ProviderError) as exc_info:
        async for event in make_provider(handler).stream(make_request()):
            events.append(event)

    assert events == [TextDelta("Hel")]
    assert exc_info.value.code == "rate_limited"
    assert exc_info.value.message == "Rate limited upstream"


async def test_malformed_chunk_raises_provider_unavailable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return stream_response(sse_body("data: {not json"))

    with pytest.raises(ProviderError) as exc_info:
        await collect(make_provider(handler), make_request())

    assert exc_info.value.code == "provider_unavailable"


async def test_connection_error_raises_provider_unavailable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    with pytest.raises(ProviderError) as exc_info:
        await collect(make_provider(handler), make_request())

    assert exc_info.value.code == "provider_unavailable"


async def test_unknown_model_is_bad_request() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("must not call the API")

    with pytest.raises(ProviderError) as exc_info:
        await collect(make_provider(handler), make_request("gpt-4o"))

    assert exc_info.value.code == "bad_request"
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd api && uv run pytest tests/test_openrouter_provider.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.llm.openrouter_provider'`

- [ ] **Step 4: Write minimal implementation**

`api/app/llm/openrouter_provider.py`:

```python
import json
from collections.abc import AsyncIterator
from typing import Any

import httpx

from app.llm.types import CompletionRequest, ProviderError, StreamDone, StreamEvent, TextDelta

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

# Logical catalog ID -> OpenRouter slug. Verify at https://openrouter.ai/models.
MODEL_SLUGS: dict[str, str] = {
    "claude-sonnet-5-5": "anthropic/claude-sonnet-5.5",
    "claude-haiku-5-5": "anthropic/claude-haiku-5.5",
}

# OpenAI-style finish_reason -> Anthropic-style stop_reason used in `done` events.
FINISH_REASONS: dict[str, str] = {
    "stop": "end_turn",
    "length": "max_tokens",
    "content_filter": "refusal",
    "tool_calls": "tool_use",
}


def _error_for_status(status: int | None, message: str | None = None) -> ProviderError:
    if status in (401, 403):
        return ProviderError("auth_error", message or "The AI provider rejected the API key.")
    if status == 429:
        return ProviderError(
            "rate_limited",
            message or "The AI provider is rate limiting requests. Try again shortly.",
        )
    if status == 400:
        return ProviderError("bad_request", message or "The AI provider rejected the request.")
    return ProviderError(
        "provider_unavailable",
        message or "The AI provider is unavailable. Try again later.",
    )


def _sse_data(line: str) -> str | None:
    """Return the payload of a `data:` line; None for comments, blanks, other fields."""
    if not line.startswith("data:"):
        return None
    return line[len("data:") :].strip()


def _decode_chunk(data: str) -> dict[str, Any]:
    try:
        return json.loads(data)
    except json.JSONDecodeError as exc:
        raise ProviderError(
            "provider_unavailable", "The AI provider sent a malformed response."
        ) from exc


class OpenRouterProvider:
    name = "openrouter"

    def __init__(self, *, api_key: str, client: httpx.AsyncClient | None = None) -> None:
        self._api_key = api_key
        self._client = client or httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0))

    async def stream(self, request: CompletionRequest) -> AsyncIterator[StreamEvent]:
        slug = MODEL_SLUGS.get(request.model)
        if slug is None:
            raise ProviderError("bad_request", f"Unknown model: {request.model}")

        payload = {
            "model": slug,
            "stream": True,
            "max_tokens": request.max_tokens,
            "messages": [
                {"role": "system", "content": request.system},
                *({"role": m.role, "content": m.content} for m in request.messages),
            ],
        }
        headers = {"Authorization": f"Bearer {self._api_key}", "X-Title": "AI Docs"}

        stop_reason = "end_turn"
        try:
            async with self._client.stream(
                "POST", OPENROUTER_URL, json=payload, headers=headers
            ) as response:
                if response.status_code != 200:
                    await response.aread()
                    raise _error_for_status(response.status_code)

                async for line in response.aiter_lines():
                    data = _sse_data(line)
                    if data is None:
                        continue
                    if data == "[DONE]":
                        break
                    chunk = _decode_chunk(data)
                    if "error" in chunk:
                        error = chunk["error"] or {}
                        code = error.get("code")
                        raise _error_for_status(
                            code if isinstance(code, int) else None,
                            error.get("message"),
                        )
                    for choice in chunk.get("choices") or []:
                        text = (choice.get("delta") or {}).get("content")
                        if text:
                            yield TextDelta(text)
                        finish = choice.get("finish_reason")
                        if finish:
                            stop_reason = FINISH_REASONS.get(finish, finish)
        except httpx.HTTPError as exc:
            raise ProviderError(
                "provider_unavailable", "Could not reach the AI provider."
            ) from exc

        if stop_reason == "refusal":
            raise ProviderError(
                "refused",
                "The model declined this request. Try rephrasing the instruction.",
            )
        yield StreamDone(stop_reason=stop_reason)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd api && uv run pytest tests/test_openrouter_provider.py -v`
Expected: PASS (14 passed)

- [ ] **Step 6: Lint and commit**

```bash
cd api && uv run ruff check . && uv run ruff format .
cd .. && git add api/pyproject.toml api/uv.lock api/app/llm/openrouter_provider.py api/tests/test_openrouter_provider.py
git commit -m "feat(backend): add OpenRouter streaming provider"
```

---

### Task 7: Provider factory

**Files:**
- Create: `api/app/llm/factory.py`
- Test: `api/tests/test_factory.py`

**Interfaces:**
- Consumes: `Settings`, `get_settings` (Task 2); `AnthropicProvider` (Task 5); `OpenRouterProvider` (Task 6); `LLMProvider` (Task 1).
- Produces: `app.llm.factory.ProviderConfigError(RuntimeError)`, `build_provider(settings: Settings) -> LLMProvider`, `get_provider() -> LLMProvider` (FastAPI dependency, `@lru_cache`d — one provider per process).

- [ ] **Step 1: Write the failing test**

`api/tests/test_factory.py`:

```python
from collections.abc import Iterator

import pytest

from app.config import Settings, get_settings
from app.llm.anthropic_provider import AnthropicProvider
from app.llm.factory import ProviderConfigError, build_provider, get_provider
from app.llm.openrouter_provider import OpenRouterProvider


@pytest.fixture
def clear_caches() -> Iterator[None]:
    get_settings.cache_clear()
    get_provider.cache_clear()
    yield
    get_settings.cache_clear()
    get_provider.cache_clear()


def test_builds_anthropic_provider() -> None:
    settings = Settings(
        _env_file=None, llm_provider="anthropic", anthropic_api_key="sk-ant-test"
    )

    provider = build_provider(settings)

    assert isinstance(provider, AnthropicProvider)
    assert provider.name == "anthropic"


def test_builds_openrouter_provider() -> None:
    settings = Settings(
        _env_file=None, llm_provider="openrouter", openrouter_api_key="sk-or-test"
    )

    provider = build_provider(settings)

    assert isinstance(provider, OpenRouterProvider)
    assert provider.name == "openrouter"


def test_missing_anthropic_key_raises_clear_error() -> None:
    settings = Settings(_env_file=None, llm_provider="anthropic", anthropic_api_key=None)

    with pytest.raises(ProviderConfigError, match="ANTHROPIC_API_KEY"):
        build_provider(settings)


def test_missing_openrouter_key_raises_clear_error() -> None:
    settings = Settings(_env_file=None, llm_provider="openrouter", openrouter_api_key="")

    with pytest.raises(ProviderConfigError, match="OPENROUTER_API_KEY"):
        build_provider(settings)


def test_get_provider_reads_settings_and_caches(
    monkeypatch: pytest.MonkeyPatch, clear_caches: None
) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "openrouter")
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test")

    first = get_provider()

    assert isinstance(first, OpenRouterProvider)
    assert get_provider() is first
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && uv run pytest tests/test_factory.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.llm.factory'`

- [ ] **Step 3: Write minimal implementation**

`api/app/llm/factory.py`:

```python
from functools import lru_cache

from app.config import Settings, get_settings
from app.llm.anthropic_provider import AnthropicProvider
from app.llm.base import LLMProvider
from app.llm.openrouter_provider import OpenRouterProvider


class ProviderConfigError(RuntimeError):
    """The configured LLM provider cannot be built (e.g. missing API key)."""


def build_provider(settings: Settings) -> LLMProvider:
    if settings.llm_provider == "anthropic":
        if not settings.anthropic_api_key:
            raise ProviderConfigError(
                "ANTHROPIC_API_KEY must be set when LLM_PROVIDER=anthropic"
            )
        return AnthropicProvider(
            api_key=settings.anthropic_api_key, effort=settings.llm_effort
        )

    if settings.llm_provider == "openrouter":
        if not settings.openrouter_api_key:
            raise ProviderConfigError(
                "OPENROUTER_API_KEY must be set when LLM_PROVIDER=openrouter"
            )
        return OpenRouterProvider(api_key=settings.openrouter_api_key)

    raise ProviderConfigError(f"Unsupported LLM_PROVIDER: {settings.llm_provider}")


@lru_cache
def get_provider() -> LLMProvider:
    """FastAPI dependency: one provider instance per process."""
    return build_provider(get_settings())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && uv run pytest tests/test_factory.py -v`
Expected: PASS (5 passed)

- [ ] **Step 5: Lint and commit**

```bash
cd api && uv run ruff check . && uv run ruff format .
cd .. && git add api/app/llm/factory.py api/tests/test_factory.py
git commit -m "feat(backend): select LLM provider from settings"
```

---

### Task 8: FakeProvider, API test fixtures, and `GET /api/models`

**Files:**
- Create: `api/tests/fakes.py`
- Modify (or create if phase 1 did not): `api/tests/conftest.py`
- Create: `api/app/api/models.py`
- Modify: `api/app/main.py`
- Test: `api/tests/test_models_api.py`

**Interfaces:**
- Consumes: `MODELS` (Task 1), `Settings` / `get_settings` (Task 2), `get_provider` (Task 7), `create_app` (phase 1).
- Produces:
  - `tests.fakes.FakeProvider(chunks=("Hello", " world"), *, stop_reason="end_turn", error=None, error_after=0)` with `name = "fake"`, `.requests: list[CompletionRequest]`, `.last_request`. `error_after` = number of chunks yielded before `error` is raised.
  - Fixtures: `fake_provider -> FakeProvider`, `test_settings -> Settings` (built with `_env_file=None`, so a developer's `.env` can't leak into tests), `api_client -> TestClient` (overrides `get_provider` and `get_settings`).
  - `GET /api/models` → `{"provider", "default_model", "models": [{"id", "label"}]}`.

- [ ] **Step 1: Write the fake provider and fixtures**

`api/tests/fakes.py`:

```python
from collections.abc import AsyncIterator, Sequence

from app.llm.types import CompletionRequest, StreamDone, StreamEvent, TextDelta


class FakeProvider:
    """Scripted LLMProvider for tests: yields `chunks`, optionally raising `error`
    after `error_after` chunks, and records every request it receives."""

    name = "fake"

    def __init__(
        self,
        chunks: Sequence[str] = ("Hello", " world"),
        *,
        stop_reason: str = "end_turn",
        error: Exception | None = None,
        error_after: int = 0,
    ) -> None:
        self._chunks = list(chunks)
        self._stop_reason = stop_reason
        self._error = error
        self._error_after = error_after
        self.requests: list[CompletionRequest] = []

    @property
    def last_request(self) -> CompletionRequest | None:
        return self.requests[-1] if self.requests else None

    async def stream(self, request: CompletionRequest) -> AsyncIterator[StreamEvent]:
        self.requests.append(request)
        for index, chunk in enumerate(self._chunks):
            if self._error is not None and index == self._error_after:
                raise self._error
            yield TextDelta(chunk)
        if self._error is not None:
            raise self._error
        yield StreamDone(self._stop_reason)
```

Add to `api/tests/conftest.py` (keep any phase 1 fixtures already there):

```python
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.llm.factory import get_provider
from app.main import create_app
from tests.fakes import FakeProvider


@pytest.fixture
def fake_provider() -> FakeProvider:
    return FakeProvider()


@pytest.fixture
def test_settings() -> Settings:
    return Settings(_env_file=None)


@pytest.fixture
def api_client(
    fake_provider: FakeProvider, test_settings: Settings
) -> Iterator[TestClient]:
    app = create_app()
    app.dependency_overrides[get_provider] = lambda: fake_provider
    app.dependency_overrides[get_settings] = lambda: test_settings
    with TestClient(app) as client:
        yield client
```

If `from tests.fakes import FakeProvider` fails with `ModuleNotFoundError: No module named 'tests'`, create an empty `api/tests/__init__.py` (or add `pythonpath = ["."]` to `[tool.pytest.ini_options]`).

- [ ] **Step 2: Write the failing test**

`api/tests/test_models_api.py`:

```python
from fastapi.testclient import TestClient

from app.config import Settings, get_settings


def test_lists_models_with_default(api_client: TestClient) -> None:
    response = api_client.get("/api/models")

    assert response.status_code == 200
    assert response.json() == {
        "provider": "anthropic",
        "default_model": "claude-sonnet-5-5",
        "models": [
            {"id": "claude-sonnet-5-5", "label": "Claude Sonnet 5.5"},
            {"id": "claude-haiku-5-5", "label": "Claude Haiku 5.5"},
        ],
    }


def test_reflects_configured_provider_and_default(api_client: TestClient) -> None:
    settings = Settings(
        _env_file=None, llm_provider="openrouter", llm_default_model="claude-haiku-5-5"
    )
    api_client.app.dependency_overrides[get_settings] = lambda: settings  # type: ignore[attr-defined]

    body = api_client.get("/api/models").json()

    assert body["provider"] == "openrouter"
    assert body["default_model"] == "claude-haiku-5-5"


def test_models_endpoint_works_without_api_key(api_client: TestClient) -> None:
    # test_settings has no API key; listing models must not build a provider.
    assert api_client.get("/api/models").status_code == 200
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd api && uv run pytest tests/test_models_api.py -v`
Expected: FAIL — `assert 404 == 200`

- [ ] **Step 4: Write minimal implementation**

`api/app/api/models.py`:

```python
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.config import Settings, get_settings
from app.llm.catalog import MODELS

router = APIRouter()


class ModelOut(BaseModel):
    id: str
    label: str


class ModelsResponse(BaseModel):
    provider: str
    default_model: str
    models: list[ModelOut]


@router.get("/models")
def list_models(settings: Annotated[Settings, Depends(get_settings)]) -> ModelsResponse:
    return ModelsResponse(
        provider=settings.llm_provider,
        default_model=settings.llm_default_model,
        models=[ModelOut(id=model.id, label=model.label) for model in MODELS],
    )
```

In `api/app/main.py`, import the router and include it next to the health router inside `create_app()`:

```python
from app.api import health, models

# inside create_app(), after app.include_router(health.router, prefix="/api"):
    app.include_router(models.router, prefix="/api")
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd api && uv run pytest -v`
Expected: PASS — all tests, including the 3 in `test_models_api.py`.

- [ ] **Step 6: Lint and commit**

```bash
cd api && uv run ruff check . && uv run ruff format .
cd .. && git add api/app/api/models.py api/app/main.py api/tests/fakes.py api/tests/conftest.py api/tests/test_models_api.py
git add -A api/tests/__init__.py 2>/dev/null || true
git commit -m "feat(backend): add GET /api/models and fake provider fixtures"
```

---

### Task 9: SSE formatting and streaming `POST /api/suggestions`

**Files:**
- Create: `api/app/suggestions/sse.py`
- Create: `api/app/api/suggestions.py`
- Modify: `api/app/main.py`
- Test: `api/tests/test_sse.py`
- Test: `api/tests/test_suggestions_api.py`

**Interfaces:**
- Consumes: `SuggestionRequest` (Task 3), `build_completion_request`, `SYSTEM_PROMPT` (Task 4), `get_model` (Task 1), `TextDelta`, `StreamDone`, `ProviderError` (Task 1), `LLMProvider` (Task 1), `get_provider`, `ProviderConfigError` (Task 7), `Settings`, `get_settings` (Task 2), fixtures from Task 8.
- Produces:
  - `app.suggestions.sse.format_sse(event: str, data: dict[str, object]) -> str` → `"event: <event>\ndata: <compact JSON>\n\n"`.
  - `POST /api/suggestions` per the overview. `ProviderConfigError` anywhere in a request → `503 {"detail": "<message>"}`.

- [ ] **Step 1: Write the failing SSE formatter test**

`api/tests/test_sse.py`:

```python
import json

from app.suggestions.sse import format_sse


def test_formats_event_and_compact_json_data() -> None:
    assert format_sse("done", {"stop_reason": "end_turn"}) == (
        'event: done\ndata: {"stop_reason":"end_turn"}\n\n'
    )


def test_newlines_in_text_stay_on_one_data_line() -> None:
    frame = format_sse("delta", {"text": "line 1\nline 2"})

    lines = frame.split("\n")
    assert lines[0] == "event: delta"
    assert lines[1].startswith("data: ")
    assert json.loads(lines[1][len("data: ") :]) == {"text": "line 1\nline 2"}
    assert frame.endswith("\n\n")
    assert frame.count("\n") == 3


def test_keeps_non_ascii_text_readable() -> None:
    assert "😀" in format_sse("delta", {"text": "😀"})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && uv run pytest tests/test_sse.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.suggestions.sse'`

- [ ] **Step 3: Implement the formatter**

`api/app/suggestions/sse.py`:

```python
import json


def format_sse(event: str, data: dict[str, object]) -> str:
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return f"event: {event}\ndata: {payload}\n\n"
```

Run: `cd api && uv run pytest tests/test_sse.py -v`
Expected: PASS (3 passed)

- [ ] **Step 4: Write the failing endpoint test**

`api/tests/test_suggestions_api.py`:

```python
import json
import logging
from collections.abc import AsyncIterator

import pytest
from fastapi.testclient import TestClient

from app.llm.factory import ProviderConfigError, get_provider
from app.llm.types import CompletionRequest, ProviderError, StreamEvent, TextDelta
from app.suggestions.prompt import SYSTEM_PROMPT
from tests.fakes import FakeProvider


def body(**overrides: object) -> dict[str, object]:
    data: dict[str, object] = {
        "model": "claude-sonnet-5-5",
        "document": "Hello world",
        "selection": {"start": 6, "end": 11},
        "instruction": "Make it louder",
        "history": [],
    }
    data.update(overrides)
    return data


def parse_sse(text: str) -> list[tuple[str, dict[str, object]]]:
    events: list[tuple[str, dict[str, object]]] = []
    for frame in text.strip().split("\n\n"):
        lines = frame.split("\n")
        event = next(line[len("event: ") :] for line in lines if line.startswith("event: "))
        data = next(line[len("data: ") :] for line in lines if line.startswith("data: "))
        events.append((event, json.loads(data)))
    return events


def use_provider(client: TestClient, provider: object) -> None:
    client.app.dependency_overrides[get_provider] = lambda: provider  # type: ignore[attr-defined]


def test_streams_deltas_then_done(api_client: TestClient) -> None:
    response = api_client.post("/api/suggestions", json=body())

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert response.headers["cache-control"] == "no-cache"
    assert response.headers["x-accel-buffering"] == "no"
    assert parse_sse(response.text) == [
        ("delta", {"text": "Hello"}),
        ("delta", {"text": " world"}),
        ("done", {"stop_reason": "end_turn"}),
    ]


def test_sends_built_completion_request_to_provider(
    api_client: TestClient, fake_provider: FakeProvider
) -> None:
    api_client.post("/api/suggestions", json=body())

    request = fake_provider.last_request
    assert isinstance(request, CompletionRequest)
    assert request.model == "claude-sonnet-5-5"
    assert request.system == SYSTEM_PROMPT
    assert request.max_tokens == 64000
    assert "Hello <target>world</target>" in request.messages[0].content


def test_unknown_model_is_rejected_before_streaming(
    api_client: TestClient, fake_provider: FakeProvider
) -> None:
    response = api_client.post("/api/suggestions", json=body(model="gpt-4o"))

    assert response.status_code == 422
    assert response.json() == {"detail": "Unknown model: gpt-4o"}
    assert fake_provider.requests == []


def test_invalid_body_is_rejected(api_client: TestClient) -> None:
    response = api_client.post("/api/suggestions", json=body(instruction="   "))

    assert response.status_code == 422


def test_provider_error_becomes_error_event(api_client: TestClient) -> None:
    use_provider(
        api_client,
        FakeProvider(
            ["Hel"], error=ProviderError("rate_limited", "Slow down"), error_after=1
        ),
    )

    events = parse_sse(api_client.post("/api/suggestions", json=body()).text)

    assert events == [
        ("delta", {"text": "Hel"}),
        ("error", {"code": "rate_limited", "message": "Slow down"}),
    ]


def test_unexpected_exception_becomes_internal_error_and_is_logged(
    api_client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    use_provider(api_client, FakeProvider([], error=RuntimeError("kaboom")))

    with caplog.at_level(logging.ERROR):
        events = parse_sse(api_client.post("/api/suggestions", json=body()).text)

    assert events == [
        (
            "error",
            {
                "code": "internal_error",
                "message": "Something went wrong while generating the suggestion.",
            },
        )
    ]
    assert "Unexpected error while streaming suggestion" in caplog.text


def test_stream_without_done_ends_with_internal_error(api_client: TestClient) -> None:
    class NoDoneProvider:
        name = "no-done"

        async def stream(self, request: CompletionRequest) -> AsyncIterator[StreamEvent]:
            yield TextDelta("partial")

    use_provider(api_client, NoDoneProvider())

    events = parse_sse(api_client.post("/api/suggestions", json=body()).text)

    assert events[-1][0] == "error"
    assert events[-1][1]["code"] == "internal_error"


def test_missing_provider_config_returns_503(api_client: TestClient) -> None:
    def broken_provider() -> None:
        raise ProviderConfigError("ANTHROPIC_API_KEY must be set when LLM_PROVIDER=anthropic")

    api_client.app.dependency_overrides[get_provider] = broken_provider  # type: ignore[attr-defined]

    response = api_client.post("/api/suggestions", json=body())

    assert response.status_code == 503
    assert response.json() == {
        "detail": "ANTHROPIC_API_KEY must be set when LLM_PROVIDER=anthropic"
    }
```

- [ ] **Step 5: Run test to verify it fails**

Run: `cd api && uv run pytest tests/test_suggestions_api.py -v`
Expected: FAIL — `assert 404 == 200` (route not registered)

- [ ] **Step 6: Implement the endpoint**

`api/app/api/suggestions.py`:

```python
import asyncio
import logging
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.config import Settings, get_settings
from app.llm.base import LLMProvider
from app.llm.catalog import get_model
from app.llm.factory import get_provider
from app.llm.types import CompletionRequest, ProviderError, TextDelta
from app.suggestions.prompt import build_completion_request
from app.suggestions.schemas import SuggestionRequest
from app.suggestions.sse import format_sse

logger = logging.getLogger(__name__)

router = APIRouter()

SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


@router.post("/suggestions")
async def create_suggestion(
    body: SuggestionRequest,
    provider: Annotated[LLMProvider, Depends(get_provider)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> StreamingResponse:
    if get_model(body.model) is None:
        raise HTTPException(status_code=422, detail=f"Unknown model: {body.model}")

    completion = build_completion_request(body, max_tokens=settings.llm_max_tokens)
    return StreamingResponse(
        _event_stream(provider, completion),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )


async def _event_stream(
    provider: LLMProvider, completion: CompletionRequest
) -> AsyncIterator[str]:
    events = provider.stream(completion)
    try:
        async for event in events:
            if isinstance(event, TextDelta):
                yield format_sse("delta", {"text": event.text})
            else:
                yield format_sse("done", {"stop_reason": event.stop_reason})
                return
        yield format_sse(
            "error",
            {
                "code": "internal_error",
                "message": "The AI provider ended the stream unexpectedly.",
            },
        )
    except ProviderError as exc:
        yield format_sse("error", {"code": exc.code, "message": exc.message})
    except asyncio.CancelledError:
        # Starlette cancels the response task when the client disconnects.
        logger.info("Client disconnected; suggestion stream cancelled")
        raise
    except Exception:
        logger.exception("Unexpected error while streaming suggestion")
        yield format_sse(
            "error",
            {
                "code": "internal_error",
                "message": "Something went wrong while generating the suggestion.",
            },
        )
    finally:
        # Close the provider stream (and its HTTP connection) on every exit path.
        aclose = getattr(events, "aclose", None)
        if aclose is not None:
            await aclose()
```

In `api/app/main.py`, include the router and register the config-error handler inside `create_app()`:

```python
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.api import health, models, suggestions
from app.llm.factory import ProviderConfigError

# inside create_app(), after the models router:
    app.include_router(suggestions.router, prefix="/api")

    @app.exception_handler(ProviderConfigError)
    async def _provider_config_error(
        request: Request, exc: ProviderConfigError
    ) -> JSONResponse:
        return JSONResponse(status_code=503, content={"detail": str(exc)})
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd api && uv run pytest -v`
Expected: PASS — all tests, including 3 in `test_sse.py` and 8 in `test_suggestions_api.py`.

- [ ] **Step 8: Lint and commit**

```bash
cd api && uv run ruff check . && uv run ruff format .
cd .. && git add api/app/suggestions/sse.py api/app/api/suggestions.py api/app/main.py api/tests/test_sse.py api/tests/test_suggestions_api.py
git commit -m "feat(backend): stream AI suggestions over SSE"
```

---

### Task 10: Environment example, full verification, and manual smoke test

**Files:**
- Modify: `api/.env.example`

**Interfaces:**
- Consumes: everything above.
- Produces: documented env configuration; a verified running endpoint.

- [ ] **Step 1: Update `api/.env.example`**

Replace the file with (keep phase 1's `CORS_ORIGINS` line):

```dotenv
# Allowed browser origins (JSON list)
CORS_ORIGINS=["http://localhost:5173"]

# LLM provider strategy: "anthropic" (default) or "openrouter"
LLM_PROVIDER=anthropic

# API key for the selected provider (only the one in use is required)
ANTHROPIC_API_KEY=
OPENROUTER_API_KEY=

# Default model shown in the UI: claude-sonnet-5-5 or claude-haiku-5-5
LLM_DEFAULT_MODEL=claude-sonnet-5-5

# Anthropic reasoning effort: low (fastest, default), medium, or high
LLM_EFFORT=low

# Upper bound on generated tokens per suggestion
LLM_MAX_TOKENS=64000
```

- [ ] **Step 2: Run the full backend check**

Run: `cd api && uv run ruff check . && uv run ruff format --check . && uv run pytest`
Expected: ruff reports `All checks passed!`, format check reports files already formatted, pytest reports all tests passed (phase 1 tests plus the 83 added in this phase) with 0 failures.

- [ ] **Step 3: Check the missing-key path manually**

```bash
cd api && LLM_PROVIDER=anthropic ANTHROPIC_API_KEY= uv run fastapi dev app/main.py --port 8000
# in another terminal:
curl -s http://localhost:8000/api/models
curl -s -X POST http://localhost:8000/api/suggestions -H 'content-type: application/json' \
  -d '{"model":"claude-sonnet-5-5","document":"Hello world","instruction":"Shout"}'
```

Expected: `/api/models` returns the catalog JSON; the POST returns `{"detail":"ANTHROPIC_API_KEY must be set when LLM_PROVIDER=anthropic"}` with status 503. Stop the server.

- [ ] **Step 4 (optional, needs a real key — costs a few cents): Live streaming smoke test**

```bash
cd api && cp -n .env.example .env   # then set ANTHROPIC_API_KEY in .env
uv run fastapi dev app/main.py --port 8000
# in another terminal:
curl -N -X POST http://localhost:8000/api/suggestions -H 'content-type: application/json' \
  -d '{"model":"claude-haiku-5-5","document":"# Notes\n\nthis sentence are bad grammar.\n","selection":{"start":9,"end":38},"instruction":"Fix the grammar"}'
```

Expected: several `event: delta` frames arriving incrementally, then `event: done` with `{"stop_reason":"end_turn"}`. The concatenated deltas are only the corrected sentence, with no preamble or code fences. Repeat with `"model":"claude-sonnet-5-5"` to exercise the server-side fallback beta path. To test OpenRouter, set `LLM_PROVIDER=openrouter` and `OPENROUTER_API_KEY`, restart, and rerun the request. A `bad_request` error event at this point most likely means a wrong OpenRouter slug (see Task 6, Step 1).

- [ ] **Step 5: Commit**

```bash
git add api/.env.example
git commit -m "docs(backend): document LLM environment variables"
```

---

## Self-Review Notes

- Overview coverage: settings (T2), types/catalog/Protocol (T1), Anthropic strategy with effort, Sonnet-only fallback, refusal, and error mapping (T5), OpenRouter strategy (T6), factory and dependency (T7), schemas and limits (T3), prompt contract including refine (T4), SSE format (T9), `/api/models` (T8), `/api/suggestions` with headers, 422 for unknown model, error events, and a single terminal event (T9), and `.env.example` (T10).
- Additions beyond the overview, kept consistent with it: `app/suggestions/utf16.py` (avoids an import cycle; `prompt.py` re-exports `utf16_slice`); `ProviderConfigError` → 503; `RefineTurn.proposal` requires at least 1 char (the Anthropic API rejects empty assistant turns); `/api/models` reads only settings, so it works without an API key.
