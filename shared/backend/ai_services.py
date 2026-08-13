import json
import re
import sys
from typing import Dict, List, Optional
from groq import Groq
from .game_config import GROQ_API_KEY, user_histories
from .utils import load_system_prompt, get_prompt_path, log_message, combine_character_prompt

# Initialize the Groq API client
if not GROQ_API_KEY:
    print("WARNING: GROQ_API_KEY not configured. Groq-powered features will be disabled.", file=sys.stderr)
    client = None
else:
    try:
        client = Groq(api_key=GROQ_API_KEY)
    except Exception as exc:
        print(f"WARNING: Failed to initialise Groq client: {exc}. Features will be disabled.", file=sys.stderr)
        client = None

GROQ_CHAT_MODEL = "openai/gpt-oss-120b"

# Telegram's message length limit
TELEGRAM_MAX_MESSAGE_LENGTH = 4096

TUTOR_PROMPT_PATHS = {
    # "analysis" prompts live in TUTOR_ANALYSIS_PROMPT_PATHS (source-specific),
    # final summary prompts in TUTOR_FINAL_SUMMARY_PROMPT_PATHS.
    "explanation": "prompts/language_learning/tutor_explain.md",
}

TUTOR_ANALYSIS_PROMPT_PATHS = {
    "tell": "prompts/language_learning/tell/tutor_feedback_tell.md",
}
TUTOR_FINAL_SUMMARY_PROMPT_PATHS = {
    "tell": "prompts/language_learning/tutor_final_summary.md",
    "teach": "prompts/language_learning/teach/deliever_final_feedback.md",
}

TEACH_CORRECTOR_PROMPT_PATH = "prompts/language_learning/teach/corrector.md"
TEACH_DELIVER_FEEDBACK_PROMPT_PATH = "prompts/language_learning/teach/deliever_feedback.md"

# Episode 1 contradiction-handling configuration.
# We keep this structured in code so runtime checks rely on deterministic fact slots.
EP1_CONTRADICTION_BEHAVIOR = {
    "fiona": "memory_correction",
    "ronnie": "memory_correction",
    "tim": "forced_local_truth",
    "pauline": "forced_local_truth",
}

EP1_CONTRADICTION_FACTS = {
    "fiona": {
        "arrival_and_discovery": {
            "label": "arrival/discovery timeline",
            "truth": (
                "You arrived around 19:00, let Ronnie and Tim in around 19:08, "
                "then found Alex unconscious around 19:10."
            ),
            "triggers": [
                "arrive", "arrived", "got here", "came here",
                "let them in", "intercom", "bathroom", "water running",
                "found alex", "called 911", "19:00", "19:08", "19:10",
            ],
        },
    },
    "ronnie": {
        "arrival_and_tim_state": {
            "label": "arrival near Tim's car",
            "truth": (
                "You arrived around 19:05 and saw Tim near his car, visibly stressed, "
                "talking about keys locked inside."
            ),
            "triggers": [
                "19:05", "near his car", "tim near car", "locked keys",
                "keys in car", "agitated", "stressed", "shaking", "white-faced",
                "before entering", "buzzed the intercom",
            ],
        },
    },
    "tim": {
        "arrival_timing": {
            "label": "arrival timing",
            "truth": (
                "You first came to Alex's apartment early (around 17:50), "
                "and later entered again with Ronnie around 19:08."
            ),
            "triggers": [
                "arrive", "arrived", "came here", "got here",
                "7:05", "19:05", "17:50", "before seven", "before 7",
                "early", "late", "entered with ronnie",
            ],
        },
        "whereabouts_1830_1900": {
            "label": "whereabouts between 18:30 and 19:00",
            "truth": (
                "You were not just parking. You went to the university office area, "
                "then returned near Alex's building before the party."
            ),
            "triggers": [
                "18:30", "18:45", "18:50", "19:00", "where were you",
                "driving", "parking", "university", "office", "between",
            ],
        },
        "car_position": {
            "label": "car position near the building",
            "truth": (
                "Your car had been near Alex's building for a while, and the keys ended up locked inside."
            ),
            "triggers": [
                "car", "parked", "snow", "keys", "locked inside", "few blocks",
                "honda", "near the building", "near entrance",
            ],
        },
    },
    "pauline": {
        "first_visit": {
            "label": "first visit before the party",
            "truth": (
                "You met Alex around 18:00, argued in the stairwell, then he sent you "
                "to fetch the airplane USB from the office."
            ),
            "triggers": [
                "18:00", "6:00", "first visit", "before the party",
                "stairwell", "intercom", "argue", "argued", "came earlier",
            ],
        },
        "usb_trip_and_return": {
            "label": "USB trip timing",
            "truth": (
                "You left for the office around 18:15, picked up the airplane USB, "
                "and returned it to Alex around 18:40."
            ),
            "triggers": [
                "usb", "drive", "airplane", "office", "18:10", "18:15",
                "18:25", "18:40", "returned the usb", "brought it back",
            ],
        },
        "night_return": {
            "label": "night return time",
            "truth": "You came back later at night (around 21:00).",
            "triggers": [
                "21:00", "9:00", "came back", "returned at nine",
                "back at nine", "came back now", "later tonight",
            ],
        },
    },
}

_STRONG_CONTRADICTION_CUES = [
    "you said", "you told me", "earlier you", "before you",
    "just said", "previously", "now you're saying", "but now",
    "which is it", "that doesn't add up", "that does not add up",
    "doesn't add up", "does not add up", "contradict", "inconsistent",
    "can't both be true", "cannot both be true",
]

_WITNESS_COMPARISON_CUES = [
    "fiona says", "ronnie says", "tim says", "pauline says",
    "fiona told", "ronnie told", "tim told", "pauline told",
]

_CONTRAST_CUES = [" but ", " however ", " though ", " yet ", " instead "]

_NEGATIVE_AUX_CHALLENGE_PATTERN = re.compile(
    r"\b(?:didn't|did not|haven't|have not|weren't|were not|isn't|is not|can't|cannot)\s+you\b",
    re.IGNORECASE,
)

_TIME_TOKEN_PATTERN = re.compile(
    r"\b(?:[01]?\d|2[0-3])(?::[0-5]\d)?\s*(?:am|pm)?\b",
    re.IGNORECASE,
)

_TIME_WORDS = ["before", "after", "earlier", "later", "first", "then"]


