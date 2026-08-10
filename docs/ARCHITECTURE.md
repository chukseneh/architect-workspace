# Architecture — Approved Foundation

**Status:** APPROVED (foundation only) — 2026-07-31
**Session:** CC-20260731-k9p2
**Scope of this pass:** structure and documentation only. No product features, no dependencies installed.

This document is the persisted record of the folder-tree architecture proposed and approved for this repository. It supersedes the in-chat proposal as the source of truth going forward; update it here, not by re-proposing in conversation, when the tree changes.

---

## Context

This repo (`README.md`) is a personal workspace for working through an AI/agentic-engineering course. The root `CLAUDE.md` (and its duplicate at `Coliberry project/CLAUDE.md`) describes a full Colaberry-style governed-agent SaaS: Node/Express/TypeScript backend, React frontend, production VPS, Mandrill/Basecamp/OpenAI integrations, an "openclaw" outreach agent subsystem. Per user confirmation, **that is the real target stack** this project is building toward — not a template copied in for practice only. Course exercises (starting with Week 3) are the vehicle for building it out incrementally.

## Status legend

| Status | Meaning |
|---|---|
| NOW | Needed for the current/next course exercise; created this pass |
| LATER | A real, CLAUDE.md-supported folder, but nothing today needs it yet |
| EXISTING | Was already on disk before this pass |
| GENERATED | Produced automatically by tooling/runtime — never hand-authored |
| LEGACY | Old code kept as read-only reference |
| DO-NOT-TOUCH | Owned by another process or the DRI; Claude never edits directly |
| NOT NEEDED | A CLAUDE.md rule references this folder, but nothing in this repo justifies creating it yet |
| FLAGGED | Exists on disk but doesn't correspond to any CLAUDE.md rule; left untouched pending a decision |

## Approved tree

| Folder | Purpose | Belongs there | Never goes there | CLAUDE.md basis | Status | Verification |
|---|---|---|---|---|---|---|
| `CLAUDE.md` | Operating contract | Governance rules only | Business logic, code | Configuration Ownership | DO-NOT-TOUCH | Reviewed by DRI before merge |
| `PROGRESS.md` | Hard-gated change log | One entry per completed change, tagged with Session ID | Narrative status without verification evidence | Logging §, hard gate | EXISTING | Non-empty; entries carry `Session:` tag |
| `README.md` | Repo orientation | Setup + what this repo is | Architecture detail | Intern Safety Rules | EXISTING | Newcomer can orient without asking |
| `.claude/` | Harness config | Agents, skills, settings | Anything DRI hasn't reviewed | Configuration Ownership | EXISTING / DO-NOT-TOUCH | Changed only via `/update-config` |
| `backend/` | Node+Express+TS execution layer | `src/intelligence`, `src/config` now; more subfolders as needed | Frontend code, directives, tests | Architecture & System Layers; Folder Responsibilities | **NOW** — created | `backend/README.md` present |
| `backend/src/intelligence/` | Planning, prompt generation, decision engines | Week 3 component logic, pure functions | HTTP handlers, side effects | Folder Responsibilities | **NOW — Week 3 home** | Unit test accompanies first module |
| `backend/src/config/` | Env-driven config | Env var readers, timeout constants | Hardcoded secrets/business logic | 12-Factor | **NOW** | No secret literals in source |
| `backend/src/services/`, `services/agents/`, `routes/`, `models/`, `scripts/`, `seeds/`, `middleware/` | Domain services, agent orchestration, HTTP, persistence | Created when a feature needs them | — | Folder Responsibilities | LATER | Created with the feature that needs them |
| `frontend/` | React+CRA+TS UI | `pages/`, `components/`, `routes/`, `services/`, `contexts/`, `styles/` | Backend logic, secrets | Folder Responsibilities | LATER | `tsc --noEmit` once created |
| `/scripts` | Repo-wide ops tooling | `generateSessionChangelog.js` (deferred), deploy helpers | Business logic | Per-Session Change Report § | **NOW (folder only)** — created | `scripts/README.md` present; script itself deferred |
| `/directives` | SOPs before build | One directive per exercise/feature | Business logic | Layer 1 | **NOW** — created | First directive written once Week 3 specifics are defined |
| `/tests` | Verification layer | Unit now, Playwright later | Untested logic shipped as done | Testing & Validation Rules | EXISTING → **NOW (populated)** | Test pyramid ~70/20/10 maintained |
| `/docs` | In-repo docs | This file, later `sessions/`, `screenshots/` | Portal-generated state | Folder Responsibilities | EXISTING → **NOW (populated)** | Docs resolve from PROGRESS.md entries |
| `/nginx` | Prod nginx config | Docker build context | Anything pre-deploy | Folder Responsibilities | LATER | N/A until deploy |
| `/tmp` | Scratch, autonomy log, escalation file | `autonomy_log.json`, `escalation.json` | Anything committed | Escalation Protocol | GENERATED | Never tracked in git |
| `/execution` | Legacy pre-Node Python | N/A — no legacy code in this repo | New code | Folder Responsibilities | NOT NEEDED | N/A |
| `/intelligence` (top-level) | Out-of-process intelligence subsystem | Only if a future exercise needs an independently deployable process | Duplicate of `backend/src/intelligence/` | Folder Responsibilities | LATER (possibly never) | Created only with a logged reason |
| `/system` | Portal-owned generated state | Nothing hand-authored | Manual edits, ever | Telemetry Synchronization Contract | GENERATED / LATER / DO-NOT-TOUCH | Appears only via portal sync |
| `/preview-db-init` | Postgres init for preview Docker stack | Init SQL | App code | Folder Responsibilities | LATER | N/A until that stack exists |

## Flagged (existing, unaccounted for by any CLAUDE.md rule — left untouched)

- **`Coliberry project/`** — empty directory containing a byte-for-byte duplicate of root `CLAUDE.md`. No corresponding rule. Preserved as-is; needs a user decision (consolidate or delete).
- **`src/`** (repo-root, empty) — pre-existing, not referenced anywhere in CLAUDE.md's Folder Responsibilities. Distinct from `backend/src/`. Preserved as-is; needs a user decision (repurpose or remove) before it causes ambiguity with `backend/src/`.

## Assumptions carried from the approval discussion

1. `backend/` and `frontend/` are independent npm packages (no workspace tooling) until scale demands otherwise.
2. Week 3's component is TypeScript, living in `backend/src/intelligence/`.
3. No Postgres/Docker preview stack, portal, or production VPS deploy exists yet — everything gated on those stays LATER.
4. `backend/src/config/` exists now only for env-var loading, not full 12-factor config infra.
5. `generateSessionChangelog.js` is deferred past this foundation pass per explicit user scope-lock (structure + docs only, no product features, no dependency installs).

## Deviation log

CLAUDE.md's Per-Session Change Report rule expects `scripts/generateSessionChangelog.js` to exist and run after every gated change. It does not exist yet. Reason: the user explicitly scoped this session to foundation structure only, excluding product features and dependency installation — and the changelog script is real functionality (parsing, rendering, browser launch), not scaffolding. PROGRESS.md is the authoritative record until that script is built in a future session.

## Reaffirmations

Log of later sessions that re-approved this document without changing the tree. If a reaffirmation ever requires a structural change, edit the "Approved tree" table above rather than adding a diverging note here.

| Session | Date | Outcome |
|---|---|---|
| `CC-20260731-x8mq` | 2026-07-31 | User re-approved the foundation in a new session. Verified disk state against this document first; no drift found, nothing created or modified. Tree and flagged items above remain accurate as of this date. |
