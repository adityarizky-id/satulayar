import {
  applyGa4StoreBridge,
  type Ga4DailyRow,
} from "@/lib/store/ga4-contract";
import type { StoreAnalyticsSnapshot } from "@/lib/store/types";

/**
 * Compatibility name retained for the Supabase reader and older callers.
 * The formal row contract now lives in `ga4-contract.ts`.
 */
export type Ga4StoredRow = Ga4DailyRow;

export interface Ga4HydrationSummary {
  /** True when GA4 passed the bridge quality gate and replaced traffic data. */
  hydrated: boolean;
  coveredDays: number;
  expectedDays: number;
  /** Why hydration was skipped, in reader-facing language. */
  reason: string | null;
  /** Provisional data may render, but it may not drive anomaly verdicts. */
  isProvisional: boolean;
  anomalyEvaluation: "enabled" | "suppressed";
}

export interface Ga4HydrationResult {
  snapshot: StoreAnalyticsSnapshot;
  summary: Ga4HydrationSummary;
}

/**
 * Backward-compatible façade over the formal GA4-to-Store bridge.
 *
 * It preserves the old page API while exposing the new quality decision. No
 * caller can accidentally bypass missing-day, provisional-day, duplicate, or
 * row-shape guardrails.
 */
export function applyGa4Hydration(
  snapshot: StoreAnalyticsSnapshot,
  rows: readonly Ga4StoredRow[],
): Ga4HydrationResult {
  const result = applyGa4StoreBridge(snapshot, rows);
  const reason = result.applied
    ? null
    : rows.length === 0
      ? "No GA4 rows are stored for this period yet, so traffic figures remain synthetic."
      : result.quality.missingDays.length > 0
        ? `GA4 covers ${result.quality.coveredDays} of ${result.quality.expectedDays} day(s) in this period. Traffic figures stay synthetic rather than mixing measured and invented days in one total.`
        : result.warnings[0] ??
          "GA4 traffic data did not pass the bridge quality gate.";

  return {
    snapshot: result.snapshot,
    summary: {
      hydrated: result.applied,
      coveredDays: result.quality.coveredDays,
      expectedDays: result.quality.expectedDays,
      reason,
      isProvisional: result.quality.status === "provisional",
      anomalyEvaluation: result.quality.anomalyEvaluation,
    },
  };
}
