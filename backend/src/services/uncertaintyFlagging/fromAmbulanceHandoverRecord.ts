import { AmbulanceHandoverRecord } from "../ambulance/types";
import { DataRecord } from "./types";

export interface FromAmbulanceHandoverRecordOptions {
  /** How often a handover record is expected under normal conditions. The source record carries no such contract itself. */
  expectedUpdateFrequencyMinutes: number;
  /** Reference time for the staleness calculation. Defaults to now; injectable for tests. */
  now?: Date;
}

/**
 * Maps a real ambulance handover record (STORY-012) into the shape
 * flagForReview expects. Read-only, same pattern as fromGpPmsRecord.ts and
 * fromNhsCentralDataRecord.ts -- the ambulance service's own files are
 * untouched.
 */
export function fromAmbulanceHandoverRecord(
  record: AmbulanceHandoverRecord,
  options: FromAmbulanceHandoverRecordOptions,
): DataRecord {
  const now = options.now ?? new Date();
  const lastUpdatedMinutesAgo = Math.round((now.getTime() - new Date(record.capturedAt).getTime()) / 60_000);

  return {
    system: "Ambulance",
    metric: "handover_duration_minutes",
    value: record.handoverDurationMinutes,
    recordedAt: record.capturedAt,
    lastUpdatedMinutesAgo,
    expectedUpdateFrequencyMinutes: options.expectedUpdateFrequencyMinutes,
    conflictingSourceValue: null,
  };
}
