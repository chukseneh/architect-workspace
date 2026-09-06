import { z } from "zod";

/**
 * Mirrors prompts/predict-pressure/v1.0.0.md's declared `inputs` header
 * exactly. That file is the single source of truth for the prompt's
 * contract; this schema exists so a malformed input is rejected before
 * spending a model call on it, not to redefine the contract independently.
 */
export const PredictPressureInputSchema = z.object({
  icbName: z.string().min(1),
  region: z.string().min(1),
  opelLevel: z.number().int().min(1).max(4),
  /** Percentage 0-100, or null when no ambulance data was ingested for this run. */
  ambulanceHandoverOver60MinPct: z.number().min(0).max(100).nullable(),
  /** Bed-days lost, or null when no community data was ingested for this run. */
  dischargeDelayBeddays: z.number().int().min(0).nullable(),
  criticalCareOccupancyPct: z.number().min(0).max(100),
  lastUpdated: z.string().datetime(),
});

export type PredictPressureInput = z.infer<typeof PredictPressureInputSchema>;

/** Mirrors prompts/predict-pressure/v1.0.0.md's declared `output` header exactly. */
export const PredictPressureOutputSchema = z.object({
  pressure_level: z.enum(["Low", "Medium", "High", "Critical"]),
  confidence: z.number().min(0).max(1),
  horizon: z.string().min(1),
  contributing_factors: z.array(z.string()),
});

export type PredictPressureOutput = z.infer<typeof PredictPressureOutputSchema>;

export interface PressurePredictionRequestOptions {
  timeoutMs: number;
  signal?: AbortSignal;
}

/**
 * Contract any LLM backend for predict-pressure must satisfy — a real
 * Anthropic-backed client in production, a fake canned-response client in
 * tests. Returns the model's raw text reply; parsing/validating it into
 * PredictPressureOutput is predictPressure.ts's job, not the client's, so
 * the client stays a thin, swappable transport.
 */
export interface PressurePredictionClient {
  predict(prompt: string, options: PressurePredictionRequestOptions): Promise<string>;
}

/**
 * Named to match CLAUDE.md's Observability Framework error_class examples
 * (TimeoutError, RateLimitError, AuthError) rather than inventing a
 * parallel vocabulary.
 */
export type PredictPressureErrorClass =
  | "TimeoutError"
  | "RateLimitError"
  | "AuthError"
  | "UpstreamUnavailable"
  | "ValidationError"
  | "NoDataAvailable";

export class PredictPressureError extends Error {
  readonly errorClass: PredictPressureErrorClass;

  constructor(errorClass: PredictPressureErrorClass, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PredictPressureError";
    this.errorClass = errorClass;
  }
}
