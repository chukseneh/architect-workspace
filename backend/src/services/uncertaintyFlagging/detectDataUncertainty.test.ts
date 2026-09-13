import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { detectDataUncertainty } from "./detectDataUncertainty";
import { DataRecord } from "./types";

const EVAL_PATH = join(__dirname, "..", "..", "..", "..", "prompts", "flag-data-uncertainty", "eval.jsonl");

/** Same tolerance score_prompt.py uses for confidence_score comparisons, epsilon-padded for the same floating-point rounding reason (see PROGRESS.md, 2026-09-04). */
const CONFIDENCE_TOLERANCE = 0.05 + 1e-9;

interface EvalCase {
  input: {
    system: string;
    metric: string;
    value: number | null;
    recorded_at: string | null;
    last_updated_minutes_ago: number | null;
    expected_update_frequency_minutes: number;
    conflicting_source_value?: number | null;
  };
  expected: {
    uncertain: boolean;
    uncertainty_category: string;
    confidence_score: number;
  };
}

function loadEvalCases(): EvalCase[] {
  const raw = readFileSync(EVAL_PATH, "utf-8").trim();
  return raw
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

function toDataRecord(input: EvalCase["input"]): DataRecord {
  return {
    system: input.system,
    metric: input.metric,
    value: input.value,
    recordedAt: input.recorded_at,
    lastUpdatedMinutesAgo: input.last_updated_minutes_ago,
    expectedUpdateFrequencyMinutes: input.expected_update_frequency_minutes,
    conflictingSourceValue: input.conflicting_source_value ?? null,
  };
}

test("matches all 5 of the prompt's confirmed eval cases exactly on uncertain/category, within tolerance on confidence", () => {
  const cases = loadEvalCases();
  assert.equal(cases.length, 5, "expected exactly the 5 confirmed cases in prompts/flag-data-uncertainty/eval.jsonl");

  for (const evalCase of cases) {
    const result = detectDataUncertainty(toDataRecord(evalCase.input));
    const label = `${evalCase.input.system}/${evalCase.input.metric}`;

    assert.equal(result.uncertain, evalCase.expected.uncertain, `${label}: uncertain mismatch`);
    assert.equal(result.category, evalCase.expected.uncertainty_category, `${label}: category mismatch`);
    assert.ok(
      Math.abs(result.confidenceScore - evalCase.expected.confidence_score) <= CONFIDENCE_TOLERANCE,
      `${label}: confidence ${result.confidenceScore} not within ${CONFIDENCE_TOLERANCE} of expected ${evalCase.expected.confidence_score}`,
    );
  }
});

test("healthy record: fresh, plausible, no conflict is not flagged", () => {
  const result = detectDataUncertainty({
    system: "Staffing",
    metric: "nurses_on_shift",
    value: 20,
    recordedAt: "2026-08-21T07:00:00.000Z",
    lastUpdatedMinutesAgo: 1,
    expectedUpdateFrequencyMinutes: 15,
    conflictingSourceValue: null,
  });
  assert.equal(result.uncertain, false);
  assert.equal(result.category, "none");
});

test("boundary: exactly at the staleness threshold multiplier is not yet stale", () => {
  const result = detectDataUncertainty({
    system: "Emergency",
    metric: "available_beds",
    value: 10,
    recordedAt: "2026-08-21T07:00:00.000Z",
    lastUpdatedMinutesAgo: 45, // exactly 3x a 15-minute frequency
    expectedUpdateFrequencyMinutes: 15,
    conflictingSourceValue: null,
  });
  assert.equal(result.category, "none", "exactly at the threshold multiplier should not yet count as stale");
});

test("boundary: just past the staleness threshold multiplier is stale", () => {
  const result = detectDataUncertainty({
    system: "Emergency",
    metric: "available_beds",
    value: 10,
    recordedAt: "2026-08-21T07:00:00.000Z",
    lastUpdatedMinutesAgo: 46,
    expectedUpdateFrequencyMinutes: 15,
    conflictingSourceValue: null,
  });
  assert.equal(result.category, "stale_data");
});

test("boundary: a small rounding-sized gap between two sources is not a conflict", () => {
  const result = detectDataUncertainty({
    system: "Ambulance",
    metric: "handover_time_minutes",
    value: 20,
    recordedAt: "2026-08-21T07:00:00.000Z",
    lastUpdatedMinutesAgo: 1,
    expectedUpdateFrequencyMinutes: 5,
    conflictingSourceValue: 21,
  });
  assert.equal(result.category, "none", "a ~5% gap should not be treated as conflicting sources");
});

test("false positive check: a slightly-off-schedule but not stale record is not flagged", () => {
  const result = detectDataUncertainty({
    system: "Discharge",
    metric: "estimated_discharge_time",
    value: 45,
    recordedAt: "2026-08-21T07:00:00.000Z",
    lastUpdatedMinutesAgo: 20,
    expectedUpdateFrequencyMinutes: 15,
    conflictingSourceValue: null,
  });
  assert.equal(result.uncertain, false, "1.3x overdue is late but not several-times-over stale");
});
