import { DashboardPage } from './pages/DashboardPage';
import type { IcbDashboardEntry } from './services/dashboardApi';

/**
 * Placeholder until a backend endpoint exists that assembles live ICB
 * entries from ingestion (STORY-001/002/012) — this walking skeleton only
 * proves the frontend genuinely fetches from and renders
 * POST /api/dashboard/snapshot, not that real operational data flows in
 * yet. Flagged in PROGRESS.md as the next gap, not hidden here.
 */
const DEMO_ENTRIES: IcbDashboardEntry[] = [
  { icbName: 'NHS Leeds ICB', currentOpelLevel: 1, forecastedPressureLevel: 'Low' },
  { icbName: 'NHS South East London ICB', currentOpelLevel: 4, forecastedPressureLevel: 'Critical' },
];

function App() {
  return (
    <main>
      <h1>AI Healthcare Operations Command Centre</h1>
      <DashboardPage entries={DEMO_ENTRIES} />
    </main>
  );
}

export default App;
