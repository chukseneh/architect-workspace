import {
  NhsCentralDataClient,
  NhsCentralDataError,
  NhsCentralDataErrorClass,
  NhsCentralDataFetchOptions,
  NhsCentralDataRecord,
} from "./types";

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BACKOFF_BASE_MS = 100;

/** Format mismatches are never retried — retrying a data-shape problem cannot fix it. */
const RETRYABLE_ERROR_CLASSES: readonly NhsCentralDataErrorClass[] = ["ConnectionError", "TimeoutError"];

export interface IngestionLogEntry {
  timestamp: string;
  event: "nhs_central_data_ingestion_attempt";
  attempt: number;
  maxAttempts: number;
  durationMs: number;
  outcome: "success" | "failure";
  recordCount?: number;
  errorClass?: NhsCentralDataErrorClass;
  errorMessage?: string;
}

export type IngestionLogger = (entry: IngestionLogEntry) => void;

/** One structured JSON line per attempt, per CLAUDE.md's Observability Framework. */
export const consoleIngestionLogger: IngestionLogger = (entry) => {
  console.log(JSON.stringify(entry));
};

export interface IngestNhsCentralDataOptions extends NhsCentralDataFetchOptions {
  maxAttempts?: number;
  /** Exponential backoff base; attempt N waits backoffBaseMs * 2^(N-1) before retrying. Set 0 in tests. */
  backoffBaseMs?: number;
  logger?: IngestionLogger;
}

export type IngestNhsCentralDataResult =
  | { outcome: "success"; records: NhsCentralDataRecord[]; attempts: number }
  | { outcome: "failure"; errorClass: NhsCentralDataErrorClass; errorMessage: string; attempts: number };

/**
 * Retries transient failures (connection, timeout) with capped exponential
 * backoff, logging every attempt with a timestamp and outcome. Every retry
 * calls the client with the SAME `options` object — and therefore the same
 * `idempotencyKey` — as the first attempt; that is what makes retrying safe
 * against a source that may already have completed the write before we saw
 * success (see nhs-ops-status/server.py's own ingestion ledger).
 */
export async function ingestNhsCentralData(
  client: NhsCentralDataClient,
  options: IngestNhsCentralDataOptions,
): Promise<IngestNhsCentralDataResult> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const backoffBaseMs = options.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
  const logger = options.logger ?? consoleIngestionLogger;

  let lastErrorClass: NhsCentralDataErrorClass = "ConnectionError";
  let lastErrorMessage = "NHS central data ingestion never attempted (maxAttempts <= 0).";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const startedAt = Date.now();

    try {
      const records = await fetchWithTimeout(client, options);
      logger({
        timestamp: new Date().toISOString(),
        event: "nhs_central_data_ingestion_attempt",
        attempt,
        maxAttempts,
        durationMs: Date.now() - startedAt,
        outcome: "success",
        recordCount: records.length,
      });
      return { outcome: "success", records, attempts: attempt };
    } catch (error) {
      const nhsError = toNhsCentralDataError(error);
      lastErrorClass = nhsError.errorClass;
      lastErrorMessage = nhsError.message;

      logger({
        timestamp: new Date().toISOString(),
        event: "nhs_central_data_ingestion_attempt",
        attempt,
        maxAttempts,
        durationMs: Date.now() - startedAt,
        outcome: "failure",
        errorClass: nhsError.errorClass,
        errorMessage: nhsError.message,
      });

      const isRetryable = RETRYABLE_ERROR_CLASSES.includes(nhsError.errorClass);
      const attemptsRemain = attempt < maxAttempts;
      if (!isRetryable || !attemptsRemain) {
        return {
          outcome: "failure",
          errorClass: nhsError.errorClass,
          errorMessage: nhsError.message,
          attempts: attempt,
        };
      }

      await sleep(backoffBaseMs * 2 ** (attempt - 1));
    }
  }

  return { outcome: "failure", errorClass: lastErrorClass, errorMessage: lastErrorMessage, attempts: 0 };
}

/**
 * Guarantees the timeout at the contract level rather than trusting any one
 * NhsCentralDataClient implementation to self-enforce it. McpNhsCentralDataClient
 * already asks the MCP SDK to enforce options.timeoutMs internally — this is
 * a backstop on top of that, and the only enforcement a simpler client (like
 * FakeNhsCentralDataClient, or a future implementation) gets at all.
 */
async function fetchWithTimeout(
  client: NhsCentralDataClient,
  options: NhsCentralDataFetchOptions,
): Promise<NhsCentralDataRecord[]> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new NhsCentralDataError("TimeoutError", `NHS central data source did not respond within ${options.timeoutMs}ms.`));
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

function toNhsCentralDataError(error: unknown): NhsCentralDataError {
  if (error instanceof NhsCentralDataError) return error;
  return new NhsCentralDataError("ConnectionError", error instanceof Error ? error.message : String(error), {
    cause: error,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
