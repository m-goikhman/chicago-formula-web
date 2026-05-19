"""
Game handlers for the web version, adapted from Telegram bot handlers.
"""

import logging
import json
import time
import random
import os
import re
from typing import Dict, List, Optional, Set, Tuple
from datetime import datetime, timedelta
from urllib.parse import urlencode

from . import bootstrap  # noqa: F401

from .utils import load_system_prompt, combine_character_prompt, get_prompt_path, get_game_text_path, save_message_to_cache, log_message
from .game_config import GAME_STATE, CHARACTER_DATA, TOTAL_CLUES, TOTAL_STAGES, STAGE_UNLOCK_DELAY_DAYS, STAGE_CONFIG, user_histories
from .game_state_manager import game_state_manager
from .progress_manager import progress_manager, TELL_SOURCE
from .auth import is_test_mode_participant
from .ai_services import ask_for_dialogue
from .scripted_messages import (
    extract_buttons_from_text as _sm_extract_buttons_from_text,
    split_text_messages as _sm_split_text_messages,
    extract_scripted_message_blocks as _sm_extract_scripted_message_blocks,
    resolve_character_sender_key as _sm_resolve_character_sender_key,
    extract_sender_from_text as _sm_extract_sender_from_text,
    parse_inline_button_action as _sm_parse_inline_button_action,
)
import pytz

logger = logging.getLogger(__name__)

EP2_DEFAULT_LOCATION = "default_ep2"
EP2_SCRIPTED_LOCATIONS = {"university_ep2", "hospital_ep2"}
EP2_LOCATION_ACTIONS = {
    "go_default_ep2": "default_ep2",
    "go_university_ep2": "university_ep2",
    "go_hospital_ep2": "hospital_ep2",
}
EP2_USB_SHARE_ACTION = "share_usb_with_james"
EP2_USB_SHARE_BUTTON_TEXT = "Show the USB to James"
EP2_USB_SHARE_BUTTON_NOTE = "(you need to let James know what's on the drive)"
EP2_JAMES_USB_QUESTION = "What's on the drive, and how can I help?"
EP2_USB_EXPLANATION_FALLBACK = "Give James a short explanation in English about the files on the drive."
EP1_PART1_LOCATION = "part1_ep1"
EP1_PART2_LOCATION = "part2_ep1"
EP1_PRIVATE_MIN_TURNS_WITH_TWO_CHARACTERS = 10
EP1_PRIVATE_MIN_TURNS_ANY = 12
TEST_EP1_PAULINE_COMMANDS = {"/pauline", "/skip_to_pauline", "/test_pauline"}
EP1_PART2_TRIGGER_ACTIONS = {"pauline_entrance_doorway", "pauline_entrance_doorway.txt"}
PUBLIC_FOLLOWUP_LOCK_TURNS = 1

# EP1 final accusation mechanic
EP1_ACCUSATION_SUSPECT_KEYS = ["tim", "ronnie", "fiona", "pauline"]
EP1_ACCUSATION_CORRECT_KEY = "tim"
EP1_ACCUSATION_MAX_ATTEMPTS_AFTER_PAULINE = 2
EP1_ACCUSATION_MAX_ATTEMPTS_BEFORE_PAULINE = 1
EP1_ACCUSATION_REASON_MIN_WORDS = 4
# Extra beat after Nina's lose-hint, before Tim's finale (only that branch; see `preDisplayDelayMs` in Tell/frontend/js/game.js).
EP1_NINA_LOSE_HINT_TO_TIM_FINALE_PRE_DELAY_MS = 4000
WEEKLY_QUESTIONNAIRE_TEMPLATE_LINK = "{{QUESTIONNAIRE_LINK}}"
NEXT_EPISODE_CALENDAR_TEMPLATE_LINK = "{{NEXT_EPISODE_CALENDAR_LINK}}"
WEEKLY_QUESTIONNAIRE_FALLBACK_STATIC_LINK = "https://forms.gle/hWc2Uedw8KkdCLhv6"
WEEKLY_QUESTIONNAIRE_FORM_VIEW_URL = (
    "https://docs.google.com/forms/d/e/"
    "1FAIpQLSf7wqiYQXAQZLF3I_lbItkm2iAG8ro6aYUhkj8z7bHt_Pj0WQ/viewform"
)
WEEKLY_QUESTIONNAIRE_PARTICIPANT_ENTRY = "1171438860"
WEEKLY_QUESTIONNAIRE_WEEK_ENTRY = "1690586821"
ONBOARDING_QUESTIONNAIRE_TEMPLATE_LINK = "{{ONBOARDING_QUESTIONNAIRE_LINK}}"
ONBOARDING_QUESTIONNAIRE_FALLBACK_STATIC_LINK = "https://forms.gle/hghifvApKXPU1TjK6"
ONBOARDING_QUESTIONNAIRE_FORM_VIEW_URL = (
    "https://docs.google.com/forms/d/e/"
    "1FAIpQLSdE5BiT1SLKPhP2dH1L-kus0oey4857psewaZz6rA8o_c469g/viewform"
)
ONBOARDING_QUESTIONNAIRE_PARTICIPANT_ENTRY = "326737977"
CALENDAR_REMINDER_TITLE = "Teach&Tell: Next episode unlock"
CALENDAR_REMINDER_DETAILS = (
    "Your next Teach&Tell episode is now unlocked. "
    "Episodes unlock every week from your game start date. "
    "Open the game: https://chicago-formula-n.web.app/"
)


def _word_count_whitespace(text: str) -> int:
    """Count whitespace-separated tokens (punctuation stays attached to words)."""
    return len([w for w in (text or "").strip().split() if w])


def _resolve_questionnaire_week_number(state: Optional[Dict]) -> int:
    """Map current game state to questionnaire week number (1..4)."""
    if not state:
        return 1
    raw_week = state.get("questionnaire_week", state.get("current_stage", 1))
    try:
        week = int(raw_week)
    except (TypeError, ValueError):
        return 1
    return max(1, min(4, week))


def _build_weekly_questionnaire_link(participant_code: str, state: Optional[Dict]) -> str:
    week = _resolve_questionnaire_week_number(state)
    params = {
        "usp": "pp_url",
        f"entry.{WEEKLY_QUESTIONNAIRE_PARTICIPANT_ENTRY}": participant_code,
        f"entry.{WEEKLY_QUESTIONNAIRE_WEEK_ENTRY}": str(week),
    }
    return f"{WEEKLY_QUESTIONNAIRE_FORM_VIEW_URL}?{urlencode(params)}"


def _build_onboarding_questionnaire_link(participant_code: str) -> str:
    params = {
        "usp": "pp_url",
        f"entry.{ONBOARDING_QUESTIONNAIRE_PARTICIPANT_ENTRY}": participant_code,
    }
    return f"{ONBOARDING_QUESTIONNAIRE_FORM_VIEW_URL}?{urlencode(params)}"


def _parse_iso_datetime(value: Optional[str], default_tz: Optional[datetime.tzinfo] = None) -> Optional[datetime]:
    """Parse ISO datetime safely and attach timezone when missing."""
    if not value or not isinstance(value, str):
        return None
    try:
        dt = datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return None
    if dt.tzinfo is None and default_tz is not None:
        return default_tz.localize(dt) if hasattr(default_tz, "localize") else dt.replace(tzinfo=default_tz)
    return dt


def _build_stage_unlock_schedule_from_start(game_start_at: datetime) -> Dict[int, str]:
    """Build absolute unlock dates for all stages from a fixed game start timestamp."""
    schedule: Dict[int, str] = {}
    for stage_num in range(1, TOTAL_STAGES + 1):
        unlock_date = game_start_at + timedelta(days=STAGE_UNLOCK_DELAY_DAYS * (stage_num - 1))
        schedule[stage_num] = unlock_date.isoformat()
    return schedule


def _ensure_absolute_stage_unlock_schedule(state: Dict) -> None:
    """
    Ensure stage unlock dates follow an absolute weekly schedule from game start.
    This keeps unlock weekday stable even if a player finishes an episode later.
    """
    participant_code = str(state.get("participant_code", "") or "")
    is_test_mode = is_test_mode_participant(participant_code)
    cet_tz = pytz.timezone('Europe/Berlin')
    now = datetime.now(cet_tz)

    if is_test_mode:
        state["game_start_at"] = now.isoformat()
        state["stage_unlock_dates"] = {stage_num: now.isoformat() for stage_num in range(1, TOTAL_STAGES + 1)}
        return

    start_from_state = _parse_iso_datetime(state.get("game_start_at"), default_tz=cet_tz)
    stage_unlock_dates = state.get("stage_unlock_dates", {}) or {}
    stage1_unlock = _parse_iso_datetime(stage_unlock_dates.get(1), default_tz=cet_tz)
    game_start_at = start_from_state or stage1_unlock or now

    state["game_start_at"] = game_start_at.isoformat()
    state["stage_unlock_dates"] = _build_stage_unlock_schedule_from_start(game_start_at)


def _build_next_episode_calendar_link(state: Optional[Dict]) -> str:
    """Create a Google Calendar template URL for the next unlock reminder."""
    cet_tz = pytz.timezone('Europe/Berlin')
    now = datetime.now(cet_tz)

    current_stage = 1
    if state:
        try:
            current_stage = max(1, min(TOTAL_STAGES, int(state.get("current_stage", 1))))
        except (TypeError, ValueError):
            current_stage = 1
    next_stage = min(TOTAL_STAGES, current_stage + 1)

    next_unlock_dt: Optional[datetime] = None
    if state and isinstance(state, dict):
        stage_unlock_dates = state.get("stage_unlock_dates", {}) or {}
        next_unlock_dt = _parse_iso_datetime(stage_unlock_dates.get(next_stage), default_tz=cet_tz)
        if next_unlock_dt is None:
            working_state = dict(state)
            _ensure_absolute_stage_unlock_schedule(working_state)
            stage_unlock_dates = working_state.get("stage_unlock_dates", {}) or {}
            next_unlock_dt = _parse_iso_datetime(stage_unlock_dates.get(next_stage), default_tz=cet_tz)

    if next_unlock_dt is None:
        next_unlock_dt = now + timedelta(days=STAGE_UNLOCK_DELAY_DAYS)

    start_day = next_unlock_dt.strftime("%Y%m%d")
    end_day = (next_unlock_dt + timedelta(days=1)).strftime("%Y%m%d")
    params = {
        "action": "TEMPLATE",
        "text": CALENDAR_REMINDER_TITLE,
        "dates": f"{start_day}/{end_day}",
        "details": CALENDAR_REMINDER_DETAILS,
    }
    return f"https://calendar.google.com/calendar/render?{urlencode(params)}"


def _personalize_questionnaire_links_in_text(
    text: str, participant_code: str, state: Optional[Dict]
) -> str:
    if not text:
        return text

    onboarding_link = _build_onboarding_questionnaire_link(participant_code)
    weekly_link = _build_weekly_questionnaire_link(participant_code, state)
    result = text

    # Preferred template tokens
    result = result.replace(ONBOARDING_QUESTIONNAIRE_TEMPLATE_LINK, onboarding_link)
    result = result.replace(WEEKLY_QUESTIONNAIRE_TEMPLATE_LINK, weekly_link)

    # Backward compatibility for older static links
    result = result.replace(ONBOARDING_QUESTIONNAIRE_FALLBACK_STATIC_LINK, onboarding_link)
    result = result.replace(WEEKLY_QUESTIONNAIRE_FALLBACK_STATIC_LINK, weekly_link)

    # Backward compatibility for already-expanded docs URLs (possibly stale query params)
    result = re.sub(
        r"https://docs\.google\.com/forms/d/e/1FAIpQLSdE5BiT1SLKPhP2dH1L-kus0oey4857psewaZz6rA8o_c469g/viewform(?:\?[^\s)]*)?",
        onboarding_link,
        result,
    )
    result = re.sub(
        r"https://docs\.google\.com/forms/d/e/1FAIpQLSf7wqiYQXAQZLF3I_lbItkm2iAG8ro6aYUhkj8z7bHt_Pj0WQ/viewform(?:\?[^\s)]*)?",
        weekly_link,
        result,
    )
    return result


def _personalize_questionnaire_links_in_messages(
    messages: List[Dict], participant_code: str, state: Optional[Dict]
) -> Tuple[List[Dict], bool]:
    changed = False
    personalized: List[Dict] = []
    for msg in messages:
        if not isinstance(msg, dict):
            personalized.append(msg)
            continue
        content = msg.get("content")
        if isinstance(content, str):
            updated_content = _personalize_questionnaire_links_in_text(content, participant_code, state)
            if updated_content != content:
                updated_msg = dict(msg)
                updated_msg["content"] = updated_content
                personalized.append(updated_msg)
                changed = True
                continue
        personalized.append(msg)
    return personalized, changed


def _is_test_participant(participant_code: str) -> bool:
    return is_test_mode_participant(participant_code)


def _is_debug_mode_enabled(state: Dict, participant_code: str) -> bool:
    """Enable verbose director diagnostics only for test-mode participants."""
    return _is_test_participant(participant_code) and bool(state.get("debug_mode", False))


def _append_debug_message(messages: List[Dict], content: str) -> None:
    """Append a debug-only system message to chat response payload."""
    messages.append(
        {
            "type": "system",
            "content": f"[DEBUG] {content}",
            "message_style": "debug",
            "show_explain": False,
        }
    )


def _sync_last_public_responder_from_messages(state: Dict, messages: List[Dict]) -> None:
    """Keep last public responder aligned with the latest character output."""
    if not state or not messages:
        return

    for message in reversed(messages):
        if not isinstance(message, dict):
            continue
        if message.get("type") != "character":
            continue

        character_key = str(message.get("character") or "").strip().lower()
        if character_key and character_key in CHARACTER_DATA:
            state["last_public_responder"] = character_key
            return


def _sync_last_public_responder_for_public_mode(state: Dict, messages: List[Dict]) -> None:
    """Sync responder only when current conversation mode is public."""
    if not state:
        return
    if str(state.get("mode") or "").strip().lower() != "public":
        return
    _sync_last_public_responder_from_messages(state, messages)


def _truncate_for_debug(value: str, max_len: int = 700) -> str:
    text = (value or "").strip()
    if len(text) <= max_len:
        return text
    return f"{text[:max_len]}... [truncated, total={len(text)} chars]"


def _append_contradiction_guard_debug_message(messages: List[Dict], state: Dict) -> None:
    """Expose last contradiction guard decision in debug mode."""
    guard = state.pop("_last_contradiction_guard", None)
    if not guard:
        return

    character = guard.get("character", "unknown")
    behavior = guard.get("behavior", "unknown")
    slot = guard.get("slot", "unknown")
    label = guard.get("label", "unknown")
    intent_score = guard.get("intent_score", "0")
    trigger_hits = guard.get("trigger_hits", "0")
    _append_debug_message(
        messages,
        (
            "Contradiction guard active: "
            f"char={character}, mode={behavior}, slot={slot} ({label}), "
            f"intent_score={intent_score}, slot_hits={trigger_hits}"
        ),
    )


def _build_dialogue_input_debug_snapshot(
    participant_code: str,
    state: Dict,
    char_key: str,
    system_prompt: str,
    input_label: str,
    input_value: str,
    scope_label: str,
) -> str:
    """Build a concise preview of what goes into dialogue call."""
    episode = state.get("current_stage", 1)
    history_key = f"{participant_code}:{episode}"
    history = user_histories.get(history_key, [])
    history_tail = history[-10:]

    history_lines: List[str] = []
    if not history_tail:
        history_lines.append("- (empty)")
    else:
        for msg in history_tail:
            role = msg.get("role", "unknown")
            content = _truncate_for_debug(str(msg.get("content", "")), 220)
            history_lines.append(f"- {role}: {content}")

    prompt_preview = _truncate_for_debug(system_prompt, 700)
    input_preview = _truncate_for_debug(input_value, 500)
    history_block = "\n".join(history_lines)
    return (
        f"{scope_label} input snapshot for '{char_key}'\n"
        f"History key: {history_key}\n"
        f"History messages used (up to last 10): {len(history_tail)}\n"
        f"{input_label}: {input_preview}\n"
        f"System prompt preview:\n{prompt_preview}\n"
        f"History preview:\n{history_block}"
    )


def _build_private_input_debug_snapshot(
    participant_code: str,
    state: Dict,
    char_key: str,
    system_prompt: str,
    context_trigger: str,
) -> str:
    """Build a concise preview of what goes into private dialogue call."""
    return _build_dialogue_input_debug_snapshot(
        participant_code=participant_code,
        state=state,
        char_key=char_key,
        system_prompt=system_prompt,
        input_label="Context trigger",
        input_value=context_trigger,
        scope_label="Private",
    )


def _build_public_input_debug_snapshot(
    participant_code: str,
    state: Dict,
    char_key: str,
    system_prompt: str,
    user_input: str,
) -> str:
    """Build a concise preview of what goes into public dialogue call."""
    return _build_dialogue_input_debug_snapshot(
        participant_code=participant_code,
        state=state,
        char_key=char_key,
        system_prompt=system_prompt,
        input_label="User input",
        input_value=user_input,
        scope_label="Public",
    )


def _set_public_followup_lock(state: Dict, character_key: str, remaining: int = PUBLIC_FOLLOWUP_LOCK_TURNS) -> None:
    """Keep a temporary public-routing lock on one character."""
    if not character_key or remaining <= 0:
        state.pop("public_followup_lock", None)
        return
    state["public_followup_lock"] = {
        "character": character_key,
        "remaining": int(remaining),
    }


