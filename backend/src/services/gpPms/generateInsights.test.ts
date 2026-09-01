import test from "node:test";
import assert from "node:assert/strict";
import { generateInsights } from "./generateInsights";
import { GpPmsRecord } from "./types";
import { FakeTrustLogger } from "../trustSpine/fakeTrustLogger";
import { TrustSpineError } from "../trustSpine/types";

const FIXED_NOW = new Date("2026-08-22T09:00:00.000Z");

const APPOINTMENT: GpPmsRecord = {
  recordId: "gp-rec-0001",
  patientRef: "PT-10293",
  recordType: "appointment",
  capturedAt: "2026-08-20T09:15:00.000Z",
  payload: {},
};
const REGISTRATION: GpPmsRecord = {
  recordId: "gp-rec-0002",
  patientRef: "PT-10294",
  recordType: "registration",
  capturedAt: "2026-08-21T11:00:00.000Z",
  payload: {},
};
const CAPACITY: GpPmsRecord = {
  recordId: "gp-rec-0003",
  patientRef: "PT-10295",
  recordType: "capacity",
  capturedAt: "2026-08-22T08:00:00.000Z",
  payload: { availableSlotsToday: 12, bookedSlotsToday: 47 },
};

test("happy path: all three record types present, no uncertainty flags", async () => {
  const { insights } = await generateInsights([APPOINTMENT, REGISTRATION, CAPACITY], {
    now: FIXED_NOW,
    idempotencyKey: "gp-pms-insights-test-1",
    trustLogger: new FakeTrustLogger(),
  });

  assert.equal(insights.recordCount, 3);
  assert.deepEqual(insights.recordCountsByType, { appointment: 1, registration: 1, capacity: 1 });
  assert.equal(insights.mostRecentCaptureAt, "2026-08-22T08:00:00.000Z");
  assert.equal(insights.capacityUtilization, 47 / 59);
  assert.deepEqual(insights.dataUncertainties, []);
});

test("trust spine: a completed prediction process is logged exactly once with its transaction ID", async () => {
  const trustLogger = new FakeTrustLogger();
  const { transactionId } = await generateInsights([APPOINTMENT, REGISTRATION, CAPACITY], {
    now: FIXED_NOW,
    idempotencyKey: "gp-pms-insights-test-trust",
    trustLogger,
  });

  assert.equal(trustLogger.records.length, 1);
  assert.equal(trustLogger.records[0]?.processType, "prediction");
  assert.equal(typeof transactionId, "string");
});

test("trust spine: replaying the same idempotencyKey reuses the same transaction ID", async () => {
  const trustLogger = new FakeTrustLogger();
  const first = await generateInsights([APPOINTMENT, REGISTRATION, CAPACITY], {
    now: FIXED_NOW,
    idempotencyKey: "gp-pms-insights-test-replay",
    trustLogger,
  });
  const second = await generateInsights([APPOINTMENT, REGISTRATION, CAPACITY], {
    now: FIXED_NOW,
    idempotencyKey: "gp-pms-insights-test-replay",
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
      generateInsights([APPOINTMENT, REGISTRATION, CAPACITY], {
        now: FIXED_NOW,
        idempotencyKey: "gp-pms-insights-test-log-failure",
        trustLogger,
      }),
    (error: unknown) => error instanceof TrustSpineError && error.errorClass === "LogWriteError",
  );
});

test("uncertainty: empty input flags no_records_ingested and every missing type", async () => {
  const { insights } = await generateInsights([], {
    now: FIXED_NOW,
    idempotencyKey: "gp-pms-insights-test-empty",
    trustLogger: new FakeTrustLogger(),
  });

  assert.equal(insights.recordCount, 0);
  assert.equal(insights.mostRecentCaptureAt, null);
  assert.equal(insights.capacityUtilization, null);
  assert.ok(insights.dataUncertainties.includes("no_records_ingested"));
  assert.ok(insights.dataUncertainties.includes("missing_record_type:appointment"));
  assert.ok(insights.dataUncertainties.includes("missing_record_type:registration"));
  assert.ok(insights.dataUncertainties.includes("missing_record_type:capacity"));
});

test("uncertainty: a missing record type is flagged without affecting the ones present", async () => {
  const shortlyAfterAppointment = new Date("2026-08-20T10:00:00.000Z");
  const { insights } = await generateInsights([APPOINTMENT], {
    now: shortlyAfterAppointment,
    idempotencyKey: "gp-pms-insights-test-missing-type",
    trustLogger: new FakeTrustLogger(),
  });

  assert.deepEqual(insights.dataUncertainties, [
    "missing_record_type:registration",
    "missing_record_type:capacity",
  ]);
});

test("uncertainty: data older than the staleness threshold is flagged", async () => {
  const farFuture = new Date("2026-08-25T09:00:00.000Z"); // 3 days after CAPACITY.capturedAt
  const { insights } = await generateInsights([APPOINTMENT, REGISTRATION, CAPACITY], {
    now: farFuture,
    idempotencyKey: "gp-pms-insights-test-stale",
    trustLogger: new FakeTrustLogger(),
  });

  assert.ok(insights.dataUncertainties.includes("stale_data"));
});

test("uncertainty: malformed capacity payload is flagged and yields no utilization figure", async () => {
  const malformedCapacity: GpPmsRecord = {
    ...CAPACITY,
    payload: { availableSlotsToday: "twelve" },
  };
  const { insights } = await generateInsights([APPOINTMENT, REGISTRATION, malformedCapacity], {
    now: FIXED_NOW,
    idempotencyKey: "gp-pms-insights-test-malformed",
    trustLogger: new FakeTrustLogger(),
  });

  assert.equal(insights.capacityUtilization, null);
  assert.ok(insights.dataUncertainties.includes("capacity_payload_malformed"));
});
