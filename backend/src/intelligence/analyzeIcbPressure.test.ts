import test from "node:test";
import assert from "node:assert/strict";
import { analyzeIcbPressure } from "./analyzeIcbPressure";
import { FakeNhsCentralDataClient } from "../services/nhsCentralData/fakeNhsCentralDataClient";
import { MockAmbulanceClient } from "../services/ambulance/mockAmbulanceClient";
import { MockCommunityClient } from "../services/community/mockCommunityClient";
import { FakePressurePredictionClient } from "./fakePressurePredictionClient";
import { FakeTrustLogger } from "../services/trustSpine/fakeTrustLogger";

const FIXED_NOW = new Date("2026-08-27T08:00:00.000Z");

function baseOptions(overrides: Partial<Parameters<typeof analyzeIcbPressure>[0]> = {}) {
  return {
    icbName: "NHS Greater Manchester ICB",
    since: "2026-01-01T00:00:00.000Z",
    idempotencyKey: "icb-pressure-test",
    timeoutMs: 5000,
    now: FIXED_NOW,
    nhsClient: new FakeNhsCentralDataClient(),
    ambulanceClient: new MockAmbulanceClient(),
    communityClient: new MockCommunityClient(),
    predictionClient: new FakePressurePredictionClient(),
    trustLogger: new FakeTrustLogger(),
    ...overrides,
  };
}

test("happy path: ingests all three sources and produces a logged prediction", async () => {
  const result = await analyzeIcbPressure(baseOptions());

  assert.equal(result.outcome, "success");
  if (result.outcome === "success") {
    assert.equal(result.prediction.pressure_level, "Low");
    assert.equal(typeof result.transactionId, "string");
  }
});

test("trust: every step of the run shares one trust log, one entry per step", async () => {
  const trustLogger = new FakeTrustLogger();
  await analyzeIcbPressure(baseOptions({ trustLogger }));

  const processNames = trustLogger.records.map((record) => record.processName);
  assert.deepEqual(processNames, [
    "ingestNhsCentralData",
    "ingestAmbulanceRecords",
    "ingestCommunityRecords",
    "generateAmbulanceInsights",
    "generateCommunityInsights",
    "generatePressurePrediction",
  ]);
});

test("data processing error: an NHS central data ingestion failure short-circuits before ambulance/community are touched", async () => {
  const result = await analyzeIcbPressure(
    baseOptions({ nhsClient: new FakeNhsCentralDataClient({ failureMode: "connection" }) }),
  );

  assert.equal(result.outcome, "data_processing_error");
  if (result.outcome === "data_processing_error") {
    assert.equal(result.source, "nhsCentralData");
    assert.equal(result.errorClass, "ConnectionError");
  }
});

test("data processing error: an ambulance ingestion failure short-circuits before community is touched", async () => {
  const result = await analyzeIcbPressure(
    baseOptions({ ambulanceClient: new MockAmbulanceClient({ failureMode: "connection" }) }),
  );

  assert.equal(result.outcome, "data_processing_error");
  if (result.outcome === "data_processing_error") {
    assert.equal(result.source, "ambulance");
    assert.equal(result.errorClass, "ConnectionError");
  }
});

test("no data: an ICB with no matching NHS central data record notifies the caller", async () => {
  const result = await analyzeIcbPressure(baseOptions({ icbName: "NHS Nonexistent ICB" }));

  assert.equal(result.outcome, "no_data");
});

test("insight generation failure: a non-retryable model error surfaces distinctly from a data processing error", async () => {
  const result = await analyzeIcbPressure(
    baseOptions({ predictionClient: new FakePressurePredictionClient({ failureMode: "auth" }) }),
  );

  assert.equal(result.outcome, "insight_generation_failure");
  if (result.outcome === "insight_generation_failure") {
    assert.equal(result.errorClass, "AuthError");
  }
});
