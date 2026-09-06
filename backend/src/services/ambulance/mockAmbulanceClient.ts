import {
  AmbulanceClient,
  AmbulanceError,
  AmbulanceFetchOptions,
  AmbulanceHandoverRecord,
  AmbulanceHandoverRecordSchema,
} from "./types";

const FIXTURE_RECORDS: AmbulanceHandoverRecord[] = [
  { recordId: "amb-rec-0001", capturedAt: "2026-08-20T08:00:00.000Z", handoverDurationMinutes: 42 },
  { recordId: "amb-rec-0002", capturedAt: "2026-08-21T09:30:00.000Z", handoverDurationMinutes: 75 },
  { recordId: "amb-rec-0003", capturedAt: "2026-08-22T10:15:00.000Z", handoverDurationMinutes: 63 },
  { recordId: "amb-rec-0004", capturedAt: "2026-08-22T14:00:00.000Z", handoverDurationMinutes: 25 },
];

/** Long enough that any sane caller timeout fires first. */
const SIMULATED_SLOW_RESPONSE_MS = 60_000;

export type MockAmbulanceFailureMode = "none" | "connection" | "timeout" | "format";

export interface MockAmbulanceClientOptions {
  /** Deterministic failure injection for tests. Never set against a real client. */
  failureMode?: MockAmbulanceFailureMode;
}

/**
 * Fixture-backed stand-in for a real ambulance trust CAD/dispatch API client.
 * Not a live connection to anything — returns a fixed set of realistic-looking
 * handover records so the ingestion pipeline can be built and tested before
 * real Ambulance service credentials or API documentation exist. Swap for a
 * real client behind the same `AmbulanceClient` interface once they do.
 */
export class MockAmbulanceClient implements AmbulanceClient {
  private readonly failureMode: MockAmbulanceFailureMode;

  constructor(options: MockAmbulanceClientOptions = {}) {
    this.failureMode = options.failureMode ?? "none";
  }

  async fetchRecords(options: AmbulanceFetchOptions): Promise<AmbulanceHandoverRecord[]> {
    if (this.failureMode === "connection") {
      throw new AmbulanceError("ConnectionError", "Mock Ambulance service refused the connection.");
    }

    if (this.failureMode === "timeout") {
      // This mock does not decide when the caller has waited long enough —
      // that is the caller's job (see ingestAmbulanceRecords' fetchWithTimeout).
      // It DOES have to stop its own work once told to via `signal`, same
      // as a real HTTP client aborting an in-flight request, instead of
      // silently running to completion in the background.
      await this.simulateSlowResponse(options.signal);
    }

    const rawRecords: unknown[] =
      this.failureMode === "format"
        ? [{ ...FIXTURE_RECORDS[0], recordId: undefined }, ...FIXTURE_RECORDS.slice(1)]
        : FIXTURE_RECORDS;

    const records = rawRecords.map((raw) => {
      const result = AmbulanceHandoverRecordSchema.safeParse(raw);
      if (!result.success) {
        throw new AmbulanceError(
          "FormatMismatchError",
          `Ambulance record failed schema validation: ${result.error.message}`,
        );
      }
      return result.data;
    });

    const since = options.since;
    return since ? records.filter((record) => record.capturedAt >= since) : records;
  }

  /** Rejects promptly once aborted, instead of running the full delay regardless. */
  private simulateSlowResponse(signal: AbortSignal | undefined): Promise<void> {
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        reject(new AmbulanceError("ConnectionError", "Mock Ambulance service request aborted by caller."));
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
