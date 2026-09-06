import test from "node:test";
import assert from "node:assert/strict";
import { generatePressurePrediction, PredictionAttemptLogEntry } from "./predictPressure";
import { FakePressurePredictionClient } from "./fakePressurePredictionClient";
import { PressurePredictionClient, PressurePredictionRequestOptions } from "./types";
import { AmbulanceInsights } from "../services/ambulance/generateAmbulanceInsights";
import { CommunityInsights } from "../services/community/generateCommunityInsights";
import { NhsCentralDataRecord } from "../services/nhsCentralData/types";
import { FakeTrustLogger } from "../services/trustSpine/fakeTrustLogger";
import { TrustSpineError } from "../services/trustSpine/types";

const NHS_RECORD: NhsCentralDataRecord = {
  icbName: "NHS Leeds ICB",
  region: "Yorkshire and Humber",
  opelLevel: 1,
  ambulanceHandoverOver60MinPct: 5,
  dischargeDelayBeddays: 2,
  criticalCareOccupancyPct: 40,
  lastUpdated: "2026-08-22T08:00:00.000Z",
};

const AMBULANCE_WITH_DATA: AmbulanceInsights = {
  recordCount: 4,
  ambulanceHandoverOver60MinPct: 0.5,
  mostRecentCaptureAt: "2026-08-22T08:00:00.000Z",
  dataUncertainties: [],
};

const COMMUNITY_WITH_DATA: CommunityInsights = {
  recordCount: 4,
  dischargeDelayBedDays: 16,
  mostRecentCaptureAt: "2026-08-22T08:00:00.000Z",
  dataUncertainties: [],
};

const NO_AMBULANCE_DATA: AmbulanceInsights = {
  recordCount: 0,
  ambulanceHandoverOver60MinPct: null,
  mostRecentCaptureAt: null,
  dataUncertainties: ["no_records_ingested"],
};

const NO_COMMUNITY_DATA: CommunityInsights = {
  recordCount: 0,
  dischargeDelayBedDays: 0,
  mostRecentCaptureAt: null,
  dataUncertainties: ["no_records_ingested"],
};

function collectLogs() {
  const logs: PredictionAttemptLogEntry[] = [];
  return { logs, logger: (entry: PredictionAttemptLogEntry) => logs.push(entry) };
}

test("happy path: combines NHS, ambulance, and community data into a logged prediction", async () => {
  const trustLogger = new FakeTrustLogger();
  const result = await generatePressurePrediction(NHS_RECORD, AMBULANCE_WITH_DATA, COMMUNITY_WITH_DATA, {
    idempotencyKey: "predict-pressure-test-1",
    timeoutMs: 5000,
    client: new FakePressurePredictionClient(),
    trustLogger,
  });

  assert.equal(result.outcome, "success");
  if (result.outcome === "success") {
    assert.equal(result.prediction.pressure_level, "Low");
    assert.equal(result.attempts, 1);
    assert.equal(typeof result.transactionId, "string");
  }
});

test("trust: a completed prediction is logged with a timestamp and the data sources it drew from", async () => {
  const trustLogger = new FakeTrustLogger();
  await generatePressurePrediction(NHS_RECORD, AMBULANCE_WITH_DATA, COMMUNITY_WITH_DATA, {
    idempotencyKey: "predict-pressure-test-trust",
    timeoutMs: 5000,
    client: new FakePressurePredictionClient(),
    trustLogger,
  });

  assert.equal(trustLogger.records.length, 1);
  const entry = trustLogger.records[0];
  assert.equal(entry?.processType, "prediction");
  // Every TrustLogEntry the real FileTrustLogger writes carries a mandatory
  // timestamp (see trustSpine/types.ts) — already covered by STORY-011's
  // own tests, so this test only checks the new dataSource context field.
  assert.deepEqual(entry?.context?.dataSource, ["nhsCentralData", "ambulance", "community"]);
});

