from app.llm.types import ChatMessage, CompletionRequest
from app.suggestions.schemas import Selection, SuggestionRequest
from app.suggestions.utf16 import utf16_len, utf16_slice

__all__ = ["SYSTEM_PROMPT", "build_completion_request", "utf16_slice"]

SYSTEM_PROMPT = """\
You are a co-author helping the user edit a Markdown document. The user stays \
in control: you propose a rewrite, and they review it as a diff before \
accepting any change.

Output only the rewritten target text, exactly as it should appear in the \
document. Do not add a preamble, an explanation, a summary of your changes, \
or a code fence around the output.

Make the smallest changes that satisfy the instruction. Keep everything the \
instruction does not ask you to change verbatim, including Markdown syntax \
(headings, lists, links, emphasis, code blocks), line breaks, and whether the \
text ends with a trailing newline."""

REFINE_PREFIX = "Refine your previous rewrite: "


def _first_user_message(document: str, selection: Selection | None, instruction: str) -> str:
    if selection is None:
        return (
            f"<document>\n{document}\n</document>\n\n"
            f"<instruction>\n{instruction}\n</instruction>\n\n"
            "Rewrite the whole document according to the instruction. "
            "Output only the rewritten document."
        )

    before = utf16_slice(document, 0, selection.start)
    target = utf16_slice(document, selection.start, selection.end)
    after = utf16_slice(document, selection.end, utf16_len(document))
    return (
        f"<document>\n{before}<target>{target}</target>{after}\n</document>\n\n"
        f"<target_text>\n{target}\n</target_text>\n\n"
        f"<instruction>\n{instruction}\n</instruction>\n\n"
        "Rewrite only the text inside <target> according to the instruction. "
        "The rest of the document is context; do not include it in your output. "
        "Output only the rewritten target text."
    )


def build_completion_request(req: SuggestionRequest, max_tokens: int) -> CompletionRequest:
    instructions = [turn.instruction for turn in req.history] + [req.instruction]
    messages = [
        ChatMessage(
            role="user",
            content=_first_user_message(req.document, req.selection, instructions[0]),
        )
    ]
    for turn, next_instruction in zip(req.history, instructions[1:], strict=True):
        messages.append(ChatMessage(role="assistant", content=turn.proposal))
        messages.append(ChatMessage(role="user", content=f"{REFINE_PREFIX}{next_instruction}"))

    return CompletionRequest(
        model=req.model,
        system=SYSTEM_PROMPT,
        messages=messages,
        max_tokens=max_tokens,
    )
