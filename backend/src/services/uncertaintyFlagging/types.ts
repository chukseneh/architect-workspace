import { z } from "zod";

/**
 * Mirrors prompts/flag-data-uncertainty/v1.1.0.md's declared `expects`
 * header exactly. That file's decision rules (see UncertaintyCategory
 * below) are the source of truth for what counts as uncertain; this schema
 * exists so a structurally invalid record is rejected before evaluation
 * -- see STORY-009's "flagging mechanism failure" failure path, which is
 * about the *mechanism* breaking, not about a well-formed record simply
 * having an implausible value (that's the "malformed_input" category
 * below, a normal, correctly-handled outcome).
 */
export const DataRecordSchema = z.object({
  system: z.string().min(1),
  metric: z.string().min(1),
  value: z.number().nullable(),
  recordedAt: z.string().datetime().nullable(),
  lastUpdatedMinutesAgo: z.number().nullable(),
  expectedUpdateFrequencyMinutes: z.number().positive(),
  conflictingSourceValue: z.number().nullable().optional(),
});

export type DataRecord = z.infer<typeof DataRecordSchema>;

/**
 * Mirrors prompts/flag-data-uncertainty/v1.1.0.md's declared 5 categories
 * and their priority order (conflicting_sources overrides everything, then
 * malformed_input, then missing_value, then stale_data, then none) --
 * ported into deterministic code per the user's explicit choice (this
 * story's own confidence question) over calling the prompt itself, which
 * only ever scored 0.60 in eval.
 */
export const UncertaintyCategorySchema = z.enum([
  "none",
  "stale_data",
  "missing_value",
  "conflicting_sources",
  "malformed_input",
]);

export type UncertaintyCategory = z.infer<typeof UncertaintyCategorySchema>;

export interface UncertaintyFlagResult {
  uncertain: boolean;
  category: UncertaintyCategory;
  confidenceScore: number;
  /** Human-readable justification -- same role as recommend-intervention's `rationale` or score-scenario-impact's `key_assumptions`. */
  reason: string;
}

/**
 * Named to match CLAUDE.md's Observability Framework error_class examples.
 * InvalidInputError: the record failed DataRecordSchema (structurally
 * malformed) -- rejected before evaluation, never retried. FlagEvaluationError:
 * the detector itself threw an unexpected exception on a structurally valid
 * record -- the "flagging mechanism failure" failure path. TimeoutError: the
 * detector did not return within the configured budget -- the "data
 * processing delay" failure path. Both FlagEvaluationError and TimeoutError
 * are fail-safe, not fail-loud: flagForReview.ts treats them as "flag this
 * record for review," never as "let it pass unflagged."
 */
export type UncertaintyFlaggingErrorClass = "InvalidInputError" | "FlagEvaluationError" | "TimeoutError";

export class UncertaintyFlaggingError extends Error {
  readonly errorClass: UncertaintyFlaggingErrorClass;

  constructor(errorClass: UncertaintyFlaggingErrorClass, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "UncertaintyFlaggingError";
    this.errorClass = errorClass;
  }
}

/**
 * The detection strategy flagForReview.ts calls. Defaults to the real,
 * synchronous detectDataUncertainty in production; tests inject a throwing
 * or artificially slow implementation to exercise the FlagEvaluationError
 * and TimeoutError failure paths without needing detectDataUncertainty
 * itself (a total, exception-free pure function) to ever actually fail.
 * Allowed to return a Promise so a slow test double (or a future
 * I/O-backed detector) can actually yield to the event loop -- a
 * synchronous busy-wait cannot be preempted by flagForReview's timeout
 * race, since nothing else can run while it blocks.
 */
export type DataUncertaintyDetector = (record: DataRecord) => UncertaintyFlagResult | Promise<UncertaintyFlagResult>;