test("trust spine: replaying the same idempotencyKey reuses the same transaction ID", async () => {
  const trustLogger = new FakeTrustLogger();
  const first = await generatePressurePrediction(NHS_RECORD, AMBULANCE_WITH_DATA, COMMUNITY_WITH_DATA, {
    idempotencyKey: "predict-pressure-test-replay",
    timeoutMs: 5000,
    client: new FakePressurePredictionClient(),
    trustLogger,
  });
  const second = await generatePressurePrediction(NHS_RECORD, AMBULANCE_WITH_DATA, COMMUNITY_WITH_DATA, {
    idempotencyKey: "predict-pressure-test-replay",
    timeoutMs: 5000,
    client: new FakePressurePredictionClient(),
    trustLogger,
  });

  assert.equal(trustLogger.records.length, 1, "the second run must not create a second trust-log entry");
  if (first.outcome === "success" && second.outcome === "success") {
    assert.equal(second.transactionId, first.transactionId);
  } else {
    assert.fail("both runs were expected to succeed");
  }
});

test("failure path: a trust-log write failure fails prediction loudly instead of returning unlogged insights", async () => {
  const trustLogger = new FakeTrustLogger();
  trustLogger.failNextWrite = true;

  await assert.rejects(
    () =>
      generatePressurePrediction(NHS_RECORD, AMBULANCE_WITH_DATA, COMMUNITY_WITH_DATA, {
        idempotencyKey: "predict-pressure-test-log-failure",
        timeoutMs: 5000,
        client: new FakePressurePredictionClient(),
        trustLogger,
      }),
    (error: unknown) => error instanceof TrustSpineError && error.errorClass === "LogWriteError",
  );
});

test("no data: a missing NHS central data record notifies the caller instead of guessing", async () => {
  const trustLogger = new FakeTrustLogger();
  const result = await generatePressurePrediction(null, NO_AMBULANCE_DATA, NO_COMMUNITY_DATA, {
    idempotencyKey: "predict-pressure-test-no-data",
    timeoutMs: 5000,
    client: new FakePressurePredictionClient(),
    trustLogger,
  });

  assert.equal(result.outcome, "no_data");
  assert.equal(trustLogger.records.length, 1);
  assert.equal(trustLogger.records[0]?.errorClass, "NoDataAvailable");
});

test("partial data: missing ambulance/community insights are passed through as null, not treated as no_data", async () => {
  const result = await generatePressurePrediction(NHS_RECORD, NO_AMBULANCE_DATA, NO_COMMUNITY_DATA, {
    idempotencyKey: "predict-pressure-test-partial",
    timeoutMs: 5000,
    client: new FakePressurePredictionClient(),
    trustLogger: new FakeTrustLogger(),
  });

  assert.equal(result.outcome, "success");
});

test("failure path: malformed model output is retried to the cap, then fails as ValidationError", async () => {
  const { logs, logger } = collectLogs();
  const result = await generatePressurePrediction(NHS_RECORD, AMBULANCE_WITH_DATA, COMMUNITY_WITH_DATA, {
    idempotencyKey: "predict-pressure-test-malformed",
    timeoutMs: 5000,
    maxAttempts: 2,
    backoffBaseMs: 0,
    client: new FakePressurePredictionClient({ failureMode: "malformedJson" }),
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

test("failure path: an auth error is never retried", async () => {
  const client = new FakePressurePredictionClient({ failureMode: "auth" });
  const result = await generatePressurePrediction(NHS_RECORD, AMBULANCE_WITH_DATA, COMMUNITY_WITH_DATA, {
    idempotencyKey: "predict-pressure-test-auth",
    timeoutMs: 5000,
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

test("recovery: a transient rate-limit error on the first attempt succeeds on retry", async () => {
  let calls = 0;
  const flakyClient: PressurePredictionClient = {
    async predict(_prompt: string, _options: PressurePredictionRequestOptions) {
      calls++;
      if (calls === 1) {
        const { PredictPressureError } = await import("./types");
        throw new PredictPressureError("RateLimitError", "rate limited on first attempt");
      }
      return JSON.stringify({
        pressure_level: "Low",
        confidence: 0.9,
        horizon: "4-24h",
        contributing_factors: ["recovered"],
      });
    },
  };

  const result = await generatePressurePrediction(NHS_RECORD, AMBULANCE_WITH_DATA, COMMUNITY_WITH_DATA, {
    idempotencyKey: "predict-pressure-test-recovery",
    timeoutMs: 5000,
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
