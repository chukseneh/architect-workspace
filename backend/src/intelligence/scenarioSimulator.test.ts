import test from "node:test";
import assert from "node:assert/strict";
import { simulateScenario, ScenarioAttemptLogEntry } from "./scenarioSimulator";
import { FakeScenarioSimulatorClient } from "./fakeScenarioSimulatorClient";
import { ScenarioSimulatorClient, ScenarioSimulatorRequestOptions } from "./scenarioSimulatorTypes";
import { FakeTrustLogger } from "../services/trustSpine/fakeTrustLogger";
import { TrustSpineError } from "../services/trustSpine/types";

const VALID_INPUT = {
  icbName: "NHS Leeds ICB",
  currentPressureLevel: "High",
  currentPrimaryDriver: "ambulance_handover_delay",
  scenario: "divert_ambulances",
};

/** Deliberately implausible per detectScenarioConflict: Low pressure with an active driver. */
const CONFLICTING_INPUT = {
  icbName: "NHS Leeds ICB",
  currentPressureLevel: "Low",
  currentPrimaryDriver: "ambulance_handover_delay",
  scenario: "divert_ambulances",
};

function collectLogs() {
  const logs: ScenarioAttemptLogEntry[] = [];
  return { logs, logger: (entry: ScenarioAttemptLogEntry) => logs.push(entry) };
}

test("happy path: valid input produces a logged projection within the timeout", async () => {
  const trustLogger = new FakeTrustLogger();
  const startedAt = Date.now();
  const result = await simulateScenario(VALID_INPUT, {
    idempotencyKey: "scenario-test-1",
    client: new FakeScenarioSimulatorClient(),
    trustLogger,
  });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(result.outcome, "success");
  if (result.outcome === "success") {
    assert.equal(result.projection.pressure_change, "Improves");
    assert.deepEqual(result.conflictFlags, []);
    assert.equal(result.attempts, 1);
    assert.equal(typeof result.transactionId, "string");
  }
  assert.ok(elapsedMs < 5000, `expected well under the 5-second engine default, got ${elapsedMs}ms`);
});

test("conflicting scenario inputs: a plausibility conflict is flagged but the projection still runs", async () => {
  const trustLogger = new FakeTrustLogger();
  const result = await simulateScenario(CONFLICTING_INPUT, {
    idempotencyKey: "scenario-test-conflict",
    client: new FakeScenarioSimulatorClient(),
    trustLogger,
  });

  assert.equal(result.outcome, "success", "a conflict must be flagged, not rejected");
  if (result.outcome === "success") {
    assert.equal(result.conflictFlags.length, 1);
    assert.match(result.conflictFlags[0]!, /Low.*but current_primary_driver is "ambulance_handover_delay"/);
  }
  assert.equal(trustLogger.records.length, 1);
  assert.deepEqual(trustLogger.records[0]?.context?.conflictFlags, result.outcome === "success" ? result.conflictFlags : undefined);
});

test("trust: a completed simulation is logged with the scenario parameters", async () => {
  const trustLogger = new FakeTrustLogger();
  await simulateScenario(VALID_INPUT, {
    idempotencyKey: "scenario-test-trust",
    client: new FakeScenarioSimulatorClient(),
    trustLogger,
  });

  assert.equal(trustLogger.records.length, 1);
  const entry = trustLogger.records[0];
  assert.equal(entry?.processType, "prediction");
  assert.deepEqual(entry?.context?.scenarioParameters, VALID_INPUT);
});

test("trust spine: replaying the same idempotencyKey reuses the same transaction ID", async () => {
  const trustLogger = new FakeTrustLogger();
  const first = await simulateScenario(VALID_INPUT, {
    idempotencyKey: "scenario-test-replay",
    client: new FakeScenarioSimulatorClient(),
    trustLogger,
  });
  const second = await simulateScenario(VALID_INPUT, {
    idempotencyKey: "scenario-test-replay",
    client: new FakeScenarioSimulatorClient(),
    trustLogger,
  });

  assert.equal(trustLogger.records.length, 1, "the second run must not create a second trust-log entry");
  if (first.outcome === "success" && second.outcome === "success") {
    assert.equal(second.transactionId, first.transactionId);
  } else {
    assert.fail("both runs were expected to succeed");
  }
});

