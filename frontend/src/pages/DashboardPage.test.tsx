import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { DashboardPage } from './DashboardPage';
import type { DashboardSnapshot } from '../services/dashboardApi';

const ENTRIES = [{ icbName: 'NHS Leeds ICB', currentOpelLevel: 1, forecastedPressureLevel: 'Low' }];

const CALM_SNAPSHOT: DashboardSnapshot = {
  metrics: ENTRIES,
  briefing: {
    overall_status: 'Low',
    status_counts: { Low: 1, Medium: 0, High: 0, Critical: 0 },
    headline: 'All ICBs are calm.',
    top_risks: [],
    recommended_actions: [],
  },
  dataUncertainties: [],
  generatedAt: '2026-09-06T09:00:00.000Z',
};

describe('DashboardPage', () => {
  it('shows a loading state before the fetch resolves', () => {
    const fetchSnapshot = vi.fn().mockReturnValue(new Promise(() => {})); // never resolves

    render(<DashboardPage entries={ENTRIES} fetchSnapshot={fetchSnapshot} />);

    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
  });

  it('happy path: renders the briefing, metrics table, and recommended actions on success', async () => {
    const fetchSnapshot = vi.fn().mockResolvedValue({ outcome: 'success', snapshot: CALM_SNAPSHOT });

    render(<DashboardPage entries={ENTRIES} fetchSnapshot={fetchSnapshot} />);

    await waitFor(() => expect(screen.getByTestId('overall-status')).toHaveTextContent('Low'));
    expect(screen.getByText('All ICBs are calm.')).toBeInTheDocument();
    expect(screen.getByText('NHS Leeds ICB')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('data uncertainties: renders a flagged alert section when the snapshot carries any', async () => {
    const flaggedSnapshot: DashboardSnapshot = {
      ...CALM_SNAPSHOT,
      dataUncertainties: ['no_icb_data'],
    };
    const fetchSnapshot = vi.fn().mockResolvedValue({ outcome: 'success', snapshot: flaggedSnapshot });

    render(<DashboardPage entries={ENTRIES} fetchSnapshot={fetchSnapshot} />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent('no_icb_data');
  });

  it('dashboard loading error: renders an error alert instead of a blank or broken page', async () => {
    const fetchSnapshot = vi.fn().mockResolvedValue({ outcome: 'error', message: 'Dashboard request timed out after 8000ms.' });

    render(<DashboardPage entries={ENTRIES} fetchSnapshot={fetchSnapshot} />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent('Dashboard request timed out after 8000ms.');
  });
});
