import { CommunityDischargeRecord } from "./types";
import { DEFAULT_TRUST_LOG_PATH, FileTrustLogger } from "../trustSpine/fileTrustLogger";
import { TrustLogger } from "../trustSpine/types";

export interface CommunityInsights {
  recordCount: number;
  /** Sum of delayedDischargeBedDays across the batch. 0 when there are no records. */
  dischargeDelayBedDays: number;
  mostRecentCaptureAt: string | null;
  /** Deterministic flags for a human to review — the project guardrail against silent uncertainty. */
  dataUncertainties: string[];
}

export interface GenerateCommunityInsightsOptions {
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

export interface GenerateCommunityInsightsResult {
  insights: CommunityInsights;
  transactionId: string;
}

const DEFAULT_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Derives discharge_delay_beddays (the predict-pressure prompt's community
 * input) from already-ingested, already-validated delayed-discharge
 * records. Deterministic by design (CLAUDE.md Core Principle: "LLMs are
 * probabilistic. Production systems must be deterministic.") — no model
 * call here, just arithmetic over the records in hand.
 *
 * This is REQ-004's "prediction" process for the trust spine: once
 * computed, the run is logged exactly once with a unique transaction ID. If
 * that trust-log write fails, this function throws (TrustSpineError) rather
 * than returning insights that were never actually logged — same "fail
 * loud" policy as the ingestion pipelines, for the same reason.
 */
export async function generateCommunityInsights(
  records: CommunityDischargeRecord[],
  options: GenerateCommunityInsightsOptions,
): Promise<GenerateCommunityInsightsResult> {
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

  const dischargeDelayBedDays = records.reduce((sum, record) => sum + record.delayedDischargeBedDays, 0);

  const insights: CommunityInsights = {
    recordCount: records.length,
    dischargeDelayBedDays,
    mostRecentCaptureAt,
    dataUncertainties,
  };

  const trustLogger = options.trustLogger ?? new FileTrustLogger(DEFAULT_TRUST_LOG_PATH);
  const { transactionId } = await trustLogger.record({
    idempotencyKey: options.idempotencyKey,
    processType: "prediction",
    processName: "generateCommunityInsights",
    outcome: "success",
    context: { recordCount: insights.recordCount, dataUncertaintyCount: dataUncertainties.length },
  });

  return { insights, transactionId };
}
