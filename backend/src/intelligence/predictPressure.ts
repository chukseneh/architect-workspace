import { NhsCentralDataRecord } from "../services/nhsCentralData/types";
import { AmbulanceInsights } from "../services/ambulance/generateAmbulanceInsights";
import { CommunityInsights } from "../services/community/generateCommunityInsights";
import { DEFAULT_TRUST_LOG_PATH, FileTrustLogger } from "../services/trustSpine/fileTrustLogger";
import { TrustLogger } from "../services/trustSpine/types";
import {
  PredictPressureError,
  PredictPressureErrorClass,
  PredictPressureInput,
  PredictPressureInputSchema,
  PredictPressureOutput,
  PredictPressureOutputSchema,
  PressurePredictionClient,
} from "./types";
import { AnthropicPressurePredictionClient } from "./anthropicPressurePredictionClient";
import { PROMPT_VERSION, renderPredictPressurePrompt } from "./predictPressurePrompt";
import { extractFirstJsonObject } from "./extractJsonObject";

const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_BACKOFF_BASE_MS = 500;

/**
 * Malformed JSON is retried too, alongside genuinely transient API errors —
 * unlike a permanently-malformed ingested record, a bad reply from a
 * stochastic model can succeed on a second attempt. AuthError and
 * NoDataAvailable are never retried: a bad API key or a genuinely absent
 * record won't fix itself on attempt 2.
 */
const RETRYABLE_ERROR_CLASSES: readonly PredictPressureErrorClass[] = [
  "TimeoutError",
  "RateLimitError",
  "UpstreamUnavailable",
  "ValidationError",
];

export interface PredictionAttemptLogEntry {
  timestamp: string;
  event: "predict_pressure_attempt";
  attempt: number;
  maxAttempts: number;
  durationMs: number;
  outcome: "success" | "failure";
  errorClass?: PredictPressureErrorClass;
  errorMessage?: string;
}

export type PredictionAttemptLogger = (entry: PredictionAttemptLogEntry) => void;

/** One structured JSON line per attempt, per CLAUDE.md's Observability Framework. */
export const consolePredictionLogger: PredictionAttemptLogger = (entry) => {
  console.log(JSON.stringify(entry));
};

export interface GeneratePressurePredictionOptions {
  /** Identifies this logical prediction run — reused on replay instead of minting a new transaction ID. */
  idempotencyKey: string;
  timeoutMs: number;
  maxAttempts?: number;
  backoffBaseMs?: number;
  /** Defaults to a real AnthropicPressurePredictionClient; inject a fake in tests. */
  client?: PressurePredictionClient;
  logger?: PredictionAttemptLogger;
  /** Defaults to a FileTrustLogger at DEFAULT_TRUST_LOG_PATH; inject a fake in tests. */
  trustLogger?: TrustLogger;
}

export type GeneratePressurePredictionResult =
  | { outcome: "success"; prediction: PredictPressureOutput; attempts: number; transactionId: string }
  | { outcome: "no_data"; transactionId: string }
  | {
      outcome: "failure";
      errorClass: PredictPressureErrorClass;
      errorMessage: string;
      attempts: number;
      transactionId: string;
    };

const DATA_SOURCES = ["nhsCentralData", "ambulance", "community"] as const;

/**
 * STORY-012's "AI intelligence layer": combines an NHS central data reading
 * for one ICB with the live ambulance and community insights (REQ-003,
 * REQ-004) into a predict-pressure call, satisfying all three of the
 * story's acceptance criteria:
 *   - data processed → enhanced insights generated (the "success" branch)
 *   - no data available → the caller is notified (the "no_data" branch,
 *     when no NHS central data record exists for this ICB at all — partial
 *     ambulance/community data is instead passed through as null fields,
 *     which the prompt itself is designed to handle without refusing)
 *   - insights generated → logged with a timestamp and data source (every
 *     branch logs to the trust spine; TrustLogEntry.timestamp is already
 *     mandatory, dataSource is added explicitly to context here)
 */
