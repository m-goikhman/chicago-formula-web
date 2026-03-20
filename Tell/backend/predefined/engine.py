"""Shared predefined response engine."""

import random
from typing import Any, Dict, List, Optional, Set

from config import GAME_STATE
from predefined.resolver import resolve_profile_for_user


def detect_topic_from_keywords(message: str, topics: Dict[str, Dict[str, Any]]) -> Optional[str]:
    message_lower = (message or "").lower()
    for topic_key, topic_data in topics.items():
        for keyword in topic_data.get("keywords", []):
            if keyword.lower() in message_lower:
                return topic_key
    return None


def extract_character_from_message(message: str) -> Optional[str]:
    """Extract character name from message, including loose mentions."""
    message_lower = message.lower()

    character_names = {
        "tim": ["tim", "тим"],
        "pauline": ["pauline", "полин"],
        "fiona": ["fiona", "фиона"],
        "ronnie": ["ronnie", "ронни"],
    }

    for char_key, names in character_names.items():
        for name in names:
            if name in message_lower:
                return char_key
    return None


def extract_character_from_message_strict(message: str) -> Optional[str]:
    """Strictly determine direct addresses to characters."""
    message_lower = message.lower().strip()

    character_names = {
        "tim": ["tim", "тим"],
        "pauline": ["pauline", "полин"],
        "fiona": ["fiona", "фиона"],
        "ronnie": ["ronnie", "ронни"],
    }

    for char_key, names in character_names.items():
        for name in names:
            if message_lower.startswith(f"{name},"):
                return char_key

    for char_key, names in character_names.items():
        for name in names:
            if message_lower.endswith(f", {name}?") or message_lower.endswith(f", {name}"):
                return char_key

    question_words = [
        "what", "where", "when", "why", "how", "who", "which", "whose",
        "что", "где", "когда", "почему", "как", "кто", "чей", "какой",
    ]
    for char_key, names in character_names.items():
        for name in names:
            if message_lower.startswith(f"{name} "):
                remaining_text = message_lower[len(name):].strip()
                for q_word in question_words:
                    if remaining_text.startswith(q_word + " ") or remaining_text.startswith(q_word + ","):
                        return char_key
    return None


def _get_characters_who_can_respond(topic_data: Dict[str, Any], topic_memory: Dict, active_characters: Set[str]) -> List[str]:
    spoken_characters = topic_memory.get("spoken", [])
    candidates = [
        char
        for char in topic_data.get("characters_priority", [])
        if char not in spoken_characters
    ]
    if active_characters:
        candidates = [char for char in candidates if char in active_characters]
    return candidates


def _make_scoped_topic_key(profile_id: str, topic_key: str) -> str:
    return f"{profile_id}:{topic_key}"


def _is_predefined_already_used(predefined_used: List[str], topic_key: str, scoped_topic_key: str) -> bool:
    return scoped_topic_key in predefined_used or topic_key in predefined_used


def _mark_predefined_as_used(user_id: Any, scoped_topic_key: str):
    """Mark predefined response as used in game state."""
    if user_id in GAME_STATE:
        topic_memory = GAME_STATE[user_id].get("topic_memory", {})
        predefined_used = topic_memory.get("predefined_used", [])
        if scoped_topic_key not in predefined_used:
            predefined_used.append(scoped_topic_key)
            topic_memory["predefined_used"] = predefined_used
            GAME_STATE[user_id]["topic_memory"] = topic_memory
            print(f"DEBUG PREDEFINED: Marked topic '{scoped_topic_key}' as used for user {user_id}")


def _build_predefined_response(topic_data: Dict[str, Any], character_keys: List[str], active_characters: Set[str]) -> Dict[str, Any]:
    """Build predefined scene payload from resolved topic data."""
    response_strategy = topic_data.get("response_strategy", "all")
    scene_actions: List[Dict[str, Any]] = []

    if response_strategy == "ordered_sequence":
        ordered_actions = topic_data.get("ordered_responses", [])
        for action in ordered_actions:
            char_key = action.get("data", {}).get("character_key")
            if active_characters and char_key and char_key not in active_characters:
                continue
            scene_actions.append(action)
    else:
        templates = topic_data.get("response_templates", {})
        for character_key in character_keys:
            if character_key in templates:
                scene_actions.append(templates[character_key])

    if not scene_actions:
        return {"scene": []}
    return {"scene": scene_actions, "new_topic": topic_data.get("topic_name", "General investigation")}


