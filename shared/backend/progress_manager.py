import json
import datetime
import logging
from typing import Dict, Any
from google.cloud import storage
from .config import GCS_BUCKET_NAME
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
        source: str = WEB_SOURCE,
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
            if not any(entry.get('query') == user_text for entry in progress_data.get("writing_feedback", [])):
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

# Global instance
progress_manager = ProgressManager()
