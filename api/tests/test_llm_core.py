from app.llm.catalog import MODELS, get_model
from app.llm.types import (
    ChatMessage,
    CompletionRequest,
    ModelInfo,
    ProviderError,
    StreamDone,
    TextDelta,
)


def test_catalog_lists_sonnet_first_then_haiku() -> None:
    expected = (
        ModelInfo(id="claude-sonnet-5-5", label="Claude Sonnet 5.5"),
        ModelInfo(id="claude-haiku-5-5", label="Claude Haiku 5.5"),
    )

    assert expected == MODELS


def test_get_model_returns_info_for_known_id() -> None:
    expected = ModelInfo(id="claude-haiku-5-5", label="Claude Haiku 5.5")

    assert get_model("claude-haiku-5-5") == expected


def test_get_model_returns_none_for_unknown_id() -> None:
    assert get_model("gpt-4o") is None


def test_provider_error_carries_code_and_message() -> None:
    error = ProviderError("rate_limited", "Slow down")

    assert error.code == "rate_limited"
    assert error.message == "Slow down"
    assert str(error) == "Slow down"


def test_stream_events_compare_by_value() -> None:
    assert TextDelta("hi") == TextDelta("hi")
    assert StreamDone("end_turn") == StreamDone("end_turn")


def test_completion_request_holds_messages() -> None:
    request = CompletionRequest(
        model="claude-sonnet-5-5",
        system="sys",
        messages=[ChatMessage(role="user", content="hello")],
        max_tokens=10,
    )

    assert request.messages[0].role == "user"
    assert request.messages[0].content == "hello"
