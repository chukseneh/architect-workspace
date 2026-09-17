/**
 * nhsOpsStatusClient.ts — this server's one real outbound integration: an
 * MCP client connection to the nhs-ops-status Python server (real NHS
 * trust operational data). The connection is opened lazily on first use
 * and reused across calls, not respawned per call.
 *
 * Why this system, and not one of the other 7 named in .colaberry/plan.json:
 * it is the only one with a real, already-built, already-reachable backend
 * in this repo — its launch command already exists in the root .mcp.json,
 * so nothing about the connection target here is invented.
 *
 * KNOWN LIMITATION, stated honestly rather than silently: on Windows, a
 * child process is not guaranteed to be killed when its parent exits
 * unless something explicitly arranges that (a Job Object). If this
 * server's own process is killed abruptly rather than shut down cleanly,
 * the spawned `uv run python server.py` process it started may be left
 * running. This is a real gap, not handled here — flagging it rather
 * than pretending otherwise.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// mcp-server/src -> mcp-server -> repo root -> nhs-ops-status
const NHS_OPS_STATUS_DIR = path.resolve(__dirname, "../../nhs-ops-status");

// First connect spawns a Python interpreter via `uv run` — slower than a
// steady-state call, hence the longer budget. Both are explicit, finite,
// and enforced by the SDK's own RequestOptions.timeout (McpError
// "RequestTimeout" if exceeded) — this server can never hang forever
// waiting on the other one.
const CONNECT_TIMEOUT_MS = 15_000;
const CALL_TIMEOUT_MS = 8_000;

export class NhsOpsStatusUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "NhsOpsStatusUnavailableError";
  }
}

// The external contract this adapter trusts — validated, not assumed.
// If nhs-ops-status ever changes this shape, calls fail with a clear
// error here instead of handing malformed data up to the model.
const NhsTrustStatusSchema = z.object({
  trust_name: z.string(),
  region: z.string(),
  ed_wait_minutes: z.number(),
  bed_occupancy_pct: z.number(),
  ambulance_handover_delay_minutes: z.number(),
  last_updated: z.string(),
});
export type NhsTrustStatus = z.infer<typeof NhsTrustStatusSchema>;

let clientPromise: Promise<Client> | null = null;

function connect(): Promise<Client> {
  const client = new Client({ name: "mcp-server (nhs-ops-status adapter)", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: "uv",
    args: ["run", "--directory", NHS_OPS_STATUS_DIR, "python", "server.py"],
  });
  return client.connect(transport, { timeout: CONNECT_TIMEOUT_MS }).then(() => client);
}

async function getClient(): Promise<Client> {
  if (!clientPromise) {
    // Cache the in-flight/succeeded connection, not a failed one — a
    // failure here must not poison every future call for the rest of
    // this process's life.
    clientPromise = connect().catch((err) => {
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
}

/**
 * Live lookup of NHS trust operational data via nhs-ops-status's own
 * search_trust_status tool. Throws NhsOpsStatusUnavailableError — never
 * lets a connection failure, a timeout, or a malformed response escape
 * as an unhandled crash — for every way the other system can fail:
 * won't start, hangs, errors, or answers in a shape we don't recognize.
 */
export async function searchNhsTrustStatus(query: string, limit: number): Promise<NhsTrustStatus[]> {
  let client: Client;
  try {
    client = await getClient();
  } catch (err) {
    throw new NhsOpsStatusUnavailableError(
      `Could not start or connect to the nhs-ops-status server within ${CONNECT_TIMEOUT_MS / 1000}s.`,
      { cause: err }
    );
  }

  // `as { isError?: boolean; content?: unknown; structuredContent?: unknown }`:
  // the SDK's generated CallToolResult type produces a spurious structural
  // mismatch at this call site (an inference artifact of its Zod-generated
  // content union, not a real type error — the actual runtime shape was
  // confirmed directly by calling this tool before writing this adapter).
  // Loosely typing this local variable is safe because the real contract
  // check happens two lines down: `structuredContent` is strictly validated
  // against NhsTrustStatusSchema before anything here is trusted or returned.
  const result = (await client
    .callTool(
      { name: "search_trust_status", arguments: { query, limit } },
      undefined,
      { timeout: CALL_TIMEOUT_MS }
    )
    .catch((err) => {
      // A dead pipe (the process crashed, or the call timed out) means
      // this cached connection is no longer trustworthy — drop it so the
      // NEXT call gets a fresh attempt instead of repeating the same
      // failure against a connection that's already gone.
      clientPromise = null;
      throw new NhsOpsStatusUnavailableError(
        `nhs-ops-status did not respond within ${CALL_TIMEOUT_MS / 1000}s, or the call failed.`,
        { cause: err }
      );
    })) as { isError?: boolean; content?: unknown; structuredContent?: unknown };

  if (result.isError) {
    throw new NhsOpsStatusUnavailableError(
      `nhs-ops-status reported an error: ${JSON.stringify(result.content ?? result)}`
    );
  }

  const parsed = z.object({ result: z.array(NhsTrustStatusSchema) }).safeParse(result.structuredContent);
  if (!parsed.success) {
    throw new NhsOpsStatusUnavailableError(
      "nhs-ops-status returned a response in an unexpected shape (contract mismatch)."
    );
  }

  return parsed.data.result;
}
