import test from "node:test";
import assert from "node:assert/strict";
import { FakeNhsCentralDataClient } from "./fakeNhsCentralDataClient";
import { ingestNhsCentralData, IngestionLogEntry } from "./ingestNhsCentralData";
import { FakeTrustLogger } from "../trustSpine/fakeTrustLogger";
import { TrustSpineError } from "../trustSpine/types";

function collectLogs() {
  const logs: IngestionLogEntry[] = [];
  return { logs, logger: (entry: IngestionLogEntry) => logs.push(entry) };
}

test("happy path: returns all fixture records in one attempt", async () => {
  const { logs, logger } = collectLogs();
  const result = await ingestNhsCentralData(new FakeNhsCentralDataClient(), {
    since: "2026-08-01T00:00:00Z",
    idempotencyKey: "test-happy",
    timeoutMs: 1000,
    logger,
    trustLogger: new FakeTrustLogger(),
  });

  assert.equal(result.outcome, "success");
  if (result.outcome === "success") {
    assert.equal(result.records.length, 3);
    assert.equal(result.attempts, 1);
    assert.match(result.transactionId, /^[0-9a-f-]{36}$/);
  }
  assert.equal(logs.length, 1);
  assert.equal(logs[0]?.outcome, "success");
});

test("trust spine: a completed ingestion process is logged exactly once with its transaction ID", async () => {
  const trustLogger = new FakeTrustLogger();
  const result = await ingestNhsCentralData(new FakeNhsCentralDataClient(), {
    since: "2026-08-01T00:00:00Z",
    idempotencyKey: "test-trust",
    timeoutMs: 1000,
    trustLogger,
  });

  assert.equal(trustLogger.records.length, 1);
  assert.equal(trustLogger.records[0]?.processType, "ingestion");
  assert.equal(trustLogger.records[0]?.idempotencyKey, "test-trust");
  assert.equal(result.outcome, "success");
  if (result.outcome === "success") {
    assert.equal(typeof result.transactionId, "string");
  }
});

test("trust spine: replaying the same idempotencyKey reuses the same transaction ID", async () => {
  const trustLogger = new FakeTrustLogger();
  const first = await ingestNhsCentralData(new FakeNhsCentralDataClient(), {
    since: "2026-08-01T00:00:00Z",
    idempotencyKey: "test-replay",
    timeoutMs: 1000,
    trustLogger,
  });
  const second = await ingestNhsCentralData(new FakeNhsCentralDataClient(), {
    since: "2026-08-01T00:00:00Z",
    idempotencyKey: "test-replay",
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
      ingestNhsCentralData(new FakeNhsCentralDataClient(), {
        since: "2026-08-01T00:00:00Z",
        idempotencyKey: "test-log-failure",
        timeoutMs: 1000,
        trustLogger,
      }),
    (error: unknown) => error instanceof TrustSpineError && error.errorClass === "LogWriteError",
  );
});

test("failure path: format mismatch fails on the first attempt and is never retried", async () => {
  const { logs, logger } = collectLogs();
  const result = await ingestNhsCentralData(new FakeNhsCentralDataClient({ failureMode: "format" }), {
    since: "2026-08-01T00:00:00Z",
    idempotencyKey: "test-format",
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
  assert.equal(logs.length, 1, "a non-retryable failure should not be retried");
});

test("failure path: connection failure retries up to the cap, logging every attempt", async () => {
  const { logs, logger } = collectLogs();
  const result = await ingestNhsCentralData(new FakeNhsCentralDataClient({ failureMode: "connection" }), {
    since: "2026-08-01T00:00:00Z",
    idempotencyKey: "test-connection",
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
});

test("failure path: timeout is caller-enforced (not left to the client), retries to the cap, and returns promptly", async () => {
  const { logs, logger } = collectLogs();
  const startedAt = Date.now();

  const result = await ingestNhsCentralData(new FakeNhsCentralDataClient({ failureMode: "timeout" }), {
    since: "2026-08-01T00:00:00Z",
    idempotencyKey: "test-timeout",
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
  // Regression guard: the wrapper originally assumed every client
  // self-enforces timeoutMs (true only for the real MCP client's SDK-level
  // timeout) and never built its own AbortController, so FakeNhsCentralDataClient
  // ran its full 60s simulated delay per attempt instead of being cut off.
  assert.ok(
    elapsedMs < 5000,
    `expected the wrapper's own timeout enforcement to govern how long this takes, got ${elapsedMs}ms`,
  );
});
