"""Registry of predefined topic profiles."""

from typing import Any, Dict

from predefined.profiles.ep1_no_pauline import EP1_TOPICS_NO_PAULINE
from predefined.profiles.ep1_pauline import EP1_TOPICS_WITH_PAULINE

PROFILE_EP1_NO_PAULINE = "ep1_no_pauline"
PROFILE_EP1_PAULINE = "ep1_pauline"
PROFILE_DEFAULT = "default"

PREDEFINED_PROFILE_REGISTRY: Dict[str, Dict[str, Any]] = {
    PROFILE_EP1_NO_PAULINE: {"topics": EP1_TOPICS_NO_PAULINE},
    PROFILE_EP1_PAULINE: {"topics": EP1_TOPICS_WITH_PAULINE},
    # Reserved place for hardcoded predefined sets in other episodes/scenes:
    # "ep2_default": {"topics": {...}},
    # "ep2_university": {"topics": {...}},
    PROFILE_DEFAULT: {"topics": {}},
}

