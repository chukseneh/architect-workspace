import { AmbulanceHandoverRecord } from "./types";
import { DEFAULT_TRUST_LOG_PATH, FileTrustLogger } from "../trustSpine/fileTrustLogger";
import { TrustLogger } from "../trustSpine/types";

const OVER_THRESHOLD_MINUTES = 60;

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
