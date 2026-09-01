import { randomUUID } from "node:crypto";

import {
  TrustIntegrityReport,
  TrustLogRecordInput,
  TrustLogRecordResult,
  TrustLogger,
  TrustSpineError,
} from "./types";

/**
 * In-memory TrustLogger for tests — no real file I/O, deterministic, and
 * able to simulate a logging failure on demand via `failNextWrite`.
 * Mirrors FileTrustLogger's idempotency behavior (same idempotencyKey
 * replays the existing transaction ID) so tests exercise the same contract
 * a real run would see.
 */
export class FakeTrustLogger implements TrustLogger {
  readonly records: TrustLogRecordInput[] = [];
  failNextWrite = false;
  private readonly transactionIdsByKey = new Map<string, string>();

  async record(input: TrustLogRecordInput): Promise<TrustLogRecordResult> {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new TrustSpineError("LogWriteError", "Simulated trust log write failure.");
    }

    const existing = this.transactionIdsByKey.get(input.idempotencyKey);
    if (existing) {
      return { transactionId: existing, replayed: true };
    }

    const transactionId = randomUUID();
    this.transactionIdsByKey.set(input.idempotencyKey, transactionId);
    this.records.push(input);
    return { transactionId, replayed: false };
  }

  async verifyIntegrity(): Promise<TrustIntegrityReport> {
    return { valid: true, entriesChecked: this.records.length, brokenAtIndex: null };
  }
}
