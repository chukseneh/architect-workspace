import test from "node:test";
import assert from "node:assert/strict";
import { MockGpPmsClient } from "./mockGpPmsClient";
import { analyzeGpPmsData } from "./analyzeGpPmsData";

test("happy path: ingestion feeds straight into insight generation", async () => {
  const result = await analyzeGpPmsData(
    new MockGpPmsClient(),
    { timeoutMs: 1000 },
    { now: new Date("2026-08-22T09:00:00.000Z") },
  );

  assert.equal(result.outcome, "success");
  if (result.outcome === "success") {
    assert.equal(result.insights.recordCount, 3);
    assert.deepEqual(result.insights.dataUncertainties, []);
  }
});

test("failure path: an ingestion failure short-circuits before any insight generation is attempted", async () => {
  const result = await analyzeGpPmsData(new MockGpPmsClient({ failureMode: "connection" }), {
    timeoutMs: 1000,
    maxAttempts: 1,
  });

  assert.equal(result.outcome, "failure");
  if (result.outcome === "failure") {
    assert.equal(result.errorClass, "ConnectionError");
  }
  assert.ok(!("insights" in result));
});
