import { DataRecord, UncertaintyFlagResult } from "./types";

/**
 * A record is stale once it's this many multiples of its own expected
 * update frequency overdue -- "several times over," per
 * prompts/flag-data-uncertainty/v1.1.0.md's stale_data rule, not just a
 * few minutes late.
 */
const STALE_THRESHOLD_MULTIPLIER = 3;

/**
 * Two readings count as genuinely conflicting once they differ by more
 * than this fraction of their own magnitude -- "a gap large enough that
 * the two readings can't both be describing the same reality," not just
 * rounding, per the prompt's conflicting_sources rule.
 */
const CONFLICT_RELATIVE_THRESHOLD = 0.2;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Deterministic port of prompts/flag-data-uncertainty/v1.1.0.md's decision
 * tree, ported into code rather than an LLM call per the user's explicit
 * choice for STORY-009: every category and its confidence_score range is
 * copied from that file's declared rules; only the exact confidence-score
 * formula within each range is new (the prompt only specified ranges plus
 * "use your judgment"). Total over DataRecordSchema's domain -- every
 * combination of null/non-null fields falls into exactly one category, so
 * this function is not expected to throw. See detectDataUncertainty.test.ts
 * for verification against all 5 of the prompt's confirmed eval cases.
 */
export function detectDataUncertainty(record: DataRecord): UncertaintyFlagResult {
  const { value, recordedAt, lastUpdatedMinutesAgo, expectedUpdateFrequencyMinutes, conflictingSourceValue } = record;

  // 1. conflicting_sources overrides everything else -- a record can look
  // perfectly fresh and on-time and still be wrong.
  if (value !== null && conflictingSourceValue !== null && conflictingSourceValue !== undefined) {
    const magnitude = Math.max(Math.abs(value), Math.abs(conflictingSourceValue), 1);
    const relativeGap = Math.abs(value - conflictingSourceValue) / magnitude;
    if (relativeGap > CONFLICT_RELATIVE_THRESHOLD) {
      const severity = relativeGap / CONFLICT_RELATIVE_THRESHOLD - 1;
      return {
        uncertain: true,
        category: "conflicting_sources",
        confidenceScore: round2(clamp(0.5 - 0.05 * severity, 0.3, 0.5)),
        reason: `${record.metric} reported ${value} but a second source reported ${conflictingSourceValue} -- a ${(relativeGap * 100).toFixed(0)}% relative gap, too large for the same underlying reality.`,
      };
    }
  }

  const valueImplausible = value !== null && value < 0;
  const noTimestampAtAll = recordedAt === null && lastUpdatedMinutesAgo === null;

  // 2. malformed_input: an implausible value, or no timestamp information
  // at all so there is no way to reason about the record's age.
  if (valueImplausible || noTimestampAtAll) {
    const bothSignalsPresent = valueImplausible && noTimestampAtAll;
    return {
      uncertain: true,
      category: "malformed_input",
      confidenceScore: bothSignalsPresent ? 0.0 : 0.05,
      reason: valueImplausible
        ? `${record.metric} reported an implausible value (${value}) for this kind of metric.`
        : `${record.metric} has no timestamp information at all (recordedAt and lastUpdatedMinutesAgo are both null), so its age can't be assessed.`,
    };
  }

  // 3. missing_value: nothing measured, but the record otherwise arrived
  // on time and has a usable timestamp.
  if (value === null) {
    const ratio = lastUpdatedMinutesAgo === null ? 0 : lastUpdatedMinutesAgo / expectedUpdateFrequencyMinutes;
    const staleness = clamp(ratio / STALE_THRESHOLD_MULTIPLIER, 0, 1);
    return {
      uncertain: true,
      category: "missing_value",
      confidenceScore: round2(clamp(0.15 - 0.1 * staleness, 0.05, 0.15)),
      reason: `${record.metric} has no measured value, though the record itself arrived on time.`,
    };
  }

  // 4. stale_data: the value is present and plausible, but far more
  // overdue than its own expected update frequency implies.
  const ratio = lastUpdatedMinutesAgo === null ? 0 : lastUpdatedMinutesAgo / expectedUpdateFrequencyMinutes;
  if (lastUpdatedMinutesAgo !== null && ratio > STALE_THRESHOLD_MULTIPLIER) {
    return {
      uncertain: true,
      category: "stale_data",
      confidenceScore: round2(clamp(0.45 - 0.008 * (ratio - STALE_THRESHOLD_MULTIPLIER), 0.25, 0.45)),
      reason: `${record.metric} was last updated ${lastUpdatedMinutesAgo} minutes ago, ${ratio.toFixed(1)}x its expected ${expectedUpdateFrequencyMinutes}-minute update frequency.`,
    };
  }

  // 5. none: present, plausible, on time, no conflicting reading.
  return {
    uncertain: false,
    category: "none",
    confidenceScore: round2(clamp(1.0 - 0.1 * ratio, 0.9, 1.0)),
    reason: `${record.metric} is present, plausible, and within its expected update frequency.`,
  };
}
