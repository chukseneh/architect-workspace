import Anthropic from "@anthropic-ai/sdk";
import {
  APIConnectionTimeoutError,
  AuthenticationError,
  PermissionDeniedError,
  RateLimitError,
} from "@anthropic-ai/sdk/core/error";
import { DecisionEngineClient, DecisionEngineError, DecisionEngineRequestOptions } from "./decisionEngineTypes";

/** Matches the model this prompt was authored and scored against — see prompts/recommend-intervention/v1.1.0.md's header. */
const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 600;

/**
 * Real LLM backend for recommend-intervention. Reads ANTHROPIC_API_KEY from
 * the environment at call time (never hardcoded, never logged — CLAUDE.md's
 * Secrets Management rule); throws immediately if it's absent rather than
 * letting the SDK produce a less obvious failure downstream. Same shape as
 * AnthropicPressurePredictionClient (STORY-012) — kept as a separate class
 * rather than a shared generic client, matching this codebase's existing
 * convention of one client per prompt (see gpPms/nhsCentralData's separate
 * client implementations); worth extracting if a third prompt needs the
 * same wrapper.
 */
export class AnthropicDecisionEngineClient implements DecisionEngineClient {
  private readonly client: Anthropic;

  constructor(apiKey: string = requireApiKey()) {
    this.client = new Anthropic({ apiKey });
  }

  async predict(prompt: string, options: DecisionEngineRequestOptions): Promise<string> {
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
        throw new DecisionEngineError("ValidationError", "Model response contained no text content block.");
      }
      return textBlock.text;
    } catch (error) {
      throw toDecisionEngineError(error);
    }
  }
}

function toDecisionEngineError(error: unknown): DecisionEngineError {
  if (error instanceof DecisionEngineError) return error;

  if (error instanceof APIConnectionTimeoutError) {
    return new DecisionEngineError("TimeoutError", error.message, { cause: error });
  }
  if (error instanceof RateLimitError) {
    return new DecisionEngineError("RateLimitError", error.message, { cause: error });
  }
  if (error instanceof AuthenticationError || error instanceof PermissionDeniedError) {
    return new DecisionEngineError("AuthError", error.message, { cause: error });
  }
  return new DecisionEngineError(
    "UpstreamUnavailable",
    error instanceof Error ? error.message : String(error),
    { cause: error },
  );
}

function requireApiKey(): string {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new DecisionEngineError(
      "AuthError",
      "ANTHROPIC_API_KEY is not set. Configure it in the environment — never hardcode it in source.",
    );
  }
  return apiKey;
}
