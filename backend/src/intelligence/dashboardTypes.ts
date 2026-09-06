import { z } from "zod";

/**
 * One ICB's row in the dashboard — "current" (currentOpelLevel, from NHS
 * central data / STORY-002) and "forecasted" (forecastedPressureLevel, from
 * predict-pressure / STORY-012) side by side, satisfying REQ-016's "current
 * and forecasted operational metrics" in one record.
 *
 * forecastedPressureLevel is deliberately a loose non-empty string, not the
 * strict "Low" | "Medium" | "High" | "Critical" enum — a malformed value
 * here must flow through to draft-leadership-briefing's own "Malformed
 * entry" rule (which treats it as Critical and names the ICB, rather than
 * silently dropping it) instead of being rejected before it gets there.
 * That graceful path is what this story's "incomplete data → flag for
 * review" acceptance criterion is actually testing.
 */
export const IcbDashboardEntrySchema = z.object({
  icbName: z.string().min(1),
  currentOpelLevel: z.number().int().min(1).max(4),
  forecastedPressureLevel: z.string().min(1),
});

export type IcbDashboardEntry = z.infer<typeof IcbDashboardEntrySchema>;

/** Mirrors prompts/draft-leadership-briefing/v1.0.0.md's declared `output` header exactly. */
export const DraftLeadershipBriefingOutputSchema = z.object({
  overall_status: z.enum(["Low", "Medium", "High", "Critical"]),
  status_counts: z.object({
    Low: z.number().int().min(0),
    Medium: z.number().int().min(0),
    High: z.number().int().min(0),
    Critical: z.number().int().min(0),
  }),
  headline: z.string().min(1),
  top_risks: z.array(z.string()),
  recommended_actions: z.array(z.string()),
});

export type DraftLeadershipBriefingOutput = z.infer<typeof DraftLeadershipBriefingOutputSchema>;

export interface DashboardRequestOptions {
  timeoutMs: number;
  signal?: AbortSignal;
}

/**
 * Contract any LLM backend for draft-leadership-briefing must satisfy — a
 * real Anthropic-backed client in production, a fake canned-response client
 * in tests. Same split as PressurePredictionClient/DecisionEngineClient:
 * the client is a thin, swappable transport, and parsing/validating its
 * reply into DraftLeadershipBriefingOutput is dashboardSnapshot.ts's job.
 */
export interface DashboardClient {
  predict(prompt: string, options: DashboardRequestOptions): Promise<string>;
}

/**
 * Named to match CLAUDE.md's Observability Framework error_class examples.
 * No InvalidInputError here (unlike STORY-006's DecisionEngineErrorClass):
 * this story has no "reject malformed input" acceptance criterion —
 * incomplete/malformed ICB data is meant to be gracefully flagged, not
 * rejected, per the prompt's own designed fail-safe behavior.
 */
export type DashboardErrorClass =
  | "TimeoutError"
  | "RateLimitError"
  | "AuthError"
  | "UpstreamUnavailable"
  | "ValidationError";

export class DashboardError extends Error {
  readonly errorClass: DashboardErrorClass;

  constructor(errorClass: DashboardErrorClass, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DashboardError";
    this.errorClass = errorClass;
  }
}