def _clear_public_followup_lock(state: Dict) -> None:
    """Drop temporary public-routing lock."""
    state.pop("public_followup_lock", None)


def _get_public_followup_lock(state: Dict) -> Tuple[Optional[str], int]:
    """Return (character, remaining turns) for temporary public lock."""
    lock_data = state.get("public_followup_lock", {})
    if not isinstance(lock_data, dict):
        return None, 0
    char_key = lock_data.get("character")
    try:
        remaining = int(lock_data.get("remaining", 0))
    except (TypeError, ValueError):
        remaining = 0
    if not char_key or remaining <= 0:
        return None, 0
    return char_key, remaining


def _is_public_group_address(message_text: str) -> bool:
    """Detect messages clearly aimed at the whole group in public mode."""
    lowered = (message_text or "").lower().strip()
    if not lowered:
        return False

    # Strong patterns are explicit group calls and should always route as group.
    strong_group_address_patterns = [
        r"\beveryone\b",
        r"\beverybody\b",
        r"\byou\s+all\b",
        r"\byou\s+guys\b",
        r"\ball\s+of\s+you\b",
        r"\bany\s+of\s+you\b",
        r"\bwhich\s+of\s+you\b",
        r"\bboth\s+of\s+you\b",
        r"\brest\s+of\s+you\b",
    ]
    if any(re.search(pattern, lowered) for pattern in strong_group_address_patterns):
        return True

    # Softer patterns like "who else" can be follow-ups to one speaker:
    # "Who else was in this group where you've hung out?"
    # In these cases we should keep singular-you routing to last responder.
    soft_group_address_patterns = [
        r"\bwho\s+else\b",
        r"\bwhat\s+about\s+the\s+others\b",
        r"\bothers\b",
        r"\banyone\b",
        r"\banybody\b",
    ]
    if not any(re.search(pattern, lowered) for pattern in soft_group_address_patterns):
        return False

    singular_you_patterns = [
        r"\byou\b",
        r"\byour\b",
        r"\byou've\b",
        r"\byou'd\b",
        r"\byou'll\b",
    ]
    addressed_to_single_person = any(re.search(pattern, lowered) for pattern in singular_you_patterns)
    return not addressed_to_single_person


def get_stage_location(state: Dict, stage_number: int) -> Optional[str]:
    """Get current location key for a stage, when configured."""
    stage_config = STAGE_CONFIG.get(stage_number, {})
    locations = stage_config.get("locations", {})
    if not locations:
        return None

    stage_locations = state.get("stage_locations", {})
    return (
        stage_locations.get(str(stage_number))
        or stage_locations.get(stage_number)
        or stage_config.get("default_location")
    )


def set_stage_location(state: Dict, stage_number: int, location_key: str) -> None:
    """Persist stage location in game state."""
    stage_locations = state.get("stage_locations", {})
    stage_locations[str(stage_number)] = location_key
    state["stage_locations"] = stage_locations


def get_characters_for_stage(state: Dict, stage_number: int) -> List[str]:
    """Resolve active character set for a stage and location."""
    stage_config = STAGE_CONFIG.get(stage_number, {})
    locations = stage_config.get("locations", {})
    if not locations:
        return stage_config.get("characters", [])

    location_key = get_stage_location(state, stage_number)
    location_config = locations.get(location_key, {})
    location_characters = location_config.get("characters")
    if isinstance(location_characters, list):
        return location_characters

    return stage_config.get("characters", [])


def get_private_dialogue_opener(state: Dict, stage_number: int, character_key: str) -> Optional[str]:
    """Get optional configured opening line for private dialogue."""
    stage_config = STAGE_CONFIG.get(stage_number, {})
    location_key = get_stage_location(state, stage_number)
    location_cfg = stage_config.get("locations", {}).get(location_key, {})

    def _resolve_opener_value(value: Optional[str]) -> Optional[str]:
        if not isinstance(value, str):
            return None
        raw_value = value.strip()
        if not raw_value:
            return None

        # File-based opener in game_texts/ep{stage}/...
        opener_from_file = _load_game_text_optional(raw_value, stage_number)
        if opener_from_file:
            return opener_from_file

        # Backward compatibility: allow literal inline text in config.
        if raw_value.endswith(".txt") or "/" in raw_value:
            logger.warning(
                f"Private dialogue opener file not found for '{character_key}' in ep{stage_number}: {raw_value}"
            )
            return None
        return raw_value

    location_openers = location_cfg.get("private_dialogue_openers", {})
    if isinstance(location_openers, dict):
        opener = _resolve_opener_value(location_openers.get(character_key))
        if opener:
            return opener

    stage_openers = stage_config.get("private_dialogue_openers", {})
    if isinstance(stage_openers, dict):
        opener = _resolve_opener_value(stage_openers.get(character_key))
        if opener:
            return opener

    # Convention-based fallback:
    # game_texts/ep{N}/dialogue_openers/{location_key}/{character_key}.txt
    if location_key:
        opener = _load_game_text_optional(f"dialogue_openers/{location_key}/{character_key}.txt", stage_number)
        if opener:
            return opener

    # Global episode fallback:
    # game_texts/ep{N}/dialogue_openers/{character_key}.txt
    return _load_game_text_optional(f"dialogue_openers/{character_key}.txt", stage_number)


def _load_game_text_optional(filename: str, episode: int) -> Optional[str]:
    """Load optional game text file from game_texts/ep{episode}; return None if missing."""
    path = get_game_text_path(filename, episode)
    absolute_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), path)

    if not os.path.exists(absolute_path):
        return None

    try:
        with open(absolute_path, "r", encoding="utf-8-sig") as file:
            content = file.read().strip()
            return content or None
    except (FileNotFoundError, OSError, IOError) as exc:
        logger.warning(f"Failed to read optional game text file '{path}': {exc}")
        return None


def _normalize_character_set(value) -> Set[str]:
    """Normalize persisted character collection to a set of keys."""
    if isinstance(value, set):
        return value
    if isinstance(value, list):
        return set(value)
    if isinstance(value, tuple):
        return set(value)
    return set()


def _update_ep1_private_progress(state: Dict, character_key: str) -> None:
    """Track EP1 private-mode user turns and unique characters talked to."""
    if state.get("current_stage", 1) != 1:
        return

    state["ep1_private_turns"] = int(state.get("ep1_private_turns", 0)) + 1
    talked_characters = _normalize_character_set(state.get("ep1_private_characters", set()))
    talked_characters.add(character_key)
    state["ep1_private_characters"] = talked_characters


def _has_private_history_for_character(state: Dict, character_key: str) -> bool:
    """Return True when current episode already contains private chat with character."""
    episode = state.get("current_stage", 1)
    episode_messages = state.get("episode_messages", {})
    stored_messages = episode_messages.get(episode, episode_messages.get(str(episode), []))
    if not isinstance(stored_messages, list):
        return False

    expected_scope = f"private:{character_key}".strip().lower()
    for msg in stored_messages:
        if not isinstance(msg, dict):
            continue
        chat_scope = str(msg.get("chat_scope") or "").strip().lower()
        if chat_scope == expected_scope:
            return True
    return False


def _should_unlock_ep1_part2(state: Dict) -> bool:
    """Check if EP1 part 2 (Pauline appears) should be unlocked."""
    if state.get("current_stage", 1) != 1:
        return False
    if state.get("ep1_phase2_unlocked", False):
        return False
    if get_stage_location(state, 1) == EP1_PART2_LOCATION:
        return False

    private_turns = int(state.get("ep1_private_turns", 0))
    talked_characters = _normalize_character_set(state.get("ep1_private_characters", set()))
    talked_count = len(talked_characters)

    return (
        private_turns >= EP1_PRIVATE_MIN_TURNS_ANY
        or (private_turns >= EP1_PRIVATE_MIN_TURNS_WITH_TWO_CHARACTERS and talked_count >= 2)
    )


def _build_ep1_pauline_entrance_message(participant_code: str) -> Optional[Dict]:
    """Create narrator entrance message when Pauline joins EP1."""
    entrance_text = _load_game_text_optional("pauline_entrance.txt", 1)
    if not entrance_text:
        return None

    sender_key, content_without_sender = _extract_sender_from_text(entrance_text)
    text, buttons = _extract_buttons_from_text(content_without_sender)
    if not text:
        return None

    message = _build_character_message_for_sender(participant_code, text, sender_key or "narrator")
    if buttons:
        message["buttons"] = buttons
    return message


def get_clues_count_for_stage(stage_number: int, state: Optional[Dict] = None) -> int:
    """Get number of clues configured for a specific stage.

    Episode 1 clue 4 (USB) exists on disk but stays hidden until ``ep1_usb_drive_unlocked``.
    """
    stage_config = STAGE_CONFIG.get(stage_number, {})
    stage_clues_count = stage_config.get("clues_count")
    candidate_max = stage_clues_count if isinstance(stage_clues_count, int) and stage_clues_count > 0 else TOTAL_CLUES

    # Make the gate resilient to missing clue files (e.g., some deployments only ship 3 clues).
    # We treat a clue id as "available" iff Clue{N}.txt or clue{N}.txt exists for this episode.
    existing = 0
    for i in range(1, int(candidate_max) + 1):
        if stage_number == 1 and i == 4:
            if not (state and bool(state.get("ep1_usb_drive_unlocked"))):
                continue
        for basename in (f"Clue{i}.txt", f"clue{i}.txt"):
            rel_path = get_game_text_path(basename, stage_number)
            abs_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), rel_path)
            if os.path.exists(abs_path):
                existing += 1
                break

    # If nothing exists, fall back to configured count (keeps legacy behavior predictable).
    return existing if existing > 0 else int(candidate_max)


def get_clue_name_for_stage(stage_number: int, clue_id: str) -> str:
    """Return human-friendly clue name for stage and clue id."""
    try:
        clue_index = int(clue_id) - 1
    except (TypeError, ValueError):
        return f"Clue {clue_id}"

    if clue_index < 0:
        return f"Clue {clue_id}"

    stage_config = STAGE_CONFIG.get(stage_number, {})
    clue_names = stage_config.get("clue_names")
    if isinstance(clue_names, list) and clue_index < len(clue_names):
        clue_name = clue_names[clue_index]
        if isinstance(clue_name, str) and clue_name.strip():
            return clue_name.strip()

    return f"Clue {clue_id}"


def _contains_any(text: str, keywords: List[str]) -> bool:
    lowered = (text or "").lower()
    return any(keyword in lowered for keyword in keywords)


def _is_university_analysis_request(text: str) -> bool:
    return _contains_any(
        text,
        [
            "analy",
            "look at the drive",
            "look at this drive",
            "look at what's on",
            "check the drive",
            "usb",
            "formula",
            "files",
            "inspect",
            "decode",
        ],
    )


def _is_formula_nonsense_signal(text: str) -> bool:
    lowered = (text or "").lower()
    negative_markers = [
        "nonsense",
        "not a formula",
        "fake",
        "meaningless",
        "garbage",
        "random",
        "doesn't make sense",
        "does not make sense",
        "not real",
        "gibberish",
        "invalid",
        "can't be",
        "cannot be",
        "wrong",
        "not consistent",
        "doesn't check out",
        "does not check out",
        "made up",
        "nonsensical",
    ]
    formula_markers = [
        "formula",
        "equation",
        "model",
        "files",
        "drive",
        "usb",
        "data",
    ]
    has_negative = any(marker in lowered for marker in negative_markers)
    has_formula_context = any(marker in lowered for marker in formula_markers)
    return has_negative or (has_negative and has_formula_context)


def _mentions_formula_confrontation(text: str) -> bool:
    return _contains_any(
        text,
        [
            "formula",
            "drive",
            "usb",
            "files",
            "nonsense",
            "expert",
            "james",
            "analysis",
        ],
    )


def _mentions_plane_plain_story(text: str) -> bool:
    return _contains_any(
        text,
        [
            "plane",
            "plain",
            "mix-up",
            "mixed up",
            "another drive",
            "wrong drive",
        ],
    )


def _is_english_usb_explanation(text: str) -> bool:
    lowered = (text or "").strip().lower()
    if not lowered:
        return False

    words = re.findall(r"[a-zA-Z]+", lowered)
    if len(words) < 5:
        return False

    cyrillic_chars = re.findall(r"[а-яё]", lowered, flags=re.IGNORECASE)
    if len(cyrillic_chars) >= 3:
        return False

    explanation_markers = [
        "drive",
        "usb",
        "flash",
        "file",
        "files",
        "formula",
        "equation",
        "model",
        "data",
        "greek",
        "symbols",
    ]
    return any(marker in lowered for marker in explanation_markers)


def _build_ep2_nina_trigger(location: str, cue: str, user_message: str, other_reply: str) -> str:
    if location == "university_ep2":
        if cue == "nudge_before_analysis":
            return (
                f"The detective asked: '{user_message}'. James has not yet analyzed the drive. "
                "Give a brief nudge to ask James to check the USB contents now."
            )
        if cue == "after_verdict":
            return (
                f"The detective asked: '{user_message}'. James replied: '{other_reply}'. "
                "He just signaled the formula/files are nonsense. React briefly and point to going to Alex next."
            )
        if cue == "after_verdict_alex_first":
            return (
                f"The detective asked: '{user_message}'. James replied: '{other_reply}'. "
                "The team visited Alex before university. React to the contradiction and suggest checking Alex's story."
            )
        if cue == "wrap_university":
            return (
                f"The detective asked: '{user_message}'. James replied: '{other_reply}'. "
                "James already gave his verdict and this conversation is dragging. Briefly suggest moving to Alex."
            )

    if location == "hospital_ep2":
        if cue == "nudge_expert_before_university":
            return (
                f"The detective asked: '{user_message}'. Alex replied: '{other_reply}'. "
                "This hospital visit happened before university analysis. Give a brief nudge to have the USB checked by an expert."
            )
        if cue == "hint_confront_formula":
            return (
                f"The detective asked: '{user_message}'. Alex replied: '{other_reply}'. "
                "University already said the formula is nonsense, but detective is not confronting Alex yet. "
                "Give a short hint on how to bring up James's analysis."
            )
        if cue == "seed_doubt":
            return (
                f"The detective asked: '{user_message}'. Alex replied: '{other_reply}'. "
                "Alex just gave the plane/plain-style explanation. Add a very short line that plants mild doubt."
            )
        if cue == "wrap_hospital":
            return (
                f"The detective asked: '{user_message}'. Alex replied: '{other_reply}'. "
                "Hospital exchange is complete. Briefly signal that it's time to wrap up and move on."
            )

    return (
        f"The detective asked: '{user_message}'. Another character replied: '{other_reply}'. "
        "Provide a short, useful follow-up."
    )


def _get_ep2_director_state(state: Dict) -> Dict:
    ep2_state = state.setdefault("ep2_director", {})
    ep2_state.setdefault("visited_locations", [])
    ep2_state.setdefault("university_turns", 0)
    ep2_state.setdefault("hospital_turns", 0)
    ep2_state.setdefault("university_analysis_done", False)
    ep2_state.setdefault("hospital_preuni_nudge_done", False)
    ep2_state.setdefault("university_nudge_done", False)
    ep2_state.setdefault("university_post_verdict_nina_done", False)
    ep2_state.setdefault("university_wrap_done", False)
    ep2_state.setdefault("hospital_confront_hint_done", False)
    ep2_state.setdefault("hospital_doubt_seed_done", False)
    ep2_state.setdefault("hospital_wrap_done", False)
    ep2_state.setdefault("hospital_post_verdict_turns_without_confront", 0)
    ep2_state.setdefault("usb_handover_requested", False)
    ep2_state.setdefault("usb_context_explained", False)
    return ep2_state


