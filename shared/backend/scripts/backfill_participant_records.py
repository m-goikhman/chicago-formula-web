"""
Backfill per-participant onboarding records for the code-first portal flow.

The refactored study_onboarding reads `study_onboarding/participants/<CODE>.json`,
but participants onboarded under the legacy token-attach flow only exist in
`study_onboarding/participants.csv`. This script creates the missing JSON
records from the CSV so that:
  * login returns their study_arm,
  * the portal sends them straight to "continue your game",
  * assign_arm() reuses the existing arm instead of re-randomizing.

Usage:
    python3 backfill_participant_records.py --bucket <GCS_BUCKET_NAME> --dry-run
    python3 backfill_participant_records.py --bucket <GCS_BUCKET_NAME>

Requires Google Cloud credentials (ADC or GOOGLE_APPLICATION_CREDENTIALS).
Existing participant records are never overwritten unless --overwrite is set.
"""

import argparse
import csv
import io
import json
import os
import re
import sys
from datetime import datetime, timezone

from google.cloud import storage

GCS_PREFIX = "study_onboarding"
PARTICIPANTS_CSV_BLOB = f"{GCS_PREFIX}/participants.csv"
RECORD_PREFIX = f"{GCS_PREFIX}/participants"

# CSV meta columns (old flow used "attached_at", new flow uses "assigned_at").
META_FIELDS = {
    "participant_code",
    "arm",
    "cefr_band",
    "questionnaire_completed_at",
    "assigned_at",
    "attached_at",
    "login_source",
    "login_recorded_at",
}

DEFAULT_SKIP_CODES = {"TEST", "ROBERTA", "DEMO"}
DEMO_SLOT_PATTERN = re.compile(r"^DEMO\d+$")


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--bucket",
        default=os.environ.get("GCS_BUCKET_NAME", "").strip(),
        help="GCS bucket name (defaults to GCS_BUCKET_NAME env var)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Only print what would be written, change nothing",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Rewrite records that already exist (default: skip them)",
    )
    parser.add_argument(
        "--skip",
        default="",
        help="Extra participant codes to skip, comma-separated (e.g. test codes)",
    )
    return parser.parse_args()


def should_skip(code: str, extra_skip: set) -> bool:
    if code in DEFAULT_SKIP_CODES or code in extra_skip:
        return True
    if DEMO_SLOT_PATTERN.match(code):
        return True
    return False


def load_csv_rows(bucket) -> list:
    blob = bucket.blob(PARTICIPANTS_CSV_BLOB)
    if not blob.exists():
        sys.exit(f"ERROR: {PARTICIPANTS_CSV_BLOB} not found in bucket")
    text = blob.download_as_text(encoding="utf-8")
    reader = csv.DictReader(io.StringIO(text))
    return list(reader)


def build_record(row: dict) -> dict:
    code = str(row.get("participant_code") or "").strip().upper()
    answers = {
        key: value
        for key, value in row.items()
        if key and key not in META_FIELDS and str(value or "").strip()
    }
    return {
        "participant_code": code,
        "cefr_band": str(row.get("cefr_band") or "").strip(),
        "answers": answers,
        "arm": str(row.get("arm") or "").strip().lower(),
        "questionnaire_completed_at": str(row.get("questionnaire_completed_at") or "").strip(),
        "assigned_at": (
            str(row.get("assigned_at") or "").strip()
            or str(row.get("attached_at") or "").strip()
        ),
        "backfilled_from_csv_at": datetime.now(timezone.utc).isoformat(),
    }


def main():
    args = parse_args()
    if not args.bucket:
        sys.exit("ERROR: pass --bucket or set GCS_BUCKET_NAME")

    extra_skip = {c.strip().upper() for c in args.skip.split(",") if c.strip()}
    client = storage.Client()
    bucket = client.bucket(args.bucket)

    rows = load_csv_rows(bucket)
    print(f"CSV rows: {len(rows)}")

    # The CSV is append-only; keep the LAST row per participant code.
    latest_by_code = {}
    for row in rows:
        code = str(row.get("participant_code") or "").strip().upper()
        if code:
            latest_by_code[code] = row

    written = skipped_existing = skipped_special = skipped_no_arm = 0
    for code, row in sorted(latest_by_code.items()):
        if should_skip(code, extra_skip):
            print(f"  skip (special/test code): {code}")
            skipped_special += 1
            continue

        record = build_record(row)
        if not record["arm"]:
            print(f"  skip (no arm assigned): {code}")
            skipped_no_arm += 1
            continue

        blob = bucket.blob(f"{RECORD_PREFIX}/{code}.json")
        if blob.exists() and not args.overwrite:
            print(f"  skip (record already exists): {code}")
            skipped_existing += 1
            continue

        if args.dry_run:
            print(f"  WOULD WRITE {blob.name}: arm={record['arm']} band={record['cefr_band']}")
        else:
            blob.upload_from_string(
                json.dumps(record, ensure_ascii=False, indent=2),
                content_type="application/json; charset=utf-8",
            )
            print(f"  wrote {blob.name}: arm={record['arm']} band={record['cefr_band']}")
        written += 1

    mode = "DRY RUN — nothing written" if args.dry_run else "written"
    print(
        f"\nDone. {written} record(s) {mode}; "
        f"{skipped_existing} already existed, {skipped_special} special codes skipped, "
        f"{skipped_no_arm} without arm."
    )


if __name__ == "__main__":
    main()
