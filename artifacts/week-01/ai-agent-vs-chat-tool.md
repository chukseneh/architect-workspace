# AI Coding Agents vs. Chat-Based Tools
### A comparison for the Retail Analytics Dashboard (sample) project

## The Core Difference, in One Line

A **chat-based tool** answers questions and writes suggestions in a conversation window that a person then copies elsewhere. An **AI coding agent** works directly inside the actual project — reading real files, making real changes, running real checks — through the [agentic loop](agentic-loop-explanation.md) of context, tools, and permissions.

Same underlying AI capability, very different relationship to the actual codebase.

## Chat-Based Tools

**What they are:** A conversation window (think of a general-purpose chat assistant) where you describe a problem and receive a text answer — often including a code snippet — that you then manually copy into your project.

**Strengths**
- **Fast for isolated questions** — "What's the difference between a bar chart and a stacked bar chart for comparing store performance?" gets answered in seconds, no project access needed.
- **Zero setup, zero risk** — it can't touch the actual dashboard, so there's nothing to break.
- **Good for brainstorming and learning** — exploring options for how to visualize foot-traffic data, without committing to anything yet.

**Weaknesses**
- **No awareness of the real project.** It doesn't know the dashboard's actual data structure, existing components, or naming conventions in `claude-standards.md` — it can only guess or work from what you paste in.
- **Manual, error-prone hand-off.** A person has to copy the suggested code into the right file, in the right place, without introducing typos — and there's no automatic check that it still works afterward.
- **No verification.** It can't run the dashboard's tests or confirm the suggested change actually compiles or behaves correctly — you find out only after you've applied it yourself.
- **No memory of consequences.** If the suggested code breaks something elsewhere in the dashboard, the chat tool never finds out; it already moved on to your next question.

## AI Coding Agents

**What they are:** An assistant with direct, permissioned access to the actual project — it reads the real files, makes real edits, runs real tests, and reports back what actually happened, following the explore → plan → code → commit workflow.

**Strengths**
- **Grounded in the real project.** Before touching anything, it reads what already exists — the actual sales-trend component, the actual `project-overview.md` — so its work fits the dashboard as it really is, not as a generic guess.
- **End-to-end, not just a suggestion.** It doesn't just describe a fix for the low-stock alert threshold; it makes the change, runs the relevant checks, and reports whether they passed.
- **Traceable.** Every action (which file was read, what was changed, what test ran) is visible and auditable — useful when a stakeholder later asks "what exactly changed and why?"
- **Guardrails built in.** Routine, reversible steps (like reading code or drafting a change) proceed on their own; anything that would affect real store managers or real data pauses for human approval first (see the [permissions section](agentic-loop-explanation.md#3-permissions--what-requires-a-humans-sign-off-first) of the agentic loop explanation).

**Weaknesses**
- **More setup and context required.** It needs actual access to the project and its documentation to be effective — it's not a quick five-second answer to a standalone question.
- **Slower for pure brainstorming.** If you just want to compare three chart-library options in the abstract with no intention of building anything yet, a chat tool is the lighter-weight choice.
- **Still needs human judgment on business decisions.** It can implement "add a 15-unit low-stock threshold," but deciding *what* the threshold should be is a business call, not something it should invent on its own.

## Side-by-Side

| | Chat-Based Tool | AI Coding Agent |
|---|---|---|
| Knows the real dashboard code | No — only what's pasted in | Yes — reads it directly |
| Makes the actual change | No — you copy/paste it yourself | Yes — edits the real files |
| Runs tests to verify | No | Yes |
| Leaves an audit trail | No | Yes |
| Needs approval before risky changes | N/A (can't act on the project) | Yes, by design |
| Best for | Quick questions, brainstorming, learning | Real implementation work on the dashboard |
| Setup effort | None | Needs project access and context |

## When to Use Which, on This Project

- **Reach for a chat tool** when a store manager on the team wants to understand "what does a cohort analysis chart even show?" before any work is planned — no project access needed, no risk.
- **Reach for the AI coding agent** when the decision has been made to actually build or modify something in the dashboard — a new inventory widget, a fix to the sales-trend calculation, an update to `project-overview.md` — because it will ground the work in the real codebase, verify it, and know when to pause for your approval.

## The One-Sentence Summary

**A chat tool is a knowledgeable conversation you have to translate into action yourself; an AI coding agent is a supervised worker that reads the real project, does the actual work, checks it, and asks before anything risky ships.**
