# backend

Node.js + Express + TypeScript execution layer (CLAUDE.md → Folder Responsibilities).

## Current contents

- `src/intelligence/` — planning, prompt generation, decision engines. Approved home for the Week 3 agentic-engineering course component.
- `src/config/` — env-driven configuration (12-Factor: config separated from code).

## Deferred (not yet created)

`src/services/`, `src/services/agents/`, `src/routes/`, `src/models/`, `src/scripts/`, `src/seeds/`, `src/middleware/` — created when a feature actually needs them (DB, HTTP surface, standing agent orchestration).

No `package.json` / `tsconfig.json` yet — added when the first real module lands, not as speculative scaffolding, and no dependencies are installed until then.

See root `CLAUDE.md` (Folder Responsibilities, Modular Composition Rule) for the rules governing this tree.
