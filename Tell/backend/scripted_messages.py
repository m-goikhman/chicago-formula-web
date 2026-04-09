"""
Helpers for parsing scripted game text messages and inline button actions.
"""

import re
from typing import Dict, List, Optional, Tuple

from config import CHARACTER_DATA


def resolve_character_sender_key(raw_sender: str) -> Optional[str]:
    """Resolve sender key from metadata (key or full character name)."""
    if not isinstance(raw_sender, str):
        return None

    normalized = raw_sender.strip().lower()
    if not normalized:
        return None

    if normalized == "narrator":
        return "narrator"

    if normalized in CHARACTER_DATA:
        return normalized

    for key, data in CHARACTER_DATA.items():
        full_name = str(data.get("full_name", "")).strip().lower()
        if full_name and full_name == normalized:
            return key

    return None


def extract_sender_from_text(content: str) -> Tuple[Optional[str], str]:
    """
    Parse optional sender metadata from the beginning of a text block.
    Supported first non-empty line formats:
    - [from: james]
    - [character: James Clark]
    - [sender: narrator]
    """
    lines = content.splitlines()
    first_nonempty_index = None
    for index, line in enumerate(lines):
        if line.strip():
            first_nonempty_index = index
            break

    if first_nonempty_index is None:
        return None, content

    first_line = lines[first_nonempty_index].strip()
    sender_match = re.match(r"^\[(from|character|sender)\s*:\s*([^\]]+)\]\s*$", first_line, flags=re.IGNORECASE)
    if not sender_match:
        return None, content

    sender_key = resolve_character_sender_key(sender_match.group(2))
    body_lines = lines[:first_nonempty_index] + lines[first_nonempty_index + 1:]
    return sender_key, "\n".join(body_lines).strip()


def split_text_messages(content: str) -> List[str]:
    """
    Split a file into multiple sequential messages.
    Separator format: a standalone line with three or more dashes (e.g., `---`).
    """
    if not isinstance(content, str):
        return []

    chunks = re.split(r"(?m)^\s*---+\s*$", content)
    messages = [chunk.strip() for chunk in chunks if chunk and chunk.strip()]
    return messages


def extract_buttons_from_text(content: str) -> Tuple[str, List[Dict[str, str]]]:
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


def extract_scripted_message_blocks(
    content: str, default_sender: Optional[str] = None
) -> List[Tuple[Optional[str], str]]:
    """
    Parse text into sequential message blocks with optional per-block sender.
    Sender metadata can be specified:
    - once at file level (applies as default), and/or
    - at the top of each block split by `---`.
    """
    if not isinstance(content, str):
        return []

    normalized_default = default_sender or None
    global_sender, content_without_global_sender = extract_sender_from_text(content)
    if global_sender:
        normalized_default = global_sender

    blocks: List[Tuple[Optional[str], str]] = []
    for chunk in split_text_messages(content_without_global_sender):
        block_sender, block_text = extract_sender_from_text(chunk)
        if not block_text:
            continue
        blocks.append((block_sender or normalized_default, block_text))
    return blocks


def parse_inline_button_action(action: str) -> Optional[Tuple[str, str]]:
    """
    Parse inline button action payload.
    Supported formats:
    - inline::message text
    - inline::sender_key>>message text
    - inline::Full Character Name>>message text
    """
    if not isinstance(action, str):
        return None

    normalized = action.strip()
    if not normalized.startswith("inline::"):
        return None

    payload = normalized[len("inline::"):].strip()
    if not payload:
        return ("narrator", "")

    sender_key = "narrator"
    message_text = payload

    if ">>" in payload:
        raw_sender, raw_message = payload.split(">>", 1)
        sender_key = resolve_character_sender_key(raw_sender) or "narrator"
        message_text = raw_message

    message_text = message_text.replace("\\n", "\n").strip()
    return sender_key, message_text
