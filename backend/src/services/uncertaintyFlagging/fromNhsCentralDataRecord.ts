import { NhsCentralDataRecord } from "../nhsCentralData/types";
import { DataRecord } from "./types";

/** The 4 numeric fields NhsCentralDataRecordSchema declares, any one of which can be evaluated for uncertainty on its own. */
export type NhsCentralDataMetric =
  | "opelLevel"
  | "ambulanceHandoverOver60MinPct"
  | "dischargeDelayBeddays"
  | "criticalCareOccupancyPct";

export interface FromNhsCentralDataRecordOptions {
  metric: NhsCentralDataMetric;
  /** How often this metric is expected to refresh under normal conditions. The source record carries no such contract itself, so callers must state one explicitly. */
  expectedUpdateFrequencyMinutes: number;
  /** Reference time for the staleness calculation. Defaults to now; injectable for tests. */
  now?: Date;
}

/**
 * Maps one metric out of a real NHS central data record (STORY-002/012)
 * into the shape flagForReview expects. Unlike GP PMS's untyped payload
 * bag, every field here is already a typed, schema-validated number, so
 * there is no separate malformed-payload case to handle -- a genuinely
 * missing measurement isn't possible once NhsCentralDataRecordSchema has
 * already accepted the record, so `value` is always non-null here.
 * Read-only: nhsCentralData's own files (ingestion, generateNhsInsights)
 * are untouched, same as fromGpPmsRecord.ts.
 */
export function fromNhsCentralDataRecord(
  record: NhsCentralDataRecord,
  options: FromNhsCentralDataRecordOptions,
): DataRecord {
  const now = options.now ?? new Date();
  const lastUpdatedMinutesAgo = Math.round((now.getTime() - new Date(record.lastUpdated).getTime()) / 60_000);

  return {
    system: "NHS Central Data",
    metric: options.metric,
    value: record[options.metric],
    recordedAt: record.lastUpdated,
    lastUpdatedMinutesAgo,
    expectedUpdateFrequencyMinutes: options.expectedUpdateFrequencyMinutes,
    conflictingSourceValue: null,
  };
}
