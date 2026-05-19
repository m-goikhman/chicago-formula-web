"""
Allocate persistent DEMO1, DEMO2, … slots for colleague try-outs (Teach demo login).
"""

import json
import logging
import re
from typing import Optional

from .game_config import GCS_BUCKET_NAME

logger = logging.getLogger(__name__)

DEMO_LOGIN_CODE = "DEMO"
DEMO_SLOT_PATTERN = re.compile(r"^DEMO(\d+)$")
DEMO_REGISTRY_BLOB = "demo_slots/registry.json"


def is_demo_slot_code(code: str) -> bool:
    normalized = str(code or "").strip().upper()
    return bool(DEMO_SLOT_PATTERN.match(normalized))


def is_demo_login_code(code: str) -> bool:
    return str(code or "").strip().upper() == DEMO_LOGIN_CODE


def is_demo_mode_participant(code: str) -> bool:
    normalized = str(code or "").strip().upper()
    return normalized == DEMO_LOGIN_CODE or is_demo_slot_code(normalized)


def _get_bucket():
    if not GCS_BUCKET_NAME:
        return None
    try:
        from google.cloud import storage

        client = storage.Client()
        return client.bucket(GCS_BUCKET_NAME)
    except Exception as error:
        logger.error("Failed to open GCS bucket for demo slots: %s", error)
        return None


def _read_registry(bucket) -> dict:
    blob = bucket.blob(DEMO_REGISTRY_BLOB)
    if not blob.exists():
        return {"next": 1}
    try:
        payload = json.loads(blob.download_as_text(encoding="utf-8"))
        next_value = int(payload.get("next", 1))
        return {"next": max(1, next_value)}
    except Exception as error:
        logger.warning("Failed to read demo slot registry, resetting counter: %s", error)
        return {"next": 1}


def _write_registry(bucket, registry: dict) -> None:
    blob = bucket.blob(DEMO_REGISTRY_BLOB)
    blob.upload_from_string(
        json.dumps(registry, indent=2, ensure_ascii=False),
        content_type="application/json; charset=utf-8",
    )


def _slot_number(code: str) -> Optional[int]:
    match = DEMO_SLOT_PATTERN.match(str(code or "").strip().upper())
    if not match:
        return None
    return int(match.group(1))


def resolve_demo_participant_code(resume_slot: Optional[str] = None) -> str:
    """
    Resolve the participant code for a DEMO login.

    Reuses resume_slot when it was previously issued. Otherwise allocates DEMO{n}.
    """
    normalized_resume = str(resume_slot or "").strip().upper()
    bucket = _get_bucket()

    if not bucket:
        if is_demo_slot_code(normalized_resume):
            logger.info("Reusing demo slot without GCS: %s", normalized_resume)
            return normalized_resume
        fallback = "DEMO1"
        logger.warning("GCS unavailable; using fallback demo slot %s", fallback)
        return fallback

    registry = _read_registry(bucket)
    next_num = int(registry["next"])

    if is_demo_slot_code(normalized_resume):
        slot_num = _slot_number(normalized_resume)
        if slot_num is not None and 1 <= slot_num < next_num:
            logger.info("Resumed demo slot: %s", normalized_resume)
            return f"DEMO{slot_num}"

    allocated = f"DEMO{next_num}"
    registry["next"] = next_num + 1
    _write_registry(bucket, registry)
    logger.info("Allocated new demo slot: %s", allocated)
    return allocated
