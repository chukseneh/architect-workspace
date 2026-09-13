import { z } from "zod";

/**
 * Mirrors prompts/score-scenario-impact/v1.0.0.md's declared `inputs`
 * header exactly. That file is the single source of truth for the
 * prompt's contract; this schema exists so an invalid input is rejected
 * before spending a model call on it — see STORY-008's "scenario input
 * error" failure path.
 */
export const ScenarioSimulatorInputSchema = z.object({
  icbName: z.string().min(1),
  currentPressureLevel: z.enum(["Low", "Medium", "High", "Critical"]),
  currentPrimaryDriver: z.enum([
    "critical_care_occupancy",
    "ambulance_handover_delay",
    "discharge_delay",
    "none",
  ]),
  scenario: z.enum(["divert_ambulances", "open_surge_beds", "expedite_discharge", "call_in_additional_staff"]),
});

export type ScenarioSimulatorInput = z.infer<typeof ScenarioSimulatorInputSchema>;

/** Mirrors prompts/score-scenario-impact/v1.0.0.md's declared `output` header exactly. */
export const ScenarioSimulatorOutputSchema = z.object({
  projected_pressure_level: z.enum(["Low", "Medium", "High", "Critical"]),
  pressure_change: z.enum(["Improves", "No change", "Worsens"]),
  confidence: z.number().min(0).max(1),
  key_assumptions: z.array(z.string()),
});

export type ScenarioSimulatorOutput = z.infer<typeof ScenarioSimulatorOutputSchema>;

export interface ScenarioSimulatorRequestOptions {
  timeoutMs: number;
  signal?: AbortSignal;
}

/**
 * Contract any LLM backend for score-scenario-impact must satisfy — a real
 * Anthropic-backed client in production, a fake canned-response client in
 * tests. Returns the model's raw text reply; parsing/validating it into
 * ScenarioSimulatorOutput is scenarioSimulator.ts's job, not the client's,
 * so the client stays a thin, swappable transport — same split as
 * DecisionEngineClient/decisionEngine.ts in STORY-006.
 */
export interface ScenarioSimulatorClient {
  project(prompt: string, options: ScenarioSimulatorRequestOptions): Promise<string>;
}

/**
 * Named to match CLAUDE.md's Observability Framework error_class examples
 * (TimeoutError, RateLimitError, AuthError). InvalidInputError is distinct
 * from ValidationError: InvalidInputError means the *caller's* input failed
 * ScenarioSimulatorInputSchema and no model call is ever attempted (never
 * retried); ValidationError means the *model's* reply didn't parse into a
 * valid ScenarioSimulatorOutput (retried, since a stochastic model can
 * succeed on a second attempt).
 */
export type ScenarioSimulatorErrorClass =
  | "TimeoutError"
  | "RateLimitError"
  | "AuthError"
  | "UpstreamUnavailable"
  | "ValidationError"
  | "InvalidInputError";

export class ScenarioSimulatorError extends Error {
  readonly errorClass: ScenarioSimulatorErrorClass;

  constructor(errorClass: ScenarioSimulatorErrorClass, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ScenarioSimulatorError";
    this.errorClass = errorClass;
  }
}

/**
 * STORY-008 acceptance criterion 2: "conflicting scenario inputs... flags
 * them for review." Unlike STORY-006's "invalid input" (schema validation
 * failure), a conflict here is a *plausible-but-contradictory* pair of
 * already-valid fields — pressure_level and primary_driver disagreeing
 * about whether anything is actually driving pressure. This is a narrow,
 * deterministic check scoped to this simulator's own two fields, not the
 * general uncertainty-flagging framework STORY-009 will build; it never
 * blocks the projection, it only surfaces alongside it — same
 * "flag, don't reject" shape as dashboardSnapshot.ts's dataUncertainties.
 */
export function detectScenarioConflict(input: ScenarioSimulatorInput): string | null {
  if (input.currentPressureLevel === "Low" && input.currentPrimaryDriver !== "none") {
    return `current_pressure_level is "Low" but current_primary_driver is "${input.currentPrimaryDriver}" — a Low tier should have no active driver.`;
  }
  if (input.currentPressureLevel !== "Low" && input.currentPrimaryDriver === "none") {
    return `current_pressure_level is "${input.currentPressureLevel}" but current_primary_driver is "none" — elevated pressure should have an identified driver.`;
  }
  return null;
}
