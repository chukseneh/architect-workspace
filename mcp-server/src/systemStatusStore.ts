/**
 * systemStatusStore.ts — the server's in-memory record of each tracked
 * system's connection status.
 *
 * Seeded once, at startup, from the project's own .colaberry/plan.json
 * (the "sampleSystemStatus" block), then held in memory and changed only
 * through touchStatus() — this is the shared state the refresh_system_status
 * tool reads and updates.
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
 * Simulates re-checking `name` right now and records the result.
 *
 * SIMULATION NOTE: there is no real network call to NHS/Ambulance/etc.
 * here yet — this is the seam where that real integration call belongs
 * later. For now it reaffirms the last known value but stamps a genuinely
 * new check time, which is the real, observable side effect this
 * function (and the tool that calls it) has.
 */
export function touchStatus(name: SystemName): StatusRecord {
  const current = statuses[name];
  statuses[name] = { status: current.status, lastChecked: new Date().toISOString() };
  return statuses[name];
}
