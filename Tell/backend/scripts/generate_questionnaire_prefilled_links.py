#!/usr/bin/env python3
"""Generate pre-filled Google Form links for weekly questionnaires."""

from __future__ import annotations

import argparse
import csv
from pathlib import Path
from typing import Iterable, List
from urllib.parse import urlencode


# Questionnaire form:
# https://forms.gle/hWc2Uedw8KkdCLhv6
# Resolved Google Form ID:
# 1FAIpQLSf7wqiYQXAQZLF3I_lbItkm2iAG8ro6aYUhkj8z7bHt_Pj0WQ
FORM_VIEW_URL = (
    "https://docs.google.com/forms/d/e/"
    "1FAIpQLSf7wqiYQXAQZLF3I_lbItkm2iAG8ro6aYUhkj8z7bHt_Pj0WQ/viewform"
)

# Extracted from this form:
# - Participant Code -> entry.1171438860
# - Week Number -> entry.1690586821
ENTRY_PARTICIPANT_CODE = "1171438860"
ENTRY_WEEK_NUMBER = "1690586821"


def _dedupe_keep_order(items: Iterable[str]) -> List[str]:
    seen = set()
    output: List[str] = []
    for item in items:
        key = item.strip()
        if not key or key in seen:
            continue
        seen.add(key)
        output.append(key)
    return output


def _read_codes_file(path: Path) -> List[str]:
    """Read participant codes from txt/csv file.

    - txt: one code per line
    - csv: first non-empty value of each row is treated as a code
    """
    suffix = path.suffix.lower()
    if suffix == ".csv":
        with path.open(newline="", encoding="utf-8") as f:
            reader = csv.reader(f)
            values = []
            for row in reader:
                first = next((c.strip() for c in row if c.strip()), "")
                if first:
                    values.append(first)
            return _dedupe_keep_order(values)

    with path.open(encoding="utf-8") as f:
        return _dedupe_keep_order(f.readlines())


def build_prefilled_url(participant_code: str, week: int) -> str:
    params = {
        "usp": "pp_url",
        f"entry.{ENTRY_PARTICIPANT_CODE}": participant_code,
        f"entry.{ENTRY_WEEK_NUMBER}": str(week),
    }
    return f"{FORM_VIEW_URL}?{urlencode(params)}"


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Generate pre-filled questionnaire links with participant code "
            "and week number."
        )
    )
    parser.add_argument(
        "--codes",
        nargs="*",
        default=[],
        help="Participant codes (space-separated).",
    )
    parser.add_argument(
        "--codes-file",
        type=Path,
        help="Path to txt/csv file with participant codes.",
    )
    parser.add_argument(
        "--weeks",
        nargs="*",
        type=int,
        default=[1, 2, 3, 4],
        help="Weeks to generate (default: 1 2 3 4).",
    )
    parser.add_argument(
        "--output-csv",
        type=Path,
        help="Optional path to save links as CSV.",
    )
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    codes = list(args.codes)

    if args.codes_file:
        if not args.codes_file.exists():
            raise SystemExit(f"Codes file not found: {args.codes_file}")
        codes.extend(_read_codes_file(args.codes_file))

    codes = _dedupe_keep_order(codes)
    if not codes:
        raise SystemExit("No participant codes provided. Use --codes or --codes-file.")

    weeks = _dedupe_keep_order(str(w) for w in args.weeks)
    week_numbers = [int(w) for w in weeks]
    invalid_weeks = [w for w in week_numbers if w not in {1, 2, 3, 4}]
    if invalid_weeks:
        raise SystemExit(f"Week number must be in 1..4. Invalid: {invalid_weeks}")

    rows = []
    for code in codes:
        for week in week_numbers:
            rows.append((code, week, build_prefilled_url(code, week)))

    for code, week, link in rows:
        print(f"{code},week{week},{link}")

    if args.output_csv:
        args.output_csv.parent.mkdir(parents=True, exist_ok=True)
        with args.output_csv.open("w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(["participant_code", "week", "prefilled_link"])
            writer.writerows(rows)
        print(f"\nSaved: {args.output_csv}")


if __name__ == "__main__":
    main()
