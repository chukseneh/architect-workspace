import { describe, it, expect, vi } from 'vitest';
import { fetchDashboardSnapshot } from './dashboardApi';
import type { DashboardSnapshot } from './dashboardApi';

const SAMPLE_ENTRIES = [{ icbName: 'NHS Leeds ICB', currentOpelLevel: 1, forecastedPressureLevel: 'Low' }];

const SAMPLE_SNAPSHOT: DashboardSnapshot = {
  metrics: SAMPLE_ENTRIES,
  briefing: {
    overall_status: 'Low',
    status_counts: { Low: 1, Medium: 0, High: 0, Critical: 0 },
    headline: 'All calm.',
    top_risks: [],
    recommended_actions: [],
  },
  dataUncertainties: [],
  generatedAt: '2026-09-06T09:00:00.000Z',
};

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

describe('fetchDashboardSnapshot', () => {
  it('happy path: returns the parsed snapshot on a 200 response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, SAMPLE_SNAPSHOT));

    const result = await fetchDashboardSnapshot(SAMPLE_ENTRIES, { fetchImpl });

    expect(result).toEqual({ outcome: 'success', snapshot: SAMPLE_SNAPSHOT });
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/dashboard/snapshot',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ entries: SAMPLE_ENTRIES }),
      }),
    );
  });

  it('failure path: a non-2xx response returns the server-provided error message', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(502, { error: 'AuthError', message: 'Upstream rejected the request.' }));

    const result = await fetchDashboardSnapshot(SAMPLE_ENTRIES, { fetchImpl });

    expect(result).toEqual({ outcome: 'error', message: 'Upstream rejected the request.' });
  });

  it('failure path: a non-2xx response with an unparseable body still returns a usable message', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error('not json')),
    } as unknown as Response);

    const result = await fetchDashboardSnapshot(SAMPLE_ENTRIES, { fetchImpl });

    expect(result).toEqual({ outcome: 'error', message: 'Dashboard request failed with status 500.' });
  });

  it('failure path: a network error returns a typed error result, not a thrown exception', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    const result = await fetchDashboardSnapshot(SAMPLE_ENTRIES, { fetchImpl });

    expect(result).toEqual({ outcome: 'error', message: 'Failed to fetch' });
  });

  it('dashboard loading error: a request exceeding the timeout is aborted and reported clearly', async () => {
    const fetchImpl = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );

    const result = await fetchDashboardSnapshot(SAMPLE_ENTRIES, { fetchImpl, timeoutMs: 10 });

    expect(result).toEqual({ outcome: 'error', message: 'Dashboard request timed out after 10ms.' });
  });
});