async def _handle_ep2_scripted_public_message(
    participant_code: str,
    message_text: str,
    state: Dict,
    current_stage: int,
    current_location: str,
    stage_characters: Set[str],
) -> List[Dict]:
    """Episode 2 lightweight scripted director for university/hospital scenes."""
    messages: List[Dict] = []
    ep2_state = _get_ep2_director_state(state)
    debug_mode_enabled = _is_debug_mode_enabled(state, participant_code)

    visited_locations = ep2_state.get("visited_locations", [])
    if current_location not in visited_locations:
        visited_locations.append(current_location)
        ep2_state["visited_locations"] = visited_locations

    force_usb_analysis_prompt = False
    if (
        current_location == "university_ep2"
        and ep2_state.get("usb_handover_requested", False)
        and not ep2_state.get("usb_context_explained", False)
        and not ep2_state.get("university_analysis_done", False)
    ):
        if not _is_english_usb_explanation(message_text):
            log_message("user", message_text, participant_code)
            if "nina" in stage_characters and "nina" in CHARACTER_DATA:
                nina_data = CHARACTER_DATA["nina"]
                message_id = generate_message_id()
                save_message_to_cache(message_id, EP2_USB_EXPLANATION_FALLBACK, "nina")
                log_message("character_nina", EP2_USB_EXPLANATION_FALLBACK, participant_code)
                messages.append(
                    {
                        "type": "character",
                        "character": "nina",
                        "character_name": nina_data["full_name"],
                        "character_image": nina_data.get("image"),
                        "content": EP2_USB_EXPLANATION_FALLBACK,
                        "message_id": message_id,
                        "show_explain": True,
                    }
                )
            else:
                messages.append({"type": "system", "content": EP2_USB_EXPLANATION_FALLBACK})
            _sync_last_public_responder_from_messages(state, messages)
            return messages

        ep2_state["usb_context_explained"] = True
        force_usb_analysis_prompt = True

    # Default speaker in these scenes: non-Nina character.
    non_nina_candidates = [char for char in stage_characters if char != "nina" and char in CHARACTER_DATA]
    active_character_key = non_nina_candidates[0] if non_nina_candidates else "nina"
    active_char_data = CHARACTER_DATA[active_character_key]
    current_language_level = state.get("current_language_level", "B1")

    log_message("user", message_text, participant_code)

    system_prompt = combine_character_prompt(active_character_key, current_language_level, current_stage, current_location)
    if force_usb_analysis_prompt and active_character_key == "james":
        trigger = (
            f"The detective just explained the USB contents: '{message_text}'. "
            "Respond as James with a brief expert assessment of whether the formula/files look valid or nonsense."
        )
    else:
        trigger = (
            f"The detective asks in a public exchange: '{message_text}'. "
            "Respond naturally as your character and move the investigation forward."
        )

    try:
        if debug_mode_enabled:
            debug_snapshot = _build_public_input_debug_snapshot(
                participant_code=participant_code,
                state=state,
                char_key=active_character_key,
                system_prompt=system_prompt,
                user_input=trigger,
            )
            _append_debug_message(messages, debug_snapshot)
        other_reply = await ask_for_dialogue(
            participant_code,
            trigger,
            system_prompt,
            active_character_key,
            participant_code,
        )
        if debug_mode_enabled:
            _append_contradiction_guard_debug_message(messages, state)
    except Exception as exc:
        logger.error(f"Failed to get scripted EP2 reply from '{active_character_key}': {exc}")
        other_reply = None

    if not other_reply:
        other_reply = "[Character is thinking...]"

    other_message_id = generate_message_id()
    save_message_to_cache(other_message_id, other_reply, active_character_key)
    log_message(f"character_{active_character_key}", other_reply, participant_code)
    messages.append(
        {
            "type": "character",
            "character": active_character_key,
            "character_name": active_char_data["full_name"],
            "character_image": active_char_data.get("image"),
            "content": other_reply,
            "message_id": other_message_id,
            "show_explain": bool(other_reply and other_reply != "[Character is thinking...]"),
        }
    )

    # Decide if Nina should interject in this turn based on EP2 prompt conditions.
    nina_cue: Optional[str] = None
    hospital_visited = "hospital_ep2" in ep2_state.get("visited_locations", [])
    university_visited = "university_ep2" in ep2_state.get("visited_locations", [])
    analysis_done = ep2_state.get("university_analysis_done", False)

    if current_location == "university_ep2":
        ep2_state["university_turns"] = int(ep2_state.get("university_turns", 0)) + 1
        analysis_became_done_this_turn = False

        if not analysis_done and _is_university_analysis_request(message_text):
            ep2_state["university_analysis_done"] = True
            analysis_done = True
            analysis_became_done_this_turn = True

        if not analysis_done and _is_formula_nonsense_signal(other_reply):
            ep2_state["university_analysis_done"] = True
            analysis_done = True
            analysis_became_done_this_turn = True

        if not analysis_done:
            if ep2_state["university_turns"] >= 2 and not ep2_state.get("university_nudge_done", False):
                ep2_state["university_nudge_done"] = True
                nina_cue = "nudge_before_analysis"
        else:
            if not ep2_state.get("university_post_verdict_nina_done", False):
                # Fire the post-verdict cue once analysis happened and James gave a substantive assessment.
                if analysis_became_done_this_turn or _contains_any(
                    other_reply,
                    ["formula", "equation", "model", "files", "drive", "usb", "nonsense", "invalid", "gibberish"],
                ):
                    ep2_state["university_post_verdict_nina_done"] = True
                    nina_cue = "after_verdict_alex_first" if hospital_visited else "after_verdict"
            else:
                if not ep2_state.get("university_wrap_done", False) and ep2_state["university_turns"] >= 4:
                    ep2_state["university_wrap_done"] = True
                    nina_cue = "wrap_university"

    elif current_location == "hospital_ep2":
        ep2_state["hospital_turns"] = int(ep2_state.get("hospital_turns", 0)) + 1

        if not analysis_done:
            if ep2_state["hospital_turns"] >= 3 and not ep2_state.get("hospital_preuni_nudge_done", False):
                ep2_state["hospital_preuni_nudge_done"] = True
                nina_cue = "nudge_expert_before_university"
        else:
            if _mentions_formula_confrontation(message_text):
                ep2_state["hospital_post_verdict_turns_without_confront"] = 0
            else:
                ep2_state["hospital_post_verdict_turns_without_confront"] = int(
                    ep2_state.get("hospital_post_verdict_turns_without_confront", 0)
                ) + 1
                if (
                    ep2_state["hospital_post_verdict_turns_without_confront"] >= 2
                    and not ep2_state.get("hospital_confront_hint_done", False)
                ):
                    ep2_state["hospital_confront_hint_done"] = True
                    nina_cue = "hint_confront_formula"

        if not ep2_state.get("hospital_doubt_seed_done", False) and _mentions_plane_plain_story(other_reply):
            ep2_state["hospital_doubt_seed_done"] = True
            nina_cue = "seed_doubt"

        if (
            not ep2_state.get("hospital_wrap_done", False)
            and ep2_state["hospital_turns"] >= 5
            and (
                ep2_state.get("hospital_doubt_seed_done", False)
                or ep2_state.get("hospital_preuni_nudge_done", False)
                or university_visited
            )
        ):
            ep2_state["hospital_wrap_done"] = True
            nina_cue = nina_cue or "wrap_hospital"

    if nina_cue and "nina" in stage_characters and "nina" in CHARACTER_DATA:
        nina_prompt = load_system_prompt(get_prompt_path("nina", current_stage, current_location))
        nina_trigger = _build_ep2_nina_trigger(current_location, nina_cue, message_text, other_reply)
        try:
            if debug_mode_enabled:
                debug_snapshot = _build_public_input_debug_snapshot(
                    participant_code=participant_code,
                    state=state,
                    char_key="nina",
                    system_prompt=nina_prompt,
                    user_input=nina_trigger,
                )
                _append_debug_message(messages, debug_snapshot)
            nina_reply = await ask_for_dialogue(
                participant_code,
                nina_trigger,
                nina_prompt,
                "nina",
                participant_code,
            )
            if debug_mode_enabled:
                _append_contradiction_guard_debug_message(messages, state)
        except Exception as exc:
            logger.error(f"Failed to get scripted EP2 Nina interjection: {exc}")
            nina_reply = None

        if nina_reply:
            nina_data = CHARACTER_DATA["nina"]
            nina_message_id = generate_message_id()
            save_message_to_cache(nina_message_id, nina_reply, "nina")
            log_message("character_nina", nina_reply, participant_code)
            messages.append(
                {
                    "type": "character",
                    "character": "nina",
                    "character_name": nina_data["full_name"],
                    "character_image": nina_data.get("image"),
                    "content": nina_reply,
                    "message_id": nina_message_id,
                    "show_explain": True,
                }
            )

            # In EP2 university scene, if Nina asks James a question, let James answer her.
            if current_location == "university_ep2" and active_character_key == "james" and "?" in nina_reply:
                james_followup_trigger = (
                    f"Nina just said: '{nina_reply}'. "
                    "If she asked you a direct or implied question, answer it briefly and clearly as James."
                )
                try:
                    if debug_mode_enabled:
                        debug_snapshot = _build_public_input_debug_snapshot(
                            participant_code=participant_code,
                            state=state,
                            char_key="james",
                            system_prompt=system_prompt,
                            user_input=james_followup_trigger,
                        )
                        _append_debug_message(messages, debug_snapshot)
                    james_followup = await ask_for_dialogue(
                        participant_code,
                        james_followup_trigger,
                        system_prompt,
                        "james",
                        participant_code,
                    )
                    if debug_mode_enabled:
                        _append_contradiction_guard_debug_message(messages, state)
                except Exception as exc:
                    logger.error(f"Failed to get James follow-up to Nina question: {exc}")
                    james_followup = None

                if james_followup:
                    james_followup_message_id = generate_message_id()
                    save_message_to_cache(james_followup_message_id, james_followup, "james")
                    log_message("character_james", james_followup, participant_code)
                    messages.append(
                        {
                            "type": "character",
                            "character": "james",
                            "character_name": active_char_data["full_name"],
                            "character_image": active_char_data.get("image"),
                            "content": james_followup,
                            "message_id": james_followup_message_id,
                            "show_explain": True,
                        }
                    )

    _sync_last_public_responder_from_messages(state, messages)
    return messages


def resolve_clue_text_path(clue_id: str, episode: int) -> str:
    """Resolve clue text path with support for both `Clue` and `clue` naming."""
    candidates = [
        get_game_text_path(f"Clue{clue_id}.txt", episode),
        get_game_text_path(f"clue{clue_id}.txt", episode),
    ]
    for candidate in candidates:
        absolute_candidate = os.path.join(os.path.dirname(os.path.abspath(__file__)), candidate)
        if os.path.exists(absolute_candidate):
            return candidate
    # Keep deterministic fallback for logging/error handling.
    return candidates[0]


def _extract_buttons_from_text(content: str) -> Tuple[str, List[Dict[str, str]]]:
    return _sm_extract_buttons_from_text(content)


def _split_text_messages(content: str) -> List[str]:
    return _sm_split_text_messages(content)


def _extract_scripted_message_blocks(
    content: str, default_sender: Optional[str] = None
) -> List[Tuple[Optional[str], str]]:
    return _sm_extract_scripted_message_blocks(content, default_sender=default_sender)


def _resolve_character_sender_key(raw_sender: str) -> Optional[str]:
    return _sm_resolve_character_sender_key(raw_sender)


def _extract_sender_from_text(content: str) -> Tuple[Optional[str], str]:
    return _sm_extract_sender_from_text(content)


def resolve_action_text_from_game_texts(
    action: str, episode: int
) -> Optional[Tuple[List[Tuple[Optional[str], str]], List[Dict[str, str]], str]]:
    """
    Resolve button action as a game_texts file and return parsed message payload.
    Supports paths with/without `.txt`, e.g.:
    - "dialogue_openers/university_ep2/james.txt"
    - "dialogue_openers/university_ep2/james"
    """
    if not isinstance(action, str):
        return None

    normalized = action.strip().replace("\\", "/")
    if not normalized:
        return None

    # Basic path traversal / absolute-path guard.
    if normalized.startswith("/") or normalized.startswith("../") or "/../" in f"/{normalized}/":
        return None

    if not normalized.endswith(".txt"):
        normalized = f"{normalized}.txt"

    file_content = _load_game_text_optional(normalized, episode)
    if not file_content:
        return None

    sender_key, content_without_sender = _extract_sender_from_text(file_content)
    text, buttons = _extract_buttons_from_text(content_without_sender)
    message_blocks = _extract_scripted_message_blocks(text, default_sender=sender_key or "narrator")
    if not message_blocks:
        return None
    return message_blocks, buttons, (sender_key or "narrator")


def _build_character_message_for_sender(participant_code: str, text: str, sender_key: str) -> Dict:
    """Create a character message from sender metadata and log it."""
    message_id = generate_message_id()
    resolved_sender = sender_key if sender_key in CHARACTER_DATA or sender_key == "narrator" else "narrator"
    log_role = "narrator" if resolved_sender == "narrator" else f"character_{resolved_sender}"
    log_message(log_role, text, participant_code)

    if resolved_sender == "narrator":
        save_message_to_cache(message_id, text, "narrator")
        return {
            "type": "character",
            "character": "narrator",
            "character_name": "Narrator",
            "content": text,
            "message_id": message_id,
            "show_explain": True,
        }

    char_data = CHARACTER_DATA.get(resolved_sender, {})
    save_message_to_cache(message_id, text, resolved_sender)
    return {
        "type": "character",
        "character": resolved_sender,
        "character_name": char_data.get("full_name", resolved_sender.capitalize()),
        "character_image": char_data.get("image"),
        "content": text,
        "message_id": message_id,
        "show_explain": True,
    }


async def handle_game_text_action(participant_code: str, action: str) -> List[Dict]:
    """Show a message loaded directly from game_texts via action path."""
    state = GAME_STATE.get(participant_code)
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]

    normalized_action = (action or "").strip().replace("\\", "/").lower()
    if state.get("current_stage", 1) == 1 and normalized_action in EP1_PART2_TRIGGER_ACTIONS:
        # Enter EP1 phase 2 exactly when Pauline appears at the doorway.
        set_stage_location(state, 1, EP1_PART2_LOCATION)
        state["ep1_phase2_unlocked"] = True

    episode = state.get("current_stage", 1)
    payload = resolve_action_text_from_game_texts(action, episode)
    if not payload:
        return []

    message_blocks, buttons, sender_key = payload
    messages: List[Dict] = []
    for index, (block_sender, text) in enumerate(message_blocks):
        message = _build_character_message_for_sender(
            participant_code, text, block_sender or sender_key
        )
        if buttons and index == len(message_blocks) - 1:
            message["buttons"] = buttons
        messages.append(message)

    _sync_last_public_responder_for_public_mode(state, messages)
    return messages


async def handle_accuse_nina_enters(participant_code: str) -> List[Dict]:
    """Open Nina modal and show her accusation preface there."""
    state = GAME_STATE.get(participant_code)
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]

    if state.get("current_stage", 1) != 1:
        return [{"type": "system", "content": "Accusation is available in Episode 1."}]

    messages = await handle_game_text_action(participant_code, "accuse_nina_enters")
    for msg in messages:
        msg["show_explain"] = False
        msg["ui"] = {
            "openNinaChat": True,
            "ninaModalMessage": True,
            "caseMaterialsAccusationAvailable": bool(state.get("accuse_in_case_materials", False)),
        }
    return messages


async def handle_accuse_nina_to_public(participant_code: str) -> List[Dict]:
    """Close Nina modal and continue accusation in public dialogue."""
    state = GAME_STATE.get(participant_code)
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]

    if state.get("current_stage", 1) != 1:
        return [{"type": "system", "content": "Accusation is available in Episode 1."}]

    state["mode"] = "public"
    state["current_character"] = None
    _clear_public_followup_lock(state)

    messages = await handle_game_text_action(participant_code, "accuse_nina_public_intro")
    if not messages:
        return []

    first_ui = {
        "closeNinaChat": True,
        "switchToPublicMode": True,
        "caseMaterialsAccusationAvailable": bool(state.get("accuse_in_case_materials", False)),
    }
    messages[0]["ui"] = first_ui
    messages[0]["show_explain"] = False

    last_msg = messages[-1]
    last_msg["buttons"] = _build_ep1_accusation_buttons(state, include_back=True)
    last_msg["show_explain"] = False
    merged_ui = dict(last_msg.get("ui", {}))
    merged_ui["caseMaterialsAccusationAvailable"] = bool(state.get("accuse_in_case_materials", False))
    last_msg["ui"] = merged_ui
    return messages


async def handle_accuse_select_target(participant_code: str, accused_key: str) -> List[Dict]:
    """First step of accusation: remember target and ask player for rationale."""
    state = GAME_STATE.get(participant_code)
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]

    if state.get("current_stage", 1) != 1:
        return [{"type": "system", "content": "Accusation is available in Episode 1."}]

    normalized_key = str(accused_key or "").strip().lower()
    allowed_targets = _ep1_accusable_suspect_keys(state)
    if normalized_key not in allowed_targets:
        return [{"type": "error", "content": "Unknown accusation target."}]

    if not state.get("accuse_unlocked", False):
        return [{"type": "system", "content": "You need to open Arrest Order from Case Materials first."}]

    state["accuse_pending_target"] = normalized_key
    state["accuse_waiting_for_reason"] = False

    messages = await handle_game_text_action(participant_code, "accuse_why")
    if not messages:
        return []

    last_msg = messages[-1]
    last_msg["show_explain"] = False
    last_msg["ui"] = {"caseMaterialsAccusationAvailable": bool(state.get("accuse_in_case_materials", False))}
    return messages


async def handle_accuse_explain_cancel(participant_code: str) -> List[Dict]:
    """Cancel rationale step and clear pending accusation target."""
    state = GAME_STATE.get(participant_code)
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]

    state["accuse_pending_target"] = None
    state["accuse_waiting_for_reason"] = False
    messages = [
        {
            "type": "character",
            "character": "nina",
            "character_name": CHARACTER_DATA.get("nina", {}).get("full_name", "Nina"),
            "character_image": CHARACTER_DATA.get("nina", {}).get("image"),
            "content": "All right, take your time!",
            "show_explain": False,
            "ui": {"caseMaterialsAccusationAvailable": bool(state.get("accuse_in_case_materials", False))},
        }
    ]
    _sync_last_public_responder_for_public_mode(state, messages)
    return messages


async def handle_accuse_explain_ready(participant_code: str) -> List[Dict]:
    """Arm next player public message as final accusation rationale."""
    state = GAME_STATE.get(participant_code)
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]

    if not state.get("accuse_pending_target"):
        return [{"type": "system", "content": "Choose who you want to accuse first."}]

    state["accuse_waiting_for_reason"] = True
    messages = [
        {
            "type": "character",
            "character": "nina",
            "character_name": CHARACTER_DATA.get("nina", {}).get("full_name", "Nina"),
            "character_image": CHARACTER_DATA.get("nina", {}).get("image"),
            "content": "Go on!",
            "show_explain": False,
            "ui": {"caseMaterialsAccusationAvailable": bool(state.get("accuse_in_case_materials", False))},
        }
    ]
    _sync_last_public_responder_for_public_mode(state, messages)
    return messages


