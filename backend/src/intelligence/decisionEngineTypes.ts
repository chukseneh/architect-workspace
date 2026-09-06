import { z } from "zod";

/**
 * Mirrors prompts/recommend-intervention/v1.1.0.md's declared `inputs`
 * header exactly. That file is the single source of truth for the
 * prompt's contract; this schema exists so an invalid input is rejected
 * before spending a model call on it — see STORY-006's "invalid input
 * format" failure path.
 */
export const DecisionEngineInputSchema = z.object({
  icbName: z.string().min(1),
  pressureLevel: z.enum(["Low", "Medium", "High", "Critical"]),
  primaryDriver: z.enum([
    "critical_care_occupancy",
    "ambulance_handover_delay",
    "discharge_delay",
    "none",
  ]),
  availableLevers: z.array(
    z.enum(["divert_ambulances", "open_surge_beds", "expedite_discharge", "call_in_additional_staff"]),
  ),
});

export type DecisionEngineInput = z.infer<typeof DecisionEngineInputSchema>;

/** Mirrors prompts/recommend-intervention/v1.1.0.md's declared `output` header exactly. */
export const DecisionEngineOutputSchema = z.object({
  top_intervention: z.enum([
    "divert_ambulances",
    "open_surge_beds",
    "expedite_discharge",
    "call_in_additional_staff",
    "none",
    "escalate",
  ]),
  expected_impact: z.enum(["Low", "Medium", "High"]),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1),
});

export type DecisionEngineOutput = z.infer<typeof DecisionEngineOutputSchema>;

export interface DecisionEngineRequestOptions {
  timeoutMs: number;
  signal?: AbortSignal;
}

/**
 * Contract any LLM backend for recommend-intervention must satisfy — a real
 * Anthropic-backed client in production, a fake canned-response client in
 * tests. Returns the model's raw text reply; parsing/validating it into
 * DecisionEngineOutput is decisionEngine.ts's job, not the client's, so the
 * client stays a thin, swappable transport — same split as
 * PressurePredictionClient/predictPressure.ts in STORY-012.
 */
export interface DecisionEngineClient {
  predict(prompt: string, options: DecisionEngineRequestOptions): Promise<string>;
}

/**
 * Named to match CLAUDE.md's Observability Framework error_class examples
 * (TimeoutError, RateLimitError, AuthError). InvalidInputError is distinct
 * from ValidationError: InvalidInputError means the *caller's* input failed
 * DecisionEngineInputSchema and no model call is ever attempted (never
 * retried); ValidationError means the *model's* reply didn't parse into a
 * valid DecisionEngineOutput (retried, since a stochastic model can succeed
 * on a second attempt).
 */
export type DecisionEngineErrorClass =
  | "TimeoutError"
  | "RateLimitError"
  | "AuthError"
  | "UpstreamUnavailable"
  | "ValidationError"
  | "InvalidInputError";

export class DecisionEngineError extends Error {
  readonly errorClass: DecisionEngineErrorClass;

  constructor(errorClass: DecisionEngineErrorClass, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DecisionEngineError";
    this.errorClass = errorClass;
  }
}
