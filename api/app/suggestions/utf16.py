"""Helpers for offsets measured in UTF-16 code units (what JavaScript strings use)."""


def utf16_len(text: str) -> int:
    return len(text.encode("utf-16-le")) // 2


def utf16_slice(text: str, start: int, end: int) -> str:
    """Slice `text` by UTF-16 code-unit offsets.

    Raises ValueError when a boundary falls inside a surrogate pair.
    """
    encoded = text.encode("utf-16-le")
    try:
        return encoded[start * 2 : end * 2].decode("utf-16-le")
    except UnicodeDecodeError as exc:
        raise ValueError("selection splits a character") from exc
