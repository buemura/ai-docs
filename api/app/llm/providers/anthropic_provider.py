from collections.abc import AsyncIterator
from typing import Any

import anthropic
from anthropic import AsyncAnthropic

from app.config import Effort
from app.llm.types import CompletionRequest, ProviderError, StreamDone, StreamEvent, TextDelta

# Logical catalog ID -> Anthropic model ID.
MODEL_IDS: dict[str, str] = {
    "claude-sonnet-5-5": "claude-sonnet-5-5",
    "claude-haiku-5-5": "claude-haiku-5-5",
}

# Server-side refusal fallback is available for Sonnet 5.5, not for Haiku 5.5.
SERVER_FALLBACK_MODELS = frozenset({"claude-sonnet-5-5"})
SERVER_FALLBACK_BETA = "server-side-fallback-2026-07-01"


class AnthropicProvider:
    name = "anthropic"

    def __init__(
        self,
        *,
        api_key: str | None = None,
        effort: Effort = "low",
        client: Any | None = None,
    ) -> None:
        self._client = client if client is not None else AsyncAnthropic(api_key=api_key)
        self._effort = effort

    def _params(self, request: CompletionRequest) -> dict[str, Any]:
        model_id = MODEL_IDS.get(request.model)
        if model_id is None:
            raise ProviderError("bad_request", f"Unknown model: {request.model}")

        params: dict[str, Any] = {
            "model": model_id,
            "max_tokens": request.max_tokens,
            "system": request.system,
            "messages": [
                {"role": message.role, "content": message.content} for message in request.messages
            ],
            "output_config": {"effort": self._effort},
        }
        if request.model in SERVER_FALLBACK_MODELS:
            params["betas"] = [SERVER_FALLBACK_BETA]
            params["fallbacks"] = "default"
        return params

    async def stream(self, request: CompletionRequest) -> AsyncIterator[StreamEvent]:
        params = self._params(request)
        try:
            async with self._client.beta.messages.stream(**params) as stream:
                async for text in stream.text_stream:
                    yield TextDelta(text)
                final = await stream.get_final_message()
        except (anthropic.AuthenticationError, anthropic.PermissionDeniedError) as exc:
            raise ProviderError("auth_error", "The AI provider rejected the API key.") from exc
        except anthropic.RateLimitError as exc:
            raise ProviderError(
                "rate_limited",
                "The AI provider is rate limiting requests. Try again shortly.",
            ) from exc
        except anthropic.BadRequestError as exc:
            raise ProviderError("bad_request", "The AI provider rejected the request.") from exc
        except anthropic.APIStatusError as exc:
            raise ProviderError(
                "provider_unavailable",
                "The AI provider is unavailable. Try again later.",
            ) from exc
        except anthropic.APIConnectionError as exc:
            raise ProviderError("provider_unavailable", "Could not reach the AI provider.") from exc

        if final.stop_reason == "refusal":
            raise ProviderError(
                "refused",
                "The model declined this request. Try rephrasing the instruction.",
            )
        yield StreamDone(stop_reason=final.stop_reason or "end_turn")
