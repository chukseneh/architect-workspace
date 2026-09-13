import test from "node:test";
import assert from "node:assert/strict";
import { fromAmbulanceHandoverRecord } from "./fromAmbulanceHandoverRecord";
import { flagForReview } from "./flagForReview";
import { FakeTrustLogger } from "../trustSpine/fakeTrustLogger";
import { MockAmbulanceClient } from "../ambulance/mockAmbulanceClient";

test("maps a real ambulance handover record's fields correctly", () => {
  const record = { recordId: "amb-0001", capturedAt: "2026-08-27T06:00:00.000Z", handoverDurationMinutes: 22 };
  const mapped = fromAmbulanceHandoverRecord(record, {
    expectedUpdateFrequencyMinutes: 15,
    now: new Date("2026-08-27T06:10:00.000Z"),
  });

  assert.equal(mapped.system, "Ambulance");
  assert.equal(mapped.value, 22);
  assert.equal(mapped.recordedAt, "2026-08-27T06:00:00.000Z");
  assert.equal(mapped.lastUpdatedMinutesAgo, 10);
});

test("end-to-end against the real MockAmbulanceClient: a fresh record is not flagged", async () => {
  const client = new MockAmbulanceClient();
  const records = await client.fetchRecords({ timeoutMs: 5000 });
  const record = records[0];
  assert.ok(record, "the real mock client's fixtures must include at least one record");

  const mapped = fromAmbulanceHandoverRecord(record!, {
    expectedUpdateFrequencyMinutes: 15,
    now: new Date(new Date(record!.capturedAt).getTime() + 5 * 60_000),
  });
  const result = await flagForReview(mapped, { idempotencyKey: "ambulance-adapter-flag-fresh", trustLogger: new FakeTrustLogger() });

  assert.equal(result.outcome, "success");
  if (result.outcome === "success") {
    assert.equal(result.result.uncertain, false);
  }
});

test("end-to-end against the real MockAmbulanceClient: evaluated at the real current time, the fixture is genuinely stale", async () => {
  const client = new MockAmbulanceClient();
  const records = await client.fetchRecords({ timeoutMs: 5000 });
  const record = records[0];
  assert.ok(record, "the real mock client's fixtures must include at least one record");

  const mapped = fromAmbulanceHandoverRecord(record!, { expectedUpdateFrequencyMinutes: 15 });
  const result = await flagForReview(mapped, { idempotencyKey: "ambulance-adapter-flag-stale", trustLogger: new FakeTrustLogger() });

  assert.equal(result.outcome, "success");
  if (result.outcome === "success") {
    assert.equal(result.result.uncertain, true);
    assert.equal(result.result.category, "stale_data");
  }
});
