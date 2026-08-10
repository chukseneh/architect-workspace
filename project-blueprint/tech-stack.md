# Support Inbox Triage — Tech Stack

Companion to [`architecture.md`](architecture.md). Read that first — this document assumes its component list and data flow.

## Fit-Rating Key

| Icon | Meaning |
|---|---|
| 🟢 great fit | Matches this project's size and needs. Pick it, move on. |
| 🟡 good fit | Works, but there's a real caveat worth reading before you commit. |
| 🔴 consider carefully | Real risk of over-engineering, cost, or a mismatch with what this idea actually needs. |

Ratings are judged against **this** project's actual scale — a small, single-tenant support team with bursty-but-modest email volume, not against what's generally popular.

## Where This Stack Is Most Likely to Break

The single weakest link is the **AI Classification & Urgency Service**. The entire project's day-one promise — that a true emergency never sits unseen for hours — rests on one external API call succeeding quickly, every time, including during the exact bursts the Ticket Queue exists to survive. Every other component here is either boringly reliable (Postgres, Express, React) or cheap to change later (hosting, the queue backend, how the dashboard refreshes). This one isn't, and it should get a disproportionate share of testing and fallback design before anything else ships.

**Least confident calls, and why:**
- **AI Classification & Urgency Service (🔴):** rated red on purpose — see above. Needs an explicit fallback path before launch, not after.
- **Ticket Queue (pg-boss vs. Redis/BullMQ):** the idea says "bursty, unpredictable volumes" but never gives a number. This document guesses "modest," not "high." If real volume turns out to be much higher, this call should be revisited.
- **Hosting (Render vs. a self-managed VPS):** depends on how comfortable the team is with ops work, which the idea doesn't say either.

---

## Recommendations

### Things a person touches

| Component | Technology | Fit | Why | Ask More |
|---|---|:---:|---|---|
| Agent Dashboard | React + Vite (TypeScript) | 🟢 | React updates just the parts of the screen that changed the moment new tickets arrive, which keeps a live dashboard feeling instant instead of clunky. | `Explain React and Vite to me like I'm new to frontend frameworks, using my Support Inbox Triage project's Agent Dashboard as the example.` |

### Things you write

