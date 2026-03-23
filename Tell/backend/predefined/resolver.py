"""Resolve active predefined profile from game state."""

from typing import Any, Dict, Set, Tuple

from config import GAME_STATE, STAGE_CONFIG
from predefined.registry import PREDEFINED_PROFILE_REGISTRY, PROFILE_DEFAULT, PROFILE_EP1_NO_PAULINE, PROFILE_EP1_PAULINE

EP1_PART2_LOCATION = "part2_ep1"


def _resolve_active_characters(state: Dict[str, Any]) -> Set[str]:
    """Resolve active characters from stage/location config."""
    stage = state.get("current_stage", 1)
    stage_config = STAGE_CONFIG.get(stage, {})
    locations = stage_config.get("locations", {})

    if not locations:
        configured = stage_config.get("characters", [])
        return set(configured) if isinstance(configured, list) else set()

    stage_locations = state.get("stage_locations", {})
    location_key = stage_locations.get(str(stage)) or stage_locations.get(stage) or stage_config.get("default_location")
    location_cfg = locations.get(location_key, {})
    location_characters = location_cfg.get("characters")
    if isinstance(location_characters, list):
        return set(location_characters)

    configured = stage_config.get("characters", [])
    return set(configured) if isinstance(configured, list) else set()


def resolve_profile_for_user(participant_code: Any) -> Tuple[str, Dict[str, Any], Set[str]]:
    """
    Select predefined profile by game context.
    """
    state = GAME_STATE.get(participant_code, {})
    stage = state.get("current_stage", 1)
    active_characters = _resolve_active_characters(state) if state else set()

    if stage == 1:
        stage_locations = state.get("stage_locations", {})
        location_key = stage_locations.get("1") or stage_locations.get(1)
        profile_id = PROFILE_EP1_PAULINE if location_key == EP1_PART2_LOCATION else PROFILE_EP1_NO_PAULINE
    else:
        profile_id = PROFILE_DEFAULT

    profile = PREDEFINED_PROFILE_REGISTRY.get(profile_id, PREDEFINED_PROFILE_REGISTRY[PROFILE_DEFAULT])
    return profile_id, profile, active_characters