async def handle_accuse_reason_message(participant_code: str, message_text: str) -> List[Dict]:
    """Use player's next public message as rationale and execute pending accusation."""
    state = GAME_STATE.get(participant_code)
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]

    pending_target = str(state.get("accuse_pending_target") or "").strip().lower()
    if not pending_target:
        state["accuse_waiting_for_reason"] = False
        return [{"type": "system", "content": "Choose who you want to accuse first."}]

    if _word_count_whitespace(message_text) < EP1_ACCUSATION_REASON_MIN_WORDS:
        state["accuse_waiting_for_reason"] = True
        messages = [
            {
                "type": "character",
                "character": "nina",
                "character_name": CHARACTER_DATA.get("nina", {}).get("full_name", "Nina"),
                "character_image": CHARACTER_DATA.get("nina", {}).get("image"),
                "content": "Huh? What do you mean?",
                "show_explain": False,
                "ui": {"caseMaterialsAccusationAvailable": bool(state.get("accuse_in_case_materials", False))},
            }
        ]
        _sync_last_public_responder_for_public_mode(state, messages)
        return messages

    state["accuse_waiting_for_reason"] = False
    state["accuse_pending_target"] = None
    return await handle_make_accusation(participant_code, pending_target)


async def handle_ep1_usb_received(participant_code: str) -> List[Dict]:
    """After Tim's finale: unlock USB clue in Case Materials, then EP1 win outro (Nina lines from file)."""
    state = GAME_STATE.get(participant_code)
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]

    if int(state.get("current_stage", 1)) != 1:
        return [{"type": "system", "content": "This action is available in Episode 1."}]

    if (
        not state.get("game_completed")
        or state.get("accused_character") != EP1_ACCUSATION_CORRECT_KEY
    ):
        return [{"type": "system", "content": "That isn't available right now.", "show_explain": False}]

    if state.get("ep1_usb_drive_unlocked"):
        msg = _build_character_message_for_sender(
            participant_code,
            "We already logged that drive — it's in your Case Materials.",
            "nina",
        )
        msg["show_explain"] = False
        return [msg]

    state["ep1_usb_drive_unlocked"] = True

    raw_nina = load_system_prompt(get_game_text_path("outro_nina.txt", 1))
    nina_body, nina_buttons = _extract_buttons_from_text(raw_nina)
    nina_blocks = _extract_scripted_message_blocks(nina_body, default_sender="nina")
    if not nina_blocks:
        nina_blocks = [("nina", nina_body.strip() or raw_nina)]

    outro_messages: List[Dict] = []
    for index, (block_sender, block_text) in enumerate(nina_blocks):
        msg = _build_character_message_for_sender(
            participant_code, block_text, block_sender or "nina"
        )
        msg["show_explain"] = False
        ui: Dict = {"caseMaterialsAccusationAvailable": False}
        if index == 0:
            ui["ep1UsbDriveUnlocked"] = True
        msg["ui"] = ui
        if index == len(nina_blocks) - 1 and nina_buttons:
            msg["buttons"] = nina_buttons
        outro_messages.append(msg)

    await game_state_manager.save_game_state(participant_code, state)
    return outro_messages


async def handle_ep1_outro_narrator(participant_code: str) -> List[Dict]:
    """After Nina's win outro: show narrator block (typewriter + image) like intro-B1."""
    state = GAME_STATE.get(participant_code)
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]

    if int(state.get("current_stage", 1)) != 1:
        return [{"type": "system", "content": "This action is available in Episode 1."}]

    if not state.get("game_completed") or state.get("accused_character") != EP1_ACCUSATION_CORRECT_KEY:
        return [{"type": "system", "content": "That isn't available right now.", "show_explain": False}]

    if not state.get("ep1_usb_drive_unlocked"):
        return [{"type": "system", "content": "That isn't available right now.", "show_explain": False}]

    if state.get("ep1_outro_narrator_shown"):
        return []

    raw = load_system_prompt(get_game_text_path("outro_narrator.txt", 1))
    narrator_body, narrator_buttons = _extract_buttons_from_text(raw)
    narrator_body = narrator_body.strip()
    if not narrator_body:
        return [{"type": "system", "content": "Outro text is missing.", "show_explain": False}]

    state["ep1_outro_narrator_shown"] = True

    log_message("system", narrator_body, participant_code)
    message_id = generate_message_id()
    save_message_to_cache(message_id, narrator_body)
    msg = {
        "type": "system",
        "content": narrator_body,
        "message_id": message_id,
        "show_explain": True,
        "typewriter_style": True,
        "image": "ep1/jason-steele-vj6ywmAj0pI-unsplash.jpg",
        "buttons": narrator_buttons,
        "ui": {"caseMaterialsAccusationAvailable": False},
    }
    await game_state_manager.save_game_state(participant_code, state)
    return [msg]


async def handle_ep1_outro_questionnaire(participant_code: str) -> List[Dict]:
    """Show post-game questionnaire after the narrator outro button (same payload as former USB tail)."""
    state = GAME_STATE.get(participant_code)
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]

    if int(state.get("current_stage", 1)) != 1:
        return [{"type": "system", "content": "This action is available in Episode 1."}]

    if not state.get("ep1_outro_narrator_shown"):
        return [{"type": "system", "content": "That isn't available right now.", "show_explain": False}]

    if state.get("ep1_outro_questionnaire_shown"):
        return []

    state["ep1_outro_questionnaire_shown"] = True
    outro = _ep1_outro_questionnaire_message(participant_code, state)
    outro["buttons"] = [{"text": "Get final summary from AI language tutor", "action": "get_final_summary"}]
    await game_state_manager.save_game_state(participant_code, state)
    return [outro]


async def handle_get_final_summary(participant_code: str) -> List[Dict]:
    """Generate final language summary based on accumulated participant progress."""
    from .ai_services import ask_tutor_for_final_summary

    logs = progress_manager.get_participant_progress(participant_code, source=TELL_SOURCE)
    summary_data = await ask_tutor_for_final_summary(participant_code, logs)
    summary_text = summary_data.get("summary", "").strip()
    if not summary_text:
        summary_text = (
            "Great job completing the game! You showed curiosity and engagement with English. "
            "Keep practicing and you'll continue to improve!"
        )

    tutor_data = CHARACTER_DATA.get("tutor", {"full_name": "English Tutor"})
    formatted_reply = f"*{tutor_data['full_name']}:*\n{summary_text}"
    log_message("character_tutor", formatted_reply, participant_code)

    message_id = generate_message_id()
    save_message_to_cache(message_id, formatted_reply, "tutor")

    return [{
        "type": "character",
        "character": "tutor",
        "character_name": tutor_data["full_name"],
        "content": formatted_reply,
        "message_id": message_id,
        "show_explain": False,
        "buttons": [{"text": "⬅️ Back to Main Menu", "action": "show_main_menu"}],
    }]


async def handle_inline_button_action(participant_code: str, action: str) -> Optional[List[Dict]]:
    """
    Handle inline button script without creating a separate file.
    Supported action formats:
    - inline::message text
    - inline::sender_key>>message text
    - inline::Full Character Name>>message text
    Use `\\n` in action to create line breaks in message text.
    """
    parsed = _sm_parse_inline_button_action(action)
    if parsed is None:
        return None

    sender_key, message_text = parsed
    if not message_text:
        return []

    return [_build_character_message_for_sender(participant_code, message_text, sender_key)]


async def handle_test_chat_command(participant_code: str, message_text: str) -> Optional[List[Dict]]:
    """Handle hidden test-only chat commands. Return None when not a command."""
    normalized = (message_text or "").strip().lower()
    is_debug_command = normalized.startswith("/debug")
    if normalized not in TEST_EP1_PAULINE_COMMANDS and not is_debug_command:
        return None

    state = GAME_STATE.get(participant_code)
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]

    if not _is_test_participant(participant_code):
        return [{"type": "system", "content": "This command is available only for TEST/ROBERTA mode."}]

    if is_debug_command:
        command_parts = normalized.split()
        if len(command_parts) != 2 or command_parts[1] not in {"on", "off"}:
            return [{"type": "system", "content": "Usage: /debug on or /debug off"}]

        debug_enabled = command_parts[1] == "on"
        state["debug_mode"] = debug_enabled
        # Persist explicit tester preference so defaults do not overwrite it.
        state["debug_mode_user_override"] = True
        await game_state_manager.save_game_state(participant_code, state)
        status_text = "enabled" if debug_enabled else "disabled"
        return [{"type": "system", "content": f"Debug mode {status_text} for TEST/ROBERTA."}]

    if state.get("current_stage", 1) != 1:
        return [{"type": "system", "content": "Switch to Episode 1 first, then run /pauline."}]

    # Mark EP1 phase 2 as unlocked and switch location so Pauline becomes available.
    set_stage_location(state, 1, EP1_PART2_LOCATION)
    state["ep1_phase2_unlocked"] = True

    messages: List[Dict] = []
    entrance_message = _build_ep1_pauline_entrance_message(participant_code)
    if entrance_message:
        messages.append(entrance_message)
    else:
        messages.append(
            {"type": "system", "content": "Pauline is now available in Episode 1."}
        )

    await game_state_manager.save_game_state(participant_code, state)
    return messages


def generate_message_id() -> int:
    """Generate a unique message ID for web version."""
    return int(time.time() * 1000000) + random.randint(0, 1000)


def initialize_game_state(participant_code: str) -> Dict:
    """Initialize new game state for a participant."""
    from datetime import datetime
    import pytz
    
    # Special test mode: for TEST/ROBERTA participants, unlock all stages immediately.
    is_test_mode = is_test_mode_participant(participant_code)
    
    # Initialize stage progress for all stages
    stage_progress = {}
    for stage_num in range(1, 5):  # Stages 1-4
        stage_progress[stage_num] = {
            "clues_examined": set(),
            "suspects_interrogated": set(),
            "key_information_found": [],
            "completion_status": "not_started"  # "not_started", "in_progress", "completed", "skipped"
        }
    
    # Stage 1 is always available, or all stages for test mode
    cet_tz = pytz.timezone('Europe/Berlin')
    now = datetime.now(cet_tz)
    stage_unlock_dates = {
        1: now.isoformat()  # Stage 1 unlocked immediately
    }
    
    # For test mode, unlock all stages immediately
    if is_test_mode:
        for stage_num in range(2, TOTAL_STAGES + 1):
            stage_unlock_dates[stage_num] = now.isoformat()
    
    return {
        "mode": "public",
        "current_character": None,
        "last_public_responder": None,
        "public_followup_lock": None,
        "waiting_for_word": False,
        "accused_character": None,
        "accused_wrong_keys": set(),
        "accusation_attempts": 0,
        "reveal_step": 0,
        "custom_reveal_step": 0,
        "clues_examined": set(),  # Legacy - for current stage; still used for clue / accusation gates
        # Legacy: was used (e.g. Telegram) to count first private talk per suspect; web UI does not read it.
        "suspects_interrogated": set(),
        # Episode 1 accusation mechanic:
        # - accuse_offer_pending: legacy offer flow flag (kept for compatibility)
        # - accuse_in_case_materials: show "Arrest Order" button in Case Materials drawer
        # - accuse_unlocked: allow selecting accused character
        "accuse_offer_pending": False,
        "accuse_in_case_materials": True,
        "accuse_unlocked": True,
        "accuse_pending_target": None,
        "accuse_waiting_for_reason": False,
        "topic_memory": {"topic": "Initial greeting", "spoken": [], "predefined_used": []},
        "game_completed": False,
        "ep1_usb_drive_unlocked": False,
        "ep1_outro_narrator_shown": False,
        "ep1_outro_questionnaire_shown": False,
        "participant_code": participant_code,
        # TEST participant gets debug output by default.
        "debug_mode": is_test_mode,
        # True only after /debug on|off command is used.
        "debug_mode_user_override": False,
        "waiting_for_participant_code": False,
        "onboarding_step": "consent",
        "current_language_level": "B1",  # Default level
        # Multi-stage fields
        "current_stage": 1,  # Default start episode for all participants (including test mode)
        "stages_completed": set(),
        "stage_unlock_dates": stage_unlock_dates,
        "stage_progress": stage_progress,
        "global_knowledge": [],  # List of dicts: {"stage": int, "information": str, "source": str, "importance": str}
        "episode_messages": {},  # stage_num -> list of message dicts shown in chat for that episode
        "stage_locations": {"2": EP2_DEFAULT_LOCATION},
    }


def migrate_legacy_game_state(state: Dict) -> Dict:
    """Migrate legacy game state to multi-stage format."""
    participant_code = state.get("participant_code", "")
    is_test_mode = is_test_mode_participant(participant_code)
    
    # If state doesn't have multi-stage fields, initialize them
    if "current_stage" not in state:
        state["current_stage"] = 1
        
    if "stages_completed" not in state:
        # If game was completed, mark stage 1 as completed
        if state.get("game_completed", False):
            state["stages_completed"] = {1}
        else:
            state["stages_completed"] = set()
    
    if "stage_unlock_dates" not in state:
        cet_tz = pytz.timezone('Europe/Berlin')
        now = datetime.now(cet_tz)
        state["stage_unlock_dates"] = {
            1: now.isoformat()
        }
        # For test mode, unlock all stages immediately
        if is_test_mode:
            for stage_num in range(2, TOTAL_STAGES + 1):
                state["stage_unlock_dates"][stage_num] = now.isoformat()
    state.setdefault("game_start_at", state.get("stage_unlock_dates", {}).get(1))
    
    if "stage_progress" not in state:
        stage_progress = {}
        for stage_num in range(1, TOTAL_STAGES + 1):
            stage_progress[stage_num] = {
                "clues_examined": set(),
                "suspects_interrogated": set(),
                "key_information_found": [],
                "completion_status": "not_started"
            }
        
        # Migrate current progress to stage 1
        if "clues_examined" in state:
            stage_progress[1]["clues_examined"] = state.get("clues_examined", set())
        if "suspects_interrogated" in state:
            stage_progress[1]["suspects_interrogated"] = state.get("suspects_interrogated", set())
        
        # If game was in progress, mark stage 1 as in_progress
        if state.get("onboarding_step") == "investigation_started" and not state.get("game_completed", False):
            stage_progress[1]["completion_status"] = "in_progress"
        elif 1 in state.get("stages_completed", set()):
            stage_progress[1]["completion_status"] = "completed"
        
        state["stage_progress"] = stage_progress
    
    if "global_knowledge" not in state:
        state["global_knowledge"] = []
    
    if "episode_messages" not in state:
        state["episode_messages"] = {}

    if "debug_mode" not in state:
        state["debug_mode"] = is_test_mode

    if "debug_mode_user_override" not in state:
        state["debug_mode_user_override"] = False

    # For legacy test-mode states, turn debug on by default unless user explicitly toggled it.
    if is_test_mode and not state.get("debug_mode_user_override", False):
        state["debug_mode"] = True

    if "stage_locations" not in state:
        state["stage_locations"] = {"2": EP2_DEFAULT_LOCATION}
    else:
        stage_locations = state.get("stage_locations", {})
        if not stage_locations.get("2") and not stage_locations.get(2):
            stage_locations["2"] = EP2_DEFAULT_LOCATION
            state["stage_locations"] = stage_locations

    if "last_public_responder" not in state:
        state["last_public_responder"] = None
    if "public_followup_lock" not in state:
        state["public_followup_lock"] = None

    # EP1 simplification: Arrest Order is always available from Case Materials.
    if state.get("current_stage", 1) == 1 and not state.get("game_completed", False):
        state["accuse_offer_pending"] = False
        state["accuse_in_case_materials"] = True
        state["accuse_unlocked"] = True
        state.setdefault("accused_wrong_keys", set())
    state.setdefault("accuse_pending_target", None)
    state.setdefault("accuse_waiting_for_reason", False)
    state.setdefault("ep1_usb_drive_unlocked", False)
    state.setdefault("ep1_outro_narrator_shown", False)
    state.setdefault("ep1_outro_questionnaire_shown", False)
    _ensure_absolute_stage_unlock_schedule(state)
    
    return state


def get_available_stages(participant_code: str) -> List[int]:
    """Get list of stages available to the player."""
    # Special test mode: for TEST/ROBERTA participants, all stages are always available
    if is_test_mode_participant(participant_code):
        return list(range(1, TOTAL_STAGES + 1))
    
    state = GAME_STATE.get(participant_code)
    if not state:
        return [1]  # Stage 1 always available
    
    # Ensure state is migrated
    state = migrate_legacy_game_state(state)
    _ensure_absolute_stage_unlock_schedule(state)
    
    available = [1]  # Stage 1 is always available
    cet_tz = pytz.timezone('Europe/Berlin')
    now = datetime.now(cet_tz)
    
    stage_unlock_dates = state.get("stage_unlock_dates", {})
    stages_completed = state.get("stages_completed", set())
    stage_progress = state.get("stage_progress", {})
    
    for stage_num in range(2, TOTAL_STAGES + 1):
        # Check if previous stage is completed or skipped
        prev_stage = stage_num - 1
        prev_status = stage_progress.get(prev_stage, {}).get("completion_status", "not_started")
        
        if prev_status in ["completed", "skipped"]:
            # Check unlock date
            unlock_date_str = stage_unlock_dates.get(stage_num)
            if unlock_date_str:
                try:
                    unlock_date = datetime.fromisoformat(unlock_date_str)
                    if now >= unlock_date:
                        available.append(stage_num)
                except (ValueError, TypeError):
                    # Invalid date format, unlock immediately if previous stage is done
                    available.append(stage_num)
            else:
                # No unlock date set: rebuild absolute weekly schedule from game start.
                _ensure_absolute_stage_unlock_schedule(state)
                stage_unlock_dates = state.get("stage_unlock_dates", {})
                unlock_date_str = stage_unlock_dates.get(stage_num)
                unlock_date = _parse_iso_datetime(unlock_date_str, default_tz=cet_tz)
                if unlock_date and now >= unlock_date:
                    available.append(stage_num)
                elif prev_status == "skipped":
                    # If skipped, unlock immediately
                    available.append(stage_num)
    
    return sorted(available)


