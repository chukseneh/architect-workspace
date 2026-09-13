import test from "node:test";
import assert from "node:assert/strict";
import { fromNhsCentralDataRecord } from "./fromNhsCentralDataRecord";
import { flagForReview } from "./flagForReview";
import { FakeTrustLogger } from "../trustSpine/fakeTrustLogger";
import { FakeNhsCentralDataClient } from "../nhsCentralData/fakeNhsCentralDataClient";
import { NhsCentralDataRecord } from "../nhsCentralData/types";

const RECORD: NhsCentralDataRecord = {
  icbName: "NHS Greater Manchester ICB",
  region: "North West",
  opelLevel: 3,
  ambulanceHandoverOver60MinPct: 18.4,
  dischargeDelayBeddays: 142,
  criticalCareOccupancyPct: 91,
  lastUpdated: "2026-08-27T06:00:00Z",
};

test("maps the requested metric out of a real NHS central data record correctly", () => {
  const now = new Date("2026-08-27T06:10:00Z");
  const mapped = fromNhsCentralDataRecord(RECORD, {
    metric: "ambulanceHandoverOver60MinPct",
    expectedUpdateFrequencyMinutes: 60,
    now,
  });

  assert.equal(mapped.system, "NHS Central Data");
  assert.equal(mapped.metric, "ambulanceHandoverOver60MinPct");
  assert.equal(mapped.value, 18.4);
  assert.equal(mapped.recordedAt, "2026-08-27T06:00:00Z");
  assert.equal(mapped.lastUpdatedMinutesAgo, 10);
  assert.equal(mapped.conflictingSourceValue, null);
});

test("a different metric on the same record maps independently", () => {
  const mapped = fromNhsCentralDataRecord(RECORD, {
    metric: "criticalCareOccupancyPct",
    expectedUpdateFrequencyMinutes: 60,
    now: new Date("2026-08-27T06:10:00Z"),
  });
  assert.equal(mapped.metric, "criticalCareOccupancyPct");
  assert.equal(mapped.value, 91);
});

test("end-to-end against the real FakeNhsCentralDataClient: a fresh metric is not flagged", async () => {
  const client = new FakeNhsCentralDataClient();
  const records = await client.fetchRecords({ since: "2026-01-01T00:00:00Z", idempotencyKey: "nhs-adapter-test-1", timeoutMs: 5000 });
  const record = records[0];
  assert.ok(record, "the fake client's fixtures must include at least one record");

  const mapped = fromNhsCentralDataRecord(record!, {
    metric: "ambulanceHandoverOver60MinPct",
    expectedUpdateFrequencyMinutes: 60,
    now: new Date(new Date(record!.lastUpdated).getTime() + 10 * 60_000),
  });

  const result = await flagForReview(mapped, { idempotencyKey: "nhs-adapter-flag-fresh", trustLogger: new FakeTrustLogger() });
  assert.equal(result.outcome, "success");
  if (result.outcome === "success") {
    assert.equal(result.result.uncertain, false);
  }
});

test("end-to-end against the real FakeNhsCentralDataClient: evaluated at the real current time, the fixture is genuinely stale", async () => {
  const client = new FakeNhsCentralDataClient();
  const records = await client.fetchRecords({ since: "2026-01-01T00:00:00Z", idempotencyKey: "nhs-adapter-test-2", timeoutMs: 5000 });
  const record = records[0];
  assert.ok(record, "the fake client's fixtures must include at least one record");

  // No injected `now` -- the fixture's fixed lastUpdated is weeks old
  // relative to whenever this test actually runs.
  const mapped = fromNhsCentralDataRecord(record!, { metric: "ambulanceHandoverOver60MinPct", expectedUpdateFrequencyMinutes: 60 });
  const result = await flagForReview(mapped, { idempotencyKey: "nhs-adapter-flag-stale", trustLogger: new FakeTrustLogger() });

  assert.equal(result.outcome, "success");
  if (result.outcome === "success") {
    assert.equal(result.result.uncertain, true);
    assert.equal(result.result.category, "stale_data");
  }
});
