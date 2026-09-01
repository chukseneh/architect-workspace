# STORY-007 — Develop Executive Command Dashboard

As a UI/UX designer, I want to develop an Executive Command Dashboard, so that NHS executives can view operational metrics.

**Release:** r2 · AI Decision Engine and Dashboard (weeks 3–3)
**Owner:** UI/UX Designer
**Blocked by:** STORY-006

## The requirement this satisfies

- **REQ-012** (Functional, must) — The system must provide a concise briefing for the operational leadership team.
- **REQ-016** (Functional, must) — The system must display current and forecasted operational metrics on a dashboard.

## How to build it

Design and implement a dashboard using Claude Code to display operational metrics and forecasts for NHS executives.

## Failure paths you must handle

- UI rendering failure
- Data display inaccuracy
- Dashboard loading error

## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] Given operational data, when processed, then the dashboard displays current and forecasted metrics.
- [ ] Given incomplete data, when processed, then the dashboard flags it for review.
- [ ] Trust: The dashboard logs all display activities and flags data issues.

When every box above is ticked, stop and show the demo.