async def complete_stage(participant_code: str, stage_number: int) -> bool:
    """Mark a stage as completed and unlock the next stage."""
    state = GAME_STATE.get(participant_code)
    if not state:
        return False
    
    state = migrate_legacy_game_state(state)
    
    # Update stage progress
    if stage_number not in state["stage_progress"]:
        state["stage_progress"][stage_number] = {
            "clues_examined": set(),
            "suspects_interrogated": set(),
            "key_information_found": [],
            "completion_status": "completed"
        }
    else:
        state["stage_progress"][stage_number]["completion_status"] = "completed"
    
    # Add to completed stages
    state["stages_completed"].add(stage_number)
    
    # Add key information to global knowledge
    stage_config = STAGE_CONFIG.get(stage_number, {})
    key_info = stage_config.get("key_information", [])
    
    for info in key_info:
        knowledge_entry = {
            "stage": stage_number,
            "information": info,
            "source": "stage_completion",
            "importance": "high"
        }
        # Avoid duplicates
        if knowledge_entry not in state["global_knowledge"]:
            state["global_knowledge"].append(knowledge_entry)
    
    # Keep unlock schedule anchored to game start (not completion moment).
    _ensure_absolute_stage_unlock_schedule(state)
    
    # Save state
    await game_state_manager.save_game_state(participant_code, state)
    
    logger.info(f"Participant {participant_code}: Stage {stage_number} completed")
    return True


async def skip_stage(participant_code: str, stage_number: int) -> bool:
    """Skip a stage and add hints to global knowledge."""
    state = GAME_STATE.get(participant_code)
    if not state:
        return False
    
    state = migrate_legacy_game_state(state)
    
    # Update stage progress
    if stage_number not in state["stage_progress"]:
        state["stage_progress"][stage_number] = {
            "clues_examined": set(),
            "suspects_interrogated": set(),
            "key_information_found": [],
            "completion_status": "skipped"
        }
    else:
        state["stage_progress"][stage_number]["completion_status"] = "skipped"
    
    # Add key information from stage config as hints
    stage_config = STAGE_CONFIG.get(stage_number, {})
    key_info = stage_config.get("key_information", [])
    
    for info in key_info:
        knowledge_entry = {
            "stage": stage_number,
            "information": info,
            "source": "nina_hint",
            "importance": "medium"
        }
        # Avoid duplicates
        if knowledge_entry not in state["global_knowledge"]:
            state["global_knowledge"].append(knowledge_entry)
    
    # Unlock next stage immediately if it exists
    if stage_number < TOTAL_STAGES:
        next_stage = stage_number + 1
        cet_tz = pytz.timezone('Europe/Berlin')
        unlock_date = datetime.now(cet_tz)
        
        stage_unlock_dates = state.get("stage_unlock_dates", {})
        stage_unlock_dates[next_stage] = unlock_date.isoformat()
        state["stage_unlock_dates"] = stage_unlock_dates
    
    # Save state
    await game_state_manager.save_game_state(participant_code, state)
    
    logger.info(f"Participant {participant_code}: Stage {stage_number} skipped")
    return True


async def switch_stage(participant_code: str, stage_number: int) -> bool:
    """Switch to a different stage."""
    state = GAME_STATE.get(participant_code)
    if not state:
        return False
    
    state = migrate_legacy_game_state(state)
    
    # Special test mode: for TEST/ROBERTA participants, allow switching to any stage
    is_test_mode = is_test_mode_participant(participant_code)
    
    # Check if stage is available (or if in test mode, just check if stage number is valid)
    if not is_test_mode:
        available_stages = get_available_stages(participant_code)
        if stage_number not in available_stages:
            logger.warning(f"Participant {participant_code}: Attempted to switch to unavailable stage {stage_number}")
            return False
    else:
        # In test mode, just validate stage number is in valid range
        if stage_number < 1 or stage_number > TOTAL_STAGES:
            logger.warning(f"Participant {participant_code}: Attempted to switch to invalid stage {stage_number}")
            return False
    
    # Update current stage
    old_stage = state.get("current_stage", 1)
    state["current_stage"] = stage_number
    
    # Sync legacy fields with current stage progress
    stage_progress = state["stage_progress"].get(stage_number, {})
    state["clues_examined"] = stage_progress.get("clues_examined", set())
    state["suspects_interrogated"] = stage_progress.get("suspects_interrogated", set())
    
    # Mark stage as in_progress if not already completed/skipped
    if stage_progress.get("completion_status") == "not_started":
        stage_progress["completion_status"] = "in_progress"
        state["stage_progress"][stage_number] = stage_progress
    
    # Save state
    await game_state_manager.save_game_state(participant_code, state)
    
    logger.info(f"Participant {participant_code}: Switched from stage {old_stage} to stage {stage_number}")
    return True


async def start_game_handler(participant_code: str) -> List[Dict]:
    """Handle game start - return list of messages to display."""
    messages = []
    
    # Check for existing game state
    saved_state_data = await game_state_manager.load_game_state(participant_code)
    
    if saved_state_data and saved_state_data.get("state"):
        saved_state = saved_state_data["state"]
        
        # If game completed, start fresh
        if saved_state.get("game_completed"):
            logger.info(f"Participant {participant_code}: Previous game completed, starting fresh")
            await game_state_manager.delete_game_state(participant_code)
            progress_manager.clear_participant_progress(participant_code, source=TELL_SOURCE)
    
    # Initialize or restore game state
    if participant_code not in GAME_STATE:
        if saved_state_data and saved_state_data.get("state"):
            # Restore existing state and migrate if needed
            state = saved_state_data["state"]
            state = migrate_legacy_game_state(state)
            GAME_STATE[participant_code] = state
            logger.info(f"Participant {participant_code}: Game state restored and migrated")
        else:
            GAME_STATE[participant_code] = initialize_game_state(participant_code)
            logger.info(f"Participant {participant_code}: Game state initialized")
    else:
        # Ensure in-memory state is migrated
        GAME_STATE[participant_code] = migrate_legacy_game_state(GAME_STATE[participant_code])
    
    state = GAME_STATE[participant_code]
    episode = state.get("current_stage", 1)
    episode_messages = state.get("episode_messages", {})
    # Keys may be int (in-memory) or str (after JSON load)
    ep_key = str(episode)
    stored = episode_messages.get(episode, episode_messages.get(ep_key, []))
    
    # Return stored messages when user returns to an already-visited episode
    if stored:
        personalized_stored, changed = _personalize_questionnaire_links_in_messages(
            stored, participant_code, state
        )
        if changed:
            stored_key = episode if episode in episode_messages else ep_key
            episode_messages[stored_key] = personalized_stored
            state["episode_messages"] = episode_messages
            await game_state_manager.save_game_state(participant_code, state)
        return personalized_stored
    
    # Onboarding (welcome + language level) only for episode 1. Episodes 2+ start with case intro.
    if episode != 1:
        messages = await handle_case_intro(participant_code, "case_intro_begin")
        episode_messages[ep_key] = episode_messages.get(episode, episode_messages.get(ep_key, [])) + messages
        state["episode_messages"] = episode_messages
        await game_state_manager.save_game_state(participant_code, state)
        return messages
    
    # Start with welcome message (episode 1 only)
    welcome_text = load_system_prompt(get_game_text_path("onboarding_1_welcome.txt", episode))
    welcome_text = _personalize_questionnaire_links_in_text(welcome_text, participant_code, state)
    
    # Log system message
    log_message("system", welcome_text, participant_code)
    
    message_id = generate_message_id()
    save_message_to_cache(message_id, welcome_text)
    messages.append({
        "type": "system",
        "content": welcome_text,
        "message_id": message_id,
        "message_style": "tutor",
        "show_explain": True,
        "buttons": [
            {"text": "🎯 Find Your Language Level", "action": "onboarding_step5"}
        ]
    })
    
    state["onboarding_step"] = "welcome_shown"
    episode_messages[ep_key] = episode_messages.get(episode, episode_messages.get(ep_key, [])) + messages
    state["episode_messages"] = episode_messages
    
    # Save state
    await game_state_manager.save_game_state(participant_code, state)
    
    return messages


async def handle_onboarding_button(participant_code: str, action: str) -> List[Dict]:
    """Handle onboarding button clicks."""
    messages = []
    state = GAME_STATE.get(participant_code)
    
    if not state:
        return [{"type": "error", "content": "Game not initialized. Please restart."}]
    
    if action == "onboarding_step5":
        episode = state.get("current_stage", 1)
        # Show language level selection text first (without buttons)
        language_level_text = load_system_prompt(get_game_text_path("onboarding_4_language_level.txt", episode))
        
        # Log first message
        log_message("system", language_level_text, participant_code)
        
        message_id1 = generate_message_id()
        save_message_to_cache(message_id1, language_level_text)
        messages.append({
            "type": "system",
            "content": language_level_text,
            "message_id": message_id1,
            "message_style": "tutor",
            "show_explain": True
        })
        
        # Then show intro-B1 text separately with typewriter style and buttons
        intro_b1_text = load_system_prompt(get_game_text_path("intro-B1.txt", episode))
        
        # Log second message
        log_message("system", intro_b1_text, participant_code)
        
        message_id2 = generate_message_id()
        save_message_to_cache(message_id2, intro_b1_text)
        messages.append({
            "type": "system",
            "content": intro_b1_text,
            "message_id": message_id2,
            "show_explain": True,
            "typewriter_style": True,
            "image": "ep1/aric-cheng-7Bv9MrBan9s-unsplash.jpg",
            "buttons": [
                {"text": "Easier", "action": "language_adjust_easier"},
                {"text": "Perfect!", "action": "language_confirm"},
                {"text": "More Advanced", "action": "language_adjust_more_advanced"}
            ]
        })
        
        state["onboarding_step"] = "language_selection"
        state["current_language_level"] = "B1"  # Default to B1
        state["current_intro_text"] = intro_b1_text
    
    # Save state
    await game_state_manager.save_game_state(participant_code, state)
    
    return messages


async def handle_language_adjustment(participant_code: str, action: str) -> List[Dict]:
    """Handle language level adjustments (easier/more advanced)."""
    messages = []
    state = GAME_STATE.get(participant_code)
    
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]
    
    current_level = state.get("current_language_level", "B1")
    episode = state.get("current_stage", 1)
    language_level_text = load_system_prompt(get_game_text_path("onboarding_4_language_level.txt", episode))
    
    # Determine new level and intro text
    if action == "language_adjust_easier":
        if current_level == "B2":
            new_level = "B1"
            intro_text = load_system_prompt(get_game_text_path("intro-B1.txt", episode))
            buttons = [
                {"text": "Easier", "action": "language_adjust_easier"},
                {"text": "Perfect!", "action": "language_confirm"},
                {"text": "More Advanced", "action": "language_adjust_more_advanced"}
            ]
        elif current_level == "B1":
            new_level = "A2"
            intro_text = load_system_prompt(get_game_text_path("intro-A2.txt", episode))
            buttons = [
                {"text": "Perfect!", "action": "language_confirm"},
                {"text": "More Advanced", "action": "language_adjust_more_advanced"}
            ]
        else:
            # Already at A2, can't go easier
            return messages
    
    elif action == "language_adjust_more_advanced":
        if current_level == "A2":
            new_level = "B1"
            intro_text = load_system_prompt(get_game_text_path("intro-B1.txt", episode))
            buttons = [
                {"text": "Easier", "action": "language_adjust_easier"},
                {"text": "Perfect!", "action": "language_confirm"},
                {"text": "More Advanced", "action": "language_adjust_more_advanced"}
            ]
        elif current_level == "B1":
            new_level = "B2"
            intro_text = load_system_prompt(get_game_text_path("intro-B2.txt", episode))
            buttons = [
                {"text": "Easier", "action": "language_adjust_easier"},
                {"text": "Perfect!", "action": "language_confirm"}
            ]
        else:
            # Already at B2, can't go more advanced
            return messages
    
    else:
        return messages
    
    # Update state
    state["current_language_level"] = new_level
    state["current_intro_text"] = intro_text
    
    # Show updated intro text (old message will be removed by frontend)
    # Log system message
    log_message("system", intro_text, participant_code)
    
    message_id = generate_message_id()
    save_message_to_cache(message_id, intro_text)
    intro_message = {
        "type": "system",
        "content": intro_text,
        "message_id": message_id,
        "show_explain": True,
        "typewriter_style": True,
        "buttons": buttons
    }
    intro_message["image"] = "ep1/aric-cheng-7Bv9MrBan9s-unsplash.jpg"
    messages.append(intro_message)
    
    # Save state
    await game_state_manager.save_game_state(participant_code, state)
    
    return messages


async def handle_language_confirmation(participant_code: str) -> List[Dict]:
    """Handle language level confirmation and proceed to game."""
    messages = []
    state = GAME_STATE.get(participant_code)
    
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]
    
    # Get confirmed level
    level = state.get("current_language_level", "B1")
    episode = state.get("current_stage", 1)
    
    # Show confirmation
    level_confirmed_text = load_system_prompt(get_game_text_path("level_confirmed.txt", episode))
    confirmed_text = level_confirmed_text.replace("[LEVEL]", level.upper())
    
    # Log system message
    log_message("system", confirmed_text, participant_code)
    
    message_id = generate_message_id()
    save_message_to_cache(message_id, confirmed_text)
    messages.append({
        "type": "system",
        "content": confirmed_text,
        "message_id": message_id,
        "message_style": "tutor",
        "show_explain": True,
        "buttons": [
            {"text": "Start Investigation!", "action": "case_intro_begin"}
        ]
    })
    
    state["onboarding_step"] = "language_selected"
    
    # Save state
    await game_state_manager.save_game_state(participant_code, state)
    
    return messages


def _normalize_intro_step(entry):
    """Normalize intro_files entry (dict or str) to {file, type, image, character}."""
    if isinstance(entry, dict):
        return {
            "file": entry["file"],
            "type": entry.get("type", "character"),
            "image": entry.get("image"),
            "character": entry.get("character", "nina"),
        }
    return {
        "file": entry,
        "type": "character",
        "image": None,
        "character": "nina",
    }


def _load_intro_file_safe(filename: str, episode: int) -> str:
    """Load intro file; return fallback text if file missing (no error)."""
    path = get_game_text_path(filename, episode)
    content = load_system_prompt(path)
    if content.strip() == "You are a helpful assistant.":
        logger.warning(f"Intro file missing or unreadable: {filename} for ep{episode}")
        return "Continue."
    return content


async def handle_case_intro(participant_code: str, action: str) -> List[Dict]:
    """Handle case introduction sequence. Driven by STAGE_CONFIG[episode][intro_files]; length may vary per episode."""
    messages = []
    state = GAME_STATE.get(participant_code)
    
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]
    
    episode = state.get("current_stage", 1)
    intro_files = STAGE_CONFIG.get(episode, {}).get("intro_files", [])
    
    if action == "case_intro_begin":
        if not intro_files:
            return await start_investigation(participant_code)
        step = 0
        state["case_intro_step"] = step
    elif action == "case_intro_next":
        step = state.get("case_intro_step", 0) + 1
        if step >= len(intro_files):
            return await start_investigation(participant_code)
        state["case_intro_step"] = step
    else:
        return messages
    
    entry = _normalize_intro_step(intro_files[step])
    raw_content = _load_intro_file_safe(entry["file"], episode)
    content, parsed_buttons = _extract_buttons_from_text(raw_content)
    default_intro_sender = entry.get("character", "nina") if entry["type"] == "character" else "narrator"
    content_blocks = _extract_scripted_message_blocks(content, default_sender=default_intro_sender)
    if not content_blocks:
        content_blocks = [(default_intro_sender, "Continue.")]
    default_button_text = "🔍 Game Menu" if step >= len(intro_files) - 1 else "Next"
    fallback_buttons = [{"text": default_button_text, "action": "case_intro_next"}]

    buttons = parsed_buttons or fallback_buttons
    for index, (block_sender, content_part) in enumerate(content_blocks):
        resolved_intro_sender = block_sender or default_intro_sender
        log_role = resolved_intro_sender if entry["type"] == "character" else "narrator"
        log_message(log_role, content_part, participant_code)

        message_id = generate_message_id()
        is_last_part = index == len(content_blocks) - 1
        if entry["type"] == "character":
            char_key = resolved_intro_sender
            save_message_to_cache(message_id, content_part, char_key)
            char_data = CHARACTER_DATA.get(char_key, {})
            msg = {
                "type": "character",
                "character": char_key,
                "character_name": char_data.get("full_name", "Nina"),
                "character_image": char_data.get("image") or "nina.png",
                "content": content_part,
                "message_id": message_id,
                "show_explain": True,
            }
        else:
            save_message_to_cache(message_id, content_part)
            msg = {
                "type": "system",
                "content": content_part,
                "message_id": message_id,
                "show_explain": True,
            }

        if is_last_part:
            msg["buttons"] = buttons
        if index == 0 and entry.get("image"):
            msg["image"] = entry["image"]
        messages.append(msg)

    _sync_last_public_responder_for_public_mode(state, messages)
    await game_state_manager.save_game_state(participant_code, state)
    return messages


