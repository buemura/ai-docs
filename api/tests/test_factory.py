from collections.abc import Iterator

import pytest

from app.config import Settings, get_settings
from app.llm.factory import ProviderConfigError, build_provider, get_provider
from app.llm.providers.anthropic_provider import AnthropicProvider
from app.llm.providers.openrouter_provider import OpenRouterProvider


@pytest.fixture
def clear_caches() -> Iterator[None]:
    get_settings.cache_clear()
    get_provider.cache_clear()
    yield
    get_settings.cache_clear()
    get_provider.cache_clear()


def test_builds_anthropic_provider() -> None:
    settings = Settings(_env_file=None, llm_provider="anthropic", anthropic_api_key="sk-ant-test")

    provider = build_provider(settings)

    assert isinstance(provider, AnthropicProvider)
    assert provider.name == "anthropic"


def test_builds_openrouter_provider() -> None:
    settings = Settings(_env_file=None, llm_provider="openrouter", openrouter_api_key="sk-or-test")

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