def try_predefined_response(user_id: Any, message: str, topic_memory: Dict) -> Optional[Dict[str, Any]]:
    """
    Universal predefined engine:
    - resolves profile from current game context
    - detects topic using that profile
    - executes profile strategy while respecting spoken/active characters
    """
    profile_id, profile, active_characters = resolve_profile_for_user(user_id)
    topics = profile.get("topics", {})
    if not topics:
        print(f"DEBUG PREDEFINED: No predefined profile for user {user_id} ({profile_id})")
        return None

    detected_topic = detect_topic_from_keywords(message, topics)
    print(
        f"DEBUG PREDEFINED: User {user_id}, profile {profile_id}, "
        f"message: '{message}' -> detected topic: {detected_topic}"
    )
    if not detected_topic:
        return None

    topic_data = topics[detected_topic]
    topic_name = topic_data.get("topic_name", "General investigation")
    predefined_used = topic_memory.get("predefined_used", [])
    scoped_topic_key = _make_scoped_topic_key(profile_id, detected_topic)

    if _is_predefined_already_used(predefined_used, detected_topic, scoped_topic_key):
        print(
            f"DEBUG PREDEFINED: Predefined response for topic '{scoped_topic_key}' "
            f"already used for user {user_id}, skipping"
        )
        return None

    current_topic = topic_memory.get("topic", "None")
    if current_topic != topic_name:
        adjusted_topic_memory = {"topic": topic_name, "spoken": [], "predefined_used": predefined_used}
        print(
            f"DEBUG PREDEFINED: Topic changed from '{current_topic}' to '{topic_name}', "
            "resetting spoken list"
        )
    else:
        adjusted_topic_memory = topic_memory

    response_strategy = topic_data.get("response_strategy", "all")
    if response_strategy == "ordered_sequence":
        if current_topic == topic_name:
            print(
                f"DEBUG PREDEFINED: Ordered sequence for topic '{scoped_topic_key}' "
                "already shown, letting director decide"
            )
            return None

        result = _build_predefined_response(topic_data, [], active_characters)
        if result.get("scene"):
            _mark_predefined_as_used(user_id, scoped_topic_key)
        print(f"DEBUG PREDEFINED: Final response for user {user_id}: {result}")
        return result if result.get("scene") else None

    specific_character = extract_character_from_message(message)
    if (
        specific_character
        and specific_character in topic_data.get("characters_priority", [])
        and (not active_characters or specific_character in active_characters)
    ):
        result = _build_predefined_response(topic_data, [specific_character], active_characters)
        if result.get("scene"):
            _mark_predefined_as_used(user_id, scoped_topic_key)
            return result

    available_characters = _get_characters_who_can_respond(topic_data, adjusted_topic_memory, active_characters)
    print(f"DEBUG PREDEFINED: Available characters for user {user_id}: {available_characters}")
    if not available_characters:
        print(
            f"DEBUG PREDEFINED: No available characters for topic '{scoped_topic_key}', "
            "letting director decide"
        )
        return None

    if response_strategy == "all":
        chosen_characters = available_characters
    else:
        chosen_characters = [random.choice(available_characters)]
    print(
        f"DEBUG PREDEFINED: Strategy '{response_strategy}', chosen characters for user {user_id}: "
        f"{chosen_characters}"
    )

    result = _build_predefined_response(topic_data, chosen_characters, active_characters)
    if result.get("scene"):
        _mark_predefined_as_used(user_id, scoped_topic_key)
    print(f"DEBUG PREDEFINED: Final response for user {user_id}: {result}")
    return result if result.get("scene") else None