async def start_investigation(participant_code: str) -> List[Dict]:
    """Mark investigation started and show main menu. No file is loaded here (last intro step is shown in handle_case_intro)."""
    state = GAME_STATE.get(participant_code)
    
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]
    
    state["onboarding_step"] = "investigation_started"
    if not state.get("game_start_at"):
        cet_tz = pytz.timezone('Europe/Berlin')
        state["game_start_at"] = datetime.now(cet_tz).isoformat()
    _ensure_absolute_stage_unlock_schedule(state)
    await game_state_manager.save_game_state(participant_code, state)
    
    return await handle_main_menu(participant_code)


async def handle_location_transition(participant_code: str, action: str) -> List[Dict]:
    """Handle transitions between episode 2 locations."""
    state = GAME_STATE.get(participant_code)

    if not state:
        return [{"type": "error", "content": "Game not initialized."}]

    target_location = EP2_LOCATION_ACTIONS.get(action)
    if not target_location:
        return [{"type": "error", "content": "Unknown location action."}]

    stage_number = state.get("current_stage", 1)
    if stage_number != 2:
        return [{"type": "error", "content": "This action is available only in episode 2."}]

    locations = STAGE_CONFIG.get(2, {}).get("locations", {})
    if target_location not in locations:
        return [{"type": "error", "content": "Location is not configured."}]

    set_stage_location(state, 2, target_location)
    state["mode"] = "public"
    state["current_character"] = None
    state["onboarding_step"] = "investigation_started"

    await game_state_manager.save_game_state(participant_code, state)

    location_name = locations.get(target_location, {}).get("name", target_location)
    transition_text = f"You arrived at: {location_name}."
    log_message("system", transition_text, participant_code)

    messages = [{"type": "system", "content": transition_text}]
    messages.extend(await handle_main_menu(participant_code))
    if target_location == "university_ep2":
        messages.append(
            {
                "type": "system",
                "content": "If you are ready, hand James the USB so he can inspect the files.",
                "buttons": [{"text": EP2_USB_SHARE_BUTTON_TEXT, "action": EP2_USB_SHARE_ACTION}],
                "button_note": EP2_USB_SHARE_BUTTON_NOTE,
            }
        )
    return messages


async def handle_main_menu(participant_code: str) -> List[Dict]:
    """Show main game menu."""
    messages = []
    state = GAME_STATE.get(participant_code)
    
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]
    
    menu_text = "What would you like to do?"
    
    # Log menu message
    log_message("menu", menu_text, participant_code)
    
    buttons = []
    if not _ep1_dialogs_closed(state):
        buttons.append({"text": "Talk to Someone", "action": "menu_talk"})
    buttons.append({"text": "Open Case Materials", "action": "menu_evidence"})
    
    messages.append({
        "type": "menu",
        "content": menu_text,
        "buttons": buttons,
    })
    
    return messages


async def handle_menu_talk(participant_code: str) -> List[Dict]:
    """Show character selection for talking (characters for current episode)."""
    messages = []
    state = GAME_STATE.get(participant_code)
    
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]
    
    if _ep1_dialogs_closed(state):
        return [
            {
                "type": "system",
                "content": "The investigation is closed — you can review the chat above, but you can't start new conversations.",
                "buttons": [{"text": "⬅️ Back to Main Menu", "action": "show_main_menu"}],
                "show_explain": False,
            }
        ]
    
    current_stage = state.get("current_stage", 1)
    character_keys = get_characters_for_stage(state, current_stage)

    buttons = []
    if len(character_keys) > 1:
        buttons.append({"text": "💬 Talk to Everyone (Public)", "action": "mode_public"})
    
    for key in character_keys:
        if key in CHARACTER_DATA:
            char_data = CHARACTER_DATA[key]
            buttons.append({
                "text": f"Talk to {char_data['full_name']}",
                "action": f"talk_{key}"
            })
    
    buttons.append({"text": "⬅️ Back to Main Menu", "action": "show_main_menu"})
    
    menu_text = "Choose your conversation partner:"
    
    # Log menu message
    log_message("menu", menu_text, participant_code)
    
    messages.append({
        "type": "menu",
        "content": menu_text,
        "buttons": buttons
    })
    
    return messages


async def handle_character_talk(participant_code: str, character_key: str) -> List[Dict]:
    """Initiate conversation with a specific character."""
    messages = []
    state = GAME_STATE.get(participant_code)
    
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]
    
    if character_key not in CHARACTER_DATA:
        return [{"type": "error", "content": "Invalid character."}]

    if _ep1_dialogs_closed(state):
        return [_ep1_dialogs_closed_reply()]

    current_stage = state.get("current_stage", 1)
    available_characters = set(get_characters_for_stage(state, current_stage))
    if character_key not in available_characters:
        return [{"type": "error", "content": "Character is not available in this location."}]
    
    # Set mode to private
    state["mode"] = "private"
    state["current_character"] = character_key
    _clear_public_followup_lock(state)

    # Only send opening line once per character and episode.
    # On subsequent returns to the same private chat, frontend reuses stored history.
    if _has_private_history_for_character(state, character_key):
        await game_state_manager.save_game_state(participant_code, state)
        return []

    current_language_level = state.get("current_language_level", "B1")
    current_location = get_stage_location(state, current_stage)
    system_prompt = combine_character_prompt(character_key, current_language_level, current_stage, current_location)
    char_data = CHARACTER_DATA[character_key]

    # Director cue for the first private line from the selected character.
    private_opening_trigger = (
        "The detective wants to speak with you in private right now. "
        "Say a short first line to open the private dialogue in one brief sentence. "
        "Stay fully in character."
    )

    try:
        opener_reply = await ask_for_dialogue(
            participant_code,
            private_opening_trigger,
            system_prompt,
            character_key,
            participant_code,
        )
    except Exception as exc:
        logger.error(
            "Failed to generate private opener for '%s' (participant %s): %s",
            character_key,
            participant_code,
            exc,
        )
        opener_reply = ""

    if opener_reply and opener_reply.strip():
        opener_reply = opener_reply.strip()
        message_id = generate_message_id()
        save_message_to_cache(message_id, opener_reply, character_key)
        log_message(f"character_{character_key}", opener_reply, participant_code)
        messages.append(
            {
                "type": "character",
                "character": character_key,
                "character_name": char_data["full_name"],
                "character_image": char_data.get("image"),
                "content": opener_reply,
                "message_id": message_id,
                "chat_scope": f"private:{character_key}",
                "show_explain": True,
            }
        )
    else:
        # Fallback to configured opener text files for resiliency.
        opener_text = get_private_dialogue_opener(state, current_stage, character_key)
        if opener_text:
            sender_key, opener_without_sender = _extract_sender_from_text(opener_text)
            opener_text, opener_buttons = _extract_buttons_from_text(opener_without_sender)
            if opener_text and opener_text.strip():
                opener_message = _build_character_message_for_sender(participant_code, opener_text, sender_key or "narrator")
                if opener_buttons:
                    opener_message["buttons"] = opener_buttons
                opener_message["chat_scope"] = f"private:{character_key}"
                messages.append(opener_message)
        elif character_key in CHARACTER_DATA:
            # Guaranteed short opener if both AI and file opener are unavailable.
            fallback_line = "I'm here. What do you want to ask me?"
            message_id = generate_message_id()
            save_message_to_cache(message_id, fallback_line, character_key)
            log_message(f"character_{character_key}", fallback_line, participant_code)
            messages.append(
                {
                    "type": "character",
                    "character": character_key,
                    "character_name": char_data["full_name"],
                    "character_image": char_data.get("image"),
                    "content": fallback_line,
                    "message_id": message_id,
                    "chat_scope": f"private:{character_key}",
                    "show_explain": True,
                }
            )
    
    # Save state
    await game_state_manager.save_game_state(participant_code, state)
    
    return messages


async def handle_private_message(participant_code: str, message_text: str) -> List[Dict]:
    """Handle message in private conversation mode."""
    messages = []
    state = GAME_STATE.get(participant_code)
    
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]
    
    if _ep1_dialogs_closed(state):
        return [_ep1_dialogs_closed_reply()]
    
    char_key = state.get("current_character")
    
    if not char_key or char_key not in CHARACTER_DATA:
        return [{"type": "error", "content": "No active character conversation."}]
    
    char_data = CHARACTER_DATA[char_key]
    current_language_level = state.get("current_language_level", "B1")
    current_stage = state.get("current_stage", 1)
    current_location = get_stage_location(state, current_stage)

    _update_ep1_private_progress(state, char_key)

    system_prompt = combine_character_prompt(char_key, current_language_level, current_stage, current_location)
    
    # Create context trigger
    topic_memory = state.get("topic_memory", {"topic": "None", "spoken": [], "predefined_used": []})
    context_trigger = f"The detective is asking you a question: '{message_text}'. Current topic: {topic_memory.get('topic', 'None')}."
    context_trigger += " Respond as your character."
    
    logger.info(f"Participant {participant_code}: Direct character conversation with '{char_key}'")
    debug_mode_enabled = _is_debug_mode_enabled(state, participant_code)
    
    # Log user message
    log_message("user", message_text, participant_code)

    if debug_mode_enabled:
        debug_snapshot = _build_private_input_debug_snapshot(
            participant_code=participant_code,
            state=state,
            char_key=char_key,
            system_prompt=system_prompt,
            context_trigger=context_trigger,
        )
        _append_debug_message(messages, debug_snapshot)
    
    try:
        reply_text = await ask_for_dialogue(
            participant_code,
            context_trigger,
            system_prompt,
            char_key,
            participant_code
        )
        if debug_mode_enabled:
            _append_contradiction_guard_debug_message(messages, state)
        
        if reply_text:
            message_id = generate_message_id()
            save_message_to_cache(message_id, reply_text, char_key)
            
            # Log character response
            log_message(f"character_{char_key}", reply_text, participant_code)
            
            messages.append({
                "type": "character",
                "character": char_key,
                "character_name": char_data["full_name"],
                "character_image": char_data.get("image"),
                "content": reply_text,
                "message_id": message_id,
                "chat_scope": f"private:{char_key}",
                "show_explain": True
            })
        else:
            logger.error(f"Character '{char_key}' generated empty reply")
            messages.append({
                "type": "character",
                "character": char_key,
                "character_name": char_data["full_name"],
                "character_image": char_data.get("image"),
                "content": "[Character is thinking...]",
                "chat_scope": f"private:{char_key}",
                "show_explain": False
            })
    except Exception as e:
        logger.error(f"Failed to get character reply from '{char_key}': {e}")
        messages.append({
            "type": "character",
            "character": char_key,
            "character_name": char_data["full_name"],
            "character_image": char_data.get("image"),
            "content": "[Character is thinking...]",
            "chat_scope": f"private:{char_key}",
            "show_explain": False
        })
    
    # Save state
    if _should_unlock_ep1_part2(state):
        set_stage_location(state, 1, EP1_PART2_LOCATION)
        state["ep1_phase2_unlocked"] = True
        entrance_message = _build_ep1_pauline_entrance_message(participant_code)
        if entrance_message:
            messages.append(entrance_message)

    await game_state_manager.save_game_state(participant_code, state)
    
    return messages


async def handle_nina_message(participant_code: str, message_text: str) -> List[Dict]:
    """Handle message to Nina (mentor/guide character)."""
    messages = []
    state = GAME_STATE.get(participant_code)
    
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]
    
    if _ep1_dialogs_closed(state):
        return [_ep1_dialogs_closed_reply()]
    
    char_key = "nina"
    char_data = CHARACTER_DATA.get(char_key)
    
    if not char_data:
        return [{"type": "error", "content": "Nina character not found."}]
    
    # Load Nina's prompt (episode-aware path; she doesn't need language level adjustments as she's a mentor)
    current_stage = state.get("current_stage", 1)
    current_location = get_stage_location(state, current_stage)
    system_prompt = load_system_prompt(get_prompt_path(char_key, current_stage, current_location))
    
    # Create context trigger for mentor guidance
    context_trigger = f"The detective is asking you for help: '{message_text}'. Provide supportive guidance and hints to help them progress in their investigation."
    
    logger.info(f"Participant {participant_code}: Message to Nina (mentor)")
    
    # Log user message
    log_message("user", message_text, participant_code)
    
    try:
        reply_text = await ask_for_dialogue(
            participant_code,
            context_trigger,
            system_prompt,
            char_key,
            participant_code
        )
        
        if reply_text:
            message_id = generate_message_id()
            save_message_to_cache(message_id, reply_text, char_key)
            
            # Log Nina's response
            log_message(f"character_{char_key}", reply_text, participant_code)
            
            messages.append({
                "type": "character",
                "character": char_key,
                "character_name": char_data["full_name"],
                "character_image": char_data.get("image"),
                "content": reply_text,
                "message_id": message_id,
                "show_explain": True
            })
        else:
            logger.error(f"Nina generated empty reply")
            messages.append({
                "type": "character",
                "character": char_key,
                "character_name": char_data["full_name"],
                "character_image": char_data.get("image"),
                "content": "[Nina is thinking...]",
                "show_explain": False
            })
    except Exception as e:
        logger.error(f"Failed to get reply from Nina: {e}")
        messages.append({
            "type": "character",
            "character": char_key,
            "character_name": char_data["full_name"],
            "character_image": char_data.get("image"),
            "content": "[Nina is thinking...]",
            "show_explain": False
        })
    
    # Save state
    await game_state_manager.save_game_state(participant_code, state)
    
    return messages


