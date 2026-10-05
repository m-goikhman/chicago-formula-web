#!/usr/bin/env python3
"""Drop one participant straight into Episode 4, with a custom Nina briefing.

Context (participant 7030): in EP3 she talked Nina into "arresting" Ronnie in
free chat, never spoke to Alex, and never saw the EP3 finale. The EP3
questionnaire was completed out of band. This script:

  1. closes EP3 in the saved state (completed, questionnaire marked shown);
  2. unlocks and enters EP4 immediately;
  3. installs a per-participant EP4 intro text: a short Nina briefing that
     releases Ronnie and delivers the EP3 finale beats she missed, then the
     canonical intro.txt beat (Fiona walks in) glued on as an interruption.

The intro text is stored in her own state under "intro_overrides" and is picked
up by handle_case_intro, which then plays it exactly like a stock intro:
animated, logged to chat history, saved to episode history, with the input box
and EP4 director flags set automatically. Nobody else has "intro_overrides" in
their state, so every other participant keeps the stock EP4 opening.

Requires the matching two-line change in game_handlers.handle_case_intro.

Dry run by default:
    python patch_participant_into_ep4.py 7030
    python patch_participant_into_ep4.py 7030 --apply
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timedelta
from typing import Any, Dict

import pytz
from google.cloud import storage

BUCKET_NAME = "chicago-formula-web-bucket"
PROJECT = "academic-torch-476710-u0"
CET = pytz.timezone("Europe/Berlin")

EP4 = 4
EP4_LOCATION = "precinct_ep4"
INTRO_KEY = "4:0"  # episode 4, intro step 0 (EP4 has a single intro step)

# When EP3 actually ended for her (last EP3 action in the chat log).
EP3_COMPLETED_AT = "2026-08-01T17:33:12+02:00"

# --- The EP4 opening she will see -------------------------------------------
# Same format as game_texts/ep4/intro.txt: blocks split by a line of three
# dashes, sender tagged with [from: ...]. Written at A2 — short sentences.
# The last three blocks are intro.txt verbatim, except the first narrator line,
# rewritten so that Fiona cuts Nina off mid-sentence.

INTRO_TEXT = """\
[from: nina]
Morning, Detective. Before anything else — Ronnie Snapper.
---
[from: nina]
We had to let him go. His family sent two lawyers the same night. By morning he was out.
---
[from: nina]
The prosecutor read the bank papers. Every payment to Alex is written as a legal loan. On paper Ronnie did nothing wrong, so we have no charge.
---
[from: nina]
I also went back to Alex myself and asked him about the formula. He says we took the wrong drive. He asked Pauline for a *plain* USB drive, and she heard *plane* — the airplane one.
---
[from: nina]
He says the airplane drive was a joke he made for April Fools' Day. His real work was on the plain one, on his desk at the office. We looked. That drive is not there.
---
[from: nina]
So we are back to the real question, and it is a big one. If the formula is fake, then where did all that money come from? I want you to—
---
[from: narrator]
The door opens before Nina can finish.
Fiona McAllister walks into the precinct. She looks pale and frightened.
---
[from: fiona]
Detective? I'm Fiona — Alex's girlfriend.
---
[from: fiona]
I'm afraid Alex has been kidnapped.
"""


def patch_state(state: Dict[str, Any]) -> Dict[str, Any]:
    now = datetime.now(CET)

    # --- close EP3 ----------------------------------------------------------
    stage_progress = {str(k): v for k, v in (state.get("stage_progress") or {}).items()}
    ep3_progress = stage_progress.get("3") or {}
    ep3_progress["completion_status"] = "completed"
    ep3_progress["completed_at"] = EP3_COMPLETED_AT
    stage_progress["3"] = ep3_progress

    completed = {int(x) for x in state.get("stages_completed", []) or []}
    completed.update({1, 2, 3})
    state["stages_completed"] = sorted(completed)

    ep2_state = state.setdefault("ep2_director", {})
    ep2_state["ep3_phase"] = 4  # EP3_PHASE_OUTRO
    ep2_state["ep3_outro_nina_shown"] = True
    ep2_state["ep3_outro_questionnaire_shown"] = True  # she filled it out of band
    ep2_state["alex_apartment_doubt_seed_done"] = True
    ep2_state["university_final_after_doubt_done"] = True

    # --- open EP4 -----------------------------------------------------------
    unlock_dates = {str(k): v for k, v in (state.get("stage_unlock_dates") or {}).items()}
    unlock_dates["4"] = (now - timedelta(hours=1)).isoformat()
    state["stage_unlock_dates"] = unlock_dates

    ep4_progress = stage_progress.get("4") or {}
    ep4_progress.setdefault("clues_examined", [])
    ep4_progress.setdefault("suspects_interrogated", [])
    ep4_progress.setdefault("key_information_found", [])
    ep4_progress.setdefault("completion_status", "not_started")
    stage_progress["4"] = ep4_progress
    state["stage_progress"] = stage_progress

    state["current_stage"] = EP4
    stage_locations = {str(k): v for k, v in (state.get("stage_locations") or {}).items()}
    stage_locations["4"] = EP4_LOCATION
    state["stage_locations"] = stage_locations

    # --- install her intro text ---------------------------------------------
    # EP4 history must stay empty: handle_case_intro only runs when there is
    # nothing stored for the current episode/location.
    episode_messages = {str(k): v for k, v in (state.get("episode_messages") or {}).items()}
    if episode_messages.get("4"):
        raise SystemExit(
            "episode_messages['4'] is not empty — EP4 already started for this participant. "
            "The intro will not replay. Inspect the state by hand."
        )
    episode_messages.pop("4", None)
    state["episode_messages"] = episode_messages

    overrides = dict(state.get("intro_overrides") or {})
    overrides[INTRO_KEY] = INTRO_TEXT
    state["intro_overrides"] = overrides

    state["ep4_opening_patched_at"] = now.isoformat()
    return state


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("participant")
    parser.add_argument("--apply", action="store_true", help="write to GCS (default: dry run)")
    args = parser.parse_args()

    client = storage.Client(project=PROJECT)
    bucket = client.bucket(BUCKET_NAME)
    state_blob = bucket.blob(f"game_states/user_{args.participant}_state.json")
    if not state_blob.exists():
        raise SystemExit(
            f"No game state for {args.participant}. If it was wiped, run "
            f"restore_participant_from_chat_log.py first."
        )

    raw = state_blob.download_as_text(encoding="utf-8")
    payload = json.loads(raw)
    state = payload.get("state") or {}

    print(f"Participant {args.participant} — before:")
    print("  current_stage:", state.get("current_stage"))
    print("  stages_completed:", state.get("stages_completed"))
    print("  ep3_phase:", (state.get("ep2_director") or {}).get("ep3_phase"))
    print("  ep messages:", {k: len(v) for k, v in (state.get("episode_messages") or {}).items()})

    state = patch_state(state)

    print(f"Participant {args.participant} — after:")
    print("  current_stage:", state.get("current_stage"))
    print("  stages_completed:", state.get("stages_completed"))
    print("  stage_locations:", state.get("stage_locations"))
    print("  unlock ep4:", state["stage_unlock_dates"]["4"])
    print("  ep messages:", {k: len(v) for k, v in state["episode_messages"].items()})
    print(f"  intro_overrides['{INTRO_KEY}']: {len(INTRO_TEXT)} chars, "
          f"{INTRO_TEXT.count('---') + 1} messages")
    print("\n--- EP4 opening -------------------------------------------------")
    print(INTRO_TEXT)
    print("-----------------------------------------------------------------")

    if not args.apply:
        print("\nDry run. Re-run with --apply to write.")
        return

    backup = (
        f"game_states/user_{args.participant}_state.pre_ep4_patch_"
        f"{datetime.now(CET).strftime('%Y%m%d_%H%M%S')}.json"
    )
    bucket.blob(backup).upload_from_string(raw, content_type="application/json; charset=utf-8")
    print("\n backed up current state to", backup)

    payload["state"] = state
    payload["last_saved"] = datetime.now(CET).isoformat()
    payload["participant_code"] = args.participant
    state_blob.upload_from_string(
        json.dumps(payload, indent=2, ensure_ascii=False),
        content_type="application/json; charset=utf-8",
    )
    print(" uploaded patched state")


if __name__ == "__main__":
    main()
