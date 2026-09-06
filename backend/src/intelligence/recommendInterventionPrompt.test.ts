import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderRecommendInterventionPrompt } from "./recommendInterventionPrompt";
import { DecisionEngineInput } from "./decisionEngineTypes";

const PROMPT_MD_PATH = join(__dirname, "..", "..", "..", "prompts", "recommend-intervention", "v1.1.0.md");

const SAMPLE_INPUT: DecisionEngineInput = {
  icbName: "NHS Test ICB",
  pressureLevel: "High",
  primaryDriver: "ambulance_handover_delay",
  availableLevers: ["divert_ambulances", "call_in_additional_staff"],
};

function readPromptMarkdownBody(): string {
  const raw = readFileSync(PROMPT_MD_PATH, "utf-8");
  const parts = raw.split(/^---$/m);
  if (parts.length < 3) {
    throw new Error(`Expected YAML frontmatter delimited by '---' lines in ${PROMPT_MD_PATH}`);
  }
  return parts.slice(2).join("---").trim();
}

/**
 * Drift guard: prompts/recommend-intervention/v1.1.0.md is the source of
 * truth for this prompt's wording. Unlike predict-pressure's multi-field
 * template, this prompt's Input section is a single {{input_json}}
 * placeholder — so the "literal substitution" here just drops in the same
 * JSON blob renderRecommendInterventionPrompt builds. The real value of
 * this test is the surrounding static prose ("How to decide", "Handling
 * awkward cases", "Output fields") matching the source file byte-for-byte —
 * exactly the kind of hand-transcription drift STORY-012's equivalent guard
 * caught on its first run.
 */
test("drift guard: renderRecommendInterventionPrompt matches a literal substitution of the source .md file", () => {
  const mdBody = readPromptMarkdownBody();
  const inputJson = JSON.stringify(
    {
      icb_name: SAMPLE_INPUT.icbName,
      pressure_level: SAMPLE_INPUT.pressureLevel,
      primary_driver: SAMPLE_INPUT.primaryDriver,
      available_levers: SAMPLE_INPUT.availableLevers,
    },
    null,
    2,
  );
  const literalRendered = mdBody.replace(/\{\{input_json\}\}/g, inputJson);

  assert.equal(renderRecommendInterventionPrompt(SAMPLE_INPUT).trim(), literalRendered.trim());
});

test("renders the input as snake_case JSON matching the prompt's declared field names", () => {
  const rendered = renderRecommendInterventionPrompt(SAMPLE_INPUT);
  assert.match(rendered, /"icb_name": "NHS Test ICB"/);
  assert.match(rendered, /"pressure_level": "High"/);
  assert.match(rendered, /"primary_driver": "ambulance_handover_delay"/);
  assert.match(rendered, /"available_levers": \[\s*"divert_ambulances",\s*"call_in_additional_staff"\s*\]/);
});
