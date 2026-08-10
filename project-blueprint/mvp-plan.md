# MVP Plan: Support Inbox Triage

**One-line goal for Week 1:** Feed a real support email's text into the system and prove the AI Classification & Urgency Service correctly tells emergencies apart from routine questions, sorted correctly on a live dashboard.

## Week 1 Checklist

- [ ] Stand up the **Tickets Database** (PostgreSQL 16) with one `tickets` table: raw email text, urgency, topic, created_at — nothing else yet, no agents/assignment columns.
- [ ] Build a minimal **Backend API** endpoint (Node.js + Express, TypeScript) that accepts a ticket's subject + body as a JSON POST — a stand-in for the real Postmark webhook payload, since this week is about classification accuracy, not email plumbing.
- [ ] Wire that endpoint to the **AI Classification & Urgency Service** (Anthropic Claude, Haiku 4.5): send the email text, get back an urgency level (emergency / high / normal / low) and a topic tag, write both to the Tickets Database.
- [ ] Build the **Agent Dashboard** (React + Vite, TypeScript): a single list view reading from the Backend API, sorted urgency-first, emergencies visually impossible to miss (color, position, icon).
- [ ] Wire it together end to end: POST a ticket → classified → stored → appears correctly sorted on the dashboard, no manual steps in between.
- [ ] **Prove it:** run 20 real-sounding sample emails (a mix you write yourself, weighted toward routine with a handful of true emergencies) through the live endpoint and check the dashboard's sort order and urgency labels against your own judgment of each one.

## Explicitly Out of Scope for Week 1

- **Inbound Email Provider (Postmark inbound-parse webhook)** — proves email plumbing works, not whether the AI classifies correctly; a direct JSON POST exercises the classifier identically without needing a live email address wired to a webhook.
- **Ticket Queue (pg-boss)** — proves the system survives a burst of simultaneous tickets; this week's test batch is 20 tickets submitted one at a time, so there's no burst to survive yet.
- **Routing & Assignment Service** — proves tickets reach the right specialist; this week only asks whether urgency/topic classification itself is trustworthy, before anything depends on routing it correctly.
- **Background worker process (separate from the web server)** — proves the classifier doesn't block the dashboard under load; with no queue and no burst yet, there's no load to isolate it from.
- **Real-time dashboard updates (polling or Socket.IO)** — proves the dashboard stays current while an agent is watching; this week's proof is "submit, then look," not "watch it update live."
- **Authentication / authorization** — proves the right people see the right tickets; Week 1 has one person (you) testing on one machine, so there's no second identity to guard against yet.
- **Agent records / capacity tracking** — needed for the Routing & Assignment Service above, which is itself out of scope this week.
- **Hosting / deployment (Render)** — proves the system runs unattended in production; this week runs locally, which is enough to judge classification accuracy.

## Grounded In

- **Architecture:** AI Classification & Urgency Service, Tickets Database, Backend API, Agent Dashboard (from `project-blueprint/architecture.md`) — the four components on the direct path from "email text in" to "correctly sorted ticket on screen."
- **Tech stack:** PostgreSQL 16, Node.js + Express (TypeScript), Anthropic Claude (Haiku 4.5), React + Vite (TypeScript) (from `project-blueprint/tech-stack.md`) — the exact picks for those four components; no queue, worker, webhook provider, or hosting pick is used this week.
