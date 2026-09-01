import test from "node:test";
import assert from "node:assert/strict";
import { generateNhsInsights } from "./generateNhsInsights";
import { NhsCentralDataRecord } from "./types";
import { FakeTrustLogger } from "../trustSpine/fakeTrustLogger";
import { TrustSpineError } from "../trustSpine/types";

const FIXED_NOW = new Date("2026-08-27T09:00:00.000Z");

const MANCHESTER: NhsCentralDataRecord = {
  icbName: "NHS Greater Manchester ICB",
  region: "North West",
  opelLevel: 3,
  ambulanceHandoverOver60MinPct: 18.4,
  dischargeDelayBeddays: 142,
  criticalCareOccupancyPct: 91,
  lastUpdated: "2026-08-27T06:00:00.000Z",
};
const SOUTH_EAST_LONDON: NhsCentralDataRecord = {
  icbName: "NHS South East London ICB",
  region: "London",
  opelLevel: 4,
  ambulanceHandoverOver60MinPct: 27.1,
  dischargeDelayBeddays: 210,
  criticalCareOccupancyPct: 97,
  lastUpdated: "2026-08-27T07:00:00.000Z",
};
const WEST_YORKSHIRE: NhsCentralDataRecord = {
  icbName: "NHS West Yorkshire ICB",
  region: "Yorkshire",
  opelLevel: 2,
  ambulanceHandoverOver60MinPct: 9.8,
  dischargeDelayBeddays: 76,
  criticalCareOccupancyPct: 82,
  lastUpdated: "2026-08-27T05:30:00.000Z",
};

test("happy path: aggregates across all records, no uncertainty flags when fresh", async () => {
  const { insights } = await generateNhsInsights([MANCHESTER, SOUTH_EAST_LONDON, WEST_YORKSHIRE], {
    now: FIXED_NOW,
    idempotencyKey: "nhs-insights-test-1",
    trustLogger: new FakeTrustLogger(),
  });

  assert.equal(insights.recordCount, 3);
  assert.equal(insights.averageOpelLevel, (3 + 4 + 2) / 3);
  assert.equal(insights.maxOpelLevel, 4);
  assert.deepEqual(insights.icbsAtOpelLevel4, ["NHS South East London ICB"]);
  assert.equal(insights.averageAmbulanceHandoverOver60MinPct, (18.4 + 27.1 + 9.8) / 3);
  assert.equal(insights.mostRecentUpdateAt, "2026-08-27T07:00:00.000Z");
  assert.deepEqual(insights.dataUncertainties, []);
});

test("trust spine: a completed prediction process is logged exactly once with its transaction ID", async () => {
  const trustLogger = new FakeTrustLogger();
  const { transactionId } = await generateNhsInsights([MANCHESTER, SOUTH_EAST_LONDON, WEST_YORKSHIRE], {
    now: FIXED_NOW,
    idempotencyKey: "nhs-insights-test-trust",
    trustLogger,
  });

  assert.equal(trustLogger.records.length, 1);
  assert.equal(trustLogger.records[0]?.processType, "prediction");
  assert.equal(typeof transactionId, "string");
});

test("trust spine: replaying the same idempotencyKey reuses the same transaction ID", async () => {
  const trustLogger = new FakeTrustLogger();
  const first = await generateNhsInsights([MANCHESTER, SOUTH_EAST_LONDON, WEST_YORKSHIRE], {
    now: FIXED_NOW,
    idempotencyKey: "nhs-insights-test-replay",
    trustLogger,
  });
  const second = await generateNhsInsights([MANCHESTER, SOUTH_EAST_LONDON, WEST_YORKSHIRE], {
    now: FIXED_NOW,
    idempotencyKey: "nhs-insights-test-replay",
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
      generateNhsInsights([MANCHESTER, SOUTH_EAST_LONDON, WEST_YORKSHIRE], {
        now: FIXED_NOW,
        idempotencyKey: "nhs-insights-test-log-failure",
        trustLogger,
      }),
    (error: unknown) => error instanceof TrustSpineError && error.errorClass === "LogWriteError",
  );
});

test("uncertainty: empty input flags no_records_ingested and yields no aggregates", async () => {
  const { insights } = await generateNhsInsights([], {
    now: FIXED_NOW,
    idempotencyKey: "nhs-insights-test-empty",
    trustLogger: new FakeTrustLogger(),
  });

  assert.equal(insights.recordCount, 0);
  assert.equal(insights.averageOpelLevel, null);
  assert.equal(insights.maxOpelLevel, null);
  assert.deepEqual(insights.icbsAtOpelLevel4, []);
  assert.equal(insights.mostRecentUpdateAt, null);
  assert.deepEqual(insights.dataUncertainties, ["no_records_ingested"]);
});

test("uncertainty: no ICB at OPEL 4 yields an empty list, not an error", async () => {
  const { insights } = await generateNhsInsights([MANCHESTER, WEST_YORKSHIRE], {
    now: FIXED_NOW,
    idempotencyKey: "nhs-insights-test-no-opel4",
    trustLogger: new FakeTrustLogger(),
  });

  assert.deepEqual(insights.icbsAtOpelLevel4, []);
  assert.equal(insights.maxOpelLevel, 3);
});

test("uncertainty: data older than the staleness threshold is flagged", async () => {
  const farFuture = new Date("2026-08-30T09:00:00.000Z"); // 3 days after the most recent record
  const { insights } = await generateNhsInsights([MANCHESTER, SOUTH_EAST_LONDON, WEST_YORKSHIRE], {
    now: farFuture,
    idempotencyKey: "nhs-insights-test-stale",
    trustLogger: new FakeTrustLogger(),
  });

  assert.ok(insights.dataUncertainties.includes("stale_data"));
});
