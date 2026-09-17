import { randomUUID } from "node:crypto";
import { Router, Request, Response } from "express";
import { z } from "zod";
import { runDecisionCycle } from "../intelligence/decisionCycle";
import { PressurePredictionClient } from "../intelligence/types";
import { NhsCentralDataClient } from "../services/nhsCentralData/types";
import { McpNhsCentralDataClient } from "../services/nhsCentralData/mcpNhsCentralDataClient";
import { AmbulanceClient } from "../services/ambulance/types";
import { MockAmbulanceClient } from "../services/ambulance/mockAmbulanceClient";
import { CommunityClient } from "../services/community/types";
import { MockCommunityClient } from "../services/community/mockCommunityClient";
import { TrustLogger } from "../services/trustSpine/types";

const DEFAULT_ROUTE_TIMEOUT_MS = 8000;

/** Only the request's shape is enforced here, per CLAUDE.md's Contract Enforcement Layer. */
const DecisionCycleRequestSchema = z.object({
  icbNames: z.array(z.string().min(1)).min(1),
  since: z.string().datetime(),
  budgetMs: z.number().int().positive().optional(),
  maxConcurrentPredictions: z.number().int().positive().optional(),
});

export interface DecisionCycleRouteDeps {
  /** Defaults to a real McpNhsCentralDataClient; inject a fake in tests. */
  nhsClient?: NhsCentralDataClient;
  /** Defaults to MockAmbulanceClient — the same client this codebase's live demos treat as the real (if fixture-backed) production source, since no live ambulance feed exists yet. */
  ambulanceClient?: AmbulanceClient;
  /** Defaults to MockCommunityClient, same reasoning as ambulanceClient. */
  communityClient?: CommunityClient;
  /** Defaults to a real AnthropicPressurePredictionClient (via runDecisionCycle); inject a fake in tests. */
  predictionClient?: PressurePredictionClient;
  /** Defaults to a FileTrustLogger; inject a fake in tests. */
  trustLogger?: TrustLogger;
}

/**
 * POST /api/decision-cycle/run — the HTTP surface for STORY-010's decision
 * cycle, REQ-014's "under 1 hour" performance requirement made reachable
 * from outside a test or a throwaway demo script. Each request is a new
 * logical run, so its idempotencyKey defaults to a fresh UUID; a caller
 * wanting retry-safety against a specific attempt can supply one explicitly
 * via the Idempotency-Key header, same convention as dashboardRoute.ts.
 *
 * A `data_processing_error` (a shared ingestion source failed) surfaces as
 * 502 — an upstream failure, not a client error. A trust-log write failure
 * or any other uncaught exception is caught here rather than left to crash
 * the process or leak internals to the client — this route is the trust
 * boundary, same "fail loud everywhere upstream, absorb here" policy as
 * dashboardRoute.ts.
 */
export function createDecisionCycleRouter(deps: DecisionCycleRouteDeps = {}): Router {
  const router = Router();

  router.post("/run", async (req: Request, res: Response) => {
    const parsed = DecisionCycleRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request", message: parsed.error.message });
      return;
    }

    const idempotencyKey = req.header("Idempotency-Key") ?? randomUUID();

    try {
      const result = await runDecisionCycle({
        icbNames: parsed.data.icbNames,
        since: parsed.data.since,
        idempotencyKey,
        timeoutMs: DEFAULT_ROUTE_TIMEOUT_MS,
        budgetMs: parsed.data.budgetMs,
        maxConcurrentPredictions: parsed.data.maxConcurrentPredictions,
        nhsClient: deps.nhsClient ?? new McpNhsCentralDataClient(),
        ambulanceClient: deps.ambulanceClient ?? new MockAmbulanceClient(),
        communityClient: deps.communityClient ?? new MockCommunityClient(),
        predictionClient: deps.predictionClient,
        trustLogger: deps.trustLogger,
      });

      if (result.outcome === "success") {
        res.status(200).json(result);
        return;
      }

      res.status(502).json({ error: result.errorClass, message: result.errorMessage, source: result.source });
    } catch (error) {
      console.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "error",
          service: "backend",
          event: "decision_cycle_route_failure",
          errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
          errorMessage: error instanceof Error ? error.message : String(error),
        }),
      );
      res.status(500).json({ error: "internal_error", message: "The decision cycle could not be completed." });
    }
  });

  return router;
}
