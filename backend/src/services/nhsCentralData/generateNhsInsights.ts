import { NhsCentralDataRecord } from "./types";
import { DEFAULT_TRUST_LOG_PATH, FileTrustLogger } from "../trustSpine/fileTrustLogger";
import { TrustLogger } from "../trustSpine/types";

export interface NhsCentralDataInsights {
  recordCount: number;
  averageOpelLevel: number | null;
  maxOpelLevel: number | null;
  /** ICB names currently at the most severe escalation level (OPEL 4). */
  icbsAtOpelLevel4: string[];
  averageAmbulanceHandoverOver60MinPct: number | null;
  mostRecentUpdateAt: string | null;
  /** Deterministic flags for a human to review — the project guardrail against silent uncertainty. */
  dataUncertainties: string[];
}

export interface GenerateNhsInsightsOptions {
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

export interface GenerateNhsInsightsResult {
  insights: NhsCentralDataInsights;
  transactionId: string;
}

const DEFAULT_STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const MOST_SEVERE_OPEL_LEVEL = 4;

/**
 * Derives insights from already-ingested, already-validated NHS central
 * data records. Deterministic by design, same as GP PMS's generateInsights
 * (CLAUDE.md Core Principle: production systems must be deterministic) —
 * every record has already passed NhsCentralDataRecordSchema's bounds
 * (opel_level 1-4, percentages 0-100), so there is nothing left to
 * range-check here; staleness and absence are what remain to flag.
 *
 * This is r0's "prediction" process for STORY-011's trust spine — see
 * GP PMS's generateInsights for the identical policy and rationale on
 * transaction logging and fail-loud-on-log-failure.
 */
export async function generateNhsInsights(
  records: NhsCentralDataRecord[],
  options: GenerateNhsInsightsOptions,
): Promise<GenerateNhsInsightsResult> {
  const now = options.now ?? new Date();
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const dataUncertainties: string[] = [];

  if (records.length === 0) {
    dataUncertainties.push("no_records_ingested");
  }

  const mostRecentUpdateAt = records.reduce<string | null>((latest, record) => {
    return latest === null || record.lastUpdated > latest ? record.lastUpdated : latest;
  }, null);

  if (mostRecentUpdateAt !== null) {
    const ageMs = now.getTime() - new Date(mostRecentUpdateAt).getTime();
    if (ageMs > staleAfterMs) {
      dataUncertainties.push("stale_data");
    }
  }

  const insights: NhsCentralDataInsights = {
    recordCount: records.length,
    averageOpelLevel: average(records.map((record) => record.opelLevel)),
    maxOpelLevel: records.length > 0 ? Math.max(...records.map((record) => record.opelLevel)) : null,
    icbsAtOpelLevel4: records
      .filter((record) => record.opelLevel === MOST_SEVERE_OPEL_LEVEL)
      .map((record) => record.icbName),
    averageAmbulanceHandoverOver60MinPct: average(
      records.map((record) => record.ambulanceHandoverOver60MinPct),
    ),
    mostRecentUpdateAt,
    dataUncertainties,
  };

  const trustLogger = options.trustLogger ?? new FileTrustLogger(DEFAULT_TRUST_LOG_PATH);
  const { transactionId } = await trustLogger.record({
    idempotencyKey: options.idempotencyKey,
    processType: "prediction",
    processName: "generateNhsInsights",
    outcome: "success",
    context: { recordCount: insights.recordCount, dataUncertaintyCount: dataUncertainties.length },
  });

  return { insights, transactionId };
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
