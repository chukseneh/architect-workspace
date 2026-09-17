/**
 * systemStatusStore.ts — the server's in-memory record of each tracked
 * system's connection status.
 *
 * Seeded once, at startup, from the project's own .colaberry/plan.json
 * (the "sampleSystemStatus" block), then held in memory and changed only
 * through touchStatus() — this is the shared state the refresh_system_status
 * tool reads and updates. touchStatus() re-reads plan.json on every call
 * (see its own comment below for why), so this store's values can drift
 * from the file between refreshes but never stay stale forever.
 */

import { loadPlan } from "./planFile.ts";

export const KNOWN_SYSTEMS = [
  "NHS",
  "Ambulance",
  "Community",
  "Staffing",
  "Emergency",
  "Discharge",
  "Hospital",
  "Claude Code",
] as const;

export type SystemName = (typeof KNOWN_SYSTEMS)[number];
export type ConnectionStatus = "connected" | "error" | "not_connected";

export interface StatusRecord {
  status: ConnectionStatus;
  lastChecked: string;
}

function loadInitialStatuses(): Record<SystemName, StatusRecord> {
  const sample = loadPlan().sampleSystemStatus ?? {};
  const seededAt = new Date().toISOString();

  const store = {} as Record<SystemName, StatusRecord>;
  for (const name of KNOWN_SYSTEMS) {
    store[name] = { status: sample[name] ?? "not_connected", lastChecked: seededAt };
  }
  return store;
}

const statuses = loadInitialStatuses();

export function getStatus(name: SystemName): StatusRecord {
  return statuses[name];
}

/**
 * Re-checks `name` right now and records the result.
 *
 * SIMULATION NOTE: there is still no live network call to NHS/Ambulance/
 * etc. here — this is the seam where that real per-system integration
 * belongs later (see nhsOpsStatusClient.ts for the one system, NHS, that
 * already has one, wired in through the check_nhs_trust_status tool
 * instead of through this store).
 *
 * FIXED BUG: this used to reaffirm whatever status was seeded at server
 * startup, forever — stamping a fresh "just checked" time on a value
 * that could never actually change no matter how many times you called
 * it, even if .colaberry/plan.json was updated on disk in the meantime.
 * That was a wrong answer with no error attached to notice it by. This
 * now re-reads plan.json's sampleSystemStatus on every call, the same
 * "always fresh, never cached" pattern prepareDemoDayBriefing.ts already
 * uses for the same file — so a "refresh" can now actually change the
 * value, which is what the tool's name has always promised.
 */
export function touchStatus(name: SystemName): StatusRecord {
  const sample = loadPlan().sampleSystemStatus ?? {};
  const status = sample[name] ?? "not_connected";
  statuses[name] = { status, lastChecked: new Date().toISOString() };
  return statuses[name];
}
