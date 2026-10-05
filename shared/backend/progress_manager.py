import json
import datetime
import logging
import re
from typing import Dict, Any, Optional
from google.cloud import storage
from .secrets import GCS_BUCKET_NAME
import pytz

logger = logging.getLogger(__name__)

WEB_SOURCE = "web"
TEACH_SOURCE = "teach"
TELL_SOURCE = "tell"


class ProgressManager:
    """Manages user learning progress using Google Cloud Storage."""
    
    def __init__(self):
        self.storage_client = None
        self.bucket = None
        
        if not GCS_BUCKET_NAME:
            logger.warning("GCS_BUCKET_NAME is not set. Progress tracking is disabled.")
    
    def _get_bucket(self):
        """Lazy initialization of storage client and bucket."""
        if self.storage_client is None and GCS_BUCKET_NAME:
            try:
                self.storage_client = storage.Client()
                self.bucket = self.storage_client.bucket(GCS_BUCKET_NAME)
            except Exception as e:
                logger.error(f"Failed to initialize GCS bucket '{GCS_BUCKET_NAME}': {e}")
                self.bucket = None
        return self.bucket
    
    def _get_progress_blob_name(self, participant_code: str, source: str = WEB_SOURCE) -> str:
        """Resolve storage path for participant-scoped progress."""
        if source in {TEACH_SOURCE, TELL_SOURCE}:
            return (
                f"participant_logs/{source}/language_progress/"
                f"{participant_code}_language_progress.json"
            )
        if source == WEB_SOURCE:
            return f"participant_logs/language_progress/web_{participant_code}_language_progress.json"
        return f"participant_logs/language_progress/{participant_code}_language_progress.json"

    def _get_progress_data(
        self,
        participant_code: str,
        source: str = WEB_SOURCE,
    ) -> Dict[str, Any]:
        """Internal loader for participant progress."""
        bucket = self._get_bucket()
        if not bucket:
            logger.warning(f"Cannot load progress for participant {participant_code}: No storage bucket configured")
            return {"words_learned": [], "writing_feedback": []}
        
        try:
            blob_name = self._get_progress_blob_name(participant_code=participant_code, source=source)
            blob = bucket.blob(blob_name)
            
            if not blob.exists():
                logger.info(f"No progress data found for participant {participant_code}, creating new")
                return {"words_learned": [], "writing_feedback": []}
            
            content = blob.download_as_text(encoding="utf-8")
            progress_data = json.loads(content)
            
            if "words_learned" not in progress_data:
                progress_data["words_learned"] = []
            if "writing_feedback" not in progress_data:
                progress_data["writing_feedback"] = []
            
            logger.info(f"Successfully loaded progress for participant {participant_code}")
            return progress_data
            
        except Exception as e:
            logger.error(f"Failed to load progress for participant {participant_code}: {e}")
            return {"words_learned": [], "writing_feedback": []}

    def _save_progress_data(
        self,
        progress_data: Dict[str, Any],
        participant_code: str,
        source: str = WEB_SOURCE,
    ) -> bool:
        """Internal saver for participant progress."""
        bucket = self._get_bucket()
        if not bucket:
            logger.warning(f"Cannot save progress for participant {participant_code}: No storage bucket configured")
            return False
        
        try:
            blob_name = self._get_progress_blob_name(participant_code=participant_code, source=source)
            blob = bucket.blob(blob_name)
            
            blob.upload_from_string(
                json.dumps(progress_data, indent=2, ensure_ascii=False),
                content_type="application/json; charset=utf-8"
            )
            
            logger.info(f"Successfully saved progress for participant {participant_code}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to save progress for participant {participant_code}: {e}")
            return False

    def get_participant_progress(
        self,
        participant_code: str,
        source: str = WEB_SOURCE,
    ) -> Dict[str, Any]:
        """Get learning progress for a participant code."""
        return self._get_progress_data(participant_code=participant_code, source=source)

    def add_participant_word_learned(
        self,
        participant_code: str,
        word: str,
        definition: str,
        source: str = WEB_SOURCE,
    ) -> bool:
        """Add a learned word for a participant code."""
        try:
            progress_data = self.get_participant_progress(participant_code, source=source)
            cet_tz = pytz.timezone('Europe/Berlin')
            new_entry = {
                "timestamp": datetime.datetime.now(cet_tz).isoformat(),
                "query": word,
                "feedback": definition
            }
            if not any(entry.get('query') == word for entry in progress_data.get("words_learned", [])):
                progress_data.setdefault("words_learned", []).append(new_entry)
                return self._save_progress_data(progress_data, participant_code, source=source)
            return True
        except Exception as e:
            logger.error(f"Failed to add word progress for participant {participant_code}: {e}")
            return False

    def add_participant_writing_feedback(
        self,
        participant_code: str,
        user_text: str,
        feedback: str,
        briefly: str = "",
        improvement_needed: Optional[bool] = None,
        source: str = WEB_SOURCE,
        deduplicate_by_query: bool = True,
        section_id: Optional[str] = None,
        week_id: Optional[str] = None,
    ) -> bool:
        """Add writing feedback for a participant code."""
        try:
            progress_data = self.get_participant_progress(participant_code, source=source)
            cet_tz = pytz.timezone('Europe/Berlin')
            new_entry = {
                "timestamp": datetime.datetime.now(cet_tz).isoformat(),
                "query": user_text,
                "feedback": feedback,
                "briefly": briefly,
            }
            if improvement_needed is not None:
                new_entry["improvement_needed"] = bool(improvement_needed)
            if section_id:
                new_entry["section_id"] = str(section_id).strip()
            if week_id:
                new_entry["week_id"] = str(week_id).strip()
            if (
                not deduplicate_by_query
                or not any(entry.get('query') == user_text for entry in progress_data.get("writing_feedback", []))
            ):
                progress_data.setdefault("writing_feedback", []).append(new_entry)
                return self._save_progress_data(progress_data, participant_code, source=source)
            return True
        except Exception as e:
            logger.error(f"Failed to add writing feedback for participant {participant_code}: {e}")
            return False

    def clear_participant_progress(
        self,
        participant_code: str,
        source: str = WEB_SOURCE,
    ) -> bool:
        """Clear all progress data for a participant code."""
        bucket = self._get_bucket()
        if not bucket:
            logger.warning(f"Cannot clear progress for participant {participant_code}: No storage bucket configured")
            return False
        
        try:
            blob_name = self._get_progress_blob_name(participant_code, source=source)
            blob = bucket.blob(blob_name)
            
            if blob.exists():
                blob.delete()
                logger.info(f"Successfully cleared progress for participant {participant_code}")
            else:
                logger.info(f"No progress to clear for participant {participant_code}")
            
            return True
        except Exception as e:
            logger.error(f"Failed to clear progress for participant {participant_code}: {e}")
            return False

    def get_participant_client_state(
        self,
        participant_code: str,
        source: str = WEB_SOURCE,
    ) -> Dict[str, Any]:
        """Get frontend client state blob for a participant."""
        try:
            progress_data = self.get_participant_progress(participant_code, source=source)
            state = progress_data.get("client_state")
            if isinstance(state, dict):
                return state
            return {}
        except Exception as e:
            logger.error(f"Failed to get client state for participant {participant_code}: {e}")
            return {}

    def save_participant_client_state(
        self,
        participant_code: str,
        client_state: Dict[str, Any],
        source: str = WEB_SOURCE,
        force: bool = False,
    ) -> bool:
        """Save frontend client state blob for a participant."""
        if not isinstance(client_state, dict):
            return False
        try:
            progress_data = self.get_participant_progress(participant_code, source=source)
            existing = progress_data.get("client_state")
            if force:
                progress_data["client_state"] = client_state
            elif client_state.get("cleared") is True:
                # Reset must use force=True. Ignore unforced cleared payloads so they
                # cannot wipe a full snapshot.
                return True
            else:
                progress_data["client_state"] = _merge_client_state(
                    existing if isinstance(existing, dict) else {},
                    client_state,
                )
            return self._save_progress_data(progress_data, participant_code, source=source)
        except Exception as e:
            logger.error(f"Failed to save client state for participant {participant_code}: {e}")
            return False


