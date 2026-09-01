import {
  GpPmsClient,
  GpPmsError,
  GpPmsErrorClass,
  GpPmsFetchOptions,
  GpPmsRecord,
} from "./types";
import { DEFAULT_TRUST_LOG_PATH, FileTrustLogger } from "../trustSpine/fileTrustLogger";
import { TrustLogger } from "../trustSpine/types";

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BACKOFF_BASE_MS = 100;

/** Format mismatches are never retried — retrying a data-shape problem cannot fix it. */
const RETRYABLE_ERROR_CLASSES: readonly GpPmsErrorClass[] = ["ConnectionError", "TimeoutError"];

export interface IngestionLogEntry {
  timestamp: string;
  event: "gp_pms_ingestion_attempt";
  attempt: number;
  maxAttempts: number;
  durationMs: number;
  outcome: "success" | "failure";
  recordCount?: number;
  errorClass?: GpPmsErrorClass;
  errorMessage?: string;
}

export type IngestionLogger = (entry: IngestionLogEntry) => void;

/** One structured JSON line per attempt, per CLAUDE.md's Observability Framework. */
export const consoleIngestionLogger: IngestionLogger = (entry) => {
  console.log(JSON.stringify(entry));
};

export interface IngestGpPmsRecordsOptions extends GpPmsFetchOptions {
  /**
   * Identifies this logical ingestion run (e.g. one per scheduled slot),
   * not the attempt. Calling ingestGpPmsRecords twice with the same key
   * (a duplicate trigger, a retried orchestrator step) reuses the same
   * trust-log transaction ID instead of logging it twice.
   */
  idempotencyKey: string;
  maxAttempts?: number;
  /** Exponential backoff base; attempt N waits backoffBaseMs * 2^(N-1) before retrying. Set 0 in tests. */
  backoffBaseMs?: number;
  logger?: IngestionLogger;
  /** Defaults to a FileTrustLogger at DEFAULT_TRUST_LOG_PATH; inject a fake in tests. */
  trustLogger?: TrustLogger;
}

export type IngestGpPmsRecordsResult =
  | { outcome: "success"; records: GpPmsRecord[]; attempts: number; transactionId: string }
  | {
      outcome: "failure";
      errorClass: GpPmsErrorClass;
      errorMessage: string;
      attempts: number;
      transactionId: string;
    };

/**
 * Fetches records from a GpPmsClient with an enforced timeout and capped,
 * exponential-backoff retries on transient failures (connection refusal,
 * timeout). Every attempt is logged with a timestamp and outcome —
 * satisfies STORY-001's "all ingestion attempts are logged" criterion.
 *
 * Once the run concludes (success or exhausted retries), it is logged
 * exactly once to the trust spine with a unique transaction ID — STORY-011's
 * "a data ingestion process, when completed, is logged with a unique
 * transaction ID" criterion. If that trust-log write itself fails, this
 * function throws (TrustSpineError) rather than returning a result that was
 * never actually logged — a deliberate choice: an audit-log gap for a
 * compliance-tracked process is treated as more dangerous than losing this
 * run's fetched records, which the next scheduled run will re-fetch anyway.
 */
export async function ingestGpPmsRecords(
  client: GpPmsClient,
  options: IngestGpPmsRecordsOptions,
): Promise<IngestGpPmsRecordsResult> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const backoffBaseMs = options.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
  const logger = options.logger ?? consoleIngestionLogger;
  const trustLogger = options.trustLogger ?? new FileTrustLogger(DEFAULT_TRUST_LOG_PATH);

  let lastErrorClass: GpPmsErrorClass = "ConnectionError";
  let lastErrorMessage = "GP PMS ingestion never attempted (maxAttempts <= 0).";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const startedAt = Date.now();

    let records: GpPmsRecord[];
    try {
      records = await fetchWithTimeout(client, options);
    } catch (error) {
      const gpError = toGpPmsError(error);
      lastErrorClass = gpError.errorClass;
      lastErrorMessage = gpError.message;

      logger({
        timestamp: new Date().toISOString(),
        event: "gp_pms_ingestion_attempt",
        attempt,
        maxAttempts,
        durationMs: Date.now() - startedAt,
        outcome: "failure",
        errorClass: gpError.errorClass,
        errorMessage: gpError.message,
      });

      const isRetryable = RETRYABLE_ERROR_CLASSES.includes(gpError.errorClass);
      const attemptsRemain = attempt < maxAttempts;
      if (!isRetryable || !attemptsRemain) {
        const { transactionId } = await trustLogger.record({
          idempotencyKey: options.idempotencyKey,
          processType: "ingestion",
          processName: "ingestGpPmsRecords",
          outcome: "failure",
          errorClass: gpError.errorClass,
          context: { attempts: attempt, errorMessage: gpError.message },
        });
        return {
          outcome: "failure",
          errorClass: gpError.errorClass,
          errorMessage: gpError.message,
          attempts: attempt,
          transactionId,
        };
      }

      await sleep(backoffBaseMs * 2 ** (attempt - 1));
      continue;
    }

    // Only reached when fetchWithTimeout succeeded — records is assigned.
    logger({
      timestamp: new Date().toISOString(),
      event: "gp_pms_ingestion_attempt",
      attempt,
      maxAttempts,
      durationMs: Date.now() - startedAt,
      outcome: "success",
      recordCount: records.length,
    });
    const { transactionId } = await trustLogger.record({
      idempotencyKey: options.idempotencyKey,
      processType: "ingestion",
      processName: "ingestGpPmsRecords",
      outcome: "success",
      context: { attempts: attempt, recordCount: records.length },
    });
    return { outcome: "success", records, attempts: attempt, transactionId };
  }

  const { transactionId } = await trustLogger.record({
    idempotencyKey: options.idempotencyKey,
    processType: "ingestion",
    processName: "ingestGpPmsRecords",
    outcome: "failure",
    errorClass: lastErrorClass,
    context: { attempts: 0, errorMessage: lastErrorMessage },
  });
  return {
    outcome: "failure",
    errorClass: lastErrorClass,
    errorMessage: lastErrorMessage,
    attempts: 0,
    transactionId,
  };
}

async function fetchWithTimeout(
  client: GpPmsClient,
  options: GpPmsFetchOptions,
): Promise<GpPmsRecord[]> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Tells the client to stop its own in-flight work, not just tells us
      // to stop waiting for it — otherwise a slow/hung call keeps running
      // in the background for as long as the real upstream takes.
      controller.abort();
      reject(new GpPmsError("TimeoutError", `GP PMS did not respond within ${options.timeoutMs}ms.`));
    }, options.timeoutMs);
  });

  try {
    return await Promise.race([
      client.fetchRecords({ ...options, signal: controller.signal }),
      timeoutPromise,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function toGpPmsError(error: unknown): GpPmsError {
  if (error instanceof GpPmsError) return error;
  return new GpPmsError("ConnectionError", error instanceof Error ? error.message : String(error), {
    cause: error,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
