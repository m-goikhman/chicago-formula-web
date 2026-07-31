"""
Study onboarding: questionnaire validation, CEFR band, stratified arm assignment.

Experimental arm = Tell; control arm = Teach (see research plan).

Flow: participant code (login) → questionnaire → vocabulary pretest → arm assignment.
Post-study: game ep4 complete → portal MeARA posttest → final Google Forms.
"""

from __future__ import annotations

import csv
import io
import json
import logging
import os
import random
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from google.api_core import exceptions as gcp_exceptions
from google.cloud import storage

from .cefr_self_rating import CEF_SKILL_KEYS, derive_cefr_band
from .questionnaire_builtin import load_questionnaire
from .secrets import GCS_BUCKET_NAME

logger = logging.getLogger(__name__)

_GCS_PREFIX = "study_onboarding"
_PARTICIPANTS_CSV_BLOB = f"{_GCS_PREFIX}/participants.csv"
_PARTICIPANT_RECORD_PREFIX = f"{_GCS_PREFIX}/participants"
_CSV_MULTI_SEPARATOR = " | "
_VALID_LOGIN_SOURCES = frozenset({"sona", "manual", "direct_app"})

# Stratification counters (in-memory; resets on process restart — acceptable for pilot).
_COUNTERS: Dict[str, Dict[str, int]] = {
    "tell": {"B1": 0, "B2": 0},
    "teach": {"B1": 0, "B2": 0},
}

_BY_PARTICIPANT: Dict[str, Dict[str, Any]] = {}


def _bucket_name() -> str:
    return (GCS_BUCKET_NAME or "").strip()


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


def _normalize_login_source(raw: Any) -> Optional[str]:
    normalized = str(raw or "").strip().lower()
    if normalized in _VALID_LOGIN_SOURCES:
        return normalized
    return None


def _participants_csv_fieldnames() -> List[str]:
    meta = [
        "participant_code",
        "arm",
        "cefr_band",
        "questionnaire_completed_at",
        "assigned_at",
        "login_source",
        "login_recorded_at",
    ]
    question_ids = [q["question_id"] for q in load_questionnaire()]
    return meta + question_ids


