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

export interface AnalyzeIcbPressureOptions {
  /** Which ICB's NHS central data record to predict pressure for. */
  icbName: string;
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
}

export type AnalyzeIcbPressureResult =
  | {
      /** REQ-003/004/STORY-011: an ingestion pipeline itself failed (connection, timeout, or malformed source data). */
      outcome: "data_processing_error";
      source: "nhsCentralData" | "ambulance" | "community";
      errorClass: NhsCentralDataErrorClass | AmbulanceErrorClass | CommunityErrorClass;
      errorMessage: string;
      transactionId: string;
    }
  | {
      /** STORY-012 acceptance criterion 2: no NHS central data record exists for the requested ICB. */
      outcome: "no_data";
      transactionId: string;
    }
  | {
      /** The predict-pressure model call itself failed after exhausting retries. */
      outcome: "insight_generation_failure";
      errorClass: PredictPressureErrorClass;
      errorMessage: string;
      transactionId: string;
    }
  | {
      /** STORY-012 acceptance criterion 1: enhanced insights were generated. */
      outcome: "success";
      prediction: PredictPressureOutput;
      transactionId: string;
    };

/**
 * The end-to-end walking skeleton for STORY-012: ingest all three sources
 * (NHS central data identifies the ICB and its OPEL level; ambulance and
 * community fill in the two live metrics REQ-003/REQ-004 require), then
 * call the AI intelligence layer. Each ingestion failure short-circuits
 * before the next step is attempted, same as analyzeGpPmsData/
 * analyzeNhsCentralData — there is nothing to predict from a partially
 * failed ingest.
 *
 * Every step already trust-logs itself (ingestion runs log processType
 * "ingestion"; the two generateXInsights calls and generatePressurePrediction
 * log processType "prediction") — this function does no additional trust
 * logging of its own, only wires the pieces together and shares one
 * trustLogger across all of them so a single run's audit trail lives in one
 * place.
 */
export async function analyzeIcbPressure(options: AnalyzeIcbPressureOptions): Promise<AnalyzeIcbPressureResult> {
  const trustLogger = options.trustLogger ?? new FileTrustLogger(DEFAULT_TRUST_LOG_PATH);

  const nhsResult = await ingestNhsCentralData(options.nhsClient, {
    since: options.since,
    idempotencyKey: `${options.idempotencyKey}:nhs-ingest`,
    timeoutMs: options.timeoutMs,
    trustLogger,
  });
  if (nhsResult.outcome === "failure") {
    return {
      outcome: "data_processing_error",
      source: "nhsCentralData",
      errorClass: nhsResult.errorClass,
      errorMessage: nhsResult.errorMessage,
      transactionId: nhsResult.transactionId,
    };
  }

  const ambulanceResult = await ingestAmbulanceRecords(options.ambulanceClient, {
    idempotencyKey: `${options.idempotencyKey}:ambulance-ingest`,
    timeoutMs: options.timeoutMs,
    trustLogger,
  });
  if (ambulanceResult.outcome === "failure") {
    return {
      outcome: "data_processing_error",
      source: "ambulance",
      errorClass: ambulanceResult.errorClass,
      errorMessage: ambulanceResult.errorMessage,
      transactionId: ambulanceResult.transactionId,
    };
  }

  const communityResult = await ingestCommunityRecords(options.communityClient, {
    idempotencyKey: `${options.idempotencyKey}:community-ingest`,
    timeoutMs: options.timeoutMs,
    trustLogger,
  });
  if (communityResult.outcome === "failure") {
    return {
      outcome: "data_processing_error",
      source: "community",
      errorClass: communityResult.errorClass,
      errorMessage: communityResult.errorMessage,
      transactionId: communityResult.transactionId,
    };
  }

  const { insights: ambulanceInsights } = await generateAmbulanceInsights(ambulanceResult.records, {
    now: options.now,
    idempotencyKey: ambulanceResult.transactionId,
    trustLogger,
  });
  const { insights: communityInsights } = await generateCommunityInsights(communityResult.records, {
    now: options.now,
    idempotencyKey: communityResult.transactionId,
    trustLogger,
  });

  const nhsRecord = nhsResult.records.find((record) => record.icbName === options.icbName) ?? null;

  const predictionResult = await generatePressurePrediction(nhsRecord, ambulanceInsights, communityInsights, {
    idempotencyKey: `${options.idempotencyKey}:predict-pressure`,
    timeoutMs: options.timeoutMs,
    client: options.predictionClient,
    trustLogger,
  });

  if (predictionResult.outcome === "no_data") {
    return { outcome: "no_data", transactionId: predictionResult.transactionId };
  }
  if (predictionResult.outcome === "failure") {
    return {
      outcome: "insight_generation_failure",
      errorClass: predictionResult.errorClass,
      errorMessage: predictionResult.errorMessage,
      transactionId: predictionResult.transactionId,
    };
  }
  return { outcome: "success", prediction: predictionResult.prediction, transactionId: predictionResult.transactionId };
}
