# scripts

Repo-root operational scripts (CLAUDE.md → Folder Responsibilities). Same single-responsibility rule as `backend/src/scripts/`.

## Known future occupant

CLAUDE.md's Per-Session Change Report rule requires `node scripts/generateSessionChangelog.js <SessionID>` after every gated change, to render `docs/sessions/SESSION_<SessionID>.html`.

**Not created this session.** This foundation pass was explicitly scoped to structure only — no product features, no dependencies. The changelog script is real functionality (markdown parsing, HTML rendering, browser launch), so it's tracked as a follow-up rather than built speculatively. Until it exists, PROGRESS.md remains the authoritative per-change record.