def _participant_csv_row(record: Dict[str, Any], participant_code: str) -> Dict[str, str]:
    readable = answers_to_readable(record.get("answers") or {})
    row: Dict[str, str] = {
        "participant_code": participant_code,
        "arm": str(record.get("arm") or ""),
        "cefr_band": str(record.get("cefr_band") or ""),
        "questionnaire_completed_at": str(record.get("questionnaire_completed_at") or ""),
        "assigned_at": str(record.get("assigned_at") or ""),
        "login_source": str(record.get("login_source") or ""),
        "login_recorded_at": str(record.get("login_recorded_at") or ""),
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
        logger.error("Failed to init GCS for onboarding: %s", e)
        return None


def _participant_record_blob(code: str):
    bucket = _gcs_bucket()
    if not bucket:
        return None, None
    blob_name = f"{_PARTICIPANT_RECORD_PREFIX}/{code.upper()}.json"
    return bucket, bucket.blob(blob_name)


def _persist_participant_record(code: str, record: Dict[str, Any]) -> None:
    bucket, blob = _participant_record_blob(code)
    if not bucket or not blob:
        logger.warning("Skipping participant record GCS persist for %s (no bucket)", code)
        return
    try:
        blob.upload_from_string(
            json.dumps(record, ensure_ascii=False, indent=2),
            content_type="application/json; charset=utf-8",
        )
        logger.info("Stored participant onboarding record %s", blob.name)
    except Exception as e:
        logger.error("Failed to persist participant record for %s: %s", code, e)


def _load_participant_record_from_gcs(code: str) -> Optional[Dict[str, Any]]:
    _, blob = _participant_record_blob(code)
    if not blob or not blob.exists():
        return None
    try:
        payload = json.loads(blob.download_as_text(encoding="utf-8"))
        return payload if isinstance(payload, dict) else None
    except Exception as e:
        logger.error("Failed to load participant record for %s: %s", code, e)
        return None


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


def _normalize_code(participant_code: str) -> str:
    code = (participant_code or "").strip().upper()
    if not code:
        raise ValueError("participant_code is required")
    return code


def get_participant_study(participant_code: str) -> Optional[Dict[str, Any]]:
    """Return onboarding record for a participant code, from memory or GCS."""
    code = (participant_code or "").strip().upper()
    if not code:
        return None
    cached = _BY_PARTICIPANT.get(code)
    if cached:
        return cached
    loaded = _load_participant_record_from_gcs(code)
    if loaded:
        _BY_PARTICIPANT[code] = loaded
    return loaded


def record_login_source(participant_code: str, login_source: Optional[str]) -> None:
    """Persist how the participant first authenticated (set once, never overwritten)."""
    source = _normalize_login_source(login_source)
    if not source:
        return

    code = _normalize_code(participant_code)
    existing = get_participant_study(code) or {}
    if existing.get("login_source"):
        return

    now = datetime.now(timezone.utc).isoformat()
    record = dict(existing)
    record["participant_code"] = code
    record["login_source"] = source
    record["login_recorded_at"] = now
    _BY_PARTICIPANT[code] = record
    _persist_participant_record(code, record)


def submit_questionnaire(participant_code: str, answers_raw: dict) -> Tuple[str, Dict[str, Any]]:
    """
    Validate answers, compute CEFR band, persist with participant code (no arm yet).

    Returns (cefr_band, normalized_answers).
    """
    code = _normalize_code(participant_code)
    normalized = _validate_answers(answers_raw)
    cef_slice = {k: normalized[k] for k in CEF_SKILL_KEYS}
    band = derive_cefr_band(cef_slice)

    existing = get_participant_study(code) or {}
    if existing.get("answers") and existing.get("cefr_band"):
        return str(existing["cefr_band"]), existing.get("answers") or normalized

    now = datetime.now(timezone.utc).isoformat()
    record: Dict[str, Any] = {
        "participant_code": code,
        "cefr_band": band,
        "answers": normalized,
        "arm": existing.get("arm"),
        "questionnaire_completed_at": now,
        "assigned_at": existing.get("assigned_at"),
        "login_source": existing.get("login_source"),
        "login_recorded_at": existing.get("login_recorded_at"),
    }
    _BY_PARTICIPANT[code] = record
    _persist_participant_record(code, record)
    return band, normalized


def assign_arm(participant_code: str) -> str:
    """Stratified Tell vs Teach assignment after portal tests are complete."""
    code = _normalize_code(participant_code)
    record = get_participant_study(code)
    if not record or not record.get("answers"):
        raise ValueError("Questionnaire must be completed before assignment")

    existing_arm = record.get("arm")
    if existing_arm:
        return str(existing_arm)

    band = str(record.get("cefr_band") or "")
    if band not in ("B1", "B2"):
        raise ValueError("CEFR band is missing or invalid")

    arm = _assign_arm_stratified(band)
    now = datetime.now(timezone.utc).isoformat()
    record["arm"] = arm
    record["assigned_at"] = now
    _BY_PARTICIPANT[code] = record
    _persist_participant_record(code, record)
    _append_participants_csv(record, code)
    return arm


def get_portal_progress(
    participant_code: str,
    *,
    meara_done: bool = False,
    meara_pretest_done: Optional[bool] = None,
    meara_posttest_done: bool = False,
    weekly_questionnaire_link: Optional[str] = None,
    final_questionnaire_link: Optional[str] = None,
) -> Dict[str, Any]:
    record = get_participant_study(participant_code)
    questionnaire_done = bool(record and record.get("answers"))
    study_arm = record.get("arm") if record else None
    pretest_done = meara_done if meara_pretest_done is None else bool(meara_pretest_done)
    progress: Dict[str, Any] = {
        "questionnaire_done": questionnaire_done,
        # Backward-compatible alias for pretest completion.
        "meara_done": pretest_done,
        "meara_pretest_done": pretest_done,
        "meara_posttest_done": bool(meara_posttest_done),
        "study_arm": study_arm,
    }
    if weekly_questionnaire_link:
        progress["weekly_questionnaire_link"] = weekly_questionnaire_link
    if final_questionnaire_link:
        progress["final_questionnaire_link"] = final_questionnaire_link
    return progress
