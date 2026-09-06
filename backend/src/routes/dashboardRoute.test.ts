import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../app";
import { FakeDashboardClient } from "../intelligence/fakeDashboardClient";
import { FakeTrustLogger } from "../services/trustSpine/fakeTrustLogger";

const VALID_ENTRIES = [
  { icbName: "NHS Leeds ICB", currentOpelLevel: 1, forecastedPressureLevel: "Low" },
  { icbName: "NHS Manchester ICB", currentOpelLevel: 2, forecastedPressureLevel: "Medium" },
];

test("happy path: POST /api/dashboard/snapshot returns 200 with the snapshot", async () => {
  const app = createApp({ dashboard: { client: new FakeDashboardClient(), trustLogger: new FakeTrustLogger() } });

  const response = await request(app).post("/api/dashboard/snapshot").send({ entries: VALID_ENTRIES });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.metrics, VALID_ENTRIES);
  assert.equal(response.body.briefing.overall_status, "Low");
  assert.deepEqual(response.body.dataUncertainties, []);
});

test("trust: each request gets its own trust-logged transaction (no header, fresh idempotency key)", async () => {
  const trustLogger = new FakeTrustLogger();
  const app = createApp({ dashboard: { client: new FakeDashboardClient(), trustLogger } });

  await request(app).post("/api/dashboard/snapshot").send({ entries: VALID_ENTRIES });
  await request(app).post("/api/dashboard/snapshot").send({ entries: VALID_ENTRIES });

  assert.equal(trustLogger.records.length, 2, "two separate requests must produce two separate trust-log entries");
});

test("idempotency: a repeated Idempotency-Key header reuses the same trust-log entry", async () => {
  const trustLogger = new FakeTrustLogger();
  const app = createApp({ dashboard: { client: new FakeDashboardClient(), trustLogger } });

  await request(app)
    .post("/api/dashboard/snapshot")
    .set("Idempotency-Key", "same-key-123")
    .send({ entries: VALID_ENTRIES });
  await request(app)
    .post("/api/dashboard/snapshot")
    .set("Idempotency-Key", "same-key-123")
    .send({ entries: VALID_ENTRIES });

  assert.equal(trustLogger.records.length, 1, "a repeated Idempotency-Key must not create a second trust-log entry");
});

test("invalid request format: a malformed body returns 400 without calling the model", async () => {
  const client = new FakeDashboardClient();
  const app = createApp({ dashboard: { client, trustLogger: new FakeTrustLogger() } });

  const response = await request(app)
    .post("/api/dashboard/snapshot")
    .send({ entries: [{ icbName: "NHS Leeds ICB" }] }); // missing currentOpelLevel/forecastedPressureLevel

  assert.equal(response.status, 400);
  assert.equal(response.body.error, "invalid_request");
  assert.equal(client.callCount, 0, "malformed input must never reach the model");
});

test("incomplete data: an empty entries array still returns 200 with a flagged snapshot, not a 400", async () => {
  const app = createApp({
    dashboard: {
      client: new FakeDashboardClient({
        response: JSON.stringify({
          overall_status: "Critical",
          status_counts: { Low: 0, Medium: 0, High: 0, Critical: 0 },
          headline: "No ICB data was available for this briefing.",
          top_risks: [],
          recommended_actions: [],
        }),
      }),
      trustLogger: new FakeTrustLogger(),
    },
  });

  const response = await request(app).post("/api/dashboard/snapshot").send({ entries: [] });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.dataUncertainties, ["no_icb_data"]);
});

test("upstream failure: the model client failing surfaces as 502, not a crash or a leaked stack trace", async () => {
  const app = createApp({
    dashboard: { client: new FakeDashboardClient({ failureMode: "auth" }), trustLogger: new FakeTrustLogger() },
  });

  const response = await request(app).post("/api/dashboard/snapshot").send({ entries: VALID_ENTRIES });

  assert.equal(response.status, 502);
  assert.equal(response.body.error, "AuthError");
});

test("dashboard loading error: a trust-log write failure surfaces as 500, not an unhandled crash", async () => {
  const trustLogger = new FakeTrustLogger();
  trustLogger.failNextWrite = true;
  const app = createApp({ dashboard: { client: new FakeDashboardClient(), trustLogger } });

  const response = await request(app).post("/api/dashboard/snapshot").send({ entries: VALID_ENTRIES });

  assert.equal(response.status, 500);
  assert.equal(response.body.error, "internal_error");
});
