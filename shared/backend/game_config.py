from . import bootstrap  # noqa: F401  # ensures repo root is on sys.path
from .secrets import (
    get_secret,
    GROQ_API_KEY,
    GCS_BUCKET_NAME,
)

# --- Game Constants ---
# Total number of clues to be examined to unlock the final accusation
TOTAL_CLUES = 4
# Character keys for all suspects in the game
SUSPECT_KEYS = ["tim", "pauline", "fiona", "ronnie"]

# --- Multi-Stage Game Constants ---
TOTAL_STAGES = 4
# Actual unlock is early (buffer). Calendar reminders match the promised wait in outro copy.
NEXT_EPISODE_UNLOCK_HOURS = 48  # Hours after completing an episode before the next unlocks
# Reminder offset after completing episode N (before the next one). Ep2 wait is longer.
CALENDAR_REMINDER_HOURS_BY_COMPLETED_EPISODE = {
    1: 70,  # ~3 days
    2: 94,  # ~4 days
    3: 70,  # ~3 days
}
PORTAL_URL = "https://chicago-formula.web.app/"

# Stage configuration
# intro_files: list of steps for case intro. Each step is a filename (str) or dict with
#   "file", "type" ("system"|"character"), "character".
# Buttons / images should be defined in the corresponding game_texts file via
# [buttons] and [image: path] (optional [imageFirst]).
# Episodes 2+ can have any length (0, 1, …); missing files are skipped without error.
STAGE_CONFIG = {
    1: {
        "name": "The Party",
        "clues_count": 3,
        "clue_names": [
            "Med Report & Personal Items",
            "The Weapon",
            "The Note",
        ],
        "characters": ["tim", "fiona", "ronnie"],
        "intro_files": [
            {"file": "case_intro_1_call.txt", "type": "character", "character": "nina"},
            {"file": "case_intro_2_situation.txt", "type": "character", "character": "nina"},
            {"file": "case_intro_3_suspects.txt", "type": "character", "character": "nina"},
            {"file": "case_intro_4_nina_guidance.txt", "type": "character", "character": "nina"},
            {"file": "case_intro_5_arrest_order.txt", "type": "character", "character": "nina"}
        ],
        "key_information": [
            "Tim stole the USB drive containing Alex's AI trading formula",
            "Tim has serious debt problems with Ronnie",
            "Alex was attacked to steal the USB drive",
        ]
    },
    2: {
        "name": "Someone Unexpected",
        "clues_count": 4,
        "clue_names": [
            "Med Report & Personal Items",
            "The Weapon",
            "The Note",
            "The USB Drive",
        ],
        "characters": ["tim", "pauline", "fiona", "ronnie"],
        "intro_files": [
            {"file": "pauline_entrance.txt", "type": "system"},
        ],
        "key_information": [
            "The USB drive contains a revolutionary AI trading formula for Alex's PhD thesis",
            "Pauline Thompson arrived unexpectedly during the party investigation",
        ]
    },
    3: {
        "name": "The Formula",
        "clues_count": 1,
        "clue_names": ["the formula"],
        "characters": ["nina"],  # Fallback for stages without location config
        "default_location": "default_ep3",
        "locations": {
            "default_ep3": {
                "name": "Episode 3 - Start",
                "characters": ["nina"],
                "action": "go_default_ep3",
                "show_in_switcher": False,
                "private_dialogue_openers": {
                    "nina": "dialogue_openers/default_ep3/nina.txt"
                }
            },
            "university_ep3": {
                "name": "University",
                "characters": ["nina", "james"],
                "action": "go_university_ep3",
                "texture_image": "ep2/university_texture.png",
                "location_image": "ep2/university.png",
            },
            "alex_apartment_ep3": {
                "name": "Alex's apartment",
                "characters": ["nina", "alex"],
                "action": "go_alex_apartment_ep3",
                "texture_image": "ep2/alex_apartment_texture.png",
                "location_image": "ep2/apartment.png",
            }
        },
        "intro_files": [
            {"file": "case_intro_1.txt", "type": "character", "character": "nina"},
            {"file": "case_intro_2.txt", "type": "character", "character": "nina"}
        ],
        "key_information": []
    },
    4: {
        "name": "Someone Missing",
        "clues_count": 0,  # Per-location case_materials instead of global clues
        "characters": ["fiona", "susan", "ronnie", "pauline", "alex", "nina"],
        "default_location": "precinct_ep4",
        "locations": {
            "precinct_ep4": {
                "name": "Precinct",
                "characters": ["fiona"],
                "action": "go_precinct_ep4",
                "show_in_switcher": False,
            },
            "university_ep4": {
                "name": "University",
                "characters": ["susan"],
                "action": "go_university_ep4",
                "texture_image": "ep2/university_texture.png",
                "location_image": "ep2/university.png",
                "case_materials": [
                    {
                        "id": "alex_table",
                        "name": "Alex's table",
                        "text_file": "alex_table.txt",
                    }
                ],
            },
            "bar_ep4": {
                "name": "Bar",
                "characters": ["ronnie"],
                "action": "go_bar_ep4",
                "location_image": "ep4/bar.png",
            },
            "pauline_office_ep4": {
                "name": "Pauline's office",
                "characters": ["pauline"],
                "action": "go_pauline_office_ep4",
                "location_image": "ep4/office.png",
            },
            "phone_ep4": {
                "name": "Phone",
                "characters": ["nina"],
                "action": "go_phone_ep4",
                "show_in_switcher": False,
            },
            "motel_ep4": {
                "name": "Motel",
                "characters": ["alex"],
                "action": "go_motel_ep4",
                "location_image": "ep4/motel.png",
                "show_in_switcher": False,
            },
        },
        "intro_files": [
            {"file": "intro.txt"}
        ],
        "key_information": []
    }
}

