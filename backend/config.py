import os
import sys
from google.cloud import secretmanager

def get_secret(secret_name: str, default_env: str = None) -> str:
    """Safely retrieves secrets from Google Secret Manager or environment variables."""
    try:
        # Try Google Secret Manager first
        client = secretmanager.SecretManagerServiceClient()
        project_id = os.getenv('GOOGLE_CLOUD_PROJECT', 'the-chicago-formula')
        name = f"projects/{project_id}/secrets/{secret_name}/versions/latest"
        response = client.access_secret_version(request={"name": name})
        secret_value = response.payload.data.decode("UTF-8").strip()
        return secret_value
    except Exception as e:
        # Fallback to environment variables for local development
        if default_env:
            value = os.getenv(default_env)
            if value:
                print(f"WARNING: Using environment variable for {secret_name}. Secret Manager failed: {e}", file=sys.stderr)
                return value.strip() if value else None
        return None

# --- API Configuration ---
# For web version, TELEGRAM_TOKEN is not needed
TELEGRAM_TOKEN = None  # Not used in web version
GROQ_API_KEY = get_secret("groq-api-key", "GROQ_API_KEY")
GCS_BUCKET_NAME = get_secret("gcs-bucket-name", "GCS_BUCKET_NAME")

# For web version, make some secrets optional
if not GROQ_API_KEY:
    print("WARNING: GROQ_API_KEY not found. AI features will not work.", file=sys.stderr)

if not GCS_BUCKET_NAME:
    print("WARNING: GCS_BUCKET_NAME not found. Game state persistence disabled.", file=sys.stderr)

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

