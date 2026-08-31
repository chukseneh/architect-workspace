import test from "node:test";
import assert from "node:assert/strict";
import { FakeNhsCentralDataClient } from "./fakeNhsCentralDataClient";
import { analyzeNhsCentralData } from "./analyzeNhsCentralData";

test("happy path: ingestion feeds straight into insight generation", async () => {
  const result = await analyzeNhsCentralData(
    new FakeNhsCentralDataClient(),
    { since: "2026-08-01T00:00:00Z", idempotencyKey: "analyze-happy", timeoutMs: 1000 },
    { now: new Date("2026-08-27T08:00:00.000Z") },
  );

  assert.equal(result.outcome, "success");
  if (result.outcome === "success") {
    assert.equal(result.insights.recordCount, 3);
    assert.deepEqual(result.insights.dataUncertainties, []);
  }
});

test("failure path: an ingestion failure short-circuits before any insight generation is attempted", async () => {
  const result = await analyzeNhsCentralData(new FakeNhsCentralDataClient({ failureMode: "connection" }), {
    since: "2026-08-01T00:00:00Z",
    idempotencyKey: "analyze-failure",
    timeoutMs: 1000,
    maxAttempts: 1,
  });

  assert.equal(result.outcome, "failure");
  if (result.outcome === "failure") {
    assert.equal(result.errorClass, "ConnectionError");
  }
  assert.ok(!("insights" in result));
});
