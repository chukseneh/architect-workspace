import test from "node:test";
import assert from "node:assert/strict";
import { MockGpPmsClient } from "./mockGpPmsClient";
import { analyzeGpPmsData } from "./analyzeGpPmsData";
import { FakeTrustLogger } from "../trustSpine/fakeTrustLogger";

test("happy path: ingestion feeds straight into insight generation", async () => {
  const result = await analyzeGpPmsData(
    new MockGpPmsClient(),
    { idempotencyKey: "gp-pms-analyze-test-1", timeoutMs: 1000, trustLogger: new FakeTrustLogger() },
    { now: new Date("2026-08-22T09:00:00.000Z"), trustLogger: new FakeTrustLogger() },
  );

  assert.equal(result.outcome, "success");
  if (result.outcome === "success") {
    assert.equal(result.insights.recordCount, 3);
    assert.deepEqual(result.insights.dataUncertainties, []);
    assert.equal(typeof result.ingestionTransactionId, "string");
    assert.equal(typeof result.predictionTransactionId, "string");
    assert.notEqual(result.predictionTransactionId, result.ingestionTransactionId);
  }
});

test("trust spine: the prediction step's idempotencyKey defaults to the ingestion run's transaction ID", async () => {
  const insightsTrustLogger = new FakeTrustLogger();
  const result = await analyzeGpPmsData(
    new MockGpPmsClient(),
    { idempotencyKey: "gp-pms-analyze-test-default-key", timeoutMs: 1000, trustLogger: new FakeTrustLogger() },
    { now: new Date("2026-08-22T09:00:00.000Z"), trustLogger: insightsTrustLogger },
  );

  assert.equal(result.outcome, "success");
  if (result.outcome === "success") {
    assert.equal(insightsTrustLogger.records[0]?.idempotencyKey, result.ingestionTransactionId);
  }
});

test("failure path: an ingestion failure short-circuits before any insight generation is attempted", async () => {
  const result = await analyzeGpPmsData(new MockGpPmsClient({ failureMode: "connection" }), {
    idempotencyKey: "gp-pms-analyze-test-2",
    timeoutMs: 1000,
    maxAttempts: 1,
    trustLogger: new FakeTrustLogger(),
  });

  assert.equal(result.outcome, "failure");
  if (result.outcome === "failure") {
    assert.equal(result.errorClass, "ConnectionError");
    assert.equal(typeof result.ingestionTransactionId, "string");
  }
  assert.ok(!("insights" in result));
});
