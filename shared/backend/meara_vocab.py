"""
Yes/No vocabulary test (Meara-style) — word list and GCS persistence.

Source list: Portal/meara.csv (bundled copy under shared/backend/data/meara.csv).
"""

from __future__ import annotations

import csv
import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from google.cloud import storage

from .secrets import GCS_BUCKET_NAME

logger = logging.getLogger(__name__)

_GCS_PREFIX = "study_meara"
_VALID_PHASES = frozenset({"pretest", "posttest"})
_CSV_PATH = Path(__file__).resolve().parent / "data" / "meara.csv"


def _bucket_name() -> str:
    return (GCS_BUCKET_NAME or "").strip()


def _gcs_env_ready() -> bool:
    if not _bucket_name():
        return False
    if os.environ.get("SKIP_GCS", "").lower() in ("1", "true", "yes"):
        return False
    if os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"):
        return True
    if os.environ.get("K_SERVICE") or os.environ.get("GCE_METADATA_HOST"):
        return True
    return False


def _gcs_bucket():
    name = _bucket_name()
    if not name or not _gcs_env_ready():
        return None
    try:
        client = storage.Client()
        return client.bucket(name)
    except Exception as e:
        logger.error("Failed to init GCS for Meara vocab: %s", e)
        return None


def _load_word_specs() -> List[Dict[str, Any]]:
    if not _CSV_PATH.is_file():
        raise FileNotFoundError(f"Meara word list not found: {_CSV_PATH}")
    specs: List[Dict[str, Any]] = []
    with _CSV_PATH.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            word = (row.get("word") or "").strip()
            if not word:
                continue
            raw_real = (row.get("real word") or "").strip().lower()
            is_real = raw_real in ("true", "1", "yes")
            specs.append({"word": word, "is_real": is_real})
    if not specs:
        raise ValueError("Meara word list is empty")
    return specs


def get_word_list() -> List[str]:
    """Return vocabulary items only (no correctness labels)."""
    return [item["word"] for item in _load_word_specs()]


def _word_lookup() -> Dict[str, bool]:
    return {item["word"]: item["is_real"] for item in _load_word_specs()}


def _validate_submission(
    phase: str,
    word_order: List[str],
    responses: List[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], Dict[str, int]]:
    phase_key = (phase or "").strip().lower()
    if phase_key not in _VALID_PHASES:
        raise ValueError("phase must be 'pretest' or 'posttest'")

    official = get_word_list()
    official_set = set(official)
    if not isinstance(word_order, list) or not word_order:
        raise ValueError("word_order is required")
    if set(word_order) != official_set or len(word_order) != len(official):
        raise ValueError("word_order must contain every test word exactly once")

    if not isinstance(responses, list) or len(responses) != len(official):
        raise ValueError("responses must include one answer per word")

    lookup = _word_lookup()
    normalized: List[Dict[str, Any]] = []
    seen_words = set()
    hits = false_alarms = misses = correct_rejections = 0

    for entry in responses:
        if not isinstance(entry, dict):
            raise ValueError("each response must be an object")
        word = str(entry.get("word") or "").strip()
        if word not in official_set:
            raise ValueError(f"unknown word in responses: {word}")
        if word in seen_words:
            raise ValueError(f"duplicate response for word: {word}")
        seen_words.add(word)
        knows = entry.get("knows")
        if not isinstance(knows, bool):
            raise ValueError(f"knows must be a boolean for word: {word}")

        is_real = lookup[word]
        if knows and is_real:
            hits += 1
        elif knows and not is_real:
            false_alarms += 1
        elif not knows and is_real:
            misses += 1
        else:
            correct_rejections += 1

        normalized.append({"word": word, "knows": knows, "is_real": is_real})

    if seen_words != official_set:
        raise ValueError("responses must cover every test word exactly once")

    summary = {
        "hits": hits,
        "false_alarms": false_alarms,
        "misses": misses,
        "correct_rejections": correct_rejections,
        "total_real": sum(1 for w in official if lookup[w]),
        "total_pseudo": sum(1 for w in official if not lookup[w]),
    }
    return normalized, summary


def submit_results(
    participant_code: str,
    phase: str,
    word_order: List[str],
    responses: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Validate and persist one participant's Meara submission to GCS."""
    code = (participant_code or "").strip().upper()
    if not code:
        raise ValueError("participant_code is required")

    phase_key = (phase or "").strip().lower()
    normalized_responses, summary = _validate_submission(phase_key, word_order, responses)
    completed_at = datetime.now(timezone.utc).isoformat()

    payload: Dict[str, Any] = {
        "participant_code": code,
        "phase": phase_key,
        "completed_at": completed_at,
        "word_order": word_order,
        "responses": normalized_responses,
        "summary": summary,
    }

    bucket = _gcs_bucket()
    if not bucket:
        raise RuntimeError("Cloud storage is not configured; Meara results were not saved")

    blob_name = f"{_GCS_PREFIX}/{phase_key}/{code}.json"
    try:
        blob = bucket.blob(blob_name)
        blob.upload_from_string(
            json.dumps(payload, ensure_ascii=False, indent=2),
            content_type="application/json; charset=utf-8",
        )
        logger.info("Stored Meara submission %s", blob_name)
    except Exception as e:
        logger.error("Failed to persist Meara submission for %s: %s", code, e)
        raise RuntimeError("Failed to save Meara results to cloud storage") from e

    return payload


def has_submission(participant_code: str, phase: str) -> bool:
    code = (participant_code or "").strip().upper()
    phase_key = (phase or "").strip().lower()
    if phase_key not in _VALID_PHASES or not code:
        return False
    bucket = _gcs_bucket()
    if not bucket:
        return False
    blob_name = f"{_GCS_PREFIX}/{phase_key}/{code}.json"
    try:
        return bool(bucket.blob(blob_name).exists())
    except Exception as e:
        logger.error("Failed to check Meara submission for %s: %s", code, e)
        return False
