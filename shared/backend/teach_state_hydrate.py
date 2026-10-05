"""Rebuild Teach client_state from writing_feedback and corrector chat logs.

Ops/manual restore only. Not called on the live GET /api/teach/state path:
auto-marking log answers as passed would rewrite study data on login.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, List, Optional, Tuple

from .progress_manager import TEACH_SOURCE, progress_manager
from .utils import read_chat_history_log

logger = logging.getLogger(__name__)

_ENTRY_RE = re.compile(
    r"^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) ([A-Z]+)\] \(([^)]+)\): ?(.*)$"
)
_WEEK_ID_RE = re.compile(r"^(week\d+)-", re.I)
_OPEN_ENDED_PREFIX = "teach_open_ended_response::"
_KNOWN_SECTION_WEEKS = {
    "what-about-now": "week1",
}


def week_id_for_section(section_id: str) -> str:
    raw = str(section_id or "").strip()
    match = _WEEK_ID_RE.match(raw)
    if match:
        return match.group(1).lower()
    return _KNOWN_SECTION_WEEKS.get(raw, "week1")


def _draft_keys_for_section(section_id: str) -> List[str]:
    return [
        f"teach-before-reading-{section_id}",
        f"teach-pick-explain-why-{section_id}",
        f"teach-blank-{section_id}-0",
        f"{section_id}::0",
    ]


def _client_state_needs_hydrate(state: Optional[Dict[str, Any]]) -> bool:
    if not isinstance(state, dict):
        return True
    if state.get("cleared") is True:
        return False
    statuses = state.get("exerciseStatusByWeek")
    if isinstance(statuses, dict):
        for bucket in statuses.values():
            if isinstance(bucket, dict) and bucket:
                return False
    drafts = state.get("exerciseDraftsByWeek")
    if isinstance(drafts, dict):
        for bucket in drafts.values():
            if isinstance(bucket, dict) and any(str(text or "").strip() for text in bucket.values()):
                return False
    steps = state.get("stepProgressByWeek")
    if isinstance(steps, dict):
        for value in steps.values():
            try:
                if int(value) > 1:
                    return False
            except (TypeError, ValueError):
                continue
    return True


def _parse_chat_log_entries(text: str) -> List[Tuple[str, str]]:
    entries: List[Tuple[str, str]] = []
    current_role = ""
    current_content: Optional[str] = None
    for line in str(text or "").splitlines():
        match = _ENTRY_RE.match(line)
        if match:
            if current_content is not None:
                entries.append((current_role, current_content))
            current_role = match.group(3)
            current_content = match.group(4)
        elif current_content is not None:
            current_content += "\n" + line
    if current_content is not None:
        entries.append((current_role, current_content))
    return entries


def _record_response(
    found: Dict[str, Dict[str, str]],
    *,
    section_id: str,
    week_id: str,
    response_text: str,
) -> None:
    section = str(section_id or "").strip()
    text = str(response_text or "").strip()
    if not section or not text:
        return
    week = str(week_id or "").strip() or week_id_for_section(section)
    found.setdefault(week, {})[section] = text


def collect_section_responses(participant_code: str) -> Dict[str, Dict[str, str]]:
    """Return week_id -> section_id -> last response text."""
    found: Dict[str, Dict[str, str]] = {}
    progress = progress_manager.get_participant_progress(
        participant_code, source=TEACH_SOURCE
    )
    for entry in progress.get("writing_feedback") or []:
        if not isinstance(entry, dict):
            continue
        section_id = str(entry.get("section_id") or "").strip()
        if not section_id:
            feedback = str(entry.get("feedback") or "")
            if feedback.startswith(_OPEN_ENDED_PREFIX):
                section_id = feedback.split("::", 1)[1].strip()
        _record_response(
            found,
            section_id=section_id,
            week_id=str(entry.get("week_id") or ""),
            response_text=str(entry.get("query") or ""),
        )

    log_text = read_chat_history_log(participant_code, source=TEACH_SOURCE)
    if not log_text:
        return found

    for role, content in _parse_chat_log_entries(log_text):
        if role != "teach_corrector_output":
            continue
        try:
            payload = json.loads(content)
        except (TypeError, json.JSONDecodeError):
            continue
        if not isinstance(payload, dict):
            continue
        _record_response(
            found,
            section_id=str(payload.get("section_id") or ""),
            week_id=str(payload.get("week_id") or ""),
            response_text=str(payload.get("response_text") or ""),
        )
    return found


def hydrate_client_state(
    participant_code: str,
    state: Optional[Dict[str, Any]],
) -> Tuple[Dict[str, Any], bool]:
    """Fill missing exercise status / drafts from logs. Never reduces stored progress."""
    hydrated: Dict[str, Any] = dict(state) if isinstance(state, dict) else {}
    if not _client_state_needs_hydrate(hydrated):
        return hydrated, False
    found = collect_section_responses(participant_code)
    if not found:
        return hydrated, False

    statuses = hydrated.get("exerciseStatusByWeek")
    if not isinstance(statuses, dict):
        statuses = {}
        hydrated["exerciseStatusByWeek"] = statuses
    drafts = hydrated.get("exerciseDraftsByWeek")
    if not isinstance(drafts, dict):
        drafts = {}
        hydrated["exerciseDraftsByWeek"] = drafts

    changed = False
    for week_id, sections in found.items():
        week_status = statuses.get(week_id)
        if not isinstance(week_status, dict):
            week_status = {}
            statuses[week_id] = week_status
        week_drafts = drafts.get(week_id)
        if not isinstance(week_drafts, dict):
            week_drafts = {}
            drafts[week_id] = week_drafts

        for section_id, response in sections.items():
            if section_id not in week_status:
                week_status[section_id] = {
                    "status": "passed",
                    "passed": True,
                    "source": "log_hydrate",
                    "updatedAt": 0,
                }
                changed = True
            for draft_key in _draft_keys_for_section(section_id):
                if not str(week_drafts.get(draft_key) or "").strip():
                    week_drafts[draft_key] = response
                    changed = True

    if changed and not str(hydrated.get("currentWeekId") or "").strip():
        hydrated["currentWeekId"] = next(iter(found))

    return hydrated, changed
