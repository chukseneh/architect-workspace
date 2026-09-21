import { describe, it, expect, vi } from 'vitest';
import { simulateScenario } from './scenarioApi';
import type { ScenarioInput, ScenarioResponse } from './scenarioApi';

const INPUT: ScenarioInput = {
  icbName: 'NHS South East London ICB',
  currentPressureLevel: 'Critical',
  currentPrimaryDriver: 'ambulance_handover_delay',
  scenario: 'divert_ambulances',
};

const RESPONSE: ScenarioResponse = {
  projection: {
    projected_pressure_level: 'High',
    pressure_change: 'Improves',
    confidence: 0.85,
    key_assumptions: ['Receiving hospitals can absorb diverted ambulances'],
  },
  conflictFlags: [],
  attempts: 1,
  transactionId: 'tx-1',
};

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as Response;
}

describe('simulateScenario', () => {
  it('happy path: POSTs the input as JSON and returns the parsed response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, RESPONSE));

    const result = await simulateScenario(INPUT, { fetchImpl });

    expect(result).toEqual({ outcome: 'success', response: RESPONSE });
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/scenario/simulate',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(INPUT) }),
    );
  });

  it('failure path: a non-2xx response returns the server-provided message', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(502, { error: 'AuthError', message: 'Upstream rejected the key.' }));

    expect(await simulateScenario(INPUT, { fetchImpl })).toEqual({ outcome: 'error', message: 'Upstream rejected the key.' });
  });

  it('failure path: a 400 surfaces its message too', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(400, { error: 'invalid_request', message: 'bad scenario' }));

    expect(await simulateScenario(INPUT, { fetchImpl })).toEqual({ outcome: 'error', message: 'bad scenario' });
  });

  it('failure path: a non-2xx response with an unparseable body still gives a usable message', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error('not json')),
    } as unknown as Response);

    expect(await simulateScenario(INPUT, { fetchImpl })).toEqual({
      outcome: 'error',
      message: 'Simulation request failed with status 500.',
    });
  });

  it('failure path: a network error is returned, not thrown', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('Failed to fetch'));

    expect(await simulateScenario(INPUT, { fetchImpl })).toEqual({ outcome: 'error', message: 'Failed to fetch' });
  });

  it('boundary: a request that outlives the timeout is aborted and reported as a timeout', async () => {
    const fetchImpl = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );

    const result = await simulateScenario(INPUT, { fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 20 });

    expect(result).toEqual({ outcome: 'error', message: 'Simulation request timed out after 20ms.' });
  });

  it('idempotency: two identical calls send identical requests and return equal results', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, RESPONSE));

    const a = await simulateScenario(INPUT, { fetchImpl });
    const b = await simulateScenario(INPUT, { fetchImpl });

    expect(a).toEqual(b);
    expect(fetchImpl.mock.calls[0]?.[1]?.body).toEqual(fetchImpl.mock.calls[1]?.[1]?.body);
  });
});
