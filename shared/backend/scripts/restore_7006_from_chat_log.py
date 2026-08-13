#!/usr/bin/env python3
"""Restore Tell participant 7006 game state from chat-history log after a wipe.

Reconstructs episode_messages + progress flags from the append-only chat log,
then uploads game_states/user_7006_state.json. Does not modify the chat log.
"""

from __future__ import annotations

import json
import re
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pytz
from google.cloud import storage

BUCKET_NAME = "chicago-formula-web-bucket"
PARTICIPANT = "7006"
STATE_BLOB = f"game_states/user_{PARTICIPANT}_state.json"
BACKUP_BLOB = f"game_states/user_{PARTICIPANT}_state.wiped_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
CET = pytz.timezone("Europe/Berlin")

# Cut off corrupted re-onboarding that started after the wipe.
# Important: use localize() — tzinfo=pytz.timezone(...) uses LMT and breaks comparisons.
CUTOFF = CET.localize(datetime(2026, 8, 10, 10, 0, 0))

# Episode boundaries (based on known timeline for 7006).
EP2_START = CET.localize(datetime(2026, 8, 1, 11, 0, 0))
EP3_START = CET.localize(datetime(2026, 8, 7, 18, 40, 0))

CHARACTER_META = {
    "tim": {"full_name": "Tim Kane", "image": "ep1/tim.png"},
    "pauline": {"full_name": "Pauline Thompson", "image": "ep1/pauline.png"},
    "fiona": {"full_name": "Fiona McAllister", "image": "ep1/fiona.png"},
    "ronnie": {"full_name": "Ronnie Snapper", "image": "ep1/ronnie.png"},
    "tutor": {"full_name": "English Tutor", "image": None},
    "nina": {"full_name": "Sergeant Nina Réyes", "image": "nina.png"},
    "narrator": {"full_name": "Narrator", "image": None},
    "james": {"full_name": "James Thornton", "image": "ep2/james.png"},
    "alex": {"full_name": "Alex Martin", "image": "ep2/alex.png"},
}

SKIP_ROLES = {
    "action",
    "tutor_analysis_input",
    "tutor_analysis_output",
    "tutor_explain_input",
    "tutor_explain_output",
    "history_cleared",
    "ai_validation_failed",
    "clue_examined",
}

ENTRY_RE = re.compile(
    r"^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) ([A-Z]+)\] \(([^)]+)\): ?(.*)$"
)


def _parse_ts(date_str: str, tz_name: str) -> datetime:
    naive = datetime.strptime(date_str, "%Y-%m-%d %H:%M:%S")
    return CET.localize(naive)


def parse_chat_log(text: str) -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []
    current: Optional[Dict[str, Any]] = None
    for line in text.splitlines():
        match = ENTRY_RE.match(line)
        if match:
            if current:
                entries.append(current)
            date_str, tz_name, role, content = match.groups()
            current = {
                "ts": _parse_ts(date_str, tz_name),
                "role": role,
                "content": content,
            }
        elif current is not None:
            current["content"] += "\n" + line
    if current:
        entries.append(current)
    return entries


def episode_for(ts: datetime, role: str, content: str, current_ep: int) -> int:
    if ts >= EP3_START:
        return 3
    if ts >= EP2_START:
        return 2
    return 1


def location_for_ep3(ts: datetime, role: str, content: str, current_loc: str) -> str:
    if role == "action" and content.strip() == "go_alex_apartment_ep3":
        return "alex_apartment_ep3"
    if role == "system" and content.strip().startswith("You arrived at"):
        return "alex_apartment_ep3"
    return current_loc


