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
    return httpx.Response(status, headers={"content-type": "text/event-stream"}, content=body)


def make_provider(
    handler: Callable[[httpx.Request], httpx.Response],
) -> OpenRouterProvider:
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return OpenRouterProvider(api_key="sk-or-test", client=client)


async def collect(provider: OpenRouterProvider, request: CompletionRequest) -> list[StreamEvent]:
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
