import {
  CommunityClient,
  CommunityDischargeRecord,
  CommunityError,
  CommunityErrorClass,
  CommunityFetchOptions,
} from "./types";
import { DEFAULT_TRUST_LOG_PATH, FileTrustLogger } from "../trustSpine/fileTrustLogger";
import { TrustLogger } from "../trustSpine/types";

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BACKOFF_BASE_MS = 100;

/** Format mismatches are never retried — retrying a data-shape problem cannot fix it. */
const RETRYABLE_ERROR_CLASSES: readonly CommunityErrorClass[] = ["ConnectionError", "TimeoutError"];

export interface IngestionLogEntry {
  timestamp: string;
  event: "community_ingestion_attempt";
  attempt: number;
  maxAttempts: number;
  durationMs: number;
  outcome: "success" | "failure";
  recordCount?: number;
  errorClass?: CommunityErrorClass;
  errorMessage?: string;
}

export type IngestionLogger = (entry: IngestionLogEntry) => void;

/** One structured JSON line per attempt, per CLAUDE.md's Observability Framework. */
export const consoleIngestionLogger: IngestionLogger = (entry) => {
  console.log(JSON.stringify(entry));
};

export interface IngestCommunityRecordsOptions extends CommunityFetchOptions {
  /**
   * Identifies this logical ingestion run (e.g. one per scheduled slot),
   * not the attempt. Calling ingestCommunityRecords twice with the same key
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

export type IngestCommunityRecordsResult =
  | { outcome: "success"; records: CommunityDischargeRecord[]; attempts: number; transactionId: string }
  | {
      outcome: "failure";
      errorClass: CommunityErrorClass;
      errorMessage: string;
      attempts: number;
      transactionId: string;
    };

/**
 * Fetches delayed-discharge records from a CommunityClient with an enforced
 * timeout and capped, exponential-backoff retries on transient failures
 * (connection refusal, timeout). Every attempt is logged with a timestamp
 * and outcome, mirroring STORY-001's GP PMS ingestion logging.
 *
 * Once the run concludes (success or exhausted retries), it is logged
 * exactly once to the trust spine with a unique transaction ID — STORY-011's
 * "a data ingestion process, when completed, is logged with a unique
 * transaction ID" criterion, extended here to REQ-004 (community ingestion).
 * If that trust-log write itself fails, this function throws
 * (TrustSpineError) rather than returning a result that was never actually
 * logged — same "fail loud" policy as GP PMS and Ambulance ingestion, for
 * the same reason.
 */
export async function ingestCommunityRecords(
  client: CommunityClient,
  options: IngestCommunityRecordsOptions,
): Promise<IngestCommunityRecordsResult> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const backoffBaseMs = options.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
  const logger = options.logger ?? consoleIngestionLogger;
  const trustLogger = options.trustLogger ?? new FileTrustLogger(DEFAULT_TRUST_LOG_PATH);

  let lastErrorClass: CommunityErrorClass = "ConnectionError";
  let lastErrorMessage = "Community ingestion never attempted (maxAttempts <= 0).";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const startedAt = Date.now();

    let records: CommunityDischargeRecord[];
    try {
      records = await fetchWithTimeout(client, options);
    } catch (error) {
      const communityError = toCommunityError(error);
      lastErrorClass = communityError.errorClass;
      lastErrorMessage = communityError.message;

      logger({
        timestamp: new Date().toISOString(),
        event: "community_ingestion_attempt",
        attempt,
        maxAttempts,
        durationMs: Date.now() - startedAt,
        outcome: "failure",
        errorClass: communityError.errorClass,
        errorMessage: communityError.message,
      });

      const isRetryable = RETRYABLE_ERROR_CLASSES.includes(communityError.errorClass);
      const attemptsRemain = attempt < maxAttempts;
      if (!isRetryable || !attemptsRemain) {
        const { transactionId } = await trustLogger.record({
          idempotencyKey: options.idempotencyKey,
          processType: "ingestion",
          processName: "ingestCommunityRecords",
          outcome: "failure",
          errorClass: communityError.errorClass,
          context: { attempts: attempt, errorMessage: communityError.message },
        });
        return {
          outcome: "failure",
          errorClass: communityError.errorClass,
          errorMessage: communityError.message,
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
      event: "community_ingestion_attempt",
      attempt,
      maxAttempts,
      durationMs: Date.now() - startedAt,
      outcome: "success",
      recordCount: records.length,
    });
    const { transactionId } = await trustLogger.record({
      idempotencyKey: options.idempotencyKey,
      processType: "ingestion",
      processName: "ingestCommunityRecords",
      outcome: "success",
      context: { attempts: attempt, recordCount: records.length },
    });
    return { outcome: "success", records, attempts: attempt, transactionId };
  }

  const { transactionId } = await trustLogger.record({
    idempotencyKey: options.idempotencyKey,
    processType: "ingestion",
    processName: "ingestCommunityRecords",
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
  client: CommunityClient,
  options: CommunityFetchOptions,
): Promise<CommunityDischargeRecord[]> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Tells the client to stop its own in-flight work, not just tells us
      // to stop waiting for it — otherwise a slow/hung call keeps running
      // in the background for as long as the real upstream takes.
      controller.abort();
      reject(new CommunityError("TimeoutError", `Community system did not respond within ${options.timeoutMs}ms.`));
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

function toCommunityError(error: unknown): CommunityError {
  if (error instanceof CommunityError) return error;
  return new CommunityError("ConnectionError", error instanceof Error ? error.message : String(error), {
    cause: error,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
