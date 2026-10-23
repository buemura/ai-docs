import asyncio
import logging
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.config import Settings, get_settings
from app.llm.base import LLMProvider
from app.llm.catalog import get_model
from app.llm.factory import get_provider
from app.llm.types import CompletionRequest, ProviderError, TextDelta
from app.suggestions.prompt import build_completion_request
from app.suggestions.schemas import SuggestionRequest
from app.suggestions.sse import format_sse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["suggestions"])

SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


@router.post("/suggestions")
async def create_suggestion(
    body: SuggestionRequest,
    provider: Annotated[LLMProvider, Depends(get_provider)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> StreamingResponse:
    if get_model(body.model) is None:
        raise HTTPException(status_code=422, detail=f"Unknown model: {body.model}")

    completion = build_completion_request(body, max_tokens=settings.llm_max_tokens)
    return StreamingResponse(
        _event_stream(provider, completion),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )


async def _event_stream(provider: LLMProvider, completion: CompletionRequest) -> AsyncIterator[str]:
    events = provider.stream(completion)
    try:
        async for event in events:
            if isinstance(event, TextDelta):
                yield format_sse("delta", {"text": event.text})
            else:
                yield format_sse("done", {"stop_reason": event.stop_reason})
                return
        yield format_sse(
            "error",
            {
                "code": "internal_error",
                "message": "The AI provider ended the stream unexpectedly.",
            },
        )
    except ProviderError as exc:
        yield format_sse("error", {"code": exc.code, "message": exc.message})
    except asyncio.CancelledError:
        # Starlette cancels the response task when the client disconnects.
        logger.info("Client disconnected; suggestion stream cancelled")
        raise
    except Exception:
        logger.exception("Unexpected error while streaming suggestion")
        yield format_sse(
            "error",
            {
                "code": "internal_error",
                "message": "Something went wrong while generating the suggestion.",
            },
        )
    finally:
        # Close the provider stream (and its HTTP connection) on every exit path.
        aclose = getattr(events, "aclose", None)
        if aclose is not None:
            await aclose()
