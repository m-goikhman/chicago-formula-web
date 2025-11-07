import os
import datetime
import json
from typing import Optional
from google.cloud import storage
from config import GCS_BUCKET_NAME
import pytz
storage_client = None
bucket = None

def _get_bucket():
    """Lazy initialization of storage client and bucket."""
    global storage_client, bucket
    if storage_client is None:
        storage_client = storage.Client()
    if bucket is None and GCS_BUCKET_NAME:
        try:
            bucket = storage_client.bucket(GCS_BUCKET_NAME)
        except Exception as e:
            print(f"WARNING: Failed to initialize GCS bucket '{GCS_BUCKET_NAME}': {e}")
            bucket = None
    return bucket
_BASE_DIR = os.path.dirname(os.path.abspath(__file__))

def log_message(user_id: int, role: str, content: str, participant_code: str = None):
    """Writes a message to the user's chat history log in Google Cloud Storage."""
    bucket = _get_bucket()
    if not bucket:
        print("WARNING: GCS_BUCKET_NAME is not set or invalid. Cloud logging is disabled.")
        return

    try:
        # Log all messages in full without any truncation
        # This ensures complete data capture for both research and regular logs
        sanitized_content = content

        # Use participant code if available, otherwise fall back to user_id
        if participant_code:
            blob_name = f"participant_logs/chat_history/{participant_code}_chat_history.txt"
        else:
            blob_name = f"user_logs/chat_history_{user_id}.txt"
        blob = bucket.blob(blob_name)

        try:
            existing_content = blob.download_as_text(encoding="utf-8")
        except Exception: 
            existing_content = ""

        # Use CET/CEST timezone (Central European Time)
        cet_tz = pytz.timezone('Europe/Berlin')
        timestamp = datetime.datetime.now(cet_tz).strftime("%Y-%m-%d %H:%M:%S %Z")
        log_entry = f"[{timestamp}] ({role}): {sanitized_content}\n"
        new_content = existing_content + log_entry

        blob.upload_from_string(new_content, content_type="text/plain; charset=utf-8")

    except Exception as e:
        print(f"[ERROR] Failed to write log to Cloud Storage for user {user_id}: {e}")

# Cache for system prompts to avoid repeated file I/O
_prompt_cache = {}

def clear_prompt_cache(filepath: str = None):
    """Clears the prompt cache for a specific file or all files."""
    global _prompt_cache
    if filepath:
        _prompt_cache.pop(filepath, None)
        print(f"Cleared cache for {filepath}")
    else:
        _prompt_cache.clear()
        print("Cleared all prompt cache")

def combine_character_prompt(character_name: str, language_level: str = "B1") -> str:
    """
    Combines a character's specific prompt with language learning requirements for the specified level.
    Only applies to game characters and narrator, not to tutor.
    
    Args:
        character_name (str): Name of the character (e.g., 'narrator', 'tim', 'fiona', etc.)
        language_level (str): Language level to use (A2, B1, or B2). Defaults to B1.
    
    Returns:
        str: Combined prompt with character-specific instructions and language requirements
    """
    # List of characters that should include language requirements
    game_characters = ["narrator", "tim", "fiona", "pauline", "ronnie"]
    
    try:
        # Load character-specific prompt
        character_prompt_path = f"prompts/prompt_{character_name}.md"
        character_prompt = load_system_prompt(character_prompt_path)
        
        # Only combine with language requirements for game characters and narrator
        if character_name in game_characters:
            # Load language requirements for the specified level
            language_file = f"prompts/language_learning/{language_level.lower()}.md"
            language_requirements = load_system_prompt(language_file)
            
            # Combine them with clear separation
            combined_prompt = f"{character_prompt}\n\n---\n\n## Language Requirements\n{language_requirements}"
            
            return combined_prompt
        else:
            # For non-game characters (like tutor), return just the character prompt
            return character_prompt
        
    except Exception as e:
        print(f"ERROR: Failed to combine prompt for character {character_name} with level {language_level}: {e}")
        # Fallback to just the character prompt if language requirements can't be loaded
        return load_system_prompt(f"prompts/prompt_{character_name}.md")

def load_system_prompt(filepath: str) -> str:
    """Loads the system prompt text from a file using an absolute path with caching."""
    # Check cache first
    if filepath in _prompt_cache:
        return _prompt_cache[filepath]
    
    absolute_path = os.path.join(_BASE_DIR, filepath)
    try:
        with open(absolute_path, "r", encoding="utf-8-sig") as file:
            content = file.read().strip()
            # Cache the content
            _prompt_cache[filepath] = content
            return content
    except (FileNotFoundError, OSError, IOError) as e:
        print(f"ERROR: Could not load prompt file {absolute_path}: {e}")
        return "You are a helpful assistant."


def save_message_to_cache(message_id: int, text: str, character_key: str = None):
    """Save message to cache with character info if available"""
    from config import message_cache  # Import here to avoid circular dependency
    
    if character_key:
        message_cache[message_id] = {
            "text": text,
            "character": character_key
        }
    else:
        # For non-character messages (clues, narrator, etc.), just save text
        message_cache[message_id] = {"text": text}

def get_message_from_cache(message_id: int) -> dict:
    """Get message info from cache, returns dict with 'text' and optionally 'character'"""
    from config import message_cache  # Import here to avoid circular dependency
    
    cached = message_cache.get(message_id)
    if cached is None:
        return {"text": "I couldn't find the original message."}
    
    # Handle both old format (string) and new format (dict)
    if isinstance(cached, str):
        return {"text": cached}
    elif isinstance(cached, dict):
        return cached
    else:
        return {"text": "I couldn't find the original message."}

def get_character_from_message_id(message_id: int) -> Optional[str]:
    """Get character key from cached message by message ID"""
    message_info = get_message_from_cache(message_id)
    return message_info.get("character")
