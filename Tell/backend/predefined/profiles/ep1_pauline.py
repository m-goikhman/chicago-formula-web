"""EP1 predefined topics when Pauline is on stage (part 2)."""

from typing import Any, Dict


EP1_TOPICS_WITH_PAULINE: Dict[str, Dict[str, Any]] = {
    "christmas_card": {
        "keywords": ["card", "christmas", "threat", "threatening", "pay up", "handwriting", "threatening card", "received"],
        "characters_priority": ["tim"],
        "response_strategy": "all",
        "response_templates": {
            "tim": {
                "action": "character_reply",
                "data": {
                    "character_key": "tim",
                    "trigger_message": "The detective is asking about the threatening Christmas card you received. Share your experience and emotional reaction to receiving it. After mentioning it initially, refer to it as 'the card', 'the threat', or 'it' - don't keep repeating 'Christmas card'.",
                },
            }
        },
        "topic_name": "Christmas card threat",
    },
    "usb_drive": {
        "keywords": ["usb", "plane", "airplane", "plane-shaped", "usb-drive", "flash drive", "memory stick"],
        "characters_priority": ["pauline", "fiona"],
        "response_strategy": "all",
        "response_templates": {
            "pauline": {
                "action": "character_reply",
                "data": {
                    "character_key": "pauline",
                    "trigger_message": "The detective is asking about the USB drive Alex asked you to retrieve. Share what you know about getting this device for him - avoid repeating descriptive phrases, just call it 'the drive' or 'the USB'.",
                },
            },
            "fiona": {
                "action": "character_reply",
                "data": {
                    "character_key": "fiona",
                    "trigger_message": "Pauline just explained how she retrieved the USB drive for Alex. As his girlfriend, add your personal perspective about this device - why Alex considered it 'lucky' and how it relates to your relationship. Refer to it naturally as 'it', 'the device', or 'his drive' rather than repeating the full description.",
                },
            },
        },
        "topic_name": "Airplane-shaped USB drive",
    },
    "alibi_1845": {
        "keywords": ["alibi", "18:45", "6:45", "where were", "time", "6.45", "what were you doing"],
        "characters_priority": ["tim", "fiona", "ronnie", "pauline"],
        "response_strategy": "all",
        "response_templates": {
            "tim": {
                "action": "character_reply",
                "data": {
                    "character_key": "tim",
                    "trigger_message": "The detective is asking for your alibi at 6:45 PM. Provide your cover story about where you were. Use natural language - after establishing the time, refer to it as 'then', 'at that time', etc.",
                },
            },
            "fiona": {
                "action": "character_reply",
                "data": {
                    "character_key": "fiona",
                    "trigger_message": "Tim just provided his whereabouts for that evening. Now share your own location at that time. Avoid repeating '6:45 PM' - use 'then', 'at that time', 'when it happened'.",
                },
            },
            "ronnie": {
                "action": "character_reply",
                "data": {
                    "character_key": "ronnie",
                    "trigger_message": "Both Tim and Fiona have shared where they were at 6:45 PM. Tell the detectkve your location at that time, keeping in mind what the others have already revealed. Use varied language - 'then', 'at that moment', etc.",
                },
            },
            "pauline": {
                "action": "character_reply",
                "data": {
                    "character_key": "pauline",
                    "trigger_message": "After hearing the others' accounts of that evening, explain where you at were at 6:45 PM since you weren't at the party. Consider how your whereabouts fit with the timeline others have established. Use natural language variations.",
                },
            },
        },
        "topic_name": "Alibis for 6:45 PM",
    },
    "money_debt": {
        "keywords": ["money", "debt", "debts", "business", "financial", "loan", "owe", "owed"],
        "characters_priority": ["pauline", "ronnie"],
        "response_strategy": "all",
        "response_templates": {
            "pauline": {
                "action": "character_reply",
                "data": {
                    "character_key": "pauline",
                    "trigger_message": "The detective is asking about Alex's money and debts. Share what you know about his financial situation.",
                },
            },
            "ronnie": {
                "action": "character_reply",
                "data": {
                    "character_key": "ronnie",
                    "trigger_message": "The detective is asking about money and debts. You lent money to Alex - share details about his financial troubles.",
                },
            },
        },
        "topic_name": "Alex's debts and money troubles",
    },
    "arrival_time": {
        "keywords": ["arrived", "arrive", "arrival", "how did you get", "come to", "came to", "get here", "get to alex"],
        "characters_priority": ["tim", "fiona", "ronnie", "pauline"],
        "response_strategy": "ordered_sequence",
        "ordered_responses": [
            {"action": "character_reply", "data": {"character_key": "ronnie", "trigger_message": "The detective is asking about when and how you arrived at Alex's apartment. Share your arrival time and transportation method."}},
            {"action": "character_reply", "data": {"character_key": "fiona", "trigger_message": "The detective is asking about when and how you arrived at Alex's apartment. Share your arrival time and transportation method."}},
            {"action": "character_reply", "data": {"character_key": "tim", "trigger_message": "The detective is asking about when and how you arrived at Alex's apartment. Give your cover story about your arrival time and transportation method."}},
            {"action": "character_reply", "data": {"character_key": "pauline", "trigger_message": "The detective is asking about arrivals. Tell how you got here first time and then again at 21:00."}},
        ],
        "response_templates": {
            "tim": {"action": "character_reply", "data": {"character_key": "tim", "trigger_message": "The detective is asking about when and how you arrived at Alex's apartment. Give your cover story about your arrival time and transportation method."}},
            "fiona": {"action": "character_reply", "data": {"character_key": "fiona", "trigger_message": "The detective is asking about when and how you arrived at Alex's apartment. As Alex's girlfriend, explain your arrival details."}},
            "ronnie": {"action": "character_reply", "data": {"character_key": "ronnie", "trigger_message": "The detective is asking about when and how you arrived at Alex's apartment. Share your arrival time and transportation method."}},
            "pauline": {"action": "character_reply", "data": {"character_key": "pauline", "trigger_message": "The detective is asking about when and how you arrived at Alex's apartment. Explain your arrival details and why you came."}},
        },
        "topic_name": "Arrival times and transportation to Alex's apartment",
    },
}