def to_message(entry: Dict[str, Any], message_id: int, location: Optional[str]) -> Optional[Dict[str, Any]]:
    role = entry["role"]
    content = entry["content"]
    if role in SKIP_ROLES:
        return None
    if not content or not str(content).strip():
        return None

    msg: Dict[str, Any]
    if role == "system":
        msg = {
            "type": "system",
            "content": content,
            "message_id": message_id,
            "show_explain": True,
        }
        if content.strip().startswith("You arrived at"):
            msg["ui"] = {"showInput": True}
    elif role == "user":
        msg = {
            "type": "user",
            "content": content,
            "message_id": message_id,
            "chat_scope": "public",
        }
    elif role == "nina":
        meta = CHARACTER_META["nina"]
        msg = {
            "type": "character",
            "character": "nina",
            "character_name": meta["full_name"],
            "character_image": meta["image"],
            "content": content,
            "message_id": message_id,
            "show_explain": True,
            "chat_scope": "public",
        }
    elif role == "narrator":
        msg = {
            "type": "character",
            "character": "narrator",
            "character_name": "Narrator",
            "content": content,
            "message_id": message_id,
            "show_explain": True,
        }
    elif role.startswith("character_"):
        key = role[len("character_") :]
        meta = CHARACTER_META.get(key, {"full_name": key.capitalize(), "image": None})
        msg = {
            "type": "character",
            "character": key,
            "character_name": meta["full_name"],
            "content": content,
            "message_id": message_id,
            "show_explain": True,
            "chat_scope": "public",
        }
        if meta.get("image"):
            msg["character_image"] = meta["image"]
    else:
        return None

    if location:
        msg["location"] = location
    return msg


def build_state(entries: List[Dict[str, Any]]) -> Dict[str, Any]:
    now = datetime.now(CET)

    episode_messages: Dict[str, List[Dict[str, Any]]] = {"1": [], "2": [], "3": []}
    ep3_location = "default_ep3"
    msg_id_base = int(time.time() * 1000000)
    msg_i = 0
    language_level = "B2"
    clues_ep1 = set()
    clues_ep2 = set()
    current_ep = 1

    for entry in entries:
        if entry["ts"] >= CUTOFF:
            continue

        role = entry["role"]
        content = entry["content"]
        action = content.strip() if role == "action" else ""

        # Prefer action markers over timestamps when available.
        if action == "pauline_entrance_accept.txt" or action.startswith("pauline_entrance"):
            current_ep = 2
        elif action in {"nina_alex_brief", "go_alex_apartment_ep3"}:
            current_ep = 3
        elif action == "case_intro_next" and entry["ts"] >= EP3_START:
            current_ep = 3
        elif entry["ts"] >= EP3_START:
            current_ep = 3
        elif entry["ts"] >= EP2_START:
            current_ep = max(current_ep, 2)

        if role == "action":
            if action == "difficulty_set_A2":
                language_level = "A2"
            elif action == "difficulty_set_B2":
                language_level = "B2"
            elif action.startswith("examine_clue_"):
                clue_id = action.replace("examine_clue_", "")
                if current_ep == 1:
                    clues_ep1.add(clue_id)
                elif current_ep == 2:
                    clues_ep2.add(clue_id)

        ep3_location = location_for_ep3(entry["ts"], role, content, ep3_location)
        ep = current_ep
        location = ep3_location if ep == 3 else None

        msg = to_message(entry, msg_id_base + msg_i, location)
        if msg is None:
            continue
        msg_i += 1
        episode_messages[str(ep)].append(msg)

    # Ensure last EP3 message keeps input available.
    if episode_messages["3"]:
        last = dict(episode_messages["3"][-1])
        ui = dict(last.get("ui") or {})
        ui["showInput"] = True
        last["ui"] = ui
        episode_messages["3"][-1] = last

    state = {
        "mode": "public",
        "current_character": None,
        "last_public_responder": "alex",
        "public_followup_lock": None,
        "waiting_for_word": False,
        "accused_character": "tim",
        "accused_wrong_keys": [],
        "accusation_attempts": 0,
        "reveal_step": 0,
        "custom_reveal_step": 0,
        "clues_examined": sorted(clues_ep2) if clues_ep2 else sorted(clues_ep1),
        "suspects_interrogated": ["tim", "fiona", "ronnie", "pauline", "alex"],
        "accuse_offer_pending": False,
        "accuse_in_case_materials": False,
        "accuse_unlocked": False,
        "accuse_pending_target": None,
        "accuse_waiting_for_reason": False,
        "topic_memory": {"topic": "Investigation", "spoken": [], "predefined_used": []},
        # CRITICAL: must stay false or /api/game/start deletes the state again.
        "game_completed": False,
        "ep1_usb_drive_unlocked": True,
        "ep1_outro_narrator_shown": True,
        "ep1_outro_questionnaire_shown": True,
        "ep1_party_outro_questionnaire_shown": True,
        "participant_code": PARTICIPANT,
        "debug_mode": False,
        "debug_mode_user_override": False,
        "waiting_for_participant_code": False,
        "onboarding_step": "investigation_started",
        "current_language_level": language_level,
        "current_stage": 3,
        "stages_completed": [1, 2],
        "stage_unlock_dates": {
            "1": "2026-07-28T14:48:04+02:00",
            "2": "2026-07-30T16:25:27+02:00",
            "3": "2026-08-03T16:32:59+02:00",
            "4": "2026-08-11T22:53:56+02:00",
        },
        "stage_progress": {
            "1": {
                "clues_examined": sorted(clues_ep1) or ["1", "2", "3"],
                "suspects_interrogated": ["tim", "fiona", "ronnie"],
                "key_information_found": [],
                "completion_status": "completed",
                "completed_at": "2026-07-28T16:25:27+02:00",
            },
            "2": {
                "clues_examined": sorted(clues_ep2) or ["1", "2", "3"],
                "suspects_interrogated": ["tim", "fiona", "ronnie", "pauline"],
                "key_information_found": [],
                "completion_status": "completed",
                "completed_at": "2026-08-01T16:32:59+02:00",
            },
            "3": {
                "clues_examined": [],
                "suspects_interrogated": ["alex", "nina"],
                "key_information_found": [],
                "completion_status": "in_progress",
            },
            "4": {
                "clues_examined": [],
                "suspects_interrogated": [],
                "key_information_found": [],
                "completion_status": "not_started",
            },
        },
        "global_knowledge": [],
        "episode_messages": episode_messages,
        "stage_locations": {
            "3": "alex_apartment_ep3",
        },
        "ep2_director": {
            "visited_locations": ["default_ep3", "alex_apartment_ep3"],
            "university_analysis_done": False,
            "alex_apartment_doubt_seed_done": False,
            "university_final_after_doubt_done": False,
            "alex_post_plain_plane_messages": 0,
            "nina_smth_to_check_played": False,
            "usb_handover_requested": False,
            "usb_handover_reacted": False,
            "usb_context_explained": False,
            "james_player_messages": 0,
            "james_formula_played": False,
            "university_post_verdict_messages": 0,
            "nina_go_to_alex_played": True,
            "witness_openers_played": ["alex_apartment_ep3"],
            "university_exit_menu_active": False,
            "ep3_outro_nina_shown": False,
            "ep3_outro_questionnaire_shown": False,
            "ep3_phase": 0,
        },
        "game_start_at": "2026-07-28T14:48:04+02:00",
        "restored_from_chat_log": True,
        "restored_at": now.isoformat(),
    }
    return state


