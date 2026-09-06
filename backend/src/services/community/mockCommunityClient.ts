import {
  CommunityClient,
  CommunityDischargeRecord,
  CommunityDischargeRecordSchema,
  CommunityError,
  CommunityFetchOptions,
} from "./types";

const FIXTURE_RECORDS: CommunityDischargeRecord[] = [
  {
    recordId: "com-rec-0001",
    patientRef: "PT-20481",
    capturedAt: "2026-08-20T09:00:00.000Z",
    delayedDischargeBedDays: 3,
  },
  {
    recordId: "com-rec-0002",
    patientRef: "PT-20482",
    capturedAt: "2026-08-21T10:30:00.000Z",
    delayedDischargeBedDays: 7,
  },
  {
    recordId: "com-rec-0003",
    patientRef: "PT-20483",
    capturedAt: "2026-08-22T11:45:00.000Z",
    delayedDischargeBedDays: 1,
  },
  {
    recordId: "com-rec-0004",
    patientRef: "PT-20484",
    capturedAt: "2026-08-22T15:20:00.000Z",
    delayedDischargeBedDays: 5,
  },
];

/** Long enough that any sane caller timeout fires first. */
const SIMULATED_SLOW_RESPONSE_MS = 60_000;

export type MockCommunityFailureMode = "none" | "connection" | "timeout" | "format";

export interface MockCommunityClientOptions {
  /** Deterministic failure injection for tests. Never set against a real client. */
  failureMode?: MockCommunityFailureMode;
}

/**
 * Fixture-backed stand-in for a real community care management system
 * client. Not a live connection to anything — returns a fixed set of
 * realistic-looking delayed-discharge records so the ingestion pipeline can
 * be built and tested before real Community system credentials or API
 * documentation exist. Swap for a real client behind the same
 * `CommunityClient` interface once they do.
 */
export class MockCommunityClient implements CommunityClient {
  private readonly failureMode: MockCommunityFailureMode;

  constructor(options: MockCommunityClientOptions = {}) {
    this.failureMode = options.failureMode ?? "none";
  }

  async fetchRecords(options: CommunityFetchOptions): Promise<CommunityDischargeRecord[]> {
    if (this.failureMode === "connection") {
      throw new CommunityError("ConnectionError", "Mock Community system refused the connection.");
    }

    if (this.failureMode === "timeout") {
      // This mock does not decide when the caller has waited long enough —
      // that is the caller's job (see ingestCommunityRecords' fetchWithTimeout).
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
      const result = CommunityDischargeRecordSchema.safeParse(raw);
      if (!result.success) {
        throw new CommunityError(
          "FormatMismatchError",
          `Community record failed schema validation: ${result.error.message}`,
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
        reject(new CommunityError("ConnectionError", "Mock Community system request aborted by caller."));
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
