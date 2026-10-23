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
