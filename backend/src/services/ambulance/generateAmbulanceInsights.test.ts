import test from "node:test";
import assert from "node:assert/strict";
import { generateAmbulanceInsights } from "./generateAmbulanceInsights";
import { AmbulanceHandoverRecord } from "./types";
import { FakeTrustLogger } from "../trustSpine/fakeTrustLogger";
import { TrustSpineError } from "../trustSpine/types";

const FIXED_NOW = new Date("2026-08-22T09:00:00.000Z");

const UNDER_60: AmbulanceHandoverRecord = {
  recordId: "amb-rec-0001",
  capturedAt: "2026-08-21T09:00:00.000Z",
  handoverDurationMinutes: 42,
};
const OVER_60_A: AmbulanceHandoverRecord = {
  recordId: "amb-rec-0002",
  capturedAt: "2026-08-22T08:00:00.000Z",
  handoverDurationMinutes: 75,
};
const OVER_60_B: AmbulanceHandoverRecord = {
  recordId: "amb-rec-0003",
  capturedAt: "2026-08-22T08:30:00.000Z",
  handoverDurationMinutes: 63,
};

test("happy path: computes the over-60min percentage across the batch", async () => {
  const { insights } = await generateAmbulanceInsights([UNDER_60, OVER_60_A, OVER_60_B], {
    now: FIXED_NOW,
    idempotencyKey: "ambulance-insights-test-1",
    trustLogger: new FakeTrustLogger(),
  });

  assert.equal(insights.recordCount, 3);
  assert.equal(insights.ambulanceHandoverOver60MinPct, 2 / 3);
  assert.equal(insights.mostRecentCaptureAt, "2026-08-22T08:30:00.000Z");
  assert.deepEqual(insights.dataUncertainties, []);
});

test("trust spine: a completed prediction process is logged exactly once with its transaction ID", async () => {
  const trustLogger = new FakeTrustLogger();
  const { transactionId } = await generateAmbulanceInsights([UNDER_60, OVER_60_A], {
    now: FIXED_NOW,
    idempotencyKey: "ambulance-insights-test-trust",
    trustLogger,
  });

  assert.equal(trustLogger.records.length, 1);
  assert.equal(trustLogger.records[0]?.processType, "prediction");
  assert.equal(typeof transactionId, "string");
});

test("trust spine: replaying the same idempotencyKey reuses the same transaction ID", async () => {
  const trustLogger = new FakeTrustLogger();
  const first = await generateAmbulanceInsights([UNDER_60], {
    now: FIXED_NOW,
    idempotencyKey: "ambulance-insights-test-replay",
    trustLogger,
  });
  const second = await generateAmbulanceInsights([UNDER_60], {
    now: FIXED_NOW,
    idempotencyKey: "ambulance-insights-test-replay",
    trustLogger,
  });

  assert.equal(trustLogger.records.length, 1, "the second run must not create a second trust-log entry");
  assert.equal(second.transactionId, first.transactionId);
});

test("failure path: a trust-log write failure fails prediction loudly instead of returning unlogged insights", async () => {
  const trustLogger = new FakeTrustLogger();
  trustLogger.failNextWrite = true;

  await assert.rejects(
    () =>
      generateAmbulanceInsights([UNDER_60], {
        now: FIXED_NOW,
        idempotencyKey: "ambulance-insights-test-log-failure",
        trustLogger,
      }),
    (error: unknown) => error instanceof TrustSpineError && error.errorClass === "LogWriteError",
  );
});

test("uncertainty: empty input flags no_records_ingested and yields no percentage", async () => {
  const { insights } = await generateAmbulanceInsights([], {
    now: FIXED_NOW,
    idempotencyKey: "ambulance-insights-test-empty",
    trustLogger: new FakeTrustLogger(),
  });

  assert.equal(insights.recordCount, 0);
  assert.equal(insights.ambulanceHandoverOver60MinPct, null);
  assert.equal(insights.mostRecentCaptureAt, null);
  assert.deepEqual(insights.dataUncertainties, ["no_records_ingested"]);
});

test("uncertainty: data older than the staleness threshold is flagged", async () => {
  const farFuture = new Date("2026-08-25T09:00:00.000Z"); // 3 days after OVER_60_B.capturedAt
  const { insights } = await generateAmbulanceInsights([UNDER_60, OVER_60_A, OVER_60_B], {
    now: farFuture,
    idempotencyKey: "ambulance-insights-test-stale",
    trustLogger: new FakeTrustLogger(),
  });

  assert.ok(insights.dataUncertainties.includes("stale_data"));
});

test("boundary: a handover at exactly 60 minutes does not count as over-threshold", async () => {
  const exactly60: AmbulanceHandoverRecord = {
    recordId: "amb-rec-0004",
    capturedAt: "2026-08-22T08:00:00.000Z",
    handoverDurationMinutes: 60,
  };
  const { insights } = await generateAmbulanceInsights([exactly60], {
    now: FIXED_NOW,
    idempotencyKey: "ambulance-insights-test-boundary",
    trustLogger: new FakeTrustLogger(),
  });

  assert.equal(insights.ambulanceHandoverOver60MinPct, 0);
});