def _positive_int(value: Any) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return 0
    return number if number > 0 else 0


def _status_is_passed(entry: Any) -> bool:
    if not isinstance(entry, dict):
        return False
    if entry.get("passed") is True:
        return True
    return str(entry.get("status") or "").strip().lower() == "passed"


def _merge_status_entry(existing: Any, incoming: Any) -> Any:
    """Never downgrade a passed exercise to pending/failed/empty."""
    if not isinstance(incoming, dict):
        return existing
    if not isinstance(existing, dict):
        return dict(incoming)
    if _status_is_passed(existing) and not _status_is_passed(incoming):
        return existing
    merged = dict(existing)
    merged.update(incoming)
    return merged


def _merge_dict_of_dicts(
    base: Any,
    incoming: Any,
    *,
    value_merge=None,
) -> Dict[str, Any]:
    merged: Dict[str, Any] = {}
    if isinstance(base, dict):
        for key, value in base.items():
            merged[str(key)] = dict(value) if isinstance(value, dict) else value
    if isinstance(incoming, dict):
        for key, value in incoming.items():
            week_key = str(key)
            if isinstance(value, dict):
                current = merged.get(week_key)
                if not isinstance(current, dict):
                    current = {}
                    merged[week_key] = current
                if value_merge:
                    for inner_key, inner_value in value.items():
                        current[str(inner_key)] = value_merge(
                            current.get(str(inner_key)),
                            inner_value,
                        )
                else:
                    for inner_key, inner_value in value.items():
                        incoming_text = str(inner_value or "").strip()
                        if incoming_text:
                            current[str(inner_key)] = inner_value
                        elif str(inner_key) not in current:
                            current[str(inner_key)] = inner_value
            elif value not in (None, ""):
                merged[week_key] = value
    return merged