# --- Character & Actor Data ---
# Prompts in prompts/ (root) are shared for all episodes; prompts in prompts/epN/ are episode-specific.
# Loading uses utils.get_prompt_path(character_key, episode) to resolve the path.
CHARACTER_DATA = {
    "tim": {"prompt_file": "prompts/ep1/prompt_tim.md", "full_name": "Tim Kane", "image": "ep1/tim.png"},
    "pauline": {"prompt_file": "prompts/ep2/prompt_pauline.md", "full_name": "Pauline Thompson", "image": "ep1/pauline.png"},
    "fiona": {"prompt_file": "prompts/ep1/prompt_fiona.md", "full_name": "Fiona McAllister", "image": "ep1/fiona.png"},
    "ronnie": {"prompt_file": "prompts/ep1/prompt_ronnie.md", "full_name": "Ronnie Snapper", "image": "ep1/ronnie.png"},
    "tutor": {"prompt_file": "prompts/prompt_tutor.md", "full_name": "English Tutor", "image": None},
    "nina": {"prompt_file": "prompts/prompt_nina.md", "full_name": "Sergeant Nina Réyes", "image": "nina.png"},
    "narrator": {"prompt_file": "prompts/prompt_narrator.md", "full_name": "Narrator", "image": None},
    "director": {"prompt_file": "prompts/ep1/prompt_director.md", "full_name": "Game Director", "image": None},
    "lexicographer": {"prompt_file": "prompts/prompt_lexicographer.md", "full_name": "Lexicographer", "image": None},
    "susan": {"prompt_file": "prompts/ep4/prompt_susan.md", "full_name": "Susan Nakamura", "image": "ep4/susan.png"},
    "james": {"prompt_file": "prompts/ep3/prompt_james.md", "full_name": "James Thornton", "image": "ep2/james.png"},
    "alex": {"prompt_file": "prompts/ep3/alex_apartment_ep3/prompt_alex.md", "full_name": "Alex Martin", "image": "ep2/alex.png"},
}

# --- Global State Variables ---
GAME_STATE = {}
user_histories = {}
message_cache = {}