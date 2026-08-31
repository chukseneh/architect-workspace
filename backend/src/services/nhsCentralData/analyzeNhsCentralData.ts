import { NhsCentralDataClient, NhsCentralDataErrorClass } from "./types";
import { IngestNhsCentralDataOptions, ingestNhsCentralData } from "./ingestNhsCentralData";
import { GenerateNhsInsightsOptions, NhsCentralDataInsights, generateNhsInsights } from "./generateNhsInsights";

export type AnalyzeNhsCentralDataResult =
  | { outcome: "success"; insights: NhsCentralDataInsights; attempts: number }
  | { outcome: "failure"; errorClass: NhsCentralDataErrorClass; errorMessage: string; attempts: number };

/**
 * End-to-end path for STORY-002's first acceptance criterion: ingest, then
 * derive insights from what was ingested. Ingestion failures short-circuit
 * before insight generation is attempted — there is nothing to analyze yet.
 */
export async function analyzeNhsCentralData(
  client: NhsCentralDataClient,
  ingestOptions: IngestNhsCentralDataOptions,
  insightsOptions: GenerateNhsInsightsOptions = {},
): Promise<AnalyzeNhsCentralDataResult> {
  const ingestResult = await ingestNhsCentralData(client, ingestOptions);
  if (ingestResult.outcome === "failure") {
    return ingestResult;
  }

  const insights = generateNhsInsights(ingestResult.records, insightsOptions);
  return { outcome: "success", insights, attempts: ingestResult.attempts };
}