async def handle_public_message(participant_code: str, message_text: str) -> List[Dict]:
    """Handle message in public conversation mode with direct routing."""
    messages = []
    state = GAME_STATE.get(participant_code)
    
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]
    
    if _ep1_dialogs_closed(state):
        return [_ep1_dialogs_closed_reply()]
    
    current_stage = state.get("current_stage", 1)
    current_location = get_stage_location(state, current_stage)
    stage_characters = set(get_characters_for_stage(state, current_stage))
    debug_mode_enabled = _is_debug_mode_enabled(state, participant_code)

    if current_stage == 2 and current_location == EP2_DEFAULT_LOCATION:
        return await handle_nina_message(participant_code, message_text)

    if current_stage == 2 and current_location in EP2_SCRIPTED_LOCATIONS:
        return await _handle_ep2_scripted_public_message(
            participant_code,
            message_text,
            state,
            current_stage,
            current_location,
            stage_characters,
        )

    # First, check for direct character addressing
    from .predefined_responses import (
        extract_character_from_message_strict,
        resolve_character_from_singular_you,
    )
    
    group_address_detected = _is_public_group_address(message_text)
    locked_character_key, lock_remaining = _get_public_followup_lock(state)
    if locked_character_key and locked_character_key not in stage_characters:
        if debug_mode_enabled:
            _append_debug_message(
                messages,
                f"Cleared follow-up lock for '{locked_character_key}' because character is not active in this location.",
            )
        _clear_public_followup_lock(state)
        locked_character_key, lock_remaining = None, 0

    character_key = extract_character_from_message_strict(message_text)
    direct_address_basis = "explicit_character_mention" if character_key else None
    implied_character_key = None
    if not character_key and not group_address_detected:
        implied_character_key = resolve_character_from_singular_you(
            message_text,
            state.get("last_public_responder"),
        )
        if implied_character_key in stage_characters:
            character_key = implied_character_key
            direct_address_basis = "singular_you_to_last_public_responder"
            if debug_mode_enabled:
                _append_debug_message(
                    messages,
                    f"Resolved singular 'you' to '{character_key}' from last_public_responder.",
                )
        elif implied_character_key and debug_mode_enabled:
            _append_debug_message(
                messages,
                f"Singular 'you' pointed to '{implied_character_key}', but character is not active in this location.",
            )

    if group_address_detected and locked_character_key:
        if debug_mode_enabled:
            _append_debug_message(
                messages,
                f"Cleared follow-up lock for '{locked_character_key}' due to explicit group addressing.",
            )
        _clear_public_followup_lock(state)
        locked_character_key, lock_remaining = None, 0

    if (
        not character_key
        and not group_address_detected
        and locked_character_key
        and lock_remaining > 0
        and locked_character_key in stage_characters
    ):
        character_key = locked_character_key
        direct_address_basis = "sticky_followup_after_singular_you"
        lock_remaining -= 1
        if lock_remaining > 0:
            _set_public_followup_lock(state, locked_character_key, lock_remaining)
        else:
            _clear_public_followup_lock(state)
        if debug_mode_enabled:
            _append_debug_message(
                messages,
                f"Sticky follow-up routing to '{character_key}'. Remaining locked public turns: {lock_remaining}.",
            )

    if (
        character_key
        and locked_character_key
        and character_key != locked_character_key
    ):
        if debug_mode_enabled:
            _append_debug_message(
                messages,
                f"Cleared follow-up lock for '{locked_character_key}' because player directly addressed '{character_key}'.",
            )
        _clear_public_followup_lock(state)

    if character_key and character_key in CHARACTER_DATA and character_key in stage_characters:
        # Handle direct character addressing
        char_data = CHARACTER_DATA[character_key]
        if debug_mode_enabled:
            _append_debug_message(
                messages,
                f"Routing basis: direct addressing ({direct_address_basis}); director is skipped.",
            )
        
        # Get current language level and episode for prompt resolution
        current_language_level = state.get("current_language_level", "B1")
        system_prompt = combine_character_prompt(character_key, current_language_level, current_stage, current_location)
        
        logger.info(f"Participant {participant_code}: Direct addressing detected for character '{character_key}'")
        
        # Log user message
        log_message("user", message_text, participant_code)

        if debug_mode_enabled:
            debug_snapshot = _build_public_input_debug_snapshot(
                participant_code=participant_code,
                state=state,
                char_key=character_key,
                system_prompt=system_prompt,
                user_input=message_text,
            )
            _append_debug_message(messages, debug_snapshot)
        
        try:
            reply_text = await ask_for_dialogue(
                participant_code,
                message_text,
                system_prompt,
                character_key
            )
            if debug_mode_enabled:
                _append_contradiction_guard_debug_message(messages, state)
            
            if reply_text:
                message_id = generate_message_id()
                save_message_to_cache(message_id, reply_text, character_key)
                
                # Log character response
                log_message(f"character_{character_key}", reply_text, participant_code)
                state["last_public_responder"] = character_key
                if direct_address_basis == "singular_you_to_last_public_responder":
                    _set_public_followup_lock(state, character_key, PUBLIC_FOLLOWUP_LOCK_TURNS)
                elif direct_address_basis == "sticky_followup_after_singular_you" and lock_remaining <= 0:
                    _clear_public_followup_lock(state)
                
                messages.append({
                    "type": "character",
                    "character": character_key,
                    "character_name": char_data["full_name"],
                    "character_image": char_data.get("image"),
                    "content": reply_text,
                    "message_id": message_id,
                    "show_explain": True
                })
            else:
                logger.error(f"Character '{character_key}' generated empty reply for direct addressing")
                messages.append({
                    "type": "character",
                    "character": character_key,
                    "character_name": char_data["full_name"],
                    "character_image": char_data.get("image"),
                    "content": "[Character is thinking...]",
                    "show_explain": False
                })
        except Exception as e:
            logger.error(f"Failed to get direct character reply from '{character_key}': {e}")
            messages.append({
                "type": "character",
                "character": character_key,
                "character_name": char_data["full_name"],
                "character_image": char_data.get("image"),
                "content": "[Character is thinking...]",
                "show_explain": False
            })
        
        # Save state
        await game_state_manager.save_game_state(participant_code, state)
        
        return messages
    
    # No direct addressing: keep predefined topic routing and remove AI director layer.
    from .predefined_responses import try_predefined_response

    topic_memory = state.setdefault("topic_memory", {"topic": "None", "spoken": [], "predefined_used": []})
    topic_memory.setdefault("topic", "None")
    topic_memory.setdefault("spoken", [])
    topic_memory.setdefault("predefined_used", [])

    # Log user message
    log_message("user", message_text, participant_code)

    selected_characters: List[str] = []
    predefined_decision = try_predefined_response(participant_code, message_text, topic_memory)

    if predefined_decision:
        new_topic = predefined_decision.get("new_topic", topic_memory.get("topic", "None"))
        previous_topic = topic_memory.get("topic", "None")
        topic_memory["topic"] = new_topic
        if new_topic != previous_topic:
            topic_memory["spoken"] = []

        scene = predefined_decision.get("scene", [])
        for scene_action in scene:
            action_type = scene_action.get("action")
            if action_type not in ["character_reply", "character_reaction"]:
                continue
            data = scene_action.get("data", {})
            char_key = data.get("character_key")
            if (
                char_key in CHARACTER_DATA
                and char_key in stage_characters
                and char_key not in selected_characters
            ):
                selected_characters.append(char_key)

        if debug_mode_enabled:
            _append_debug_message(messages, "Routing basis: predefined topic routing without director.")
            _append_debug_message(
                messages,
                f"Predefined decision JSON: {json.dumps(predefined_decision, ensure_ascii=False)}",
            )

    if not selected_characters:
        selected_characters = sorted(char for char in stage_characters if char in CHARACTER_DATA)
        if debug_mode_enabled:
            _append_debug_message(messages, "Routing basis: no predefined match; all active characters respond.")

    if not selected_characters:
        messages.append({"type": "system", "content": "The investigation continues..."})
        await game_state_manager.save_game_state(participant_code, state)
        return messages

    logger.info(
        f"Participant {participant_code}: Public routing selected responders: {selected_characters}"
    )

    for char_key in selected_characters:
        char_data = CHARACTER_DATA[char_key]

        current_language_level = state.get("current_language_level", "B1")
        current_stage = state.get("current_stage", 1)
        current_location = get_stage_location(state, current_stage)
        system_prompt = combine_character_prompt(char_key, current_language_level, current_stage, current_location)

        if debug_mode_enabled:
            debug_snapshot = _build_public_input_debug_snapshot(
                participant_code=participant_code,
                state=state,
                char_key=char_key,
                system_prompt=system_prompt,
                user_input=message_text,
            )
            _append_debug_message(messages, debug_snapshot)

        try:
            reply_text = await ask_for_dialogue(
                participant_code,
                message_text,
                system_prompt,
                char_key
            )
            if debug_mode_enabled:
                _append_contradiction_guard_debug_message(messages, state)

            if reply_text:
                message_id = generate_message_id()
                save_message_to_cache(message_id, reply_text, char_key)
                log_message(f"character_{char_key}", reply_text, participant_code)

                messages.append({
                    "type": "character",
                    "character": char_key,
                    "character_name": char_data["full_name"],
                    "character_image": char_data.get("image"),
                    "content": reply_text,
                    "message_id": message_id,
                    "show_explain": True
                })

                if char_key not in topic_memory["spoken"]:
                    topic_memory["spoken"].append(char_key)
                state["last_public_responder"] = char_key
            else:
                logger.error(f"Character '{char_key}' generated empty reply")
                messages.append({
                    "type": "character",
                    "character": char_key,
                    "character_name": char_data["full_name"],
                    "character_image": char_data.get("image"),
                    "content": "[Character is thinking...]",
                    "show_explain": False
                })

        except Exception as e:
            logger.error(f"Failed to get character reply from '{char_key}': {e}")
            messages.append({
                "type": "character",
                "character": char_key,
                "character_name": char_data["full_name"],
                "character_image": char_data.get("image"),
                "content": "[Character is thinking...]",
                "show_explain": False
            })
    
    # Save state
    await game_state_manager.save_game_state(participant_code, state)
    
    return messages


async def handle_mode_public(participant_code: str) -> List[Dict]:
    """Switch to public mode."""
    messages = []
    state = GAME_STATE.get(participant_code)
    
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]
    
    state["mode"] = "public"
    state["current_character"] = None
    
    if _ep1_dialogs_closed(state):
        log_message("system", "Public mode (case closed)", participant_code)
        await game_state_manager.save_game_state(participant_code, state)
        return [
            {
                "type": "system",
                "content": "You're viewing the group chat. The case is closed — new messages are disabled.",
                "show_explain": False,
                "ui": {"switchToPublicMode": True},
            }
        ]
    
    mode_text = "You're now speaking with everyone in public. Ask your questions!"
    
    # Log system message
    log_message("system", mode_text, participant_code)
    
    messages.append({
        "type": "system",
        "content": mode_text,
        "message_style": "narrator",
    })
    
    # Save state
    await game_state_manager.save_game_state(participant_code, state)
    
    return messages


async def handle_menu_evidence(participant_code: str) -> List[Dict]:
    """Show evidence/clue selection menu."""
    messages = []
    state = GAME_STATE.get(participant_code)
    
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]
    
    current_stage = state.get("current_stage", 1)
    clues_count = get_clues_count_for_stage(current_stage, state)

    buttons = []
    if current_stage == 1 and state.get("ep1_usb_drive_unlocked"):
        clue_ids = ["4", "1", "2", "3"]
    else:
        clue_ids = [str(i) for i in range(1, clues_count + 1)]

    for clue_id in clue_ids:
        try:
            clue_num = int(clue_id)
        except (TypeError, ValueError):
            continue
        if clue_num < 1 or clue_num > clues_count:
            continue
        clue_name = get_clue_name_for_stage(current_stage, clue_id)
        buttons.append({
            "text": f"🔍 {clue_name}",
            "action": f"examine_clue_{clue_id}"
        })
    
    buttons.append({"text": "⬅️ Back to Main Menu", "action": "show_main_menu"})
    
    menu_text = "Select evidence to examine:"
    
    # Log menu message
    log_message("menu", menu_text, participant_code)
    
    messages.append({
        "type": "menu",
        "content": menu_text,
        "buttons": buttons
    })
    
    return messages


async def handle_clue_examination(participant_code: str, clue_id: str, forced_stage: Optional[int] = None) -> List[Dict]:
    """Handle examination of a specific clue."""
    messages = []
    state = GAME_STATE.get(participant_code)
    
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]
    
    episode = forced_stage if isinstance(forced_stage, int) and forced_stage > 0 else state.get("current_stage", 1)
    clues_count = get_clues_count_for_stage(episode, state)
    try:
        clue_number = int(clue_id)
    except (TypeError, ValueError):
        return [{"type": "error", "content": "Invalid clue id."}]

    if episode == 1 and clue_number == 4 and not state.get("ep1_usb_drive_unlocked"):
        return [{"type": "system", "content": "You don't have that evidence yet.", "show_explain": False}]

    if clue_number < 1 or clue_number > clues_count:
        return [{"type": "error", "content": "This clue is not available in the current episode."}]

    # Load clue text (episode-specific)
    clue_filepath = resolve_clue_text_path(clue_id, episode)
    try:
        clue_text = load_system_prompt(clue_filepath)
    except Exception as e:
        logger.error(f"Failed to load clue {clue_id}: {e}")
        clue_text = f"Error loading clue {clue_id}"
    
    # Mark clue as examined in state
    state.setdefault("clues_examined", set()).add(clue_id)
    # Keep stage_progress in sync with the legacy EP1 fields.
    if isinstance(state.get("stage_progress"), dict):
        stage_prog = state["stage_progress"].setdefault(episode, {})
        stage_prog.setdefault("clues_examined", set()).add(clue_id)
    
    # Log clue examination
    log_message("clue_examined", f"Clue {clue_id}: {clue_text}", participant_code)
    
    clue_image = f"ep{episode}/clue{clue_id}.png"
    if episode == 1 and clue_id == "4":
        clue_image = "ep1/plane-drive.png"

    clue_message = {
        "type": "clue",
        "clue_id": clue_id,
        "clue_name": get_clue_name_for_stage(episode, clue_id),
        "content": clue_text,
        "image": clue_image,
    }

    current_location = get_stage_location(state, episode)
    if episode == 2 and clue_id == "1" and current_location == "university_ep2":
        clue_message["buttons"] = [{"text": EP2_USB_SHARE_BUTTON_TEXT, "action": EP2_USB_SHARE_ACTION}]
        clue_message["button_note"] = EP2_USB_SHARE_BUTTON_NOTE

    messages.append(clue_message)
    
    # Save state
    await game_state_manager.save_game_state(participant_code, state)
    
    return messages


def _ep1_dialogs_closed(state: Optional[Dict]) -> bool:
    """Episode 1 ended after a final accusation (correct or last allowed wrong guess)."""
    if not state:
        return False
    return int(state.get("current_stage", 1)) == 1 and bool(state.get("game_completed", False))


def build_weekly_outro_questionnaire_text(participant_code: str, state: Optional[Dict] = None) -> str:
    """Build EP1 questionnaire outro text with personalized questionnaire/calendar links."""
    text = load_system_prompt(get_game_text_path("outro_questionnaire.txt", 1))
    personalized_link = _build_weekly_questionnaire_link(participant_code, state)
    calendar_link = _build_next_episode_calendar_link(state)
    if WEEKLY_QUESTIONNAIRE_TEMPLATE_LINK in text:
        text = text.replace(WEEKLY_QUESTIONNAIRE_TEMPLATE_LINK, personalized_link)
    else:
        text = text.replace(WEEKLY_QUESTIONNAIRE_FALLBACK_STATIC_LINK, personalized_link)
    return text.replace(NEXT_EPISODE_CALENDAR_TEMPLATE_LINK, calendar_link)


def _ep1_outro_questionnaire_message(participant_code: str, state: Optional[Dict]) -> Dict:
    text = build_weekly_outro_questionnaire_text(participant_code, state)
    return {
        "type": "system",
        "content": text,
        "image": "ep1/Ep1-final.png",
        "message_style": "tutor",
        "show_explain": False,
        "ui": {
            "caseMaterialsAccusationAvailable": False,
            "imageFirst": True,
            "ep1GameCompleted": True,
            # Pause after Tim's finale lines so the questionnaire does not pop in immediately.
            "preDisplayDelayMs": 2200,
        },
    }


def _ep1_dialogs_closed_reply() -> Dict:
    return {
        "type": "system",
        "content": "The case is closed. You can read the chat above, but the investigation won't continue.",
        "show_explain": False,
    }


# EP1 accusation flow handlers
def _ep1_accusable_suspect_keys(state: Dict) -> List[str]:
    """Suspects who may be accused in EP1 (Pauline only after part 2 / her entrance)."""
    keys = [k for k in EP1_ACCUSATION_SUSPECT_KEYS if k in CHARACTER_DATA]
    if get_stage_location(state, 1) != EP1_PART2_LOCATION:
        keys = [k for k in keys if k != "pauline"]
    excluded_keys = set(state.get("accused_wrong_keys", set()) or set())
    keys = [k for k in keys if k not in excluded_keys]
    return keys


def _get_ep1_accusation_max_attempts(state: Dict) -> int:
    """Use fewer attempts before Pauline appears in EP1 part 2."""
    if get_stage_location(state, 1) == EP1_PART2_LOCATION:
        return EP1_ACCUSATION_MAX_ATTEMPTS_AFTER_PAULINE
    return EP1_ACCUSATION_MAX_ATTEMPTS_BEFORE_PAULINE


def _build_ep1_accusation_buttons(state: Dict, include_back: bool = True) -> List[Dict[str, str]]:
    buttons = [
        {"text": f"{CHARACTER_DATA[k]['full_name']}", "action": f"accuse_{k}"}
        for k in _ep1_accusable_suspect_keys(state)
    ]
    if include_back:
        buttons.append({"text": "⬅️ Back to Main Menu", "action": "show_main_menu"})
    return buttons


def _build_ep1_accuse_tim_finale_messages(participant_code: str) -> List[Dict]:
    """Tim's scripted confession + Take the drive CTA (correct EP1 accusation or Nina-assisted finale)."""
    accused_key = EP1_ACCUSATION_CORRECT_KEY
    win_text = load_system_prompt(get_game_text_path("accuse_tim_final.txt", 1))
    win_body, win_buttons = _extract_buttons_from_text(win_text)
    win_blocks = _extract_scripted_message_blocks(win_body, default_sender=accused_key)
    if not win_blocks:
        win_blocks = [("narrator", win_text)]

    win_messages: List[Dict] = []
    for _index, (block_sender, block_text) in enumerate(win_blocks):
        msg = _build_character_message_for_sender(
            participant_code=participant_code,
            text=block_text,
            sender_key=block_sender or accused_key,
        )
        msg["show_explain"] = False
        msg["ui"] = {"caseMaterialsAccusationAvailable": False}
        win_messages.append(msg)

    if win_buttons and win_messages:
        win_messages[-1]["buttons"] = win_buttons
        win_messages[-1]["image"] = "ep1/plane-drive.png"

    return win_messages


def _build_ep1_accusation_warning_message(state: Dict) -> Dict:
    """Build the "Are you sure?" accusation warning; buttons come from accuse_warning.txt."""
    raw = load_system_prompt(get_game_text_path("accuse_warning.txt", 1))
    max_attempts = _get_ep1_accusation_max_attempts(state)
    chances_text = "1 chance" if max_attempts == 1 else f"{max_attempts} chances"
    raw = re.sub(r"\*\d+\s+chances\*", f"*{chances_text}*", raw, count=1)
    body, buttons = _extract_buttons_from_text(raw)
    return {
        "type": "system",
        "content": body,
        "buttons": buttons,
        "show_explain": False,
        # Keep the drawer button available if player chose the "not yet" path.
        "ui": {"caseMaterialsAccusationAvailable": bool(state.get("accuse_in_case_materials", False))},
    }


async def handle_accuse_offer_declined(participant_code: str) -> List[Dict]:
    """Player declined the chat offer; move accusation action into Case Materials."""
    state = GAME_STATE.get(participant_code)
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]

    episode = state.get("current_stage", 1)
    if episode != 1:
        return [{"type": "system", "content": "Accusation is available in Episode 1."}]

    state["accuse_offer_pending"] = False
    state["accuse_in_case_materials"] = True
    state["accuse_unlocked"] = False
    state["accused_character"] = None
    state["accused_wrong_keys"] = set()

    return [
        {
            "type": "system",
            "content": "Ok. You can make an accusation later from the Case Materials drawer.",
            "show_explain": False,
            "ui": {"caseMaterialsAccusationAvailable": True},
        }
    ]


async def handle_accuse_offer_accepted(participant_code: str) -> List[Dict]:
    """Player accepted the chat offer; show accusation warning immediately."""
    state = GAME_STATE.get(participant_code)
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]

    episode = state.get("current_stage", 1)
    if episode != 1:
        return [{"type": "system", "content": "Accusation is available in Episode 1."}]

    state["accuse_offer_pending"] = False
    state["accuse_in_case_materials"] = True
    state["accuse_unlocked"] = True
    state["accused_character"] = None
    state["accused_wrong_keys"] = set()

    return [_build_ep1_accusation_warning_message(state)]


