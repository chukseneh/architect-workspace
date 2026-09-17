import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_DECISION_CYCLE_BUDGET_MS, runDecisionCycle } from "./decisionCycle";
import { FakeNhsCentralDataClient } from "../services/nhsCentralData/fakeNhsCentralDataClient";
import { MockAmbulanceClient } from "../services/ambulance/mockAmbulanceClient";
import { MockCommunityClient } from "../services/community/mockCommunityClient";
import { FakePressurePredictionClient } from "./fakePressurePredictionClient";
import { PressurePredictionClient, PressurePredictionRequestOptions } from "./types";
import { FakeTrustLogger } from "../services/trustSpine/fakeTrustLogger";

/** Tracks how many `predict()` calls were ever in flight at once, to prove a concurrency cap holds. */
class ConcurrencyTrackingPredictionClient implements PressurePredictionClient {
  inFlight = 0;
  maxObservedInFlight = 0;

  async predict(_prompt: string, _options: PressurePredictionRequestOptions): Promise<string> {
    this.inFlight++;
    this.maxObservedInFlight = Math.max(this.maxObservedInFlight, this.inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    this.inFlight--;
    return JSON.stringify({
      pressure_level: "Low",
      confidence: 0.9,
      horizon: "4-24h",
      contributing_factors: ["OPEL level 1", "all metrics nominal"],
    });
  }
}

const FIXED_NOW = new Date("2026-08-27T08:00:00.000Z");

/** The three ICBs FakeNhsCentralDataClient's fixture actually has records for. */
const ALL_FIXTURE_ICBS = ["NHS Greater Manchester ICB", "NHS South East London ICB", "NHS West Yorkshire ICB"];

function baseOptions(overrides: Partial<Parameters<typeof runDecisionCycle>[0]> = {}) {
  return {
    icbNames: ALL_FIXTURE_ICBS,
    since: "2026-01-01T00:00:00.000Z",
    idempotencyKey: "decision-cycle-test",
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

test("happy path: produces one prediction per ICB and reports within-budget timing", async () => {
  const result = await runDecisionCycle(baseOptions());

  assert.equal(result.outcome, "success");
  if (result.outcome === "success") {
    assert.equal(result.results.length, ALL_FIXTURE_ICBS.length);
    assert.ok(result.results.every((r) => r.outcome === "success"));
    assert.equal(result.budgetMs, DEFAULT_DECISION_CYCLE_BUDGET_MS);
    assert.equal(result.withinBudget, true);
    assert.equal(result.stepTimings.length, 3);
    assert.deepEqual(
      result.stepTimings.map((t) => t.step),
      ["sourceIngest", "insightGeneration", "predictions"],
    );
    assert.ok(result.totalDurationMs >= 0);
  }
});

test("high data volume: each shared source is ingested exactly once, not once per ICB", async () => {
  const trustLogger = new FakeTrustLogger();
  await runDecisionCycle(baseOptions({ trustLogger, icbNames: ALL_FIXTURE_ICBS }));

  const countOf = (processName: string) =>
    trustLogger.records.filter((r) => r.processName === processName).length;

  assert.equal(countOf("ingestNhsCentralData"), 1);
  assert.equal(countOf("ingestAmbulanceRecords"), 1);
  assert.equal(countOf("ingestCommunityRecords"), 1);
  assert.equal(countOf("generateAmbulanceInsights"), 1);
  assert.equal(countOf("generateCommunityInsights"), 1);
  // The one genuinely per-ICB step still runs once per ICB.
  assert.equal(countOf("generatePressurePrediction"), ALL_FIXTURE_ICBS.length);
});

test("trust: the run itself is logged exactly once with its performance metrics", async () => {
  const trustLogger = new FakeTrustLogger();
  await runDecisionCycle(baseOptions({ trustLogger }));

  const cycleEntries = trustLogger.records.filter((r) => r.processName === "runDecisionCycle");
  assert.equal(cycleEntries.length, 1);
  const [cycleEntry] = cycleEntries;
  assert.ok(cycleEntry);
  const context = cycleEntry.context as Record<string, unknown>;
  assert.equal(context.icbCount, ALL_FIXTURE_ICBS.length);
  assert.equal(context.withinBudget, true);
  assert.equal(typeof context.totalDurationMs, "number");
  assert.ok(Array.isArray(context.stepTimings));
});

test("an ICB with no matching NHS central data record is reported per-ICB, not a whole-run failure", async () => {
  const result = await runDecisionCycle(baseOptions({ icbNames: ["NHS Nonexistent ICB"] }));

  assert.equal(result.outcome, "success");
  if (result.outcome === "success") {
    assert.equal(result.results.length, 1);
    const [icbResult] = result.results;
    assert.ok(icbResult);
    assert.equal(icbResult.outcome, "no_data");
  }
});

test("data processing error: an NHS central data ingestion failure short-circuits before any prediction is attempted", async () => {
  const trustLogger = new FakeTrustLogger();
  const result = await runDecisionCycle(
    baseOptions({ trustLogger, nhsClient: new FakeNhsCentralDataClient({ failureMode: "connection" }) }),
  );

  assert.equal(result.outcome, "data_processing_error");
  if (result.outcome === "data_processing_error") {
    assert.equal(result.source, "nhsCentralData");
    assert.equal(result.errorClass, "ConnectionError");
  }
  assert.equal(trustLogger.records.some((r) => r.processName === "generatePressurePrediction"), false);
});

test("high data volume: prediction fan-out never exceeds the configured concurrency cap", async () => {
  const trackingClient = new ConcurrencyTrackingPredictionClient();
  // Repeat the 3 fixture ICBs to get 9 prediction calls total — each still
  // resolves against a real matching NHS record, so every one actually
  // reaches predict(), not a no_data short-circuit.
  const manyIcbNames = [...ALL_FIXTURE_ICBS, ...ALL_FIXTURE_ICBS, ...ALL_FIXTURE_ICBS];

  const result = await runDecisionCycle(
    baseOptions({ icbNames: manyIcbNames, predictionClient: trackingClient, maxConcurrentPredictions: 2 }),
  );

  assert.equal(result.outcome, "success");
  if (result.outcome === "success") {
    assert.equal(result.results.length, manyIcbNames.length);
  }
  assert.ok(
    trackingClient.maxObservedInFlight <= 2,
    `expected at most 2 concurrent predict() calls, observed ${trackingClient.maxObservedInFlight}`,
  );
  assert.ok(trackingClient.maxObservedInFlight > 1, "the cap should still allow real concurrency, not force full serialization");
});

test("a low budget is honestly reported as exceeded rather than silently passed", async () => {
  const result = await runDecisionCycle(baseOptions({ budgetMs: 0 }));

  assert.equal(result.outcome, "success");
  if (result.outcome === "success") {
    assert.equal(result.withinBudget, false);
  }
});
