import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { SimulatorPage } from './SimulatorPage';
import type { ScenarioResponse, SimulateScenarioResult } from '../services/scenarioApi';

const ENTRIES = [
  { icbName: 'NHS Leeds ICB', currentOpelLevel: 1, forecastedPressureLevel: 'Low' },
  { icbName: 'NHS South East London ICB', currentOpelLevel: 4, forecastedPressureLevel: 'Critical' },
];

const RESPONSE: ScenarioResponse = {
  projection: {
    projected_pressure_level: 'High',
    pressure_change: 'Improves',
    confidence: 0.85,
    key_assumptions: ['Receiving hospitals can absorb diverted ambulances'],
  },
  conflictFlags: [],
  attempts: 1,
  transactionId: 'tx-123',
};

const success = (response: ScenarioResponse = RESPONSE): SimulateScenarioResult => ({ outcome: 'success', response });

function run() {
  fireEvent.click(screen.getByRole('button', { name: /run simulation/i }));
}

describe('SimulatorPage', () => {
  it('always says the projection is advisory', () => {
    render(<SimulatorPage entries={ENTRIES} simulate={vi.fn()} />);

    expect(screen.getByText(/advisory only/i)).toBeInTheDocument();
  });

  it('happy path: submits the chosen inputs and renders the projection with its level as text', async () => {
    const simulate = vi.fn().mockResolvedValue(success());
    render(<SimulatorPage entries={ENTRIES} simulate={simulate} />);

    fireEvent.change(screen.getByLabelText('Scenario to test'), { target: { value: 'open_surge_beds' } });
    run();

    await waitFor(() => expect(screen.getByTestId('projected-level')).toHaveTextContent('Projected: High'));
    expect(simulate).toHaveBeenCalledWith({
      icbName: 'NHS Leeds ICB',
      currentPressureLevel: 'Low',
      currentPrimaryDriver: 'none',
      scenario: 'open_surge_beds',
    });
    expect(screen.getByTestId('projected-level')).toHaveAttribute('data-level', '3');
    expect(screen.getByTestId('pressure-change')).toHaveTextContent('Improves');
    expect(screen.getByText('Model confidence: 85%')).toBeInTheDocument();
    expect(screen.getByText('Receiving hospitals can absorb diverted ambulances')).toBeInTheDocument();
    expect(screen.getByText(/tx-123/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('choosing an ICB prefills its forecast pressure level', () => {
    render(<SimulatorPage entries={ENTRIES} simulate={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('ICB'), { target: { value: 'NHS South East London ICB' } });

    expect(screen.getByLabelText('Current pressure level')).toHaveValue('Critical');
  });

  it('prefill is coherent: a Low ICB starts with no active driver, an elevated one gets a driver', () => {
    render(<SimulatorPage entries={ENTRIES} simulate={vi.fn()} />);
    expect(screen.getByLabelText('Primary driver')).toHaveValue('none');

    fireEvent.change(screen.getByLabelText('ICB'), { target: { value: 'NHS South East London ICB' } });
    expect(screen.getByLabelText('Primary driver')).toHaveValue('ambulance_handover_delay');

    // Moving back to a Low ICB clears the driver again.
    fireEvent.change(screen.getByLabelText('ICB'), { target: { value: 'NHS Leeds ICB' } });
    expect(screen.getByLabelText('Primary driver')).toHaveValue('none');
  });

  it('a hand-made contradiction is left alone (the backend flags it), not silently corrected', async () => {
    const flagged = { ...RESPONSE, conflictFlags: ['Low tier with an active driver.'] };
    const simulate = vi.fn().mockResolvedValue(success(flagged));
    render(<SimulatorPage entries={ENTRIES} simulate={simulate} />);

    fireEvent.change(screen.getByLabelText('Primary driver'), { target: { value: 'discharge_delay' } }); // Leeds is Low
    run();

    await waitFor(() => expect(simulate).toHaveBeenCalled());
    expect(simulate.mock.calls[0]?.[0]).toMatchObject({ currentPressureLevel: 'Low', currentPrimaryDriver: 'discharge_delay' });
  });

  it('conflicting inputs: shows the flag next to the projection instead of hiding the result', async () => {
    const flagged = { ...RESPONSE, conflictFlags: ['current_pressure_level is "Low" but the driver is active.'] };
    render(<SimulatorPage entries={ENTRIES} simulate={vi.fn().mockResolvedValue(success(flagged))} />);

    run();

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Inputs flagged for review'));
    expect(screen.getByRole('alert')).toHaveTextContent('driver is active');
    expect(screen.getByTestId('projected-level')).toBeInTheDocument();
  });

  it('failure path: an error result shows an alert and leaves the form usable', async () => {
    const simulate = vi.fn().mockResolvedValue({ outcome: 'error', message: 'Upstream rejected the key.' });
    render(<SimulatorPage entries={ENTRIES} simulate={simulate} />);

    run();

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Simulation failed: Upstream rejected the key.'));
    expect(screen.getByRole('button', { name: /run simulation/i })).toBeEnabled();
    expect(screen.queryByTestId('projected-level')).not.toBeInTheDocument();
  });

  it('boundary: an unknown projected level falls back to the neutral palette, not a misleading colour', async () => {
    const odd = { ...RESPONSE, projection: { ...RESPONSE.projection, projected_pressure_level: 'Severe' as never } };
    render(<SimulatorPage entries={ENTRIES} simulate={vi.fn().mockResolvedValue(success(odd))} />);

    run();

    await waitFor(() => expect(screen.getByTestId('projected-level')).toHaveAttribute('data-level', '0'));
  });

  it('boundary: a projection with no assumptions says so instead of rendering an empty list', async () => {
    const bare = { ...RESPONSE, projection: { ...RESPONSE.projection, key_assumptions: [] } };
    render(<SimulatorPage entries={ENTRIES} simulate={vi.fn().mockResolvedValue(success(bare))} />);

    run();

    await waitFor(() => expect(screen.getByText('The model listed no assumptions.')).toBeInTheDocument());
  });

  it('boundary: with no ICBs it explains why there is nothing to run and does not render the form', () => {
    const simulate = vi.fn();
    render(<SimulatorPage entries={[]} simulate={simulate} />);

    expect(screen.getByText('No ICBs are available to simulate.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /run simulation/i })).not.toBeInTheDocument();
    expect(simulate).not.toHaveBeenCalled();
  });

  it('concurrency: while a request runs the button is disabled, so a double click sends one request', async () => {
    let resolve: (result: SimulateScenarioResult) => void = () => {};
    const simulate = vi.fn().mockReturnValue(new Promise<SimulateScenarioResult>((r) => (resolve = r)));
    render(<SimulatorPage entries={ENTRIES} simulate={simulate} />);

    run();
    expect(screen.getByRole('button', { name: /simulating/i })).toBeDisabled();
    fireEvent.submit(screen.getByRole('button', { name: /simulating/i }).closest('form') as HTMLFormElement);

    expect(simulate).toHaveBeenCalledTimes(1);
    resolve(success());
    await waitFor(() => expect(screen.getByTestId('projected-level')).toBeInTheDocument());
  });

  it('stale result: editing an input clears the projection so it never sits beside inputs it was not computed from', async () => {
    render(<SimulatorPage entries={ENTRIES} simulate={vi.fn().mockResolvedValue(success())} />);
    run();
    await waitFor(() => expect(screen.getByTestId('projected-level')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Primary driver'), { target: { value: 'discharge_delay' } });

    expect(screen.queryByTestId('projected-level')).not.toBeInTheDocument();
  });

  it('stale response: a response that arrives after the inputs changed is dropped', async () => {
    let resolve: (result: SimulateScenarioResult) => void = () => {};
    const simulate = vi.fn().mockReturnValue(new Promise<SimulateScenarioResult>((r) => (resolve = r)));
    render(<SimulatorPage entries={ENTRIES} simulate={simulate} />);

    run();
    fireEvent.change(screen.getByLabelText('Scenario to test'), { target: { value: 'expedite_discharge' } });
    resolve(success());
    await Promise.resolve();

    expect(screen.queryByTestId('projected-level')).not.toBeInTheDocument();
  });
});
