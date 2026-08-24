import test from "node:test";
import assert from "node:assert/strict";
import { generateInsights } from "./generateInsights";
import { GpPmsRecord } from "./types";

const FIXED_NOW = new Date("2026-08-22T09:00:00.000Z");

const APPOINTMENT: GpPmsRecord = {
  recordId: "gp-rec-0001",
  patientRef: "PT-10293",
  recordType: "appointment",
  capturedAt: "2026-08-20T09:15:00.000Z",
  payload: {},
};
const REGISTRATION: GpPmsRecord = {
  recordId: "gp-rec-0002",
  patientRef: "PT-10294",
  recordType: "registration",
  capturedAt: "2026-08-21T11:00:00.000Z",
  payload: {},
};
const CAPACITY: GpPmsRecord = {
  recordId: "gp-rec-0003",
  patientRef: "PT-10295",
  recordType: "capacity",
  capturedAt: "2026-08-22T08:00:00.000Z",
  payload: { availableSlotsToday: 12, bookedSlotsToday: 47 },
};

test("happy path: all three record types present, no uncertainty flags", () => {
  const insights = generateInsights([APPOINTMENT, REGISTRATION, CAPACITY], { now: FIXED_NOW });

  assert.equal(insights.recordCount, 3);
  assert.deepEqual(insights.recordCountsByType, { appointment: 1, registration: 1, capacity: 1 });
  assert.equal(insights.mostRecentCaptureAt, "2026-08-22T08:00:00.000Z");
  assert.equal(insights.capacityUtilization, 47 / 59);
  assert.deepEqual(insights.dataUncertainties, []);
});

test("uncertainty: empty input flags no_records_ingested and every missing type", () => {
  const insights = generateInsights([], { now: FIXED_NOW });

  assert.equal(insights.recordCount, 0);
  assert.equal(insights.mostRecentCaptureAt, null);
  assert.equal(insights.capacityUtilization, null);
  assert.ok(insights.dataUncertainties.includes("no_records_ingested"));
  assert.ok(insights.dataUncertainties.includes("missing_record_type:appointment"));
  assert.ok(insights.dataUncertainties.includes("missing_record_type:registration"));
  assert.ok(insights.dataUncertainties.includes("missing_record_type:capacity"));
});

test("uncertainty: a missing record type is flagged without affecting the ones present", () => {
  const shortlyAfterAppointment = new Date("2026-08-20T10:00:00.000Z");
  const insights = generateInsights([APPOINTMENT], { now: shortlyAfterAppointment });

  assert.deepEqual(insights.dataUncertainties, [
    "missing_record_type:registration",
    "missing_record_type:capacity",
  ]);
});

test("uncertainty: data older than the staleness threshold is flagged", () => {
  const farFuture = new Date("2026-08-25T09:00:00.000Z"); // 3 days after CAPACITY.capturedAt
  const insights = generateInsights([APPOINTMENT, REGISTRATION, CAPACITY], { now: farFuture });

  assert.ok(insights.dataUncertainties.includes("stale_data"));
});

test("uncertainty: malformed capacity payload is flagged and yields no utilization figure", () => {
  const malformedCapacity: GpPmsRecord = {
    ...CAPACITY,
    payload: { availableSlotsToday: "twelve" },
  };
  const insights = generateInsights([APPOINTMENT, REGISTRATION, malformedCapacity], { now: FIXED_NOW });

  assert.equal(insights.capacityUtilization, null);
  assert.ok(insights.dataUncertainties.includes("capacity_payload_malformed"));
});
