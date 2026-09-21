import { useEffect, useState } from 'react';
import { fetchDashboardSnapshot } from '../services/dashboardApi';
import type { DashboardSnapshot, IcbDashboardEntry } from '../services/dashboardApi';
import '../styles/dashboard.css';

export interface DashboardPageProps {
  entries: IcbDashboardEntry[];
  /** Defaults to the real fetchDashboardSnapshot; inject a fake in tests. */
  fetchSnapshot?: typeof fetchDashboardSnapshot;
}

type DashboardPageState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; snapshot: DashboardSnapshot };

const PRESSURE_LEVELS: Record<string, string> = { Low: '1', Medium: '2', High: '3', Critical: '4' };

/** OPEL runs 1-4; anything else (missing, out of range) gets the neutral '0' palette rather than a misleading colour. */
function opelPalette(level: number): string {
  return Number.isInteger(level) && level >= 1 && level <= 4 ? String(level) : '0';
}

function pressurePalette(level: string): string {
  return PRESSURE_LEVELS[level] ?? '0';
}

function BulletPanel({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="panel">
      <h3>{title}</h3>
      {items.length === 0 ? (
        <p className="panel__empty">None reported.</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

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
    return (
      <div className="dashboard dashboard__state">
        <p role="status">Loading operational metrics…</p>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="dashboard dashboard__state">
        <div role="alert">
          <p>Dashboard failed to load: {state.message}</p>
        </div>
      </div>
    );
  }

  const { snapshot } = state;
  const { briefing } = snapshot;

  return (
    <div className="dashboard">
      <section className="briefing" data-level={pressurePalette(briefing.overall_status)}>
        <div className="briefing__top">
          <h2>Leadership briefing</h2>
          <span className="dashboard__pill" data-testid="overall-status">
            {briefing.overall_status}
          </span>
        </div>
        <p className="briefing__headline">{briefing.headline}</p>
        <ul className="briefing__counts" aria-label="ICBs by pressure level">
          {(Object.keys(PRESSURE_LEVELS) as Array<keyof typeof briefing.status_counts>).map((level) => (
            <li key={level} className="dashboard__pill" data-level={pressurePalette(level)}>
              {level}: {briefing.status_counts[level]}
            </li>
          ))}
        </ul>
      </section>

      {snapshot.dataUncertainties.length > 0 && (
        <section className="uncertainty" role="alert">
          <strong>Data uncertainties flagged for review</strong>
          <ul>
            {snapshot.dataUncertainties.map((uncertainty) => (
              <li key={uncertainty}>{uncertainty}</li>
            ))}
          </ul>
        </section>
      )}

      <div className="briefing-lists">
        <BulletPanel title="Top risks" items={briefing.top_risks} />
        <BulletPanel title="Recommended actions" items={briefing.recommended_actions} />
      </div>

      <section aria-labelledby="icb-heading">
        <h3 id="icb-heading">ICB status</h3>
        <ul className="icb-grid">
          {snapshot.metrics.map((metric) => (
            <li key={metric.icbName} className="icb-card" data-level={opelPalette(metric.currentOpelLevel)}>
              <h4 className="icb-card__name">{metric.icbName}</h4>
              <dl className="icb-card__metrics">
                <div className="icb-card__metric">
                  <dt>Current OPEL level</dt>
                  <dd>
                    <span className="dashboard__pill icb-card__opel">OPEL {metric.currentOpelLevel}</span>
                  </dd>
                </div>
                <div
                  className="icb-card__metric"
                  data-level={pressurePalette(metric.forecastedPressureLevel)}
                >
                  <dt>Forecasted pressure</dt>
                  <dd>
                    <span className="dashboard__pill">{metric.forecastedPressureLevel}</span>
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      </section>

      <p className="dashboard__meta">Generated at {snapshot.generatedAt}</p>
    </div>
  );
}
