from typing import Self

from pydantic import BaseModel, Field, field_validator, model_validator

from app.suggestions.utf16 import utf16_len, utf16_slice

MAX_DOCUMENT_CHARS = 200_000
MAX_INSTRUCTION_CHARS = 2_000
MAX_HISTORY_TURNS = 10


class Selection(BaseModel):
    start: int = Field(ge=0)
    end: int = Field(ge=0)

    @model_validator(mode="after")
    def _start_before_end(self) -> Self:
        if self.start >= self.end:
            raise ValueError("selection.start must be less than selection.end")
        return self


class RefineTurn(BaseModel):
    instruction: str = Field(min_length=1, max_length=MAX_INSTRUCTION_CHARS)
    proposal: str = Field(min_length=1, max_length=MAX_DOCUMENT_CHARS)


class SuggestionRequest(BaseModel):
    model: str = Field(min_length=1)
    document: str = Field(max_length=MAX_DOCUMENT_CHARS)
    selection: Selection | None = None
    instruction: str
    history: list[RefineTurn] = Field(default_factory=list, max_length=MAX_HISTORY_TURNS)

    @field_validator("instruction")
    @classmethod
    def _clean_instruction(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("instruction must not be empty")
        if len(value) > MAX_INSTRUCTION_CHARS:
            raise ValueError(f"instruction must be at most {MAX_INSTRUCTION_CHARS} characters")
        return value

    @model_validator(mode="after")
    def _selection_within_document(self) -> Self:
        if self.selection is None:
            return self
        if self.selection.end > utf16_len(self.document):
            raise ValueError("selection is out of range")
        # Raises ValueError("selection splits a character") on a bad boundary.
        utf16_slice(self.document, 0, self.selection.start)
        utf16_slice(self.document, self.selection.start, self.selection.end)
        return self
