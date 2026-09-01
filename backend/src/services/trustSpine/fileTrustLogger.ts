import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  TrustIntegrityReport,
  TrustLogEntry,
  TrustLogEntrySchema,
  TrustLogRecordInput,
  TrustLogRecordResult,
  TrustLogger,
  TrustSpineError,
} from "./types";

/**
 * Default location for the trust log when a call site doesn't inject its
 * own `TrustLogger`. Relative to `process.cwd()` (the backend package root
 * for `npm test`/`npm start`), not committed — see `.gitignore`.
 */
export const DEFAULT_TRUST_LOG_PATH = join(process.cwd(), "data", "trust-log.jsonl");

/**
 * Append-only JSON-Lines trust logger. Each entry's `entryHash` covers its
 * own fields plus `previousEntryHash`, so the file is a hash chain: editing
 * or deleting any past line changes a downstream hash and is caught by
 * `verifyIntegrity()`. This does not prevent tampering (anyone with disk
 * access can still edit the file) — it only guarantees tampering is
 * detectable, which is the failure mode this story asks for.
 *
 * Concurrency note: safe for sequential calls within one process (each
 * `record()` reads the whole file, then appends). It does not lock the file
 * against a second process writing at the same time — out of scope for this
 * walking skeleton, flagged rather than silently assumed away.
 */
export class FileTrustLogger implements TrustLogger {
  constructor(private readonly filePath: string) {}

  async record(input: TrustLogRecordInput): Promise<TrustLogRecordResult> {
    const entries = await this.readEntries();

    const existing = entries.find((entry) => entry.idempotencyKey === input.idempotencyKey);
    if (existing) {
      return { transactionId: existing.transactionId, replayed: true };
    }

    const transactionId = randomUUID();
    if (entries.some((entry) => entry.transactionId === transactionId)) {
      throw new TrustSpineError(
        "DuplicateTransactionIdError",
        `Generated transaction ID ${transactionId} already exists in the trust log.`,
      );
    }

    const previousEntryHash = entries.length > 0 ? entries[entries.length - 1]!.entryHash : null;
    const fields = {
      transactionId,
      idempotencyKey: input.idempotencyKey,
      processType: input.processType,
      processName: input.processName,
      timestamp: new Date().toISOString(),
      outcome: input.outcome,
      errorClass: input.errorClass,
      context: input.context ?? {},
      previousEntryHash,
    };
    const entry: TrustLogEntry = { ...fields, entryHash: computeEntryHash(fields) };

    try {
      await mkdir(dirname(this.filePath), { recursive: true });
      await appendFile(this.filePath, `${JSON.stringify(entry)}\n`, "utf-8");
    } catch (error) {
      throw new TrustSpineError(
        "LogWriteError",
        `Failed to write trust log entry for transaction ${transactionId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }

    return { transactionId, replayed: false };
  }

  async verifyIntegrity(): Promise<TrustIntegrityReport> {
    const entries = await this.readEntries();

    let previousEntryHash: string | null = null;
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index]!;
      const { entryHash, ...fields } = entry;
      const expectedHash = computeEntryHash(fields);

      if (entry.previousEntryHash !== previousEntryHash || entryHash !== expectedHash) {
        return { valid: false, entriesChecked: entries.length, brokenAtIndex: index };
      }
      previousEntryHash = entryHash;
    }

    return { valid: true, entriesChecked: entries.length, brokenAtIndex: null };
  }

  /** Malformed or unparseable lines are treated as tampering evidence, not silently skipped. */
  private async readEntries(): Promise<TrustLogEntry[]> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf-8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new TrustSpineError(
        "LogWriteError",
        `Failed to read trust log at ${this.filePath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }

    const lines = raw.split("\n").filter((line) => line.trim().length > 0);
    return lines.map((line, index) => {
      try {
        return TrustLogEntrySchema.parse(JSON.parse(line));
      } catch (error) {
        throw new TrustSpineError(
          "LogTamperingDetectedError",
          `Trust log line ${index + 1} is not a valid entry: ${
            error instanceof Error ? error.message : String(error)
          }`,
          { cause: error },
        );
      }
    });
  }
}

function computeEntryHash(fields: Omit<TrustLogEntry, "entryHash">): string {
  const canonical = JSON.stringify({
    transactionId: fields.transactionId,
    idempotencyKey: fields.idempotencyKey,
    processType: fields.processType,
    processName: fields.processName,
    timestamp: fields.timestamp,
    outcome: fields.outcome,
    errorClass: fields.errorClass ?? null,
    context: fields.context,
    previousEntryHash: fields.previousEntryHash,
  });
  return createHash("sha256").update(canonical).digest("hex");
}
