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

import bootstrap  # noqa: F401

from utils import load_system_prompt, combine_character_prompt, get_prompt_path, get_game_text_path, save_message_to_cache, log_message
from config import GAME_STATE, CHARACTER_DATA, TOTAL_CLUES, TOTAL_STAGES, STAGE_UNLOCK_DELAY_DAYS, STAGE_CONFIG
from game_state_manager import game_state_manager
from shared.backend.progress_manager import progress_manager
from ai_services import ask_for_dialogue
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


def get_clues_count_for_stage(stage_number: int) -> int:
    """Get number of clues configured for a specific stage."""
    stage_config = STAGE_CONFIG.get(stage_number, {})
    stage_clues_count = stage_config.get("clues_count")
    if isinstance(stage_clues_count, int) and stage_clues_count > 0:
        return stage_clues_count
    # Backward compatibility fallback for legacy configs.
    return TOTAL_CLUES


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
            log_message(0, "user", message_text, participant_code)
            if "nina" in stage_characters and "nina" in CHARACTER_DATA:
                nina_data = CHARACTER_DATA["nina"]
                message_id = generate_message_id()
                save_message_to_cache(message_id, EP2_USB_EXPLANATION_FALLBACK, "nina")
                log_message(0, "character_nina", EP2_USB_EXPLANATION_FALLBACK, participant_code)
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
            return messages

        ep2_state["usb_context_explained"] = True
        force_usb_analysis_prompt = True

    # Default speaker in these scenes: non-Nina character.
    non_nina_candidates = [char for char in stage_characters if char != "nina" and char in CHARACTER_DATA]
    active_character_key = non_nina_candidates[0] if non_nina_candidates else "nina"
    active_char_data = CHARACTER_DATA[active_character_key]
    current_language_level = state.get("current_language_level", "B1")

    log_message(0, "user", message_text, participant_code)

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
        other_reply = await ask_for_dialogue(
            participant_code,
            trigger,
            system_prompt,
            active_character_key,
            participant_code,
        )
    except Exception as exc:
        logger.error(f"Failed to get scripted EP2 reply from '{active_character_key}': {exc}")
        other_reply = None

    if not other_reply:
        other_reply = "[Character is thinking...]"

    other_message_id = generate_message_id()
    save_message_to_cache(other_message_id, other_reply, active_character_key)
    log_message(0, f"character_{active_character_key}", other_reply, participant_code)
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
            nina_reply = await ask_for_dialogue(
                participant_code,
                nina_trigger,
                nina_prompt,
                "nina",
                participant_code,
            )
        except Exception as exc:
            logger.error(f"Failed to get scripted EP2 Nina interjection: {exc}")
            nina_reply = None

        if nina_reply:
            nina_data = CHARACTER_DATA["nina"]
            nina_message_id = generate_message_id()
            save_message_to_cache(nina_message_id, nina_reply, "nina")
            log_message(0, "character_nina", nina_reply, participant_code)
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
                    james_followup = await ask_for_dialogue(
                        participant_code,
                        james_followup_trigger,
                        system_prompt,
                        "james",
                        participant_code,
                    )
                except Exception as exc:
                    logger.error(f"Failed to get James follow-up to Nina question: {exc}")
                    james_followup = None

                if james_followup:
                    james_followup_message_id = generate_message_id()
                    save_message_to_cache(james_followup_message_id, james_followup, "james")
                    log_message(0, "character_james", james_followup, participant_code)
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
    """
    Parse optional [buttons] section.
    Button format: "Button text|action_key" (one button per line).
    """
    lines = content.splitlines()
    marker_index = -1

    for index, line in enumerate(lines):
        if line.strip().lower() == "[buttons]":
            marker_index = index
            break

    if marker_index < 0:
        return content, []

    body_lines = lines[:marker_index]
    while body_lines and body_lines[-1].strip() in ("", "---"):
        body_lines.pop()

    buttons: List[Dict[str, str]] = []
    for raw in lines[marker_index + 1:]:
        line = raw.strip()
        if not line:
            continue
        text, sep, action = line.partition("|")
        if not sep:
            continue
        text = text.strip()
        action = action.strip()
        if text and action:
            buttons.append({"text": text, "action": action})

    cleaned_content = "\n".join(body_lines).strip()
    return cleaned_content, buttons


def generate_message_id() -> int:
    """Generate a unique message ID for web version."""
    return int(time.time() * 1000000) + random.randint(0, 1000)


