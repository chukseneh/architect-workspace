import test from "node:test";
import assert from "node:assert/strict";
import { buildDashboardSnapshot, DashboardAttemptLogEntry } from "./dashboardSnapshot";
import { FakeDashboardClient } from "./fakeDashboardClient";
import { DashboardClient, DashboardRequestOptions, IcbDashboardEntry } from "./dashboardTypes";
import { FakeTrustLogger } from "../services/trustSpine/fakeTrustLogger";
import { TrustSpineError } from "../services/trustSpine/types";

const FIXED_NOW = new Date("2026-09-06T09:00:00.000Z");

const CALM_ENTRIES: IcbDashboardEntry[] = [
  { icbName: "NHS Leeds ICB", currentOpelLevel: 1, forecastedPressureLevel: "Low" },
  { icbName: "NHS Manchester ICB", currentOpelLevel: 2, forecastedPressureLevel: "Medium" },
];

function collectLogs() {
  const logs: DashboardAttemptLogEntry[] = [];
  return { logs, logger: (entry: DashboardAttemptLogEntry) => logs.push(entry) };
}

test("happy path: operational data produces a snapshot with current and forecasted metrics plus a briefing", async () => {
  const result = await buildDashboardSnapshot(CALM_ENTRIES, {
    idempotencyKey: "dashboard-test-1",
    now: FIXED_NOW,
    client: new FakeDashboardClient(),
    trustLogger: new FakeTrustLogger(),
  });

  assert.equal(result.outcome, "success");
  if (result.outcome === "success") {
    assert.deepEqual(result.snapshot.metrics, CALM_ENTRIES);
    assert.equal(result.snapshot.briefing.overall_status, "Low");
    assert.equal(result.snapshot.generatedAt, FIXED_NOW.toISOString());
    assert.deepEqual(result.snapshot.dataUncertainties, []);
  }
});

test("trust: a completed snapshot is logged with a timestamp, and flags data issues in context", async () => {
  const trustLogger = new FakeTrustLogger();
  await buildDashboardSnapshot(CALM_ENTRIES, {
    idempotencyKey: "dashboard-test-trust",
    now: FIXED_NOW,
    client: new FakeDashboardClient(),
    trustLogger,
  });

  assert.equal(trustLogger.records.length, 1);
  const entry = trustLogger.records[0];
  assert.equal(entry?.processType, "prediction");
  // Every TrustLogEntry the real FileTrustLogger writes carries a mandatory
  // timestamp (see trustSpine/types.ts) — already covered by STORY-011's
  // own tests, so this test only checks the new dataUncertainties context field.
  assert.deepEqual(entry?.context?.dataUncertainties, []);
});

test("trust spine: replaying the same idempotencyKey reuses the same transaction ID", async () => {
  const trustLogger = new FakeTrustLogger();
  const first = await buildDashboardSnapshot(CALM_ENTRIES, {
    idempotencyKey: "dashboard-test-replay",
    now: FIXED_NOW,
    client: new FakeDashboardClient(),
    trustLogger,
  });
  const second = await buildDashboardSnapshot(CALM_ENTRIES, {
    idempotencyKey: "dashboard-test-replay",
    now: FIXED_NOW,
    client: new FakeDashboardClient(),
    trustLogger,
  });

  assert.equal(trustLogger.records.length, 1, "the second run must not create a second trust-log entry");
  if (first.outcome === "success" && second.outcome === "success") {
    assert.equal(second.transactionId, first.transactionId);
  } else {
    assert.fail("both runs were expected to succeed");
  }
});

test("failure path: a trust-log write failure fails the snapshot loudly instead of returning unlogged output", async () => {
  const trustLogger = new FakeTrustLogger();
  trustLogger.failNextWrite = true;

  await assert.rejects(
    () =>
      buildDashboardSnapshot(CALM_ENTRIES, {
        idempotencyKey: "dashboard-test-log-failure",
        client: new FakeDashboardClient(),
        trustLogger,
      }),
    (error: unknown) => error instanceof TrustSpineError && error.errorClass === "LogWriteError",
  );
});

