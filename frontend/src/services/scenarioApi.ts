/**
 * Mirrors backend/src/intelligence/scenarioSimulatorTypes.ts's input and
 * output shapes (and routes/scenarioRoute.ts's response). Duplicated rather
 * than shared for the same reason as dashboardApi.ts: no shared-types package
 * exists in this repo.
 */
export type PressureLevel = 'Low' | 'Medium' | 'High' | 'Critical';
export type PrimaryDriver =
  | 'critical_care_occupancy'
  | 'ambulance_handover_delay'
  | 'discharge_delay'
  | 'none';
export type ScenarioKind =
  | 'divert_ambulances'
  | 'open_surge_beds'
  | 'expedite_discharge'
  | 'call_in_additional_staff';

export interface ScenarioInput {
  icbName: string;
  currentPressureLevel: PressureLevel;
  currentPrimaryDriver: PrimaryDriver;
  scenario: ScenarioKind;
}

export interface ScenarioProjection {
  projected_pressure_level: PressureLevel;
  pressure_change: 'Improves' | 'No change' | 'Worsens';
  confidence: number;
  key_assumptions: string[];
}

export interface ScenarioResponse {
  projection: ScenarioProjection;
  /** Non-empty when the inputs contradict each other; the projection is still returned. */
  conflictFlags: string[];
  attempts: number;
  transactionId: string;
}

export type SimulateScenarioResult =
  | { outcome: 'success'; response: ScenarioResponse }
  | { outcome: 'error'; message: string };

export interface SimulateScenarioOptions {
  baseUrl?: string;
  timeoutMs?: number;
  /** Defaults to the global fetch; inject a fake in tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Longer than the dashboard's 8s: the backend allows up to 2 model attempts
 * (10s each) plus backoff before it gives up, so a shorter client timeout
 * would abandon requests the server is still legitimately working on.
 */
const DEFAULT_TIMEOUT_MS = 30_000;

export const PRESSURE_LEVEL_OPTIONS: ReadonlyArray<{ value: PressureLevel; label: string }> = [
  { value: 'Low', label: 'Low' },
  { value: 'Medium', label: 'Medium' },
  { value: 'High', label: 'High' },
  { value: 'Critical', label: 'Critical' },
];

export const PRIMARY_DRIVER_OPTIONS: ReadonlyArray<{ value: PrimaryDriver; label: string }> = [
  { value: 'critical_care_occupancy', label: 'Critical care occupancy' },
  { value: 'ambulance_handover_delay', label: 'Ambulance handover delay' },
  { value: 'discharge_delay', label: 'Discharge delay' },
  { value: 'none', label: 'No active driver' },
];

export const SCENARIO_OPTIONS: ReadonlyArray<{ value: ScenarioKind; label: string }> = [
  { value: 'divert_ambulances', label: 'Divert ambulances' },
  { value: 'open_surge_beds', label: 'Open surge beds' },
  { value: 'expedite_discharge', label: 'Expedite discharge' },
  { value: 'call_in_additional_staff', label: 'Call in additional staff' },
];

/**
 * Calls POST /api/scenario/simulate with an explicit, capped timeout and
 * returns a typed result rather than throwing, so the page renders an error
 * state from `outcome: "error"` without a try/catch around every render path.
 */
export async function simulateScenario(
  input: ScenarioInput,
  options: SimulateScenarioOptions = {},
): Promise<SimulateScenarioResult> {
  const baseUrl = options.baseUrl ?? '';
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(`${baseUrl}/api/scenario/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const message =
        body !== null && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
          ? body.message
          : `Simulation request failed with status ${response.status}.`;
      return { outcome: 'error', message };
    }

    const parsed = (await response.json()) as ScenarioResponse;
    return { outcome: 'success', response: parsed };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { outcome: 'error', message: `Simulation request timed out after ${timeoutMs}ms.` };
    }
    return { outcome: 'error', message: error instanceof Error ? error.message : 'Unknown network error.' };
  } finally {
    clearTimeout(timer);
  }
}
