import pytest
from pydantic import ValidationError

from app.suggestions.schemas import (
    MAX_DOCUMENT_CHARS,
    MAX_HISTORY_TURNS,
    MAX_INSTRUCTION_CHARS,
    SuggestionRequest,
)
from app.suggestions.utf16 import utf16_len, utf16_slice


def make(**overrides: object) -> SuggestionRequest:
    data: dict[str, object] = {
        "model": "claude-sonnet-5-5",
        "document": "Hello world",
        "instruction": "Make it shorter",
    }
    data.update(overrides)
    return SuggestionRequest.model_validate(data)


class TestUtf16:
    def test_len_counts_surrogate_pairs_as_two_units(self) -> None:
        assert utf16_len("a😀b") == 4

    def test_slice_uses_utf16_offsets(self) -> None:
        assert utf16_slice("a😀b", 1, 3) == "😀"
        assert utf16_slice("a😀b", 3, 4) == "b"

    def test_slice_rejects_split_surrogate_pair(self) -> None:
        with pytest.raises(ValueError):
            utf16_slice("a😀b", 1, 2)


class TestSuggestionRequest:
    def test_accepts_minimal_request(self) -> None:
        request = make()

        assert request.selection is None
        assert request.history == []

    def test_strips_instruction(self) -> None:
        assert make(instruction="  Fix tone \n").instruction == "Fix tone"

    @pytest.mark.parametrize("instruction", ["", "   \n"])
    def test_rejects_blank_instruction(self, instruction: str) -> None:
        with pytest.raises(ValidationError, match="instruction must not be empty"):
            make(instruction=instruction)

    def test_rejects_too_long_instruction(self) -> None:
        with pytest.raises(ValidationError):
            make(instruction="x" * (MAX_INSTRUCTION_CHARS + 1))

    def test_accepts_instruction_at_limit_after_strip(self) -> None:
        request = make(instruction=" " + "x" * MAX_INSTRUCTION_CHARS + " ")

        assert len(request.instruction) == MAX_INSTRUCTION_CHARS

    def test_rejects_too_long_document(self) -> None:
        with pytest.raises(ValidationError):
            make(document="x" * (MAX_DOCUMENT_CHARS + 1))

    def test_accepts_valid_selection(self) -> None:
        request = make(selection={"start": 6, "end": 11})

        assert request.selection is not None
        assert (request.selection.start, request.selection.end) == (6, 11)

    @pytest.mark.parametrize(
        "selection",
        [{"start": 3, "end": 3}, {"start": 5, "end": 2}, {"start": -1, "end": 2}],
    )
    def test_rejects_invalid_selection_bounds(self, selection: dict[str, int]) -> None:
        with pytest.raises(ValidationError):
            make(selection=selection)

    def test_selection_end_is_measured_in_utf16_units(self) -> None:
        # "😀" is one Python char but two UTF-16 code units.
        assert make(document="😀", selection={"start": 0, "end": 2}).selection

        with pytest.raises(ValidationError, match="selection is out of range"):
            make(document="😀", selection={"start": 0, "end": 3})

    def test_rejects_selection_splitting_a_character(self) -> None:
        with pytest.raises(ValidationError, match="splits a character"):
            make(document="a😀b", selection={"start": 1, "end": 2})

    def test_accepts_history_up_to_limit(self) -> None:
        turn = {"instruction": "Shorter", "proposal": "Hi"}

        assert len(make(history=[turn] * MAX_HISTORY_TURNS).history) == 10

    def test_rejects_history_over_limit(self) -> None:
        turn = {"instruction": "Shorter", "proposal": "Hi"}

        with pytest.raises(ValidationError):
            make(history=[turn] * (MAX_HISTORY_TURNS + 1))

    def test_rejects_empty_history_proposal(self) -> None:
        with pytest.raises(ValidationError):
            make(history=[{"instruction": "Shorter", "proposal": ""}])
