# STORY-009 — Implement Data Uncertainty Flagging

As a data engineer, I want to implement data uncertainty flagging, so that uncertain data is reviewed by humans.

**Release:** r3 · AI What-If Simulator and Governance (weeks 4–4)
**Owner:** Data Engineer
**Blocked by:** STORY-007

## The requirement this satisfies

- **REQ-013** (Safety, must) — The system must flag data uncertainties for human review.

## How to build it

Develop a mechanism using Claude Code to detect and flag uncertain data for human review.

## Failure paths you must handle

- Flagging mechanism failure
- False positive flagging
- Data processing delay

## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] Given uncertain data, when detected, then the system flags it for human review.
- [ ] Given certain data, when processed, then the system does not flag it.
- [ ] Trust: The system logs all flagging activities and ensures human review.

When every box above is ticked, stop and show the demo.
