import test from "node:test";
import assert from "node:assert/strict";
// `import = require(...)` (not `import * as`) so this resolves to the real
// module object as a plain data property — TS's `import * as` namespace
// import compiles to a getter-only accessor, which node:test's
// `t.mock.method` cannot replace.
import nodeCrypto = require("node:crypto");
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FileTrustLogger } from "./fileTrustLogger";
import { TrustSpineError } from "./types";

async function withTempLogger(run: (logger: FileTrustLogger, filePath: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "trust-log-"));
  const filePath = join(dir, "trust-log.jsonl");
  try {
    await run(new FileTrustLogger(filePath), filePath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("happy path: ingestion and prediction runs each get a unique, logged transaction ID", async () => {
  await withTempLogger(async (logger) => {
    const ingestion = await logger.record({
      idempotencyKey: "gp-pms-2026-09-01",
      processType: "ingestion",
      processName: "ingestGpPmsRecords",
      outcome: "success",
      context: { recordCount: 3 },
    });
    const prediction = await logger.record({
      idempotencyKey: "gp-pms-insights-2026-09-01",
      processType: "prediction",
      processName: "generateInsights",
      outcome: "success",
      context: { predictedPressure: "moderate" },
    });

    assert.notEqual(ingestion.transactionId, prediction.transactionId);
    assert.equal(ingestion.replayed, false);
    assert.equal(prediction.replayed, false);
    assert.match(ingestion.transactionId, /^[0-9a-f-]{36}$/);

    const report = await logger.verifyIntegrity();
    assert.deepEqual(report, { valid: true, entriesChecked: 2, brokenAtIndex: null });
  });
});

test("idempotency: replaying the same idempotencyKey returns the existing transaction ID without a new entry", async () => {
  await withTempLogger(async (logger, filePath) => {
    const first = await logger.record({
      idempotencyKey: "nhs-central-2026-09-01",
      processType: "ingestion",
      processName: "ingestNhsCentralData",
      outcome: "success",
    });
    const replay = await logger.record({
      idempotencyKey: "nhs-central-2026-09-01",
      processType: "ingestion",
      processName: "ingestNhsCentralData",
      outcome: "success",
    });

    assert.equal(replay.transactionId, first.transactionId);
    assert.equal(replay.replayed, true);

    const lines = (await readFile(filePath, "utf-8")).split("\n").filter((line) => line.trim().length > 0);
    assert.equal(lines.length, 1, "replaying an idempotencyKey must not append a second entry");
  });
});

test("failure path: tampering with a logged entry is detected by verifyIntegrity", async () => {
  await withTempLogger(async (logger, filePath) => {
    await logger.record({
      idempotencyKey: "gp-pms-2026-09-01",
      processType: "ingestion",
      processName: "ingestGpPmsRecords",
      outcome: "success",
    });
    await logger.record({
      idempotencyKey: "gp-pms-insights-2026-09-01",
      processType: "prediction",
      processName: "generateInsights",
      outcome: "success",
    });

    const lines = (await readFile(filePath, "utf-8")).split("\n").filter((line) => line.trim().length > 0);
    const tampered = JSON.parse(lines[0]!);
    tampered.outcome = "failure"; // flip a field without recomputing entryHash, as a real tamperer would
    lines[0] = JSON.stringify(tampered);
    await writeFile(filePath, `${lines.join("\n")}\n`, "utf-8");

    const report = await logger.verifyIntegrity();
    assert.equal(report.valid, false);
    assert.equal(report.brokenAtIndex, 0);
  });
});

test("failure path: a freshly generated transaction ID that collides with an existing one is rejected", async (t) => {
  await withTempLogger(async (logger) => {
    const first = await logger.record({
      idempotencyKey: "gp-pms-2026-09-01",
      processType: "ingestion",
      processName: "ingestGpPmsRecords",
      outcome: "success",
    });

    // A real crypto.randomUUID() collision is not practically reproducible;
    // force it here to exercise the defensive check on its own terms.
    t.mock.method(nodeCrypto, "randomUUID", () => first.transactionId);

    await assert.rejects(
      () =>
        logger.record({
          idempotencyKey: "gp-pms-insights-2026-09-01", // different logical run, would otherwise be a fresh entry
          processType: "prediction",
          processName: "generateInsights",
          outcome: "success",
        }),
      (error: unknown) => error instanceof TrustSpineError && error.errorClass === "DuplicateTransactionIdError",
    );
  });
});

test("failure path: an unparseable log line is treated as tampering, not silently skipped", async () => {
  await withTempLogger(async (logger, filePath) => {
    await writeFile(filePath, "not valid json\n", "utf-8");

    await assert.rejects(
      () => logger.verifyIntegrity(),
      (error: unknown) => error instanceof TrustSpineError && error.errorClass === "LogTamperingDetectedError",
    );
  });
});
