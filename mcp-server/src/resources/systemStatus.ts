/**
 * systemStatus.ts — the "plan://systems/{system_name}/status" resource.
 *
 * Passive, read-only: returns the CURRENTLY RECORDED status for one
 * system, exactly as already held in systemStatusStore — no live check,
 * no side effect. This is the deliberate counterpart to the
 * refresh_system_status tool: the tool goes and checks; this resource
 * reads back whatever the last check (or the original plan.json seed)
 * found. Reading it any number of times changes nothing.
 */

import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { KNOWN_SYSTEMS, getStatus, type SystemName } from "../systemStatusStore.ts";

function isKnownSystem(value: string): value is SystemName {
  return (KNOWN_SYSTEMS as readonly string[]).includes(value);
}

const template = new ResourceTemplate("plan://systems/{system_name}/status", {
  // Lets a client (like the Inspector) enumerate every valid resource up
  // front, rather than requiring it to already know a system's name.
  list: async () => ({
    resources: KNOWN_SYSTEMS.map((name) => ({
      name: `${name} status`,
      uri: `plan://systems/${encodeURIComponent(name)}/status`,
      mimeType: "application/json",
    })),
  }),
  // Autocompletes the {system_name} URI variable to the 8 real names.
  complete: {
    system_name: async (value: string) =>
      KNOWN_SYSTEMS.filter((name) => name.toLowerCase().startsWith(value.toLowerCase())),
  },
});

export function registerSystemStatusResource(server: McpServer): void {
  server.registerResource(
    "system-status",
    template,
    {
      title: "System status (last recorded)",
      description:
        "The last recorded connection status for one tracked system, exactly as " +
        "currently held by the server — this does not check anything live. Call " +
        "refresh_system_status first if a fresh, up-to-the-second check matters here.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const raw = variables.system_name;
      const systemName = Array.isArray(raw) ? raw[0] : raw;

      if (!systemName || !isKnownSystem(systemName)) {
        throw new Error(
          `Unknown system "${systemName}". Must be one of: ${KNOWN_SYSTEMS.join(", ")}`
        );
      }

      // Pure read. getStatus() never mutates anything — that's what
      // makes this a resource: nothing changes as a result of reading it.
      const record = getStatus(systemName);

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(record, null, 2),
          },
        ],
      };
    }
  );
}
