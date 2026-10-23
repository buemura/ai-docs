import json
from collections.abc import AsyncIterator
from typing import Any

import httpx

from app.llm.types import CompletionRequest, ProviderError, StreamDone, StreamEvent, TextDelta

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

# Logical catalog ID -> OpenRouter slug (checked against https://openrouter.ai/api/v1/models).
MODEL_SLUGS: dict[str, str] = {
    "claude-sonnet-5-5": "anthropic/claude-sonnet-5.5",
    "claude-haiku-5-5": "anthropic/claude-haiku-5.5",
}

# OpenAI-style finish_reason -> Anthropic-style stop_reason used in `done` events.
FINISH_REASONS: dict[str, str] = {
    "stop": "end_turn",
    "length": "max_tokens",
    "content_filter": "refusal",
    "tool_calls": "tool_use",
}


def _error_for_status(status: int | None, message: str | None = None) -> ProviderError:
    if status in (401, 403):
        return ProviderError("auth_error", message or "The AI provider rejected the API key.")
    if status == 429:
        return ProviderError(
            "rate_limited",
            message or "The AI provider is rate limiting requests. Try again shortly.",
        )
    if status == 400:
        return ProviderError("bad_request", message or "The AI provider rejected the request.")
    return ProviderError(
        "provider_unavailable",
        message or "The AI provider is unavailable. Try again later.",
    )


def _sse_data(line: str) -> str | None:
    """Return the payload of a `data:` line; None for comments, blanks, other fields."""
    if not line.startswith("data:"):
        return None
    return line[len("data:") :].strip()


def _decode_chunk(data: str) -> dict[str, Any]:
    try:
        return json.loads(data)
    except json.JSONDecodeError as exc:
        raise ProviderError(
            "provider_unavailable", "The AI provider sent a malformed response."
        ) from exc


class OpenRouterProvider:
    name = "openrouter"

    def __init__(self, *, api_key: str, client: httpx.AsyncClient | None = None) -> None:
        self._api_key = api_key
        self._client = client or httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0))

    async def stream(self, request: CompletionRequest) -> AsyncIterator[StreamEvent]:
        slug = MODEL_SLUGS.get(request.model)
        if slug is None:
            raise ProviderError("bad_request", f"Unknown model: {request.model}")

        payload = {
            "model": slug,
            "stream": True,
            "max_tokens": request.max_tokens,
            "messages": [
                {"role": "system", "content": request.system},
                *({"role": m.role, "content": m.content} for m in request.messages),
            ],
        }
        headers = {"Authorization": f"Bearer {self._api_key}", "X-Title": "AI Docs"}

        stop_reason = "end_turn"
        try:
            async with self._client.stream(
                "POST", OPENROUTER_URL, json=payload, headers=headers
            ) as response:
                if response.status_code != 200:
                    await response.aread()
                    raise _error_for_status(response.status_code)

                async for line in response.aiter_lines():
                    data = _sse_data(line)
                    if data is None:
                        continue
                    if data == "[DONE]":
                        break
                    chunk = _decode_chunk(data)
                    if "error" in chunk:
                        error = chunk["error"] or {}
                        code = error.get("code")
                        raise _error_for_status(
                            code if isinstance(code, int) else None,
                            error.get("message"),
                        )
                    for choice in chunk.get("choices") or []:
                        text = (choice.get("delta") or {}).get("content")
                        if text:
                            yield TextDelta(text)
                        finish = choice.get("finish_reason")
                        if finish:
                            stop_reason = FINISH_REASONS.get(finish, finish)
        except httpx.HTTPError as exc:
            raise ProviderError("provider_unavailable", "Could not reach the AI provider.") from exc

        if stop_reason == "refusal":
            raise ProviderError(
                "refused",
                "The model declined this request. Try rephrasing the instruction.",
            )
        yield StreamDone(stop_reason=stop_reason)
