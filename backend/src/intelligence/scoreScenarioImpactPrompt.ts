import { ScenarioSimulatorInput } from "./scenarioSimulatorTypes";

/**
 * Renders the exact wording of prompts/score-scenario-impact/v1.0.0.md,
 * with the Input section's {{input_json}} placeholder substituted for the
 * real (snake_case, matching the prompt's own declared field names)
 * request. Kept as a literal copy rather than reading the .md file at
 * runtime, for the same reason as recommendInterventionPrompt.ts — the
 * backend must be deployable without a dependency on the repo's top-level
 * prompts/ layout. See scoreScenarioImpactPrompt.test.ts for the drift
 * guard that keeps this copy honest against the source file.
 *
 * PROMPT_VERSION must be bumped, and this template re-copied, any time
 * prompts/score-scenario-impact/*.md changes.
 */
export const PROMPT_VERSION = "1.0.0";

export function renderScoreScenarioImpactPrompt(input: ScenarioSimulatorInput): string {
  const inputJson = JSON.stringify(
    {
      icb_name: input.icbName,
      current_pressure_level: input.currentPressureLevel,
      current_primary_driver: input.currentPrimaryDriver,
      scenario: input.scenario,
    },
    null,
    2,
  );

  return `## Instructions

You are a what-if simulator for NHS operational leadership. Your job is to take the current pressure level and its driver, apply one hypothetical intervention scenario, and project what would happen to the pressure tier. You are not deciding whether to apply the scenario and you are not recommending it over other options — you are only projecting its effect so a human can compare scenarios before choosing one.

## Input

Here is the record:

${inputJson}

## How to decide

Work through these checks in order and follow the first one that applies:

1. **Already at floor** — \`current_pressure_level\` is \`"Low"\`. This overrides everything else, because there is nothing left to improve. Resolve using the "Already at floor" rule under "Handling awkward cases."
2. **Clear case** — \`current_pressure_level\` is \`"Medium"\`, \`"High"\`, or \`"Critical"\`. Determine which of the three situations below applies, using this order of severity to move down one tier when improving: \`Critical\` → \`High\` → \`Medium\` → \`Low\`.
   - **Scenario matches the driver** — \`scenario\` is the lever that directly addresses \`current_primary_driver\` (\`critical_care_occupancy\` → \`open_surge_beds\`, \`ambulance_handover_delay\` → \`divert_ambulances\`, \`discharge_delay\` → \`expedite_discharge\`). Set \`projected_pressure_level\` one tier better than \`current_pressure_level\`, \`pressure_change: "Improves"\`, and \`confidence\` normal-to-high (roughly 0.8-0.9).
   - **Scenario is general-purpose** — \`scenario\` is \`"call_in_additional_staff"\` and is not already the direct match above. Resolve using the "General-purpose scenario" rule under "Handling awkward cases."
   - **Scenario does not match the driver** — \`scenario\` is none of the above for this \`current_primary_driver\`. Resolve using the "Mismatched scenario" rule under "Handling awkward cases."

## Handling awkward cases

- **Already at floor** — if \`current_pressure_level\` is \`"Low"\`, set \`projected_pressure_level: "Low"\` and \`pressure_change: "No change"\`, with a normal-to-high \`confidence\` (roughly 0.85-0.95). State plainly in \`key_assumptions\` that pressure is already at its lowest tier, so there is nothing for the scenario to improve.
- **General-purpose scenario** — if \`scenario\` is \`"call_in_additional_staff"\` and is not the direct match for \`current_primary_driver\`, still set \`projected_pressure_level\` one tier better than \`current_pressure_level\` (extra staff genuinely helps across most situations), but keep \`confidence\` lower than a direct match (roughly 0.5-0.6), and say in \`key_assumptions\` that this is a smaller, less certain improvement than a directly-matched intervention would produce.
- **Mismatched scenario** — if \`scenario\` does not address \`current_primary_driver\` and is not the general-purpose lever, set \`projected_pressure_level\` equal to \`current_pressure_level\` and \`pressure_change: "No change"\`, with a moderate \`confidence\` (roughly 0.65-0.75). State plainly in \`key_assumptions\` which driver is actually responsible for the pressure and why this scenario does not address it.

## Output fields

Work through "How to decide" silently. Then, as the very first thing in your reply, output exactly one JSON object with these four fields, and no others:

\`\`\`json
{
  "projected_pressure_level": "Low" | "Medium" | "High" | "Critical",
  "pressure_change": "Improves" | "No change" | "Worsens",
  "confidence": a number between 0 and 1,
  "key_assumptions": ["short phrase", "short phrase", "..."]
}
\`\`\`

Do not put any reasoning, analysis, or explanation before the JSON object. If you want to add a brief note afterward, you may, but keep it short — the JSON object itself must be complete and correctly formatted, with exactly these four field names, before anything else appears.`;
}
