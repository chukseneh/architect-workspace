import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderPredictPressurePrompt } from "./predictPressurePrompt";
import { PredictPressureInput } from "./types";

const PROMPT_MD_PATH = join(__dirname, "..", "..", "..", "prompts", "predict-pressure", "v1.0.0.md");

const SAMPLE_INPUT: PredictPressureInput = {
  icbName: "NHS Test ICB",
  region: "Test Region",
  opelLevel: 3,
  ambulanceHandoverOver60MinPct: 22.5,
  dischargeDelayBeddays: 40,
  criticalCareOccupancyPct: 88,
  lastUpdated: "2026-08-22T08:00:00.000Z",
};

function readPromptMarkdownBody(): string {
  const raw = readFileSync(PROMPT_MD_PATH, "utf-8");
  const parts = raw.split(/^---$/m);
  if (parts.length < 3) {
    throw new Error(`Expected YAML frontmatter delimited by '---' lines in ${PROMPT_MD_PATH}`);
  }
  return parts.slice(2).join("---").trim();
}

/** Mirrors the .md file's own `{{placeholder}}` mustache syntax — nothing fancier is needed for a fixed, known set of fields. */
function substitutePlaceholders(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    const value = values[key];
    if (value === undefined) {
      throw new Error(`Prompt template referenced {{${key}}}, which this test has no substitution for.`);
    }
    return value;
  });
}

/**
 * Drift guard: prompts/predict-pressure/v1.0.0.md is the source of truth for
 * this prompt's wording (see predictPressurePrompt.ts's file header for why
 * the backend keeps its own literal copy instead of reading the .md at
 * runtime). This test is what makes that copy safe — if anyone edits the
 * .md's wording without updating predictPressurePrompt.ts to match, this
 * test fails immediately instead of the drift going unnoticed until a
 * confused model reply shows up in production.
 *
 * Only exercises the case where every field is present — null-field
 * rendering is a deliberate divergence from a literal substitution (see the
 * "null rendering" test below) and is intentionally not covered here.
 */
test("drift guard: renderPredictPressurePrompt matches a literal substitution of the source .md file", () => {
  const mdBody = readPromptMarkdownBody();
  const literalRendered = substitutePlaceholders(mdBody, {
    icb_name: SAMPLE_INPUT.icbName,
    region: SAMPLE_INPUT.region,
    opel_level: String(SAMPLE_INPUT.opelLevel),
    ambulance_handover_over_60min_pct: String(SAMPLE_INPUT.ambulanceHandoverOver60MinPct),
    discharge_delay_beddays: String(SAMPLE_INPUT.dischargeDelayBeddays),
    critical_care_occupancy_pct: String(SAMPLE_INPUT.criticalCareOccupancyPct),
    last_updated: SAMPLE_INPUT.lastUpdated,
  });

  assert.equal(renderPredictPressurePrompt(SAMPLE_INPUT).trim(), literalRendered.trim());
});

test("null rendering: a missing ambulance percentage drops the literal '%' suffix rather than reading 'null%'", () => {
  const rendered = renderPredictPressurePrompt({ ...SAMPLE_INPUT, ambulanceHandoverOver60MinPct: null });
  assert.match(rendered, /Ambulance handovers over 60 minutes: null \(not available\)\n/);
  assert.doesNotMatch(rendered, /null \(not available\)%/);
});

test("null rendering: a missing discharge delay drops the literal ' bed-days' suffix rather than reading 'null bed-days'", () => {
  const rendered = renderPredictPressurePrompt({ ...SAMPLE_INPUT, dischargeDelayBeddays: null });
  assert.match(rendered, /Discharge delay: null \(not available\)\n/);
  assert.doesNotMatch(rendered, /null \(not available\) bed-days/);
});
