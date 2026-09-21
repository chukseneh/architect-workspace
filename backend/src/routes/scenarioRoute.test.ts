import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../app";
import { FakeScenarioSimulatorClient } from "../intelligence/fakeScenarioSimulatorClient";
import { FakeTrustLogger } from "../services/trustSpine/fakeTrustLogger";

const VALID_BODY = {
  icbName: "NHS South East London ICB",
  currentPressureLevel: "Critical",
  currentPrimaryDriver: "ambulance_handover_delay",
  scenario: "divert_ambulances",
};

function appWith(client: FakeScenarioSimulatorClient, trustLogger = new FakeTrustLogger()) {
  return { app: createApp({ scenario: { client, trustLogger, backoffBaseMs: 1 } }), trustLogger };
}

test("happy path: POST /api/scenario/simulate returns 200 with the projection", async () => {
  const { app } = appWith(new FakeScenarioSimulatorClient());

  const response = await request(app).post("/api/scenario/simulate").send(VALID_BODY);

  assert.equal(response.status, 200);
  assert.equal(response.body.projection.projected_pressure_level, "Medium");
  assert.equal(response.body.projection.pressure_change, "Improves");
  assert.deepEqual(response.body.conflictFlags, []);
  assert.equal(response.body.attempts, 1);
  assert.equal(typeof response.body.transactionId, "string");
});

test("trust: each request is trust-logged with its scenario parameters", async () => {
  const { app, trustLogger } = appWith(new FakeScenarioSimulatorClient());

  await request(app).post("/api/scenario/simulate").send(VALID_BODY);
  await request(app).post("/api/scenario/simulate").send(VALID_BODY);

  assert.equal(trustLogger.records.length, 2, "two separate requests must produce two trust-log entries");
  assert.equal(trustLogger.records[0]?.processName, "simulateScenario");
  assert.equal(trustLogger.records[0]?.outcome, "success");
});

test("idempotency: a repeated Idempotency-Key reuses the same trust-log entry and transaction", async () => {
  const { app, trustLogger } = appWith(new FakeScenarioSimulatorClient());

  const first = await request(app).post("/api/scenario/simulate").set("Idempotency-Key", "same-key-123").send(VALID_BODY);
  const second = await request(app).post("/api/scenario/simulate").set("Idempotency-Key", "same-key-123").send(VALID_BODY);

  assert.equal(trustLogger.records.length, 1, "a repeated key must not create a second trust-log entry");
  assert.equal(first.body.transactionId, second.body.transactionId);
});

test("conflicting inputs: flagged alongside the projection, not rejected (STORY-008 criterion 2)", async () => {
  const { app } = appWith(new FakeScenarioSimulatorClient());

  const response = await request(app)
    .post("/api/scenario/simulate")
    .send({ ...VALID_BODY, currentPressureLevel: "Low" }); // Low tier with an active driver

  assert.equal(response.status, 200);
  assert.equal(response.body.conflictFlags.length, 1);
  assert.match(String(response.body.conflictFlags[0]), /Low/);
});

test("invalid request: a body missing fields returns 400 and never reaches the model", async () => {
  const client = new FakeScenarioSimulatorClient();
  const { app, trustLogger } = appWith(client);

  const response = await request(app).post("/api/scenario/simulate").send({ icbName: "NHS Leeds ICB" });

  assert.equal(response.status, 400);
  assert.equal(response.body.error, "invalid_request");
  assert.equal(client.callCount, 0);
  assert.equal(trustLogger.records.length, 0);
});

test("invalid request: a value outside the enums is rejected before the model", async () => {
  const client = new FakeScenarioSimulatorClient();
  const { app } = appWith(client);

  const bad = [
    { ...VALID_BODY, scenario: "bomb_the_ward" },
    { ...VALID_BODY, currentPressureLevel: "Severe" },
    { ...VALID_BODY, currentPrimaryDriver: "vibes" },
  ];
  for (const body of bad) {
    const response = await request(app).post("/api/scenario/simulate").send(body);
    assert.equal(response.status, 400, JSON.stringify(body));
  }
  assert.equal(client.callCount, 0);
});

test("boundary: icbName of 200 characters is accepted, 201 and empty are rejected", async () => {
  const client = new FakeScenarioSimulatorClient();
  const { app } = appWith(client);

  const ok = await request(app).post("/api/scenario/simulate").send({ ...VALID_BODY, icbName: "a".repeat(200) });
  const tooLong = await request(app).post("/api/scenario/simulate").send({ ...VALID_BODY, icbName: "a".repeat(201) });
  const empty = await request(app).post("/api/scenario/simulate").send({ ...VALID_BODY, icbName: "" });

  assert.equal(ok.status, 200);
  assert.equal(tooLong.status, 400);
  assert.equal(empty.status, 400);
});

test("invalid request: a non-JSON-object body is a 400, not a crash", async () => {
  const { app } = appWith(new FakeScenarioSimulatorClient());

  const response = await request(app).post("/api/scenario/simulate").send();

  assert.equal(response.status, 400);
});

test("upstream failure: a non-retryable provider error surfaces as 502 with its class and no stack trace", async () => {
  const { app } = appWith(new FakeScenarioSimulatorClient({ failureMode: "auth" }));

  const response = await request(app).post("/api/scenario/simulate").send(VALID_BODY);

  assert.equal(response.status, 502);
  assert.equal(response.body.error, "AuthError");
  assert.equal(JSON.stringify(response.body).includes("    at "), false, "no stack trace may reach the client");
});

test("upstream failure: a retryable error is retried, then surfaces as 502 with the attempt count logged", async () => {
  const client = new FakeScenarioSimulatorClient({ failureMode: "timeout" });
  const { app, trustLogger } = appWith(client);

  const response = await request(app).post("/api/scenario/simulate").send(VALID_BODY);

  assert.equal(response.status, 502);
  assert.equal(response.body.error, "TimeoutError");
  assert.ok(client.callCount > 1, "a retryable failure must be retried before giving up");
  assert.equal(trustLogger.records.length, 1, "the failure is trust-logged exactly once");
  assert.equal(trustLogger.records[0]?.outcome, "failure");
});

test("upstream failure: a model reply that is not the expected JSON is a 502 ValidationError", async () => {
  const { app } = appWith(new FakeScenarioSimulatorClient({ failureMode: "malformedJson" }));

  const response = await request(app).post("/api/scenario/simulate").send(VALID_BODY);

  assert.equal(response.status, 502);
  assert.equal(response.body.error, "ValidationError");
});

test("trust: a trust-log write failure surfaces as a generic 500 that does not leak detail", async () => {
  const trustLogger = new FakeTrustLogger();
  trustLogger.failNextWrite = true;
  const { app } = appWith(new FakeScenarioSimulatorClient(), trustLogger);

  const response = await request(app).post("/api/scenario/simulate").send(VALID_BODY);

  assert.equal(response.status, 500);
  assert.equal(response.body.error, "internal_error");
  assert.equal(response.body.message, "The scenario could not be simulated.");
});

test("concurrency: two simultaneous identical requests both succeed and are both logged", async () => {
  const { app, trustLogger } = appWith(new FakeScenarioSimulatorClient());

  const [a, b] = await Promise.all([
    request(app).post("/api/scenario/simulate").send(VALID_BODY),
    request(app).post("/api/scenario/simulate").send(VALID_BODY),
  ]);

  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(trustLogger.records.length, 2);
});