test("failure path: a trust-log write failure fails the simulation loudly instead of returning unlogged output", async () => {
  const trustLogger = new FakeTrustLogger();
  trustLogger.failNextWrite = true;

  await assert.rejects(
    () =>
      simulateScenario(VALID_INPUT, {
        idempotencyKey: "scenario-test-log-failure",
        client: new FakeScenarioSimulatorClient(),
        trustLogger,
      }),
    (error: unknown) => error instanceof TrustSpineError && error.errorClass === "LogWriteError",
  );
});

test("scenario input error: a malformed request returns an error message without calling the model", async () => {
  const client = new FakeScenarioSimulatorClient();
  const result = await simulateScenario(
    {
      icbName: "NHS Leeds ICB",
      currentPressureLevel: "Severe",
      currentPrimaryDriver: "ambulance_handover_delay",
      scenario: "divert_ambulances",
    },
    { idempotencyKey: "scenario-test-invalid-1", client, trustLogger: new FakeTrustLogger() },
  );

  assert.equal(result.outcome, "invalid_input");
  if (result.outcome === "invalid_input") {
    assert.match(result.errorMessage, /Invalid scenario simulator input/);
  }
  assert.equal(client.callCount, 0, "an invalid input must never reach the model");
});

test("scenario input error: a completely malformed payload (not even an object) is also rejected", async () => {
  const client = new FakeScenarioSimulatorClient();
  const result = await simulateScenario("not an object", {
    idempotencyKey: "scenario-test-invalid-2",
    client,
    trustLogger: new FakeTrustLogger(),
  });

  assert.equal(result.outcome, "invalid_input");
  assert.equal(client.callCount, 0);
});

test("trust: an invalid input is still logged (as a failure, with the raw parameters and validation error)", async () => {
  const trustLogger = new FakeTrustLogger();
  await simulateScenario(
    {
      icbName: "NHS Leeds ICB",
      currentPressureLevel: "Severe",
      currentPrimaryDriver: "none",
      scenario: "divert_ambulances",
    },
    { idempotencyKey: "scenario-test-invalid-trust", trustLogger, client: new FakeScenarioSimulatorClient() },
  );

  assert.equal(trustLogger.records.length, 1);
  assert.equal(trustLogger.records[0]?.errorClass, "InvalidInputError");
});

test("simulation processing failure: a timeout is retried to the cap, then fails as TimeoutError", async () => {
  const { logs, logger } = collectLogs();
  const result = await simulateScenario(VALID_INPUT, {
    idempotencyKey: "scenario-test-timeout",
    maxAttempts: 2,
    backoffBaseMs: 0,
    client: new FakeScenarioSimulatorClient({ failureMode: "timeout" }),
    logger,
    trustLogger: new FakeTrustLogger(),
  });

  assert.equal(result.outcome, "failure");
  if (result.outcome === "failure") {
    assert.equal(result.errorClass, "TimeoutError");
    assert.equal(result.attempts, 2);
  }
  assert.equal(logs.length, 2);
});

test("impact forecasting inaccuracy: malformed model output is retried to the cap, then fails as ValidationError", async () => {
  const result = await simulateScenario(VALID_INPUT, {
    idempotencyKey: "scenario-test-malformed",
    maxAttempts: 2,
    backoffBaseMs: 0,
    client: new FakeScenarioSimulatorClient({ failureMode: "malformedJson" }),
    trustLogger: new FakeTrustLogger(),
  });

  assert.equal(result.outcome, "failure");
  if (result.outcome === "failure") {
    assert.equal(result.errorClass, "ValidationError");
    assert.equal(result.attempts, 2);
  }
});

test("failure path: an auth error is never retried", async () => {
  const client = new FakeScenarioSimulatorClient({ failureMode: "auth" });
  const result = await simulateScenario(VALID_INPUT, {
    idempotencyKey: "scenario-test-auth",
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
  const flakyClient: ScenarioSimulatorClient = {
    async project(_prompt: string, _options: ScenarioSimulatorRequestOptions) {
      calls++;
      if (calls === 1) {
        const { ScenarioSimulatorError } = await import("./scenarioSimulatorTypes");
        throw new ScenarioSimulatorError("RateLimitError", "rate limited on first attempt");
      }
      return JSON.stringify({
        projected_pressure_level: "Medium",
        pressure_change: "Improves",
        confidence: 0.85,
        key_assumptions: ["recovered"],
      });
    },
  };

  const result = await simulateScenario(VALID_INPUT, {
    idempotencyKey: "scenario-test-recovery",
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
