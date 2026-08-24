import {
  GpPmsClient,
  GpPmsError,
  GpPmsFetchOptions,
  GpPmsRecord,
  GpPmsRecordSchema,
} from "./types";

const FIXTURE_RECORDS: GpPmsRecord[] = [
  {
    recordId: "gp-rec-0001",
    patientRef: "PT-10293",
    recordType: "appointment",
    capturedAt: "2026-08-20T09:15:00.000Z",
    payload: { clinician: "Dr. A. Okafor", durationMinutes: 15, status: "attended" },
  },
  {
    recordId: "gp-rec-0002",
    patientRef: "PT-10294",
    recordType: "registration",
    capturedAt: "2026-08-21T11:00:00.000Z",
    payload: { practiceCode: "Y00123", registeredSince: "2019-03-01" },
  },
  {
    recordId: "gp-rec-0003",
    patientRef: "PT-10295",
    recordType: "capacity",
    capturedAt: "2026-08-22T08:00:00.000Z",
    payload: { availableSlotsToday: 12, bookedSlotsToday: 47, staffOnDuty: 6 },
  },
];

/** Long enough that any sane caller timeout fires first. */
const SIMULATED_SLOW_RESPONSE_MS = 60_000;

export type MockGpPmsFailureMode = "none" | "connection" | "timeout" | "format";

export interface MockGpPmsClientOptions {
  /** Deterministic failure injection for tests. Never set against a real client. */
  failureMode?: MockGpPmsFailureMode;
}

/**
 * Fixture-backed stand-in for a real GP PMS API client (EMIS/SystmOne/Vision).
 * Not a live connection to anything — returns a fixed set of realistic-looking
 * records so the ingestion pipeline can be built and tested before real GP PMS
 * credentials or API documentation exist. Swap for a real client behind the
 * same `GpPmsClient` interface once they do.
 */
export class MockGpPmsClient implements GpPmsClient {
  private readonly failureMode: MockGpPmsFailureMode;

  constructor(options: MockGpPmsClientOptions = {}) {
    this.failureMode = options.failureMode ?? "none";
  }

  async fetchRecords(options: GpPmsFetchOptions): Promise<GpPmsRecord[]> {
    if (this.failureMode === "connection") {
      throw new GpPmsError("ConnectionError", "Mock GP PMS refused the connection.");
    }

    if (this.failureMode === "timeout") {
      // This mock does not decide when the caller has waited long enough —
      // that is the caller's job (see ingestGpPmsRecords' fetchWithTimeout).
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
      const result = GpPmsRecordSchema.safeParse(raw);
      if (!result.success) {
        throw new GpPmsError(
          "FormatMismatchError",
          `GP PMS record failed schema validation: ${result.error.message}`,
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
        reject(new GpPmsError("ConnectionError", "Mock GP PMS request aborted by caller."));
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
