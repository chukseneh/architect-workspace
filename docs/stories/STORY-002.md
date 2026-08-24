# STORY-002 — Enable data-driven insights from NHS central data systems

As a healthcare analyst, I want to ingest and analyze data from NHS central data systems, so that I can derive actionable insights.

**Release:** r0 · Initial Data Ingestion and Basic Prediction (weeks 1–1)
**Owner:** Data Integration Team
**Blocked by:** nothing — you can start this now

## The requirement this satisfies

- **REQ-002** (Constraint, must) — The system must ingest data from NHS central data systems.
- **REQ-010** (Functional, must) — The system must predict operational pressure within the next 4-24 hours.

## How to build it

Connect to the NHS central data systems API, ingest data into the analytics platform, and ensure logging of all data transactions.

## Failure paths you must handle

- API connection failure
- Data format mismatch
- Data ingestion timeout

## Acceptance — your stop condition

Tick each box as it genuinely passes. This file is yours — the platform reads
the same criteria out of `.colaberry/progress.json`, which Claude Code keeps in
step (see the managed block in CLAUDE.md). Ticking something you have not
actually met only misleads you.

- [ ] Given data from NHS central data systems, when ingested, then insights are generated successfully.
- [ ] Given data ingestion fails, when retrying, then the system logs the failure and retries.
- [ ] Trust: All data ingestion attempts are logged with timestamps and outcomes.

When every box above is ticked, stop and show the demo.
