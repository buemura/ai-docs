from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.llm.catalog import get_model

ProviderName = Literal["anthropic", "openrouter"]
Effort = Literal["low", "medium", "high"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

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
