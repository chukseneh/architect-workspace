/**
 * refreshSystemStatus.ts — the "refresh_system_status" tool.
 *
 * Live, model-invoked action: re-check one of this project's 8 tracked
 * systems right now, rather than trusting whatever status was mentioned
 * earlier in the conversation. See systemStatusStore.ts for what "check"
 * currently means (a labeled simulation, not a real network call yet).
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { KNOWN_SYSTEMS, touchStatus, type SystemName } from "../systemStatusStore.ts";

// ---------------------------------------------------------------------
// Explicit input schema: one required field, "system_name", typed as an
// enum of exactly the 8 system names this project tracks (from
// .colaberry/plan.json). Nothing free-form — any missing field, wrong
// JSON type, or value outside this list is rejected by this schema
// before the handler below ever runs.
// ---------------------------------------------------------------------
const inputSchema = {
  system_name: z
    .enum(KNOWN_SYSTEMS)
    .describe(`Exact system name to check. One of: ${KNOWN_SYSTEMS.join(", ")}`),
};

export function registerRefreshSystemStatus(server: McpServer): void {
  server.registerTool(
    "refresh_system_status",
    {
      title: "Refresh system status",
      description:
        "Re-check one of this project's tracked systems (NHS, Ambulance, Community, " +
        "Staffing, Emergency, Discharge, Hospital, Claude Code) right now and report " +
        "its current connection status and when it was checked. Use this instead of " +
        "assuming a status mentioned earlier in the conversation is still current.",
      inputSchema,
    },
    // By the time this callback runs, the SDK has already validated
    // `system_name` against the schema above — this code only ever sees
    // a legal value, so it does no re-checking of its own.
    async ({ system_name }) => {
      const result = touchStatus(system_name as SystemName);
      return {
        content: [
          {
            type: "text",
            text: `${system_name}: ${result.status} (checked at ${result.lastChecked})`,
          },
        ],
      };
    }
  );
}
