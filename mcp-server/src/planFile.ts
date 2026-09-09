/**
 * planFile.ts — the one place that knows how to find and read
 * .colaberry/plan.json from inside this server. The system-status store
 * and the demo-day prompt both read the same file; this keeps the path
 * resolution and parsing in one spot instead of duplicated in two.
 *
 * This file can legitimately be missing on some clones of this project
 * (see mcp-server/README.md, "What this server assumes") — loadPlan()
 * falls back to safe, empty defaults instead of crashing the server
 * before it starts.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// mcp-server/src -> mcp-server -> repo root -> .colaberry/plan.json
export const PLAN_PATH = path.resolve(__dirname, "../../.colaberry/plan.json");

export interface PlanFile {
  meta: { demoDay: string; buildEnd: string };
  releases: Array<{ id: string; name: string; stories: number; start: string; end: string }>;
  systems: string[];
  guardrails: Array<{ id: string; text: string; enforced: boolean; note?: string }>;
  tabs: Array<{ label: string; status: string }>;
  sampleSystemStatus: Record<string, "connected" | "error" | "not_connected">;
}

/**
 * Used only when .colaberry/plan.json can't be read. Every tracked
 * system falls back to "not_connected" (via the `?? "not_connected"`
 * already in systemStatusStore.ts reading an empty sampleSystemStatus),
 * and there's nothing to report for releases or guardrails until the
 * real file is in place.
 */
function emptyPlan(): PlanFile {
  return {
    meta: { demoDay: "unknown", buildEnd: "unknown" },
    releases: [],
    systems: [],
    guardrails: [],
    tabs: [],
    sampleSystemStatus: {},
  };
}

export function loadPlan(): PlanFile {
  try {
    return JSON.parse(readFileSync(PLAN_PATH, "utf-8")) as PlanFile;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    const reason =
      err.code === "ENOENT"
        ? "the file does not exist"
        : `it could not be read or parsed (${err.message})`;
    console.error(
      `Warning: could not load the project plan at ${PLAN_PATH} — ${reason}. ` +
        `Starting with every tracked system marked "not_connected" and no releases ` +
        `or guardrails until this file is in place. See mcp-server/README.md, ` +
        `"What this server assumes," for why this file can be missing and how to add it.`
    );
    return emptyPlan();
  }
}
