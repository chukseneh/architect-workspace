import { DEFAULT_TRUST_LOG_PATH, FileTrustLogger } from "../services/trustSpine/fileTrustLogger";
import { TrustLogger } from "../services/trustSpine/types";
import {
  DashboardClient,
  DashboardError,
  DashboardErrorClass,
  DraftLeadershipBriefingOutput,
  DraftLeadershipBriefingOutputSchema,
  IcbDashboardEntry,
} from "./dashboardTypes";
import { AnthropicDashboardClient } from "./anthropicDashboardClient";
import { PROMPT_VERSION, renderDraftLeadershipBriefingPrompt } from "./draftLeadershipBriefingPrompt";
import { extractFirstJsonObject } from "./extractJsonObject";

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_BACKOFF_BASE_MS = 500;

const VALID_PRESSURE_TIERS: readonly string[] = ["Low", "Medium", "High", "Critical"];

/** A malformed model reply is retried — a stochastic model can succeed on a second attempt. */
const RETRYABLE_ERROR_CLASSES: readonly DashboardErrorClass[] = [
  "TimeoutError",
  "RateLimitError",
  "UpstreamUnavailable",
  "ValidationError",
];

/**
 * REQ-016 ("current and forecasted operational metrics on a dashboard") +
 * REQ-012 ("concise briefing") in one payload — the data contract a future
 * UI would render. `dataUncertainties` combines our own structural checks
 * (empty input, a forecast that isn't one of the four valid tiers) with
 * whatever the briefing prompt's own fail-safe rules surface in `briefing`,
 * so a caller doesn't have to trust the model's prose alone to know
 * something needs review.
 */
export interface DashboardSnapshot {
  metrics: IcbDashboardEntry[];
  briefing: DraftLeadershipBriefingOutput;
  dataUncertainties: string[];
  generatedAt: string;
}

export interface DashboardAttemptLogEntry {
  timestamp: string;
  event: "dashboard_snapshot_attempt";
  attempt: number;
  maxAttempts: number;
  durationMs: number;
  outcome: "success" | "failure";
  errorClass?: DashboardErrorClass;
  errorMessage?: string;
}

export type DashboardAttemptLogger = (entry: DashboardAttemptLogEntry) => void;

/** One structured JSON line per attempt, per CLAUDE.md's Observability Framework. */
export const consoleDashboardLogger: DashboardAttemptLogger = (entry) => {
  console.log(JSON.stringify(entry));
};

export interface BuildDashboardSnapshotOptions {
  /** Identifies this logical snapshot run — reused on replay instead of minting a new transaction ID. */
  idempotencyKey: string;
  timeoutMs?: number;
  maxAttempts?: number;
  backoffBaseMs?: number;
  /** Defaults to a real AnthropicDashboardClient; inject a fake in tests. */
  client?: DashboardClient;
  logger?: DashboardAttemptLogger;
  /** Defaults to a FileTrustLogger at DEFAULT_TRUST_LOG_PATH; inject a fake in tests. */
  trustLogger?: TrustLogger;
  /** Reference time for DashboardSnapshot.generatedAt. Defaults to now; injectable for tests. */
  now?: Date;
}

export type BuildDashboardSnapshotResult =
  | { outcome: "success"; snapshot: DashboardSnapshot; attempts: number; transactionId: string }
  | {
      outcome: "failure";
      errorClass: DashboardErrorClass;
      errorMessage: string;
      attempts: number;
      transactionId: string;
    };

/**
 * STORY-007's dashboard data layer (scoped as backend-only for this walking
 * skeleton — no frontend or HTTP route exists in this repo yet, see
 * PROGRESS.md for the scope decision). "Display activity" in this scope
 * means computing a snapshot: every call here — success, or exhausted
 * retries — is trust-logged exactly once, satisfying the Trust acceptance
 * criterion. Incomplete data (an empty entry list, or an entry whose
 * forecast isn't a valid tier) is never rejected outright — it's flagged
 * in `dataUncertainties` and still passed to the briefing prompt, whose own
 * fail-safe rules (see draft-leadership-briefing/v1.0.0.md) turn it into a
 * visible "Critical" status with an explanatory headline rather than a
 * false-calm default or a blank result.
 */
