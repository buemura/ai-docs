from collections.abc import AsyncIterator, Sequence

from app.llm.types import CompletionRequest, StreamDone, StreamEvent, TextDelta


class FakeProvider:
    """Scripted LLMProvider for tests: yields `chunks`, optionally raising `error`
    after `error_after` chunks, and records every request it receives."""

    name = "fake"

    def __init__(
        self,
        chunks: Sequence[str] = ("Hello", " world"),
        *,
        stop_reason: str = "end_turn",
        error: Exception | None = None,
        error_after: int = 0,
    ) -> None:
        self._chunks = list(chunks)
        self._stop_reason = stop_reason
        self._error = error
        self._error_after = error_after
        self.requests: list[CompletionRequest] = []

    @property
    def last_request(self) -> CompletionRequest | None:
        return self.requests[-1] if self.requests else None

    async def stream(self, request: CompletionRequest) -> AsyncIterator[StreamEvent]:
        self.requests.append(request)
        for index, chunk in enumerate(self._chunks):
            if self._error is not None and index == self._error_after:
                raise self._error
            yield TextDelta(chunk)
        if self._error is not None:
            raise self._error
        yield StreamDone(self._stop_reason)
