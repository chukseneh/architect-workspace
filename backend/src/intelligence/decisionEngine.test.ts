import test from "node:test";
import assert from "node:assert/strict";
import { makeDecision, DecisionAttemptLogEntry } from "./decisionEngine";
import { FakeDecisionEngineClient } from "./fakeDecisionEngineClient";
import { DecisionEngineClient, DecisionEngineRequestOptions } from "./decisionEngineTypes";
import { FakeTrustLogger } from "../services/trustSpine/fakeTrustLogger";
import { TrustSpineError } from "../services/trustSpine/types";

const VALID_INPUT = {
  icbName: "NHS Leeds ICB",
  pressureLevel: "High",
  primaryDriver: "ambulance_handover_delay",
  availableLevers: ["divert_ambulances", "call_in_additional_staff"],
};

function collectLogs() {
  const logs: DecisionAttemptLogEntry[] = [];
  return { logs, logger: (entry: DecisionAttemptLogEntry) => logs.push(entry) };
}

test("happy path: valid input produces a logged recommendation within the timeout", async () => {
  const trustLogger = new FakeTrustLogger();
  const startedAt = Date.now();
  const result = await makeDecision(VALID_INPUT, {
    idempotencyKey: "decision-test-1",
    client: new FakeDecisionEngineClient(),
    trustLogger,
  });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(result.outcome, "success");
  if (result.outcome === "success") {
    assert.equal(result.recommendation.top_intervention, "call_in_additional_staff");
    assert.equal(result.attempts, 1);
    assert.equal(typeof result.transactionId, "string");
  }
  assert.ok(elapsedMs < 5000, `expected well under the 5-second criterion, got ${elapsedMs}ms`);
});

test("trust: a completed decision is logged with a timestamp and the decision parameters", async () => {
  const trustLogger = new FakeTrustLogger();
  await makeDecision(VALID_INPUT, {
    idempotencyKey: "decision-test-trust",
    client: new FakeDecisionEngineClient(),
    trustLogger,
  });

  assert.equal(trustLogger.records.length, 1);
  const entry = trustLogger.records[0];
  assert.equal(entry?.processType, "prediction");
  // Every TrustLogEntry the real FileTrustLogger writes carries a mandatory
  // timestamp (see trustSpine/types.ts) — already covered by STORY-011's
  // own tests, so this test only checks the new decisionParameters context field.
  assert.deepEqual(entry?.context?.decisionParameters, VALID_INPUT);
});

test("trust spine: replaying the same idempotencyKey reuses the same transaction ID", async () => {
  const trustLogger = new FakeTrustLogger();
  const first = await makeDecision(VALID_INPUT, {
    idempotencyKey: "decision-test-replay",
    client: new FakeDecisionEngineClient(),
    trustLogger,
  });
  const second = await makeDecision(VALID_INPUT, {
    idempotencyKey: "decision-test-replay",
    client: new FakeDecisionEngineClient(),
    trustLogger,
  });

  assert.equal(trustLogger.records.length, 1, "the second run must not create a second trust-log entry");
  if (first.outcome === "success" && second.outcome === "success") {
    assert.equal(second.transactionId, first.transactionId);
  } else {
    assert.fail("both runs were expected to succeed");
  }
});

test("failure path: a trust-log write failure fails the decision loudly instead of returning unlogged output", async () => {
  const trustLogger = new FakeTrustLogger();
  trustLogger.failNextWrite = true;

  await assert.rejects(
    () =>
      makeDecision(VALID_INPUT, {
        idempotencyKey: "decision-test-log-failure",
        client: new FakeDecisionEngineClient(),
        trustLogger,
      }),
    (error: unknown) => error instanceof TrustSpineError && error.errorClass === "LogWriteError",
  );
});

test("invalid input format: a malformed request returns an error message without calling the model", async () => {
  const client = new FakeDecisionEngineClient();
  const result = await makeDecision(
    { icbName: "NHS Leeds ICB", pressureLevel: "Severe", primaryDriver: "ambulance_handover_delay", availableLevers: [] },
    { idempotencyKey: "decision-test-invalid-1", client, trustLogger: new FakeTrustLogger() },
  );

  assert.equal(result.outcome, "invalid_input");
  if (result.outcome === "invalid_input") {
    assert.match(result.errorMessage, /Invalid decision engine input/);
  }
  assert.equal(client.callCount, 0, "an invalid input must never reach the model");
});

test("invalid input format: a completely malformed payload (not even an object) is also rejected", async () => {
  const client = new FakeDecisionEngineClient();
  const result = await makeDecision("not an object", {
    idempotencyKey: "decision-test-invalid-2",
    client,
    trustLogger: new FakeTrustLogger(),
  });

  assert.equal(result.outcome, "invalid_input");
  assert.equal(client.callCount, 0);
});

test("trust: an invalid input is still logged (as a failure, with the raw parameters and validation error)", async () => {
  const trustLogger = new FakeTrustLogger();
  await makeDecision(
    { icbName: "NHS Leeds ICB", pressureLevel: "Severe", primaryDriver: "none", availableLevers: [] },
    { idempotencyKey: "decision-test-invalid-trust", trustLogger, client: new FakeDecisionEngineClient() },
  );

  assert.equal(trustLogger.records.length, 1);
  assert.equal(trustLogger.records[0]?.errorClass, "InvalidInputError");
});

test("decision output exceeds time limit: a timeout is retried to the cap, then fails as TimeoutError", async () => {
  const { logs, logger } = collectLogs();
  const result = await makeDecision(VALID_INPUT, {
    idempotencyKey: "decision-test-timeout",
    maxAttempts: 2,
    backoffBaseMs: 0,
    client: new FakeDecisionEngineClient({ failureMode: "timeout" }),
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

test("failure path: malformed model output is retried to the cap, then fails as ValidationError", async () => {
  const result = await makeDecision(VALID_INPUT, {
    idempotencyKey: "decision-test-malformed",
    maxAttempts: 2,
    backoffBaseMs: 0,
    client: new FakeDecisionEngineClient({ failureMode: "malformedJson" }),
    trustLogger: new FakeTrustLogger(),
  });

  assert.equal(result.outcome, "failure");
  if (result.outcome === "failure") {
    assert.equal(result.errorClass, "ValidationError");
    assert.equal(result.attempts, 2);
  }
});

test("failure path: an auth error is never retried", async () => {
  const client = new FakeDecisionEngineClient({ failureMode: "auth" });
  const result = await makeDecision(VALID_INPUT, {
    idempotencyKey: "decision-test-auth",
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
  const flakyClient: DecisionEngineClient = {
    async predict(_prompt: string, _options: DecisionEngineRequestOptions) {
      calls++;
      if (calls === 1) {
        const { DecisionEngineError } = await import("./decisionEngineTypes");
        throw new DecisionEngineError("RateLimitError", "rate limited on first attempt");
      }
      return JSON.stringify({
        top_intervention: "divert_ambulances",
        expected_impact: "High",
        confidence: 0.85,
        rationale: "recovered",
      });
    },
  };

  const result = await makeDecision(VALID_INPUT, {
    idempotencyKey: "decision-test-recovery",
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
