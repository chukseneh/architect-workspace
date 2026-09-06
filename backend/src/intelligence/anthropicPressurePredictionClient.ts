import Anthropic from "@anthropic-ai/sdk";
import {
  APIConnectionTimeoutError,
  AuthenticationError,
  PermissionDeniedError,
  RateLimitError,
} from "@anthropic-ai/sdk/core/error";
import { PredictPressureError, PressurePredictionClient, PressurePredictionRequestOptions } from "./types";

/** Matches the model this prompt was authored and scored against — see prompts/predict-pressure/v1.0.0.md's header. */
const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 600;

/**
 * Real LLM backend for predict-pressure. Reads ANTHROPIC_API_KEY from the
 * environment at call time (never hardcoded, never logged — CLAUDE.md's
 * Secrets Management rule); throws immediately if it's absent rather than
 * letting the SDK produce a less obvious failure downstream.
 */
export class AnthropicPressurePredictionClient implements PressurePredictionClient {
  private readonly client: Anthropic;

  constructor(apiKey: string = requireApiKey()) {
    this.client = new Anthropic({ apiKey });
  }

  async predict(prompt: string, options: PressurePredictionRequestOptions): Promise<string> {
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
        throw new PredictPressureError("ValidationError", "Model response contained no text content block.");
      }
      return textBlock.text;
    } catch (error) {
      throw toPredictPressureError(error);
    }
  }
}

function toPredictPressureError(error: unknown): PredictPressureError {
  if (error instanceof PredictPressureError) return error;

  if (error instanceof APIConnectionTimeoutError) {
    return new PredictPressureError("TimeoutError", error.message, { cause: error });
  }
  if (error instanceof RateLimitError) {
    return new PredictPressureError("RateLimitError", error.message, { cause: error });
  }
  if (error instanceof AuthenticationError || error instanceof PermissionDeniedError) {
    return new PredictPressureError("AuthError", error.message, { cause: error });
  }
  return new PredictPressureError(
    "UpstreamUnavailable",
    error instanceof Error ? error.message : String(error),
    { cause: error },
  );
}

function requireApiKey(): string {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new PredictPressureError(
      "AuthError",
      "ANTHROPIC_API_KEY is not set. Configure it in the environment — never hardcode it in source.",
    );
  }
  return apiKey;
}
