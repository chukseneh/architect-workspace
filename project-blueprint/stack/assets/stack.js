/* Support Inbox Triage — Tech Stack knowledge base, single source of truth.
   Classic script, no ES module. Top-level `const` is NOT a property of
   window — other scripts must reference the bare identifier `STACK`. */

const STACK = {

  meta: {
    projectName: "Support Inbox Triage — Tech Stack",
    tagline: "One real technology per component, rated against this project's actual scale.",
    architectureRef: "../architecture.md",
    architectureLabel: "Support Inbox Triage architecture",
    generatedDate: "2026-08-07",
    fitCounts: { green: 7, amber: 3, red: 1 }
  },

  ratingKey: [
    { code: "green", icon: "🟢", label: "great fit", desc: "matches this project's size and needs; pick it, move on" },
    { code: "amber", icon: "🟡", label: "good fit", desc: "works, but there is a real caveat you should read first" },
    { code: "red", icon: "🔴", label: "consider carefully", desc: "where this plan is most likely to hurt you" }
  ],

  headline:
    "The single weakest link is the AI Classification & Urgency Service: the entire project's day-one promise — that a true emergency never sits unseen for hours — rests on one external API call succeeding quickly, every time, including during the exact bursts the Ticket Queue exists to survive. Every other component here is either boringly reliable (Postgres, Express, React) or cheap to change later (hosting, the queue backend, how the dashboard refreshes); this one isn't, and it should get a disproportionate share of testing and fallback design before anything else ships.",

  leastConfident: [
    { title: "AI Classification & Urgency Service", reason: "Rated 🔴 on purpose — the whole project's promise depends on one external API call. Needs an explicit fallback path before launch, not after." },
    { title: "Ticket Queue: pg-boss vs. Redis + BullMQ", reason: "“Bursty, unpredictable volumes” never gets a number in the idea. This document guesses “modest,” not “high.” If real volume turns out much higher, revisit." },
    { title: "Hosting: Render vs. a self-managed VPS", reason: "Depends on how comfortable the team is with ops work — the idea doesn't say, and this is a genuine judgment call." }
  ],

  groups: [
    { id: "touch", label: "Things a person touches", desc: "The interface the support team actually looks at." },
    { id: "write", label: "Things you write", desc: "Application code — services and logic built for this project specifically." },
    { id: "store", label: "Things you store", desc: "Where tickets live, in transit and permanently." },
    { id: "depend", label: "Things you depend on", desc: "Third-party services this system cannot function without." },
    { id: "flow", label: "Things the data flow needs", desc: "Not named by the architecture's component list, but required for the flow to actually run." }
  ],

  recommendations: [
    {
      id: "dashboard",
      component: "Agent Dashboard",
      group: "touch",
      technology: "React + Vite (TypeScript)",
      fit: "green",
      why: "React updates just the parts of the screen that changed the moment new tickets arrive, which keeps a live dashboard feeling instant instead of clunky.",
      caveat: null,
      prompt: "Explain React and Vite to me like I'm new to frontend frameworks, using my Support Inbox Triage project's Agent Dashboard as the example.",
      alternatives: [{ name: "Plain HTML/JS", whyNot: "Cheaper to start, but a dashboard with live sorting, filters, and status updates gets tangled fast without a framework doing the bookkeeping." }],
      undo: { level: "medium", note: "The dashboard is the most isolated piece of this stack; a full frontend rewrite doesn't touch the backend or database at all." },
      topology: "yours"
    },
    {
      id: "ingestion",
      component: "Email Ingestion Service",
      group: "write",
      technology: "Node.js + Express (TypeScript)",
      fit: "green",
      why: "This is the small, fast program that catches the webhook and turns it into a ticket — Node.js is built exactly for handling lots of quick incoming requests like this.",
      caveat: null,
      prompt: "Explain Node.js and Express to me like I'm new to backend programming, using my Support Inbox Triage project's email ingestion step as the example.",
      alternatives: [{ name: "Python + FastAPI", whyNot: "Just as capable, but splitting ingestion into a second language from the rest of the backend adds a second toolchain to maintain for no real benefit here." }],
      undo: { level: "hard", note: "The whole backend is written against this runtime; switching languages later means rewriting every service, not just this one." },
      topology: "yours"
    },
    {
      id: "queue",
      component: "Ticket Queue",
      group: "store",
      technology: "pg-boss (a job queue library — a to-do list for background work — built on Postgres)",
      fit: "amber",
      why: "pg-boss lets tickets wait safely in line during a burst without standing up a second piece of infrastructure — it reuses the database you already have.",
      caveat: "It checks the database on a timer rather than pushing instantly, and shares load with your main database. Fine for a support inbox's volume; if volume ever grows into the thousands-per-minute range, a dedicated queue (Redis + BullMQ) would handle it more gracefully.",
      prompt: "Explain pg-boss to me like I'm new to job queues, using my Support Inbox Triage project's Ticket Queue as the example. How would tickets actually flow through it?",
      alternatives: [{ name: "Redis + BullMQ", whyNot: "More headroom at high volume, but it means running and monitoring a second database (Redis) for a workload that, per the idea, is bursty but still modest in absolute size." }],
      undo: { level: "medium", note: "Swapping queue technology means rewriting the enqueue/dequeue code, but the rest of the system only ever sees “a ticket is ready,” so the blast radius is contained." },
      topology: "managed"
    },
    {
      id: "classifier",
      component: "AI Classification & Urgency Service",
      group: "depend",
      technology: "Anthropic Claude (Haiku 4.5 model)",
      fit: "red",
      why: "Claude reads the email text and returns an urgency level and topic in one call — exactly the judgment call this project needs a human not to make manually.",
      caveat: "This is the one component the whole project's day-one promise depends on, and it now depends on a single external API. If the API is slow, rate-limited, or down during a burst, urgent emails can sit un-scored — the exact failure this project exists to prevent. Ship an explicit fallback (e.g., an immediate keyword check for words like “down,” “urgent,” “security” that fires if the API call fails or times out) before launch, not after.",
      prompt: "Explain how to call the Anthropic Claude API for text classification to me like I'm new to AI APIs, using my Support Inbox Triage project's urgency-and-topic step as the example. What does a fallback look like if the call fails?",
      alternatives: [{ name: "A self-hosted, fine-tuned classifier", whyNot: "Removes the external dependency, but a small support team has no realistic way to train, host, and keep such a model accurate — it trades one risk for a worse one." }],
      undo: { level: "medium", note: "The prompt and API call are isolated in one service; swapping models or providers means rewriting one function — but the fallback logic needs to move with it." },
      topology: "vendor",
      critical: true
    },
    {
      id: "router",
      component: "Routing & Assignment Service",
      group: "write",
      technology: "Plain TypeScript logic inside the Backend API (no new technology)",
      fit: "green",
      why: "Deciding who gets a ticket is simple math (who handles this topic, who's free) — it doesn't need its own service, just a function running in the same program as the API.",
      caveat: null,
      prompt: "Explain how to design a simple rules-based routing function to me like I'm new to backend logic, using my Support Inbox Triage project's agent-matching step as the example.",
      alternatives: [{ name: "A dedicated routing microservice", whyNot: "The kind of separation that pays off with many teams and complex rules, but for one shared queue it's an extra network hop and deployment for no real benefit." }],
      undo: { level: "easy", note: "It's a function call today; extracting it into its own service later, if the team ever grows, is a contained refactor." },
      topology: "yours"
    },
    {
      id: "db",
      component: "Tickets Database",
      group: "store",
      technology: "PostgreSQL 16",
      fit: "green",
      why: "Postgres is a rock-solid place to permanently store every ticket and what happened to it — tickets, agents, and history all relate to each other cleanly, which is exactly what a relational database is good at.",
      caveat: null,
      prompt: "Explain PostgreSQL to me like I'm new to databases, using my Support Inbox Triage project as the example. What tables would I actually have?",
      alternatives: [{ name: "MongoDB", whyNot: "Fine for loosely-structured data, but tickets, agents, and history are clearly related records — giving up relational guarantees costs more than it saves here." }],
      undo: { level: "hard", note: "A production database, once real ticket history is in it, is the single hardest thing in this stack to migrate away from." },
      topology: "managed"
    },
    {
      id: "api",
      component: "Backend API",
      group: "write",
      technology: "Node.js + Express (TypeScript)",
      fit: "green",
      why: "The same technology as the ingestion service, serving the dashboard — one backend language means the team maintains one set of tools instead of two.",
      caveat: null,
      prompt: "Explain how a Node.js + Express REST API would serve ticket data to a dashboard, using my Support Inbox Triage project as the example.",
      alternatives: [{ name: "Python + FastAPI", whyNot: "Same reasoning as the ingestion service — a second language for the same job, no real benefit." }],
      undo: { level: "hard", note: "Same runtime lock-in as the ingestion service — the whole backend shares this decision." },
      topology: "yours"
    },
    {
      id: "email-provider",
      component: "Inbound Email Provider",
      group: "depend",
      technology: "Postmark (Inbound Parse webhook)",
      fit: "green",
      why: "Postmark turns a customer's email into ready-to-use data the moment it arrives, so nothing sits in a mailbox waiting to be checked.",
      caveat: null,
      prompt: "Explain Postmark's inbound parse webhook to me like I'm new to email infrastructure, using my Support Inbox Triage project as the example. What does the payload actually look like?",
      alternatives: [{ name: "SendGrid Inbound Parse", whyNot: "Equally solid, but Postmark's deliverability reputation and simpler dashboard fit a small team better; picking one over the other is close to a coin flip." }],
      undo: { level: "easy", note: "Swapping inbound-email vendors only touches the ingestion webhook, not anything downstream." },
      topology: "vendor"
    },
    {
      id: "hosting",
      component: "Hosting / Deployment",
      group: "flow",
      technology: "Render (Web Service + Managed Postgres)",
      fit: "amber",
      why: "Render runs your backend, worker, and database without anyone on the team having to patch a server, which matters when there's no dedicated ops person.",
      caveat: "Convenient now, but running a web service, a background worker, and a managed database on Render costs more per month than a single small VPS once the team is comfortable managing one — worth revisiting after the first few months, not before.",
      prompt: "Explain Render's Web Service and Managed Postgres to me like I'm new to hosting, using my Support Inbox Triage project as the example. What would my monthly setup actually look like?",
      alternatives: [{ name: "A self-managed VPS with Docker Compose", whyNot: "Cheaper long-term, but it puts patching, backups, and uptime on a team that, per the idea, is small and not primarily technical operators." }],
      undo: { level: "medium", note: "The app itself is portable (Docker-friendly); the real cost of switching hosts is re-doing the deployment pipeline, not the code." },
      topology: "vendor",
      fromDataFlow: true
    },
    {
      id: "worker",
      component: "Background Worker (queue consumer)",
      group: "flow",
      technology: "A second Node.js process — same codebase, run as a worker instead of a web server",
      fit: "green",
      why: "Something has to sit and pull tickets off the queue and hand them to the classifier — running that as its own small process means an email burst can never slow down the dashboard agents are looking at.",
      caveat: null,
      prompt: "Explain the difference between a web process and a worker process to me like I'm new to backend architecture, using my Support Inbox Triage project's ticket queue as the example.",
      alternatives: [{ name: "Run ingestion and classification inline in the API process", whyNot: "Risks the dashboard slowing down during an email burst, which is the opposite of what this project needs." }],
      undo: { level: "easy", note: "It's the same code as the API, just started differently; merging it back into one process is a one-line deployment change." },
      topology: "yours",
      fromDataFlow: true
    },
    {
      id: "realtime",
      component: "Real-time dashboard updates",
      group: "flow",
      technology: "Short-interval polling — the dashboard re-asks the API for fresh data every 5–10 seconds",
      fit: "amber",
      why: "Polling is the simplest way to keep a dashboard “live” — the screen re-checks on a short timer instead of the server holding an open connection to every agent.",
      caveat: "5–10 seconds isn't instant. If even a few seconds of delay on a true emergency is unacceptable, this should become push-based updates (Socket.IO — the server sends updates the moment they happen instead of waiting to be asked), a bigger but still contained change.",
      prompt: "Explain the tradeoff between polling and WebSockets to me like I'm new to real-time web apps, using my Support Inbox Triage project's Agent Dashboard as the example.",
      alternatives: [{ name: "Socket.IO (push-based updates)", whyNot: "Genuinely instant, but adds a persistent-connection layer to operate and debug that a five-second delay doesn't justify for most tickets — only the rare true emergency." }],
      undo: { level: "easy", note: "Polling lives entirely in the dashboard's data-fetching code; switching to push-based updates later doesn't touch the database or the classifier." },
      topology: "yours",
      fromDataFlow: true
    }
  ],

  topology: {
    yours: { label: "Your code — runs inside Render's Web Service + worker", nodes: ["React Dashboard", "Node.js + Express Backend API", "Node.js Ingestion + Routing logic", "Node.js Worker process"] },
    managed: { label: "Your data — Render-managed Postgres", nodes: ["PostgreSQL 16 (Tickets Database)", "pg-boss (Ticket Queue, same database)"] },
    vendor: { label: "Someone else's servers entirely", nodes: ["Postmark (inbound email)", "Anthropic Claude API (classification)", "Render (the platform itself)"] }
  },

  learningPath: [
    { order: 1, technology: "PostgreSQL 16", reason: "Everything else eventually stores into it; understand it before anything else." },
    { order: 2, technology: "Node.js + Express (TypeScript)", reason: "The backend runtime three other components run inside." },
    { order: 3, technology: "Postmark inbound parse", reason: "The simplest way to get one real email flowing through the system end to end." },
    { order: 4, technology: "pg-boss (Ticket Queue)", reason: "Once one email flows through, learn how to make many flow through safely." },
    { order: 5, technology: "Anthropic Claude API, with its fallback", reason: "The highest-stakes piece; learn it deliberately, including what happens when it fails." },
    { order: 6, technology: "React + Vite", reason: "Build the screen once there's real ticket data to show it." },
    { order: 7, technology: "The worker-process pattern", reason: "Separate the classifier from the web server once both exist." },
    { order: 8, technology: "Render hosting", reason: "Deploy last, once there's something worth deploying." }
  ],

  alternatives: [
    { insteadOf: "pg-boss", considered: "Redis + BullMQ", whyNot: "More headroom at high volume, but it means running and monitoring a second database (Redis) for a workload that, per the idea, is bursty but still modest in absolute size." },
    { insteadOf: "Anthropic Claude", considered: "A self-hosted, fine-tuned classifier", whyNot: "Removes the external dependency, but a small support team has no realistic way to train, host, and keep such a model accurate — it trades one risk for a worse one." },
    { insteadOf: "Node.js + Express (ingestion)", considered: "Python + FastAPI", whyNot: "Just as capable, but splitting ingestion into a second language from the rest of the backend adds a second toolchain to maintain for no real benefit here." },
    { insteadOf: "PostgreSQL", considered: "MongoDB", whyNot: "Fine for loosely-structured data, but tickets, agents, and history are clearly related records — giving up relational guarantees costs more than it saves here." },
    { insteadOf: "Render", considered: "A self-managed VPS with Docker Compose", whyNot: "Cheaper long-term, but it puts patching, backups, and uptime on a team that, per the idea, is small and not primarily technical operators." },
    { insteadOf: "Polling", considered: "Socket.IO (push-based updates)", whyNot: "Genuinely instant, but adds a persistent-connection layer to operate and debug that a five-second delay doesn't justify for most tickets — only the rare true emergency." },
    { insteadOf: "Plain TypeScript routing", considered: "A dedicated routing microservice", whyNot: "The kind of separation that pays off with many teams and complex rules, but for one shared queue it's an extra network hop and deployment for no real benefit." }
  ],

  reversibility: [
    { level: "easy", label: "Easy — contained to one file or one function", items: ["Inbound Email Provider (Postmark ↔ SendGrid)", "Routing & Assignment logic", "Background Worker split", "Polling → push-based updates"] },
    { level: "medium", label: "Medium — touches one service, not the whole system", items: ["Ticket Queue backend (pg-boss ↔ Redis/BullMQ)", "AI provider / model", "Hosting platform", "Agent Dashboard framework rewrite"] },
    { level: "hard", label: "Hard — touches everything built on top of it", items: ["Backend language / runtime (Node.js + Express)", "Database (PostgreSQL)"] }
  ],

  notCovered: [
    "Actual expected ticket volume — the idea says “bursty, unpredictable volumes” but never gives a number. Every capacity judgment above (queue choice, hosting tier) is a reasoned guess, not a measurement.",
    "Authentication and authorization technology — explicitly out of scope in architecture.md's “Not Covered” section; this document inherits that gap rather than filling it.",
    "Actual cost at a specific volume — both the Claude API and Postmark scale in price with ticket volume, which is unknown.",
    "The team's existing skills — if the team already knows Python well and Node.js poorly, several “easy” calls above get harder in practice.",
    "Compliance or data-retention requirements — none were stated in the idea, but a support inbox often carries customer PII worth checking on before storing history indefinitely.",
    "How each piece gets tested — this document names technology, not test strategy."
  ],

  pages: [
    { id: "index", file: "index.html", nav: "Command Center" },
    { id: "summary", file: "01-summary.html", nav: "Summary", desc: "The fit-rating key, the headline risk, and which calls this document is least sure about." },
    { id: "recommendations", file: "02-recommendations.html", nav: "Recommendations", desc: "One technology per component, grouped, rated, and explained in plain English." },
    { id: "topology", file: "03-topology.html", nav: "Topology", desc: "What runs as your code, what's your data on managed infrastructure, and what's someone else's server entirely." },
    { id: "learning-path", file: "04-learning-path.html", nav: "Learning Path", desc: "What to learn first, in order, and why that order." },
    { id: "alternatives", file: "05-alternatives.html", nav: "Alternatives", desc: "What else was considered for each pick, and why it lost." },
    { id: "reversibility", file: "06-reversibility.html", nav: "Reversibility", desc: "How hard each decision is to undo, from a one-file swap to a full rebuild." },
    { id: "not-covered", file: "07-not-covered.html", nav: "Not Covered", desc: "What this document does not tell you, said honestly." },
    { id: "appendix", file: "08-appendix.html", nav: "Appendix", desc: "Every copy-ready prompt in one table, and the fit-rating breakdown." }
  ]
};
