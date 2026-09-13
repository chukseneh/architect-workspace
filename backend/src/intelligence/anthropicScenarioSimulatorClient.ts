import Anthropic from "@anthropic-ai/sdk";
import {
  APIConnectionTimeoutError,
  AuthenticationError,
  PermissionDeniedError,
  RateLimitError,
} from "@anthropic-ai/sdk/core/error";
import {
  ScenarioSimulatorClient,
  ScenarioSimulatorError,
  ScenarioSimulatorRequestOptions,
} from "./scenarioSimulatorTypes";

/** Matches the model this prompt was authored and scored against — see prompts/score-scenario-impact/v1.0.0.md's header. */
const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 600;

/**
 * Real LLM backend for score-scenario-impact. Reads ANTHROPIC_API_KEY from
 * the environment at call time (never hardcoded, never logged — CLAUDE.md's
 * Secrets Management rule); throws immediately if it's absent rather than
 * letting the SDK produce a less obvious failure downstream. Same shape as
 * AnthropicDecisionEngineClient (STORY-006) — kept as a separate class
 * rather than a shared generic client, matching this codebase's existing
 * one-client-per-prompt convention.
 */
export class AnthropicScenarioSimulatorClient implements ScenarioSimulatorClient {
  private readonly client: Anthropic;

  constructor(apiKey: string = requireApiKey()) {
    this.client = new Anthropic({ apiKey });
  }

  async project(prompt: string, options: ScenarioSimulatorRequestOptions): Promise<string> {
    try {
      const response = await this.client.messages.create(
        {
          model: MODEL,
          max_tokens: MAX_TOKENS,
          messages: [{ role: "user", content: prompt }],
        },
        { timeout: options.timeoutMs, signal: options.signal },
      );

      const textBlock = response.content.find((block) => block.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new ScenarioSimulatorError("ValidationError", "Model response contained no text content block.");
      }
      return textBlock.text;
    } catch (error) {
      throw toScenarioSimulatorError(error);
    }
  }
}

function toScenarioSimulatorError(error: unknown): ScenarioSimulatorError {
  if (error instanceof ScenarioSimulatorError) return error;

  if (error instanceof APIConnectionTimeoutError) {
    return new ScenarioSimulatorError("TimeoutError", error.message, { cause: error });
  }
  if (error instanceof RateLimitError) {
    return new ScenarioSimulatorError("RateLimitError", error.message, { cause: error });
  }
  if (error instanceof AuthenticationError || error instanceof PermissionDeniedError) {
    return new ScenarioSimulatorError("AuthError", error.message, { cause: error });
  }
  return new ScenarioSimulatorError(
    "UpstreamUnavailable",
    error instanceof Error ? error.message : String(error),
    { cause: error },
  );
}

function requireApiKey(): string {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new ScenarioSimulatorError(
      "AuthError",
      "ANTHROPIC_API_KEY is not set. Configure it in the environment — never hardcode it in source.",
    );
  }
  return apiKey;
}
