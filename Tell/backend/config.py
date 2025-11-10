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

# --- Character & Actor Data ---
CHARACTER_DATA = {
    "tim": {"prompt_file": "prompts/prompt_tim.md", "full_name": "Tim Kane", "emoji": "📚", "image": "tim.png"},
    "pauline": {"prompt_file": "prompts/prompt_pauline.md", "full_name": "Pauline Thompson", "emoji": "💼", "image": "pauline.png"},
    "fiona": {"prompt_file": "prompts/prompt_fiona.md", "full_name": "Fiona McAllister", "emoji": "💔", "image": "fiona.png"},
    "ronnie": {"prompt_file": "prompts/prompt_ronnie.md", "full_name": "Ronnie Snapper", "emoji": "😎", "image": "ronnie.png"},
    "tutor": {"prompt_file": "prompts/prompt_tutor.md", "full_name": "English Tutor", "emoji": "🧑‍🏫", "image": None},
    "narrator": {"prompt_file": "prompts/prompt_narrator.md", "full_name": "Narrator", "emoji": "🎙️", "image": None},
    "director": {"prompt_file": "prompts/prompt_director.md", "full_name": "Game Director", "emoji": "🎬", "image": None},
    "lexicographer": {"prompt_file": "prompts/prompt_lexicographer.md", "full_name": "Lexicographer", "emoji": "📖", "image": None},
}

# --- Global State Variables ---
GAME_STATE = {}
user_histories = {}
message_cache = {}

