import { AmbulanceClient, AmbulanceErrorClass } from "./types";
import { IngestAmbulanceRecordsOptions, ingestAmbulanceRecords } from "./ingestAmbulanceRecords";
import { AmbulanceInsights, GenerateAmbulanceInsightsOptions, generateAmbulanceInsights } from "./generateAmbulanceInsights";

export type AnalyzeAmbulanceDataResult =
  | {
      outcome: "success";
      insights: AmbulanceInsights;
      attempts: number;
      ingestionTransactionId: string;
      predictionTransactionId: string;
    }
  | {
      outcome: "failure";
      errorClass: AmbulanceErrorClass;
      errorMessage: string;
      attempts: number;
      ingestionTransactionId: string;
    };

/** idempotencyKey defaults to the ingestion run's transactionId — one prediction per ingested batch. */
export type AnalyzeAmbulanceDataInsightsOptions = Omit<GenerateAmbulanceInsightsOptions, "idempotencyKey"> & {
  idempotencyKey?: string;
};

/**
 * End-to-end path for REQ-003: ingest ambulance handover records, then
 * derive insights from what was ingested. Ingestion failures short-circuit
 * before insight generation is attempted — there is nothing to analyze yet.
 */
export async function analyzeAmbulanceData(
  client: AmbulanceClient,
  ingestOptions: IngestAmbulanceRecordsOptions,
  insightsOptions: AnalyzeAmbulanceDataInsightsOptions = {},
): Promise<AnalyzeAmbulanceDataResult> {
  const ingestResult = await ingestAmbulanceRecords(client, ingestOptions);
  if (ingestResult.outcome === "failure") {
    return {
      outcome: "failure",
      errorClass: ingestResult.errorClass,
      errorMessage: ingestResult.errorMessage,
      attempts: ingestResult.attempts,
      ingestionTransactionId: ingestResult.transactionId,
    };
  }

  const { insights, transactionId: predictionTransactionId } = await generateAmbulanceInsights(
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
