/**
 * Mirrors backend/src/intelligence/dashboardTypes.ts's shapes. Duplicated
 * rather than shared across a frontend/backend package boundary — no
 * shared-types package exists in this repo, and introducing one is a
 * bigger structural decision than this walking skeleton needs.
 */
export interface IcbDashboardEntry {
  icbName: string;
  currentOpelLevel: number;
  forecastedPressureLevel: string;
}

export interface DraftLeadershipBriefingOutput {
  overall_status: 'Low' | 'Medium' | 'High' | 'Critical';
  status_counts: { Low: number; Medium: number; High: number; Critical: number };
  headline: string;
  top_risks: string[];
  recommended_actions: string[];
}

export interface DashboardSnapshot {
  metrics: IcbDashboardEntry[];
  briefing: DraftLeadershipBriefingOutput;
  dataUncertainties: string[];
  generatedAt: string;
}

export type FetchDashboardSnapshotResult =
  | { outcome: 'success'; snapshot: DashboardSnapshot }
  | { outcome: 'error'; message: string };

export interface FetchDashboardSnapshotOptions {
  baseUrl?: string;
  timeoutMs?: number;
  /** Defaults to the global fetch; inject a fake in tests. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 8000;

/**
 * Calls POST /api/dashboard/snapshot with an explicit, capped timeout (per
 * this project's rule that every external call gets one) and returns a
 * typed result rather than throwing — the caller (DashboardPage) renders
 * an error state from `outcome: "error"` instead of needing a try/catch
 * around every render path.
 */
export async function fetchDashboardSnapshot(
  entries: IcbDashboardEntry[],
  options: FetchDashboardSnapshotOptions = {},
): Promise<FetchDashboardSnapshotResult> {
  const baseUrl = options.baseUrl ?? '';
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(`${baseUrl}/api/dashboard/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const message =
        body !== null && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
          ? body.message
          : `Dashboard request failed with status ${response.status}.`;
      return { outcome: 'error', message };
    }

    const snapshot = (await response.json()) as DashboardSnapshot;
    return { outcome: 'success', snapshot };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { outcome: 'error', message: `Dashboard request timed out after ${timeoutMs}ms.` };
    }
    return { outcome: 'error', message: error instanceof Error ? error.message : 'Unknown network error.' };
  } finally {
    clearTimeout(timer);
  }
}
