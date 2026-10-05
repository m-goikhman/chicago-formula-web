"""
One-way episode-completion notices (Telegram sendMessage).

This is not a chat bot: the backend only POSTs to Telegram when an outro
questionnaire is first shown. If the bot token / chat id are unset, notices
are skipped and the game is unaffected.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import urllib.error
import urllib.request
from typing import Optional

import pytz
from datetime import datetime

from .auth import is_test_mode_participant
from .demo_slots import is_demo_mode_participant
from .progress_manager import progress_manager, TEACH_SOURCE
from .secrets import get_secret

logger = logging.getLogger(__name__)

_TELEGRAM_TIMEOUT_SECONDS = 4
_TEACH_NOTIFIED_KEY = "outro_questionnaire_notified_episodes"
_notified_in_process: set[str] = set()
_telegram_config_loaded = False
_telegram_bot_token: Optional[str] = None
_telegram_chat_id: Optional[str] = None


def _load_telegram_config() -> tuple[Optional[str], Optional[str]]:
    global _telegram_config_loaded, _telegram_bot_token, _telegram_chat_id
    if not _telegram_config_loaded:
        _telegram_config_loaded = True
        token = (os.getenv("TELEGRAM_BOT_TOKEN") or "").strip() or get_secret("telegram-bot-token")
        chat_id = (
            (os.getenv("TELEGRAM_NOTIFY_CHAT_ID") or "").strip()
            or get_secret("telegram-notify-chat-id")
        )
        _telegram_bot_token = (token or "").strip() or None
        _telegram_chat_id = (chat_id or "").strip() or None
        if not _telegram_bot_token or not _telegram_chat_id:
            logger.info(
                "Episode Telegram notices are disabled "
                "(set telegram-bot-token and telegram-notify-chat-id)."
            )
    return _telegram_bot_token, _telegram_chat_id


def _event_key(arm: str, participant_code: str, episode: int) -> str:
    return f"{arm}:{participant_code}:{episode}"


def _format_notice(*, participant_code: str, episode: int, arm: str) -> str:
    cet_tz = pytz.timezone("Europe/Berlin")
    timestamp = datetime.now(cet_tz).strftime("%Y-%m-%d %H:%M %Z")
    lines = [
        f"Episode {episode} completed",
        f"Participant: {participant_code}",
        f"Version: {arm}",
        f"Time: {timestamp}",
    ]
    if is_test_mode_participant(participant_code):
        lines.insert(0, "[test]")
    return "\n".join(lines)


def _send_telegram(text: str) -> None:
    token, chat_id = _load_telegram_config()
    if not token or not chat_id:
        return
    payload = json.dumps({"chat_id": chat_id, "text": text}).encode("utf-8")
    request = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendMessage",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=_TELEGRAM_TIMEOUT_SECONDS) as response:
            response.read()
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        logger.warning("Failed to send episode Telegram notice: %s", exc)


def _mark_teach_notified(participant_code: str, episode: int) -> bool:
    """Return True if this Teach outro has not been recorded yet."""
    try:
        progress_data = progress_manager.get_participant_progress(
            participant_code, source=TEACH_SOURCE
        )
        notified = progress_data.get(_TEACH_NOTIFIED_KEY)
        if not isinstance(notified, list):
            notified = []
        if episode in notified:
            return False
        notified.append(episode)
        progress_data[_TEACH_NOTIFIED_KEY] = notified
        progress_manager._save_progress_data(
            progress_data, participant_code, source=TEACH_SOURCE
        )
        return True
    except Exception as exc:
        logger.warning(
            "Could not persist Teach outro-notice flag for %s episode %s: %s",
            participant_code,
            episode,
            exc,
        )
        return True


async def notify_episode_completed(
    *,
    participant_code: str,
    episode: int,
    arm: str,
    persist_teach: bool = False,
) -> None:
    """Send a completion notice. Never raises; never blocks the player for long."""
    code = str(participant_code or "").strip()
    if not code or is_demo_mode_participant(code):
        return

    key = _event_key(arm, code, episode)
    if key in _notified_in_process:
        return
    _notified_in_process.add(key)
    if persist_teach and not _mark_teach_notified(code, episode):
        return

    logger.info(
        "episode_completed participant=%s arm=%s episode=%s",
        code,
        arm,
        episode,
    )
    text = _format_notice(participant_code=code, episode=episode, arm=arm)
    try:
        await asyncio.wait_for(
            asyncio.to_thread(_send_telegram, text),
            timeout=_TELEGRAM_TIMEOUT_SECONDS + 1,
        )
    except Exception as exc:
        logger.warning("Episode notice failed for %s episode %s: %s", code, episode, exc)


async def notify_interview_contact(*, participant_code: str, email: str) -> None:
    """Tell the researcher that someone left an interview email. Never raises."""
    code = str(participant_code or "").strip()
    address = str(email or "").strip()
    if not code or not address or is_demo_mode_participant(code):
        return
    cet_tz = pytz.timezone("Europe/Berlin")
    timestamp = datetime.now(cet_tz).strftime("%Y-%m-%d %H:%M %Z")
    lines = [
        "Interview contact",
        f"Participant: {code}",
        f"Email: {address}",
        f"Time: {timestamp}",
    ]
    if is_test_mode_participant(code):
        lines.insert(0, "[test]")
    try:
        await asyncio.wait_for(
            asyncio.to_thread(_send_telegram, "\n".join(lines)),
            timeout=_TELEGRAM_TIMEOUT_SECONDS + 1,
        )
    except Exception as exc:
        logger.warning("Interview-contact notice failed for %s: %s", code, exc)
