import test from "node:test";
import assert from "node:assert/strict";
import { fromGpPmsCapacityRecord } from "./fromGpPmsRecord";
import { flagForReview } from "./flagForReview";
import { FakeTrustLogger } from "../trustSpine/fakeTrustLogger";
import { MockGpPmsClient } from "../gpPms/mockGpPmsClient";
import { GpPmsRecord } from "../gpPms/types";

const CAPACITY_RECORD: GpPmsRecord = {
  recordId: "gp-rec-0003",
  patientRef: "PT-10295",
  recordType: "capacity",
  capturedAt: "2026-08-22T08:00:00.000Z",
  payload: { availableSlotsToday: 12, bookedSlotsToday: 47, staffOnDuty: 6 },
};

test("maps a real GP PMS capacity record's fields correctly", () => {
  const now = new Date("2026-08-22T08:10:00.000Z");
  const mapped = fromGpPmsCapacityRecord(CAPACITY_RECORD, { expectedUpdateFrequencyMinutes: 30, now });

  assert.equal(mapped.system, "GP PMS");
  assert.equal(mapped.value, 47);
  assert.equal(mapped.recordedAt, "2026-08-22T08:00:00.000Z");
  assert.equal(mapped.lastUpdatedMinutesAgo, 10);
  assert.equal(mapped.expectedUpdateFrequencyMinutes, 30);
  assert.equal(mapped.conflictingSourceValue, null);
});

test("a malformed payload maps to a null value but keeps the real timestamp", () => {
  const malformed: GpPmsRecord = { ...CAPACITY_RECORD, payload: { staffOnDuty: 6 } };
  const mapped = fromGpPmsCapacityRecord(malformed, {
    expectedUpdateFrequencyMinutes: 30,
    now: new Date("2026-08-22T08:10:00.000Z"),
  });

  assert.equal(mapped.value, null);
  assert.equal(mapped.recordedAt, "2026-08-22T08:00:00.000Z", "the record's own age is still knowable even when its value payload is malformed");
});

test("rejects a non-capacity record rather than silently mapping the wrong shape", () => {
  const appointmentRecord: GpPmsRecord = { ...CAPACITY_RECORD, recordType: "appointment", payload: {} };
  assert.throws(
    () => fromGpPmsCapacityRecord(appointmentRecord, { expectedUpdateFrequencyMinutes: 30 }),
    /expects a "capacity" record, got "appointment"/,
  );
});

test("end-to-end against the real MockGpPmsClient: a fresh capacity record is not flagged", async () => {
  const client = new MockGpPmsClient();
  const records = await client.fetchRecords({ timeoutMs: 5000 });
  const capacityRecord = records.find((r) => r.recordType === "capacity");
  assert.ok(capacityRecord, "the real mock client's fixtures must include a capacity record");

  // Evaluated as of shortly after its own capturedAt -- proving the
  // mapping+flagging pipeline works on genuine STORY-001 data, not just
  // hand-built fixtures, when the record is fresh.
  const mapped = fromGpPmsCapacityRecord(capacityRecord!, {
    expectedUpdateFrequencyMinutes: 30,
    now: new Date(new Date(capacityRecord!.capturedAt).getTime() + 5 * 60_000),
  });

  const result = await flagForReview(mapped, { idempotencyKey: "gp-pms-adapter-test-fresh", trustLogger: new FakeTrustLogger() });
  assert.equal(result.outcome, "success");
  if (result.outcome === "success") {
    assert.equal(result.result.uncertain, false);
  }
});

test("end-to-end against the real MockGpPmsClient: evaluated at the real current time, the fixture is genuinely stale", async () => {
  const client = new MockGpPmsClient();
  const records = await client.fetchRecords({ timeoutMs: 5000 });
  const capacityRecord = records.find((r) => r.recordType === "capacity");
  assert.ok(capacityRecord, "the real mock client's fixtures must include a capacity record");

  // No injected `now` here -- the fixture's fixed capturedAt is weeks old
  // relative to whenever this test actually runs, so this is a genuine,
  // not fabricated, staleness case.
  const mapped = fromGpPmsCapacityRecord(capacityRecord!, { expectedUpdateFrequencyMinutes: 30 });
  const result = await flagForReview(mapped, { idempotencyKey: "gp-pms-adapter-test-stale", trustLogger: new FakeTrustLogger() });

  assert.equal(result.outcome, "success");
  if (result.outcome === "success") {
    assert.equal(result.result.uncertain, true);
    assert.equal(result.result.category, "stale_data");
  }
});
