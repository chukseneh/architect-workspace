import test from "node:test";
import assert from "node:assert/strict";
import { fromCommunityDischargeRecord } from "./fromCommunityDischargeRecord";
import { flagForReview } from "./flagForReview";
import { FakeTrustLogger } from "../trustSpine/fakeTrustLogger";
import { MockCommunityClient } from "../community/mockCommunityClient";

test("maps a real community discharge-delay record's fields correctly", () => {
  const record = {
    recordId: "com-0001",
    patientRef: "PT-99001",
    capturedAt: "2026-08-27T06:00:00.000Z",
    delayedDischargeBedDays: 4,
  };
  const mapped = fromCommunityDischargeRecord(record, {
    expectedUpdateFrequencyMinutes: 60,
    now: new Date("2026-08-27T06:20:00.000Z"),
  });

  assert.equal(mapped.system, "Community");
  assert.equal(mapped.value, 4);
  assert.equal(mapped.recordedAt, "2026-08-27T06:00:00.000Z");
  assert.equal(mapped.lastUpdatedMinutesAgo, 20);
});

test("end-to-end against the real MockCommunityClient: a fresh record is not flagged", async () => {
  const client = new MockCommunityClient();
  const records = await client.fetchRecords({ timeoutMs: 5000 });
  const record = records[0];
  assert.ok(record, "the real mock client's fixtures must include at least one record");

  const mapped = fromCommunityDischargeRecord(record!, {
    expectedUpdateFrequencyMinutes: 60,
    now: new Date(new Date(record!.capturedAt).getTime() + 5 * 60_000),
  });
  const result = await flagForReview(mapped, { idempotencyKey: "community-adapter-flag-fresh", trustLogger: new FakeTrustLogger() });

  assert.equal(result.outcome, "success");
  if (result.outcome === "success") {
    assert.equal(result.result.uncertain, false);
  }
});

test("end-to-end against the real MockCommunityClient: evaluated at the real current time, the fixture is genuinely stale", async () => {
  const client = new MockCommunityClient();
  const records = await client.fetchRecords({ timeoutMs: 5000 });
  const record = records[0];
  assert.ok(record, "the real mock client's fixtures must include at least one record");

  const mapped = fromCommunityDischargeRecord(record!, { expectedUpdateFrequencyMinutes: 60 });
  const result = await flagForReview(mapped, { idempotencyKey: "community-adapter-flag-stale", trustLogger: new FakeTrustLogger() });

  assert.equal(result.outcome, "success");
  if (result.outcome === "success") {
    assert.equal(result.result.uncertain, true);
    assert.equal(result.result.category, "stale_data");
  }
});
