/**
 * server.ts — the MCP server. One tool, one resource, one prompt,
 * as agreed: refresh_system_status (tool), plan://systems/{system_name}/status
 * (resource), prepare_demo_day_briefing (prompt).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerRefreshSystemStatus } from "./tools/refreshSystemStatus.ts";
import { registerSystemStatusResource } from "./resources/systemStatus.ts";
import { registerPrepareDemoDayBriefing } from "./prompts/prepareDemoDayBriefing.ts";

// The server's identity — this is what shows up in a host's tool list
// or connected-servers panel, so a person can tell it apart from any
// other MCP server they've connected.
const server = new McpServer({
  name: "mcp-server",
  version: "0.1.0",
});

registerRefreshSystemStatus(server);
registerSystemStatusResource(server);
registerPrepareDemoDayBriefing(server);

async function main() {
  // stdio transport: the host (Claude Code, Claude Desktop, or the
  // Inspector) starts this file as a subprocess and talks to it over
  // stdin/stdout. This is the same transport used in every example
  // earlier in this guide, just the TypeScript SDK's version of it.
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // IMPORTANT: this goes to stderr (console.error), never stdout
  // (console.log). Once connected, stdout is reserved entirely for the
  // MCP protocol's own messages — anything else printed there would
  // corrupt the conversation between server and client. stderr is safe
  // because the protocol never uses it; it's the one channel left for
  // a human-readable message.
  console.error("mcp-server is running and waiting for a client to connect (stdio). Press Ctrl+C to stop.");
}

main().catch((error) => {
  console.error("mcp-server failed to start:", error);
  process.exit(1);
});
