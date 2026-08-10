# Data Quality Report: skill-lab/orders.csv

**Validated against:** skill-lab/quality-contract.md
**Dataset:** skill-lab/orders.csv (12 data rows, header + rows 2–13)

| Check | Evidence | Status | Recommended Action |
|---|---|---|---|
| Schema | Columns present: `order_id, customer, region, product, revenue, load_timestamp` — matches all fields referenced by the contract; no unexpected columns. | PASS | None |
| Freshness (`load_timestamp` < 24h old) | Row 9 (`ORD-1009`, Iota Corp) has `load_timestamp = 2026-08-01T07:00:00Z`, ~3 days older than the rest of the dataset (all other rows cluster on `2026-08-04T09:15–11:15Z`). Well outside the contract's 24-hour window. | FAIL | Drop or re-ingest the `ORD-1009` row with a current load timestamp before publishing. |
| Expected volume (≥10 rows) | 12 data rows present (11 unique `order_id` values). | PASS | None |
| Key uniqueness (`order_id`) | `ORD-1010` appears twice, at row 11 and row 12, identical in every field (Kappa Inc, West, Widget C, 725.00, `2026-08-04T11:00:00Z`). | FAIL | De-duplicate on `order_id`, keeping a single `ORD-1010` record; investigate the source of the duplicate load. |
| Full-row duplicates | Rows 11 and 12 are byte-for-byte identical. | FAIL | Same fix as above — de-duplication resolves both the key-uniqueness and full-duplicate findings simultaneously. |
| Required fields (`region`) | Row 7 (`ORD-1006`, Zeta Group) has an empty `region` field. | FAIL | Backfill the correct region for `ORD-1006` from source, or exclude the row pending correction. |
| Nulls (informational) | 1 of 12 rows (8.3%) has a blank `region` value — `ORD-1006`, row 7. No other required field has nulls. | — (reported) | Monitor; currently driven by the single `ORD-1006` gap above. |
| Numeric rules (`revenue` > 0) | Row 8 (`ORD-1007`, Eta Partners) has `revenue = -150.00`. | FAIL | Confirm whether this is a refund/credit needing a separate handling path, or a data entry error; correct or route to the appropriate field before publishing. |

## Overall Verdict: **FAIL**

Four hard contract violations: stale `load_timestamp` (`ORD-1009`), duplicate `order_id` / duplicate row (`ORD-1010`), missing required `region` (`ORD-1006`), and non-positive `revenue` (`ORD-1007`).

## Recommendation: **BLOCK**

Do not publish to the executive revenue dashboard in current form. Remediate the four flagged rows (`ORD-1006`, `ORD-1007`, `ORD-1009`, duplicate `ORD-1010`), then re-run this gate before publishing.
