import { randomUUID } from "node:crypto";
import { Router, Request, Response } from "express";
import { z } from "zod";
import { simulateScenario } from "../intelligence/scenarioSimulator";
import { ScenarioSimulatorClient, ScenarioSimulatorInputSchema } from "../intelligence/scenarioSimulatorTypes";
import { DEFAULT_TRUST_LOG_PATH, FileTrustLogger } from "../services/trustSpine/fileTrustLogger";
import { TrustLogger } from "../services/trustSpine/types";

/**
 * The simulator's own schema plus a length cap on icbName. The name is
 * interpolated into the model prompt, so an unbounded string is an
 * unbounded prompt; nothing in the plan has an ICB name near this long.
 */
const ScenarioRequestSchema = ScenarioSimulatorInputSchema.extend({
  icbName: z.string().min(1).max(200),
});

/**
 * Per-attempt model timeout. Longer than simulateScenario's own 5s default:
 * a live call took ~3.5s, and a request that times out here is one the user
 * has to retype. The worst case (2 attempts + backoff) stays well under the
 * frontend's 30s client timeout.
 */
export const DEFAULT_SCENARIO_TIMEOUT_MS = 10_000;

export interface ScenarioRouteDeps {
  /** Defaults to a real AnthropicScenarioSimulatorClient (via simulateScenario); inject a fake in tests. */
  client?: ScenarioSimulatorClient;
  /** Defaults to one FileTrustLogger shared by every request on this router; inject a fake in tests. */
  trustLogger?: TrustLogger;
  timeoutMs?: number;
  backoffBaseMs?: number;
}

/**
 * POST /api/scenario/simulate — the HTTP surface for STORY-008's What-If
 * Simulator. The result is advisory: this route projects a pressure level for
 * a person to weigh and never issues a directive (REQ-018).
 *
 * Failure handling, all of it at this boundary:
 *   - malformed body            -> 400, and the model is never called
 *   - model/provider failure    -> 502 with the stable error class (retries
 *                                  are already done inside simulateScenario)
 *   - trust-log write failure   -> 500 with a generic message; the detail is
 *                                  logged server-side, never sent to the client
 *
 * Each request is a new logical simulation, so the idempotency key defaults to
 * a fresh UUID. A caller retrying one specific attempt sends the same
 * Idempotency-Key header and gets the same trust-log entry back.
 */
export function createScenarioRouter(deps: ScenarioRouteDeps = {}): Router {
  const router = Router();
  // One shared instance: FileTrustLogger serialises writes per instance, so
  // concurrent requests must not each build their own.
  const trustLogger = deps.trustLogger ?? new FileTrustLogger(DEFAULT_TRUST_LOG_PATH);

  router.post("/simulate", async (req: Request, res: Response) => {
    const parsed = ScenarioRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request", message: parsed.error.message });
      return;
    }

    const idempotencyKey = req.header("Idempotency-Key") ?? randomUUID();

    try {
      const result = await simulateScenario(parsed.data, {
        idempotencyKey,
        client: deps.client,
        trustLogger,
        timeoutMs: deps.timeoutMs ?? DEFAULT_SCENARIO_TIMEOUT_MS,
        backoffBaseMs: deps.backoffBaseMs,
      });

      if (result.outcome === "success") {
        res.status(200).json({
          projection: result.projection,
          conflictFlags: result.conflictFlags,
          attempts: result.attempts,
          transactionId: result.transactionId,
        });
        return;
      }

      if (result.outcome === "invalid_input") {
        // Unreachable in practice (validated above); kept so a schema drift between
        // this route and simulateScenario fails as a 400 instead of a 502.
        res.status(400).json({ error: "invalid_request", message: result.errorMessage });
        return;
      }

      res.status(502).json({ error: result.errorClass, message: result.errorMessage });
    } catch (error) {
      console.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "error",
          service: "backend",
          event: "scenario_simulate_route_failure",
          errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
          errorMessage: error instanceof Error ? error.message : String(error),
        }),
      );
      res.status(500).json({ error: "internal_error", message: "The scenario could not be simulated." });
    }
  });

  return router;
}
