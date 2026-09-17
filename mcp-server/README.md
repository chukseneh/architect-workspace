# mcp-server

This recording shows the MCP Inspector connected to this server and calling
`check_nhs_trust_status`, the real integration with the `nhs-ops-status` server.

<video src="artifacts/week-06/check-nhs-trust-status-inspector-demo.mp4" controls width="720"></video>

This earlier recording shows the MCP Inspector connected to this server and running
the `refresh_system_status` tool.

<video src="artifacts/week-05/refresh-system-status-inspector-demo.mp4" controls width="720"></video>

This is an MCP server — a small program that will (later) let an AI assistant
use specific tools and read specific data through a standard protocol. Right
now it does nothing yet on purpose: no tools, no resources, no prompts. This
step only proves it can start correctly. Those capabilities get added later,
as their own separate, reviewable steps.

**Language:** TypeScript, run directly by Node.js (no separate build step).
This matches the rest of this repository's `backend/` and `frontend/`, which
are also TypeScript, and `backend/package.json` already depends on the same
library this server uses (`@modelcontextprotocol/sdk`).

## One-time setup

Before starting the server for the first time, open a terminal **inside this
`mcp-server` folder** and run:

```
npm install
```

This downloads the one small library the server needs. It only has to be
done once (or again later if the list of dependencies ever changes).

**What success looks like:** a few lines of text ending with something like

```
added 95 packages, and audited 96 packages in 5s
found 0 vulnerabilities
```

There is no need to worry about the exact package count — it will drift over
time. What matters is that the last line says `found 0 vulnerabilities` and
nothing in the output says `error`.

## Starting the server

In the same terminal, run:

```
npm start
```

**What you should see:**

```
> mcp-server@0.1.0 start
> node src/server.ts

mcp-server is running and waiting for a client to connect (stdio). Press Ctrl+C to stop.
```

**After that last line, the terminal will look like it has frozen — the
cursor will just sit there, and nothing else will print.** That is correct,
not a bug. This kind of server doesn't run a web page or print ongoing
updates; it just waits quietly for something (an AI assistant, or the MCP
Inspector from an earlier step) to connect to it. As long as you see the
"is running and waiting" line and the terminal hasn't shown an error, it
worked.

## Stopping the server

Click into that terminal window and press **Ctrl+C**. The terminal prompt
will return to normal.

## What this server assumes

These are the things that have to already be true for this server to work —
the ground it's standing on, not features it has.

**Files and folders that must already exist**

- **`.colaberry/plan.json`**, at the very root of this repository (two
  folders above this one). The server reads it once, the moment it starts,
  to learn each tracked system's starting status and the project's release
  and guardrail information for the demo-day briefing. If this file is
  missing, or isn't valid JSON, **the server does not start at all** — not
  a degraded start, a total failure, before the tool, the resource, or the
  prompt exist at all. The error you'd see is a raw, technical one, not a
  friendly explanation.
  - Worth knowing: this repository's own top-level `CLAUDE.md` says this
    exact file can legitimately be missing from some copies of this project
    (if the copy was made somewhere the sync tool couldn't write to it,
    a person has to add the file by hand). This server doesn't currently
    know how to handle that case gracefully — see below.
- **`node_modules/`**, created by running `npm install` once (covered
  earlier in this README). Without it, `npm start` fails immediately
  because Node can't find the one library the server imports.
- **A sibling `nhs-ops-status/` folder** two levels up (the repo root),
  containing that project's own `server.py`, and **the `uv` command**
  available on your PATH. Both are only needed by the `check_nhs_trust_status`
  tool, the one real external integration this server has — see below.

**Environment variables or keys**

- None. This server does not read any environment variables, API keys, or
  secrets. Everything it needs either lives in `.colaberry/plan.json`,
  already inside this folder, or (for `check_nhs_trust_status` only) in
  the sibling `nhs-ops-status/` project.

**What it remembers between calls, and what happens on restart or concurrent calls**

This server holds exactly two pieces of state across calls. Both are
documented here rather than left for someone to discover by surprise.

1. **The 8 tracked systems' status and "last checked" time** (NHS,
   Ambulance, Community, Staffing, Emergency, Discharge, Hospital, Claude
   Code) — an in-memory table, seeded from `.colaberry/plan.json` when the
   server starts.
   - `refresh_system_status` re-reads `.colaberry/plan.json` fresh on
     every call and updates the table from whatever the file currently
     says — **not** just from whatever it said at startup. (This used to
     be a real bug: earlier, `refresh_system_status` silently re-stamped
     whatever value was loaded at boot with a new "just checked" time,
     forever, even if the file changed on disk in the meantime — a wrong
     answer with a timestamp that made it look freshly verified, and
     nothing about it would ever have looked like an error. Fixed by
     making the refresh actually re-read the file.)
   - **Two calls at once:** safe. Neither the read nor the write touches
     anything asynchronous, so Node's single-threaded event loop runs
     each one to completion without interleaving — no torn state, ever.
   - **Restart mid-call:** the in-flight call is just cut off; nothing
     partial is left behind. On restart, the table reseeds fresh from
     `.colaberry/plan.json` — any status changes since the server started
     are gone, same as before this fix, because none of this was ever
     saved anywhere.
2. **An open connection to the `nhs-ops-status` server**, used by
   `check_nhs_trust_status` — opened lazily on the first call to that
   tool, then reused for every call after that rather than reopened each
   time.
   - **Two calls at once:** the connection itself is opened safely (no
     duplicate-connect race). But once open, concurrent calls send
     concurrent requests down that one shared connection — harmless today
     because the only thing it calls (`search_trust_status`) is read-only
     and touches no shared state on the other end, but it quietly assumes
     more than `nhs-ops-status`'s own documented "one caller, one request
     at a time" design (see that project's `docs/TRANSPORT_DECISION.md`).
     Worth re-examining before this adapter ever calls anything on that
     server that changes state.
   - **Restart mid-call:** the in-flight call never resolves — the caller
     sees a hang until the connection drops, then a clear error, not a
     wrong answer. Separately, on Windows, the child process this opens
     isn't guaranteed to die if this server is killed abruptly rather than
     shut down cleanly — a real, known gap, not handled here.

**What it writes to, and is it safe to run twice**

- This server never writes to `.colaberry/plan.json` — every read of it,
  including the one `refresh_system_status` now does on every call, is
  read-only.
- It's safe to start, stop, and restart as many times as you like, and
  safe to call either tool any number of times in a row — neither one
  accumulates a growing pile of side effects.

**One more assumption, not asked for above but worth naming honestly**

- The server relies on a fairly recent version of Node.js — one able to
  run TypeScript files directly, with no separate build step (confirmed
  working on Node 24). That requirement isn't written down anywhere in
  this project yet — `package.json` doesn't say which Node versions it
  needs. An older Node install would fail immediately with a confusing,
  syntax-error-shaped message, not a clear "wrong Node version" one.

## What's next

Nothing yet — this step stops here on purpose. The next step will add the
server's first real capability (a tool, a resource, or a prompt), one at a
time, so each one can be checked before the next is added.

Your MCP Inspector recordings for this week go in `artifacts/week-05/`
(currently empty — that's expected).
