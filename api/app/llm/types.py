from dataclasses import dataclass
from typing import Literal

Role = Literal["user", "assistant"]

ErrorCode = Literal[
    "auth_error",
    "rate_limited",
    "provider_unavailable",
    "refused",
    "bad_request",
    "internal_error",
]


@dataclass(frozen=True)
class ChatMessage:
    role: Role
    content: str


@dataclass(frozen=True)
class CompletionRequest:
    model: str
    system: str
    messages: list[ChatMessage]
    max_tokens: int


@dataclass(frozen=True)
class TextDelta:
    text: str


@dataclass(frozen=True)
class StreamDone:
    stop_reason: str


StreamEvent = TextDelta | StreamDone


class ProviderError(Exception):
    """A provider failure that is safe to show to the user."""

    def __init__(self, code: ErrorCode, message: str) -> None:
        super().__init__(message)
        self.code: ErrorCode = code
        self.message = message


@dataclass(frozen=True)
class ModelInfo:
    id: str
    label: str
