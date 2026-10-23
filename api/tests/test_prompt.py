from app.suggestions.prompt import (
    SYSTEM_PROMPT,
    build_completion_request,
    utf16_slice,
)
from app.suggestions.schemas import SuggestionRequest


def make(**overrides: object) -> SuggestionRequest:
    data: dict[str, object] = {
        "model": "claude-haiku-5-5",
        "document": "# Doc\n\nHello world!\n",
        "instruction": "Fix it",
    }
    data.update(overrides)
    return SuggestionRequest.model_validate(data)


def test_reexports_utf16_slice() -> None:
    assert utf16_slice("a😀b", 1, 3) == "😀"


def test_system_prompt_demands_only_the_rewritten_text() -> None:
    lowered = SYSTEM_PROMPT.lower()

    assert "only" in lowered
    assert "code fence" in lowered
    assert "markdown" in lowered


def test_passes_model_system_and_max_tokens_through() -> None:
    completion = build_completion_request(make(), max_tokens=1234)

    assert completion.model == "claude-haiku-5-5"
    assert completion.system == SYSTEM_PROMPT
    assert completion.max_tokens == 1234


def test_whole_document_prompt() -> None:
    completion = build_completion_request(make(), max_tokens=100)

    assert [m.role for m in completion.messages] == ["user"]
    content = completion.messages[0].content
    assert "<document>\n# Doc\n\nHello world!\n\n</document>" in content
    assert "<instruction>\nFix it\n</instruction>" in content
    assert "Rewrite the whole document" in content
    assert "<target>" not in content
    assert "<target_text>" not in content


def test_selection_prompt_marks_target_inline_and_repeats_it() -> None:
    # "world" starts at UTF-16 offset 13 in "# Doc\n\nHello world!\n".
    completion = build_completion_request(make(selection={"start": 13, "end": 18}), max_tokens=100)

    content = completion.messages[0].content
    assert "Hello <target>world</target>!" in content
    assert "<target_text>\nworld\n</target_text>" in content
    assert "<instruction>\nFix it\n</instruction>" in content
    assert "Rewrite only the text inside <target>" in content


def test_selection_offsets_are_utf16() -> None:
    completion = build_completion_request(
        make(document="Hi 😀 there", selection={"start": 3, "end": 5}),
        max_tokens=100,
    )

    assert "Hi <target>😀</target> there" in completion.messages[0].content


def test_refine_history_builds_alternating_turns() -> None:
    request = make(
        instruction="Even shorter",
        history=[
            {"instruction": "Rewrite formally", "proposal": "Greetings."},
            {"instruction": "Shorter", "proposal": "Hi."},
        ],
    )

    completion = build_completion_request(request, max_tokens=100)

    messages = completion.messages
    assert [m.role for m in messages] == [
        "user",
        "assistant",
        "user",
        "assistant",
        "user",
    ]
    assert "<instruction>\nRewrite formally\n</instruction>" in messages[0].content
    assert messages[1].content == "Greetings."
    assert messages[2].content == "Refine your previous rewrite: Shorter"
    assert messages[3].content == "Hi."
    assert messages[4].content == "Refine your previous rewrite: Even shorter"
