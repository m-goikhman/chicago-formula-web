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
        "suspects": ["tim", "pauline", "fiona", "ronnie"],
        "intro_files": [
            {"file": "atmospheric_start.txt", "type": "system", "image": "aric-cheng-7Bv9MrBan9s-unsplash.jpg", "button": "Accept the Call"},
            {"file": "case_intro_1_call.txt", "type": "character", "character": "nina", "button": "What happened?"},
            {"file": "case_intro_2_situation.txt", "type": "character", "character": "nina", "button": "Who is there?"},
            {"file": "case_intro_3_suspects.txt", "type": "character", "character": "nina", "image": "suspects.png", "button": "Start Investigation!"},
            {"file": "case_intro_4_nina_guidance.txt", "type": "character", "character": "nina", "image": "detective_guide.png", "button": "🔍 Game Menu"}
        ],
        "key_information": [
            "Tim stole the USB drive containing Alex's AI trading formula",
            "Tim has serious debt problems with Ronnie",
            "Alex was attacked to steal the USB drive",
            "The USB drive contains a revolutionary AI trading formula for Alex's PhD thesis"
        ]
    },
    2: {
        "name": "Stage 2",
        "clues_count": 0,  # To be configured when content is created
        "suspects": ["tim", "pauline", "fiona", "ronnie"],
        "intro_files": [],
        "key_information": []
    },
    3: {
        "name": "Stage 3",
        "clues_count": 0,  # To be configured when content is created
        "suspects": ["tim", "pauline", "fiona", "ronnie"],
        "intro_files": [],
        "key_information": []
    },
    4: {
        "name": "Stage 4",
        "clues_count": 0,  # To be configured when content is created
        "suspects": ["tim", "pauline", "fiona", "ronnie"],
        "intro_files": [],
        "key_information": []
    }
}

# --- Character & Actor Data ---
# Prompts in prompts/ (root) are shared for all episodes; prompts in prompts/epN/ are episode-specific.
# Loading uses utils.get_prompt_path(character_key, episode) to resolve the path.
CHARACTER_DATA = {
    "tim": {"prompt_file": "prompts/ep1/prompt_tim.md", "full_name": "Tim Kane", "emoji": "📚", "image": "tim.png"},
    "pauline": {"prompt_file": "prompts/ep1/prompt_pauline.md", "full_name": "Pauline Thompson", "emoji": "💼", "image": "pauline.png"},
    "fiona": {"prompt_file": "prompts/ep1/prompt_fiona.md", "full_name": "Fiona McAllister", "emoji": "💔", "image": "fiona.png"},
    "ronnie": {"prompt_file": "prompts/ep1/prompt_ronnie.md", "full_name": "Ronnie Snapper", "emoji": "😎", "image": "ronnie.png"},
    "tutor": {"prompt_file": "prompts/prompt_tutor.md", "full_name": "English Tutor", "emoji": "🧑‍🏫", "image": None},
    "nina": {"prompt_file": "prompts/prompt_nina.md", "full_name": "Sergeant Nina Réyes", "emoji": "👮", "image": "nina.png"},
    "narrator": {"prompt_file": "prompts/prompt_narrator.md", "full_name": "Narrator", "emoji": "🎙️", "image": None},
    "director": {"prompt_file": "prompts/ep1/prompt_director.md", "full_name": "Game Director", "emoji": "🎬", "image": None},
    "lexicographer": {"prompt_file": "prompts/prompt_lexicographer.md", "full_name": "Lexicographer", "emoji": "📖", "image": None},
}

# --- Global State Variables ---
GAME_STATE = {}
user_histories = {}
message_cache = {}

