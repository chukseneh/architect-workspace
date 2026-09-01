import { GpPmsClient, GpPmsErrorClass } from "./types";
import { IngestGpPmsRecordsOptions, ingestGpPmsRecords } from "./ingestGpPmsRecords";
import { GenerateInsightsOptions, GpPmsInsights, generateInsights } from "./generateInsights";

export type AnalyzeGpPmsDataResult =
  | {
      outcome: "success";
      insights: GpPmsInsights;
      attempts: number;
      ingestionTransactionId: string;
      predictionTransactionId: string;
    }
  | {
      outcome: "failure";
      errorClass: GpPmsErrorClass;
      errorMessage: string;
      attempts: number;
      ingestionTransactionId: string;
    };

/** idempotencyKey defaults to the ingestion run's transactionId — one prediction per ingested batch. */
export type AnalyzeGpPmsDataInsightsOptions = Omit<GenerateInsightsOptions, "idempotencyKey"> & {
  idempotencyKey?: string;
};

/**
 * End-to-end path for STORY-001's first acceptance criterion: ingest, then
 * derive insights from what was ingested. Ingestion failures short-circuit
 * before insight generation is attempted — there is nothing to analyze yet.
 */
export async function analyzeGpPmsData(
  client: GpPmsClient,
  ingestOptions: IngestGpPmsRecordsOptions,
  insightsOptions: AnalyzeGpPmsDataInsightsOptions = {},
): Promise<AnalyzeGpPmsDataResult> {
  const ingestResult = await ingestGpPmsRecords(client, ingestOptions);
  if (ingestResult.outcome === "failure") {
    return {
      outcome: "failure",
      errorClass: ingestResult.errorClass,
      errorMessage: ingestResult.errorMessage,
      attempts: ingestResult.attempts,
      ingestionTransactionId: ingestResult.transactionId,
    };
  }

  const { insights, transactionId: predictionTransactionId } = await generateInsights(ingestResult.records, {
    ...insightsOptions,
    idempotencyKey: insightsOptions.idempotencyKey ?? ingestResult.transactionId,
  });
  return {
    outcome: "success",
    insights,
    attempts: ingestResult.attempts,
    ingestionTransactionId: ingestResult.transactionId,
    predictionTransactionId,
  };
}
