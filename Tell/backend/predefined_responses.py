"""
Backward-compatible facade for predefined response logic.

Keep importing from this module in existing code:
    from predefined_responses import try_predefined_response
"""

from predefined.engine import (
    detect_topic_from_keywords,
    extract_character_from_message,
    extract_character_from_message_strict,
    try_predefined_response,
)
from predefined.registry import PREDEFINED_PROFILE_REGISTRY

__all__ = [
    "PREDEFINED_PROFILE_REGISTRY",
    "detect_topic_from_keywords",
    "extract_character_from_message",
    "extract_character_from_message_strict",
    "try_predefined_response",
]
