import { DEFAULT_TRUST_LOG_PATH, FileTrustLogger } from "../trustSpine/fileTrustLogger";
import { TrustLogger } from "../trustSpine/types";
import {
  DataRecord,
  DataRecordSchema,
  DataUncertaintyDetector,
  UncertaintyFlagResult,
} from "./types";
import { detectDataUncertainty } from "./detectDataUncertainty";

/** Generous for a pure, synchronous check -- exists so a future I/O-backed detector has a real budget to enforce against, per this story's "data processing delay" failure path. */
const DEFAULT_TIMEOUT_MS = 1000;

export interface FlagForReviewOptions {
  /** Identifies this logical flagging run -- reused on replay instead of minting a new transaction ID. */
  idempotencyKey: string;
  timeoutMs?: number;
  /** Defaults to detectDataUncertainty; inject a throwing/slow implementation in tests to exercise the fail-safe paths. */
  detector?: DataUncertaintyDetector;
  /** Defaults to a FileTrustLogger at DEFAULT_TRUST_LOG_PATH; inject a fake in tests. */
  trustLogger?: TrustLogger;
}

export type FlagForReviewResult =
  | {
      /** STORY-009's "flagging mechanism failure" failure path, cleanest form: rejected before any evaluation was attempted. */
      outcome: "invalid_input";
      errorMessage: string;
      transactionId: string;
    }
  | {
      outcome: "success";
      result: UncertaintyFlagResult;
      /** True when the detector itself failed or timed out and this result is the fail-safe default, not a real evaluation. */
      mechanismFailure: boolean;
      transactionId: string;
    };

/**
 * STORY-009's data uncertainty flagging mechanism: validates the incoming
 * record, runs the deterministic detector under a timeout budget, and
 * trust-logs every flagging activity -- satisfying all three acceptance
 * criteria. Fail-safe by design: if the detector throws or exceeds its
 * budget, the record is flagged for review rather than silently passed
 * through -- an unresolved check is itself a form of uncertainty, same
 * philosophy as classify-metric-status's "default to the most severe
 * status, never a falsely-calm one." A trust-log write failure is the one
 * place this still fails loud (throws), matching every prior story's
 * precedent -- losing the audit trail is treated as worse than losing this
 * run's result, which a retry would redo anyway.
 */
export async function flagForReview(rawInput: unknown, options: FlagForReviewOptions): Promise<FlagForReviewResult> {
  const trustLogger = options.trustLogger ?? new FileTrustLogger(DEFAULT_TRUST_LOG_PATH);

  const parsedInput = DataRecordSchema.safeParse(rawInput);
  if (!parsedInput.success) {
    const { transactionId } = await trustLogger.record({
      idempotencyKey: options.idempotencyKey,
      processType: "prediction",
      processName: "flagForReview",
      outcome: "failure",
      errorClass: "InvalidInputError",
      context: { record: rawInput, validationError: parsedInput.error.message },
    });
    return {
      outcome: "invalid_input",
      errorMessage: `Invalid data record: ${parsedInput.error.message}`,
      transactionId,
    };
  }
  const record: DataRecord = parsedInput.data;
  const detector = options.detector ?? detectDataUncertainty;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const { result, mechanismFailure, errorClass, errorMessage } = await evaluateWithFailSafe(detector, record, timeoutMs);

  const { transactionId } = await trustLogger.record({
    idempotencyKey: options.idempotencyKey,
    processType: "prediction",
    processName: "flagForReview",
    outcome: mechanismFailure ? "failure" : "success",
    errorClass,
    context: {
      record,
      uncertain: result.uncertain,
      category: result.category,
      mechanismFailure,
      ...(errorMessage ? { errorMessage } : {}),
    },
  });

  return { outcome: "success", result, mechanismFailure, transactionId };
}

async function evaluateWithFailSafe(
  detector: DataUncertaintyDetector,
  record: DataRecord,
  timeoutMs: number,
): Promise<{
  result: UncertaintyFlagResult;
  mechanismFailure: boolean;
  errorClass?: "FlagEvaluationError" | "TimeoutError";
  errorMessage?: string;
}> {
  let timeoutHandle: NodeJS.Timeout | undefined;
  try {
    const detectorPromise = Promise.resolve().then(() => detector(record));
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error(`Detector did not respond within ${timeoutMs}ms.`)), timeoutMs);
    });

    const result = await Promise.race([detectorPromise, timeoutPromise]);
    return { result, mechanismFailure: false };
  } catch (error) {
    const isTimeout = error instanceof Error && error.message.includes("did not respond within");
    return {
      result: {
        uncertain: true,
        category: "malformed_input",
        confidenceScore: 0,
        reason: isTimeout
          ? "The flagging mechanism did not respond in time, so this record is flagged for review rather than assumed safe."
          : "The flagging mechanism failed unexpectedly, so this record is flagged for review rather than assumed safe.",
      },
      mechanismFailure: true,
      errorClass: isTimeout ? "TimeoutError" : "FlagEvaluationError",
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}
