"""
Study onboarding: questionnaire validation, CEFR band, stratified arm assignment, token lifecycle.

Experimental arm = Tell; control arm = Teach (see research plan).
"""

from __future__ import annotations

import csv
import io
import json
import logging
import os
import random
import secrets
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from google.api_core import exceptions as gcp_exceptions
from google.cloud import storage

from .cefr_self_rating import CEF_SKILL_KEYS, derive_cefr_band
from .questionnaire_builtin import load_questionnaire

logger = logging.getLogger(__name__)

_GCS_PREFIX = "study_onboarding"
_PARTICIPANTS_CSV_BLOB = f"{_GCS_PREFIX}/participants.csv"
_CSV_MULTI_SEPARATOR = " | "


def _bucket_name() -> str:
    """Use env only here so importing this module does not pull Secret Manager (slow/offline)."""
    return (os.environ.get("GCS_BUCKET_NAME") or "").strip()

# Stratification counters (in-memory; resets on process restart — acceptable for pilot).
_COUNTERS: Dict[str, Dict[str, int]] = {
    "tell": {"B1": 0, "B2": 0},
    "teach": {"B1": 0, "B2": 0},
}

_ONBOARDING: Dict[str, Dict[str, Any]] = {}
_BY_PARTICIPANT: Dict[str, Dict[str, Any]] = {}


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
            if val is None:
                if required:
                    raise ValueError(f"Missing answer for {qid}")
                out[qid] = None
            elif not isinstance(val, int) or val < 0 or val >= len(opts):
                raise ValueError(f"Invalid index for {qid}")
            else:
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


def answers_to_readable(normalized: Dict[str, Any]) -> Dict[str, str]:
    """Map stored answer indices to human-readable option labels."""
    readable: Dict[str, str] = {}
    for q in load_questionnaire():
        qid = q["question_id"]
        val = normalized.get(qid)
        opts: List[str] = q.get("options_en") or []
        typ = q["type"]
        if typ == "single_select":
            if val is None:
                readable[qid] = ""
            else:
                readable[qid] = opts[int(val)]
        elif typ == "multi_select":
            indices = val if isinstance(val, list) else []
            labels = [opts[i] for i in indices if 0 <= i < len(opts)]
            readable[qid] = _CSV_MULTI_SEPARATOR.join(labels)
        elif typ == "open_text":
            readable[qid] = str(val or "")
    return readable


def _participants_csv_fieldnames() -> List[str]:
    meta = [
        "participant_code",
        "arm",
        "cefr_band",
        "questionnaire_completed_at",
        "attached_at",
    ]
    question_ids = [q["question_id"] for q in load_questionnaire()]
    return meta + question_ids


def _participant_csv_row(record: Dict[str, Any], participant_code: str) -> Dict[str, str]:
    readable = answers_to_readable(record.get("answers") or {})
    row: Dict[str, str] = {
        "participant_code": participant_code,
        "arm": str(record.get("arm") or ""),
        "cefr_band": str(record.get("cefr_band") or ""),
        "questionnaire_completed_at": str(record.get("created_at") or ""),
        "attached_at": str(record.get("attached_at") or ""),
    }
    row.update(readable)
    return row


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


def _read_participants_csv_rows(blob) -> Tuple[List[str], List[Dict[str, str]]]:
    fieldnames = _participants_csv_fieldnames()
    if not blob.exists():
        return fieldnames, []
    text = blob.download_as_text(encoding="utf-8")
    if not text.strip():
        return fieldnames, []
    reader = csv.DictReader(io.StringIO(text))
    stored_fields = reader.fieldnames or fieldnames
    rows: List[Dict[str, str]] = []
    for raw in reader:
        row = {name: str(raw.get(name) or "") for name in stored_fields}
        rows.append(row)
    return stored_fields, rows


def _write_participants_csv(blob, fieldnames: List[str], rows: List[Dict[str, str]], *, generation: Optional[int]) -> None:
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=fieldnames, lineterminator="\n", extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow({name: row.get(name, "") for name in fieldnames})
    payload = buffer.getvalue()
    if generation is None:
        blob.upload_from_string(payload, content_type="text/csv; charset=utf-8")
    else:
        blob.upload_from_string(
            payload,
            content_type="text/csv; charset=utf-8",
            if_generation_match=generation,
        )


def _append_participants_csv(record: Dict[str, Any], participant_code: str) -> None:
    """Append one participant row to study_onboarding/participants.csv in GCS."""
    bucket = _gcs_bucket()
    if not bucket:
        logger.warning("Skipping participants CSV append (no bucket)")
        return

    code = participant_code.upper()
    blob = bucket.blob(_PARTICIPANTS_CSV_BLOB)
    new_row = _participant_csv_row(record, code)
    fieldnames = _participants_csv_fieldnames()

    for attempt in range(3):
        try:
            if blob.exists():
                blob.reload()
                generation = blob.generation
                _, rows = _read_participants_csv_rows(blob)
            else:
                generation = None
                rows = []

            if any(str(r.get("participant_code", "")).upper() == code for r in rows):
                logger.info("Participant %s already in %s", code, _PARTICIPANTS_CSV_BLOB)
                return

            merged_fields = list(fieldnames)
            for row in rows:
                for key in row:
                    if key not in merged_fields:
                        merged_fields.append(key)

            normalized_rows: List[Dict[str, str]] = []
            for row in rows:
                normalized_rows.append({name: row.get(name, "") for name in merged_fields})
            normalized_rows.append({name: new_row.get(name, "") for name in merged_fields})

            _write_participants_csv(blob, merged_fields, normalized_rows, generation=generation)
            logger.info("Appended participant %s to %s", code, _PARTICIPANTS_CSV_BLOB)
            return
        except gcp_exceptions.PreconditionFailed:
            logger.warning("Participants CSV conflict (attempt %s), retrying", attempt + 1)
            continue
        except Exception as e:
            logger.error("Failed to append participants CSV for %s: %s", code, e)
            return

    logger.error("Failed to append participants CSV for %s after retries", code)


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


def get_participant_study(participant_code: str) -> Optional[Dict[str, Any]]:
    """Return onboarding record for a participant code after attach, else None."""
    code = (participant_code or "").strip().upper()
    if not code:
        return None
    return _BY_PARTICIPANT.get(code)


def attach_onboarding_token(token: str, participant_code: str) -> bool:
    rec = _ONBOARDING.get(token)
    if not rec:
        return False
    code = participant_code.upper()
    existing = _BY_PARTICIPANT.get(code)
    if existing:
        if existing.get("token") == token:
            _append_participants_csv(rec, code)
            return True
        logger.warning("Participant %s already has onboarding attached", code)
        return False
    rec["participant_code"] = code
    rec["attached_at"] = datetime.now(timezone.utc).isoformat()
    _BY_PARTICIPANT[code] = {
        "token": token,
        "arm": rec.get("arm"),
        "cefr_band": rec.get("cefr_band"),
        "attached_at": rec["attached_at"],
    }
    _persist_attach(
        token,
        code,
        {
            "token": token,
            "participant_code": code,
            "arm": rec.get("arm"),
            "cefr_band": rec.get("cefr_band"),
            "attached_at": rec["attached_at"],
            "answers_readable": answers_to_readable(rec.get("answers") or {}),
        },
    )
    _append_participants_csv(rec, code)
    return True
