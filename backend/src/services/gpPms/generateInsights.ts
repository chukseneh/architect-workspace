import { z } from "zod";
import { GpPmsRecord } from "./types";
import { DEFAULT_TRUST_LOG_PATH, FileTrustLogger } from "../trustSpine/fileTrustLogger";
import { TrustLogger } from "../trustSpine/types";
import { fromGpPmsCapacityRecord } from "../uncertaintyFlagging/fromGpPmsRecord";
import { detectDataUncertainty } from "../uncertaintyFlagging/detectDataUncertainty";

const EXPECTED_RECORD_TYPES = ["appointment", "registration", "capacity"] as const;

/**
 * STORY-009 integration: how often the capacity metric is expected to
 * refresh, for the general uncertainty-flagging mechanism's own staleness
 * check on this record. Chosen so 3x this value (detectDataUncertainty's
 * own staleness multiplier) equals this module's existing 24-hour
 * DEFAULT_STALE_AFTER_MS, rather than introducing an unrelated second
 * staleness threshold for the same kind of record.
 */
const CAPACITY_EXPECTED_UPDATE_FREQUENCY_MINUTES = 8 * 60;

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

    // STORY-009 integration: the general uncertainty-flagging mechanism's
    // pure detector runs alongside (not instead of) this module's own
    // existing checks above -- it catches a different thing
    // (staleness/plausibility of the metric itself) than
    // capacity_payload_malformed (shape of the payload) or stale_data (age
    // of the whole batch). Calls detectDataUncertainty directly rather than
    // the full flagForReview() orchestrator: flagForReview does its own
    // input validation, timeout guard, and trust-log write, which would
    // both double this function's "logged exactly once" trust-spine
    // contract (see the 3 tests that assert it) and duplicate validation
    // already implied by capacityRecord having come from an
    // already-schema-validated GpPmsRecord batch. A detector exception is
    // still handled fail-safe (flag it, never silently drop it), matching
    // flagForReview's own philosophy, just without a second trust-log entry.
    const mappedCapacity = fromGpPmsCapacityRecord(capacityRecord, {
      expectedUpdateFrequencyMinutes: CAPACITY_EXPECTED_UPDATE_FREQUENCY_MINUTES,
      now,
    });
    try {
      const capacityUncertainty = detectDataUncertainty(mappedCapacity);
      if (capacityUncertainty.uncertain) {
        dataUncertainties.push(`capacity_metric_uncertain:${capacityUncertainty.category}`);
      }
    } catch (error) {
      // Never swallow: log what actually happened before falling back to
      // the fail-safe flag, even though detectDataUncertainty is a total
      // function not expected to reach this branch in practice.
      console.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "error",
          service: "backend",
          event: "capacity_uncertainty_check_failed",
          error_class: "FlagEvaluationError",
          context: { errorMessage: error instanceof Error ? error.message : String(error) },
        }),
      );
      dataUncertainties.push("capacity_metric_check_failed");
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