def initialize_game_state(participant_code: str) -> Dict:
    """Initialize new game state for a participant."""
    from datetime import datetime
    import pytz
    
    # Special test mode: for TEST participant, set current stage to 4 and unlock all stages
    is_test_mode = participant_code.upper() == "TEST"
    
    # Initialize stage progress for all stages
    stage_progress = {}
    for stage_num in range(1, 5):  # Stages 1-4
        stage_progress[stage_num] = {
            "clues_examined": set(),
            "suspects_interrogated": set(),
            "key_information_found": [],
            "completion_status": "not_started"  # "not_started", "in_progress", "completed", "skipped"
        }
    
    # Stage 1 is always available, or all stages for TEST mode
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
        "waiting_for_word": False,
        "accused_character": None,
        "accusation_attempts": 0,
        "reveal_step": 0,
        "custom_reveal_step": 0,
        "clues_examined": set(),  # Legacy - for current stage
        "suspects_interrogated": set(),  # Legacy - for current stage
        "accuse_unlocked": False,
        "topic_memory": {"topic": "Initial greeting", "spoken": [], "predefined_used": []},
        "game_completed": False,
        "participant_code": participant_code,
        "waiting_for_participant_code": False,
        "onboarding_step": "consent",
        "current_language_level": "B1",  # Default level
        # Multi-stage fields
        "current_stage": 4 if is_test_mode else 1,  # Test mode starts at stage 4
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
    is_test_mode = participant_code.upper() == "TEST"
    
    # If state doesn't have multi-stage fields, initialize them
    if "current_stage" not in state:
        state["current_stage"] = 4 if is_test_mode else 1
        
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

    if "stage_locations" not in state:
        state["stage_locations"] = {"2": EP2_DEFAULT_LOCATION}
    else:
        stage_locations = state.get("stage_locations", {})
        if not stage_locations.get("2") and not stage_locations.get(2):
            stage_locations["2"] = EP2_DEFAULT_LOCATION
            state["stage_locations"] = stage_locations
    
    return state