async def handle_accuse_open_menu(participant_code: str) -> List[Dict]:
    """Open accusation warning from Case Materials drawer."""
    state = GAME_STATE.get(participant_code)
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]

    episode = state.get("current_stage", 1)
    if episode != 1:
        return [{"type": "system", "content": "Accusation is available in Episode 1."}]

    if _ep1_dialogs_closed(state):
        return [
            {
                "type": "system",
                "content": "The investigation is already closed.",
                "show_explain": False,
                "ui": {"caseMaterialsAccusationAvailable": False},
            }
        ]

    # Hard-stop if all accusation attempts are already used.
    attempts = int(state.get("accusation_attempts", 0))
    max_attempts = _get_ep1_accusation_max_attempts(state)
    if attempts >= max_attempts:
        return [
            {
                "type": "system",
                "content": "You already used all accusation attempts.",
                "buttons": [{"text": "⬅️ Back to Main Menu", "action": "show_main_menu"}],
                "show_explain": False,
                "ui": {"caseMaterialsAccusationAvailable": False},
            }
        ]

    # If this is triggered from private dialogue, move to public first.
    if state.get("mode") == "private":
        state["mode"] = "public"
        state["current_character"] = None
        _clear_public_followup_lock(state)
        state["accuse_offer_pending"] = False
        state["accuse_in_case_materials"] = True
        state["accuse_unlocked"] = True
        state["accused_character"] = None
        if int(state.get("accusation_attempts", 0)) <= 0:
            state["accused_wrong_keys"] = set()
        return [
            {
                "type": "system",
                "content": "Hold on - if you're ready to make your accusation, let's do it in front of everyone.",
                "show_explain": False,
                "ui": {"switchToPublicMode": True},
            },
            _build_ep1_accusation_warning_message(state),
        ]

    # Allow opening even if chat offer wasn't explicitly declined (stale UI), but keep state consistent.
    state["accuse_offer_pending"] = False
    state["accuse_unlocked"] = True
    state["accused_character"] = None
    if int(state.get("accusation_attempts", 0)) <= 0:
        state["accused_wrong_keys"] = set()

    return [_build_ep1_accusation_warning_message(state)]


async def handle_make_accusation(participant_code: str, accused_key: str) -> List[Dict]:
    """Handle final player accusation for EP1."""
    state = GAME_STATE.get(participant_code)
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]

    episode = state.get("current_stage", 1)
    if episode != 1:
        return [{"type": "system", "content": "Accusation is available in Episode 1."}]

    # Do not allow new accusations after attempts are exhausted.
    attempts = int(state.get("accusation_attempts", 0))
    max_attempts = _get_ep1_accusation_max_attempts(state)
    if attempts >= max_attempts:
        return [
            {
                "type": "system",
                "content": "You already used all accusation attempts.",
                "buttons": [{"text": "⬅️ Back to Main Menu", "action": "show_main_menu"}],
                "show_explain": False,
                "ui": {"caseMaterialsAccusationAvailable": False},
            }
        ]

    accused_key = str(accused_key or "").strip().lower()
    allowed_targets = _ep1_accusable_suspect_keys(state)
    if accused_key not in allowed_targets:
        return [{"type": "error", "content": "Unknown accusation target."}]

    if not state.get("accuse_unlocked", False):
        return [{"type": "system", "content": "You need to open Arrest Order from Case Materials first."}]

    # Reset rationale-step state once accusation is actually executed.
    state["accuse_waiting_for_reason"] = False
    state["accuse_pending_target"] = None

    # Accusations must be made in public mode.
    if state.get("mode") == "private":
        state["mode"] = "public"
        state["current_character"] = None
        _clear_public_followup_lock(state)
        return [
            {
                "type": "system",
                "content": "Hold on - if you're ready to make your accusation, let's do it in front of everyone.",
                "show_explain": False,
                "ui": {"switchToPublicMode": True},
            },
            _build_ep1_accusation_warning_message(state),
        ]

    state["accuse_offer_pending"] = False
    state["accuse_in_case_materials"] = False

    state["accused_character"] = accused_key

    # Correct accusation -> win
    if accused_key == EP1_ACCUSATION_CORRECT_KEY:
        state["game_completed"] = True
        state["accuse_unlocked"] = False
        state["accuse_in_case_materials"] = False

        # Win outro chain: USB -> outro_nina.txt -> narrator (handle_ep1_outro_narrator) -> questionnaire (outro_questionnaire).
        messages = _build_ep1_accuse_tim_finale_messages(participant_code)
        _sync_last_public_responder_for_public_mode(state, messages)
        return messages

    # Wrong accusation -> attempts & defense
    max_attempts = _get_ep1_accusation_max_attempts(state)
    state["accusation_attempts"] = int(state.get("accusation_attempts", 0)) + 1
    attempts = state["accusation_attempts"]
    wrong_keys = set(state.get("accused_wrong_keys", set()) or set())
    wrong_keys.add(accused_key)
    state["accused_wrong_keys"] = wrong_keys

    # Always show accused character defense text on wrong accusations.
    defense_filename = f"defense_{accused_key}.txt"
    defense_text = _load_game_text_optional(defense_filename, 1)
    if not defense_text:
        # Fallback if file is missing
        defense_text = "❌ That doesn't match."

    defense_buttons = []
    # If we still have attempts left, allow trying again.
    if attempts < max_attempts:
        defense_buttons = _build_ep1_accusation_buttons(state, include_back=True)

    defense_body, defense_file_buttons = _extract_buttons_from_text(defense_text)
    defense_blocks = _extract_scripted_message_blocks(defense_body, default_sender=accused_key)
    if not defense_blocks:
        defense_blocks = [("narrator", defense_text)]

    defense_messages: List[Dict] = []
    for index, (block_sender, block_text) in enumerate(defense_blocks):
        msg = _build_character_message_for_sender(
            participant_code=participant_code,
            text=block_text,
            sender_key=block_sender or accused_key,
        )
        msg["show_explain"] = False
        msg["ui"] = {"caseMaterialsAccusationAvailable": bool(state.get("accuse_in_case_materials", False))}
        if index == len(defense_blocks) - 1:
            # Keep runtime buttons (try again / back) as default, but allow override from file.
            msg["buttons"] = defense_file_buttons or defense_buttons
        defense_messages.append(msg)

    attempts_left = max(0, max_attempts - attempts)
    accused_name = CHARACTER_DATA.get(accused_key, {}).get("full_name", accused_key.title())
    wrong_accusation_msg = None
    if attempts_left > 0:
        if attempts_left == 1:
            wrong_content = f"❌ This is not {accused_name}. You have **1 more attempt** left."
        else:
            wrong_content = f"❌ This is not {accused_name}."
        wrong_accusation_msg = {
            "type": "system",
            "content": wrong_content,
            "show_explain": False,
            "ui": {"caseMaterialsAccusationAvailable": bool(state.get("accuse_in_case_materials", False))},
        }

    # If attempts are exhausted -> Nina nudge, then Tim's finale (same USB / outro chain as a correct accusation).
    if attempts >= max_attempts:
        state["game_completed"] = True
        state["accuse_unlocked"] = False
        state["accuse_in_case_materials"] = False
        state["accused_character"] = EP1_ACCUSATION_CORRECT_KEY
        nina_hint_text = _load_game_text_optional("outro_lose_nina_hint.txt", 1)
        nina_hint_body, _nina_hint_buttons = _extract_buttons_from_text(nina_hint_text or "")
        nina_hint_blocks = _extract_scripted_message_blocks(nina_hint_body, default_sender="nina")
        nina_hint_messages: List[Dict] = []
        for _idx, (block_sender, block_text) in enumerate(nina_hint_blocks):
            n_msg = _build_character_message_for_sender(
                participant_code=participant_code,
                text=block_text,
                sender_key=block_sender or "nina",
            )
            n_msg["show_explain"] = False
            n_msg["ui"] = {"caseMaterialsAccusationAvailable": False}
            nina_hint_messages.append(n_msg)
        tim_finale = _build_ep1_accuse_tim_finale_messages(participant_code)
        if tim_finale:
            first_tim = tim_finale[0]
            first_ui = dict(first_tim.get("ui") or {})
            first_ui["preDisplayDelayMs"] = EP1_NINA_LOSE_HINT_TO_TIM_FINALE_PRE_DELAY_MS
            first_tim["ui"] = first_ui
        messages = [*defense_messages, *nina_hint_messages, *tim_finale]
        _sync_last_public_responder_for_public_mode(state, messages)
        return messages

    wrong_messages = [wrong_accusation_msg] if wrong_accusation_msg else []
    messages = [*defense_messages, *wrong_messages]
    _sync_last_public_responder_for_public_mode(state, messages)
    return messages


async def handle_reveal_ep1_killer(participant_code: str) -> List[Dict]:
    """Legacy: concatenate EP1 `reveal_*.txt` (kept for API compatibility; normal play uses Tim finale)."""
    state = GAME_STATE.get(participant_code)
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]

    if state.get("current_stage", 1) != 1:
        return [{"type": "system", "content": "This reveal is available in Episode 1."}]

    parts = []
    for basename in ["reveal_2_killer.txt", "reveal_3_evidence.txt", "reveal_4_timeline.txt", "reveal_5_motive.txt"]:
        text = _load_game_text_optional(basename, 1)
        if text:
            parts.append(text)

    full_reveal = "\n\n".join(parts).strip() or "No reveal content available."

    return [
        {
            "type": "system",
            "content": full_reveal,
            "buttons": [{"text": "⬅️ Back to Main Menu", "action": "show_main_menu"}],
            "show_explain": False,
        }
    ]


# Language Learning Menu Handlers

async def handle_language_menu_difficulty(participant_code: str) -> List[Dict]:
    """Show difficulty selection menu for language level."""
    messages = []
    state = GAME_STATE.get(participant_code)
    
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]
    
    current_level = state.get("current_language_level", "B1")
    
    # Build buttons based on current level
    buttons = []
    
    if current_level != "A2":
        buttons.append({"text": "🌱 Light (A2)", "action": "difficulty_set_A2"})
    
    buttons.append({"text": "⚖️ Balanced (B1)", "action": "difficulty_set_B1"})
    
    if current_level != "B2":
        buttons.append({"text": "🚀 Advanced (B2)", "action": "difficulty_set_B2"})
    
    buttons.append({"text": "⬅️ Back", "action": "language_menu_back"})
    
    message_id = generate_message_id()
    text = f"⚙️ **Text Difficulty Settings**\n\nCurrent level: **{current_level}**\n\nChoose your preferred difficulty level:\n\n🌱 **Light (A2)** - Simple vocabulary and grammar\n⚖️ **Balanced (B1)** - Intermediate level, balanced complexity\n🚀 **Advanced (B2)** - More complex structures and vocabulary"
    
    # Log system message
    log_message("system", text, participant_code)
    
    save_message_to_cache(message_id, text)
    
    messages.append({
        "type": "system",
        "content": text,
        "message_id": message_id,
        "show_explain": False,
        "buttons": buttons
    })
    
    return messages


async def handle_difficulty_set(participant_code: str, new_level: str) -> List[Dict]:
    """Set language difficulty level."""
    messages = []
    state = GAME_STATE.get(participant_code)
    
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]
    
    old_level = state.get("current_language_level", "B1")
    
    # Update the language level
    state["current_language_level"] = new_level
    
    # Save the updated state
    await game_state_manager.save_game_state(participant_code, state)
    
    logger.info(f"Participant {participant_code}: Changed text difficulty from {old_level} to {new_level}")
    
    # Show confirmation
    message_id = generate_message_id()
    text = f"✅ **Difficulty Updated!**\n\nYour text difficulty has been changed from **{old_level}** to **{new_level}**.\n\nThis setting will apply to all new conversations and character interactions. You can change it anytime from the Language Learning menu."
    
    # Log system message
    log_message("system", text, participant_code)
    
    save_message_to_cache(message_id, text)
    
    messages.append({
        "type": "system",
        "content": text,
        "message_id": message_id,
        "show_explain": False,
        "buttons": [
            {"text": "⬅️ Back", "action": "language_menu_difficulty"}
        ]
    })
    
    return messages


async def handle_language_menu_progress(participant_code: str) -> List[Dict]:
    """Show language progress report."""
    messages = []
    state = GAME_STATE.get(participant_code)
    
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]
    
    # Get progress data from progress manager
    # Load progress from Tell-specific storage path.
    logger.info(
        f"Participant {participant_code}: Loading progress from: "
        f"participant_logs/{TELL_SOURCE}/language_progress/{participant_code}_language_progress.json"
    )
    logs = progress_manager.get_participant_progress(participant_code, source=TELL_SOURCE)
    
    logger.info(f"Participant {participant_code}: Progress data received - words_learned: {len(logs.get('words_learned', []))}, writing_feedback: {len(logs.get('writing_feedback', []))}")
    
    # Log recent feedback entries for debugging
    if logs.get("writing_feedback"):
        recent_feedback = logs["writing_feedback"][-5:]  # Last 5 entries
        logger.info(f"Participant {participant_code}: Recent feedback entries: {[entry.get('query', '')[:50] for entry in recent_feedback]}")
    
    # Check if there's any progress data
    if not logs.get("words_learned") and not logs.get("writing_feedback"):
        message_id = generate_message_id()
        text = "📊 **Your Progress Report**\n\nYou don't have any saved progress yet! Keep playing and asking for explanations to build your learning history."
        
        # Log system message
        log_message("system", text, participant_code)
        
        save_message_to_cache(message_id, text)
        
        messages.append({
            "type": "system",
            "content": text,
            "message_id": message_id,
            "show_explain": False,
            "buttons": [
                {"text": "Hide the message", "action": "hide_message"}
            ]
        })
        return messages
    
    # Build progress report
    report_title = "Your Progress Report"
    report = f"--- \n**{report_title}**\n---\n\n"
    
    if logs.get("words_learned"):
        report += "**Words You've Learned:**\n"
        for entry in logs["words_learned"]:
            word = entry.get('query', '')
            definition = entry.get('feedback', '')
            report += f"• **{word}**: {definition}\n"
        report += "\n"
    
    if logs.get("writing_feedback"):
        report += "**My Feedback on Your Phrases:**\n"
        for entry in logs["writing_feedback"]:
            query = entry.get('query', '')
            feedback = entry.get('feedback', '')
            report += f"📖 *You wrote:* {query}\n"
            report += f"✅ **My suggestion:** {feedback}\n\n"
    
    message_id = generate_message_id()
    
    # Log system message
    log_message("system", report, participant_code)
    
    save_message_to_cache(message_id, report)
    
    messages.append({
        "type": "system",
        "content": report,
        "message_id": message_id,
        "show_explain": False,
        "buttons": [
            {"text": "Hide the message", "action": "hide_message"}
        ]
    })
    
    return messages


async def handle_language_menu_back(participant_code: str) -> List[Dict]:
    """Return to language menu (placeholder, can close menu or show main menu)."""
    # Just close the menu by returning empty messages
    # Frontend will handle closing the dropdown
    return []


async def handle_share_usb_with_james(participant_code: str) -> List[Dict]:
    """Start USB handover flow in EP2 university and require player explanation."""
    state = GAME_STATE.get(participant_code)
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]

    if state.get("current_stage", 1) != 2:
        return [{"type": "error", "content": "This action is available only in episode 2."}]

    current_location = get_stage_location(state, 2)
    if current_location != "university_ep2":
        return [{"type": "error", "content": "You can show the USB to James only at the university."}]

    ep2_state = _get_ep2_director_state(state)
    ep2_state["usb_handover_requested"] = True
    ep2_state["usb_context_explained"] = False

    # Force public exchange for this mini-flow so the scripted EP2 gate handles the next player message.
    state["mode"] = "public"
    state["current_character"] = None

    james_data = CHARACTER_DATA.get("james", {"full_name": "James"})
    message_id = generate_message_id()
    save_message_to_cache(message_id, EP2_JAMES_USB_QUESTION, "james")
    log_message("character_james", EP2_JAMES_USB_QUESTION, participant_code)

    messages = [
        {
            "type": "character",
            "character": "james",
            "character_name": james_data["full_name"],
            "character_image": james_data.get("image"),
            "content": EP2_JAMES_USB_QUESTION,
            "message_id": message_id,
            "show_explain": True,
        }
    ]
    _sync_last_public_responder_for_public_mode(state, messages)
    await game_state_manager.save_game_state(participant_code, state)
    return messages


async def analyze_and_log_user_text(participant_code: str, text: str):
    """Silently analyze user text and log feedback if improvements are needed.
    
    Note: This analyzes only text from the web version user, identified by participant_code.
    Data is stored in participant_logs/language_progress/web_{participant_code}_language_progress.json
    (Note: Tell logs are stored under participant_logs/tell/)
    """
    from .ai_services import ask_tutor_for_analysis
    
    logger.info(f"Participant {participant_code}: Analyzing text from WEB version: '{text[:100]}...'")
    
    # Use participant_code as identity in web version.
    analysis_result = await ask_tutor_for_analysis(participant_code, text)
    
    if analysis_result.get("improvement_needed"):
        feedback = analysis_result.get("feedback", "")
        briefly = analysis_result.get("briefly", "")
        logger.info(
            f"Participant {participant_code}: Tutor feedback needed. Saving to: "
            f"participant_logs/{TELL_SOURCE}/language_progress/{participant_code}_language_progress.json"
        )
        logger.info(f"Feedback: '{feedback[:100]}...'")
        # Save participant-scoped writing feedback.
        success = progress_manager.add_participant_writing_feedback(
            participant_code,
            text,
            feedback,
            briefly,
            source=TELL_SOURCE,
        )
        if success:
            logger.info(f"Participant {participant_code}: Successfully saved feedback to progress manager")
        else:
            logger.error(f"Participant {participant_code}: Failed to save feedback to progress manager")
