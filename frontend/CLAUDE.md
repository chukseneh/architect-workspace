# frontend/CLAUDE.md — local conventions

## Toolchain deviation (logged, not silent)

The root `CLAUDE.md` documents this frontend as "React + CRA + TypeScript."
This app is built with **Vite + React + TypeScript** instead.

**Why:** Create React App is deprecated upstream (no longer maintained by
Meta) and pulls a much heavier, slower dependency tree than a walking
skeleton needs. Vite produces the same React + TypeScript output; every
other convention below (folder layout, styling, testing) applies unchanged.

**Confirmed with the user** before scaffolding (STORY-007's frontend/HTTP
follow-up, 2026-09-06) rather than silently substituted — see `PROGRESS.md`.

## Folder layout (per root CLAUDE.md, applies here unchanged)

- `src/pages/` — top-level page components
- `src/components/` — reusable UI
- `src/routes/` — route trees (public/admin/portal, if/when they diverge)
- `src/services/` — API clients (calls to the backend's `/api/*` routes)
- `src/contexts/`, `src/styles/` — cross-cutting concerns

Only `src/App.tsx`, `src/main.tsx`, `src/index.css` exist so far (walking
skeleton). Add the folders above when the first file that belongs in them
actually lands — not speculatively.

## Design system

See root `CLAUDE.md`'s UI/UX Design section for the design skills
(`/baseline-ui`, `/frontend-design`, `/fixing-accessibility`,
`/fixing-motion-performance`, `/ui-ux-design`) — the design system itself
lives there, not duplicated here.

## Backend integration

The backend HTTP API lives at `backend/src/routes/` (Express, see
`backend/src/app.ts`). Local dev: backend on `PORT` (default 3001), this
app on Vite's dev server, which proxies `/api/*` to `http://localhost:3001`
(see `vite.config.ts`'s `server.proxy`) — `src/services/dashboardApi.ts`
calls relative `/api/...` paths and relies on that proxy in dev.

**Production deployment still needs its own same-origin or reverse-proxy
config** (nginx, per root `CLAUDE.md`) — the Vite dev proxy only covers
`npm run dev`, not a built/deployed app. Flagged, not yet built.
