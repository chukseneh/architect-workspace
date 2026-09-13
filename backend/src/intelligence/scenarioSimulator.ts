import { DEFAULT_TRUST_LOG_PATH, FileTrustLogger } from "../services/trustSpine/fileTrustLogger";
import { TrustLogger } from "../services/trustSpine/types";
import {
  ScenarioSimulatorClient,
  ScenarioSimulatorError,
  ScenarioSimulatorErrorClass,
  ScenarioSimulatorInput,
  ScenarioSimulatorInputSchema,
  ScenarioSimulatorOutput,
  ScenarioSimulatorOutputSchema,
  detectScenarioConflict,
} from "./scenarioSimulatorTypes";
import { AnthropicScenarioSimulatorClient } from "./anthropicScenarioSimulatorClient";
import { PROMPT_VERSION, renderScoreScenarioImpactPrompt } from "./scoreScenarioImpactPrompt";
import { extractFirstJsonObject } from "./extractJsonObject";

/** Same default as decisionEngine.ts's makeDecision — no story-specific timing requirement here, so this reuses the established norm rather than inventing a new one. */
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_BACKOFF_BASE_MS = 500;

/**
 * A malformed model reply is retried alongside genuinely transient API
 * errors — a stochastic model can succeed on a second attempt. AuthError
 * and InvalidInputError are never retried: a bad API key or a caller input
 * that already failed schema validation won't fix itself on attempt 2.
 * Same set as decisionEngine.ts's RETRYABLE_ERROR_CLASSES.
 */
const RETRYABLE_ERROR_CLASSES: readonly ScenarioSimulatorErrorClass[] = [
  "TimeoutError",
  "RateLimitError",
  "UpstreamUnavailable",
  "ValidationError",
];

export interface ScenarioAttemptLogEntry {
  timestamp: string;
  event: "scenario_simulator_attempt";
  attempt: number;
  maxAttempts: number;
  durationMs: number;
  outcome: "success" | "failure";
  errorClass?: ScenarioSimulatorErrorClass;
  errorMessage?: string;
}

export type ScenarioAttemptLogger = (entry: ScenarioAttemptLogEntry) => void;

/** One structured JSON line per attempt, per CLAUDE.md's Observability Framework. */
export const consoleScenarioLogger: ScenarioAttemptLogger = (entry) => {
  console.log(JSON.stringify(entry));
};

export interface SimulateScenarioOptions {
  /** Identifies this logical simulation run — reused on replay instead of minting a new transaction ID. */
  idempotencyKey: string;
  /** Defaults to 5000ms. */
  timeoutMs?: number;
  maxAttempts?: number;
  backoffBaseMs?: number;
  /** Defaults to a real AnthropicScenarioSimulatorClient; inject a fake in tests. */
  client?: ScenarioSimulatorClient;
  logger?: ScenarioAttemptLogger;
  /** Defaults to a FileTrustLogger at DEFAULT_TRUST_LOG_PATH; inject a fake in tests. */
  trustLogger?: TrustLogger;
}

export type SimulateScenarioResult =
  | {
      /** STORY-008 acceptance criterion 1: the simulator forecasts the impact. */
      outcome: "success";
      projection: ScenarioSimulatorOutput;
      /** STORY-008 acceptance criterion 2: conflicting inputs are flagged, not rejected — this is always [] unless detectScenarioConflict found something. */
      conflictFlags: string[];
      attempts: number;
      transactionId: string;
    }
  | {
      /** STORY-008's "scenario input error" failure path: invalid input returns an error, no model call attempted. */
      outcome: "invalid_input";
      errorMessage: string;
      transactionId: string;
    }
  | {
      outcome: "failure";
      errorClass: ScenarioSimulatorErrorClass;
      errorMessage: string;
      attempts: number;
      transactionId: string;
    };

/**
 * STORY-008's AI What-If Simulator: validates the caller's scenario
 * parameters, flags plausibility conflicts between pressure_level and
 * primary_driver without blocking the projection, calls score-scenario-impact
 * (already scored 1.00 in eval) with a 5-second default timeout, and
 * trust-logs every branch with the scenario parameters and any conflict
 * flags explicit in context — satisfying all three acceptance criteria.
 * `rawInput` is accepted as `unknown` rather than a typed
 * `ScenarioSimulatorInput` specifically so "scenario input error" is a real,
 * tested runtime path rather than only a compile-time contract.
 */
