# STORY-008 — Implement AI What-If Simulator

As an AI architect, I want to implement an AI What-If Simulator, so that NHS executives can perform scenario planning.

**Release:** r3 · AI What-If Simulator and Governance (weeks 4–4)
**Owner:** AI Architect
**Blocked by:** STORY-007

## The requirement this satisfies

- **REQ-015** (Functional, should) — The system must provide an AI What-If Simulator for scenario planning.

## How to build it

Develop the What-If Simulator using Claude Code to model potential impacts of different scenarios on operational metrics.

## Failure paths you must handle

- Simulation processing failure
- Scenario input error
- Impact forecasting inaccuracy

## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] Given a scenario input, when processed, then the simulator forecasts the impact accurately.
- [ ] Given conflicting scenario inputs, when processed, then the simulator flags them for review.
- [ ] Trust: The simulator logs all scenario activities and flags conflicts.

When every box above is ticked, stop and show the demo.
