import { DashboardClient, DashboardError, DashboardRequestOptions } from "./dashboardTypes";

export type FakeDashboardFailureMode =
  | "none"
  | "timeout"
  | "rateLimit"
  | "auth"
  | "upstreamUnavailable"
  | "malformedJson";

export interface FakeDashboardClientOptions {
  /** Raw text to return on a successful call. Defaults to a valid "Low" briefing response. */
  response?: string;
  failureMode?: FakeDashboardFailureMode;
}

const DEFAULT_RESPONSE = JSON.stringify({
  overall_status: "Low",
  status_counts: { Low: 2, Medium: 0, High: 0, Critical: 0 },
  headline: "All ICBs are calm; no action needed.",
  top_risks: [],
  recommended_actions: [],
});

/**
 * Test double for DashboardClient — never calls the real Anthropic API.
 * Lets tests exercise every retryable and non-retryable error class
 * without spending a real model call or depending on network access. Same
 * shape as FakePressurePredictionClient/FakeDecisionEngineClient.
 */
export class FakeDashboardClient implements DashboardClient {
  public callCount = 0;
  private readonly response: string;
  private readonly failureMode: FakeDashboardFailureMode;

  constructor(options: FakeDashboardClientOptions = {}) {
    this.response = options.response ?? DEFAULT_RESPONSE;
    this.failureMode = options.failureMode ?? "none";
  }

  async predict(_prompt: string, _options: DashboardRequestOptions): Promise<string> {
    this.callCount++;

    switch (this.failureMode) {
      case "timeout":
        throw new DashboardError("TimeoutError", "Fake dashboard client timed out.");
      case "rateLimit":
        throw new DashboardError("RateLimitError", "Fake dashboard client rate limited.");
      case "auth":
        throw new DashboardError("AuthError", "Fake dashboard client rejected the API key.");
      case "upstreamUnavailable":
        throw new DashboardError("UpstreamUnavailable", "Fake dashboard client saw a 500.");
      case "malformedJson":
        return "Here's the briefing: everything looks fine today.";
      case "none":
      default:
        return this.response;
    }
  }
}