def _merge_notes(existing: Any, incoming: Any) -> Dict[str, Any]:
    notes: Dict[str, Any] = {}
    if isinstance(existing, dict):
        notes.update({str(k): v for k, v in existing.items()})
    if isinstance(incoming, dict):
        for week_id, text in incoming.items():
            key = str(week_id)
            if str(text or "").strip() and not str(notes.get(key) or "").strip():
                notes[key] = text
            elif key not in notes:
                notes[key] = text
    return notes


def _week_rank(week_id: Any) -> int:
    match = re.search(r"(\d+)", str(week_id or ""))
    if not match:
        return 0
    try:
        return int(match.group(1))
    except (TypeError, ValueError):
        return 0


def _pick_current_week_id(existing: Dict[str, Any], incoming: Dict[str, Any]) -> Optional[str]:
    candidates = [
        str((existing or {}).get("currentWeekId") or "").strip(),
        str((incoming or {}).get("currentWeekId") or "").strip(),
    ]
    ranked = [( _week_rank(week_id), week_id) for week_id in candidates if week_id]
    if not ranked:
        return None
    ranked.sort()
    return ranked[-1][1]


def _merge_week_completed_at(existing: Any, incoming: Any) -> Dict[str, Any]:
    """Keep the earliest completion time per week so a replay cannot relock later episodes."""
    merged: Dict[str, Any] = {}
    for source in (existing, incoming):
        if not isinstance(source, dict):
            continue
        for week_id, value in source.items():
            stamp = _positive_int(value)
            if stamp <= 0:
                continue
            key = str(week_id)
            current = _positive_int(merged.get(key))
            if current <= 0 or stamp < current:
                merged[key] = stamp
    return merged


def _merge_client_state(existing: Dict[str, Any], incoming: Dict[str, Any]) -> Dict[str, Any]:
    """Union Teach UI snapshots. Empty weeks never delete completed work."""
    existing = existing if isinstance(existing, dict) else {}
    incoming = incoming if isinstance(incoming, dict) else {}
    merged = dict(existing)
    merged.update({k: v for k, v in incoming.items() if k not in merged})

    merged["exerciseStatusByWeek"] = _merge_dict_of_dicts(
        existing.get("exerciseStatusByWeek"),
        incoming.get("exerciseStatusByWeek"),
        value_merge=_merge_status_entry,
    )
    merged["exerciseDraftsByWeek"] = _merge_dict_of_dicts(
        existing.get("exerciseDraftsByWeek"),
        incoming.get("exerciseDraftsByWeek"),
    )
    merged_steps: Dict[str, int] = {}
    for source in (existing, incoming):
        steps = source.get("stepProgressByWeek") if isinstance(source, dict) else {}
        if not isinstance(steps, dict):
            continue
        for week_id, value in steps.items():
            try:
                number = int(value)
            except (TypeError, ValueError):
                continue
            current = merged_steps.get(str(week_id), 1)
            if number > current:
                merged_steps[str(week_id)] = number
    if merged_steps:
        merged["stepProgressByWeek"] = merged_steps

    merged["updatedAt"] = max(
        _positive_int(existing.get("updatedAt")),
        _positive_int(incoming.get("updatedAt")),
    )
    current_week = _pick_current_week_id(existing, incoming)
    if current_week:
        merged["currentWeekId"] = current_week

    first_logins = [
        _positive_int(existing.get("firstLoginAt")),
        _positive_int(incoming.get("firstLoginAt")),
    ]
    first_logins = [value for value in first_logins if value > 0]
    if first_logins:
        merged["firstLoginAt"] = min(first_logins)

    completed = _merge_week_completed_at(
        existing.get("weekCompletedAt"),
        incoming.get("weekCompletedAt"),
    )
    if completed:
        merged["weekCompletedAt"] = completed

    notes = _merge_notes(existing.get("notes"), incoming.get("notes"))
    if notes:
        merged["notes"] = notes
    return merged


# Global instance
progress_manager = ProgressManager()
