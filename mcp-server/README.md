# mcp-server

This recording shows the MCP Inspector connected to this server and running
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

**Environment variables or keys**

- None. This server does not read any environment variables, API keys, or
  secrets. Everything it needs either lives in `.colaberry/plan.json` or is
  already inside this folder.

**What it remembers between calls, and what happens on restart**

- While running, the server keeps one small piece of memory: the current
  status and "last checked" time for each of the 8 tracked systems (NHS,
  Ambulance, Community, Staffing, Emergency, Discharge, Hospital, Claude
  Code). Calling the `refresh_system_status` tool updates that memory;
  reading the system-status resource only ever looks at whatever is
  currently sitting in it.
- **That memory is not saved anywhere.** The instant the server restarts,
  it is wiped and rebuilt from scratch by reading `.colaberry/plan.json`
  again. Any status changes the tool made during the previous run are
  gone — the server has no memory of ever having run before.

**What it writes to, and is it safe to run twice**

- This server never writes to any file, database, or external system. It
  only ever *reads* `.colaberry/plan.json` — it never changes it.
- Because of that, it's completely safe to start, stop, and restart as
  many times as you like, and safe to call `refresh_system_status` any
  number of times in a row — it always lands in the same kind of state
  (the same status, just a newer timestamp), never a growing pile of
  side effects.

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
