import { z } from "zod";

/**
 * A single ambulance handover event. One record per handover — the trust
 * spine's "prediction" step derives ambulance_handover_over_60min_pct from a
 * batch of these (count over 60 minutes ÷ total), the same "raw records in,
 * deterministic arithmetic out" shape GP PMS uses for capacity utilization.
 */
export const AmbulanceHandoverRecordSchema = z.object({
  recordId: z.string().min(1),
  capturedAt: z.string().datetime(),
  handoverDurationMinutes: z.number().nonnegative(),
});

export type AmbulanceHandoverRecord = z.infer<typeof AmbulanceHandoverRecordSchema>;

export interface AmbulanceFetchOptions {
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
 * Contract any Ambulance service integration must satisfy — a local mock
 * today, a real ambulance trust CAD/dispatch system client later, with no
 * other code changing.
 */
export interface AmbulanceClient {
  fetchRecords(options: AmbulanceFetchOptions): Promise<AmbulanceHandoverRecord[]>;
}

export type AmbulanceErrorClass =
  | "ConnectionError"
  | "TimeoutError"
  | "FormatMismatchError";

export class AmbulanceError extends Error {
  readonly errorClass: AmbulanceErrorClass;

  constructor(errorClass: AmbulanceErrorClass, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AmbulanceError";
    this.errorClass = errorClass;
  }
}