def _contains_any_phrase(text: str, phrases: List[str]) -> bool:
    lowered = (text or "").lower()
    return any(phrase in lowered for phrase in phrases)


def _count_time_mentions(text: str) -> int:
    lowered = (text or "").lower()
    explicit_times = len(_TIME_TOKEN_PATTERN.findall(lowered))
    time_words = sum(1 for marker in _TIME_WORDS if marker in lowered)
    return explicit_times + time_words


def _score_contradiction_intent(message: str) -> float:
    lowered = (message or "").lower()
    score = 0.0

    if _contains_any_phrase(lowered, _STRONG_CONTRADICTION_CUES):
        score += 2.0
    if _contains_any_phrase(lowered, _WITNESS_COMPARISON_CUES):
        score += 1.0
    if _contains_any_phrase(lowered, _CONTRAST_CUES):
        score += 1.0
    if _NEGATIVE_AUX_CHALLENGE_PATTERN.search(lowered):
        score += 0.5
    if _count_time_mentions(lowered) >= 2:
        score += 1.0

    return score


def _detect_ep1_contradiction_fact(message: str, character_key: str) -> Optional[Dict[str, str]]:
    character_facts = EP1_CONTRADICTION_FACTS.get(character_key, {})
    if not character_facts:
        return None

    lowered = (message or "").lower()
    best_slot = None
    best_score = 0
    best_fact = None

    for slot_key, fact_info in character_facts.items():
        triggers = fact_info.get("triggers", [])
        slot_hits = sum(1 for trigger in triggers if trigger in lowered)
        if slot_hits > best_score:
            best_slot = slot_key
            best_score = slot_hits
            best_fact = fact_info

    # No fact slot anchored by message content -> no contradiction mode.
    if not best_slot or not best_fact or best_score <= 0:
        return None

    contradiction_score = _score_contradiction_intent(lowered)

    # Avoid false positives: negative questions alone should not trigger this mode.
    if contradiction_score < 2.5:
        return None

    return {
        "slot": best_slot,
        "label": best_fact["label"],
        "truth": best_fact["truth"],
        "intent_score": str(contradiction_score),
        "trigger_hits": str(best_score),
    }


def _resolve_ep1_contradiction_context(
    participant_code: str,
    user_message: str,
    character_key: Optional[str],
) -> Optional[Dict[str, str]]:
    if not character_key:
        return None

    from .game_config import GAME_STATE

    state = GAME_STATE.get(participant_code, {})
    if state.get("current_stage", 1) not in {1, 2}:
        return None

    behavior = EP1_CONTRADICTION_BEHAVIOR.get(character_key)
    if not behavior:
        return None

    fact_match = _detect_ep1_contradiction_fact(user_message, character_key)
    if not fact_match:
        return None

    fact_label = fact_match["label"]
    truth_anchor = fact_match["truth"]
    slot_key = fact_match["slot"]
    intent_score = fact_match.get("intent_score", "0")
    trigger_hits = fact_match.get("trigger_hits", "0")

    if behavior == "memory_correction":
        instruction = (
            "\n\nEP1 CONTRADICTION MODE (active for this turn only):\n"
            f"The detective is challenging your timeline consistency about '{fact_label}'.\n"
            "Treat this as a memory-precision issue.\n"
            "You MUST: (1) briefly acknowledge the mismatch, "
            "(2) correct the fact clearly, (3) continue normally.\n"
            "Do NOT deny that a conflicting wording might have appeared earlier.\n"
            f"Correct fact anchor: {truth_anchor}\n"
        )
        return {
            "instruction": instruction,
            "behavior": behavior,
            "slot": slot_key,
            "label": fact_label,
            "intent_score": intent_score,
            "trigger_hits": trigger_hits,
            "truth": truth_anchor,
        }

    if behavior == "forced_local_truth":
        instruction = (
            "\n\nEP1 CONTRADICTION MODE (active for this turn only):\n"
            f"The detective cornered you on '{fact_label}' with contradiction pressure.\n"
            "You MUST reveal the truth for this specific fact now.\n"
            "Important: reveal only this local fact; do not provide a full confession "
            "or unrelated secrets unless directly asked.\n"
            "Do NOT use blanket denial phrases (e.g., 'that's impossible, I just got here').\n"
            f"Truth fact to state: {truth_anchor}\n"
        )
        return {
            "instruction": instruction,
            "behavior": behavior,
            "slot": slot_key,
            "label": fact_label,
            "intent_score": intent_score,
            "trigger_hits": trigger_hits,
            "truth": truth_anchor,
        }

    return None

