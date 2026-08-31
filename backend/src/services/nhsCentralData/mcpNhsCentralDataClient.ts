import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import {
  NhsCentralDataClient,
  NhsCentralDataError,
  NhsCentralDataFetchOptions,
  NhsCentralDataRecord,
  NhsCentralDataRecordSchema,
} from "./types";

const SERVER_COMMAND = "uv";
const SERVER_ARGS = [
  "run",
  "--directory",
  "C:\\Users\\abc\\Documents\\AI-Project\\nhs-ops-status",
  "python",
  "server.py",
];

/** Wire-format shape actually returned by nhs-ops-status (snake_case, server.py's CentralDataRecord). */
interface RawCentralDataRecord {
  icb_name: string;
  region: string;
  opel_level: number;
  ambulance_handover_over_60min_pct: number;
  discharge_delay_beddays: number;
  critical_care_occupancy_pct: number;
  last_updated: string;
}

interface RawIngestResult {
  status: "ingested" | "replayed_idempotent" | "no_new_records";
  idempotency_key: string;
  records_ingested: number;
  records: RawCentralDataRecord[];
  message: string;
}

/** Minimal shape we rely on from the SDK's CallToolResult — confirmed against the real server. */
interface CallToolResult {
  content: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

function toNhsCentralDataRecord(raw: RawCentralDataRecord): unknown {
  return {
    icbName: raw.icb_name,
    region: raw.region,
    opelLevel: raw.opel_level,
    ambulanceHandoverOver60MinPct: raw.ambulance_handover_over_60min_pct,
    dischargeDelayBeddays: raw.discharge_delay_beddays,
    criticalCareOccupancyPct: raw.critical_care_occupancy_pct,
    lastUpdated: raw.last_updated,
  };
}

/**
 * Real MCP client for the nhs-ops-status server (a simulated NHS central
 * data feed — see nhs-ops-status/server.py's own "STORY-002 is unbuilt"
 * comment). Connects fresh and closes on every call rather than holding a
 * long-lived connection, so this client's lifecycle stays self-contained
 * and callers can treat it exactly like any other NhsCentralDataClient —
 * no special connect/close choreography leaking into ingestion code.
 */
export class McpNhsCentralDataClient implements NhsCentralDataClient {
  async fetchRecords(options: NhsCentralDataFetchOptions): Promise<NhsCentralDataRecord[]> {
    const transport = new StdioClientTransport({ command: SERVER_COMMAND, args: SERVER_ARGS });
    const client = new Client({ name: "colaberry-backend-nhs-central-data", version: "0.1.0" });

    try {
      try {
        await client.connect(transport);
      } catch (error) {
        throw new NhsCentralDataError(
          "ConnectionError",
          `Could not connect to nhs-ops-status: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }

      const result = (await client.callTool(
        {
          name: "ingest_nhs_central_data",
          arguments: {
            since: options.since,
            idempotency_key: options.idempotencyKey,
            limit: 20,
          },
        },
        undefined,
        { timeout: options.timeoutMs, signal: options.signal },
      )) as CallToolResult;

      // The MCP SDK does NOT throw for a tool-level failure — Pydantic
      // validation errors and similar come back as a normal resolved
      // result with isError: true, confirmed against the real server.
      if (result.isError) {
        const textBlock = result.content.find(
          (block): block is { type: "text"; text: string } => block.type === "text",
        );
        throw new NhsCentralDataError(
          "FormatMismatchError",
          textBlock?.text ?? "nhs-ops-status returned isError=true with no text content.",
        );
      }

      const parsed = result.structuredContent as RawIngestResult | undefined;
      if (!parsed) {
        throw new NhsCentralDataError(
          "FormatMismatchError",
          "nhs-ops-status returned no structuredContent to parse.",
        );
      }

      return parsed.records.map((raw) => {
        const validated = NhsCentralDataRecordSchema.safeParse(toNhsCentralDataRecord(raw));
        if (!validated.success) {
          throw new NhsCentralDataError(
            "FormatMismatchError",
            `NHS central data record failed schema validation: ${validated.error.message}`,
          );
        }
        return validated.data;
      });
    } catch (error) {
      if (error instanceof NhsCentralDataError) throw error;
      if (error instanceof McpError && error.code === ErrorCode.RequestTimeout) {
        throw new NhsCentralDataError(
          "TimeoutError",
          `nhs-ops-status did not respond within ${options.timeoutMs}ms.`,
          { cause: error },
        );
      }
      throw new NhsCentralDataError(
        "ConnectionError",
        error instanceof Error ? error.message : String(error),
        { cause: error },
      );
    } finally {
      await client.close().catch(() => {
        // Best-effort cleanup — the fetch's own outcome is already decided above.
      });
    }
  }
}
