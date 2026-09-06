import Anthropic from "@anthropic-ai/sdk";
import {
  APIConnectionTimeoutError,
  AuthenticationError,
  PermissionDeniedError,
  RateLimitError,
} from "@anthropic-ai/sdk/core/error";
import { DashboardClient, DashboardError, DashboardRequestOptions } from "./dashboardTypes";

/** Matches the model this prompt was authored and scored against — see prompts/draft-leadership-briefing/v1.0.0.md's header. */
const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 600;

/**
 * Real LLM backend for draft-leadership-briefing. Reads ANTHROPIC_API_KEY
 * from the environment at call time (never hardcoded, never logged —
 * CLAUDE.md's Secrets Management rule); throws immediately if it's absent
 * rather than letting the SDK produce a less obvious failure downstream.
 * Same shape as AnthropicPressurePredictionClient/AnthropicDecisionEngineClient
 * — kept as a separate class per this codebase's existing one-client-per-prompt
 * convention; worth extracting once a fourth prompt needs the same wrapper.
 */
export class AnthropicDashboardClient implements DashboardClient {
  private readonly client: Anthropic;

  constructor(apiKey: string = requireApiKey()) {
    this.client = new Anthropic({ apiKey });
  }

  async predict(prompt: string, options: DashboardRequestOptions): Promise<string> {
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
        throw new DashboardError("ValidationError", "Model response contained no text content block.");
      }
      return textBlock.text;
    } catch (error) {
      throw toDashboardError(error);
    }
  }
}

function toDashboardError(error: unknown): DashboardError {
  if (error instanceof DashboardError) return error;

  if (error instanceof APIConnectionTimeoutError) {
    return new DashboardError("TimeoutError", error.message, { cause: error });
  }
  if (error instanceof RateLimitError) {
    return new DashboardError("RateLimitError", error.message, { cause: error });
  }
  if (error instanceof AuthenticationError || error instanceof PermissionDeniedError) {
    return new DashboardError("AuthError", error.message, { cause: error });
  }
  return new DashboardError("UpstreamUnavailable", error instanceof Error ? error.message : String(error), {
    cause: error,
  });
}

function requireApiKey(): string {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new DashboardError(
      "AuthError",
      "ANTHROPIC_API_KEY is not set. Configure it in the environment — never hardcode it in source.",
    );
  }
  return apiKey;
}
