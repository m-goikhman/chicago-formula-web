"""Language learner profile questionnaire bundled for Cloud Run (no external JSON file required).

When changing questions, update `Portal/questionnaire/language_learner_profile.csv`, regenerate
`data/language_learner_profile.json`, then re-run the script that produced this module or edit _RAW.
"""
from __future__ import annotations

import copy
import json
from typing import Any, List

_RAW = '[{"question_id": "age", "type": "single_select", "required": false, "text_en": "What is your current age range?", "options_en": ["18 - 25", "26 - 35", "36 - 45", "46 - 55", "Over 55"]}, {"question_id": "gender", "type": "single_select", "required": false, "text_en": "What is your gender identity?", "options_en": ["Female", "Male", "Non-binary", "Prefer not to say"]}, {"question_id": "l1", "type": "open_text", "required": true, "text_en": "What is your native language or languages?", "options_en": []}, {"question_id": "cef_reading", "type": "multi_select", "required": true, "text_en": "Reading", "options_en": ["I can understand texts that consist mainly of high frequency everyday or job-related language. I can understand the description of events, feelings and wishes in personal letters.", "I can read articles and reports concerned with contemporary problems in which the writers adopt particular attitudes or viewpoints. I can understand contemporary literary prose."]}, {"question_id": "cef_speaking", "type": "multi_select", "required": true, "text_en": "Speaking", "options_en": ["I can deal with most situations likely to arise while travelling. I can enter unprepared into conversation on topics that are familiar, like personal interest or everyday life (e.g. family, hobbies, work, travel and current events).", "I can interact with a degree of fluency and spontaneity that makes regular interaction with native speakers quite possible. I can take an active part in discussion in familiar contexts, accounting for and sustaining my views."]}, {"question_id": "cef_writing", "type": "multi_select", "required": true, "text_en": "Writing", "options_en": ["I can write simple connected text on topics which are familiar or of personal interest. I can write personal letters describing experiences and impressions.", "I can write clear, detailed text on a wide range of subjects related to my interests. I can write an essay or report, passing on information or giving reasons in support of or against a particular point of view. I can write letters highlighting the personal significance of events and experiences."]}]'

QUESTIONNAIRE: List[dict[str, Any]] = json.loads(_RAW)


def load_questionnaire() -> List[dict[str, Any]]:
    """Return a deep copy so callers cannot mutate the bundled definition."""
    return copy.deepcopy(QUESTIONNAIRE)
