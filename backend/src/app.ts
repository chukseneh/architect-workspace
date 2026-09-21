import express, { Express } from "express";
import { createDashboardRouter, DashboardRouteDeps } from "./routes/dashboardRoute";
import { createDecisionCycleRouter, DecisionCycleRouteDeps } from "./routes/decisionCycleRoute";
import { createScenarioRouter, ScenarioRouteDeps } from "./routes/scenarioRoute";

export interface CreateAppDeps {
  dashboard?: DashboardRouteDeps;
  decisionCycle?: DecisionCycleRouteDeps;
  scenario?: ScenarioRouteDeps;
}

/**
 * App factory rather than a module-level singleton, so tests can create an
 * isolated instance per test (no shared state across test files) without
 * starting a real listener — see app.test.ts. Route dependencies (LLM
 * clients, trust loggers) are threaded through here so route-level tests
 * can inject fakes without touching the real Anthropic API.
 */
export function createApp(deps: CreateAppDeps = {}): Express {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.use("/api/dashboard", createDashboardRouter(deps.dashboard));
  app.use("/api/decision-cycle", createDecisionCycleRouter(deps.decisionCycle));
  app.use("/api/scenario", createScenarioRouter(deps.scenario));

  return app;
}