def get_available_stages(participant_code: str) -> List[int]:
    """Get list of stages available to the player."""
    # Special test mode: for TEST participant, all stages are always available
    if participant_code.upper() == "TEST":
        return list(range(1, TOTAL_STAGES + 1))
    
    state = GAME_STATE.get(participant_code)
    if not state:
        return [1]  # Stage 1 always available
    
    # Ensure state is migrated
    state = migrate_legacy_game_state(state)
    
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
                # No unlock date set, check if we need to set it
                if prev_status == "completed":
                    # Set unlock date to 7 days from now
                    unlock_date = now + timedelta(days=STAGE_UNLOCK_DELAY_DAYS)
                    stage_unlock_dates[stage_num] = unlock_date.isoformat()
                    state["stage_unlock_dates"] = stage_unlock_dates
                    # Stage not yet available
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
    
    # Set unlock date for next stage
    if stage_number < TOTAL_STAGES:
        next_stage = stage_number + 1
        cet_tz = pytz.timezone('Europe/Berlin')
        unlock_date = datetime.now(cet_tz) + timedelta(days=STAGE_UNLOCK_DELAY_DAYS)
        
        stage_unlock_dates = state.get("stage_unlock_dates", {})
        stage_unlock_dates[next_stage] = unlock_date.isoformat()
        state["stage_unlock_dates"] = stage_unlock_dates
    
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
    
    # Special test mode: for TEST participant, allow switching to any stage
    is_test_mode = participant_code.upper() == "TEST"
    
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
            progress_manager.clear_user_progress(participant_code, participant_code)
    
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
        return stored
    
    # Onboarding (welcome + language level) only for episode 1. Episodes 2+ start with case intro.
    if episode != 1:
        messages = await handle_case_intro(participant_code, "case_intro_begin")
        episode_messages[ep_key] = episode_messages.get(episode, episode_messages.get(ep_key, [])) + messages
        state["episode_messages"] = episode_messages
        await game_state_manager.save_game_state(participant_code, state)
        return messages
    
    # Start with welcome message (episode 1 only)
    welcome_text = load_system_prompt(get_game_text_path("onboarding_1_welcome.txt", episode))
    
    # Log system message
    log_message(0, "system", welcome_text, participant_code)
    
    message_id = generate_message_id()
    save_message_to_cache(message_id, welcome_text)
    messages.append({
        "type": "system",
        "content": welcome_text,
        "message_id": message_id,
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
        log_message(0, "system", language_level_text, participant_code)
        
        message_id1 = generate_message_id()
        save_message_to_cache(message_id1, language_level_text)
        messages.append({
            "type": "system",
            "content": language_level_text,
            "message_id": message_id1,
            "show_explain": True
        })
        
        # Then show intro-B1 text separately with typewriter style and buttons
        intro_b1_text = load_system_prompt(get_game_text_path("intro-B1.txt", episode))
        
        # Log second message
        log_message(0, "system", intro_b1_text, participant_code)
        
        message_id2 = generate_message_id()
        save_message_to_cache(message_id2, intro_b1_text)
        messages.append({
            "type": "system",
            "content": intro_b1_text,
            "message_id": message_id2,
            "show_explain": True,
            "typewriter_style": True,
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
    log_message(0, "system", intro_text, participant_code)
    
    message_id = generate_message_id()
    save_message_to_cache(message_id, intro_text)
    messages.append({
        "type": "system",
        "content": intro_text,
        "message_id": message_id,
        "show_explain": True,
        "typewriter_style": True,
        "buttons": buttons
    })
    
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
    log_message(0, "system", confirmed_text, participant_code)
    
    message_id = generate_message_id()
    save_message_to_cache(message_id, confirmed_text)
    messages.append({
        "type": "system",
        "content": confirmed_text,
        "message_id": message_id,
        "show_explain": True,
        "buttons": [
            {"text": "Start Investigation!", "action": "case_intro_begin"}
        ]
    })
    
    state["onboarding_step"] = "language_selected"
    
    # Save state
    await game_state_manager.save_game_state(participant_code, state)
    
    return messages


def _normalize_intro_step(entry, step_index: int, total: int):
    """Normalize intro_files entry (dict or str) to {file, button, type, image, character}."""
    is_last = step_index >= total - 1
    default_button = "🔍 Game Menu" if is_last else "Next"
    if isinstance(entry, dict):
        return {
            "file": entry["file"],
            "button": entry.get("button", default_button),
            "type": entry.get("type", "character"),
            "image": entry.get("image"),
            "character": entry.get("character", "nina"),
        }
    return {
        "file": entry,
        "button": default_button,
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
    
    entry = _normalize_intro_step(intro_files[step], step, len(intro_files))
    raw_content = _load_intro_file_safe(entry["file"], episode)
    content, parsed_buttons = _extract_buttons_from_text(raw_content)
    
    log_role = entry.get("character", "narrator") if entry["type"] == "character" else "narrator"
    log_message(0, log_role, content, participant_code)
    
    message_id = generate_message_id()
    if entry["type"] == "character":
        char_key = entry.get("character", "nina")
        save_message_to_cache(message_id, content, char_key)
        char_data = CHARACTER_DATA.get(char_key, {})
        buttons = parsed_buttons or [{"text": entry["button"], "action": "case_intro_next"}]
        msg = {
            "type": "character",
            "character": char_key,
            "character_name": char_data.get("full_name", "Nina"),
            "character_image": char_data.get("image") or "nina.png",
            "content": content,
            "message_id": message_id,
            "show_explain": True,
            "buttons": buttons
        }
        if entry.get("image"):
            msg["image"] = entry["image"]
    else:
        save_message_to_cache(message_id, content)
        buttons = parsed_buttons or [{"text": entry["button"], "action": "case_intro_next"}]
        msg = {
            "type": "system",
            "content": content,
            "message_id": message_id,
            "show_explain": True,
            "buttons": buttons
        }
        if entry.get("image"):
            msg["image"] = entry["image"]
    
    messages.append(msg)
    await game_state_manager.save_game_state(participant_code, state)
    return messages


async def start_investigation(participant_code: str) -> List[Dict]:
    """Mark investigation started and show main menu. No file is loaded here (last intro step is shown in handle_case_intro)."""
    state = GAME_STATE.get(participant_code)
    
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]
    
    state["onboarding_step"] = "investigation_started"
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
    log_message(0, "system", transition_text, participant_code)

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
    log_message(0, "menu", menu_text, participant_code)
    
    messages.append({
        "type": "menu",
        "content": menu_text,
        "buttons": [
            {"text": "💬 Talk to Someone", "action": "menu_talk"},
            {"text": "🔍 Examine Evidence", "action": "menu_evidence"},
            {"text": "✍️ Learning Menu", "action": "menu_learning"}
        ]
    })
    
    return messages


async def handle_menu_talk(participant_code: str) -> List[Dict]:
    """Show character selection for talking (characters for current episode)."""
    messages = []
    state = GAME_STATE.get(participant_code)
    
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]
    
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
    log_message(0, "menu", menu_text, participant_code)
    
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

    current_stage = state.get("current_stage", 1)
    available_characters = set(get_characters_for_stage(state, current_stage))
    if character_key not in available_characters:
        return [{"type": "error", "content": "Character is not available in this location."}]
    
    # Set mode to private
    state["mode"] = "private"
    state["current_character"] = character_key
    
    char_data = CHARACTER_DATA[character_key]
    current_stage = state.get("current_stage", 1)
    
    # Episode 2 uses direct character openers without narrator transitions.
    if current_stage != 2:
        char_name = char_data["full_name"]
        current_language_level = state.get("current_language_level", "B1")
        current_location = get_stage_location(state, current_stage)
        # Generate narrator transition
        try:
            narrator_prompt = combine_character_prompt("narrator", current_language_level, current_stage, current_location)
            description_text = await ask_for_dialogue(
                participant_code,
                f"Describe the detective taking {char_name} aside for a private talk.",
                narrator_prompt,
                "narrator",
                participant_code
            )

            # Log narrator message
            log_message(0, "narrator", description_text, participant_code)

            message_id = generate_message_id()
            save_message_to_cache(message_id, description_text, "narrator")
            messages.append({
                "type": "character",
                "character": "narrator",
                "character_name": "Narrator",
                "content": description_text,
                "message_id": message_id,
                "show_explain": True
            })
        except Exception as e:
            logger.error(f"Failed to generate narrator transition: {e}")
            fallback_text = f"You take {char_name} aside for a private conversation."

            # Log narrator message
            log_message(0, "narrator", fallback_text, participant_code)

            message_id = generate_message_id()
            save_message_to_cache(message_id, fallback_text, "narrator")
            messages.append({
                "type": "character",
                "character": "narrator",
                "character_name": "Narrator",
                "content": fallback_text,
                "message_id": message_id,
                "show_explain": True
            })

    opener_text = get_private_dialogue_opener(state, current_stage, character_key)
    if opener_text:
        opener_message_id = generate_message_id()
        save_message_to_cache(opener_message_id, opener_text, character_key)
        log_message(0, f"character_{character_key}", opener_text, participant_code)
        messages.append({
            "type": "character",
            "character": character_key,
            "character_name": char_data["full_name"],
            "character_image": char_data.get("image"),
            "content": opener_text,
            "message_id": opener_message_id,
            "show_explain": True
        })
    
    # Save state
    await game_state_manager.save_game_state(participant_code, state)
    
    return messages


async def handle_private_message(participant_code: str, message_text: str) -> List[Dict]:
    """Handle message in private conversation mode."""
    messages = []
    state = GAME_STATE.get(participant_code)
    
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]
    
    char_key = state.get("current_character")
    
    if not char_key or char_key not in CHARACTER_DATA:
        return [{"type": "error", "content": "No active character conversation."}]
    
    char_data = CHARACTER_DATA[char_key]
    current_language_level = state.get("current_language_level", "B1")
    current_stage = state.get("current_stage", 1)
    current_location = get_stage_location(state, current_stage)
    stage_characters = get_characters_for_stage(state, current_stage)
    
    # Check if this is first interrogation (for current episode's characters)
    if char_key in stage_characters and char_key not in state.get("suspects_interrogated", set()):
        state.setdefault("suspects_interrogated", set()).add(char_key)
        # Note: Accuse unlock logic would go here
    
    system_prompt = combine_character_prompt(char_key, current_language_level, current_stage, current_location)
    
    # Create context trigger
    topic_memory = state.get("topic_memory", {"topic": "None", "spoken": [], "predefined_used": []})
    context_trigger = f"The detective is asking you a question: '{message_text}'. Current topic: {topic_memory.get('topic', 'None')}."
    context_trigger += " Respond as your character."
    
    logger.info(f"Participant {participant_code}: Direct character conversation with '{char_key}'")
    
    # Log user message
    log_message(0, "user", message_text, participant_code)
    
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
            
            # Log character response
            log_message(0, f"character_{char_key}", reply_text, participant_code)
            
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


async def handle_nina_message(participant_code: str, message_text: str) -> List[Dict]:
    """Handle message to Nina (mentor/guide character)."""
    messages = []
    state = GAME_STATE.get(participant_code)
    
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]
    
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
    log_message(0, "user", message_text, participant_code)
    
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
            log_message(0, f"character_{char_key}", reply_text, participant_code)
            
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
    """Handle message in public conversation mode using director logic."""
    messages = []
    state = GAME_STATE.get(participant_code)
    
    if not state:
        return [{"type": "error", "content": "Game not initialized."}]
    
    current_stage = state.get("current_stage", 1)
    current_location = get_stage_location(state, current_stage)
    stage_characters = set(get_characters_for_stage(state, current_stage))

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
    from predefined_responses import extract_character_from_message_strict
    
    character_key = extract_character_from_message_strict(message_text)
    if character_key and character_key in CHARACTER_DATA and character_key in stage_characters:
        # Handle direct character addressing
        char_data = CHARACTER_DATA[character_key]
        
        # Get current language level and episode for prompt resolution
        current_language_level = state.get("current_language_level", "B1")
        system_prompt = combine_character_prompt(character_key, current_language_level, current_stage, current_location)
        
        # Create context trigger
        topic_memory = state.get("topic_memory", {"topic": "None", "spoken": [], "predefined_used": []})
        context_trigger = f"The detective is directly addressing you with this question: '{message_text}'. Current topic: {topic_memory.get('topic', 'None')}. Respond as your character."
        
        logger.info(f"Participant {participant_code}: Direct addressing detected for character '{character_key}'")
        
        # Log user message
        log_message(0, "user", message_text, participant_code)
        
        try:
            reply_text = await ask_for_dialogue(
                participant_code,
                context_trigger,
                system_prompt,
                character_key
            )
            
            if reply_text:
                message_id = generate_message_id()
                save_message_to_cache(message_id, reply_text, character_key)
                
                # Log character response
                log_message(0, f"character_{character_key}", reply_text, participant_code)
                
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
    
    # No direct addressing, use director logic
    topic_memory = state.get("topic_memory", {"topic": "None", "spoken": [], "predefined_used": []})
    context_for_director = f"Player asks everyone. Topic Memory: {json.dumps(topic_memory)}"
    
    # Log user message
    log_message(0, "user", message_text, participant_code)
    
    logger.info(f"Participant {participant_code}: Getting director decision for public mode")
    logger.info(f"Participant {participant_code}: Context: {context_for_director}")
    logger.info(f"Participant {participant_code}: User text: {message_text}")
    
    # Import director function
    from ai_services import ask_director
    
    director_decision = await ask_director(participant_code, context_for_director, message_text)
    logger.info(f"Participant {participant_code}: Director decision received")
    
    scene = director_decision.get("scene", [])
    new_topic = director_decision.get("new_topic", topic_memory["topic"])
    
    # Update topic memory
    state["topic_memory"]["topic"] = new_topic
    if new_topic != topic_memory.get("topic"):
        # Reset spoken list but preserve predefined_used when topic changes
        state["topic_memory"]["spoken"] = []
        if "predefined_used" not in state["topic_memory"]:
            state["topic_memory"]["predefined_used"] = []
    
    if not scene:
        logger.warning(f"Participant {participant_code}: Director returned an empty scene")
        return [{"type": "system", "content": "The investigation continues..."}]
    
    # Execute scene actions
    logger.info(f"Participant {participant_code}: Executing scene with {len(scene)} actions")
    for scene_action in scene:
        action_type = scene_action.get("action")
        data = scene_action.get("data", {})
        
        if action_type == "director_note":
            # Director narrative/guidance message
            message = data.get("message", "The investigation continues...")
            
            # Log director note
            log_message(0, "director_note", message, participant_code)
            
            messages.append({
                "type": "system",
                "content": message
            })
            
        elif action_type in ["character_reply", "character_reaction"]:
            char_key = data.get("character_key")
            trigger_msg = data.get("trigger_message")
            
            if char_key in CHARACTER_DATA and trigger_msg:
                char_data = CHARACTER_DATA[char_key]
                
                # Get current language level and episode for prompt resolution
                current_language_level = state.get("current_language_level", "B1")
                current_stage = state.get("current_stage", 1)
                current_location = get_stage_location(state, current_stage)
                system_prompt = combine_character_prompt(char_key, current_language_level, current_stage, current_location)
                
                try:
                    reply_text = await ask_for_dialogue(
                        participant_code,
                        trigger_msg,
                        system_prompt,
                        char_key
                    )
                    
                    if reply_text:
                        message_id = generate_message_id()
                        save_message_to_cache(message_id, reply_text, char_key)
                        
                        # Log character response
                        log_message(0, f"character_{char_key}", reply_text, participant_code)
                        
                        messages.append({
                            "type": "character",
                            "character": char_key,
                            "character_name": char_data["full_name"],
                            "character_image": char_data.get("image"),
                            "content": reply_text,
                            "message_id": message_id,
                            "show_explain": True
                        })
                        
                        # Mark character as having spoken on this topic
                        state["topic_memory"]["spoken"].append(char_key)
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
    
    mode_text = "💬 You're now speaking with everyone in public. Ask your questions!"
    
    # Log system message
    log_message(0, "system", mode_text, participant_code)
    
    messages.append({
        "type": "system",
        "content": mode_text,
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
    clues_count = get_clues_count_for_stage(current_stage)

    buttons = []
    for i in range(1, clues_count + 1):
        clue_id = str(i)
        clue_name = get_clue_name_for_stage(current_stage, clue_id)
        buttons.append({
            "text": f"🔍 {clue_name}",
            "action": f"examine_clue_{clue_id}"
        })
    
    buttons.append({"text": "⬅️ Back to Main Menu", "action": "show_main_menu"})
    
    menu_text = "Select evidence to examine:"
    
    # Log menu message
    log_message(0, "menu", menu_text, participant_code)
    
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
    clues_count = get_clues_count_for_stage(episode)
    try:
        clue_number = int(clue_id)
    except (TypeError, ValueError):
        return [{"type": "error", "content": "Invalid clue id."}]

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
    
    # Log clue examination
    log_message(0, "clue_examined", f"Clue {clue_id}: {clue_text}", participant_code)
    
    clue_message = {
        "type": "clue",
        "clue_id": clue_id,
        "clue_name": get_clue_name_for_stage(episode, clue_id),
        "content": clue_text,
        "image": f"ep{episode}/clue{clue_id}.png"
    }

    current_location = get_stage_location(state, episode)
    if episode == 2 and clue_id == "1" and current_location == "university_ep2":
        clue_message["buttons"] = [{"text": EP2_USB_SHARE_BUTTON_TEXT, "action": EP2_USB_SHARE_ACTION}]
        clue_message["button_note"] = EP2_USB_SHARE_BUTTON_NOTE

    messages.append(clue_message)
    
    # Save state
    await game_state_manager.save_game_state(participant_code, state)
    
    return messages


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
    log_message(0, "system", text, participant_code)
    
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
    log_message(0, "system", text, participant_code)
    
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
    # Use 0 as user_id since we're using participant_code for identification in web version
    # This will load from: participant_logs/language_progress/web_{participant_code}_language_progress.json
    # (Note: 'web_' prefix separates web version data from Telegram bot data)
    logger.info(f"Participant {participant_code}: Loading progress from: participant_logs/language_progress/web_{participant_code}_language_progress.json")
    logs = progress_manager.get_user_progress(0, participant_code)
    
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
        log_message(0, "system", text, participant_code)
        
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
    log_message(0, "system", report, participant_code)
    
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
    log_message(0, "character_james", EP2_JAMES_USB_QUESTION, participant_code)

    await game_state_manager.save_game_state(participant_code, state)

    return [
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


async def analyze_and_log_user_text(participant_code: str, text: str):
    """Silently analyze user text and log feedback if improvements are needed.
    
    Note: This analyzes only text from the web version user, identified by participant_code.
    Data is stored in participant_logs/language_progress/web_{participant_code}_language_progress.json
    (Note: 'web_' prefix separates web version data from Telegram bot data)
    """
    from ai_services import ask_tutor_for_analysis
    
    logger.info(f"Participant {participant_code}: Analyzing text from WEB version: '{text[:100]}...'")
    
    # Use 0 as user_id since we're using participant_code for identification in web version
    analysis_result = await ask_tutor_for_analysis(0, text)
    
    if analysis_result.get("improvement_needed"):
        feedback = analysis_result.get("feedback", "")
        logger.info(f"Participant {participant_code}: Tutor feedback needed. Saving to: participant_logs/language_progress/web_{participant_code}_language_progress.json")
        logger.info(f"Feedback: '{feedback[:100]}...'")
        # Use progress manager to save feedback - will use participant_code for file path
        success = progress_manager.add_writing_feedback(0, text, feedback, participant_code)
        if success:
            logger.info(f"Participant {participant_code}: Successfully saved feedback to progress manager")
        else:
            logger.error(f"Participant {participant_code}: Failed to save feedback to progress manager")
