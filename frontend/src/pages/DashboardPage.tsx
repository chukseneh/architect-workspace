import { useEffect, useState } from 'react';
import { fetchDashboardSnapshot } from '../services/dashboardApi';
import type { DashboardSnapshot, IcbDashboardEntry } from '../services/dashboardApi';

export interface DashboardPageProps {
  entries: IcbDashboardEntry[];
  /** Defaults to the real fetchDashboardSnapshot; inject a fake in tests. */
  fetchSnapshot?: typeof fetchDashboardSnapshot;
}

type DashboardPageState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; snapshot: DashboardSnapshot };

/**
 * STORY-007's dashboard UI. Three states cover this story's failure paths:
 * loading (the wait before a result exists), error (a fetch/HTTP/timeout
 * failure — "Dashboard loading error"), success (renders `briefing`,
 * `metrics`, and `dataUncertainties` — "UI rendering failure" is avoided by
 * never rendering a partial/undefined shape, since the success branch only
 * runs once a fully-typed DashboardSnapshot exists).
 *
 * `entries` is a required prop rather than something this component fetches
 * itself — no backend endpoint exists yet that assembles live ICB entries
 * from ingestion, so the caller (currently App.tsx, with hardcoded demo
 * data) supplies them. That wiring is a flagged follow-up, not hidden here.
 */
export function DashboardPage({ entries, fetchSnapshot = fetchDashboardSnapshot }: DashboardPageProps) {
  const [state, setState] = useState<DashboardPageState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });

    fetchSnapshot(entries).then((result) => {
      if (cancelled) return;
      if (result.outcome === 'success') {
        setState({ status: 'success', snapshot: result.snapshot });
      } else {
        setState({ status: 'error', message: result.message });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [entries, fetchSnapshot]);

  if (state.status === 'loading') {
    return <p role="status">Loading operational metrics…</p>;
  }

  if (state.status === 'error') {
    return (
      <div role="alert">
        <p>Dashboard failed to load: {state.message}</p>
      </div>
    );
  }

  const { snapshot } = state;

  return (
    <div>
      <section>
        <h2>Leadership briefing</h2>
        <p data-testid="overall-status">{snapshot.briefing.overall_status}</p>
        <p>{snapshot.briefing.headline}</p>
      </section>

      {snapshot.dataUncertainties.length > 0 && (
        <section role="alert">
          <strong>Data uncertainties flagged for review</strong>
          <ul>
            {snapshot.dataUncertainties.map((uncertainty) => (
              <li key={uncertainty}>{uncertainty}</li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3>Top risks</h3>
        <ul>
          {snapshot.briefing.top_risks.map((risk) => (
            <li key={risk}>{risk}</li>
          ))}
        </ul>
      </section>

      <section>
        <h3>Recommended actions</h3>
        <ul>
          {snapshot.briefing.recommended_actions.map((action) => (
            <li key={action}>{action}</li>
          ))}
        </ul>
      </section>

      <section>
        <h3>ICB metrics</h3>
        <table>
          <thead>
            <tr>
              <th>ICB</th>
              <th>Current OPEL level</th>
              <th>Forecasted pressure</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.metrics.map((metric) => (
              <tr key={metric.icbName}>
                <td>{metric.icbName}</td>
                <td>{metric.currentOpelLevel}</td>
                <td>{metric.forecastedPressureLevel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p>
        <small>Generated at {snapshot.generatedAt}</small>
      </p>
    </div>
  );
}
