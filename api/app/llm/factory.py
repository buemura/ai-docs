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
            raise ProviderConfigError("ANTHROPIC_API_KEY must be set when LLM_PROVIDER=anthropic")
        return AnthropicProvider(api_key=settings.anthropic_api_key, effort=settings.llm_effort)

    if settings.llm_provider == "openrouter":
        if not settings.openrouter_api_key:
            raise ProviderConfigError("OPENROUTER_API_KEY must be set when LLM_PROVIDER=openrouter")
        return OpenRouterProvider(api_key=settings.openrouter_api_key)

    raise ProviderConfigError(f"Unsupported LLM_PROVIDER: {settings.llm_provider}")


@lru_cache
def get_provider() -> LLMProvider:
    """FastAPI dependency: one provider instance per process."""
    return build_provider(get_settings())
