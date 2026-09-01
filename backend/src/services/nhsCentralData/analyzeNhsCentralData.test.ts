import test from "node:test";
import assert from "node:assert/strict";
import { FakeNhsCentralDataClient } from "./fakeNhsCentralDataClient";
import { analyzeNhsCentralData } from "./analyzeNhsCentralData";
import { FakeTrustLogger } from "../trustSpine/fakeTrustLogger";

test("happy path: ingestion feeds straight into insight generation", async () => {
  const result = await analyzeNhsCentralData(
    new FakeNhsCentralDataClient(),
    {
      since: "2026-08-01T00:00:00Z",
      idempotencyKey: "analyze-happy",
      timeoutMs: 1000,
      trustLogger: new FakeTrustLogger(),
    },
    { now: new Date("2026-08-27T08:00:00.000Z"), trustLogger: new FakeTrustLogger() },
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
  const result = await analyzeNhsCentralData(
    new FakeNhsCentralDataClient(),
    {
      since: "2026-08-01T00:00:00Z",
      idempotencyKey: "analyze-default-key",
      timeoutMs: 1000,
      trustLogger: new FakeTrustLogger(),
    },
    { now: new Date("2026-08-27T08:00:00.000Z"), trustLogger: insightsTrustLogger },
  );

  assert.equal(result.outcome, "success");
  if (result.outcome === "success") {
    assert.equal(insightsTrustLogger.records[0]?.idempotencyKey, result.ingestionTransactionId);
  }
});

test("failure path: an ingestion failure short-circuits before any insight generation is attempted", async () => {
  const result = await analyzeNhsCentralData(new FakeNhsCentralDataClient({ failureMode: "connection" }), {
    since: "2026-08-01T00:00:00Z",
    idempotencyKey: "analyze-failure",
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
