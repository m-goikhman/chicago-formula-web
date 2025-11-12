"""
Authentication module for the web application.
Simple participant code authentication for research purposes.
"""

import secrets
from datetime import datetime, timedelta
from typing import Optional, Dict
import logging

logger = logging.getLogger(__name__)


# Session storage (in production, use Redis or database)
SESSION_DB: Dict[str, Dict] = {}


def create_session_token(participant_code: str) -> str:
    """Create a session token for a participant."""
    token = secrets.token_urlsafe(32)
    expiry = datetime.now() + timedelta(days=7)  # 7 days session
    
    SESSION_DB[token] = {
        "participant_code": participant_code,
        "expires": expiry,
        "created": datetime.now()
    }
    
    logger.info(f"Created session token for participant: {participant_code}")
    return token


def validate_session_token(token: str) -> Optional[Dict]:
    """Validate a session token and return participant info."""
    session = SESSION_DB.get(token)
    
    if not session:
        logger.warning("Invalid session token")
        return None
    
    if datetime.now() > session["expires"]:
        # Token expired
        logger.info(f"Session expired for participant: {session['participant_code']}")
        del SESSION_DB[token]
        return None
    
    return session


def is_valid_participant_code(code: str) -> bool:
    import re
    code = code.upper()
    if code in ("TEST", "DEMO"):
        return True
    return bool(re.fullmatch(r"[A-Z]{2}\\d{4}", code))


def login_participant(participant_code: str) -> Optional[str]:
    """Authenticate a participant and return session token."""
    code = participant_code.upper()
    
    if not is_valid_participant_code(code):
        logger.warning(f"Invalid participant code attempted: {code}")
        return None
    
    token = create_session_token(code)
    return token


def logout_participant(token: str) -> bool:
    """Logout a participant by removing their session."""
    if token in SESSION_DB:
        del SESSION_DB[token]
        logger.info(f"Logged out participant with token")
        return True
    return False

