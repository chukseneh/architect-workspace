import test from "node:test";
import assert from "node:assert/strict";
import { generateCommunityInsights } from "./generateCommunityInsights";
import { CommunityDischargeRecord } from "./types";
import { FakeTrustLogger } from "../trustSpine/fakeTrustLogger";
import { TrustSpineError } from "../trustSpine/types";

const FIXED_NOW = new Date("2026-08-22T09:00:00.000Z");

const DELAY_A: CommunityDischargeRecord = {
  recordId: "com-rec-0001",
  patientRef: "PT-20481",
  capturedAt: "2026-08-21T09:00:00.000Z",
  delayedDischargeBedDays: 3,
};
const DELAY_B: CommunityDischargeRecord = {
  recordId: "com-rec-0002",
  patientRef: "PT-20482",
  capturedAt: "2026-08-22T08:00:00.000Z",
  delayedDischargeBedDays: 7,
};

test("happy path: sums bed-days lost across the batch", async () => {
  const { insights } = await generateCommunityInsights([DELAY_A, DELAY_B], {
    now: FIXED_NOW,
    idempotencyKey: "community-insights-test-1",
    trustLogger: new FakeTrustLogger(),
  });

  assert.equal(insights.recordCount, 2);
  assert.equal(insights.dischargeDelayBedDays, 10);
  assert.equal(insights.mostRecentCaptureAt, "2026-08-22T08:00:00.000Z");
  assert.deepEqual(insights.dataUncertainties, []);
});

test("trust spine: a completed prediction process is logged exactly once with its transaction ID", async () => {
  const trustLogger = new FakeTrustLogger();
  const { transactionId } = await generateCommunityInsights([DELAY_A], {
    now: FIXED_NOW,
    idempotencyKey: "community-insights-test-trust",
    trustLogger,
  });

  assert.equal(trustLogger.records.length, 1);
  assert.equal(trustLogger.records[0]?.processType, "prediction");
  assert.equal(typeof transactionId, "string");
});

test("trust spine: replaying the same idempotencyKey reuses the same transaction ID", async () => {
  const trustLogger = new FakeTrustLogger();
  const first = await generateCommunityInsights([DELAY_A], {
    now: FIXED_NOW,
    idempotencyKey: "community-insights-test-replay",
    trustLogger,
  });
  const second = await generateCommunityInsights([DELAY_A], {
    now: FIXED_NOW,
    idempotencyKey: "community-insights-test-replay",
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
      generateCommunityInsights([DELAY_A], {
        now: FIXED_NOW,
        idempotencyKey: "community-insights-test-log-failure",
        trustLogger,
      }),
    (error: unknown) => error instanceof TrustSpineError && error.errorClass === "LogWriteError",
  );
});

test("uncertainty: empty input flags no_records_ingested and sums to zero", async () => {
  const { insights } = await generateCommunityInsights([], {
    now: FIXED_NOW,
    idempotencyKey: "community-insights-test-empty",
    trustLogger: new FakeTrustLogger(),
  });

  assert.equal(insights.recordCount, 0);
  assert.equal(insights.dischargeDelayBedDays, 0);
  assert.equal(insights.mostRecentCaptureAt, null);
  assert.deepEqual(insights.dataUncertainties, ["no_records_ingested"]);
});

test("uncertainty: data older than the staleness threshold is flagged", async () => {
  const farFuture = new Date("2026-08-25T09:00:00.000Z"); // 3 days after DELAY_B.capturedAt
  const { insights } = await generateCommunityInsights([DELAY_A, DELAY_B], {
    now: farFuture,
    idempotencyKey: "community-insights-test-stale",
    trustLogger: new FakeTrustLogger(),
  });

  assert.ok(insights.dataUncertainties.includes("stale_data"));
});
