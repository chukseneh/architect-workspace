import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../app";
import { FakeNhsCentralDataClient } from "../services/nhsCentralData/fakeNhsCentralDataClient";
import { MockAmbulanceClient } from "../services/ambulance/mockAmbulanceClient";
import { MockCommunityClient } from "../services/community/mockCommunityClient";
import { FakePressurePredictionClient } from "../intelligence/fakePressurePredictionClient";
import { FakeTrustLogger } from "../services/trustSpine/fakeTrustLogger";

const VALID_BODY = {
  icbNames: ["NHS Greater Manchester ICB", "NHS South East London ICB"],
  since: "2026-01-01T00:00:00.000Z",
};

function baseDeps(overrides: Record<string, unknown> = {}) {
  return {
    nhsClient: new FakeNhsCentralDataClient(),
    ambulanceClient: new MockAmbulanceClient(),
    communityClient: new MockCommunityClient(),
    predictionClient: new FakePressurePredictionClient(),
    trustLogger: new FakeTrustLogger(),
    ...overrides,
  };
}

test("happy path: POST /api/decision-cycle/run returns 200 with per-ICB results and timing", async () => {
  const app = createApp({ decisionCycle: baseDeps() });

  const response = await request(app).post("/api/decision-cycle/run").send(VALID_BODY);

  assert.equal(response.status, 200);
  assert.equal(response.body.outcome, "success");
  assert.equal(response.body.results.length, 2);
  assert.ok(response.body.results.every((r: { outcome: string }) => r.outcome === "success"));
  assert.equal(response.body.withinBudget, true);
  assert.ok(Array.isArray(response.body.stepTimings));
});

test("trust: each request gets its own trust-logged run (no header, fresh idempotency key)", async () => {
  const trustLogger = new FakeTrustLogger();
  const app = createApp({ decisionCycle: baseDeps({ trustLogger }) });

  await request(app).post("/api/decision-cycle/run").send(VALID_BODY);
  await request(app).post("/api/decision-cycle/run").send(VALID_BODY);

  const cycleEntries = trustLogger.records.filter((r) => r.processName === "runDecisionCycle");
  assert.equal(cycleEntries.length, 2, "two separate requests must produce two separate run-level trust-log entries");
});

test("idempotency: a repeated Idempotency-Key header reuses the same trust-log entry", async () => {
  const trustLogger = new FakeTrustLogger();
  const app = createApp({ decisionCycle: baseDeps({ trustLogger }) });

  await request(app).post("/api/decision-cycle/run").set("Idempotency-Key", "same-key-123").send(VALID_BODY);
  await request(app).post("/api/decision-cycle/run").set("Idempotency-Key", "same-key-123").send(VALID_BODY);

  const cycleEntries = trustLogger.records.filter((r) => r.processName === "runDecisionCycle");
  assert.equal(cycleEntries.length, 1, "a repeated Idempotency-Key must not create a second run-level trust-log entry");
});

test("invalid request format: a malformed body returns 400 without touching any client", async () => {
  const predictionClient = new FakePressurePredictionClient();
  const app = createApp({ decisionCycle: baseDeps({ predictionClient }) });

  const response = await request(app)
    .post("/api/decision-cycle/run")
    .send({ icbNames: [], since: "2026-01-01T00:00:00.000Z" }); // icbNames must be non-empty

  assert.equal(response.status, 400);
  assert.equal(response.body.error, "invalid_request");
  assert.equal(predictionClient.callCount, 0, "malformed input must never reach the model");
});

test("upstream failure: a shared ingestion source failing surfaces as 502, not a crash or a leaked stack trace", async () => {
  const app = createApp({
    decisionCycle: baseDeps({ nhsClient: new FakeNhsCentralDataClient({ failureMode: "connection" }) }),
  });

  const response = await request(app).post("/api/decision-cycle/run").send(VALID_BODY);

  assert.equal(response.status, 502);
  assert.equal(response.body.error, "ConnectionError");
  assert.equal(response.body.source, "nhsCentralData");
});

test("decision cycle failure: a trust-log write failure surfaces as 500, not an unhandled crash", async () => {
  const trustLogger = new FakeTrustLogger();
  trustLogger.failNextWrite = true;
  const app = createApp({ decisionCycle: baseDeps({ trustLogger }) });

  const response = await request(app).post("/api/decision-cycle/run").send(VALID_BODY);

  assert.equal(response.status, 500);
  assert.equal(response.body.error, "internal_error");
});
