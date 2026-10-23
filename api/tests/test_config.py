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