def main() -> None:
    log_path = Path(
        "/Users/marigo1703/Downloads/participant_logs_tell_chat_history_7006_chat_history.txt"
    )
    if not log_path.exists():
        raise SystemExit(f"Chat log not found: {log_path}")

    entries = parse_chat_log(log_path.read_text(encoding="utf-8"))
    state = build_state(entries)

    counts = {k: len(v) for k, v in state["episode_messages"].items()}
    print("Parsed entries:", len(entries))
    print("Restored message counts:", counts)
    print("Language level:", state["current_language_level"])
    print("Current stage:", state["current_stage"], "location:", state["stage_locations"])
    print("game_completed:", state["game_completed"])

    client = storage.Client(project="academic-torch-476710-u0")
    bucket = client.bucket(BUCKET_NAME)

    # Backup wiped state first.
    current_blob = bucket.blob(STATE_BLOB)
    if current_blob.exists():
        backup_blob = bucket.blob(BACKUP_BLOB)
        backup_blob.upload_from_string(
            current_blob.download_as_text(encoding="utf-8"),
            content_type="application/json; charset=utf-8",
        )
        print("Backed up wiped state to", BACKUP_BLOB)

    payload = {
        "state": state,
        "last_saved": datetime.now(pytz.timezone("Europe/Berlin")).isoformat(),
        "participant_code": PARTICIPANT,
    }
    current_blob.upload_from_string(
        json.dumps(payload, indent=2, ensure_ascii=False),
        content_type="application/json; charset=utf-8",
    )
    print("Uploaded restored state to", STATE_BLOB)
    print("Size:", current_blob.size if current_blob.size else "uploaded")


if __name__ == "__main__":
    main()