| Component | Technology | Fit | Why | Ask More |
|---|---|:---:|---|---|
| Email Ingestion Service | Node.js + Express (TypeScript) | 🟢 | This is the small, fast program that catches the webhook and turns it into a ticket — Node.js is built exactly for handling lots of quick incoming requests like this. | `Explain Node.js and Express to me like I'm new to backend programming, using my Support Inbox Triage project's email ingestion step as the example.` |
| Routing & Assignment Service | Plain TypeScript logic inside the Backend API (no new technology) | 🟢 | Deciding who gets a ticket is simple math (who handles this topic, who's free) — it doesn't need its own service, just a function running in the same program as the API. | `Explain how to design a simple rules-based routing function to me like I'm new to backend logic, using my Support Inbox Triage project's agent-matching step as the example.` |
| Backend API | Node.js + Express (TypeScript) | 🟢 | The same technology as the ingestion service, serving the dashboard — one backend language means the team maintains one set of tools instead of two. | `Explain how a Node.js + Express REST API would serve ticket data to a dashboard, using my Support Inbox Triage project as the example.` |

### Things you store

| Component | Technology | Fit | Why | Ask More |
|---|---|:---:|---|---|
| Ticket Queue | pg-boss (a job queue library — a to-do list for background work — built on Postgres) | 🟡 | pg-boss lets tickets wait safely in line during a burst without standing up a second piece of infrastructure — it reuses the database you already have. **Caveat:** it checks the database on a timer rather than pushing instantly, and shares load with your main database. Fine for a support inbox's volume; if volume ever grows into the thousands-per-minute range, a dedicated queue (Redis + BullMQ) would handle it more gracefully. | `Explain pg-boss to me like I'm new to job queues, using my Support Inbox Triage project's Ticket Queue as the example. How would tickets actually flow through it?` |
| Tickets Database | PostgreSQL 16 | 🟢 | Postgres is a rock-solid place to permanently store every ticket and what happened to it — tickets, agents, and history all relate to each other cleanly, which is exactly what a relational database is good at. | `Explain PostgreSQL to me like I'm new to databases, using my Support Inbox Triage project as the example. What tables would I actually have?` |

### Things you depend on

| Component | Technology | Fit | Why | Ask More |
|---|---|:---:|---|---|
| Inbound Email Provider | Postmark (Inbound Parse webhook) | 🟢 | Postmark turns a customer's email into ready-to-use data the moment it arrives, so nothing sits in a mailbox waiting to be checked. | `Explain Postmark's inbound parse webhook to me like I'm new to email infrastructure, using my Support Inbox Triage project as the example. What does the payload actually look like?` |
| AI Classification & Urgency Service | Anthropic Claude (Haiku 4.5 model) | 🔴 | Claude reads the email text and returns an urgency level and topic in one call — exactly the judgment call this project needs a human not to make manually. **Caveat:** this is the one component the whole project's day-one promise depends on, and it now depends on a single external API. If the API is slow, rate-limited, or down during a burst, urgent emails can sit un-scored — the exact failure this project exists to prevent. Ship an explicit fallback (e.g., an immediate keyword check for words like "down," "urgent," "security" that fires if the API call fails or times out) before launch, not after. | `Explain how to call the Anthropic Claude API for text classification to me like I'm new to AI APIs, using my Support Inbox Triage project's urgency-and-topic step as the example. What does a fallback look like if the call fails?` |

### Things the data flow needs

*Not named by the component list, but required for the flow in `architecture.md` to actually work.*

| Need | Technology | Fit | Why | Ask More |
|---|---|:---:|---|---|
| Hosting / deployment | Render (Web Service + Managed Postgres) | 🟡 | Render runs your backend, worker, and database without anyone on the team having to patch a server, which matters when there's no dedicated ops person. **Caveat:** convenient now, but running a web service, a background worker, and a managed database on Render costs more per month than a single small VPS once the team is comfortable managing one — worth revisiting after the first few months, not before. | `Explain Render's Web Service and Managed Postgres to me like I'm new to hosting, using my Support Inbox Triage project as the example. What would my monthly setup actually look like?` |
| Background worker (pulls tickets off the queue) | A second Node.js process — same codebase, run as a worker instead of a web server | 🟢 | Something has to sit and pull tickets off the queue and hand them to the classifier — running that as its own small process means an email burst can never slow down the dashboard agents are looking at. | `Explain the difference between a web process and a worker process to me like I'm new to backend architecture, using my Support Inbox Triage project's ticket queue as the example.` |
| Real-time dashboard updates | Short-interval polling — the dashboard re-asks the API for fresh data every 5–10 seconds | 🟡 | Polling is the simplest way to keep a dashboard "live" — the screen re-checks on a short timer instead of the server holding an open connection to every agent. **Caveat:** 5–10 seconds isn't instant. If even a few seconds of delay on a true emergency is unacceptable, this should become push-based updates (Socket.IO — the server sends updates the moment they happen instead of waiting to be asked), a bigger but still contained change. | `Explain the tradeoff between polling and WebSockets to me like I'm new to real-time web apps, using my Support Inbox Triage project's Agent Dashboard as the example.` |

**Fit breakdown: 7 🟢 · 3 🟡 · 1 🔴 (11 total)**

---

## Every Copy-Ready Prompt

| # | Technology | Prompt |
|---|---|---|
| 1 | React + Vite | `Explain React and Vite to me like I'm new to frontend frameworks, using my Support Inbox Triage project's Agent Dashboard as the example.` |
| 2 | Node.js + Express (ingestion) | `Explain Node.js and Express to me like I'm new to backend programming, using my Support Inbox Triage project's email ingestion step as the example.` |
| 3 | Routing logic | `Explain how to design a simple rules-based routing function to me like I'm new to backend logic, using my Support Inbox Triage project's agent-matching step as the example.` |
| 4 | Node.js + Express (API) | `Explain how a Node.js + Express REST API would serve ticket data to a dashboard, using my Support Inbox Triage project as the example.` |
| 5 | pg-boss | `Explain pg-boss to me like I'm new to job queues, using my Support Inbox Triage project's Ticket Queue as the example. How would tickets actually flow through it?` |
| 6 | PostgreSQL 16 | `Explain PostgreSQL to me like I'm new to databases, using my Support Inbox Triage project as the example. What tables would I actually have?` |
| 7 | Postmark | `Explain Postmark's inbound parse webhook to me like I'm new to email infrastructure, using my Support Inbox Triage project as the example. What does the payload actually look like?` |
| 8 | Anthropic Claude API | `Explain how to call the Anthropic Claude API for text classification to me like I'm new to AI APIs, using my Support Inbox Triage project's urgency-and-topic step as the example. What does a fallback look like if the call fails?` |
| 9 | Render hosting | `Explain Render's Web Service and Managed Postgres to me like I'm new to hosting, using my Support Inbox Triage project as the example. What would my monthly setup actually look like?` |
| 10 | Worker process | `Explain the difference between a web process and a worker process to me like I'm new to backend architecture, using my Support Inbox Triage project's ticket queue as the example.` |
| 11 | Polling vs. WebSockets | `Explain the tradeoff between polling and WebSockets to me like I'm new to real-time web apps, using my Support Inbox Triage project's Agent Dashboard as the example.` |

---

## What to Learn First, In Order

1. **PostgreSQL 16** — everything else eventually stores into it; understand it before anything else.
2. **Node.js + Express (TypeScript)** — the backend runtime three other components run inside.
3. **Postmark inbound parse** — the simplest way to get one real email flowing through the system end to end.
4. **pg-boss (Ticket Queue)** — once one email flows through, learn how to make many flow through safely.
5. **Anthropic Claude API, with its fallback** — the highest-stakes piece; learn it deliberately, including what happens when it fails.
6. **React + Vite** — build the screen once there's real ticket data to show it.
7. **The worker-process pattern** — separate the classifier from the web server once both exist.
8. **Render hosting** — deploy last, once there's something worth deploying.

---

## Alternatives Considered and Why Not

| Instead of | Considered | Why not |
|---|---|---|
| pg-boss | Redis + BullMQ | More headroom at high volume, but it means running and monitoring a second database (Redis) for a workload that, per the idea, is bursty but still modest in absolute size. |
| Anthropic Claude | A self-hosted, fine-tuned classifier | Removes the external dependency, but a small support team has no realistic way to train, host, and keep such a model accurate — it trades one risk for a worse one. |
| Node.js + Express (ingestion) | Python + FastAPI | Just as capable, but splitting ingestion into a second language from the rest of the backend adds a second toolchain to maintain for no real benefit here. |
| PostgreSQL | MongoDB | Fine for loosely-structured data, but tickets, agents, and history are clearly related records — giving up relational guarantees costs more than it saves here. |
| Render | A self-managed VPS with Docker Compose | Cheaper long-term, but it puts patching, backups, and uptime on a team that, per the idea, is small and not primarily technical operators. |
| Polling | Socket.IO (push-based updates) | Genuinely instant, but adds a persistent-connection layer to operate and debug that a five-second delay doesn't justify for most tickets — only the rare true emergency. |
| Plain TypeScript routing | A dedicated routing microservice | The kind of separation that pays off with many teams and complex rules, but for one shared queue it's an extra network hop and deployment for no real benefit. |

---

## How Hard Each Decision Is to Undo

| Difficulty | Decisions |
|---|---|
| **Easy** — contained to one file or one function | Inbound email provider (Postmark ↔ SendGrid), Routing logic, Background worker split, Polling → push-based updates |
| **Medium** — touches one service, not the whole system | Ticket queue backend (pg-boss ↔ Redis/BullMQ), AI provider/model, Hosting platform, Dashboard framework rewrite |
| **Hard** — touches everything built on top of it | Backend language/runtime (Node.js + Express), Database (PostgreSQL) |

The two "hard" rows are exactly the two things to be most sure about before writing much code — everything else in this stack can change its mind later without a full rebuild.

---

## What This Document Does NOT Tell Me

- **Actual expected ticket volume.** The idea says "bursty, unpredictable volumes" but never gives a number. Every capacity judgment above (the queue choice, the hosting tier) is a reasoned guess, not a measurement.
- **Authentication and authorization technology.** Explicitly out of scope in `architecture.md`'s "Not Covered" section — this document inherits that gap rather than filling it.
- **Actual cost at a specific volume.** Both the Claude API and Postmark scale in price with ticket volume, which is unknown (see above).
- **The team's existing skills.** If the team already knows Python well and Node.js poorly, several "easy" calls above get harder in practice.
- **Compliance or data-retention requirements.** None were stated in the idea, but a support inbox often carries customer PII worth checking on before storing history indefinitely.
- **How each piece gets tested.** This document names technology, not test strategy.