def validate_ai_response(response: str, character_key: str = None) -> tuple[bool, str]:
    """
    Validates an AI response for corruption, excessive length, and other issues.
    Returns (is_valid, cleaned_response_or_fallback)
    """
    if not response or not response.strip():
        return False, "I'm not sure how to respond to that."
    
    response = response.strip()
    
    # Check for excessive length (Telegram limit and corruption indicator)
    if len(response) > TELEGRAM_MAX_MESSAGE_LENGTH:
        print(f"WARNING: AI response too long ({len(response)} chars), truncating")
        response = response[:TELEGRAM_MAX_MESSAGE_LENGTH-50] + "..."
        return True, response
    
    # Check for suspiciously long responses that might indicate corruption
    if len(response) > 2000:
        # For longer responses, do additional corruption checks
        char_variety = len(set(response.replace(' ', '').replace('\n', '').replace('\t', '')))
        if char_variety < 20:  # Very low character variety suggests repetition
            print(f"WARNING: Suspiciously long response with low character variety ({char_variety} unique chars)")
            return False, _get_fallback_response(character_key)
    
    # Check for corruption patterns
    corruption_patterns = [
        # Excessive repetition of random words
        r'\b(\w+)(\s+\1){10,}',  # Same word repeated 10+ times
        # Random code-like patterns
        r'(BuilderFactory|externalActionCode|RODUCTION|\.visitInsn){5,}',
        # Excessive dashes or special characters
        r'[-]{20,}',
        # Random programming terms repeated
        r'(PSI|MAV|Basel|Toastr|contaminants|roscope){5,}',
        # Excessive parentheses or brackets
        r'[\(\)\[\]]{10,}',
        # Excessive quotes (new pattern for the reported issue)
        r'["\'"]{15,}',  # 15+ consecutive quote characters
        # Repeated test/option strings (new pattern)
        r'(test){8,}',  # "test" repeated 8+ times
        r'(option){8,}',  # "option" repeated 8+ times
        # Comma-separated repeated words (new pattern)
        r'("[^"]*",\s*){20,}',  # 20+ comma-separated quoted items
        # Excessive commas
        r'[,]{10,}',  # 10+ consecutive commas
    ]
    
    for pattern in corruption_patterns:
        if re.search(pattern, response, re.IGNORECASE):
            print(f"WARNING: Corrupted AI response detected (pattern: {pattern[:20]}...)")
            print(f"Corrupted response preview: {response[:200]}...")
            return False, _get_fallback_response(character_key)
    
    # Check for excessive repetition of any phrase
    words = response.split()
    if len(words) > 50:  # Only check longer responses
        # Look for phrases repeated more than 5 times
        for i in range(len(words) - 2):
            phrase = ' '.join(words[i:i+3])
            if response.count(phrase) > 5:
                print(f"WARNING: Excessive phrase repetition detected: '{phrase}'")
                return False, _get_fallback_response(character_key)
    
    # Check for reasonable character-to-word ratio (detect gibberish)
    if len(words) > 10:
        avg_word_length = len(response.replace(' ', '')) / len(words)
        if avg_word_length > 15:  # Unusually long average word length
            print(f"WARNING: Suspicious word length pattern (avg: {avg_word_length})")
            return False, _get_fallback_response(character_key)
    
    # Check for incomplete or cut-off responses that might indicate corruption
    suspicious_endings = [
        'AssistantClass', '<|python_tag|>', '<|reserved_special_token_', '"}"}"}"}',
        'scalablytyped', 'надлеж', 'кто-то', '...",",",",",",",",",",",",",",",",",",",",'
    ]
    for ending in suspicious_endings:
        if ending.lower() in response.lower():
            print(f"WARNING: Suspicious token/pattern detected: '{ending[:20]}...'")
            return False, _get_fallback_response(character_key)
    
    return True, response

def _get_fallback_response(character_key: str = None) -> str:
    """Returns an appropriate fallback response for a character."""
    if character_key:
        from .game_config import CHARACTER_DATA
        char_data = CHARACTER_DATA.get(character_key, {})
        char_name = char_data.get("full_name", character_key)
        
        # Special fallback for narrator
        if character_key == "narrator":
            return "We step aside to talk in private, away from the others."
        
        # Generic fallback for other characters
        return f"I need a moment to think about that properly."
    return "I'm having trouble processing that request right now."


def _get_tutor_prompt(task: str, source: Optional[str] = None) -> str:
    """Load prompt dedicated to a specific tutor task."""
    prompt_path = TUTOR_PROMPT_PATHS.get(task)
    if task == "analysis":
        normalized_source = str(source or "tell").strip().lower()
        source_prompt = TUTOR_ANALYSIS_PROMPT_PATHS.get(
            normalized_source,
            TUTOR_ANALYSIS_PROMPT_PATHS["tell"],
        )
        prompt_path = source_prompt
    if not prompt_path:
        print(f"WARNING: Unknown tutor task '{task}', using generic tutor prompt")
        from .game_config import CHARACTER_DATA

        return load_system_prompt(CHARACTER_DATA["tutor"]["prompt_file"])
    return load_system_prompt(prompt_path)


def _parse_director_json_payload(response_text: str) -> dict:
    """Parse director JSON with tolerance for fenced code blocks or wrappers."""
    candidate = response_text.strip()

    # Fast path: already clean JSON
    try:
        parsed = json.loads(candidate)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    # Common pattern: ```json ... ```
    fence_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", candidate, re.DOTALL | re.IGNORECASE)
    if fence_match:
        fenced_json = fence_match.group(1).strip()
        parsed = json.loads(fenced_json)
        if isinstance(parsed, dict):
            return parsed

    # Last resort: first JSON object in text
    first_brace = candidate.find("{")
    last_brace = candidate.rfind("}")
    if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
        sliced = candidate[first_brace:last_brace + 1].strip()
        parsed = json.loads(sliced)
        if isinstance(parsed, dict):
            return parsed

    raise json.JSONDecodeError("Director response does not contain a valid JSON object", candidate, 0)


def _parse_json_array_payload(response_text: str) -> list:
    """Parse JSON array with tolerance for fenced code blocks or wrappers."""
    candidate = str(response_text or "").strip()
    if not candidate:
        raise json.JSONDecodeError("Empty response", candidate, 0)

    try:
        parsed = json.loads(candidate)
        if isinstance(parsed, list):
            return parsed
    except json.JSONDecodeError:
        pass

    fence_match = re.search(r"```(?:json)?\s*(\[.*?\])\s*```", candidate, re.DOTALL | re.IGNORECASE)
    if fence_match:
        fenced_json = fence_match.group(1).strip()
        parsed = json.loads(fenced_json)
        if isinstance(parsed, list):
            return parsed

    first_bracket = candidate.find("[")
    last_bracket = candidate.rfind("]")
    if first_bracket != -1 and last_bracket != -1 and last_bracket > first_bracket:
        sliced = candidate[first_bracket:last_bracket + 1].strip()
        parsed = json.loads(sliced)
        if isinstance(parsed, list):
            return parsed

    raise json.JSONDecodeError("Response does not contain a valid JSON array", candidate, 0)

def _resolve_history_key(participant_code: str) -> str:
    """Resolve in-memory history key for a participant, episode, and location."""
    from .game_config import GAME_STATE, STAGE_CONFIG

    state = GAME_STATE.get(participant_code, {})
    episode = state.get("current_stage", 1)
    stage_config = STAGE_CONFIG.get(episode, {})
    if stage_config.get("locations"):
        stage_locations = state.get("stage_locations", {})
        location = (
            stage_locations.get(str(episode))
            or stage_locations.get(episode)
            or stage_config.get("default_location")
        )
        if location:
            return f"{participant_code}:{episode}:{location}"
    return f"{participant_code}:{episode}"


def clear_user_conversation_history(participant_code: str):
    """Clear conversation history for current participant and episode."""
    history_key = _resolve_history_key(participant_code)
    if history_key in user_histories:
        print(f"WARNING: Clearing conversation history for participant {participant_code} due to corruption")
        user_histories[history_key] = []
        log_message("history_cleared", "Conversation history cleared due to AI corruption", participant_code)


