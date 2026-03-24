"""EP1 predefined topics when Pauline is not on stage (part 1)."""

from typing import Any, Dict

from .ep1_pauline import EP1_TOPICS_WITH_PAULINE


def _clone_topic_without_pauline(topic_data: Dict[str, Any]) -> Dict[str, Any]:
    """Create EP1-part1 variant by removing Pauline-only branches."""
    cloned: Dict[str, Any] = {
        "keywords": list(topic_data.get("keywords", [])),
        "characters_priority": [c for c in topic_data.get("characters_priority", []) if c != "pauline"],
        "response_strategy": topic_data.get("response_strategy", "all"),
        "topic_name": topic_data.get("topic_name", ""),
    }

    ordered_characters = topic_data.get("ordered_characters")
    if isinstance(ordered_characters, list):
        cloned["ordered_characters"] = [char_key for char_key in ordered_characters if char_key != "pauline"]
    else:
        ordered_responses = topic_data.get("ordered_responses")
        if isinstance(ordered_responses, list):
            cloned["ordered_responses"] = [
                action
                for action in ordered_responses
                if action.get("data", {}).get("character_key") != "pauline"
            ]
    return cloned


EP1_TOPICS_NO_PAULINE: Dict[str, Dict[str, Any]] = {
    topic_key: _clone_topic_without_pauline(topic_data)
    for topic_key, topic_data in EP1_TOPICS_WITH_PAULINE.items()
}

