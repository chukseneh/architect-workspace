import { z } from "zod";

/**
 * A single delayed-discharge record from a community care management
 * system. One record per patient whose discharge was delayed — the trust
 * spine's "prediction" step sums delayedDischargeBedDays across a batch of
 * these to derive discharge_delay_beddays, the same "raw records in,
 * deterministic arithmetic out" shape used for ambulance handovers and GP
 * PMS capacity utilization.
 */
export const CommunityDischargeRecordSchema = z.object({
  recordId: z.string().min(1),
  patientRef: z.string().min(1),
  capturedAt: z.string().datetime(),
  delayedDischargeBedDays: z.number().nonnegative(),
});

export type CommunityDischargeRecord = z.infer<typeof CommunityDischargeRecordSchema>;

export interface CommunityFetchOptions {
  /** ISO-8601. Only records captured at or after this time are returned. */
  since?: string;
  timeoutMs: number;
  /**
   * Cooperative cancellation: implementations must stop their own in-flight
   * work (clear internal timers, abort the underlying HTTP call) when this
   * fires, not just leave it running after the caller has given up.
   */
  signal?: AbortSignal;
}

/**
 * Contract any Community care management integration must satisfy — a local
 * mock today, a real community care system client later, with no other code
 * changing.
 */
export interface CommunityClient {
  fetchRecords(options: CommunityFetchOptions): Promise<CommunityDischargeRecord[]>;
}

export type CommunityErrorClass =
  | "ConnectionError"
  | "TimeoutError"
  | "FormatMismatchError";

export class CommunityError extends Error {
  readonly errorClass: CommunityErrorClass;

  constructor(errorClass: CommunityErrorClass, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CommunityError";
    this.errorClass = errorClass;
  }
}
