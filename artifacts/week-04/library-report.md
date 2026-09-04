# NEXUS AI Prompt Library — Status Report

*Last updated: 2026-09-05. This is a plain-English summary for anyone who wants to know what's in this library and how solid it is, without opening any code.*

## The headline

**6 prompts exist. 0 are marked library-ready. 6 are drafts** — and that's the honest, expected state right now, not a problem. `status: ready` is a deliberate human sign-off (see `CONTRIBUTING.md`), and nobody has made that call yet, even though 5 of the 6 are already scoring perfectly against their test cases.

## Every prompt, what it does, and where it stands

| Prompt | What it does for NEXUS AI | Score | Status |
|---|---|---|---|
| `predict-pressure` | Looks at one hospital system's current numbers (ambulance delays, bed occupancy, discharge backlogs) and forecasts how much operational pressure it'll be under in the next 4-24 hours, so leadership can act before a crisis hits rather than after. | 1.00 (5/5) | Draft |
| `classify-metric-status` | Takes one number and its safe/warning/danger thresholds and turns it into a single traffic-light badge (Green/Amber/Red/Black) for the dashboard, so a glance tells you if something needs attention. | 1.00 (5/5) | Draft |
| `recommend-intervention` | Given the current pressure and what's actually available to do about it (extra staff, surge beds, ambulance diversion, faster discharge), suggests the single best option — never decides on its own, only recommends, leaving the choice to a person. | 1.00 (5/5) | Draft |
| `draft-leadership-briefing` | Rolls up pressure readings from several hospital systems at once into one short leadership briefing: overall status, a count of how many systems are in each condition, the top risks, and what to consider doing about them. | 1.00 (5/5) | Draft |
| `score-scenario-impact` | The "what if" tool: given today's situation, projects what would likely happen if a specific action were taken, so leadership can compare options side by side before committing to one. | 1.00 (5/5) | Draft |
| `flag-data-uncertainty` | Looks at one incoming data record and decides whether it's trustworthy enough to act on, or should be flagged for a person to check first — the library's original, foundational prompt from before this build session. | Not yet scored | Draft |

Every score above was independently confirmed by running the same test twice and getting the same result both times — not a single lucky pass.

## What "the score" actually means

Each prompt has a set of test cases that a human reviewed and confirmed line by line before the prompt was ever written — never the other way around. The score is the fraction of those cases where the prompt's answer matched exactly, on every field that has one clear right answer (a category, a number within a small tolerance). Free-text explanations that come with each answer are shown for a human to read, but deliberately don't count toward the score, since there's rarely one single correct sentence.

## What I would build next

1. **Score `flag-data-uncertainty`.** It's the one gap in this library — it predates this session and has never actually been run through the scoring tool, so nobody can currently say how well it performs. That's a quick, high-value fix.
2. **Get a human sign-off to promote the five proven prompts to `status: ready`.** They're all scoring 1.00 against their confirmed test cases, which is the technical bar — but moving to "ready" is a deliberate human decision (see `CONTRIBUTING.md`), not something that happens automatically just because the number is good.
3. **Wire the prompts together into the real pipeline.** Right now each prompt works on its own. The natural chain is: ingested data → `predict-pressure` → `classify-metric-status` (per metric, for the dashboard) → `recommend-intervention` → `draft-leadership-briefing`, with `score-scenario-impact` available on demand for "what if" questions. That chaining is orchestration code that doesn't exist yet.
4. **Stress-test harder than the first 5 cases per prompt.** Each prompt currently has one deliberately awkward case; a stronger library would push further — genuinely adversarial or malformed inputs, values at exact tier boundaries, and multiple problems happening in the same input at once — before any prompt is trusted with real operational decisions.

## Where to look for more detail

- `CONTRIBUTING.md` (this folder) — the five rules a prompt must meet to be called library-ready, and how draft/ready actually works.
- `scripts/check_library.py` — the automated check that verifies every prompt's claim against those five rules; run `python scripts/check_library.py` any time to get a fresh table.
- Each prompt's own folder — the prompt file itself, its `eval.jsonl` test cases, and (where applicable) its version history.
