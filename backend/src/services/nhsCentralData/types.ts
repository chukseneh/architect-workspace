import { z } from "zod";

/**
 * Regional/ICB-level winter-pressure record from NHS central data systems.
 * Field bounds (opel_level 1-4, percentages 0-100, non-negative bed-days)
 * mirror the malformed_input thresholds the source system's own triage
 * workflow already declares — not invented here.
 */
export const NhsCentralDataRecordSchema = z.object({
  icbName: z.string().min(1),
  region: z.string().min(1),
  opelLevel: z.number().int().min(1).max(4),
  ambulanceHandoverOver60MinPct: z.number().min(0).max(100),
  dischargeDelayBeddays: z.number().int().min(0),
  criticalCareOccupancyPct: z.number().int().min(0).max(100),
  lastUpdated: z.string().datetime(),
});

export type NhsCentralDataRecord = z.infer<typeof NhsCentralDataRecordSchema>;

export interface NhsCentralDataFetchOptions {
  /** ISO-8601. Only records captured at or after this time are ingested. Required by the source system — there is no "fetch everything" mode. */
  since: string;
  /**
   * Required by the underlying source: re-calling with the same key
   * replays the original result instead of ingesting again. Callers own
   * generating a key stable across retries of the same logical run.
   */
  idempotencyKey: string;
  timeoutMs: number;
  /** Cooperative cancellation — see GpPmsFetchOptions for the same contract. */
  signal?: AbortSignal;
}

/**
 * Contract for ingesting NHS central data. Implemented for real by an MCP
 * client talking to the nhs-ops-status server — this is not a from-scratch
 * mock like STORY-001's GpPmsClient, since a working simulated source
 * already exists to connect to.
 */
export interface NhsCentralDataClient {
  fetchRecords(options: NhsCentralDataFetchOptions): Promise<NhsCentralDataRecord[]>;
}

export type NhsCentralDataErrorClass =
  | "ConnectionError"
  | "TimeoutError"
  | "FormatMismatchError";

export class NhsCentralDataError extends Error {
  readonly errorClass: NhsCentralDataErrorClass;

  constructor(errorClass: NhsCentralDataErrorClass, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "NhsCentralDataError";
    this.errorClass = errorClass;
  }
}
