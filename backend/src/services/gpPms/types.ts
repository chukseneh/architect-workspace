import { z } from "zod";

/**
 * A single record pulled from a GP practice management system.
 * `payload` stays as an untyped bag on purpose: each `recordType` shapes it
 * differently, and per-type payload schemas land when the first real
 * consumer needs them, not speculatively here.
 */
export const GpPmsRecordSchema = z.object({
  recordId: z.string().min(1),
  patientRef: z.string().min(1),
  recordType: z.enum(["appointment", "registration", "capacity"]),
  capturedAt: z.string().datetime(),
  payload: z.record(z.string(), z.unknown()),
});

export type GpPmsRecord = z.infer<typeof GpPmsRecordSchema>;

export interface GpPmsFetchOptions {
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
 * Contract any GP PMS integration must satisfy — a local mock today,
 * a real EMIS/SystmOne/Vision client later, with no other code changing.
 */
export interface GpPmsClient {
  fetchRecords(options: GpPmsFetchOptions): Promise<GpPmsRecord[]>;
}

export type GpPmsErrorClass =
  | "ConnectionError"
  | "TimeoutError"
  | "FormatMismatchError";

export class GpPmsError extends Error {
  readonly errorClass: GpPmsErrorClass;

  constructor(errorClass: GpPmsErrorClass, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GpPmsError";
    this.errorClass = errorClass;
  }
}
