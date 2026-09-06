import { DecisionEngineClient, DecisionEngineError, DecisionEngineRequestOptions } from "./decisionEngineTypes";

export type FakeDecisionEngineFailureMode =
  | "none"
  | "timeout"
  | "rateLimit"
  | "auth"
  | "upstreamUnavailable"
  | "malformedJson";

export interface FakeDecisionEngineClientOptions {
  /** Raw text to return on a successful call. Defaults to a valid "escalate" response. */
  response?: string;
  failureMode?: FakeDecisionEngineFailureMode;
}

const DEFAULT_RESPONSE = JSON.stringify({
  top_intervention: "call_in_additional_staff",
  expected_impact: "Medium",
  confidence: 0.75,
  rationale: "Best-matching lever unavailable; general-purpose staffing lever used instead.",
});

/**
 * Test double for DecisionEngineClient — never calls the real Anthropic
 * API. Lets tests exercise every retryable and non-retryable error class
 * without spending a real model call or depending on network access. Same
 * shape as FakePressurePredictionClient (STORY-012).
 */
export class FakeDecisionEngineClient implements DecisionEngineClient {
  public callCount = 0;
  private readonly response: string;
  private readonly failureMode: FakeDecisionEngineFailureMode;

  constructor(options: FakeDecisionEngineClientOptions = {}) {
    this.response = options.response ?? DEFAULT_RESPONSE;
    this.failureMode = options.failureMode ?? "none";
  }

  async predict(_prompt: string, _options: DecisionEngineRequestOptions): Promise<string> {
    this.callCount++;

    switch (this.failureMode) {
      case "timeout":
        throw new DecisionEngineError("TimeoutError", "Fake decision engine client timed out.");
      case "rateLimit":
        throw new DecisionEngineError("RateLimitError", "Fake decision engine client rate limited.");
      case "auth":
        throw new DecisionEngineError("AuthError", "Fake decision engine client rejected the API key.");
      case "upstreamUnavailable":
        throw new DecisionEngineError("UpstreamUnavailable", "Fake decision engine client saw a 500.");
      case "malformedJson":
        return "Sure, here's my recommendation: call in extra staff.";
      case "none":
      default:
        return this.response;
    }
  }
}
