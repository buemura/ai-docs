from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.llm.factory import get_provider
from app.main import create_app
from tests.fakes import FakeProvider


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


@pytest.fixture
def fake_provider() -> FakeProvider:
    return FakeProvider()


@pytest.fixture
def test_settings() -> Settings:
    return Settings(_env_file=None)


@pytest.fixture
def api_client(fake_provider: FakeProvider, test_settings: Settings) -> Iterator[TestClient]:
    app = create_app(test_settings)
    app.dependency_overrides[get_provider] = lambda: fake_provider
    app.dependency_overrides[get_settings] = lambda: test_settings
    with TestClient(app) as client:
        yield client
