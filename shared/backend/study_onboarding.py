"""
Study onboarding: questionnaire validation, CEFR band, stratified arm assignment, token lifecycle.

Experimental arm = Tell; control arm = Teach (see research plan).
"""

from __future__ import annotations

import json
import logging
import os
import random
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from google.cloud import storage

from .cefr_self_rating import CEF_SKILL_KEYS, derive_cefr_band

logger = logging.getLogger(__name__)

_DATA_PATH = Path(__file__).resolve().parent / "data" / "language_learner_profile.json"
_GCS_PREFIX = "study_onboarding"


def _bucket_name() -> str:
    """Use env only here so importing this module does not pull Secret Manager (slow/offline)."""
    return (os.environ.get("GCS_BUCKET_NAME") or "").strip()

# Stratification counters (in-memory; resets on process restart — acceptable for pilot).
_COUNTERS: Dict[str, Dict[str, int]] = {
    "tell": {"B1": 0, "B2": 0},
    "teach": {"B1": 0, "B2": 0},
}

_ONBOARDING: Dict[str, Dict[str, Any]] = {}


def load_questionnaire() -> List[dict]:
    with _DATA_PATH.open(encoding="utf-8") as f:
        return json.load(f)


def _validate_answers(raw: Any) -> Dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError("answers must be an object")
    questions = load_questionnaire()
    spec_by_id = {q["question_id"]: q for q in questions}
    out: Dict[str, Any] = {}
    for q in questions:
        qid = q["question_id"]
        if qid not in raw:
            raise ValueError(f"Missing answer for {qid}")
        val = raw[qid]
        required = bool(q.get("required"))
        typ = q["type"]
        opts: List[str] = q.get("options_en") or []

        if typ == "single_select":
            if not isinstance(val, int) or val < 0 or val >= len(opts):
                raise ValueError(f"Invalid index for {qid}")
            out[qid] = val
        elif typ == "multi_select":
            if not isinstance(val, list) or not val:
                if required:
                    raise ValueError(f"{qid} requires at least one selection")
                out[qid] = []
            else:
                uniq = sorted({int(x) for x in val})
                for x in uniq:
                    if x < 0 or x >= len(opts):
                        raise ValueError(f"Invalid option index in {qid}")
                if required and not uniq:
                    raise ValueError(f"{qid} requires at least one selection")
                out[qid] = uniq
        elif typ == "open_text":
            if not isinstance(val, str) or not val.strip():
                if required:
                    raise ValueError(f"{qid} cannot be empty")
            out[qid] = (val or "").strip()
        else:
            raise ValueError(f"Unsupported question type: {typ}")
    if set(raw.keys()) - set(spec_by_id.keys()):
        raise ValueError("Unknown answer keys present")
    return out


def _assign_arm_stratified(band: str) -> str:
    """Tell = experimental; balance B1/B2 counts between tell and teach."""
    tell_n = _COUNTERS["tell"][band]
    teach_n = _COUNTERS["teach"][band]
    if tell_n < teach_n:
        arm = "tell"
    elif teach_n < tell_n:
        arm = "teach"
    else:
        arm = random.choice(["tell", "teach"])
    _COUNTERS[arm][band] += 1
    return arm


def _gcs_env_ready() -> bool:
    """Avoid constructing storage.Client() locally without ADC (can hang)."""
    if not _bucket_name():
        return False
    if os.environ.get("SKIP_GCS", "").lower() in ("1", "true", "yes"):
        return False
    if os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"):
        return True
    # Cloud Run / GCE metadata
    if os.environ.get("K_SERVICE") or os.environ.get("GCE_METADATA_HOST"):
        return True
    return False


def _gcs_bucket():
    if not _gcs_env_ready():
        return None
    try:
        client = storage.Client()
        return client.bucket(_bucket_name())
    except Exception as e:
        logger.error("Failed to init GCS for onboarding: %s", e)
        return None


def _persist_submission(token: str, payload: Dict[str, Any]) -> None:
    bucket = _gcs_bucket()
    if not bucket:
        logger.warning("Skipping onboarding GCS persist (no bucket)")
        return
    try:
        name = f"{_GCS_PREFIX}/submission_{token}.json"
        blob = bucket.blob(name)
        blob.upload_from_string(
            json.dumps(payload, ensure_ascii=False, indent=2),
            content_type="application/json; charset=utf-8",
        )
        logger.info("Stored onboarding submission %s", name)
    except Exception as e:
        logger.error("Failed to persist onboarding submission: %s", e)


def _persist_attach(token: str, participant_code: str, payload: Dict[str, Any]) -> None:
    bucket = _gcs_bucket()
    if not bucket:
        return
    try:
        name = f"{_GCS_PREFIX}/attach_{token}_{participant_code}.json"
        blob = bucket.blob(name)
        blob.upload_from_string(
            json.dumps(payload, ensure_ascii=False, indent=2),
            content_type="application/json; charset=utf-8",
        )
        logger.info("Stored onboarding attach %s", name)
    except Exception as e:
        logger.error("Failed to persist onboarding attach: %s", e)


def submit_onboarding(answers_raw: dict) -> Tuple[str, str, str, Dict[str, Any]]:
    """
    Validate answers, compute CEFR band, assign arm, register token.

    Returns (onboarding_token, arm, cefr_band, normalized_answers).
    """
    normalized = _validate_answers(answers_raw)
    cef_slice = {k: normalized[k] for k in CEF_SKILL_KEYS}
    band = derive_cefr_band(cef_slice)
    arm = _assign_arm_stratified(band)
    token = secrets.token_urlsafe(24)
    record = {
        "token": token,
        "arm": arm,
        "cefr_band": band,
        "answers": normalized,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "participant_code": None,
    }
    _ONBOARDING[token] = record
    _persist_submission(
        token,
        {
            "arm": arm,
            "cefr_band": band,
            "answers": normalized,
            "created_at": record["created_at"],
        },
    )
    return token, arm, band, normalized


def attach_onboarding_token(token: str, participant_code: str) -> bool:
    rec = _ONBOARDING.get(token)
    if not rec:
        return False
    rec["participant_code"] = participant_code.upper()
    rec["attached_at"] = datetime.now(timezone.utc).isoformat()
    _persist_attach(
        token,
        participant_code.upper(),
        {
            "token": token,
            "participant_code": participant_code.upper(),
            "arm": rec.get("arm"),
            "cefr_band": rec.get("cefr_band"),
            "attached_at": rec["attached_at"],
        },
    )
    return True
