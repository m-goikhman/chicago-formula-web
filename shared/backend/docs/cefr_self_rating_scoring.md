# CEFR self-rating scoring (portal onboarding)

Canonical description for ethics / protocol should match this file.

## Items

Three mandatory multi-select questions: `cef_reading`, `cef_speaking`, `cef_writing`. Each has **two** statements (checkbox index **0** = first statement, **1** = second).

## Points per skill block

| Selection | Points |
|-----------|--------|
| Only first (index 0) | 0 |
| Only second (index 1) | 1 |
| Both selected | 1 |
| None | invalid (submission rejected) |

## Band for stratification

Let **S** be the sum of points over the three blocks.

| S | Band |
|---|------|
| 0 or 1 | **B1** |
| 2 or 3 | **B2** |

Implementation: `derive_cefr_band` in `shared/backend/cefr_self_rating.py`.
