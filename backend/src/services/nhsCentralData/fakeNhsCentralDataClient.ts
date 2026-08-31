import {
  NhsCentralDataClient,
  NhsCentralDataError,
  NhsCentralDataFetchOptions,
  NhsCentralDataRecord,
  NhsCentralDataRecordSchema,
} from "./types";

const FIXTURE_RECORDS: NhsCentralDataRecord[] = [
  {
    icbName: "NHS Greater Manchester ICB",
    region: "North West",
    opelLevel: 3,
    ambulanceHandoverOver60MinPct: 18.4,
    dischargeDelayBeddays: 142,
    criticalCareOccupancyPct: 91,
    lastUpdated: "2026-08-27T06:00:00Z",
  },
  {
    icbName: "NHS South East London ICB",
    region: "London",
    opelLevel: 4,
    ambulanceHandoverOver60MinPct: 27.1,
    dischargeDelayBeddays: 210,
    criticalCareOccupancyPct: 97,
    lastUpdated: "2026-08-27T07:00:00Z",
  },
  {
    icbName: "NHS West Yorkshire ICB",
    region: "Yorkshire",
    opelLevel: 2,
    ambulanceHandoverOver60MinPct: 9.8,
    dischargeDelayBeddays: 76,
    criticalCareOccupancyPct: 82,
    lastUpdated: "2026-08-27T05:30:00Z",
  },
];

/** Long enough that any sane caller timeout fires first. */
const SIMULATED_SLOW_RESPONSE_MS = 60_000;

export type FakeNhsCentralDataFailureMode = "none" | "connection" | "timeout" | "format";

export interface FakeNhsCentralDataClientOptions {
  /** Deterministic failure injection for tests. Never set against a real client. */
  failureMode?: FakeNhsCentralDataFailureMode;
}

/**
 * Fast, deterministic stand-in for McpNhsCentralDataClient, used only in
 * tests — so the retry/backoff/logging wrapper's logic can be verified
 * without spawning the real nhs-ops-status subprocess on every run.
 * Mirrors the real server's idempotency behavior: a result is cached by
 * idempotencyKey only once fetching actually succeeds, and a replay
 * returns that original result unchanged regardless of new arguments —
 * a failed attempt is never cached, so a retry with the same key tries fresh.
 */
export class FakeNhsCentralDataClient implements NhsCentralDataClient {
  private readonly failureMode: FakeNhsCentralDataFailureMode;
  private readonly ledger = new Map<string, NhsCentralDataRecord[]>();

  constructor(options: FakeNhsCentralDataClientOptions = {}) {
    this.failureMode = options.failureMode ?? "none";
  }

  async fetchRecords(options: NhsCentralDataFetchOptions): Promise<NhsCentralDataRecord[]> {
    const cached = this.ledger.get(options.idempotencyKey);
    if (cached) return cached;

    if (this.failureMode === "connection") {
      throw new NhsCentralDataError("ConnectionError", "Fake nhs-ops-status refused the connection.");
    }

    if (this.failureMode === "timeout") {
      await this.simulateSlowResponse(options.signal);
    }

    const rawRecords: unknown[] =
      this.failureMode === "format"
        ? [{ ...FIXTURE_RECORDS[0], icbName: undefined }, ...FIXTURE_RECORDS.slice(1)]
        : FIXTURE_RECORDS;

    const records = rawRecords.map((raw) => {
      const result = NhsCentralDataRecordSchema.safeParse(raw);
      if (!result.success) {
        throw new NhsCentralDataError(
          "FormatMismatchError",
          `NHS central data record failed schema validation: ${result.error.message}`,
        );
      }
      return result.data;
    });

    const filtered = records.filter((record) => record.lastUpdated >= options.since);
    this.ledger.set(options.idempotencyKey, filtered);
    return filtered;
  }

  /** Rejects promptly once aborted, instead of running the full delay regardless. */
  private simulateSlowResponse(signal: AbortSignal | undefined): Promise<void> {
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        reject(new NhsCentralDataError("ConnectionError", "Fake nhs-ops-status request aborted by caller."));
      };

      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, SIMULATED_SLOW_RESPONSE_MS);

      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}
