"""
Privacy configuration for the web detective game.

This file ensures that no personal information (names, usernames, etc.) 
is collected, stored, or logged. Only anonymous participant identifiers are used.
"""

# Privacy settings
PRIVACY_CONFIG = {
    "log_participant_code_only": True,  # Log only participant identifiers, never names/usernames
    "no_personal_data": True,  # Never collect or store personal information
    "anonymous_logging": True,  # All logs use anonymous identifiers
    "data_retention": "game_session_only"  # Data only kept for active game sessions
}

# Allowed data to log (privacy-safe)
ALLOWED_LOG_DATA = {
    "participant_code": True,  # Anonymous participant identifier
    "message_type": True,  # Type of message (text, callback, etc.)
    "game_actions": True,  # Game-related actions (clues examined, etc.)
    "learning_progress": True,  # Language learning progress (anonymous)
    "error_logs": True,  # Error logs (without personal data)
}

# Data that should NEVER be logged
FORBIDDEN_LOG_DATA = {
    "first_name": False,
    "last_name": False,
    "username": False,
    "phone_number": False,
    "email": False,
    "location": False,
    "personal_messages": False,  # Content of personal messages
    "profile_photos": False,
    "contact_info": False
}

def is_privacy_compliant(data_dict: dict) -> bool:
    """
    Check if a data dictionary contains only privacy-compliant information.
    Returns True if safe, False if personal data is detected.
    """
    for forbidden_key in FORBIDDEN_LOG_DATA:
        if forbidden_key in data_dict:
            return False
    return True

def sanitize_log_data(data_dict: dict) -> dict:
    """
    Remove any personal information from data before logging.
    Returns a sanitized version with only safe data.
    """
    sanitized = {}
    for key, value in data_dict.items():
        if key in ALLOWED_LOG_DATA and ALLOWED_LOG_DATA[key]:
            sanitized[key] = value
        elif key in ("participant", "session") and isinstance(value, dict):
            # Keep only anonymous participant identifier from nested payloads.
            if "participant_code" in value:
                sanitized["participant_code"] = value["participant_code"]
    return sanitized