def append_character_line_to_history(
    participant_code: str,
    character_key: str,
    text: str,
    chat_scope: str = "public",
) -> None:
    """
    Append a character line to the in-memory dialogue history fed to the model.

    Used for both LLM replies and pre-written game_texts lines so the model sees
    one continuous conversation with no "scripted" distinction.
    """
    if not participant_code or not isinstance(text, str):
        return
    body = text.strip()
    if not body:
        return

    speaker = str(character_key or "").strip()
    if not speaker:
        return

    scope_raw = str(chat_scope or "public").strip().lower()
    if scope_raw == "private" or scope_raw.startswith("private:"):
        resolved_scope = "private"
        if scope_raw.startswith("private:") and ":" in scope_raw:
            # Prefer explicit private:<key> when the caller used UI-style scope.
            private_key = scope_raw.split(":", 1)[1].strip()
            if private_key:
                speaker = private_key
    else:
        resolved_scope = "public"

    history_key = _resolve_history_key(participant_code)
    if history_key not in user_histories:
        user_histories[history_key] = []

    entry = {
        "role": "assistant",
        "content": f"[{speaker}]: {body}",
        "chat_scope": resolved_scope,
    }
    if resolved_scope == "private":
        entry["character_key"] = speaker

    user_histories[history_key].append(entry)
    if len(user_histories[history_key]) > 20:
        user_histories[history_key] = user_histories[history_key][-20:]


_DETECTIVE_TAG_PATTERN = re.compile(r"^\[Detective to ([^\]]+)\]:\s*(.*)$", re.DOTALL)
_SPEAKER_TAG_PATTERN = re.compile(r"^\[([^\]]+)\]:\s*(.*)$", re.DOTALL)


def _character_matches_aliases(name: str, aliases: set[str]) -> bool:
    return name.strip().lower() in aliases


def _extract_tagged_character(content: str, role: str) -> Optional[str]:
    if not isinstance(content, str):
        return None
    if role == "user":
        match = _DETECTIVE_TAG_PATTERN.match(content)
        return match.group(1) if match else None
    if role == "assistant":
        match = _SPEAKER_TAG_PATTERN.match(content)
        return match.group(1) if match else None
    return None


def _is_message_visible_to_character(msg: dict, character_key: str) -> bool:
    """Return True when a character could have heard or participated in this exchange."""
    if not character_key:
        return True

    aliases = _build_character_aliases(character_key)
    scope = msg.get("chat_scope")

    if scope == "public":
        return True

    tagged_character = msg.get("character_key")
    if not tagged_character:
        tagged_character = _extract_tagged_character(msg.get("content", ""), msg.get("role", ""))

    if scope == "private":
        if not tagged_character:
            return False
        return _character_matches_aliases(tagged_character, aliases)

    # Legacy entries without explicit scope.
    role = msg.get("role", "")
    content = msg.get("content", "")
    if role == "assistant":
        return True
    if role == "user":
        target = _extract_tagged_character(content, role)
        if target:
            return _character_matches_aliases(target, aliases)
    return True


def _filter_history_for_character(history: list, character_key: str) -> list:
    """Keep public dialogue and this character's private exchanges only."""
    if not character_key:
        return history

    return [msg for msg in history if _is_message_visible_to_character(msg, character_key)]


def _build_character_aliases(character_key: str) -> set[str]:
    """Return normalized aliases used to identify one character in history tags."""
    if not character_key:
        return set()

    aliases = {character_key.strip().lower()}
    try:
        from .game_config import CHARACTER_DATA  # Local import to avoid circular dependency

        char_data = CHARACTER_DATA.get(character_key, {})
        full_name = (char_data.get("full_name") or "").strip()
        if full_name:
            aliases.add(full_name.lower())
            first_name = full_name.split()[0].strip().lower()
            if first_name:
                aliases.add(first_name)
    except Exception:
        # Keep a resilient fallback; key alias is enough for core behavior.
        pass

    return {alias for alias in aliases if alias}


def _rewrite_history_for_active_character(history: list, character_key: Optional[str]) -> list:
    """
    Rewrite history tags from the active character perspective.
    For the active character, replace explicit self references in tags with "you".
    """
    if not character_key:
        return history

    aliases = _build_character_aliases(character_key)
    if not aliases:
        return history

    rewritten = []
    detective_tag_pattern = re.compile(r"^\[Detective to ([^\]]+)\]:\s*(.*)$")
    bracket_tag_pattern = re.compile(r"^\[([^\]]+)\]:\s*(.*)$")
    detective_plain_prefix = "Detective to "

    for msg in history:
        role = msg.get("role", "")
        content = msg.get("content", "")
        if not isinstance(content, str):
            rewritten.append(msg)
            continue

        new_content = content

        detective_match = detective_tag_pattern.match(content)
        if detective_match:
            target = detective_match.group(1).strip().lower()
            body = detective_match.group(2)
            if target in aliases:
                new_content = f"[Detective to you]: {body}"
            rewritten.append({"role": role, "content": new_content})
            continue

        bracket_match = bracket_tag_pattern.match(content)
        if bracket_match:
            speaker = bracket_match.group(1).strip().lower()
            body = bracket_match.group(2)
            if speaker in aliases:
                new_content = f"[you]: {body}"
            rewritten.append({"role": role, "content": new_content})
            continue

        # Backward-compatible plain prefixes:
        # "Detective to Tim: ..." -> "Detective to you: ..."
        # "Tim: ..." -> "you: ..."
        lowered_content = content.lower()
        for alias in sorted(aliases, key=len, reverse=True):
            detective_prefix = f"{detective_plain_prefix}{alias}: "
            if lowered_content.startswith(detective_prefix):
                new_content = f"{detective_plain_prefix}you: {content[len(detective_prefix):]}"
                break
            alias_prefix = f"{alias}: "
            if lowered_content.startswith(alias_prefix):
                new_content = f"you: {content[len(alias_prefix):]}"
                break

        rewritten.append({"role": role, "content": new_content})

    return rewritten


def _strip_leading_self_reference_prefix(response_text: str) -> str:
    """
    Remove leaked self-reference prefixes sometimes produced by the model,
    e.g. "[you]: hello" or "you: hello".
    """
    if not response_text:
        return response_text

    cleaned = response_text.strip()
    return re.sub(r"^(?:\[\s*you\s*\]\s*:\s*|you\s*:\s*)+", "", cleaned, flags=re.IGNORECASE).strip()

