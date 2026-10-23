from collections.abc import AsyncIterator
from typing import Protocol

from app.llm.types import CompletionRequest, StreamEvent


class LLMProvider(Protocol):
    """Strategy interface for LLM backends.

    `stream` yields zero or more TextDelta events followed by exactly one
    StreamDone, or raises ProviderError.
    """

    name: str

    def stream(self, request: CompletionRequest) -> AsyncIterator[StreamEvent]: ...
