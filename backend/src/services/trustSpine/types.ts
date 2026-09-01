import { z } from "zod";

export const TrustProcessTypeSchema = z.enum(["ingestion", "prediction"]);
export type TrustProcessType = z.infer<typeof TrustProcessTypeSchema>;

export const TrustOutcomeSchema = z.enum(["success", "failure"]);
export type TrustOutcome = z.infer<typeof TrustOutcomeSchema>;

/**
 * One append-only entry in the trust log. `entryHash` chains to
 * `previousEntryHash` so editing or removing a past entry breaks the chain
 * and can be detected by `TrustLogger.verifyIntegrity()`.
 */
export const TrustLogEntrySchema = z.object({
  transactionId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  processType: TrustProcessTypeSchema,
  processName: z.string().min(1),
  timestamp: z.string().datetime(),
  outcome: TrustOutcomeSchema,
  errorClass: z.string().optional(),
  context: z.record(z.string(), z.unknown()),
  previousEntryHash: z.string().nullable(),
  entryHash: z.string().min(1),
});

export type TrustLogEntry = z.infer<typeof TrustLogEntrySchema>;

export interface TrustLogRecordInput {
  /**
   * Identifies the logical operation, not the attempt. Retrying the same
   * ingestion/prediction run must reuse the same idempotencyKey so the
   * trust spine recognizes the replay instead of minting a new transaction
   * ID for it.
   */
  idempotencyKey: string;
  processType: TrustProcessType;
  processName: string;
  outcome: TrustOutcome;
  errorClass?: string;
  context?: Record<string, unknown>;
}

export interface TrustLogRecordResult {
  transactionId: string;
  /**
   * true if idempotencyKey was already logged and this call returned the
   * existing entry's transaction ID rather than creating a new one.
   */
  replayed: boolean;
}

export interface TrustIntegrityReport {
  valid: boolean;
  entriesChecked: number;
  /** Index of the first entry whose hash chain doesn't match, or null if valid. */
  brokenAtIndex: number | null;
}

/**
 * Contract any trust-log backend must satisfy — a local append-only file
 * today, a database-backed or write-once-storage implementation later,
 * with no ingestion/prediction call site changing.
 */
export interface TrustLogger {
  record(input: TrustLogRecordInput): Promise<TrustLogRecordResult>;
  verifyIntegrity(): Promise<TrustIntegrityReport>;
}

export type TrustSpineErrorClass =
  | "LogWriteError"
  | "DuplicateTransactionIdError"
  | "LogTamperingDetectedError";

export class TrustSpineError extends Error {
  readonly errorClass: TrustSpineErrorClass;

  constructor(errorClass: TrustSpineErrorClass, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TrustSpineError";
    this.errorClass = errorClass;
  }
}
