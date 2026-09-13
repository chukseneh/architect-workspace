import { AmbulanceHandoverRecord } from "./types";
import { DEFAULT_TRUST_LOG_PATH, FileTrustLogger } from "../trustSpine/fileTrustLogger";
import { TrustLogger } from "../trustSpine/types";
import { fromAmbulanceHandoverRecord } from "../uncertaintyFlagging/fromAmbulanceHandoverRecord";
import { detectDataUncertainty } from "../uncertaintyFlagging/detectDataUncertainty";

const OVER_THRESHOLD_MINUTES = 60;

/**
 * STORY-009 integration: how often a handover record is expected under
 * normal conditions, for the general uncertainty-flagging mechanism's own
 * per-record staleness check. 3x this value is 36 hours, comfortably above
 * the fixture data's own 24-hour happy-path gap, so this stays a distinct,
 * looser threshold from this module's existing 24-hour DEFAULT_STALE_AFTER_MS
 * rather than a duplicate of it.
 */
const HANDOVER_EXPECTED_UPDATE_FREQUENCY_MINUTES = 12 * 60;

export interface AmbulanceInsights {
  recordCount: number;
  /** count(handoverDurationMinutes > 60) ÷ recordCount. null when there are no records to compute it from. */
  ambulanceHandoverOver60MinPct: number | null;
  mostRecentCaptureAt: string | null;
  /** Deterministic flags for a human to review — the project guardrail against silent uncertainty. */
  dataUncertainties: string[];
}

export interface GenerateAmbulanceInsightsOptions {
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

export interface GenerateAmbulanceInsightsResult {
  insights: AmbulanceInsights;
  transactionId: string;
}

const DEFAULT_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Derives ambulance_handover_over_60min_pct (the predict-pressure prompt's
 * ambulance input) from already-ingested, already-validated handover
 * records. Deterministic by design (CLAUDE.md Core Principle: "LLMs are
 * probabilistic. Production systems must be deterministic.") — no model
 * call here, just arithmetic over the records in hand.
 *
 * This is REQ-003's "prediction" process for the trust spine: once
 * computed, the run is logged exactly once with a unique transaction ID. If
 * that trust-log write fails, this function throws (TrustSpineError) rather
 * than returning insights that were never actually logged — same "fail
 * loud" policy as the ingestion pipelines, for the same reason.
 */
export async function generateAmbulanceInsights(
  records: AmbulanceHandoverRecord[],
  options: GenerateAmbulanceInsightsOptions,
): Promise<GenerateAmbulanceInsightsResult> {
  const now = options.now ?? new Date();
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const dataUncertainties: string[] = [];

  if (records.length === 0) {
    dataUncertainties.push("no_records_ingested");
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

  // STORY-009 integration: unlike NHS's per-ICB records (each an
  // independent current-state entity), a batch of handover events is a
  // historical event log -- an older event isn't "stale" the way a live
  // reading would be. So this checks only the same most-recent record the
  // stale_data check above already identifies, mirroring that check's own
  // "is our most recent data too old" semantics rather than flagging every
  // individual historical event. Calls detectDataUncertainty directly, not
  // flagForReview(), so this function's own "logged exactly once"
  // trust-spine contract stays intact.
  if (mostRecentCaptureAt !== null) {
    const mostRecentRecord = records.find((record) => record.capturedAt === mostRecentCaptureAt)!;
    const mapped = fromAmbulanceHandoverRecord(mostRecentRecord, {
      expectedUpdateFrequencyMinutes: HANDOVER_EXPECTED_UPDATE_FREQUENCY_MINUTES,
      now,
    });
    try {
      const recordUncertainty = detectDataUncertainty(mapped);
      if (recordUncertainty.uncertain) {
        dataUncertainties.push(`most_recent_handover_uncertain:${recordUncertainty.category}`);
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "error",
          service: "backend",
          event: "handover_record_uncertainty_check_failed",
          error_class: "FlagEvaluationError",
          context: { recordId: mostRecentRecord.recordId, errorMessage: error instanceof Error ? error.message : String(error) },
        }),
      );
      dataUncertainties.push("most_recent_handover_check_failed");
    }
  }

  const overThresholdCount = records.filter(
    (record) => record.handoverDurationMinutes > OVER_THRESHOLD_MINUTES,
  ).length;
  const ambulanceHandoverOver60MinPct = records.length > 0 ? overThresholdCount / records.length : null;

  const insights: AmbulanceInsights = {
    recordCount: records.length,
    ambulanceHandoverOver60MinPct,
    mostRecentCaptureAt,
    dataUncertainties,
  };

  const trustLogger = options.trustLogger ?? new FileTrustLogger(DEFAULT_TRUST_LOG_PATH);
  const { transactionId } = await trustLogger.record({
    idempotencyKey: options.idempotencyKey,
    processType: "prediction",
    processName: "generateAmbulanceInsights",
    outcome: "success",
    context: { recordCount: insights.recordCount, dataUncertaintyCount: dataUncertainties.length },
  });

  return { insights, transactionId };
}
