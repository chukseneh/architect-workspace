# Run Metadata: orders_pipeline

- **Pipeline:** `orders_pipeline`
- **Run ID:** `run-20260804-1200`
- **Schedule:** hourly, `:00` past the hour
- **Source:** `orders_api` (upstream order-management service)
- **Target:** `stg.orders` (staging table feeding `skill-lab/orders.csv` export used by the executive revenue dashboard)
- **Attempts this run:** 3 of 3 max (scheduler `max_attempts=3`, backoff 30s / 60s / exhausted)
- **Final status:** FAILED — 0 rows committed; previous good partition retained (no partial/dirty data exposed downstream)

## Row counts

| Attempt | Rows extracted | Rows passed transform | Rows failed transform |
|---|---|---|---|
| 1 | 812 | 764 | 48 |
| 2 | 812 | 764 | 48 |
| 3 | 812 | 764 | 48 |

Failure count and failure signature are identical across all three attempts.

## Schema / mapping context

- `region_code_map` version: **14** (last updated 2026-06-11). Valid target codes: `W, E, N, S`.
- Upstream `orders_api` contract version on file: **v3** (last confirmed 2026-05-02), which documents `region` as emitting single-letter codes `W/E/N/S`.
- This run's extract shows `region="Western"` (full word, mixed case) for 47 of 812 rows — a value not present in `region_code_map` v14 and not matching the documented v3 contract.
- Separately, 1 row (`ORD-58310`) has an empty-string `revenue` value, which fails the `DECIMAL(12,2)` cast in the `cast_revenue` step. Distinct from the region issue.

## Last known good run

- **Run ID:** `run-20260804-1100`
- **Status:** SUCCESS
- **Rows loaded:** 809
- **Region values observed:** only `W, E, N, S` (no `Western` or other long-form values present)

## Change context

No deployment or config change is recorded against `orders_pipeline` or `region_code_map` between the last-good run (11:00) and the failing run (12:00). No corresponding change entry found for `orders_api` either, as of the time this metadata was captured.
