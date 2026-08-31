import test from "node:test";
import assert from "node:assert/strict";
import { McpNhsCentralDataClient } from "./mcpNhsCentralDataClient";

/**
 * Integration test: spawns the real nhs-ops-status subprocess over MCP.
 * Requires `uv` and Python on PATH — not something every environment (or
 * CI runner) can guarantee, so this is opt-in, not part of the default
 * `npm test` run, per CLAUDE.md's integration-testing rule ("requires
 * explicit opt-in — env flag or CI label").
 *
 * Run it with: RUN_NHS_INTEGRATION_TESTS=1 npm test   (bash)
 *          or: $env:RUN_NHS_INTEGRATION_TESTS=1; npm test   (PowerShell)
 */
const shouldRun = process.env.RUN_NHS_INTEGRATION_TESTS === "1";

test(
  "integration: real McpNhsCentralDataClient ingests actual records from nhs-ops-status",
  { skip: !shouldRun && "set RUN_NHS_INTEGRATION_TESTS=1 to run against the real subprocess" },
  async () => {
    const client = new McpNhsCentralDataClient();
    const records = await client.fetchRecords({
      since: "2026-08-01T00:00:00Z",
      idempotencyKey: `integration-test-${Date.now()}`,
      timeoutMs: 10000,
    });

    assert.ok(records.length > 0, "expected at least one real record from nhs-ops-status");
    for (const record of records) {
      assert.equal(typeof record.icbName, "string");
      assert.ok(record.opelLevel >= 1 && record.opelLevel <= 4);
    }
  },
);
