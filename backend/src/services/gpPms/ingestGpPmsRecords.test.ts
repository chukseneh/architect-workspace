import test from "node:test";
import assert from "node:assert/strict";
import { MockGpPmsClient } from "./mockGpPmsClient";
import { ingestGpPmsRecords, IngestionLogEntry } from "./ingestGpPmsRecords";

function collectLogs() {
  const logs: IngestionLogEntry[] = [];
  return { logs, logger: (entry: IngestionLogEntry) => logs.push(entry) };
}

test("happy path: returns all fixture records in one attempt", async () => {
  const { logs, logger } = collectLogs();
  const result = await ingestGpPmsRecords(new MockGpPmsClient(), { timeoutMs: 1000, logger });

  assert.equal(result.outcome, "success");
  if (result.outcome === "success") {
    assert.equal(result.records.length, 3);
    assert.equal(result.attempts, 1);
  }
  assert.equal(logs.length, 1);
  assert.equal(logs[0]?.outcome, "success");
  assert.equal(typeof logs[0]?.timestamp, "string");
});

test("happy path: since filter narrows to records captured at/after the cutoff", async () => {
  const { logger } = collectLogs();
  const result = await ingestGpPmsRecords(new MockGpPmsClient(), {
    since: "2026-08-21T00:00:00.000Z",
    timeoutMs: 1000,
    logger,
  });

  assert.equal(result.outcome, "success");
  if (result.outcome === "success") {
    assert.equal(result.records.length, 2);
  }
});

test("failure path: format mismatch fails on the first attempt and is never retried", async () => {
  const { logs, logger } = collectLogs();
  const result = await ingestGpPmsRecords(new MockGpPmsClient({ failureMode: "format" }), {
    timeoutMs: 1000,
    maxAttempts: 3,
    backoffBaseMs: 0,
    logger,
  });

  assert.equal(result.outcome, "failure");
  if (result.outcome === "failure") {
    assert.equal(result.errorClass, "FormatMismatchError");
    assert.equal(result.attempts, 1);
  }
  assert.equal(logs.length, 1, "a retryable-looking failure should not be retried");
});

test("failure path: connection failure retries up to the cap, logging every attempt", async () => {
  const { logs, logger } = collectLogs();
  const result = await ingestGpPmsRecords(new MockGpPmsClient({ failureMode: "connection" }), {
    timeoutMs: 1000,
    maxAttempts: 3,
    backoffBaseMs: 0,
    logger,
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
    timeoutMs: 100,
    maxAttempts: 2,
    backoffBaseMs: 10,
    logger,
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
