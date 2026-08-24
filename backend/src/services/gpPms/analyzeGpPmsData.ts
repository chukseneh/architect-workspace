import { GpPmsClient, GpPmsErrorClass } from "./types";
import { IngestGpPmsRecordsOptions, ingestGpPmsRecords } from "./ingestGpPmsRecords";
import { GenerateInsightsOptions, GpPmsInsights, generateInsights } from "./generateInsights";

export type AnalyzeGpPmsDataResult =
  | { outcome: "success"; insights: GpPmsInsights; attempts: number }
  | { outcome: "failure"; errorClass: GpPmsErrorClass; errorMessage: string; attempts: number };

/**
 * End-to-end path for STORY-001's first acceptance criterion: ingest, then
 * derive insights from what was ingested. Ingestion failures short-circuit
 * before insight generation is attempted — there is nothing to analyze yet.
 */
export async function analyzeGpPmsData(
  client: GpPmsClient,
  ingestOptions: IngestGpPmsRecordsOptions,
  insightsOptions: GenerateInsightsOptions = {},
): Promise<AnalyzeGpPmsDataResult> {
  const ingestResult = await ingestGpPmsRecords(client, ingestOptions);
  if (ingestResult.outcome === "failure") {
    return ingestResult;
  }

  const insights = generateInsights(ingestResult.records, insightsOptions);
  return { outcome: "success", insights, attempts: ingestResult.attempts };
}
