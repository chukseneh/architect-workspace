import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderScoreScenarioImpactPrompt } from "./scoreScenarioImpactPrompt";
import { ScenarioSimulatorInput } from "./scenarioSimulatorTypes";

const PROMPT_MD_PATH = join(__dirname, "..", "..", "..", "prompts", "score-scenario-impact", "v1.0.0.md");

const SAMPLE_INPUT: ScenarioSimulatorInput = {
  icbName: "NHS Test ICB",
  currentPressureLevel: "High",
  currentPrimaryDriver: "ambulance_handover_delay",
  scenario: "divert_ambulances",
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
 * Drift guard: prompts/score-scenario-impact/v1.0.0.md is the source of
 * truth for this prompt's wording. Built from the start (unlike
 * predictPressurePrompt.ts, whose equivalent guard was added only after a
 * transcription bug shipped in STORY-012) — this test's whole point is to
 * catch that same class of hand-copy drift before it ever reaches
 * production.
 */
test("drift guard: renderScoreScenarioImpactPrompt matches a literal substitution of the source .md file", () => {
  const mdBody = readPromptMarkdownBody();
  const inputJson = JSON.stringify(
    {
      icb_name: SAMPLE_INPUT.icbName,
      current_pressure_level: SAMPLE_INPUT.currentPressureLevel,
      current_primary_driver: SAMPLE_INPUT.currentPrimaryDriver,
      scenario: SAMPLE_INPUT.scenario,
    },
    null,
    2,
  );
  const literalRendered = mdBody.replace(/\{\{input_json\}\}/g, inputJson);

  assert.equal(renderScoreScenarioImpactPrompt(SAMPLE_INPUT).trim(), literalRendered.trim());
});

test("renders the input as snake_case JSON matching the prompt's declared field names", () => {
  const rendered = renderScoreScenarioImpactPrompt(SAMPLE_INPUT);
  assert.match(rendered, /"icb_name": "NHS Test ICB"/);
  assert.match(rendered, /"current_pressure_level": "High"/);
  assert.match(rendered, /"current_primary_driver": "ambulance_handover_delay"/);
  assert.match(rendered, /"scenario": "divert_ambulances"/);
});
