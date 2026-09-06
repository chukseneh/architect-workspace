import { randomUUID } from "node:crypto";
import { Router, Request, Response } from "express";
import { z } from "zod";
import { DashboardClient, IcbDashboardEntrySchema } from "../intelligence/dashboardTypes";
import { buildDashboardSnapshot } from "../intelligence/dashboardSnapshot";
import { TrustLogger } from "../services/trustSpine/types";

/**
 * Only the request's overall SHAPE is enforced here (an array of entries,
 * each with the right field types) — per CLAUDE.md's Contract Enforcement
 * Layer, malformed input must never reach business logic. A value that's
 * the right shape but operationally malformed (e.g. forecastedPressureLevel:
 * "Severe") is deliberately NOT rejected here: IcbDashboardEntrySchema
 * already leaves that field as a loose string so it flows through to
 * buildDashboardSnapshot's own graceful "flag for review" handling — see
 * dashboardTypes.ts's comment on that field for why.
 */
const DashboardSnapshotRequestSchema = z.object({
  entries: z.array(IcbDashboardEntrySchema),
});

export interface DashboardRouteDeps {
  /** Defaults to a real AnthropicDashboardClient (via buildDashboardSnapshot); inject a fake in tests. */
  client?: DashboardClient;
  /** Defaults to a FileTrustLogger; inject a fake in tests. */
  trustLogger?: TrustLogger;
}

/**
 * POST /api/dashboard/snapshot — the HTTP surface for STORY-007's dashboard
 * data layer. Each request is a new logical "display" event, so its
 * idempotencyKey defaults to a fresh UUID; a caller that wants retry-safety
 * against a specific attempt (e.g. its own network retry) can supply one
 * explicitly via the Idempotency-Key header instead.
 *
 * A trust-log write failure (TrustSpineError) is caught here rather than
 * left to crash the process or leak internals to the client — logged
 * server-side with its error class, a generic 500 returned to the caller.
 * This is the one place in this codebase that "fail loud" is intentionally
 * absorbed, because an HTTP handler is the trust boundary: everything
 * upstream of this catch still fails loud exactly as designed.
 */
export function createDashboardRouter(deps: DashboardRouteDeps = {}): Router {
  const router = Router();

  router.post("/snapshot", async (req: Request, res: Response) => {
    const parsed = DashboardSnapshotRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request", message: parsed.error.message });
      return;
    }

    const idempotencyKey = req.header("Idempotency-Key") ?? randomUUID();

    try {
      const result = await buildDashboardSnapshot(parsed.data.entries, {
        idempotencyKey,
        client: deps.client,
        trustLogger: deps.trustLogger,
      });

      if (result.outcome === "success") {
        res.status(200).json(result.snapshot);
        return;
      }

      res.status(502).json({ error: result.errorClass, message: result.errorMessage });
    } catch (error) {
      console.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "error",
          service: "backend",
          event: "dashboard_snapshot_route_failure",
          errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
          errorMessage: error instanceof Error ? error.message : String(error),
        }),
      );
      res.status(500).json({ error: "internal_error", message: "The dashboard snapshot could not be generated." });
    }
  });

  return router;
}