export async function generatePressurePrediction(
  nhsRecord: NhsCentralDataRecord | null,
  ambulanceInsights: AmbulanceInsights,
  communityInsights: CommunityInsights,
  options: GeneratePressurePredictionOptions,
): Promise<GeneratePressurePredictionResult> {
  const trustLogger = options.trustLogger ?? new FileTrustLogger(DEFAULT_TRUST_LOG_PATH);

  if (nhsRecord === null) {
    const { transactionId } = await trustLogger.record({
      idempotencyKey: options.idempotencyKey,
      processType: "prediction",
      processName: "generatePressurePrediction",
      outcome: "failure",
      errorClass: "NoDataAvailable",
      context: { dataSource: DATA_SOURCES, reason: "no NHS central data record available for this ICB" },
    });
    return { outcome: "no_data", transactionId };
  }

  let client: PressurePredictionClient;
  try {
    client = options.client ?? new AnthropicPressurePredictionClient();
  } catch (error) {
    const predictError = toPredictPressureError(error);
    const { transactionId } = await trustLogger.record({
      idempotencyKey: options.idempotencyKey,
      processType: "prediction",
      processName: "generatePressurePrediction",
      outcome: "failure",
      errorClass: predictError.errorClass,
      context: { dataSource: DATA_SOURCES, errorMessage: predictError.message },
    });
    return { outcome: "failure", errorClass: predictError.errorClass, errorMessage: predictError.message, attempts: 0, transactionId };
  }

  const input: PredictPressureInput = {
    icbName: nhsRecord.icbName,
    region: nhsRecord.region,
    opelLevel: nhsRecord.opelLevel,
    ambulanceHandoverOver60MinPct:
      ambulanceInsights.ambulanceHandoverOver60MinPct === null
        ? null
        : ambulanceInsights.ambulanceHandoverOver60MinPct * 100,
    dischargeDelayBeddays: communityInsights.recordCount > 0 ? communityInsights.dischargeDelayBedDays : null,
    criticalCareOccupancyPct: nhsRecord.criticalCareOccupancyPct,
    lastUpdated: nhsRecord.lastUpdated,
  };
  // Throws only on a genuine internal contract violation (e.g. an out-of-range
  // opelLevel that NhsCentralDataRecordSchema should already have rejected at
  // ingestion) — a programming bug, not a runtime failure path to model here.
  PredictPressureInputSchema.parse(input);

  const logger = options.logger ?? consolePredictionLogger;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const backoffBaseMs = options.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
  const prompt = renderPredictPressurePrompt(input);

  let lastErrorClass: PredictPressureErrorClass = "UpstreamUnavailable";
  let lastErrorMessage = "predict-pressure never attempted (maxAttempts <= 0).";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const startedAt = Date.now();

    // Narrowly scoped to just the model call and response validation, so a
    // trust-log write failure below (a completely separate operation) can
    // never be caught here and misclassified as a retryable model error —
    // the same bug STORY-011 hit and fixed in the ingestion pipelines, see
    // PROGRESS.md.
    let output: PredictPressureOutput;
    try {
      const rawText = await client.predict(prompt, { timeoutMs: options.timeoutMs });
      const parsed = extractFirstJsonObject(rawText);
      const validated = parsed === null ? undefined : PredictPressureOutputSchema.safeParse(parsed);

      if (!validated || !validated.success) {
        throw new PredictPressureError(
          "ValidationError",
          `Model reply did not contain a valid predict-pressure JSON object: ${rawText.slice(0, 200)}`,
        );
      }
      output = validated.data;
    } catch (error) {
      const predictError = toPredictPressureError(error);
      lastErrorClass = predictError.errorClass;
      lastErrorMessage = predictError.message;

      logger({
        timestamp: new Date().toISOString(),
        event: "predict_pressure_attempt",
        attempt,
        maxAttempts,
        durationMs: Date.now() - startedAt,
        outcome: "failure",
        errorClass: predictError.errorClass,
        errorMessage: predictError.message,
      });

      const isRetryable = RETRYABLE_ERROR_CLASSES.includes(predictError.errorClass);
      const attemptsRemain = attempt < maxAttempts;
      if (!isRetryable || !attemptsRemain) {
        const { transactionId } = await trustLogger.record({
          idempotencyKey: options.idempotencyKey,
          processType: "prediction",
          processName: "generatePressurePrediction",
          outcome: "failure",
          errorClass: predictError.errorClass,
          context: { dataSource: DATA_SOURCES, attempts: attempt, errorMessage: predictError.message },
        });
        return {
          outcome: "failure",
          errorClass: predictError.errorClass,
          errorMessage: predictError.message,
          attempts: attempt,
          transactionId,
        };
      }

      await sleep(backoffBaseMs * 2 ** (attempt - 1));
      continue;
    }

    // Only reached when the try block above succeeded — output is assigned.
    logger({
      timestamp: new Date().toISOString(),
      event: "predict_pressure_attempt",
      attempt,
      maxAttempts,
      durationMs: Date.now() - startedAt,
      outcome: "success",
    });

    const { transactionId } = await trustLogger.record({
      idempotencyKey: options.idempotencyKey,
      processType: "prediction",
      processName: "generatePressurePrediction",
      outcome: "success",
      context: {
        dataSource: DATA_SOURCES,
        icbName: input.icbName,
        pressureLevel: output.pressure_level,
        promptVersion: PROMPT_VERSION,
      },
    });

    return { outcome: "success", prediction: output, attempts: attempt, transactionId };
  }

  const { transactionId } = await trustLogger.record({
    idempotencyKey: options.idempotencyKey,
    processType: "prediction",
    processName: "generatePressurePrediction",
    outcome: "failure",
    errorClass: lastErrorClass,
    context: { dataSource: DATA_SOURCES, attempts: 0, errorMessage: lastErrorMessage },
  });
  return { outcome: "failure", errorClass: lastErrorClass, errorMessage: lastErrorMessage, attempts: 0, transactionId };
}

function toPredictPressureError(error: unknown): PredictPressureError {
  if (error instanceof PredictPressureError) return error;
  return new PredictPressureError("UpstreamUnavailable", error instanceof Error ? error.message : String(error), {
    cause: error,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
