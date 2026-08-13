#!/usr/bin/env python3
"""Restore a Tell participant game state from their chat-history log in GCS."""

from __future__ import annotations

import argparse
import json
import re
import time
from datetime import datetime
from typing import Any, Dict, List, Optional

import pytz
from google.cloud import storage

BUCKET_NAME = "chicago-formula-web-bucket"
CET = pytz.timezone("Europe/Berlin")

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


def _parse_ts(date_str: str) -> datetime:
    return CET.localize(datetime.strptime(date_str, "%Y-%m-%d %H:%M:%S"))


def parse_chat_log(text: str) -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []
    current: Optional[Dict[str, Any]] = None
    for line in text.splitlines():
        match = ENTRY_RE.match(line)
        if match:
            if current:
                entries.append(current)
            date_str, _tz_name, role, content = match.groups()
            current = {"ts": _parse_ts(date_str), "role": role, "content": content}
        elif current is not None:
            current["content"] += "\n" + line
    if current:
        entries.append(current)
    return entries


def location_for_ep3(role: str, content: str, current_loc: str) -> str:
    action = content.strip() if role == "action" else ""
    if action == "go_alex_apartment_ep3" or (
        role == "system" and content.strip().startswith("You arrived at") and "Alex" in content
    ):
        return "alex_apartment_ep3"
    if action == "go_university_ep3" or (
        role == "system" and content.strip().startswith("You arrived at") and "University" in content
    ):
        return "university_ep3"
    if action in {"nina_university_brief", "nina_alex_brief"}:
        return current_loc
    return current_loc


