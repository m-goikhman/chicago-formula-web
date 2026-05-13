"""
CEFR self-rating band from Reading / Speaking / Writing multi-select blocks.

Scoring rules are documented in ``shared/backend/docs/cefr_self_rating_scoring.md``.
"""

from __future__ import annotations

from typing import Iterable, Literal

CefrBand = Literal["B1", "B2"]

CEF_SKILL_KEYS = ("cef_reading", "cef_speaking", "cef_writing")


def score_cef_block(selected_indices: Iterable[int]) -> int:
    """
    One block: two checkboxes (index 0 = first statement, 1 = second).

    - Only first selected -> 0 points
    - Only second, or both selected -> 1 point
    """
    s = {int(x) for x in selected_indices}
    if s == {0}:
        return 0
    if s == {1} or s == {0, 1}:
        return 1
    raise ValueError("CEFR block must use indices 0 and/or 1 with at least one selection")


def derive_cefr_band(answers: dict) -> CefrBand:
    """
    Sum scores over cef_reading, cef_speaking, cef_writing.

    Total 0-1 -> B1; total >= 2 -> B2 (see docs).
    """
    total = 0
    for key in CEF_SKILL_KEYS:
        if key not in answers:
            raise ValueError(f"Missing answer for {key}")
        raw = answers[key]
        if not isinstance(raw, (list, tuple)):
            raise ValueError(f"{key} must be a list of selected indices")
        if len(raw) == 0:
            raise ValueError(f"{key} requires at least one option")
        total += score_cef_block(raw)
    return "B1" if total <= 1 else "B2"
