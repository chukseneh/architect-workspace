import { CommunityDischargeRecord } from "../community/types";
import { DataRecord } from "./types";

export interface FromCommunityDischargeRecordOptions {
  /** How often a discharge-delay record is expected under normal conditions. The source record carries no such contract itself. */
  expectedUpdateFrequencyMinutes: number;
  /** Reference time for the staleness calculation. Defaults to now; injectable for tests. */
  now?: Date;
}

/**
 * Maps a real community discharge-delay record (STORY-012) into the shape
 * flagForReview expects. Read-only, same pattern as fromGpPmsRecord.ts,
 * fromNhsCentralDataRecord.ts, and fromAmbulanceHandoverRecord.ts -- the
 * community service's own files are untouched.
 */
export function fromCommunityDischargeRecord(
  record: CommunityDischargeRecord,
  options: FromCommunityDischargeRecordOptions,
): DataRecord {
  const now = options.now ?? new Date();
  const lastUpdatedMinutesAgo = Math.round((now.getTime() - new Date(record.capturedAt).getTime()) / 60_000);

  return {
    system: "Community",
    metric: "delayed_discharge_bed_days",
    value: record.delayedDischargeBedDays,
    recordedAt: record.capturedAt,
    lastUpdatedMinutesAgo,
    expectedUpdateFrequencyMinutes: options.expectedUpdateFrequencyMinutes,
    conflictingSourceValue: null,
  };
}