export async function simulateScenario(
  rawInput: unknown,
  options: SimulateScenarioOptions,
): Promise<SimulateScenarioResult> {
  const trustLogger = options.trustLogger ?? new FileTrustLogger(DEFAULT_TRUST_LOG_PATH);

  const parsedInput = ScenarioSimulatorInputSchema.safeParse(rawInput);
  if (!parsedInput.success) {
    const { transactionId } = await trustLogger.record({
      idempotencyKey: options.idempotencyKey,
      processType: "prediction",
      processName: "simulateScenario",
      outcome: "failure",
      errorClass: "InvalidInputError",
      context: { scenarioParameters: rawInput, validationError: parsedInput.error.message },
    });
    return {
      outcome: "invalid_input",
      errorMessage: `Invalid scenario simulator input: ${parsedInput.error.message}`,
      transactionId,
    };
  }
  const input: ScenarioSimulatorInput = parsedInput.data;
  const conflictFlags: string[] = [];
  const conflict = detectScenarioConflict(input);
  if (conflict !== null) {
    conflictFlags.push(conflict);
  }

  let client: ScenarioSimulatorClient;
  try {
    client = options.client ?? new AnthropicScenarioSimulatorClient();
  } catch (error) {
    const simError = toScenarioSimulatorError(error);
    const { transactionId } = await trustLogger.record({
      idempotencyKey: options.idempotencyKey,
      processType: "prediction",
      processName: "simulateScenario",
      outcome: "failure",
      errorClass: simError.errorClass,
      context: { scenarioParameters: input, conflictFlags, errorMessage: simError.message },
    });
    return {
      outcome: "failure",
      errorClass: simError.errorClass,
      errorMessage: simError.message,
      attempts: 0,
      transactionId,
    };
  }

  const logger = options.logger ?? consoleScenarioLogger;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const backoffBaseMs = options.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const prompt = renderScoreScenarioImpactPrompt(input);

  let lastErrorClass: ScenarioSimulatorErrorClass = "UpstreamUnavailable";
  let lastErrorMessage = "score-scenario-impact never attempted (maxAttempts <= 0).";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const startedAt = Date.now();

    // Narrowly scoped to just the model call and response validation, so a
    // trust-log write failure below can never be caught here and
    // misclassified as a retryable model error — the bug STORY-011/012/006
    // all hit and fixed the same way.
    let projection: ScenarioSimulatorOutput;
    try {
      const rawText = await client.project(prompt, { timeoutMs });
      const parsed = extractFirstJsonObject(rawText);
      const validated = parsed === null ? undefined : ScenarioSimulatorOutputSchema.safeParse(parsed);

      if (!validated || !validated.success) {
        throw new ScenarioSimulatorError(
          "ValidationError",
          `Model reply did not contain a valid score-scenario-impact JSON object: ${rawText.slice(0, 200)}`,
        );
      }
      projection = validated.data;
    } catch (error) {
      const simError = toScenarioSimulatorError(error);
      lastErrorClass = simError.errorClass;
      lastErrorMessage = simError.message;

      logger({
        timestamp: new Date().toISOString(),
        event: "scenario_simulator_attempt",
        attempt,
        maxAttempts,
        durationMs: Date.now() - startedAt,
        outcome: "failure",
        errorClass: simError.errorClass,
        errorMessage: simError.message,
      });

      const isRetryable = RETRYABLE_ERROR_CLASSES.includes(simError.errorClass);
      const attemptsRemain = attempt < maxAttempts;
      if (!isRetryable || !attemptsRemain) {
        const { transactionId } = await trustLogger.record({
          idempotencyKey: options.idempotencyKey,
          processType: "prediction",
          processName: "simulateScenario",
          outcome: "failure",
          errorClass: simError.errorClass,
          context: { scenarioParameters: input, conflictFlags, attempts: attempt, errorMessage: simError.message },
        });
        return {
          outcome: "failure",
          errorClass: simError.errorClass,
          errorMessage: simError.message,
          attempts: attempt,
          transactionId,
        };
      }

      await sleep(backoffBaseMs * 2 ** (attempt - 1));
      continue;
    }

    // Only reached when the try block above succeeded — projection is assigned.
    logger({
      timestamp: new Date().toISOString(),
      event: "scenario_simulator_attempt",
      attempt,
      maxAttempts,
      durationMs: Date.now() - startedAt,
      outcome: "success",
    });

    const { transactionId } = await trustLogger.record({
      idempotencyKey: options.idempotencyKey,
      processType: "prediction",
      processName: "simulateScenario",
      outcome: "success",
      context: {
        scenarioParameters: input,
        conflictFlags,
        projectedPressureLevel: projection.projected_pressure_level,
        promptVersion: PROMPT_VERSION,
      },
    });

    return { outcome: "success", projection, conflictFlags, attempts: attempt, transactionId };
  }

  const { transactionId } = await trustLogger.record({
    idempotencyKey: options.idempotencyKey,
    processType: "prediction",
    processName: "simulateScenario",
    outcome: "failure",
    errorClass: lastErrorClass,
    context: { scenarioParameters: input, conflictFlags, attempts: 0, errorMessage: lastErrorMessage },
  });
  return {
    outcome: "failure",
    errorClass: lastErrorClass,
    errorMessage: lastErrorMessage,
    attempts: 0,
    transactionId,
  };
}

function toScenarioSimulatorError(error: unknown): ScenarioSimulatorError {
  if (error instanceof ScenarioSimulatorError) return error;
  return new ScenarioSimulatorError("UpstreamUnavailable", error instanceof Error ? error.message : String(error), {
    cause: error,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
