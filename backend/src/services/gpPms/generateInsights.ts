import { z } from "zod";
import { GpPmsRecord } from "./types";
import { DEFAULT_TRUST_LOG_PATH, FileTrustLogger } from "../trustSpine/fileTrustLogger";
import { TrustLogger } from "../trustSpine/types";

const EXPECTED_RECORD_TYPES = ["appointment", "registration", "capacity"] as const;

/**
 * Validated only here, at the point of use — `GpPmsRecord.payload` stays an
 * untyped bag in the base contract (see types.ts) until a second consumer
 * needs per-type payload shapes too.
 */
const CapacityPayloadSchema = z.object({
  availableSlotsToday: z.number(),
  bookedSlotsToday: z.number(),
});

export interface GpPmsInsights {
  recordCount: number;
  recordCountsByType: Record<(typeof EXPECTED_RECORD_TYPES)[number], number>;
  mostRecentCaptureAt: string | null;
  /** Booked ÷ (available + booked) from the most recent capacity record, if any. */
  capacityUtilization: number | null;
  /** Deterministic flags for a human to review — the project guardrail against silent uncertainty. */
  dataUncertainties: string[];
}

export interface GenerateInsightsOptions {
  /** Reference time for staleness checks. Defaults to now; injectable for tests. */
  now?: Date;
  staleAfterMs?: number;
  /**
   * Identifies this prediction run to the trust spine. Two calls with the
   * same key (e.g. re-deriving insights for the same ingested batch) reuse
   * the same trust-log transaction ID instead of logging it twice.
   */
  idempotencyKey: string;
  /** Defaults to a FileTrustLogger at DEFAULT_TRUST_LOG_PATH; inject a fake in tests. */
  trustLogger?: TrustLogger;
}

export interface GenerateInsightsResult {
  insights: GpPmsInsights;
  transactionId: string;
}

const DEFAULT_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Derives a small set of insights from already-ingested, already-validated
 * GP PMS records. Deterministic by design (CLAUDE.md Core Principle: "LLMs
 * are probabilistic. Production systems must be deterministic.") — no model
 * call here, just arithmetic over the records in hand.
 *
 * This is r0's "prediction" process for STORY-011's trust spine: once
 * computed, the run is logged exactly once with a unique transaction ID. If
 * that trust-log write fails, this function throws (TrustSpineError) rather
 * than returning insights that were never actually logged — same "fail
 * loud" policy as the ingestion pipelines, for the same reason.
 */
export async function generateInsights(
  records: GpPmsRecord[],
  options: GenerateInsightsOptions,
): Promise<GenerateInsightsResult> {
  const now = options.now ?? new Date();
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const dataUncertainties: string[] = [];

  const recordCountsByType: GpPmsInsights["recordCountsByType"] = {
    appointment: 0,
    registration: 0,
    capacity: 0,
  };
  for (const record of records) {
    recordCountsByType[record.recordType] += 1;
  }

  if (records.length === 0) {
    dataUncertainties.push("no_records_ingested");
  }
  for (const type of EXPECTED_RECORD_TYPES) {
    if (recordCountsByType[type] === 0) {
      dataUncertainties.push(`missing_record_type:${type}`);
    }
  }

  const mostRecentCaptureAt = records.reduce<string | null>((latest, record) => {
    return latest === null || record.capturedAt > latest ? record.capturedAt : latest;
  }, null);

  if (mostRecentCaptureAt !== null) {
    const ageMs = now.getTime() - new Date(mostRecentCaptureAt).getTime();
    if (ageMs > staleAfterMs) {
      dataUncertainties.push("stale_data");
    }
  }

  const capacityRecord = records.find((record) => record.recordType === "capacity");
  let capacityUtilization: number | null = null;
  if (capacityRecord) {
    const parsed = CapacityPayloadSchema.safeParse(capacityRecord.payload);
    if (parsed.success) {
      const { availableSlotsToday, bookedSlotsToday } = parsed.data;
      const totalSlots = availableSlotsToday + bookedSlotsToday;
      capacityUtilization = totalSlots > 0 ? bookedSlotsToday / totalSlots : null;
    } else {
      dataUncertainties.push("capacity_payload_malformed");
    }
  }

  const insights: GpPmsInsights = {
    recordCount: records.length,
    recordCountsByType,
    mostRecentCaptureAt,
    capacityUtilization,
    dataUncertainties,
  };

  const trustLogger = options.trustLogger ?? new FileTrustLogger(DEFAULT_TRUST_LOG_PATH);
  const { transactionId } = await trustLogger.record({
    idempotencyKey: options.idempotencyKey,
    processType: "prediction",
    processName: "generateInsights",
    outcome: "success",
    context: { recordCount: insights.recordCount, dataUncertaintyCount: dataUncertainties.length },
  });

  return { insights, transactionId };
}
