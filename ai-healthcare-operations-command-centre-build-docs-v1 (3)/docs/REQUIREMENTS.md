# AI Healthcare Operations Command Centre — Requirements

An AI-powered operational intelligence platform for NHS to predict pressure, identify risks, and recommend interventions.

This is the source of truth for what you are building. Your Claude Code prompts
point here. If you sharpen a requirement, edit it — your version is the real one.

| Kind | Meaning |
|---|---|
| Functional | something the system does |
| Safety | a guardrail, with a check that enforces it |
| Reliability | how it behaves when something fails |
| Constraint | a technology or vendor you must use — context, not a task |

## AI Decision Engine

### REQ-011 — Functional · must

The system must provide recommendations for interventions to manage demand and capacity.

Fulfilled by: STORY-006

## AI Governance

### REQ-013 — Safety · must

The system must flag data uncertainties for human review.

Fulfilled by: STORY-009

### REQ-018 — Safety · must

The system must not make autonomous clinical decisions.

Fulfilled by: STORY-011

## AI Intelligence

### REQ-010 — Functional · must

The system must predict operational pressure within the next 4-24 hours.

Fulfilled by: STORY-001, STORY-002

## AI What-If Simulator

### REQ-015 — Functional · should

The system must provide an AI What-If Simulator for scenario planning.

Fulfilled by: STORY-008

## Data Ingestion

### REQ-001 — Constraint

The system must ingest data from GP practice management software.

Fulfilled by: STORY-001

### REQ-002 — Constraint

The system must ingest data from NHS central data systems.

Fulfilled by: STORY-002

### REQ-003 — Constraint

The system must ingest data from the Ambulance service database.

Fulfilled by: STORY-012

### REQ-004 — Constraint

The system must ingest data from the Community care management system.

Fulfilled by: STORY-012

### REQ-005 — Constraint

The system must ingest data from Staffing rotas.

Context for the stories that use it — constraints do not get their own story.

### REQ-006 — Constraint

The system must ingest data from Emergency department records.

Context for the stories that use it — constraints do not get their own story.

### REQ-007 — Constraint

The system must ingest data from the 111 database.

Context for the stories that use it — constraints do not get their own story.

### REQ-008 — Constraint

The system must ingest data from Discharge records.

Context for the stories that use it — constraints do not get their own story.

### REQ-009 — Constraint

The system must ingest data from the Hospital bed occupancy record.

Context for the stories that use it — constraints do not get their own story.

## Development Environment

### REQ-017 — Constraint

The system must use Claude Code for AI development.

Context for the stories that use it — constraints do not get their own story.

## Executive Dashboard

### REQ-012 — Functional · must

The system must provide a concise briefing for the operational leadership team.

Fulfilled by: STORY-007

### REQ-016 — Functional · must

The system must display current and forecasted operational metrics on a dashboard.

Fulfilled by: STORY-007

## Performance

### REQ-014 — Non-functional · must

The system must reduce operational decision-making time from 3 hours to under 1 hour.

Fulfilled by: STORY-010
