# data-quality-gate Trigger Tests

Manual trigger-accuracy tests for the `data-quality-gate` skill. Not automated; run by hand and observe whether the skill is invoked.

## Should trigger

1. "Before this data feeds the executive revenue dashboard, validate skill-lab/orders.csv against skill-lab/quality-contract.md. Tell me whether I should PUBLISH or BLOCK."
2. "Can you run a data quality check on this ETL output (exports/nightly_load.csv) before we push it downstream?"
3. "Is orders_2026_08.csv safe to publish to the weekly report? Check it against our data contract and give me a verdict."

## Should NOT trigger

1. "Write a SQL query that sums revenue by region for the last 30 days."
2. "Design a dashboard layout for the executive revenue view — what widgets should go where?"
3. "Calculate the month-over-month growth rate metric from this orders table."

## Expected output requirements

**When triggered (prompts 1–3 above):**
- Dataset is read but never modified, moved, or reformatted.
- Quality contract (if present) is read and its rules take precedence over defaults.
- Output includes a single table: `Check | Evidence | Status | Recommended Action`.
- Every row's Status is backed by concrete evidence (row numbers, values, or counts) — no unsupported assertions.
- One overall verdict is stated: **PASS**, **WARN**, or **FAIL**.
- One explicit recommendation is stated: **PUBLISH** or **BLOCK**.
- Output is procedural and concise — no narrative padding.

**When not triggered (prompts 4–6 above):**
- The request is handled as an ordinary SQL/dashboard-design/metric-calculation task.
- No quality-contract lookup, no PASS/WARN/FAIL verdict, no PUBLISH/BLOCK recommendation is produced.
- No dataset file is read for the purpose of a quality gate check (reads for the SQL/metric task itself are fine).
