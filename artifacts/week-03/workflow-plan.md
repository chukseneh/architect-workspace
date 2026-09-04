# Workflow Plan: Customer Support Assistant

Same four-stage shape as the inbox-triage tool: read a folder of messages, turn each into structured fields, apply a quality bar, route what needs a human. Applied here to customer support replies instead of internal inbox triage — with one important difference: the output of this tool is a message that goes back out to a real customer, so the quality bar has to work harder.

## 1. Input — where the messages come from

Today, support messages arrive in a shared email inbox and get read and categorized by hand, one at a time. For the tool, each message becomes one plain-text file in an input folder (e.g. `support-inbox/msg01.txt`) — the same shape as the earlier inbox tool. In a real deployment this folder would be filled automatically by an export or a connector to the email inbox; for now, a sample folder of real or realistic support messages stands in for that connection.

## 2. Structured output — what gets extracted per message

For every message, the tool produces:

- **category** — one of: billing/payments, technical/bug, how-to/general question, complaint or churn risk, other
- **urgency** — high, medium, or low
- **one_line_summary** — what the customer actually needs, in a sentence
- **draft_reply** — a full, ready-to-send response to the customer, written in your support voice
- **escalation_reason** — empty, or a reason if the message contains a hard trigger (see below), regardless of how confident the model is
- **confidence** — 0 to 1, how sure the model is about its own classification and draft

The key addition versus the inbox tool is `draft_reply`: since "done" here means a reply actually goes out, the tool has to produce the reply itself, not just a label.

## 3. Quality bar — what's good enough to act on, and what isn't

A message is held for a human to review and approve before anything is sent if **any** of these is true:

- **Confidence is below 75%** — same threshold and reasoning as the inbox tool: if the model isn't sure enough about its own read, a person checks it first.
- **It mentions legal, safety, or compliance issues** — lawyers, injury, data breaches, regulators — always escalated regardless of confidence, because the cost of a wrong auto-reply here is disproportionate.
- **It shows explicit anger or a threat to cancel/churn** — always escalated regardless of confidence, because a badly-judged auto-reply to an already-upset customer can make things worse in a way a false alarm never would.

Everything else is auto-cleared: the draft reply is trusted enough to go out with no further editing.

**One deliberate extra layer of caution versus the inbox tool:** because sending an email to a real customer is much harder to undo than mis-filing an internal message, auto-cleared drafts are proposed as "ready to send with one click" rather than sent automatically outright. That's a starting assumption, easy to change once you've seen how the model performs on real messages — flag it if you'd rather it send outright from day one.

## 4. Deliverable — what you get at the end of a run

- **A reply queue**: every message with its draft reply, split into "ready to send" (auto-cleared) and "needs your review" (flagged, with the specific reason attached — low confidence, legal/safety mention, or anger/churn risk).
- **A one-page run report** (like `run_report.md` from the inbox tool): total messages processed, how many were auto-cleared vs. flagged, a breakdown by category and urgency, the specific flagged messages and why each one was held, and any processing failures — written for someone who will never open the raw data.

No code yet — this is the plan to build against once you're ready.
