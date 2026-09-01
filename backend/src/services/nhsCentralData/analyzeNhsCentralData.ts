import { NhsCentralDataClient, NhsCentralDataErrorClass } from "./types";
import { IngestNhsCentralDataOptions, ingestNhsCentralData } from "./ingestNhsCentralData";
import { GenerateNhsInsightsOptions, NhsCentralDataInsights, generateNhsInsights } from "./generateNhsInsights";

export type AnalyzeNhsCentralDataResult =
  | {
      outcome: "success";
      insights: NhsCentralDataInsights;
      attempts: number;
      ingestionTransactionId: string;
      predictionTransactionId: string;
    }
  | {
      outcome: "failure";
      errorClass: NhsCentralDataErrorClass;
      errorMessage: string;
      attempts: number;
      ingestionTransactionId: string;
    };

/** idempotencyKey defaults to the ingestion run's transactionId — one prediction per ingested batch. */
export type AnalyzeNhsCentralDataInsightsOptions = Omit<GenerateNhsInsightsOptions, "idempotencyKey"> & {
  idempotencyKey?: string;
};

/**
 * End-to-end path for STORY-002's first acceptance criterion: ingest, then
 * derive insights from what was ingested. Ingestion failures short-circuit
 * before insight generation is attempted — there is nothing to analyze yet.
 */
export async function analyzeNhsCentralData(
  client: NhsCentralDataClient,
  ingestOptions: IngestNhsCentralDataOptions,
  insightsOptions: AnalyzeNhsCentralDataInsightsOptions = {},
): Promise<AnalyzeNhsCentralDataResult> {
  const ingestResult = await ingestNhsCentralData(client, ingestOptions);
  if (ingestResult.outcome === "failure") {
    return {
      outcome: "failure",
      errorClass: ingestResult.errorClass,
      errorMessage: ingestResult.errorMessage,
      attempts: ingestResult.attempts,
      ingestionTransactionId: ingestResult.transactionId,
    };
  }

  const { insights, transactionId: predictionTransactionId } = await generateNhsInsights(
    ingestResult.records,
    { ...insightsOptions, idempotencyKey: insightsOptions.idempotencyKey ?? ingestResult.transactionId },
  );
  return {
    outcome: "success",
    insights,
    attempts: ingestResult.attempts,
    ingestionTransactionId: ingestResult.transactionId,
    predictionTransactionId,
  };
}
