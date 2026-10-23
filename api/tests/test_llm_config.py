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
