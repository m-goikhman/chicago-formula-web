import bootstrap  # noqa: F401  # ensures shared modules are on sys.path
from shared.backend.config import (
    get_secret,
    TELEGRAM_TOKEN,
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
STAGE_UNLOCK_DELAY_DAYS = 7  # Days between stage unlocks

# Stage configuration
# intro_files: list of steps for case intro. Each step is a filename (str) or dict with
#   "file", optional "button", "type" ("system"|"character"), "image", "character".
# Episodes 2+ can have any length (0, 1, …); missing files are skipped without error.
STAGE_CONFIG = {
    1: {
        "name": "The Party",
        "clues_count": 4,
        "clue_names": [
            "Med Report & Personal Items",
            "The Weapon",
            "The Note",
            "The Apartment",
        ],
        "characters": ["tim", "pauline", "fiona", "ronnie"],
        "default_location": "part1_ep1",
        "locations": {
            "part1_ep1": {
                "name": "Party - Before Pauline",
                "characters": ["tim", "ronnie", "fiona"],
                "show_in_switcher": False,
            },
            "part2_ep1": {
                "name": "Party - Pauline Arrives",
                "characters": ["tim", "ronnie", "fiona", "pauline"],
                "show_in_switcher": False,
            },
        },
        "intro_files": [
            {"file": "atmospheric_start.txt", "type": "system", "image": "ep1/aric-cheng-7Bv9MrBan9s-unsplash.jpg", "button": "Accept the Call"},
            {"file": "case_intro_1_call.txt", "type": "character", "character": "nina", "button": "What happened?"},
            {"file": "case_intro_2_situation.txt", "type": "character", "character": "nina", "button": "Who is there?"},
            {"file": "case_intro_3_suspects.txt", "type": "character", "character": "nina", "image": "ep1/suspects.png", "button": "Start Investigation!"},
            {"file": "case_intro_4_nina_guidance.txt", "type": "character", "character": "nina", "image": "ep1/detective_guide.png", "button": "🔍 Game Menu"}
        ],
        "key_information": [
            "Tim stole the USB drive containing Alex's AI trading formula",
            "Tim has serious debt problems with Ronnie",
            "Alex was attacked to steal the USB drive",
            "The USB drive contains a revolutionary AI trading formula for Alex's PhD thesis"
        ]
    },
    2: {
        "name": "The Formula",
        "clues_count": 1,
        "clue_names": ["the formula"],
        "characters": ["nina"],  # Fallback for stages without location config
        "default_location": "default_ep2",
        "locations": {
            "default_ep2": {
                "name": "Episode 2 - Start",
                "characters": ["nina"],
                "action": "go_default_ep2",
                "show_in_switcher": False,
                "private_dialogue_openers": {
                    "nina": "dialogue_openers/default_ep2/nina.txt"
                }
            },
            "university_ep2": {
                "name": "University",
                "characters": ["nina", "james"],
                "action": "go_university_ep2",
                "texture_image": "ep2/university_texture.png"
            },
            "hospital_ep2": {
                "name": "Hospital",
                "characters": ["nina", "alex"],
                "action": "go_hospital_ep2",
                "texture_image": "ep2/hospital_texture.png"
            }
        },
        "intro_files": [
            {"file": "case_intro_1.txt", "button": "🔍 Game Menu"}
        ],
        "key_information": []
    },
    3: {
        "name": "Stage 3",
        "clues_count": 0,  # To be configured when content is created
        "characters": ["tim", "pauline", "fiona", "ronnie"],
        "intro_files": [
            {"file": "intro.txt", "button": "🔍 Game Menu"}
        ],
        "key_information": []
    },
    4: {
        "name": "Stage 4",
        "clues_count": 0,  # To be configured when content is created
        "characters": ["tim", "pauline", "fiona", "ronnie"],
        "intro_files": [
            {"file": "intro.txt", "button": "🔍 Game Menu"}
        ],
        "key_information": []
    }
}

# --- Character & Actor Data ---
# Prompts in prompts/ (root) are shared for all episodes; prompts in prompts/epN/ are episode-specific.
# Loading uses utils.get_prompt_path(character_key, episode) to resolve the path.
CHARACTER_DATA = {
    "tim": {"prompt_file": "prompts/ep1/prompt_tim.md", "full_name": "Tim Kane", "image": "ep1/tim.png"},
    "pauline": {"prompt_file": "prompts/ep1/prompt_pauline.md", "full_name": "Pauline Thompson", "image": "ep1/pauline.png"},
    "fiona": {"prompt_file": "prompts/ep1/prompt_fiona.md", "full_name": "Fiona McAllister", "image": "ep1/fiona.png"},
    "ronnie": {"prompt_file": "prompts/ep1/prompt_ronnie.md", "full_name": "Ronnie Snapper", "image": "ep1/ronnie.png"},
    "tutor": {"prompt_file": "prompts/prompt_tutor.md", "full_name": "English Tutor", "image": None},
    "nina": {"prompt_file": "prompts/prompt_nina.md", "full_name": "Sergeant Nina Réyes", "image": "nina.png"},
    "narrator": {"prompt_file": "prompts/prompt_narrator.md", "full_name": "Narrator", "image": None},
    "director": {"prompt_file": "prompts/ep1/prompt_director.md", "full_name": "Game Director", "image": None},
    "lexicographer": {"prompt_file": "prompts/prompt_lexicographer.md", "full_name": "Lexicographer", "image": None},
    "susan": {"prompt_file": "prompts/ep2/prompt_susan.md", "full_name": "Susan Nakamura", "image": "ep2/susan.png"},
    "james": {"prompt_file": "prompts/ep2/prompt_james.md", "full_name": "James Thornton", "image": "ep2/james.png"},
    "alex": {"prompt_file": "prompts/ep2/hospital_ep2/prompt_alex.md", "full_name": "Alex Martin", "image": "ep2/alex.png"},
}

# --- Global State Variables ---
GAME_STATE = {}
user_histories = {}
message_cache = {}

