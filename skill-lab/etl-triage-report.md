# ETL Triage Report: orders_pipeline

**Run investigated:** `run-20260804-1200` (3/3 attempts failed)
**Sources reviewed:** `skill-lab/orders-pipeline-failure.log`, `skill-lab/pipeline-run-metadata.md`

## Incident Summary

`orders_pipeline` failed all 3 scheduled attempts (12:00:01Z, 12:00:35Z, 12:01:40Z) of run `run-20260804-1200` with an identical failure signature each time: 48 of 812 rows failed the transform stage (47 on a `region` mapping error, 1 on a `revenue` cast error). No rows were committed to `stg.orders`; the previous good partition (run `run-20260804-1100`, 809 rows, SUCCESS) was retained, so no bad data reached the downstream export/dashboard.

## Evidence

**Facts (directly observed in log/metadata):**
- Log lines 4-7, 15-17, 25-26: `field=region value="Western"` for row IDs `ORD-58231`, `ORD-58244`, `ORD-58267`, message "value not found in region_code_map, expected one of [W,E,N,S]" — repeated identically across all 3 attempts.
- Log lines 7, 17, 26: `mapping failed for 47 of 812 rows: source value 'Western' has no entry in region_code_map (expected single-letter codes W/E/N/S)`.
- Log lines 8, 18, 27: `step=cast_revenue field=revenue row_id=ORD-58310 raw_value="" msg="conversion failed: cannot cast empty string to DECIMAL(12,2)"` — same row, same error, all 3 attempts.
- Log lines 9, 19, 28: `rows_failed=48 rows_passed=764 exit_code=1` — identical across attempts 1, 2, and 3.
- Log lines 29-30: `scheduler action=retry_exhausted attempts=3 max_attempts=3 status=FAILED`; `rows_loaded=0`, previous good partition retained.
- Metadata lines 23-24: `region_code_map` v14 (last updated 2026-06-11) accepts only `W, E, N, S`; upstream `orders_api` contract v3 (last confirmed 2026-05-02) documents `region` as single-letter codes.
- Metadata line 25: this run's extract contains `region="Western"` (full word, mixed case) for 47 of 812 rows — absent from both the mapping table and the documented contract.
- Metadata line 26: the empty-string `revenue` on `ORD-58310` is called out as "distinct from the region issue."
- Metadata lines 30-33: last-known-good run (11:00) observed *only* `W, E, N, S` region values and loaded 809 rows successfully.
- Metadata line 37: no deployment or config change is on record for `orders_pipeline`, `region_code_map`, or `orders_api` between the 11:00 success and the 12:00 failure.

**Hypotheses (would explain the facts but are not themselves stated in the log/metadata):**
- `orders_api` began emitting full-word region values ("Western") instead of the contracted single-letter codes, via an upstream change not captured in this pipeline's change log.
- The empty-string `revenue` value for `ORD-58310` reflects a genuinely missing/null value at the source, rather than a corruption introduced during extract.

## Ranked Causes

1. **Upstream `orders_api` region-value format drift (highest confidence).**
   Evidence: 47 of 48 failed rows (98%) share one mapping error citing the same out-of-domain value `"Western"` (log lines 4-7, 15-17, 25-26); this value contradicts the documented v3 API contract and does not appear at all in the prior hour's successful run (metadata lines 30-33); no config/mapping-table/pipeline change is on record that would explain a new rejection (metadata line 37). The identical failure signature across all 3 attempts (log lines 9, 19, 28) is evidence *against* a transient/infrastructure cause — a real infra flake would be expected to vary or clear on retry, not reproduce byte-for-byte three times. Per the failure-pattern catalog, this is a **failed mapping/conversion step** triggered by a lookup table lacking an entry for a new source value.

2. **`region_code_map` stale relative to a legitimate (but unconfirmed) upstream change (secondary, contributing).**
   Evidence: same log lines as #1. This is the mirror explanation — the mapping table (v14, last updated 2026-06-11) may be behind a deliberate upstream change rather than the upstream change being erroneous. Ranked below #1 because metadata's only contract reference (v3, confirmed 2026-05-02) still documents single-letter codes, so there is no evidence yet that the format change was sanctioned or expected.

3. **Isolated source data defect: empty `revenue` for `ORD-58310` (low confidence, minor, unrelated).**
   Evidence: log lines 8, 18, 27 — single row, single value (`""`), same error on all 3 attempts. Affects only 1 of 812 rows and metadata explicitly separates it from the region issue (metadata line 26). Does not account for the bulk of the failure.

4. **Retries as a mitigation path — ruled out, confirms determinism of #1/#2.**
   All 3 attempts produced `rows_failed=48` with the same row IDs and messages (log lines 9, 19, 28). Per the failure-pattern catalog, an identical repeated failure signature indicates a deterministic cause (bad/unmapped data), not transient infrastructure flakiness — no timeout, connection, or lock-contention evidence appears anywhere in the log.

No conflict between log and metadata: both point to the same mapping/domain-value problem, not an infrastructure or pipeline-config problem.

## Next Tests

1. **For Cause 1/2 (region mapping):** Pull the current raw response/schema directly from `orders_api` (not the metadata's point-in-time contract note from 2026-05-02) and diff it against contract v3 to confirm whether `region` is now emitting full-word values across the board or only for a subset of rows/regions. Enumerate all distinct `region` values present in this run's raw extract (not just the 3 sample row IDs logged) to determine whether `"Western"` is the only unmapped variant or one of several (e.g., "Eastern", "Northern", "Southern" may also be present but unlogged since only the first few WARNs per value are typically sampled).
2. **For Cause 3 (empty revenue):** Inspect `ORD-58310` directly at the `orders_api` source (not staging) to determine whether `revenue` is null/missing at origin or was dropped/blanked during extract — this distinguishes a source data-quality issue from an extract-layer bug.
3. **For retry behavior:** Check the scheduler/job config to confirm each retry attempt re-pulls a fresh extract from `orders_api` rather than replaying a cached one, and confirm `region_code_map` is not cached/pinned per-run — this rules out a stale-read explanation for why 3 identical attempts produced 3 byte-identical failures.

## Escalation Recommendation

Escalate to the `orders_api` upstream owner and the `region_code_map` owner before any fix is made: resolving this requires either a mapping-table update or an upstream contract correction/clarification, both of which are schema/contract decisions outside diagnostic scope (and outside this repo's autonomy — external dependency/contract changes are a governance boundary). No downstream exposure occurred (0 rows committed, prior good partition retained), so this is not data-integrity-critical, but it will block every subsequent hourly run until resolved.
