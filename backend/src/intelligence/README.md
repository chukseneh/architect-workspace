# backend/src/intelligence

Planning, prompt generation, and decision-engine logic (CLAUDE.md → Folder Responsibilities).

This is the approved home for the **Week 3 agentic-engineering course component**.

## Belongs here

- Pure prompt-building / planning / decision logic
- Code with no side effects — no HTTP, no DB writes, no external sends

## Never goes here

- HTTP handlers or route wiring (→ `backend/src/routes/`, once it exists)
- Side-effecting integrations — email, Basecamp, etc. (→ `backend/src/services/`, once it exists)
- Standing agent orchestration wiring (→ `backend/src/services/agents/`, once promoted)

## Testing requirement

Any new logic added here ships with at least one unit test covering the happy path (Testing & Validation Rules, minimum-now bar).
