import { PredictPressureError, PressurePredictionClient, PressurePredictionRequestOptions } from "./types";

export type FakePressurePredictionFailureMode =
  | "none"
  | "timeout"
  | "rateLimit"
  | "auth"
  | "upstreamUnavailable"
  | "malformedJson";

export interface FakePressurePredictionClientOptions {
  /** Raw text to return on a successful call. Defaults to a valid "Low" response. */
  response?: string;
  failureMode?: FakePressurePredictionFailureMode;
}

const DEFAULT_RESPONSE = JSON.stringify({
  pressure_level: "Low",
  confidence: 0.9,
  horizon: "4-24h",
  contributing_factors: ["OPEL level 1", "all metrics nominal"],
});

/**
 * Test double for PressurePredictionClient — never calls the real Anthropic
 * API. Lets tests exercise every retryable and non-retryable error class
 * without spending a real model call or depending on network access.
 */
export class FakePressurePredictionClient implements PressurePredictionClient {
  public callCount = 0;
  private readonly response: string;
  private readonly failureMode: FakePressurePredictionFailureMode;

  constructor(options: FakePressurePredictionClientOptions = {}) {
    this.response = options.response ?? DEFAULT_RESPONSE;
    this.failureMode = options.failureMode ?? "none";
  }

  async predict(_prompt: string, _options: PressurePredictionRequestOptions): Promise<string> {
    this.callCount++;

    switch (this.failureMode) {
      case "timeout":
        throw new PredictPressureError("TimeoutError", "Fake predict-pressure client timed out.");
      case "rateLimit":
        throw new PredictPressureError("RateLimitError", "Fake predict-pressure client rate limited.");
      case "auth":
        throw new PredictPressureError("AuthError", "Fake predict-pressure client rejected the API key.");
      case "upstreamUnavailable":
        throw new PredictPressureError("UpstreamUnavailable", "Fake predict-pressure client saw a 500.");
      case "malformedJson":
        return "Sure, here is my analysis: the system looks fine overall.";
      case "none":
      default:
        return this.response;
    }
  }
}
