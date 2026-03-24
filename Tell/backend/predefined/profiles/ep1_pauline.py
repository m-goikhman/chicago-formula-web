"""EP1 predefined topics when Pauline is on stage (part 2)."""

from typing import Any, Dict


EP1_TOPICS_WITH_PAULINE: Dict[str, Dict[str, Any]] = {
    "christmas_card": {
        "keywords": ["card", "christmas", "threat", "threatening", "pay up", "handwriting", "threatening card", "received"],
        "characters_priority": ["tim"],
        "response_strategy": "all",
        "topic_name": "Christmas card threat",
    },
    "usb_drive": {
        "keywords": ["usb", "plane", "airplane", "plane-shaped", "usb-drive", "flash drive", "memory stick"],
        "characters_priority": ["pauline", "fiona"],
        "response_strategy": "all",
        "topic_name": "Airplane-shaped USB drive",
    },
    "alibi_1845": {
        "keywords": ["alibi", "18:45", "6:45", "where were", "time", "6.45", "what were you doing"],
        "characters_priority": ["tim", "fiona", "ronnie", "pauline"],
        "response_strategy": "all",
        "topic_name": "Alibis for 6:45 PM",
    },
    "money_debt": {
        "keywords": ["money", "debt", "debts", "business", "financial", "loan", "owe", "owed"],
        "characters_priority": ["pauline", "ronnie"],
        "response_strategy": "all",
        "topic_name": "Alex's debts and money troubles",
    },
    "arrival_time": {
        "keywords": ["arrived", "arrive", "arrival", "how did you get", "come to", "came to", "get here", "get to alex"],
        "characters_priority": ["tim", "fiona", "ronnie", "pauline"],
        "response_strategy": "ordered_sequence",
        "ordered_characters": ["ronnie", "fiona", "tim", "pauline"],
        "topic_name": "Arrival times and transportation to Alex's apartment",
    },
}