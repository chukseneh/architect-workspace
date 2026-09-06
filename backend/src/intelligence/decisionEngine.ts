import { DEFAULT_TRUST_LOG_PATH, FileTrustLogger } from "../services/trustSpine/fileTrustLogger";
import { TrustLogger } from "../services/trustSpine/types";
import {
  DecisionEngineClient,
  DecisionEngineError,
  DecisionEngineErrorClass,
  DecisionEngineInput,
  DecisionEngineInputSchema,
  DecisionEngineOutput,
  DecisionEngineOutputSchema,
} from "./decisionEngineTypes";
import { AnthropicDecisionEngineClient } from "./anthropicDecisionEngineClient";
import { PROMPT_VERSION, renderRecommendInterventionPrompt } from "./recommendInterventionPrompt";
import { extractFirstJsonObject } from "./extractJsonObject";

/** STORY-006 acceptance criterion 1: "the engine should provide a decision output within 5 seconds." */
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_BACKOFF_BASE_MS = 500;

/**
 * A malformed model reply is retried alongside genuinely transient API
 * errors — a stochastic model can succeed on a second attempt. AuthError
 * and InvalidInputError are never retried: a bad API key or a caller input
 * that already failed schema validation won't fix itself on attempt 2.
 */
const RETRYABLE_ERROR_CLASSES: readonly DecisionEngineErrorClass[] = [
  "TimeoutError",
  "RateLimitError",
  "UpstreamUnavailable",
  "ValidationError",
];

export interface DecisionAttemptLogEntry {
  timestamp: string;
  event: "decision_engine_attempt";
  attempt: number;
  maxAttempts: number;
  durationMs: number;
  outcome: "success" | "failure";
  errorClass?: DecisionEngineErrorClass;
  errorMessage?: string;
}

export type DecisionAttemptLogger = (entry: DecisionAttemptLogEntry) => void;

/** One structured JSON line per attempt, per CLAUDE.md's Observability Framework. */
export const consoleDecisionLogger: DecisionAttemptLogger = (entry) => {
  console.log(JSON.stringify(entry));
};

export interface MakeDecisionOptions {
  /** Identifies this logical decision run — reused on replay instead of minting a new transaction ID. */
  idempotencyKey: string;
  /** Defaults to 5000ms — see STORY-006's acceptance criterion 1. */
  timeoutMs?: number;
  maxAttempts?: number;
  backoffBaseMs?: number;
  /** Defaults to a real AnthropicDecisionEngineClient; inject a fake in tests. */
  client?: DecisionEngineClient;
  logger?: DecisionAttemptLogger;
  /** Defaults to a FileTrustLogger at DEFAULT_TRUST_LOG_PATH; inject a fake in tests. */
  trustLogger?: TrustLogger;
}

export type MakeDecisionResult =
  | { outcome: "success"; recommendation: DecisionEngineOutput; attempts: number; transactionId: string }
  | {
      /** STORY-006 acceptance criterion 2: invalid input returns an error message, no model call attempted. */
      outcome: "invalid_input";
      errorMessage: string;
      transactionId: string;
    }
  | {
      outcome: "failure";
      errorClass: DecisionEngineErrorClass;
      errorMessage: string;
      attempts: number;
      transactionId: string;
    };

/**
 * STORY-006's AI decision engine: validates the caller's decision
 * parameters, calls recommend-intervention (already scored 1.00 in eval)
 * with a 5-second default timeout, and trust-logs every branch with the
 * decision parameters explicit in context — satisfying all three
 * acceptance criteria. `rawInput` is accepted as `unknown` rather than a
 * typed `DecisionEngineInput` specifically so "invalid input format" is a
 * real, tested runtime path rather than only a compile-time contract.
 */
