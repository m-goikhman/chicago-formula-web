"""
Helpers for parsing scripted game text messages and inline button actions.
"""

import re
from typing import Dict, List, NamedTuple, Optional, Tuple

from .game_config import CHARACTER_DATA

TYPEWRITER_SENDER = "typewriter"
SCRIPTED_SENDER_ALIASES = frozenset({"narrator", TYPEWRITER_SENDER})

_SENDER_LINE_RE = re.compile(
    r"^\[(from|character|sender)\s*:\s*([^\]]+)\]\s*$",
    flags=re.IGNORECASE,
)
_IMAGE_LINE_RE = re.compile(
    r"^\[image\s*:\s*([^\]]+)\]\s*$",
    flags=re.IGNORECASE,
)
_IMAGE_FIRST_LINE_RE = re.compile(r"^\[imageFirst\]\s*$", flags=re.IGNORECASE)


class ScriptedBlock(NamedTuple):
    """One sequential message produced from a game_texts script."""

    sender: Optional[str]
    text: str
    image: Optional[str] = None
    image_first: bool = False


def resolve_character_sender_key(raw_sender: str) -> Optional[str]:
    """Resolve sender key from metadata (key or full character name)."""
    if not isinstance(raw_sender, str):
        return None

    normalized = raw_sender.strip().lower()
    if not normalized:
        return None

    if normalized in SCRIPTED_SENDER_ALIASES:
        return normalized

    if normalized in CHARACTER_DATA:
        return normalized

    for key, data in CHARACTER_DATA.items():
        full_name = str(data.get("full_name", "")).strip().lower()
        if full_name and full_name == normalized:
            return key

    return None


def _parse_leading_metadata(
    content: str,
) -> Tuple[Optional[str], Optional[str], bool, str]:
    """
    Consume leading metadata lines from a text block.
    Supported (any order, one or more):
    - [from: james] / [character: Name] / [sender: narrator]
    - [image: ep1/suspects.png]
    - [imageFirst]
    """
    if not isinstance(content, str):
        return None, None, False, ""

    lines = content.splitlines()
    index = 0
    while index < len(lines) and not lines[index].strip():
        index += 1

    sender_key: Optional[str] = None
    image: Optional[str] = None
    image_first = False
    consumed_any = False

    while index < len(lines):
        line = lines[index].strip()
        if not line:
            break

        sender_match = _SENDER_LINE_RE.match(line)
        if sender_match:
            sender_key = resolve_character_sender_key(sender_match.group(2))
            consumed_any = True
            index += 1
            continue

        image_match = _IMAGE_LINE_RE.match(line)
        if image_match:
            image_path = image_match.group(1).strip()
            image = image_path or None
            consumed_any = True
            index += 1
            continue

        if _IMAGE_FIRST_LINE_RE.match(line):
            image_first = True
            consumed_any = True
            index += 1
            continue

        break

    if not consumed_any:
        return None, None, False, content

    body = "\n".join(lines[index:]).strip()
    return sender_key, image, image_first, body


def extract_sender_from_text(content: str) -> Tuple[Optional[str], str]:
    """
    Parse optional sender metadata from the beginning of a text block.
    Supported leading metadata formats (any order with image tags):
    - [from: james]
    - [character: James Clark]
    - [sender: narrator]
    - [sender: typewriter]

    Image tags are preserved in the returned body so callers can still
    run extract_image_from_text afterwards.
    """
    sender_key, image, image_first, body = _parse_leading_metadata(content)
    if sender_key is None and image is None and not image_first:
        return None, content

    prefix: List[str] = []
    if image:
        prefix.append(f"[image: {image}]")
    if image_first:
        prefix.append("[imageFirst]")
    if prefix:
        restored = "\n".join(prefix + ([body] if body else [])).strip()
        return sender_key, restored
    return sender_key, body


def extract_image_from_text(content: str) -> Tuple[Optional[str], bool, str]:
    """
    Parse optional image metadata from the beginning of a text block.
    Supported leading lines (any order with sender tags):
    - [image: ep1/suspects.png]
    - [imageFirst]

    Returns (image_path, image_first, remaining_content).
    Sender tags are preserved in the remaining content when present.
    """
    sender_key, image, image_first, body = _parse_leading_metadata(content)
    if image is None and not image_first:
        return None, False, content
    if sender_key:
        restored = f"[sender: {sender_key}]\n{body}".strip()
        return image, image_first, restored
    return image, image_first, body


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
    Omit action (or leave it empty after |) to keep chatting — maps to frontend `say_as_user`.
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
            label = line.strip()
            if label:
                buttons.append({"text": label, "action": "say_as_user"})
            continue
        text = text.strip()
        action = action.strip()
        if text:
            buttons.append({"text": text, "action": action or "say_as_user"})

    cleaned_content = "\n".join(body_lines).strip()
    return cleaned_content, buttons


def extract_scripted_message_blocks(
    content: str, default_sender: Optional[str] = None
) -> List[ScriptedBlock]:
    """
    Parse text into sequential message blocks with optional per-block sender/image.
    Metadata can be specified:
    - once at file level (sender applies as default; image applies to first block
      unless that block sets its own), and/or
    - at the top of each block split by `---`.
    """
    if not isinstance(content, str):
        return []

    normalized_default = default_sender or None
    global_sender, global_image, global_image_first, content_without_global = (
        _parse_leading_metadata(content)
    )
    if global_sender:
        normalized_default = global_sender

    blocks: List[ScriptedBlock] = []
    for chunk in split_text_messages(content_without_global):
        block_sender, block_image, block_image_first, block_text = _parse_leading_metadata(
            chunk
        )
        if not block_text:
            continue
        image = block_image
        image_first = block_image_first
        if image is None and not blocks and global_image:
            image = global_image
            image_first = global_image_first or image_first
        blocks.append(
            ScriptedBlock(
                sender=block_sender or normalized_default,
                text=block_text,
                image=image,
                image_first=image_first,
            )
        )
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