def to_message(entry: Dict[str, Any], message_id: int, location: Optional[str]) -> Optional[Dict[str, Any]]:
    role = entry["role"]
    content = entry["content"]
    if role in SKIP_ROLES or not str(content).strip():
        return None

    if role == "system":
        msg: Dict[str, Any] = {
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


def build_state(participant: str, entries: List[Dict[str, Any]], cutoff: datetime) -> Dict[str, Any]:
    now = datetime.now(CET)
    episode_messages: Dict[str, List[Dict[str, Any]]] = {"1": [], "2": [], "3": []}
    ep3_location = "default_ep3"
    msg_id_base = int(time.time() * 1000000)
    msg_i = 0
    language_level = "B1"
    clues_ep1: set[str] = set()
    clues_ep2: set[str] = set()
    current_ep = 1
    saw_share_usb = False
    saw_university = False
    saw_alex = False
    ep1_completed_at = None
    ep2_completed_at = None
    game_start_at = None

    for entry in entries:
        if entry["ts"] >= cutoff:
            continue
        if game_start_at is None:
            game_start_at = entry["ts"].isoformat()

        role = entry["role"]
        content = entry["content"]
        action = content.strip() if role == "action" else ""

        if action.startswith("pauline_entrance"):
            current_ep = 2
        elif action in {
            "nina_alex_brief",
            "nina_university_brief",
            "go_alex_apartment_ep3",
            "go_university_ep3",
            "share_usb_with_james",
        }:
            current_ep = 3
        elif action == "case_intro_next" and current_ep >= 2 and entry["ts"].date() >= datetime(2026, 8, 1).date():
            current_ep = 3
        elif action == "outro_questionnaire" and current_ep == 1:
            ep1_completed_at = entry["ts"].isoformat()
        elif action == "outro_questionnaire" and current_ep == 2:
            ep2_completed_at = entry["ts"].isoformat()

        if action == "difficulty_set_A2" or action == "language_adjust_easier":
            language_level = "A2"
        elif action == "difficulty_set_B2" or action == "language_adjust_more_advanced":
            language_level = "B2"
        elif action == "language_confirm" and language_level:
            pass
        elif action.startswith("examine_clue_"):
            clue_id = action.replace("examine_clue_", "").replace("examine_ep3_clue_", "")
            if current_ep == 1:
                clues_ep1.add(clue_id)
            elif current_ep == 2:
                clues_ep2.add(clue_id)
        elif action == "share_usb_with_james":
            saw_share_usb = True
            saw_university = True
        elif action == "go_university_ep3":
            saw_university = True
        elif action == "go_alex_apartment_ep3":
            saw_alex = True

        ep3_location = location_for_ep3(role, content, ep3_location)
        location = ep3_location if current_ep == 3 else None
        msg = to_message(entry, msg_id_base + msg_i, location)
        if msg is None:
            continue
        msg_i += 1
        episode_messages[str(current_ep)].append(msg)

    if episode_messages["3"]:
        last = dict(episode_messages["3"][-1])
        ui = dict(last.get("ui") or {})
        ui["showInput"] = True
        last["ui"] = ui
        episode_messages["3"][-1] = last

    # EP3 phase: 0 start, 1 USB handed, 2 verdict, 3 doubt, 4 outro
    ep3_phase = 0
    if saw_share_usb:
        ep3_phase = 2  # USB share usually triggers analysis/verdict path
    visited = ["default_ep3"]
    if saw_university:
        visited.append("university_ep3")
    if saw_alex:
        visited.append("alex_apartment_ep3")

    final_location = ep3_location if episode_messages["3"] else "default_ep3"
    current_stage = 3 if episode_messages["3"] else (2 if episode_messages["2"] else 1)

    state = {
        "mode": "public",
        "current_character": None,
        "last_public_responder": "james" if final_location == "university_ep3" else ("alex" if final_location == "alex_apartment_ep3" else "nina"),
        "public_followup_lock": None,
        "waiting_for_word": False,
        "accused_character": "tim",
        "accused_wrong_keys": [],
        "accusation_attempts": 0,
        "reveal_step": 0,
        "custom_reveal_step": 0,
        "clues_examined": sorted(clues_ep2) if clues_ep2 else sorted(clues_ep1),
        "suspects_interrogated": ["tim", "fiona", "ronnie", "pauline", "nina", "james", "alex"],
        "accuse_offer_pending": False,
        "accuse_in_case_materials": False,
        "accuse_unlocked": False,
        "accuse_pending_target": None,
        "accuse_waiting_for_reason": False,
        "topic_memory": {"topic": "Investigation", "spoken": [], "predefined_used": []},
        "game_completed": False,
        "ep1_usb_drive_unlocked": True,
        "ep1_outro_narrator_shown": True,
        "ep1_outro_questionnaire_shown": True,
        "ep1_party_outro_questionnaire_shown": True,
        "participant_code": participant,
        "debug_mode": False,
        "debug_mode_user_override": False,
        "waiting_for_participant_code": False,
        "onboarding_step": "investigation_started",
        "current_language_level": language_level,
        "current_stage": current_stage,
        "stages_completed": [1, 2] if current_stage >= 3 else ([1] if current_stage >= 2 else []),
        "stage_unlock_dates": {
            "1": game_start_at or now.isoformat(),
            "2": ep1_completed_at or now.isoformat(),
            "3": ep2_completed_at or now.isoformat(),
            "4": now.isoformat(),
        },
        "stage_progress": {
            "1": {
                "clues_examined": sorted(clues_ep1) or ["1", "2", "3"],
                "suspects_interrogated": ["tim", "fiona", "ronnie"],
                "key_information_found": [],
                "completion_status": "completed",
                "completed_at": ep1_completed_at or now.isoformat(),
            },
            "2": {
                "clues_examined": sorted(clues_ep2) or ["1", "2", "3"],
                "suspects_interrogated": ["tim", "fiona", "ronnie", "pauline"],
                "key_information_found": [],
                "completion_status": "completed" if current_stage >= 3 else "in_progress",
                "completed_at": ep2_completed_at,
            },
            "3": {
                "clues_examined": ["1"] if saw_share_usb else [],
                "suspects_interrogated": ["nina", "james", "alex"],
                "key_information_found": [],
                "completion_status": "in_progress" if current_stage >= 3 else "not_started",
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
        "stage_locations": {"3": final_location},
        "ep2_director": {
            "visited_locations": visited,
            "university_analysis_done": ep3_phase >= 2,
            "alex_apartment_doubt_seed_done": False,
            "university_final_after_doubt_done": False,
            "alex_post_plain_plane_messages": 0,
            "nina_smth_to_check_played": False,
            "usb_handover_requested": ep3_phase >= 1,
            "usb_handover_reacted": ep3_phase >= 1,
            "usb_context_explained": ep3_phase >= 2,
            "james_player_messages": 5 if saw_share_usb else 0,
            "james_formula_played": saw_share_usb,
            "university_post_verdict_messages": 0,
            "nina_go_to_alex_played": saw_alex,
            "witness_openers_played": [loc for loc in visited if loc != "default_ep3"],
            "university_exit_menu_active": False,
            "ep3_outro_nina_shown": False,
            "ep3_outro_questionnaire_shown": False,
            "ep3_phase": ep3_phase,
        },
        "game_start_at": game_start_at or now.isoformat(),
        "restored_from_chat_log": True,
        "restored_at": now.isoformat(),
    }
    return state


def restore_participant(participant: str, cutoff: datetime) -> None:
    client = storage.Client(project="academic-torch-476710-u0")
    bucket = client.bucket(BUCKET_NAME)
    hist_blob = bucket.blob(f"participant_logs/tell/chat_history/{participant}_chat_history.txt")
    if not hist_blob.exists():
        raise SystemExit(f"No chat history for {participant}")
    entries = parse_chat_log(hist_blob.download_as_text(encoding="utf-8"))
    state = build_state(participant, entries, cutoff)

    counts = {k: len(v) for k, v in state["episode_messages"].items()}
    print(f"Participant {participant}")
    print(" message counts:", counts)
    print(" stage:", state["current_stage"], "location:", state["stage_locations"])
    print(" level:", state["current_language_level"], "ep3_phase:", state["ep2_director"]["ep3_phase"])
    print(" game_completed:", state["game_completed"])

    state_blob = bucket.blob(f"game_states/user_{participant}_state.json")
    if state_blob.exists():
        backup_name = (
            f"game_states/user_{participant}_state.wiped_backup_"
            f"{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        )
        bucket.blob(backup_name).upload_from_string(
            state_blob.download_as_text(encoding="utf-8"),
            content_type="application/json; charset=utf-8",
        )
        print(" backed up wiped state to", backup_name)

    payload = {
        "state": state,
        "last_saved": datetime.now(CET).isoformat(),
        "participant_code": participant,
    }
    state_blob.upload_from_string(
        json.dumps(payload, indent=2, ensure_ascii=False),
        content_type="application/json; charset=utf-8",
    )
    print(" uploaded restored state")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("participant")
    parser.add_argument(
        "--cutoff",
        default=None,
        help="ISO local CET datetime; entries at/after this are ignored (default: first corrupt welcome day 00:00 if detectable, else now)",
    )
    args = parser.parse_args()

    if args.cutoff:
        cutoff = CET.localize(datetime.fromisoformat(args.cutoff))
    else:
        # Default: ignore today's re-welcome noise by cutting at local midnight today.
        cutoff = CET.localize(datetime.now(CET).replace(hour=0, minute=0, second=0, microsecond=0))
    restore_participant(args.participant, cutoff)


if __name__ == "__main__":
    main()
