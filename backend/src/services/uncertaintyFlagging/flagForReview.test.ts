import test from "node:test";
import assert from "node:assert/strict";
import { flagForReview } from "./flagForReview";
import { FakeTrustLogger } from "../trustSpine/fakeTrustLogger";
import { TrustSpineError } from "../trustSpine/types";
import { DataRecord } from "./types";

const CERTAIN_RECORD: DataRecord = {
  system: "Staffing",
  metric: "nurses_on_shift",
  value: 20,
  recordedAt: "2026-08-21T07:00:00.000Z",
  lastUpdatedMinutesAgo: 1,
  expectedUpdateFrequencyMinutes: 15,
  conflictingSourceValue: null,
};

const UNCERTAIN_RECORD: DataRecord = {
  system: "Emergency",
  metric: "available_beds",
  value: 3,
  recordedAt: "2026-08-21T02:00:00.000Z",
  lastUpdatedMinutesAgo: 300,
  expectedUpdateFrequencyMinutes: 15,
  conflictingSourceValue: null,
};

test("happy path: certain data is evaluated and not flagged", async () => {
  const trustLogger = new FakeTrustLogger();
  const result = await flagForReview(CERTAIN_RECORD, { idempotencyKey: "flag-test-certain", trustLogger });

  assert.equal(result.outcome, "success");
  if (result.outcome === "success") {
    assert.equal(result.result.uncertain, false);
    assert.equal(result.mechanismFailure, false);
    assert.equal(typeof result.transactionId, "string");
  }
});

test("happy path: uncertain data is evaluated and flagged for review", async () => {
  const trustLogger = new FakeTrustLogger();
  const result = await flagForReview(UNCERTAIN_RECORD, { idempotencyKey: "flag-test-uncertain", trustLogger });

  assert.equal(result.outcome, "success");
  if (result.outcome === "success") {
    assert.equal(result.result.uncertain, true);
    assert.equal(result.result.category, "stale_data");
    assert.equal(result.mechanismFailure, false);
  }
});

test("false positive check: certain data never comes back flagged across repeated healthy inputs", async () => {
  const trustLogger = new FakeTrustLogger();
  for (let i = 0; i < 5; i++) {
    const result = await flagForReview(
      { ...CERTAIN_RECORD, lastUpdatedMinutesAgo: i },
      { idempotencyKey: `flag-test-fp-${i}`, trustLogger },
    );
    assert.equal(result.outcome, "success");
    if (result.outcome === "success") {
      assert.equal(result.result.uncertain, false, `iteration ${i} should not be flagged`);
    }
  }
});

test("scenario input error: a malformed record returns invalid_input without calling the detector", async () => {
  let detectorCalled = false;
  const result = await flagForReview(
    { system: "Emergency", metric: "available_beds", value: "not a number" },
    {
      idempotencyKey: "flag-test-invalid",
      trustLogger: new FakeTrustLogger(),
      detector: () => {
        detectorCalled = true;
        throw new Error("should never be called");
      },
    },
  );

  assert.equal(result.outcome, "invalid_input");
  assert.equal(detectorCalled, false, "an invalid record must never reach the detector");
});

test("flagging mechanism failure: a detector that throws is flagged for review, not silently passed", async () => {
  const trustLogger = new FakeTrustLogger();
  const result = await flagForReview(CERTAIN_RECORD, {
    idempotencyKey: "flag-test-mechanism-failure",
    trustLogger,
    detector: () => {
      throw new Error("simulated detector bug");
    },
  });

  assert.equal(result.outcome, "success");
  if (result.outcome === "success") {
    assert.equal(result.mechanismFailure, true);
    assert.equal(result.result.uncertain, true, "a mechanism failure must fail safe toward 'flag it', never toward 'pass it'");
  }
  assert.equal(trustLogger.records.length, 1);
  assert.equal(trustLogger.records[0]?.outcome, "failure");
  assert.equal(trustLogger.records[0]?.errorClass, "FlagEvaluationError");
});

test("data processing delay: a detector that never resolves in time is flagged for review, not silently passed", async () => {
  const trustLogger = new FakeTrustLogger();
  const result = await flagForReview(CERTAIN_RECORD, {
    idempotencyKey: "flag-test-timeout",
    timeoutMs: 20,
    trustLogger,
    detector: () =>
      new Promise((resolve) => {
        // A genuinely async delay past the timeout budget -- unlike a
        // synchronous busy-wait, this actually yields to the event loop,
        // so flagForReview's timeout race can preempt it for real.
        setTimeout(
          () => resolve({ uncertain: false, category: "none", confidenceScore: 0.95, reason: "should not be reached in time" }),
          50,
        );
      }),
  });

  assert.equal(result.outcome, "success");
  if (result.outcome === "success") {
    assert.equal(result.mechanismFailure, true);
    assert.equal(result.result.uncertain, true);
  }
  assert.equal(trustLogger.records[0]?.errorClass, "TimeoutError");
});

test("trust: a completed flagging run is logged with the record and outcome", async () => {
  const trustLogger = new FakeTrustLogger();
  await flagForReview(UNCERTAIN_RECORD, { idempotencyKey: "flag-test-trust", trustLogger });

  assert.equal(trustLogger.records.length, 1);
  const entry = trustLogger.records[0];
  assert.equal(entry?.processType, "prediction");
  assert.deepEqual(entry?.context?.record, UNCERTAIN_RECORD);
  assert.equal(entry?.context?.category, "stale_data");
});

test("trust spine: replaying the same idempotencyKey reuses the same transaction ID", async () => {
  const trustLogger = new FakeTrustLogger();
  const first = await flagForReview(CERTAIN_RECORD, { idempotencyKey: "flag-test-replay", trustLogger });
  const second = await flagForReview(CERTAIN_RECORD, { idempotencyKey: "flag-test-replay", trustLogger });

  assert.equal(trustLogger.records.length, 1, "the second run must not create a second trust-log entry");
  if (first.outcome === "success" && second.outcome === "success") {
    assert.equal(second.transactionId, first.transactionId);
  } else {
    assert.fail("both runs were expected to succeed");
  }
});

test("failure path: a trust-log write failure fails the flagging run loudly instead of returning unlogged output", async () => {
  const trustLogger = new FakeTrustLogger();
  trustLogger.failNextWrite = true;

  await assert.rejects(
    () => flagForReview(CERTAIN_RECORD, { idempotencyKey: "flag-test-log-failure", trustLogger }),
    (error: unknown) => error instanceof TrustSpineError && error.errorClass === "LogWriteError",
  );
});