async def ask_for_dialogue(
    participant_code: str,
    user_message: str,
    system_prompt: str,
    character_key: str = None,
    requester_code: str = None,
    chat_scope: str = "public",
) -> str:
    """The main function for all dialogue-based AI calls. Always expects and returns a simple string."""
    history_key = _resolve_history_key(participant_code)
    
    if history_key not in user_histories:
        user_histories[history_key] = []
    
    # Get global knowledge from game state if participant_code is provided
    knowledge_context = ""
    from .game_config import GAME_STATE
    state = GAME_STATE.get(participant_code, {})
    global_knowledge = state.get("global_knowledge", [])
    
    if global_knowledge:
        # Format knowledge for context
        knowledge_items = []
        for item in global_knowledge:
            stage = item.get("stage", "?")
            info = item.get("information", "")
            if info:
                knowledge_items.append(f"Stage {stage}: {info}")
        
        if knowledge_items:
            knowledge_context = f"\n\nCONTEXT FROM PREVIOUS INVESTIGATIONS:\n" + "\n".join(f"- {item}" for item in knowledge_items)
            knowledge_context += "\n\nYou may reference this information naturally in conversation, but don't force it. Only mention it if it's relevant to the current discussion."
    
    state.pop("_last_contradiction_guard", None)

    contradiction_context = _resolve_ep1_contradiction_context(
        participant_code=participant_code,
        user_message=user_message,
        character_key=character_key,
    )
    contradiction_instruction = (contradiction_context or {}).get("instruction")

    if contradiction_context and character_key:
        state["_last_contradiction_guard"] = {
            "character": character_key,
            "behavior": contradiction_context.get("behavior", "unknown"),
            "slot": contradiction_context.get("slot", "unknown"),
            "label": contradiction_context.get("label", "unknown"),
            "intent_score": contradiction_context.get("intent_score", "0"),
            "trigger_hits": contradiction_context.get("trigger_hits", "0"),
        }
        log_message(
            "contradiction_guard",
            (
                "EP1 contradiction mode applied for "
                f"{character_key} ({contradiction_context.get('behavior')} | slot={contradiction_context.get('slot')} | "
                f"intent={contradiction_context.get('intent_score')} | slot_hits={contradiction_context.get('trigger_hits')}). "
                f"User message: {user_message[:200]}"
            ),
            participant_code,
        )

    # Enhance system prompt with character identity reminder
    if character_key:
        from .game_config import CHARACTER_DATA  # Local import to avoid circular dependency
        char_data = CHARACTER_DATA.get(character_key, {})
        char_name = char_data.get("full_name", character_key)
        enhanced_system_prompt = (
            f"{system_prompt}{knowledge_context}"
            f"{contradiction_instruction or ''}\n\n"
            f"IMPORTANT: You are {char_name}. You must respond ONLY as {char_name}, "
            "speaking in first person about YOUR OWN experiences and observations. "
            "Do not speak for other characters or describe their actions."
        )
    else:
        enhanced_system_prompt = f"{system_prompt}{knowledge_context}{contradiction_instruction or ''}"
    
    # Each character sees public dialogue plus their own private exchanges.
    episode = state.get("current_stage", 1)
    raw_history = list(user_histories.get(history_key, []))
    if episode == 2:
        prior_key = f"{participant_code}:1"
        prior_history = user_histories.get(prior_key, [])
        if prior_history:
            raw_history = (prior_history + raw_history)[-20:]
    base_history = (
        _filter_history_for_character(raw_history, character_key)
        if character_key
        else raw_history
    )
    character_history = _rewrite_history_for_active_character(base_history[-10:], character_key)
    messages = [{"role": "system", "content": enhanced_system_prompt}]
    messages.extend(character_history)
    
    messages.append({"role": "user", "content": user_message})
    
    if client is None:
        return _get_fallback_response(character_key)

    try:
        chat_completion = client.chat.completions.create(model=GROQ_CHAT_MODEL, messages=messages, temperature=0.7)  # Reduced from 0.8 for more stability
        assistant_reply = chat_completion.choices[0].message.content
        
        if not assistant_reply or assistant_reply.strip() == "":
            print(f"WARNING: Empty response from AI for participant {participant_code}")
            return "I'm not sure how to respond to that."
        
        # Validate the AI response for corruption and excessive length
        is_valid, validated_response = validate_ai_response(assistant_reply, character_key)
        if not is_valid:
            print(f"WARNING: AI response validation failed for participant {participant_code}, using fallback")
            log_message("ai_validation_failed", f"Original response preview: {assistant_reply[:200]}...", participant_code)
            
            # Clear conversation history more aggressively when corruption is detected
            # Lowered threshold from 5000 to 2000 chars, and also clear on certain patterns
            should_clear_history = (
                len(assistant_reply) > 2000 or  # Long corrupted responses
                '"""""""' in assistant_reply or  # Quote repetition pattern
                'testtesttest' in assistant_reply or  # Test repetition pattern
                'optionoptionoption' in assistant_reply or  # Option repetition pattern
                assistant_reply.count(',') > 50  # Excessive commas
            )
            
            if should_clear_history:
                print(f"WARNING: Severe AI corruption detected for participant {participant_code}, clearing conversation history")
                clear_user_conversation_history(participant_code)
            
            assistant_reply = validated_response
        else:
            assistant_reply = validated_response

        # Remove leaked "[you]:" / "you:" prefixes that can appear from rewritten history tags.
        assistant_reply = _strip_leading_self_reference_prefix(assistant_reply)
        
        # Clean up any character name prefixes from the response
        if character_key:
            # Remove patterns like "tim: ", "fiona: ", "Tim Kane: ", etc.
            from .game_config import CHARACTER_DATA  # Local import to avoid circular dependency
            char_data = CHARACTER_DATA.get(character_key, {})
            char_name = char_data.get("full_name", character_key)
            
            # Try to remove various patterns of character name prefixes
            patterns_to_remove = [
                f"[{character_key}]: ",
                f"[{character_key.lower()}]: ",
                f"[{character_key.upper()}]: ",
                f"[{char_name}]: ",
                f"{character_key}: ",
                f"{character_key.lower()}: ",
                f"{character_key.upper()}: ",
                f"{char_name}: ",
                f"*{char_name}:* ",
                f"**{char_name}:** ",
            ]
            
            for pattern in patterns_to_remove:
                if assistant_reply.startswith(pattern):
                    assistant_reply = assistant_reply[len(pattern):].strip()
                    break
            
            # Remove quotes from the beginning and end of the response
            # Handle various quote types: regular quotes, single quotes, typographic quotes
            quote_chars = ['"', "'", '"', '"', ''', ''', '«', '»']
            
            # Remove quotes from the start
            while assistant_reply and assistant_reply[0] in quote_chars:
                assistant_reply = assistant_reply[1:].strip()
            
            # Remove quotes from the end
            while assistant_reply and assistant_reply[-1] in quote_chars:
                assistant_reply = assistant_reply[:-1].strip()
        
        # Store the conversation with character identification
        if character_key:
            tagged_user_message = f"[Detective to {character_key}]: {user_message}"
        else:
            tagged_user_message = user_message

        resolved_scope = chat_scope if chat_scope in {"public", "private"} else "public"
        history_user = {"role": "user", "content": tagged_user_message, "chat_scope": resolved_scope}
        if character_key and resolved_scope == "private":
            history_user["character_key"] = character_key

        user_histories[history_key].append(history_user)
        if len(user_histories[history_key]) > 20:
            user_histories[history_key] = user_histories[history_key][-20:]

        if character_key:
            append_character_line_to_history(
                participant_code,
                character_key,
                assistant_reply,
                chat_scope=resolved_scope,
            )
        else:
            # Rare path without a character key: keep untagged assistant text.
            user_histories[history_key].append(
                {"role": "assistant", "content": assistant_reply, "chat_scope": resolved_scope}
            )
            if len(user_histories[history_key]) > 20:
                user_histories[history_key] = user_histories[history_key][-20:]
        return assistant_reply
    except Exception as e:
        print(f"ERROR: Failed in ask_for_dialogue for participant {participant_code}: {e}")
        log_message("dialogue_error", f"ask_for_dialogue failed: {e}", participant_code)
        return "Sorry, a server error occurred."

