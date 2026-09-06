import { IcbDashboardEntry } from "./dashboardTypes";

/**
 * Renders the exact wording of prompts/draft-leadership-briefing/v1.0.0.md,
 * with the Input section's {{input_json}} placeholder substituted for the
 * real (snake_case, matching the prompt's own declared field names)
 * request. Kept as a literal copy rather than reading the .md file at
 * runtime, for the same reason as predictPressurePrompt.ts and
 * recommendInterventionPrompt.ts. See
 * draftLeadershipBriefingPrompt.test.ts for the drift guard that keeps
 * this copy honest against the source file.
 *
 * PROMPT_VERSION must be bumped, and this template re-copied, any time
 * prompts/draft-leadership-briefing/*.md changes.
 */
export const PROMPT_VERSION = "1.0.0";

export function renderDraftLeadershipBriefingPrompt(entries: IcbDashboardEntry[]): string {
  const inputJson = JSON.stringify(
    {
      icb_summaries: entries.map((entry) => ({
        icb_name: entry.icbName,
        pressure_level: entry.forecastedPressureLevel,
      })),
    },
    null,
    2,
  );

  return `## Instructions

You are a briefing writer for NHS operational leadership. Your job is to take pressure readings from multiple ICBs and summarize them into one system-wide briefing: an overall status, a count of ICBs at each tier, a headline, the top risks, and recommended actions. You are not deciding what will happen and you are not authorizing any action — you are only producing a summary that a human will read and act on.

## Input

Here is the record:

${inputJson}

## How to decide

Work through these checks in order and follow the first one that applies:

1. **No data available** — \`icb_summaries\` is empty. This overrides everything else, because there is nothing to summarize. Resolve using the "No data available" rule under "Handling awkward cases."
2. **Malformed entry** — any entry in \`icb_summaries\` has a \`pressure_level\` that is missing or is not one of \`"Low"\`, \`"Medium"\`, \`"High"\`, \`"Critical"\`. Resolve using the "Malformed entry" rule under "Handling awkward cases."
3. **Clear case** — every entry has a valid \`pressure_level\`. Count how many ICBs fall into each of the four tiers for \`status_counts\`, and set \`overall_status\` to the most severe tier present among them, using this order of severity: \`Critical\` > \`High\` > \`Medium\` > \`Low\`.

## Handling awkward cases

- **No data available** — if \`icb_summaries\` is empty, set \`overall_status: "Critical"\` — the fail-safe default, chosen so an empty feed can't be silently read as "all clear" — and set every count in \`status_counts\` to 0. State plainly in \`headline\` that no ICB data was available for this briefing, and use \`top_risks\`/\`recommended_actions\` to flag that the data gap itself needs investigating.
- **Malformed entry** — if an entry's \`pressure_level\` is missing or invalid, treat that entry as \`"Critical"\` for the purposes of \`status_counts\` and \`overall_status\` (the same fail-safe default), and name the specific ICB with the malformed entry in \`headline\` or \`top_risks\` so it gets investigated rather than silently dropped.
- **Nothing to report** — when every ICB is \`"Low"\` and none are more severe, \`overall_status: "Low"\` with a calm \`headline\` is the expected, correct answer, not a case to hedge on.

## Output fields

Work through "How to decide" silently. Then, as the very first thing in your reply, output exactly one JSON object with these five fields, and no others:

\`\`\`json
{
  "overall_status": "Low" | "Medium" | "High" | "Critical",
  "status_counts": {"Low": 0, "Medium": 0, "High": 0, "Critical": 0},
  "headline": "one short sentence",
  "top_risks": ["short phrase", "short phrase", "..."],
  "recommended_actions": ["short phrase", "short phrase", "..."]
}
\`\`\`

Do not put any reasoning, analysis, or explanation before the JSON object. If you want to add a brief note afterward, you may, but keep it short — the JSON object itself must be complete and correctly formatted, with exactly these five field names, before anything else appears.`;
}
