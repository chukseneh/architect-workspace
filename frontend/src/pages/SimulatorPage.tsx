import { useRef, useState } from 'react';
import type { SyntheticEvent } from 'react';
import {
  PRESSURE_LEVEL_OPTIONS,
  PRIMARY_DRIVER_OPTIONS,
  SCENARIO_OPTIONS,
  simulateScenario,
} from '../services/scenarioApi';
import type { PressureLevel, PrimaryDriver, ScenarioInput, ScenarioKind, ScenarioResponse } from '../services/scenarioApi';
import type { IcbDashboardEntry } from '../services/dashboardApi';
import '../styles/simulator.css';

export interface SimulatorPageProps {
  /** The ICBs the user can pick from; the caller supplies them, as with DashboardPage. */
  entries: IcbDashboardEntry[];
  /** Defaults to the real simulateScenario; inject a fake in tests. */
  simulate?: typeof simulateScenario;
}

type SimulatorState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'error'; message: string }
  | { status: 'success'; input: ScenarioInput; response: ScenarioResponse };

const LEVEL_PALETTE: Record<string, string> = { Low: '1', Medium: '2', High: '3', Critical: '4' };

/** Unknown levels get the neutral '0' palette rather than a misleading colour. */
function levelPalette(level: string): string {
  return LEVEL_PALETTE[level] ?? '0';
}

function isPressureLevel(value: string): value is PressureLevel {
  return PRESSURE_LEVEL_OPTIONS.some((option) => option.value === value);
}

/**
 * Keeps a prefilled pair from contradicting itself (a Low tier has no active
 * driver; an elevated tier has one), so the first run is not flagged for a
 * conflict nobody entered. Only used when the panel fills values in; anything
 * the user picks by hand is left alone, and the backend still flags it.
 */
function coherentDriver(pressure: PressureLevel, driver: PrimaryDriver): PrimaryDriver {
  if (pressure === 'Low') return 'none';
  return driver === 'none' ? 'ambulance_handover_delay' : driver;
}

function SelectField<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="simulator__field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * The AI What-If Simulator (STORY-008, REQ-015) as a dashboard panel. It is
 * advisory: it shows a projected pressure level for a person to weigh and
 * never recommends or triggers an action (REQ-018), and says so on screen.
 *
 * Failure paths: a fetch/HTTP/timeout failure shows an alert and leaves the
 * form usable; the button is disabled while a request runs so a double click
 * cannot fire two; a response for an out-of-date request is dropped, and
 * editing any input clears the last result so a projection is never shown
 * beside inputs it was not computed from. Conflicting inputs are shown as
 * a flag next to the projection, not as an error, matching the backend.
 */