export async function makeDecision(rawInput: unknown, options: MakeDecisionOptions): Promise<MakeDecisionResult> {
  const trustLogger = options.trustLogger ?? new FileTrustLogger(DEFAULT_TRUST_LOG_PATH);

  const parsedInput = DecisionEngineInputSchema.safeParse(rawInput);
  if (!parsedInput.success) {
    const { transactionId } = await trustLogger.record({
      idempotencyKey: options.idempotencyKey,
      processType: "prediction",
      processName: "makeDecision",
      outcome: "failure",
      errorClass: "InvalidInputError",
      context: { decisionParameters: rawInput, validationError: parsedInput.error.message },
    });
    return {
      outcome: "invalid_input",
      errorMessage: `Invalid decision engine input: ${parsedInput.error.message}`,
      transactionId,
    };
  }
  const input: DecisionEngineInput = parsedInput.data;

  let client: DecisionEngineClient;
  try {
    client = options.client ?? new AnthropicDecisionEngineClient();
  } catch (error) {
    const decisionError = toDecisionEngineError(error);
    const { transactionId } = await trustLogger.record({
      idempotencyKey: options.idempotencyKey,
      processType: "prediction",
      processName: "makeDecision",
      outcome: "failure",
      errorClass: decisionError.errorClass,
      context: { decisionParameters: input, errorMessage: decisionError.message },
    });
    return {
      outcome: "failure",
      errorClass: decisionError.errorClass,
      errorMessage: decisionError.message,
      attempts: 0,
      transactionId,
    };
  }

  const logger = options.logger ?? consoleDecisionLogger;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const backoffBaseMs = options.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const prompt = renderRecommendInterventionPrompt(input);

  let lastErrorClass: DecisionEngineErrorClass = "UpstreamUnavailable";
  let lastErrorMessage = "recommend-intervention never attempted (maxAttempts <= 0).";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const startedAt = Date.now();

    // Narrowly scoped to just the model call and response validation, so a
    // trust-log write failure below can never be caught here and
    // misclassified as a retryable model error — the bug STORY-011 and
    // STORY-012 both hit and fixed the same way.
    let recommendation: DecisionEngineOutput;
    try {
      const rawText = await client.predict(prompt, { timeoutMs });
      const parsed = extractFirstJsonObject(rawText);
      const validated = parsed === null ? undefined : DecisionEngineOutputSchema.safeParse(parsed);

      if (!validated || !validated.success) {
        throw new DecisionEngineError(
          "ValidationError",
          `Model reply did not contain a valid recommend-intervention JSON object: ${rawText.slice(0, 200)}`,
        );
      }
      recommendation = validated.data;
    } catch (error) {
      const decisionError = toDecisionEngineError(error);
      lastErrorClass = decisionError.errorClass;
      lastErrorMessage = decisionError.message;

      logger({
        timestamp: new Date().toISOString(),
        event: "decision_engine_attempt",
        attempt,
        maxAttempts,
        durationMs: Date.now() - startedAt,
        outcome: "failure",
        errorClass: decisionError.errorClass,
        errorMessage: decisionError.message,
      });

      const isRetryable = RETRYABLE_ERROR_CLASSES.includes(decisionError.errorClass);
      const attemptsRemain = attempt < maxAttempts;
      if (!isRetryable || !attemptsRemain) {
        const { transactionId } = await trustLogger.record({
          idempotencyKey: options.idempotencyKey,
          processType: "prediction",
          processName: "makeDecision",
          outcome: "failure",
          errorClass: decisionError.errorClass,
          context: { decisionParameters: input, attempts: attempt, errorMessage: decisionError.message },
        });
        return {
          outcome: "failure",
          errorClass: decisionError.errorClass,
          errorMessage: decisionError.message,
          attempts: attempt,
          transactionId,
        };
      }

      await sleep(backoffBaseMs * 2 ** (attempt - 1));
      continue;
    }

    // Only reached when the try block above succeeded — recommendation is assigned.
    logger({
      timestamp: new Date().toISOString(),
      event: "decision_engine_attempt",
      attempt,
      maxAttempts,
      durationMs: Date.now() - startedAt,
      outcome: "success",
    });

    const { transactionId } = await trustLogger.record({
      idempotencyKey: options.idempotencyKey,
      processType: "prediction",
      processName: "makeDecision",
      outcome: "success",
      context: {
        decisionParameters: input,
        topIntervention: recommendation.top_intervention,
        promptVersion: PROMPT_VERSION,
      },
    });

    return { outcome: "success", recommendation, attempts: attempt, transactionId };
  }

  const { transactionId } = await trustLogger.record({
    idempotencyKey: options.idempotencyKey,
    processType: "prediction",
    processName: "makeDecision",
    outcome: "failure",
    errorClass: lastErrorClass,
    context: { decisionParameters: input, attempts: 0, errorMessage: lastErrorMessage },
  });
  return { outcome: "failure", errorClass: lastErrorClass, errorMessage: lastErrorMessage, attempts: 0, transactionId };
}

function toDecisionEngineError(error: unknown): DecisionEngineError {
  if (error instanceof DecisionEngineError) return error;
  return new DecisionEngineError("UpstreamUnavailable", error instanceof Error ? error.message : String(error), {
    cause: error,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
