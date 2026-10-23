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
        FakeProvider(["Hel"], error=ProviderError("rate_limited", "Slow down"), error_after=1),
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
