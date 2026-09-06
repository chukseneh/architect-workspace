import { CommunityClient, CommunityErrorClass } from "./types";
import { IngestCommunityRecordsOptions, ingestCommunityRecords } from "./ingestCommunityRecords";
import { CommunityInsights, GenerateCommunityInsightsOptions, generateCommunityInsights } from "./generateCommunityInsights";

export type AnalyzeCommunityDataResult =
  | {
      outcome: "success";
      insights: CommunityInsights;
      attempts: number;
      ingestionTransactionId: string;
      predictionTransactionId: string;
    }
  | {
      outcome: "failure";
      errorClass: CommunityErrorClass;
      errorMessage: string;
      attempts: number;
      ingestionTransactionId: string;
    };

/** idempotencyKey defaults to the ingestion run's transactionId — one prediction per ingested batch. */
export type AnalyzeCommunityDataInsightsOptions = Omit<GenerateCommunityInsightsOptions, "idempotencyKey"> & {
  idempotencyKey?: string;
};

/**
 * End-to-end path for REQ-004: ingest community delayed-discharge records,
 * then derive insights from what was ingested. Ingestion failures
 * short-circuit before insight generation is attempted — there is nothing
 * to analyze yet.
 */
export async function analyzeCommunityData(
  client: CommunityClient,
  ingestOptions: IngestCommunityRecordsOptions,
  insightsOptions: AnalyzeCommunityDataInsightsOptions = {},
): Promise<AnalyzeCommunityDataResult> {
  const ingestResult = await ingestCommunityRecords(client, ingestOptions);
  if (ingestResult.outcome === "failure") {
    return {
      outcome: "failure",
      errorClass: ingestResult.errorClass,
      errorMessage: ingestResult.errorMessage,
      attempts: ingestResult.attempts,
      ingestionTransactionId: ingestResult.transactionId,
    };
  }

  const { insights, transactionId: predictionTransactionId } = await generateCommunityInsights(
    ingestResult.records,
    {
      ...insightsOptions,
      idempotencyKey: insightsOptions.idempotencyKey ?? ingestResult.transactionId,
    },
  );
  return {
    outcome: "success",
    insights,
    attempts: ingestResult.attempts,
    ingestionTransactionId: ingestResult.transactionId,
    predictionTransactionId,
  };
}
