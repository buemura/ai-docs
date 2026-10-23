import json

from app.suggestions.sse import format_sse


def test_formats_event_and_compact_json_data() -> None:
    assert format_sse("done", {"stop_reason": "end_turn"}) == (
        'event: done\ndata: {"stop_reason":"end_turn"}\n\n'
    )


def test_newlines_in_text_stay_on_one_data_line() -> None:
    frame = format_sse("delta", {"text": "line 1\nline 2"})

    lines = frame.split("\n")
    assert lines[0] == "event: delta"
    assert lines[1].startswith("data: ")
    assert json.loads(lines[1][len("data: ") :]) == {"text": "line 1\nline 2"}
    assert frame.endswith("\n\n")
    assert frame.count("\n") == 3


def test_keeps_non_ascii_text_readable() -> None:
    assert "😀" in format_sse("delta", {"text": "😀"})
