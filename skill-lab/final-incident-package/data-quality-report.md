# Data Quality Report: skill-lab/orders.csv

**Contract:** skill-lab/quality-contract.md
**Rows evaluated:** 12 data rows (rows 2–13), header at row 1
**Key column:** `order_id` (contract-designated)

| Check | Evidence | Status | Recommended Action |
|---|---|---|---|
| Schema | Header row (row 1) contains all expected columns: `order_id, customer, region, product, revenue, load_timestamp`. No unexpected columns. | PASS | None |
| Freshness (<24h, per contract) | Row 10: `ORD-1009` has `load_timestamp = 2026-08-01T07:00:00Z`, which is ~3 days before current date 2026-08-04 — exceeds the contract's 24-hour max-age. | FAIL | Block publish until stale row is re-extracted or excluded; investigate why this row loaded with an old timestamp. |
| Expected volume (≥10 rows) | 12 data rows present (rows 2–13); 11 unique order_ids after removing the exact duplicate. | PASS | None |
| Key uniqueness (`order_id`) | `ORD-1010` appears twice: row 11 and row 12, identical in every field. | FAIL | Block publish; deduplicate `ORD-1010` at source before re-load. |
| Duplicates (full-row) | Row 11 and row 12 are fully identical: `ORD-1010,Kappa Inc,West,Widget C,725.00,2026-08-04T11:00:00Z`. | FAIL | Same as key uniqueness — remove the duplicate row. |
| Required fields (`region`) | Row 7: `ORD-1006` (Zeta Group) has an empty `region` field. | FAIL | Block publish; backfill or reject the row pending source correction. |
| Nulls (required fields, reported) | `region` blank rate: 1/12 rows (8.3%) — row 7 only. | Reported (not a standalone gate) | Monitor; matches the Required Fields failure above. |
| Numeric rules (`revenue` > 0) | Row 8: `ORD-1007` (Eta Partners) has `revenue = -150.00`. | FAIL | Block publish; confirm with source whether this is a refund/return that needs separate handling, not a raw negative revenue row. |

## Overall Verdict: **FAIL**

Five hard-rule violations found: stale timestamp (row 10), duplicate order_id / duplicate row (rows 11–12), missing region (row 7), and negative revenue (row 8).

## Recommendation: **BLOCK**

Do not publish `orders.csv` in its current state. All FAIL items are hard contract violations per `quality-contract.md`.
