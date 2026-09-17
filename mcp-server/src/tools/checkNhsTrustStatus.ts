/**
 * checkNhsTrustStatus.ts — the "check_nhs_trust_status" tool.
 *
 * This server's one real outbound integration: proxies to the actually-
 * running nhs-ops-status server (see ../nhsOpsStatusClient.ts) for live
 * NHS trust operational data, rather than the simulated in-memory status
 * every other tracked system in this project currently uses.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { searchNhsTrustStatus, NhsOpsStatusUnavailableError } from "../nhsOpsStatusClient.ts";

// Explicit, validated inputs — mirrors the schema nhs-ops-status itself
// enforces on the other side, so a bad value is rejected here before this
// tool ever tries to reach the other system with it.
const inputSchema = {
  query: z
    .string()
    .min(1)
    .max(200)
    .describe("Trust name or region keyword to search for, e.g. 'Leeds' or 'North West'."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(5)
    .describe("Maximum number of matching trusts to return."),
};

export function registerCheckNhsTrustStatus(server: McpServer): void {
  server.registerTool(
    "check_nhs_trust_status",
    {
      title: "Check NHS trust status",
      description:
        "Look up live NHS hospital trust operational data (A&E wait time, bed occupancy, " +
        "ambulance handover delay) by trust name or region, via the real nhs-ops-status " +
        "server. This is this project's one real external-system integration — if that " +
        "server is not running or does not respond in time, this tool reports that " +
        "clearly instead of crashing or returning a fake result.",
      inputSchema,
    },
    async ({ query, limit }) => {
      try {
        const trusts = await searchNhsTrustStatus(query, limit);
        if (trusts.length === 0) {
          return { content: [{ type: "text" as const, text: `No NHS trust found matching "${query}".` }] };
        }
        const lines = trusts.map(
          (t) =>
            `${t.trust_name} (${t.region}): ED wait ${t.ed_wait_minutes}min, ` +
            `bed occupancy ${t.bed_occupancy_pct}%, ambulance handover delay ` +
            `${t.ambulance_handover_delay_minutes}min (as of ${t.last_updated})`
        );
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (err) {
        // The one failure mode we expect and have a real answer for: the
        // other system is down, slow, or misbehaving. Report it as a
        // normal tool result the caller can read and explain to the user
        // — not a crash, and not a fake "no data" that looks like a real
        // empty result.
        if (err instanceof NhsOpsStatusUnavailableError) {
          return {
            isError: true,
            content: [
              { type: "text" as const, text: `NHS trust status is unavailable right now: ${err.message}` },
            ],
          };
        }
        // Anything else is a real bug in this tool, not a known "system is
        // down" case — let it surface rather than mask it as a friendly
        // message that would hide what actually broke.
        throw err;
      }
    }
  );
}