async def ask_tutor_for_analysis(
    participant_code: str,
    text_to_analyze: str,
    source: str = "tell",
) -> dict:
    """A special function that calls the Tutor for text analysis and expects a JSON response."""
    tutor_prompt = _get_tutor_prompt("analysis", source=source)
    normalized_source = str(source or "tell").strip().lower()
    analysis_request = f"Analyze this text: '{text_to_analyze}'"
    messages = [{"role": "system", "content": tutor_prompt}, {"role": "user", "content": analysis_request}]
    try:
        log_message(
            "tutor_analysis_input",
            json.dumps(
                {
                    "source": normalized_source,
                    "text_to_analyze": text_to_analyze,
                    "analysis_request": analysis_request,
                    "messages": messages,
                },
                ensure_ascii=False,
            ),
            participant_code,
        )
    except Exception:
        # Logging must never break tutor flow.
        pass
    if client is None:
        return {"passed": False, "improvement_needed": False, "feedback": "", "briefly": ""}
    try:
        chat_completion = client.chat.completions.create(model=GROQ_CHAT_MODEL, messages=messages, temperature=0.5)
        response_text = chat_completion.choices[0].message.content
        
        # Validate response for corruption
        is_valid, validated_response = validate_ai_response(response_text)
        if not is_valid:
            print(f"WARNING: Tutor analysis response validation failed for participant {participant_code}")
            log_message("tutor_validation_failed", f"Corrupted tutor response: {response_text[:200]}...", participant_code)
            return {"passed": False, "improvement_needed": False, "feedback": "", "briefly": ""}

        parsed = json.loads(validated_response)
        if not isinstance(parsed, dict):
            return {"passed": False, "improvement_needed": False, "feedback": "", "briefly": ""}
        if "passed" not in parsed:
            parsed["passed"] = False
        return parsed
    except (json.JSONDecodeError, Exception) as e:
        log_message("tutor_error", f"Could not parse tutor analysis JSON: {e}", participant_code)
        return {"passed": False, "improvement_needed": False, "feedback": "", "briefly": ""}


async def ask_teach_corrector(participant_code: str, text_to_analyze: str) -> list:
    """Run Teach corrector prompt and return normalized list of errors."""
    prompt = load_system_prompt(TEACH_CORRECTOR_PROMPT_PATH)
    cleaned_text = str(text_to_analyze or "").strip()
    messages = [{"role": "system", "content": prompt}, {"role": "user", "content": cleaned_text}]
    if client is None:
        return []
    try:
        chat_completion = client.chat.completions.create(
            model=GROQ_CHAT_MODEL,
            messages=messages,
            temperature=0.2,
        )
        response_text = chat_completion.choices[0].message.content
        is_valid, validated_response = validate_ai_response(response_text)
        if not is_valid:
            log_message("teach_corrector_validation_failed", f"Corrupted response: {response_text[:200]}...", participant_code)
            return []

        parsed = _parse_json_array_payload(validated_response)
        normalized_errors = []
        for item in parsed:
            if not isinstance(item, dict):
                continue
            fragment = str(item.get("fragment") or "").strip()
            explanation = str(item.get("explanation") or "").strip()
            suggestion = str(item.get("suggestion") or "").strip()
            if not (fragment or explanation or suggestion):
                continue
            normalized_errors.append(
                {
                    "fragment": fragment,
                    "explanation": explanation,
                    "suggestion": suggestion,
                }
            )
        return normalized_errors
    except Exception as e:
        log_message("teach_corrector_error", f"Could not parse corrector response: {e}", participant_code)
        return []


async def ask_teach_deliver_feedback(participant_code: str, errors: list) -> str:
    """Run Teach feedback delivery prompt based on error list."""
    prompt = load_system_prompt(TEACH_DELIVER_FEEDBACK_PROMPT_PATH)
    safe_errors = errors if isinstance(errors, list) else []
    user_payload = json.dumps(safe_errors, ensure_ascii=False)
    messages = [{"role": "system", "content": prompt}, {"role": "user", "content": user_payload}]
    if client is None:
        return ""
    try:
        chat_completion = client.chat.completions.create(
            model=GROQ_CHAT_MODEL,
            messages=messages,
            temperature=0.5,
        )
        response_text = chat_completion.choices[0].message.content
        is_valid, validated_response = validate_ai_response(response_text)
        if not is_valid:
            log_message("teach_deliver_feedback_validation_failed", f"Corrupted response: {response_text[:200]}...", participant_code)
            return ""
        return str(validated_response or "").strip()
    except Exception as e:
        log_message("teach_deliver_feedback_error", f"Failed to generate deliver feedback: {e}", participant_code)
        return ""