export async function buildDashboardSnapshot(
  entries: IcbDashboardEntry[],
  options: BuildDashboardSnapshotOptions,
): Promise<BuildDashboardSnapshotResult> {
  const trustLogger = options.trustLogger ?? new FileTrustLogger(DEFAULT_TRUST_LOG_PATH);

  const dataUncertainties: string[] = [];
  if (entries.length === 0) {
    dataUncertainties.push("no_icb_data");
  }
  for (const entry of entries) {
    if (!VALID_PRESSURE_TIERS.includes(entry.forecastedPressureLevel)) {
      dataUncertainties.push(`malformed_forecast:${entry.icbName}`);
    }
  }

  let client: DashboardClient;
  try {
    client = options.client ?? new AnthropicDashboardClient();
  } catch (error) {
    const dashboardError = toDashboardError(error);
    const { transactionId } = await trustLogger.record({
      idempotencyKey: options.idempotencyKey,
      processType: "prediction",
      processName: "buildDashboardSnapshot",
      outcome: "failure",
      errorClass: dashboardError.errorClass,
      context: { metricCount: entries.length, dataUncertainties, errorMessage: dashboardError.message },
    });
    return {
      outcome: "failure",
      errorClass: dashboardError.errorClass,
      errorMessage: dashboardError.message,
      attempts: 0,
      transactionId,
    };
  }

  const logger = options.logger ?? consoleDashboardLogger;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const backoffBaseMs = options.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const prompt = renderDraftLeadershipBriefingPrompt(entries);

  let lastErrorClass: DashboardErrorClass = "UpstreamUnavailable";
  let lastErrorMessage = "draft-leadership-briefing never attempted (maxAttempts <= 0).";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const startedAt = Date.now();

    // Narrowly scoped to just the model call and response validation, so a
    // trust-log write failure below can never be caught here and
    // misclassified as a retryable model error — the bug STORY-011 and
    // STORY-012 both hit and fixed the same way.
    let briefing: DraftLeadershipBriefingOutput;
    try {
      const rawText = await client.predict(prompt, { timeoutMs });
      const parsed = extractFirstJsonObject(rawText);
      const validated = parsed === null ? undefined : DraftLeadershipBriefingOutputSchema.safeParse(parsed);

      if (!validated || !validated.success) {
        throw new DashboardError(
          "ValidationError",
          `Model reply did not contain a valid draft-leadership-briefing JSON object: ${rawText.slice(0, 200)}`,
        );
      }
      briefing = validated.data;
    } catch (error) {
      const dashboardError = toDashboardError(error);
      lastErrorClass = dashboardError.errorClass;
      lastErrorMessage = dashboardError.message;

      logger({
        timestamp: new Date().toISOString(),
        event: "dashboard_snapshot_attempt",
        attempt,
        maxAttempts,
        durationMs: Date.now() - startedAt,
        outcome: "failure",
        errorClass: dashboardError.errorClass,
        errorMessage: dashboardError.message,
      });

      const isRetryable = RETRYABLE_ERROR_CLASSES.includes(dashboardError.errorClass);
      const attemptsRemain = attempt < maxAttempts;
      if (!isRetryable || !attemptsRemain) {
        const { transactionId } = await trustLogger.record({
          idempotencyKey: options.idempotencyKey,
          processType: "prediction",
          processName: "buildDashboardSnapshot",
          outcome: "failure",
          errorClass: dashboardError.errorClass,
          context: { metricCount: entries.length, dataUncertainties, attempts: attempt, errorMessage: dashboardError.message },
        });
        return {
          outcome: "failure",
          errorClass: dashboardError.errorClass,
          errorMessage: dashboardError.message,
          attempts: attempt,
          transactionId,
        };
      }

      await sleep(backoffBaseMs * 2 ** (attempt - 1));
      continue;
    }

    // Only reached when the try block above succeeded — briefing is assigned.
    logger({
      timestamp: new Date().toISOString(),
      event: "dashboard_snapshot_attempt",
      attempt,
      maxAttempts,
      durationMs: Date.now() - startedAt,
      outcome: "success",
    });

    const snapshot: DashboardSnapshot = {
      metrics: entries,
      briefing,
      dataUncertainties,
      generatedAt: (options.now ?? new Date()).toISOString(),
    };

    const { transactionId } = await trustLogger.record({
      idempotencyKey: options.idempotencyKey,
      processType: "prediction",
      processName: "buildDashboardSnapshot",
      outcome: "success",
      context: {
        metricCount: entries.length,
        dataUncertainties,
        overallStatus: briefing.overall_status,
        promptVersion: PROMPT_VERSION,
      },
    });

    return { outcome: "success", snapshot, attempts: attempt, transactionId };
  }

  const { transactionId } = await trustLogger.record({
    idempotencyKey: options.idempotencyKey,
    processType: "prediction",
    processName: "buildDashboardSnapshot",
    outcome: "failure",
    errorClass: lastErrorClass,
    context: { metricCount: entries.length, dataUncertainties, attempts: 0, errorMessage: lastErrorMessage },
  });
  return { outcome: "failure", errorClass: lastErrorClass, errorMessage: lastErrorMessage, attempts: 0, transactionId };
}

function toDashboardError(error: unknown): DashboardError {
  if (error instanceof DashboardError) return error;
  return new DashboardError("UpstreamUnavailable", error instanceof Error ? error.message : String(error), {
    cause: error,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
