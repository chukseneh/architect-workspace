import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderDraftLeadershipBriefingPrompt } from "./draftLeadershipBriefingPrompt";
import { IcbDashboardEntry } from "./dashboardTypes";

const PROMPT_MD_PATH = join(__dirname, "..", "..", "..", "prompts", "draft-leadership-briefing", "v1.0.0.md");

const SAMPLE_ENTRIES: IcbDashboardEntry[] = [
  { icbName: "NHS Test ICB One", currentOpelLevel: 3, forecastedPressureLevel: "High" },
  { icbName: "NHS Test ICB Two", currentOpelLevel: 1, forecastedPressureLevel: "Low" },
];

function readPromptMarkdownBody(): string {
  const raw = readFileSync(PROMPT_MD_PATH, "utf-8");
  const parts = raw.split(/^---$/m);
  if (parts.length < 3) {
    throw new Error(`Expected YAML frontmatter delimited by '---' lines in ${PROMPT_MD_PATH}`);
  }
  return parts.slice(2).join("---").trim();
}

/**
 * Drift guard: prompts/draft-leadership-briefing/v1.0.0.md is the source of
 * truth for this prompt's wording. Same shape as predictPressurePrompt's
 * and recommendInterventionPrompt's drift guards — the value here is the
 * surrounding static prose matching the source file byte-for-byte, since
 * hand-transcription is exactly where STORY-012's equivalent guard caught
 * a real bug.
 */
test("drift guard: renderDraftLeadershipBriefingPrompt matches a literal substitution of the source .md file", () => {
  const mdBody = readPromptMarkdownBody();
  const inputJson = JSON.stringify(
    {
      icb_summaries: SAMPLE_ENTRIES.map((entry) => ({
        icb_name: entry.icbName,
        pressure_level: entry.forecastedPressureLevel,
      })),
    },
    null,
    2,
  );
  const literalRendered = mdBody.replace(/\{\{input_json\}\}/g, inputJson);

  assert.equal(renderDraftLeadershipBriefingPrompt(SAMPLE_ENTRIES).trim(), literalRendered.trim());
});

test("renders an empty entry list as an empty icb_summaries array, not an error", () => {
  const rendered = renderDraftLeadershipBriefingPrompt([]);
  assert.match(rendered, /"icb_summaries": \[\]/);
});

test("maps forecastedPressureLevel to pressure_level and icbName to icb_name in the rendered JSON", () => {
  const rendered = renderDraftLeadershipBriefingPrompt(SAMPLE_ENTRIES);
  assert.match(rendered, /"icb_name": "NHS Test ICB One"/);
  assert.match(rendered, /"pressure_level": "High"/);
  assert.match(rendered, /"icb_name": "NHS Test ICB Two"/);
  assert.match(rendered, /"pressure_level": "Low"/);
});
