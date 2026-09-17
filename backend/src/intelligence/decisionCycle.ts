import { AmbulanceClient, AmbulanceErrorClass } from "../services/ambulance/types";
import { ingestAmbulanceRecords } from "../services/ambulance/ingestAmbulanceRecords";
import { generateAmbulanceInsights } from "../services/ambulance/generateAmbulanceInsights";
import { CommunityClient, CommunityErrorClass } from "../services/community/types";
import { ingestCommunityRecords } from "../services/community/ingestCommunityRecords";
import { generateCommunityInsights } from "../services/community/generateCommunityInsights";
import { NhsCentralDataClient, NhsCentralDataErrorClass } from "../services/nhsCentralData/types";
import { ingestNhsCentralData } from "../services/nhsCentralData/ingestNhsCentralData";
import { DEFAULT_TRUST_LOG_PATH, FileTrustLogger } from "../services/trustSpine/fileTrustLogger";
import { TrustLogger } from "../services/trustSpine/types";
import { generatePressurePrediction } from "./predictPressure";
import { PredictPressureErrorClass, PredictPressureOutput, PressurePredictionClient } from "./types";

/** REQ-014: "reduce operational decision-making time ... to under 1 hour." */
export const DEFAULT_DECISION_CYCLE_BUDGET_MS = 60 * 60 * 1000;

/**
 * Caps how many `generatePressurePrediction` calls run at once. Real NHS
 * England has ~42 ICBs — firing that many concurrent Anthropic API requests
 * unbounded risks tripping rate limits under genuinely high data volume
 * (this story's own "Performance degradation" failure path), trading one
 * kind of slowdown for a worse one. 5 is a conservative default a caller can
 * override once real production rate limits are known.
 */
export const DEFAULT_MAX_CONCURRENT_PREDICTIONS = 5;

export interface DecisionCycleOptions {
  /** Every ICB to produce a pressure prediction for in this run. */
  icbNames: string[];
  /** ISO-8601, required by NhsCentralDataFetchOptions — see its own contract. */
  since: string;
  /** Base key for this run; each sub-step derives its own suffixed idempotency key from it. */
  idempotencyKey: string;
  timeoutMs: number;
  nhsClient: NhsCentralDataClient;
  ambulanceClient: AmbulanceClient;
  communityClient: CommunityClient;
  /** Defaults to a real AnthropicPressurePredictionClient; inject a fake in tests. */
  predictionClient?: PressurePredictionClient;
  /** Reference time for the two insight generators' staleness checks. Defaults to now; injectable for tests. */
  now?: Date;
  /** Defaults to a FileTrustLogger at DEFAULT_TRUST_LOG_PATH; inject a fake in tests. */
  trustLogger?: TrustLogger;
  /** REQ-014's compliance threshold. Defaults to DEFAULT_DECISION_CYCLE_BUDGET_MS; injectable for tests. */
  budgetMs?: number;
  /** Caps concurrent prediction calls. Defaults to DEFAULT_MAX_CONCURRENT_PREDICTIONS; injectable for tests. */
  maxConcurrentPredictions?: number;
}

export interface DecisionCycleStepTiming {
  step: "sourceIngest" | "insightGeneration" | "predictions";
  durationMs: number;
}

export type DecisionCycleIcbResult =
  | { icbName: string; outcome: "success"; prediction: PredictPressureOutput }
  | { icbName: string; outcome: "no_data" }
  | { icbName: string; outcome: "failure"; errorClass: PredictPressureErrorClass; errorMessage: string };

export type DecisionCycleResult =
  | {
      outcome: "success";
      results: DecisionCycleIcbResult[];
      totalDurationMs: number;
      budgetMs: number;
      withinBudget: boolean;
      stepTimings: DecisionCycleStepTiming[];
      transactionId: string;
    }
  | {
      /** REQ-003/004/STORY-011: a shared ingestion source failed before any ICB could be processed. */
      outcome: "data_processing_error";
      source: "nhsCentralData" | "ambulance" | "community";
      errorClass: NhsCentralDataErrorClass | AmbulanceErrorClass | CommunityErrorClass;
      errorMessage: string;
      totalDurationMs: number;
      transactionId: string;
    };

/**
 * STORY-010's decision-cycle orchestrator, built to measure REQ-014's "under
 * 1 hour" target honestly rather than assume it. `analyzeIcbPressure.ts`
 * (STORY-012) ingests NHS central data, ambulance, and community fresh on
 * every call — correct for a single ICB, but calling it once per ICB would
 * re-fetch and re-derive insights from the exact same ambulance/community
 * datasets N times, which is the real "high data volume" bottleneck this
 * story's acceptance criteria target. Here, each of the three sources is
 * ingested exactly once (in parallel — they're independent of each other),
 * insights are derived exactly once, and only the genuinely per-ICB step
 * (the prediction call) runs once per ICB, also in parallel since each is
 * independent of the others.
 *
 * Every step is timed and the whole run is trust-logged once with its total
 * duration and budget compliance — the Trust acceptance criterion — so
 * "maintains performance under high data volume" is something this function
 * proves on every run, not a one-time benchmark.
 */
