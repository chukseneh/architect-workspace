# ETL Failure Triage: orders_pipeline (run-20260804-1200)

## Incident Summary

`orders_pipeline` run `run-20260804-1200` failed all 3 scheduled attempts (12:00:01–12:01:44Z, 2026-08-04) and committed 0 rows to `stg.orders`; the previous good partition (run `run-20260804-1100`, 809 rows) was retained (log line 30). Separately, the data-quality-gate check on `skill-lab/orders.csv` found 4 hard-rule violations (blank region on `ORD-1006`, negative revenue on `ORD-1007`, duplicate `ORD-1010`, stale timestamp on `ORD-1009`). **These two facts do not line up**: the failed run's error detail names a different order-ID series (`ORD-58xxx`) and different failure modes ("Western" region strings, empty-string revenue) than what appears in `orders.csv` (`ORD-10xx` series, blank region, negative revenue). The evidence available does not establish that `orders.csv` is the output of this pipeline run.

## Evidence

**From the log (facts):**
- 3 identical-signature attempts: `rows_extracted=812`, `rows_passed=764`, `rows_failed=48` each time (lines 2, 9, 13, 19, 23, 28).
- Transform error: `region` value `"Western"` not found in `region_code_map` v14, expected `[W,E,N,S]` — affects 47 of 812 rows; sample row_ids `ORD-58231`, `ORD-58244`, `ORD-58267` (lines 4–7).
- Transform error: `row_id=ORD-58310`, `raw_value=""` fails `DECIMAL(12,2)` cast on `revenue` (line 8).
- Final: `retry_exhausted attempts=3`, `final_status=FAILED`, `rows_loaded=0`, previous good partition retained (lines 29–30).

**From run metadata (facts):**
- Target `stg.orders` feeds the `orders.csv` export used by the executive revenue dashboard (metadata line 7) — establishes intent of the link, not the actual data path for this file.
- Last known good run (11:00) succeeded with 809 rows and only clean `W/E/N/S` region values — no `"Western"` or blanks (metadata lines 28–33).
- No deployment/config change recorded for `orders_pipeline`, `region_code_map`, or `orders_api` between the 11:00 good run and the 12:00 failing run (metadata lines 36–37).

**From `orders.csv` (facts, from the prior data-quality-gate run):**
- Order IDs are `ORD-1001`–`ORD-1012`, not the `ORD-58xxx` series named in the log.
- `ORD-1006` region is blank (empty string), not the value `"Western"` cited in the log.
- `ORD-1007` revenue is `-150.00` (a valid negative number), not the empty-string cast failure cited in the log.
- `ORD-1010` is duplicated and `ORD-1009` carries a 3-day-old `load_timestamp` — neither issue is mentioned anywhere in the log or metadata.

**Conflict:** the log/metadata describe a fully-failed run with 0 rows committed and a specific, narrow failure signature (region enum + one empty revenue). `orders.csv` shows a different, broader set of issues on a different ID range. Per the evidence-matching guidance, this conflict is reported rather than resolved by assumption.

## Ranked Causes

1. **Failed mapping step — `region_code_map` missing `"Western"`** (fact, most directly evidenced). 47 of 48 failed rows in the logged run trace to this single cause (line 7).
2. **Failed cast — empty-string `revenue` on `ORD-58310`** (fact, directly evidenced, log line 8). Accounts for the remaining 1 of 48 failed rows.
3. **Hypothesis — upstream `orders_api` began emitting long-form region values (`"Western"`) outside its documented v3 contract** (single-letter codes only). Consistent with the mapping error, but metadata shows no logged upstream change (metadata line 37), so this is unconfirmed drift, not a fact.
4. **Unresolved — provenance of `skill-lab/orders.csv` is not established by this log/metadata.** Its order-ID range, failure types, and row count don't match either the failed run's error detail or the last-known-good partition's clean state. No cause can be assigned to the `orders.csv` issues from the evidence reviewed; this needs its own investigation before it's attributed to `orders_pipeline` at all.

## Next Tests

- Pull the full 47-row list of `"Western"`-value failures from run `run-20260804-1200` and confirm whether `ORD-1006` (or any `ORD-10xx` ID) appears in it — the 3 sample IDs shown in the log do not.
- Identify the actual source/export path that produced `skill-lab/orders.csv` (compare against `stg.orders` table contents directly) — the file may not be the pipeline's output at all.
- Check the `orders_api` raw payload for the `ORD-1001`–`ORD-1012` ID range to determine whether these rows originate from a different environment, a manual pull, or a separate export job.
- Confirm with the `region_code_map` owner whether `"Western"` is an intended new source value pending a mapping-table update (v15) or an upstream regression.

## Escalation Recommendation

Escalate to the pipeline/data-engineering owner on two separate threads:
1. **Confirmed pipeline defect:** `region_code_map` v14 needs a `"Western"→W"` entry (or upstream needs to revert to single-letter codes), and `cast_revenue` needs null/empty handling — the identical 3-attempt failure signature indicates a deterministic bug, not a transient one, per the retry pattern in the failure catalog.
2. **Unresolved provenance gap:** `orders.csv`'s issues are not explained by this run's log or metadata and must not be attributed to `orders_pipeline` run `run-20260804-1200` without further evidence. Flag this explicitly so downstream reporting does not overstate the causal link.
