import {
  ScenarioSimulatorClient,
  ScenarioSimulatorError,
  ScenarioSimulatorRequestOptions,
} from "./scenarioSimulatorTypes";

export type FakeScenarioSimulatorFailureMode =
  | "none"
  | "timeout"
  | "rateLimit"
  | "auth"
  | "upstreamUnavailable"
  | "malformedJson";

export interface FakeScenarioSimulatorClientOptions {
  /** Raw text to return on a successful call. Defaults to a valid "Improves" response. */
  response?: string;
  failureMode?: FakeScenarioSimulatorFailureMode;
}

const DEFAULT_RESPONSE = JSON.stringify({
  projected_pressure_level: "Medium",
  pressure_change: "Improves",
  confidence: 0.85,
  key_assumptions: ["scenario directly addresses the current primary driver"],
});

/**
 * Test double for ScenarioSimulatorClient — never calls the real Anthropic
 * API. Lets tests exercise every retryable and non-retryable error class
 * without spending a real model call or depending on network access. Same
 * shape as FakeDecisionEngineClient (STORY-006).
 */
export class FakeScenarioSimulatorClient implements ScenarioSimulatorClient {
  public callCount = 0;
  private readonly response: string;
  private readonly failureMode: FakeScenarioSimulatorFailureMode;

  constructor(options: FakeScenarioSimulatorClientOptions = {}) {
    this.response = options.response ?? DEFAULT_RESPONSE;
    this.failureMode = options.failureMode ?? "none";
  }

  async project(_prompt: string, _options: ScenarioSimulatorRequestOptions): Promise<string> {
    this.callCount++;

    switch (this.failureMode) {
      case "timeout":
        throw new ScenarioSimulatorError("TimeoutError", "Fake scenario simulator client timed out.");
      case "rateLimit":
        throw new ScenarioSimulatorError("RateLimitError", "Fake scenario simulator client rate limited.");
      case "auth":
        throw new ScenarioSimulatorError("AuthError", "Fake scenario simulator client rejected the API key.");
      case "upstreamUnavailable":
        throw new ScenarioSimulatorError("UpstreamUnavailable", "Fake scenario simulator client saw a 500.");
      case "malformedJson":
        return "Sure, here's my projection: pressure should improve.";
      case "none":
      default:
        return this.response;
    }
  }
}