async def ask_tutor_for_explanation(participant_code: str, text_to_explain: str, original_message: str = "") -> dict:
    """A special function that calls the Tutor for an explanation and expects a JSON response."""
    tutor_prompt = _get_tutor_prompt("explanation")

    text_to_explain = (text_to_explain or "").strip()
    original_message = (original_message or "").strip()
    request_payload = {
        "selected_text": text_to_explain,
        "original_message": original_message,
    }
    explanation_request = (
        "Explain the selected text using the JSON payload below.\n"
        "Important: the selected text always comes from the original message (possibly as a substring).\n"
        f"{json.dumps(request_payload, ensure_ascii=False)}"
    )
    try:
        log_message(
            "tutor_explain_input",
            json.dumps(
                {
                    "selected_text": text_to_explain,
                    "original_message_len": len(original_message),
                    "original_message_preview": original_message[:300],
                    "request_preview": explanation_request[:500],
                },
                ensure_ascii=False,
            ),
            participant_code,
        )
    except Exception:
        # Logging must never break tutor flow.
        pass
        
    messages = [{"role": "system", "content": tutor_prompt}, {"role": "user", "content": explanation_request}]
    if client is None:
        return {}
    try:
        chat_completion = client.chat.completions.create(model=GROQ_CHAT_MODEL, messages=messages, temperature=0.5)
        response_text = chat_completion.choices[0].message.content
        
        # Validate response for corruption
        is_valid, validated_response = validate_ai_response(response_text)
        if not is_valid:
            print(f"WARNING: Tutor explanation response validation failed for participant {participant_code}")
            log_message("tutor_validation_failed", f"Corrupted tutor response: {response_text[:200]}...", participant_code)
            return {}
        
        parsed = json.loads(validated_response)
        if not isinstance(parsed, dict):
            return {}

        definition = parsed.get("definition", "")
        examples = parsed.get("examples", [])
        contextual_explanation = parsed.get("contextual_explanation", "")

        if not isinstance(definition, str):
            definition = str(definition)
        if not isinstance(examples, list):
            examples = []
        else:
            examples = [str(example) for example in examples]
        if not isinstance(contextual_explanation, str):
            contextual_explanation = str(contextual_explanation)

        # Keep a non-empty context field when original text was provided.
        if original_message and not contextual_explanation.strip():
            contextual_explanation = (
                f"In this message, '{text_to_explain}' is used in context of the sentence."
            )

        result = {
            "definition": definition,
            "examples": examples,
            "contextual_explanation": contextual_explanation,
        }
        try:
            log_message(
                "tutor_explain_output",
                json.dumps(
                    {
                        "definition_preview": definition[:200],
                        "examples_count": len(examples),
                        "contextual_explanation_preview": contextual_explanation[:300],
                    },
                    ensure_ascii=False,
                ),
                participant_code,
            )
        except Exception:
            pass
        return result
    except (json.JSONDecodeError, Exception) as e:
        log_message("tutor_error", f"Could not parse tutor explanation JSON: {e}", participant_code)
        return {}

async def ask_tutor_for_final_summary(
    participant_code: str,
    progress_data: dict,
    source: str = "tell",
) -> dict:
    """A special function that calls the Tutor for final learning summary and expects plain text."""

    # Prepare summary of user's progress
    words_learned = progress_data.get("words_learned", [])
    writing_feedback = progress_data.get("writing_feedback", [])

    # No errors + no new words: deterministic static summary
    if not writing_feedback and not words_learned:
        static_summary = load_system_prompt("prompts/language_learning/final_summary_no_errors_no_vocab.md").strip()
        return {"summary": static_summary}

    # No errors + has new words: deterministic static summary with word count
    if not writing_feedback and words_learned:
        words_count = len(words_learned)
        static_summary = load_system_prompt("prompts/language_learning/final_summary_no_errors.md").strip()
        return {"summary": static_summary.replace("[n_words]", str(words_count))}

    # Generate with tutor only when both errors and new words are present
    if not (writing_feedback and words_learned):
        return {"summary": "Great job completing the game! You showed curiosity and engagement with English. Keep practicing and you'll continue to improve!"}

    normalized_source = str(source or "tell").strip().lower()
    summary_prompt_path = TUTOR_FINAL_SUMMARY_PROMPT_PATHS.get(
        normalized_source,
        TUTOR_FINAL_SUMMARY_PROMPT_PATHS["tell"],
    )
    tutor_prompt = load_system_prompt(summary_prompt_path)
    summary_request = f"Generate final learning summary. User learned {len(words_learned)} words"

    summary_request += f" (words: {', '.join([entry['query'] for entry in words_learned[:5]])}{'...' if len(words_learned) > 5 else ''})"
    summary_request += f" and received {len(writing_feedback)} pieces of feedback on their writing."

    full_error_corpus = [
        {
            "user_text": entry.get("query", ""),
            "feedback_for_user": entry.get("feedback", ""),
            "briefly": entry.get("briefly", ""),
        }
        for entry in writing_feedback
    ]
    summary_request += (
        f" Full error corpus (all entries) with teacher-oriented brief tags: "
        f"{json.dumps(full_error_corpus, ensure_ascii=False)}."
    )
    summary_request += " Please provide a warm summary using the good-areas to improve-good structure."

    messages = [{"role": "system", "content": tutor_prompt}, {"role": "user", "content": summary_request}]
    try:
        log_message(
            "tutor_final_summary_input",
            json.dumps(
                {
                    "words_learned_count": len(words_learned),
                    "writing_feedback_count": len(writing_feedback),
                    "words_learned": words_learned,
                    "full_error_corpus": full_error_corpus,
                    "summary_request": summary_request,
                    "messages": messages,
                },
                ensure_ascii=False,
            ),
            participant_code,
        )
    except Exception:
        # Logging must never break tutor flow.
        pass
    if client is None:
        return {"summary": "Great job completing the game! You showed curiosity and engagement with English. Keep practicing and you'll continue to improve!"}
    try:
        chat_completion = client.chat.completions.create(model=GROQ_CHAT_MODEL, messages=messages, temperature=0.7)
        response_text = chat_completion.choices[0].message.content
        
        # Validate response for corruption
        is_valid, validated_response = validate_ai_response(response_text)
        if not is_valid:
            print(f"WARNING: Tutor final summary response validation failed for participant {participant_code}")
            log_message("tutor_validation_failed", f"Corrupted tutor response: {response_text[:200]}...", participant_code)
            return {"summary": "Great job completing the game! You showed curiosity and engagement with English. Keep practicing and you'll continue to improve!"}
        
        return {"summary": validated_response.strip()}
    except Exception as e:
        log_message("tutor_error", f"Could not get tutor final summary: {e}", participant_code)
        return {"summary": "Great job completing the game! You showed curiosity and engagement with English. Keep practicing and you'll continue to improve!"}