export async function runDecisionCycle(options: DecisionCycleOptions): Promise<DecisionCycleResult> {
  const trustLogger = options.trustLogger ?? new FileTrustLogger(DEFAULT_TRUST_LOG_PATH);
  const budgetMs = options.budgetMs ?? DEFAULT_DECISION_CYCLE_BUDGET_MS;
  const overallStart = Date.now();
  const stepTimings: DecisionCycleStepTiming[] = [];

  const ingestStart = Date.now();
  const [nhsResult, ambulanceResult, communityResult] = await Promise.all([
    ingestNhsCentralData(options.nhsClient, {
      since: options.since,
      // Forwarded verbatim to nhs-ops-status's idempotency_key tool
      // argument by McpNhsCentralDataClient, which validates it against
      // `^[A-Za-z0-9_-]+$` server-side — a colon suffix fails that check
      // against the real server (discovered live; FakeNhsCentralDataClient
      // doesn't enforce this, so it wasn't caught by tests).
      idempotencyKey: `${options.idempotencyKey}-nhs-ingest`,
      timeoutMs: options.timeoutMs,
      trustLogger,
    }),
    ingestAmbulanceRecords(options.ambulanceClient, {
      idempotencyKey: `${options.idempotencyKey}-ambulance-ingest`,
      timeoutMs: options.timeoutMs,
      trustLogger,
    }),
    ingestCommunityRecords(options.communityClient, {
      idempotencyKey: `${options.idempotencyKey}-community-ingest`,
      timeoutMs: options.timeoutMs,
      trustLogger,
    }),
  ]);
  stepTimings.push({ step: "sourceIngest", durationMs: Date.now() - ingestStart });

  if (nhsResult.outcome === "failure") {
    return await recordFailure("nhsCentralData", nhsResult.errorClass, nhsResult.errorMessage, nhsResult.transactionId);
  }
  if (ambulanceResult.outcome === "failure") {
    return await recordFailure("ambulance", ambulanceResult.errorClass, ambulanceResult.errorMessage, ambulanceResult.transactionId);
  }
  if (communityResult.outcome === "failure") {
    return await recordFailure("community", communityResult.errorClass, communityResult.errorMessage, communityResult.transactionId);
  }

  const insightsStart = Date.now();
  const [{ insights: ambulanceInsights }, { insights: communityInsights }] = await Promise.all([
    generateAmbulanceInsights(ambulanceResult.records, {
      now: options.now,
      idempotencyKey: ambulanceResult.transactionId,
      trustLogger,
    }),
    generateCommunityInsights(communityResult.records, {
      now: options.now,
      idempotencyKey: communityResult.transactionId,
      trustLogger,
    }),
  ]);
  stepTimings.push({ step: "insightGeneration", durationMs: Date.now() - insightsStart });

  const predictionsStart = Date.now();
  const maxConcurrentPredictions = options.maxConcurrentPredictions ?? DEFAULT_MAX_CONCURRENT_PREDICTIONS;
  const results = await mapWithConcurrency(
    options.icbNames,
    maxConcurrentPredictions,
    async (icbName): Promise<DecisionCycleIcbResult> => {
      const nhsRecord = nhsResult.records.find((record) => record.icbName === icbName) ?? null;
      const predictionResult = await generatePressurePrediction(nhsRecord, ambulanceInsights, communityInsights, {
        idempotencyKey: `${options.idempotencyKey}:predict-pressure:${icbName}`,
        timeoutMs: options.timeoutMs,
        client: options.predictionClient,
        trustLogger,
      });

      if (predictionResult.outcome === "no_data") {
        return { icbName, outcome: "no_data" };
      }
      if (predictionResult.outcome === "failure") {
        return {
          icbName,
          outcome: "failure",
          errorClass: predictionResult.errorClass,
          errorMessage: predictionResult.errorMessage,
        };
      }
      return { icbName, outcome: "success", prediction: predictionResult.prediction };
    },
  );
  stepTimings.push({ step: "predictions", durationMs: Date.now() - predictionsStart });

  const totalDurationMs = Date.now() - overallStart;
  const withinBudget = totalDurationMs <= budgetMs;

  const { transactionId } = await trustLogger.record({
    idempotencyKey: options.idempotencyKey,
    processType: "prediction",
    processName: "runDecisionCycle",
    outcome: "success",
    context: {
      icbCount: options.icbNames.length,
      totalDurationMs,
      budgetMs,
      withinBudget,
      stepTimings,
    },
  });

  return { outcome: "success", results, totalDurationMs, budgetMs, withinBudget, stepTimings, transactionId };

  async function recordFailure(
    source: "nhsCentralData" | "ambulance" | "community",
    errorClass: NhsCentralDataErrorClass | AmbulanceErrorClass | CommunityErrorClass,
    errorMessage: string,
    sourceTransactionId: string,
  ): Promise<DecisionCycleResult> {
    const totalDurationMs = Date.now() - overallStart;
    const { transactionId } = await trustLogger.record({
      idempotencyKey: options.idempotencyKey,
      processType: "prediction",
      processName: "runDecisionCycle",
      outcome: "failure",
      errorClass,
      context: { icbCount: options.icbNames.length, source, totalDurationMs, sourceTransactionId },
    });
    return { outcome: "data_processing_error", source, errorClass, errorMessage, totalDurationMs, transactionId };
  }
}

/**
 * Runs `fn` over `items` with at most `concurrency` calls in flight at once,
 * preserving input order in the returned array. A small worker-pool over a
 * shared cursor rather than chunking — a slow item never blocks a fast one
 * behind it in the same batch. No dependency added for this (CLAUDE.md:
 * "drive-by npm install is not allowed") since the whole thing is this
 * short.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      results[currentIndex] = await fn(items[currentIndex]!, currentIndex);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