test("incomplete data: an empty entry list is flagged, not silently shown as calm", async () => {
  const result = await buildDashboardSnapshot([], {
    idempotencyKey: "dashboard-test-empty",
    now: FIXED_NOW,
    client: new FakeDashboardClient({
      response: JSON.stringify({
        overall_status: "Critical",
        status_counts: { Low: 0, Medium: 0, High: 0, Critical: 0 },
        headline: "No ICB data was available for this briefing.",
        top_risks: ["Data gap: no ICB summaries received"],
        recommended_actions: ["Investigate why no ICB data was ingested"],
      }),
    }),
    trustLogger: new FakeTrustLogger(),
  });

  assert.equal(result.outcome, "success");
  if (result.outcome === "success") {
    assert.deepEqual(result.snapshot.dataUncertainties, ["no_icb_data"]);
    assert.equal(result.snapshot.briefing.overall_status, "Critical");
  }
});

test("incomplete data: an entry with an invalid forecast tier is flagged by name", async () => {
  const entries: IcbDashboardEntry[] = [
    { icbName: "NHS Bristol ICB", currentOpelLevel: 2, forecastedPressureLevel: "Severe" },
  ];
  const result = await buildDashboardSnapshot(entries, {
    idempotencyKey: "dashboard-test-malformed-entry",
    now: FIXED_NOW,
    client: new FakeDashboardClient({
      response: JSON.stringify({
        overall_status: "Critical",
        status_counts: { Low: 0, Medium: 0, High: 0, Critical: 1 },
        headline: "NHS Bristol ICB has an invalid pressure reading.",
        top_risks: ["NHS Bristol ICB: malformed pressure_level"],
        recommended_actions: ["Check NHS Bristol ICB's data source"],
      }),
    }),
    trustLogger: new FakeTrustLogger(),
  });

  assert.equal(result.outcome, "success");
  if (result.outcome === "success") {
    assert.deepEqual(result.snapshot.dataUncertainties, ["malformed_forecast:NHS Bristol ICB"]);
  }
});

test("failure path: an auth error (engine fails to start) is never retried", async () => {
  const client = new FakeDashboardClient({ failureMode: "auth" });
  const result = await buildDashboardSnapshot(CALM_ENTRIES, {
    idempotencyKey: "dashboard-test-auth",
    maxAttempts: 3,
    backoffBaseMs: 0,
    client,
    trustLogger: new FakeTrustLogger(),
  });

  assert.equal(result.outcome, "failure");
  if (result.outcome === "failure") {
    assert.equal(result.errorClass, "AuthError");
    assert.equal(result.attempts, 1);
  }
  assert.equal(client.callCount, 1, "an AuthError must not be retried");
});

test("failure path: malformed model output is retried to the cap, then fails as ValidationError", async () => {
  const { logs, logger } = collectLogs();
  const result = await buildDashboardSnapshot(CALM_ENTRIES, {
    idempotencyKey: "dashboard-test-malformed-model-output",
    maxAttempts: 2,
    backoffBaseMs: 0,
    client: new FakeDashboardClient({ failureMode: "malformedJson" }),
    logger,
    trustLogger: new FakeTrustLogger(),
  });

  assert.equal(result.outcome, "failure");
  if (result.outcome === "failure") {
    assert.equal(result.errorClass, "ValidationError");
    assert.equal(result.attempts, 2);
  }
  assert.equal(logs.length, 2);
});

test("recovery: a transient rate-limit error on the first attempt succeeds on retry", async () => {
  let calls = 0;
  const flakyClient: DashboardClient = {
    async predict(_prompt: string, _options: DashboardRequestOptions) {
      calls++;
      if (calls === 1) {
        const { DashboardError } = await import("./dashboardTypes");
        throw new DashboardError("RateLimitError", "rate limited on first attempt");
      }
      return JSON.stringify({
        overall_status: "Medium",
        status_counts: { Low: 1, Medium: 1, High: 0, Critical: 0 },
        headline: "recovered",
        top_risks: [],
        recommended_actions: [],
      });
    },
  };

  const result = await buildDashboardSnapshot(CALM_ENTRIES, {
    idempotencyKey: "dashboard-test-recovery",
    maxAttempts: 2,
    backoffBaseMs: 0,
    client: flakyClient,
    trustLogger: new FakeTrustLogger(),
  });

  assert.equal(result.outcome, "success");
  if (result.outcome === "success") {
    assert.equal(result.attempts, 2);
  }
  assert.equal(calls, 2);
});
