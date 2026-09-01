import test from "node:test";
import assert from "node:assert/strict";
import { MockGpPmsClient } from "./mockGpPmsClient";
import { ingestGpPmsRecords, IngestionLogEntry } from "./ingestGpPmsRecords";
import { FakeTrustLogger } from "../trustSpine/fakeTrustLogger";
import { TrustSpineError } from "../trustSpine/types";

function collectLogs() {
  const logs: IngestionLogEntry[] = [];
  return { logs, logger: (entry: IngestionLogEntry) => logs.push(entry) };
}

test("happy path: returns all fixture records in one attempt", async () => {
  const { logs, logger } = collectLogs();
  const trustLogger = new FakeTrustLogger();
  const result = await ingestGpPmsRecords(new MockGpPmsClient(), {
    idempotencyKey: "gp-pms-test-1",
    timeoutMs: 1000,
    logger,
    trustLogger,
  });

  assert.equal(result.outcome, "success");
  if (result.outcome === "success") {
    assert.equal(result.records.length, 3);
    assert.equal(result.attempts, 1);
    assert.match(result.transactionId, /^[0-9a-f-]{36}$/);
  }
  assert.equal(logs.length, 1);
  assert.equal(logs[0]?.outcome, "success");
  assert.equal(typeof logs[0]?.timestamp, "string");
});

test("trust spine: a completed ingestion process is logged exactly once with its transaction ID", async () => {
  const trustLogger = new FakeTrustLogger();
  const result = await ingestGpPmsRecords(new MockGpPmsClient(), {
    idempotencyKey: "gp-pms-test-trust",
    timeoutMs: 1000,
    trustLogger,
  });

  assert.equal(trustLogger.records.length, 1);
  assert.equal(trustLogger.records[0]?.processType, "ingestion");
  assert.equal(trustLogger.records[0]?.idempotencyKey, "gp-pms-test-trust");
  assert.equal(result.outcome, "success");
  if (result.outcome === "success") {
    assert.equal(typeof result.transactionId, "string");
  }
});

test("trust spine: replaying the same idempotencyKey reuses the same transaction ID", async () => {
  const trustLogger = new FakeTrustLogger();
  const first = await ingestGpPmsRecords(new MockGpPmsClient(), {
    idempotencyKey: "gp-pms-test-replay",
    timeoutMs: 1000,
    trustLogger,
  });
  const second = await ingestGpPmsRecords(new MockGpPmsClient(), {
    idempotencyKey: "gp-pms-test-replay",
    timeoutMs: 1000,
    trustLogger,
  });

  assert.equal(trustLogger.records.length, 1, "the second run must not create a second trust-log entry");
  if (first.outcome === "success" && second.outcome === "success") {
    assert.equal(second.transactionId, first.transactionId);
  } else {
    assert.fail("both runs were expected to succeed");
  }
});

test("failure path: a trust-log write failure fails the ingestion loudly instead of returning an unlogged result", async () => {
  const trustLogger = new FakeTrustLogger();
  trustLogger.failNextWrite = true;

  await assert.rejects(
    () =>
      ingestGpPmsRecords(new MockGpPmsClient(), {
        idempotencyKey: "gp-pms-test-log-failure",
        timeoutMs: 1000,
        trustLogger,
      }),
    (error: unknown) => error instanceof TrustSpineError && error.errorClass === "LogWriteError",
  );
});

test("happy path: since filter narrows to records captured at/after the cutoff", async () => {
  const { logger } = collectLogs();
  const result = await ingestGpPmsRecords(new MockGpPmsClient(), {
    idempotencyKey: "gp-pms-test-since",
    since: "2026-08-21T00:00:00.000Z",
    timeoutMs: 1000,
    logger,
    trustLogger: new FakeTrustLogger(),
  });

  assert.equal(result.outcome, "success");
  if (result.outcome === "success") {
    assert.equal(result.records.length, 2);
  }
});

test("failure path: format mismatch fails on the first attempt and is never retried", async () => {
  const { logs, logger } = collectLogs();
  const result = await ingestGpPmsRecords(new MockGpPmsClient({ failureMode: "format" }), {
    idempotencyKey: "gp-pms-test-format",
    timeoutMs: 1000,
    maxAttempts: 3,
    backoffBaseMs: 0,
    logger,
    trustLogger: new FakeTrustLogger(),
  });

  assert.equal(result.outcome, "failure");
  if (result.outcome === "failure") {
    assert.equal(result.errorClass, "FormatMismatchError");
    assert.equal(result.attempts, 1);
    assert.equal(typeof result.transactionId, "string");
  }
  assert.equal(logs.length, 1, "a retryable-looking failure should not be retried");
});

test("failure path: connection failure retries up to the cap, logging every attempt", async () => {
  const { logs, logger } = collectLogs();
  const result = await ingestGpPmsRecords(new MockGpPmsClient({ failureMode: "connection" }), {
    idempotencyKey: "gp-pms-test-connection",
    timeoutMs: 1000,
    maxAttempts: 3,
    backoffBaseMs: 0,
    logger,
    trustLogger: new FakeTrustLogger(),
  });

  assert.equal(result.outcome, "failure");
  if (result.outcome === "failure") {
    assert.equal(result.errorClass, "ConnectionError");
    assert.equal(result.attempts, 3);
  }
  assert.equal(logs.length, 3);
  assert.ok(logs.every((entry) => entry.outcome === "failure" && entry.errorClass === "ConnectionError"));
});

test("failure path: timeout is caller-enforced, retries to the cap, and returns promptly", async () => {
  const { logs, logger } = collectLogs();
  const startedAt = Date.now();

  const result = await ingestGpPmsRecords(new MockGpPmsClient({ failureMode: "timeout" }), {
    idempotencyKey: "gp-pms-test-timeout",
    timeoutMs: 100,
    maxAttempts: 2,
    backoffBaseMs: 10,
    logger,
    trustLogger: new FakeTrustLogger(),
  });

  const elapsedMs = Date.now() - startedAt;

  assert.equal(result.outcome, "failure");
  if (result.outcome === "failure") {
    assert.equal(result.errorClass, "TimeoutError");
    assert.equal(result.attempts, 2);
  }
  assert.equal(logs.length, 2);
  // Regression guard for the abort-signal fix: without it, the abandoned
  // mock call keeps the process busy for its full simulated delay (60s)
  // per attempt instead of returning once the caller's timeout fires.
  assert.ok(
    elapsedMs < 5000,
    `expected the caller timeout (not the mock's internal delay) to govern how long this takes, got ${elapsedMs}ms`,
  );
});
