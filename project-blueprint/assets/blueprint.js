/* Support Inbox Triage — single source of truth for the knowledge base.
   Classic script, no ES module. Top-level `const` is NOT a property of
   window — other scripts must reference the bare identifier `BLUEPRINT`. */

const BLUEPRINT = {

  meta: {
    projectName: "Support Inbox Triage",
    tagline: "Bursty support email, triaged and routed without losing the emergencies.",
    ideaParagraph:
      "Build a tool for a small SaaS support team that receives bursty, unpredictable volumes of customer emails and currently triages them by hand in shared inbox software. Incoming tickets should land in a queue, get classified by an AI layer for urgency and topic, get matched to the right agent, and show up in a dashboard the team checks throughout the day, with a full history stored so nothing is lost between shifts. On day one it must correctly separate the handful of true emergencies from routine questions so nothing urgent sits unseen for hours.",
    mustDoWell:
      "On day one it must correctly separate the handful of true emergencies from routine questions so nothing urgent sits unseen for hours.",
    criticalComponentId: "classifier",
    generatedDate: "2026-08-07"
  },

  openQuestion: {
    question: "Does “matched to the right agent” mean routing by topic specialty and current load, or a simple round-robin?",
    branchA: {
      label: "Specialty + load-based routing (what this design assumes)",
      impact: "The Routing & Assignment Service needs an agent-skill map and a live availability signal. More to build before Phase 3 ships, but a billing question reaches someone who actually handles billing."
    },
    branchB: {
      label: "Simple round-robin",
      impact: "Routing collapses to a rotating pointer over the agent list — ships in a fraction of the time, but a security report can land with an agent who has no idea how to triage it."
    }
  },

  components: [
    {
      id: "email-provider",
      name: "Inbound Email Provider",
      shape: "hexagon",
      layer: "external",
      builtByUs: false,
      sentence: "Receives the customer's email from the outside world and hands it to the system as structured data instead of raw mail-server traffic.",
      words: "“receives … customer emails”"
    },
    {
      id: "ingest",
      name: "Email Ingestion Service",
      shape: "rect",
      layer: "backend",
      builtByUs: true,
      sentence: "Takes each incoming email and turns it into a ticket record the rest of the system can work with.",
      words: "“receives bursty, unpredictable volumes of customer emails”"
    },
    {
      id: "queue",
      name: "Ticket Queue",
      shape: "rect",
      layer: "backend",
      builtByUs: true,
      sentence: "Holds new tickets in line so a sudden flood of emails doesn't overwhelm anything downstream — bursts get absorbed instead of dropped.",
      words: "“bursty, unpredictable volumes” / “should land in a queue”"
    },
    {
      id: "classifier",
      name: "AI Classification & Urgency Service",
      shape: "rect",
      layer: "ai",
      builtByUs: true,
      critical: true,
      sentence: "Reads each ticket and decides how urgent it is and what it's about, so emergencies can be told apart from routine questions automatically.",
      words: "“get classified by an AI layer for urgency and topic” / “must correctly separate the handful of true emergencies from routine questions”"
    },
    {
      id: "router",
      name: "Routing & Assignment Service",
      shape: "rect",
      layer: "backend",
      builtByUs: true,
      sentence: "Takes the urgency and topic and decides which support agent should handle the ticket.",
      words: "“get matched to the right agent”"
    },
    {
      id: "db",
      name: "Tickets Database",
      shape: "cylinder",
      layer: "data",
      builtByUs: true,
      sentence: "Keeps a permanent record of every ticket and what happened to it, so nothing is lost when one shift ends and the next begins.",
      words: "“full history stored so nothing is lost between shifts”"
    },
    {
      id: "api",
      name: "Backend API",
      shape: "rect",
      layer: "backend",
      builtByUs: true,
      sentence: "Connects the dashboard to the queue, the classifier's results, and the stored history so the team always sees current, accurate information.",
      words: "“show up in a dashboard the team checks throughout the day”"
    },
    {
      id: "dashboard",
      name: "Agent Dashboard",
      shape: "rect",
      layer: "frontend",
      builtByUs: true,
      sentence: "Gives the support team a live, always-current view of tickets — sorted so the true emergencies are impossible to miss.",
      words: "“show up in a dashboard the team checks throughout the day”"
    }
  ],

  layers: [
    { id: "external", label: "External Services", color: "amber" },
    { id: "backend", label: "Backend Services", color: "teal" },
    { id: "ai", label: "AI Layer", color: "blue" },
    { id: "data", label: "Data Layer", color: "slate" },
    { id: "frontend", label: "Frontend", color: "teal" }
  ],

  mermaid: {

    architecture:
`flowchart TD
    Customer(["Customer sends an email"]) -->|"email"| EmailProvider{{"Inbound Email Provider"}}
    EmailProvider -->|"inbound-parse webhook"| Ingest["Email Ingestion Service"]
    Ingest -->|"new ticket enqueued"| Queue["Ticket Queue"]
    Queue -->|"next ticket for review"| Classifier["AI Classification & Urgency Service"]
    Classifier -->|"urgency score + topic tag"| Router["Routing & Assignment Service"]
    Router -->|"assigned ticket record"| DB[("Tickets Database")]
    API["Backend API"] -->|"reads ticket list + history"| DB
    API -->|"writes status updates"| DB
    API -->|"live, sorted ticket feed"| Dashboard["Agent Dashboard"]
    SupportAgent(["Support agent"]) -->|"opens dashboard"| Dashboard
    Dashboard -->|"reply / status change"| API`,

    sequence:
`sequenceDiagram
    participant Customer
    participant EmailProvider as Inbound Email Provider
    participant Ingest as Email Ingestion Service
    participant Queue as Ticket Queue
    participant Classifier as AI Classification & Urgency Service
    participant Router as Routing & Assignment Service
    participant DB as Tickets Database
    participant API as Backend API
    participant Dashboard as Agent Dashboard
    participant Agent as Support Agent

    Customer->>EmailProvider: sends email
    EmailProvider->>Ingest: inbound-parse webhook
    Ingest->>Queue: enqueue new ticket
    Queue->>Classifier: next ticket for review
    Classifier->>Router: urgency score + topic tag
    Router->>DB: write assigned ticket record
    Agent->>Dashboard: opens dashboard
    Dashboard->>API: request ticket feed
    API->>DB: read ticket list + history
    DB-->>API: ticket records
    API-->>Dashboard: live, sorted ticket feed
    Agent->>Dashboard: reply / status change
    Dashboard->>API: submit update
    API->>DB: write status update`,

    gantt:
`gantt
    title Build Order
    dateFormat YYYY-MM-DD
    axisFormat %b %d
    section Phase 1 - Ingestion Skeleton
    Ingest + Queue + DB skeleton :p1, 2026-08-10, 5d
    section Phase 2 - Urgency Classification
    AI Classification and Urgency Service :crit, p2, after p1, 5d
    section Phase 3 - Routing
    Routing and Assignment Service :p3, after p2, 5d
    section Phase 4 - Dashboard
    Backend API and Agent Dashboard :p4, after p3, 5d
    section Phase 5 - Shift Handoff Polish
    History, search, filters, audit trail :p5, after p4, 5d`
  },

  dataFlowSteps: [
    { step: 1, actor: "Customer", action: "Emails support about a problem.", touchesModel: false },
    { step: 2, actor: "Inbound Email Provider", action: "Receives the raw email and fires a webhook at the Email Ingestion Service.", touchesModel: false },
    { step: 3, actor: "Email Ingestion Service", action: "Turns the webhook payload into a ticket record and pushes it onto the Ticket Queue — this is what protects the system when ten emails arrive in the same minute.", touchesModel: false },
    { step: 4, actor: "AI Classification & Urgency Service", action: "Pulls the next ticket off the queue, reads the email content, and assigns an urgency level and a topic tag.", touchesModel: true },
    { step: 5, actor: "Routing & Assignment Service", action: "Checks which agents handle that topic and who has capacity, assigns the ticket, and writes the full record to the Tickets Database.", touchesModel: false },
    { step: 6, actor: "Backend API", action: "Continuously reads the Tickets Database and serves the current ticket list, sorted so emergencies surface at the top, to the Agent Dashboard.", touchesModel: false },
    { step: 7, actor: "Support Agent", action: "Opens the dashboard, sees emergencies impossible to miss, and resolves or replies to a ticket — the update flows back through the API into the Database.", touchesModel: false }
  ],

  phases: [
    { id: "p1", order: 1, name: "Ingestion Skeleton", weight: 5, makeOrBreak: false,
      proves: "Emails reliably become durable ticket records — no data loss under a burst, even before anything intelligent happens to them.",
      componentIds: ["email-provider", "ingest", "queue", "db"] },
    { id: "p2", order: 2, name: "Urgency Classification", weight: 5, makeOrBreak: true,
      proves: "The day-one requirement: the AI layer correctly separates true emergencies from routine questions.",
      componentIds: ["classifier"] },
    { id: "p3", order: 3, name: "Routing", weight: 5, makeOrBreak: false,
      proves: "Tickets reach the agent who can actually handle them, not just any available agent.",
      componentIds: ["router"] },
    { id: "p4", order: 4, name: "Dashboard", weight: 5, makeOrBreak: false,
      proves: "The team can see and act on a live, correctly-sorted queue throughout the day.",
      componentIds: ["api", "dashboard"] },
    { id: "p5", order: 5, name: "Shift Handoff Polish", weight: 5, makeOrBreak: false,
      proves: "Nothing is lost between shifts — search, filters, and a full audit trail hold up under real use.",
      componentIds: ["db", "api", "dashboard"] }
  ],

  requirements: [
    { id: "r1", label: "Absorb bursty volume without losing a ticket" },
    { id: "r2", label: "Correctly separate emergencies from routine questions", critical: true },
    { id: "r3", label: "Route each ticket to the right agent" },
    { id: "r4", label: "Give the team a live view all day" },
    { id: "r5", label: "Preserve full history across shifts" }
  ],

  coverage: [
    { requirementId: "r1", byPhase: { p1: "covered", p2: "covered", p3: "covered", p4: "covered", p5: "covered" } },
    { requirementId: "r2", byPhase: { p1: "none", p2: "covered", p3: "covered", p4: "covered", p5: "covered" } },
    { requirementId: "r3", byPhase: { p1: "none", p2: "none", p3: "covered", p4: "covered", p5: "covered" } },
    { requirementId: "r4", byPhase: { p1: "none", p2: "none", p3: "none", p4: "covered", p5: "covered" } },
    { requirementId: "r5", byPhase: { p1: "partial", p2: "partial", p3: "partial", p4: "covered", p5: "covered" } }
  ],

  assumptions: [
    {
      id: "a1",
      text: "Email arrives via an inbound-parse webhook from a transactional email provider (a Postmark/SendGrid-style service), not IMAP polling.",
      impact: "The idea says the team “receives” emails but doesn't name a channel. A webhook is the low-latency default — it matters because the day-one requirement is about urgent tickets not sitting unseen. If polling is required instead (e.g. a legacy mailbox), the Email Ingestion Service needs a scheduled poller in place of a webhook receiver."
    },
    {
      id: "a2",
      text: "“Matched to the right agent” means routing by topic specialty and current load, not a fixed round-robin.",
      impact: "See the Open Question below — this is the single assumption most likely to change the shape of the Routing & Assignment Service."
    },
    {
      id: "a3",
      text: "This is single-tenant: one support team, one shared queue.",
      impact: "Simplifies the Tickets Database schema and the dashboard's access model. If multiple customer organizations ever need data isolated from each other, tenancy has to be designed into the schema and the API's auth layer from the start — retrofitting it later touches every table."
    }
  ],

  notCovered: [
    "Authentication and authorization for agents logging into the dashboard.",
    "Outbound reply-sending — composing and sending the agent's email response back to the customer.",
    "SLA reporting or analytics beyond the live dashboard view.",
    "Multi-channel support (chat, phone) — this design is email-only.",
    "Team capacity or staffing planning."
  ],

  pages: [
    { id: "index", file: "index.html", nav: "Command Center" },
    { id: "summary", file: "01-summary.html", nav: "The Idea", desc: "The project in one paragraph and the sentence that outranks everything else." },
    { id: "components", file: "02-components.html", nav: "Components", desc: "Every component this idea actually implies — and the words that required each one." },
    { id: "architecture", file: "03-architecture.html", nav: "How It Fits Together", desc: "The system as a Mermaid flowchart, entry points to data layer." },
    { id: "data-flow", file: "04-data-flow.html", nav: "Data Flow", desc: "One real customer email, traced step by step through every component." },
    { id: "build-order", file: "05-build-order.html", nav: "Build Order", desc: "The phases, what each one proves, and the make-or-break phase." },
    { id: "assumptions", file: "06-assumptions.html", nav: "Assumptions", desc: "What was assumed, the impact of each, and the one open question." },
    { id: "not-covered", file: "07-not-covered.html", nav: "Not Covered", desc: "What this design deliberately leaves out — stated honestly." }
  ]
};
