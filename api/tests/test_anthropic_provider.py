from types import SimpleNamespace
from typing import Any

import anthropic
import httpx
import pytest

from app.llm.providers.anthropic_provider import SERVER_FALLBACK_BETA, AnthropicProvider
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


async def collect(provider: AnthropicProvider, request: CompletionRequest) -> list[StreamEvent]:
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