async def ask_word_spotter(text_to_analyze: str) -> list:
    """Asks the Word Spotter AI to find difficult words in a text."""
    prompt = load_system_prompt(get_prompt_path("lexicographer", 1))
    messages = [{"role": "system", "content": prompt}, {"role": "user", "content": text_to_analyze}]
    if client is None:
        return []
    try:
        chat_completion = client.chat.completions.create(model=GROQ_CHAT_MODEL, messages=messages, temperature=0.2)
        response_text = chat_completion.choices[0].message.content
        
        # Validate response for corruption
        is_valid, validated_response = validate_ai_response(response_text)
        if not is_valid:
            print(f"WARNING: Word spotter response validation failed")
            print(f"Corrupted word spotter response: {response_text[:200]}...")
            return []
        
        words = json.loads(validated_response)
        return [word.lower() for word in words]
    except Exception as e:
        print(f"Error calling Word Spotter or parsing JSON: {e}"); return []

async def ask_director(participant_code: str, context_text: str, message: str) -> dict:
    """Asks the Director LLM for the next scene and returns it as a dictionary."""
    from .predefined_responses import try_predefined_response
    from .game_config import GAME_STATE
    director_basis = "ai_director_after_predefined_miss"
    
    # First, try to get a predefined response based on keywords
    try:
        print(f"DEBUG: Checking predefined responses for participant {participant_code}, message: '{message}'")
        state = GAME_STATE.get(participant_code, {})
        topic_memory = state.get("topic_memory", {"topic": "None", "spoken": []})
        print(f"DEBUG: Topic memory for participant {participant_code}: {topic_memory}")
        
        predefined_response = try_predefined_response(participant_code, message, topic_memory)
        print(f"DEBUG: Predefined response result for participant {participant_code}: {predefined_response is not None}")
        
        if predefined_response:
            print(f"DEBUG: Using predefined response for participant {participant_code}: {predefined_response}")
            log_message("director_predefined", f"Used predefined response for message: {message[:100]}", participant_code)
            predefined_payload = dict(predefined_response)
            predefined_payload["_debug_director_basis"] = "predefined_response"
            return predefined_payload
        else:
            print(f"DEBUG: No predefined response found for participant {participant_code}, falling back to AI director")
    except Exception as e:
        print(f"WARNING: Failed to check predefined responses for participant {participant_code}: {e}")
        import traceback
        traceback.print_exc()
        director_basis = "ai_director_after_predefined_check_error"
        # Continue to AI director as fallback
    
    # Fallback to AI Director (episode + location-aware path)
    state = GAME_STATE.get(participant_code, {})
    episode = state.get("current_stage", 1)
    location = None
    try:
        from .game_config import STAGE_CONFIG
        stage_config = STAGE_CONFIG.get(episode, {})
        if stage_config.get("locations"):
            stage_locations = state.get("stage_locations", {})
            location = (
                stage_locations.get(str(episode))
                or stage_locations.get(episode)
                or stage_config.get("default_location")
            )
    except Exception:
        # Keep robust fallback behavior if stage config cannot be resolved.
        location = None

    director_prompt = load_system_prompt(get_prompt_path("director", episode, location))
    full_context_for_director = f"Context: \"{context_text}\"\nMessage: \"{message}\""
    director_messages = [{"role": "system", "content": director_prompt}, {"role": "user", "content": full_context_for_director}]
    try:
        if client is None:
            raise RuntimeError("Groq client not available")
        print(f"DEBUG: Calling director for participant {participant_code} with context: {context_text[:100]}...")
        chat_completion = client.chat.completions.create(model=GROQ_CHAT_MODEL, messages=director_messages, temperature=0.5)
        response_text = chat_completion.choices[0].message.content
        print(f"DEBUG: Director raw response for participant {participant_code}: {response_text[:200]}...")
        log_message("director", response_text, participant_code)
        
        # Validate response for corruption before parsing JSON
        is_valid, validated_response = validate_ai_response(response_text)
        if not is_valid:
            print(f"WARNING: Director response validation failed for participant {participant_code}")
            log_message("director_validation_failed", f"Corrupted director response: {response_text[:200]}...", participant_code)
            return {"scene": [], "_debug_director_basis": "ai_director_response_validation_failed"}
        
        # Try to parse the JSON response (with tolerant extraction)
        try:
            director_decision = _parse_director_json_payload(validated_response)
            print(f"DEBUG: Director parsed JSON for participant {participant_code}: {director_decision}")
            
            # Validate the response structure
            if not isinstance(director_decision, dict):
                print(f"ERROR: Director returned non-dict response: {type(director_decision)}")
                return {"scene": [], "_debug_director_basis": "ai_director_invalid_payload"}
            
            if "scene" not in director_decision:
                print(f"ERROR: Director response missing 'scene' key: {director_decision}")
                return {"scene": [], "_debug_director_basis": "ai_director_missing_scene"}
            
            if not isinstance(director_decision["scene"], list):
                print(f"ERROR: Director 'scene' is not a list: {type(director_decision['scene'])}")
                return {"scene": [], "_debug_director_basis": "ai_director_invalid_scene_type"}
            
            director_decision["_debug_director_basis"] = director_basis
            return director_decision
            
        except json.JSONDecodeError as json_error:
            print(f"ERROR: Failed to parse director JSON response: {json_error}")
            print(f"Director response text: {response_text}")
            log_message("director_error", f"JSON parse error: {json_error}. Response: {response_text[:500]}", participant_code)
            return {"scene": [], "_debug_director_basis": "ai_director_json_parse_error"}
            
    except Exception as e:
        print(f"ERROR: Failed to call director: {e}")
        log_message("director_error", f"Director call failed: {e}", participant_code)
        return {"scene": [], "_debug_director_basis": "ai_director_call_error"}