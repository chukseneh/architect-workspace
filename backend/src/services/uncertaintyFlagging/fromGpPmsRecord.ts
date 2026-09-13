import { z } from "zod";
import { GpPmsRecord } from "../gpPms/types";
import { DataRecord } from "./types";

/** Same shape generateInsights.ts validates a capacity payload against -- duplicated locally rather than imported, since that schema isn't exported (gpPms's own files are left untouched, per this adapter being additive, not a replacement). */
const CapacityPayloadSchema = z.object({
  availableSlotsToday: z.number(),
  bookedSlotsToday: z.number(),
});

export interface FromGpPmsCapacityRecordOptions {
  /** How often this metric is expected to refresh under normal conditions. GP PMS capacity has no such contract yet, so callers must state one explicitly rather than this adapter guessing. */
  expectedUpdateFrequencyMinutes: number;
  /** Reference time for the staleness calculation. Defaults to now; injectable for tests. */
  now?: Date;
}

/**
 * Maps a real GP PMS "capacity" record into the shape flagForReview
 * expects, so the general uncertainty-flagging mechanism this story built
 * can run against genuine STORY-001 pipeline data. Additive only --
 * gpPms/generateInsights.ts keeps its own working, differently-shaped
 * dataUncertainties logic unchanged; this does not replace or call it.
 */
export function fromGpPmsCapacityRecord(record: GpPmsRecord, options: FromGpPmsCapacityRecordOptions): DataRecord {
  if (record.recordType !== "capacity") {
    throw new Error(`fromGpPmsCapacityRecord expects a "capacity" record, got "${record.recordType}".`);
  }

  const now = options.now ?? new Date();
  const lastUpdatedMinutesAgo = Math.round((now.getTime() - new Date(record.capturedAt).getTime()) / 60_000);
  const parsedPayload = CapacityPayloadSchema.safeParse(record.payload);

  return {
    system: "GP PMS",
    metric: "booked_slots_today",
    // A payload that fails to parse means the measured value itself is
    // unknown -- not that the record's age is unknown too, so recordedAt
    // and lastUpdatedMinutesAgo stay real. flagForReview's own
    // missing_value/malformed_input split then applies exactly as
    // designed, rather than this adapter pre-judging the category.
    value: parsedPayload.success ? parsedPayload.data.bookedSlotsToday : null,
    recordedAt: record.capturedAt,
    lastUpdatedMinutesAgo,
    expectedUpdateFrequencyMinutes: options.expectedUpdateFrequencyMinutes,
    conflictingSourceValue: null,
  };
}