export function SimulatorPage({ entries, simulate = simulateScenario }: SimulatorPageProps) {
  const first = entries[0];
  const initialPressure: PressureLevel =
    first && isPressureLevel(first.forecastedPressureLevel) ? first.forecastedPressureLevel : 'Medium';
  const [icbName, setIcbName] = useState(first?.icbName ?? '');
  const [pressure, setPressure] = useState<PressureLevel>(initialPressure);
  const [driver, setDriver] = useState<PrimaryDriver>(coherentDriver(initialPressure, 'ambulance_handover_delay'));
  const [scenario, setScenario] = useState<ScenarioKind>('divert_ambulances');
  const [state, setState] = useState<SimulatorState>({ status: 'idle' });
  const latestRequest = useRef(0);

  function edit<T>(setter: (value: T) => void) {
    return (value: T) => {
      latestRequest.current += 1; // drops any in-flight response
      setter(value);
      setState({ status: 'idle' });
    };
  }

  function chooseIcb(name: string) {
    edit(setIcbName)(name);
    const entry = entries.find((candidate) => candidate.icbName === name);
    if (entry && isPressureLevel(entry.forecastedPressureLevel)) {
      setPressure(entry.forecastedPressureLevel);
      setDriver(coherentDriver(entry.forecastedPressureLevel, driver));
    }
  }

  async function run(event: SyntheticEvent) {
    event.preventDefault();
    if (state.status === 'running' || icbName === '') return;

    const input: ScenarioInput = {
      icbName,
      currentPressureLevel: pressure,
      currentPrimaryDriver: driver,
      scenario,
    };
    const requestId = ++latestRequest.current;
    setState({ status: 'running' });

    const result = await simulate(input);
    if (requestId !== latestRequest.current) return;
    setState(
      result.outcome === 'success'
        ? { status: 'success', input, response: result.response }
        : { status: 'error', message: result.message },
    );
  }

  return (
    <section className="simulator" aria-labelledby="simulator-heading">
      <h2 id="simulator-heading">What-if simulator</h2>
      <p className="simulator__advisory">
        Advisory only. This projects how one action might change an ICB&apos;s pressure so a person can weigh it. It does
        not recommend or trigger anything, and the projection is a model&apos;s estimate, not a measurement.
      </p>

      {entries.length === 0 ? (
        <p className="simulator__empty">No ICBs are available to simulate.</p>
      ) : (
        <form className="simulator__form" onSubmit={run}>
          <SelectField
            id="sim-icb"
            label="ICB"
            value={icbName}
            options={entries.map((entry) => ({ value: entry.icbName, label: entry.icbName }))}
            onChange={chooseIcb}
          />
          <SelectField
            id="sim-pressure"
            label="Current pressure level"
            value={pressure}
            options={PRESSURE_LEVEL_OPTIONS}
            onChange={edit(setPressure)}
          />
          <SelectField
            id="sim-driver"
            label="Primary driver"
            value={driver}
            options={PRIMARY_DRIVER_OPTIONS}
            onChange={edit(setDriver)}
          />
          <SelectField
            id="sim-scenario"
            label="Scenario to test"
            value={scenario}
            options={SCENARIO_OPTIONS}
            onChange={edit(setScenario)}
          />
          <button type="submit" className="simulator__run" disabled={state.status === 'running'}>
            {state.status === 'running' ? 'Simulating…' : 'Run simulation'}
          </button>
        </form>
      )}

      <div className="simulator__result" aria-live="polite">
        {state.status === 'running' && <p role="status">Running the simulation…</p>}

        {state.status === 'error' && (
          <div role="alert" className="simulator__error">
            <p>Simulation failed: {state.message}</p>
          </div>
        )}

        {state.status === 'success' && (
          <div className="simulator__outcome">
            {state.response.conflictFlags.length > 0 && (
              <div role="alert" className="simulator__conflict">
                <strong>Inputs flagged for review</strong>
                <ul>
                  {state.response.conflictFlags.map((flag) => (
                    <li key={flag}>{flag}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="simulator__shift">
              <span className="simulator__pill" data-level={levelPalette(state.input.currentPressureLevel)}>
                Now: {state.input.currentPressureLevel}
              </span>
              <span aria-hidden="true">→</span>
              <span
                className="simulator__pill"
                data-level={levelPalette(state.response.projection.projected_pressure_level)}
                data-testid="projected-level"
              >
                Projected: {state.response.projection.projected_pressure_level}
              </span>
              <span className="simulator__change" data-testid="pressure-change">
                {state.response.projection.pressure_change}
              </span>
            </div>

            <p className="simulator__confidence">
              Model confidence: {Math.round(state.response.projection.confidence * 100)}%
            </p>

            <h3>Assumptions</h3>
            {state.response.projection.key_assumptions.length === 0 ? (
              <p className="simulator__empty">The model listed no assumptions.</p>
            ) : (
              <ul>
                {state.response.projection.key_assumptions.map((assumption) => (
                  <li key={assumption}>{assumption}</li>
                ))}
              </ul>
            )}

            <p className="simulator__meta">
              Logged as transaction {state.response.transactionId} · {state.response.attempts}{' '}
              {state.response.attempts === 1 ? 'attempt' : 'attempts'}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
