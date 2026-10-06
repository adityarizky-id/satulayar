import type { DashboardSnapshot, Platform } from "@/lib/dashboard/types";

/**
 * Deterministic early-warning checks over a scored snapshot.
 *
 * No AI, no thresholds tuned per run: the same snapshot always produces the
 * same report, so an alert can be reasoned about and argued with. The engine
 * is deliberately quiet by default — a false alarm on an incomplete period
 * trains the reader to ignore the panel, which is worse than no panel.
 */

export type AnomalyCode =
  | "cost-per-order-spike"
  | "cost-per-registration-spike"
  | "spend-collapse"
  | "attribution-gap";

export type AnomalySeverity = "watch" | "critical";

export interface Anomaly {
  code: AnomalyCode;
  severity: AnomalySeverity;
  platform: Platform;
  /** What moved, by how much, in plain words. Never a causal claim. */
  message: string;
  /** Signed percentage change where the check is a comparison. */
  changePercent: number | null;
  /** What the reader should check next. Never an instruction to change spend. */
  suggestedCheck: string;
}

export interface AnomalyReport {
  anomalies: Anomaly[];
  /** True when checks were withheld rather than passed. */
  suppressed: boolean;
  /** Why they were withheld, in the reader's language. */
  suppressionReasons: string[];
  /** Thresholds in force, so the panel can state them. */
  thresholds: {
    costPerOrderIncreasePercent: number;
    costPerRegistrationIncreasePercent: number;
    spendDropPercent: number;
    attributionGapPercent: number;
  };
}

/** A cost per acquisition this much higher than the comparison is flagged. */
export const COST_SPIKE_THRESHOLD_PERCENT = 25;
/** A spend drop this deep usually means a broken campaign, not a decision. */
export const SPEND_DROP_THRESHOLD_PERCENT = -30;
/** Platform-claimed orders may exceed real store orders by at most this much. */
export const ATTRIBUTION_GAP_THRESHOLD_PERCENT = 25;
/** Below this many conversions a percentage swing is noise, not a signal. */
export const MINIMUM_CONVERSIONS_FOR_COST_CHECK = 5;

function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

/**
 * Evaluates a snapshot.
 *
 * Fail-closed conditions come first, and they suppress every check rather than
 * some: a blocked gate, an open day inside the range, or comparison switched
 * off all mean the two sides of a comparison are not like for like. Reporting
 * "CPA up 40%" from a half-collected day is how an alerting panel loses the
 * reader's trust permanently.
 */
export function evaluatePerformanceAnomalies(
  snapshot: DashboardSnapshot,
): AnomalyReport {
  const thresholds = {
    costPerOrderIncreasePercent: COST_SPIKE_THRESHOLD_PERCENT,
    costPerRegistrationIncreasePercent: COST_SPIKE_THRESHOLD_PERCENT,
    spendDropPercent: SPEND_DROP_THRESHOLD_PERCENT,
    attributionGapPercent: ATTRIBUTION_GAP_THRESHOLD_PERCENT,
  };

  const suppressionReasons: string[] = [];

  if (snapshot.dataStatus === "blocked") {
    suppressionReasons.push(
      "The data-quality gate is blocking this period, so no movement here can be trusted as real.",
    );
  }
  if (snapshot.quality.provisionalDates.length > 0) {
    suppressionReasons.push(
      `${snapshot.quality.provisionalDates.length} day(s) in this period are still open on the platform, so today's figures are not comparable with a closed period.`,
    );
  }
  if (!snapshot.comparisonEnabled) {
    suppressionReasons.push(
      "Comparison is switched off, so there is no baseline to measure a change against.",
    );
  }

  if (suppressionReasons.length > 0) {
    return {
      anomalies: [],
      suppressed: true,
      suppressionReasons,
      thresholds,
    };
  }

  const anomalies: Anomaly[] = [];
  const platform = snapshot.selectedPlatform;
  const totals = snapshot.totals;
  const comparison = snapshot.comparisonTotals;

  // Cost per order. Guarded by volume: with two orders against three, a 50%
  // swing is arithmetic, not performance.
  const orderVolume = Math.min(totals.purchases, comparison.purchases);
  const costPerOrderChange = percentChange(
    totals.costPerPurchase ?? Number.NaN,
    comparison.costPerPurchase ?? Number.NaN,
  );
  if (
    costPerOrderChange !== null &&
    orderVolume >= MINIMUM_CONVERSIONS_FOR_COST_CHECK &&
    costPerOrderChange > COST_SPIKE_THRESHOLD_PERCENT
  ) {
    anomalies.push({
      code: "cost-per-order-spike",
      severity: costPerOrderChange > COST_SPIKE_THRESHOLD_PERCENT * 2 ? "critical" : "watch",
      platform,
      message: `Cost per order is ${costPerOrderChange.toFixed(1)}% higher than the comparison period.`,
      changePercent: costPerOrderChange,
      suggestedCheck:
        "Compare spend and order volume per campaign before concluding the auction moved; a single paused winner produces the same shape.",
    });
  }

  const registrationVolume = Math.min(
    totals.registrations,
    comparison.registrations,
  );
  const costPerRegistrationChange = percentChange(
    totals.costPerRegistration ?? Number.NaN,
    comparison.costPerRegistration ?? Number.NaN,
  );
  if (
    costPerRegistrationChange !== null &&
    registrationVolume >= MINIMUM_CONVERSIONS_FOR_COST_CHECK &&
    costPerRegistrationChange > COST_SPIKE_THRESHOLD_PERCENT
  ) {
    anomalies.push({
      code: "cost-per-registration-spike",
      severity:
        costPerRegistrationChange > COST_SPIKE_THRESHOLD_PERCENT * 2 ? "critical" : "watch",
      platform,
      message: `Cost per registration is ${costPerRegistrationChange.toFixed(1)}% higher than the comparison period.`,
      changePercent: costPerRegistrationChange,
      suggestedCheck:
        "Check whether the registration conversion action is still firing before treating this as a bidding problem.",
    });
  }

  // A deep spend drop is usually a disapproved ad, an exhausted budget, or a
  // billing failure — all of which look identical in the totals.
  const spendChange = percentChange(totals.spend, comparison.spend);
  if (spendChange !== null && spendChange < SPEND_DROP_THRESHOLD_PERCENT) {
    anomalies.push({
      code: "spend-collapse",
      severity: spendChange < SPEND_DROP_THRESHOLD_PERCENT * 1.5 ? "critical" : "watch",
      platform,
      message: `Spend is ${Math.abs(spendChange).toFixed(1)}% below the comparison period.`,
      changePercent: spendChange,
      suggestedCheck:
        "Check for disapproved ads, an exhausted daily budget, a paused campaign, or a failed payment method.",
    });
  }

  // Platform-claimed orders against orders the store actually dispatched.
  // Null in live mode, where the store side of the comparison is not read from
  // store data yet: an attribution gap measured against a modelled order count would
  // be an anomaly about the model, not about the account.
  const mer = snapshot.blendedMer;
  const attributionGap = mer
    ? percentChange(mer.claimedPlatformOrders, mer.realStoreOrders)
    : null;
  if (
    mer &&
    attributionGap !== null &&
    mer.realStoreOrders >= MINIMUM_CONVERSIONS_FOR_COST_CHECK &&
    attributionGap > ATTRIBUTION_GAP_THRESHOLD_PERCENT
  ) {
    anomalies.push({
      code: "attribution-gap",
      severity: attributionGap > ATTRIBUTION_GAP_THRESHOLD_PERCENT * 2 ? "critical" : "watch",
      platform,
      message: `The platforms claim ${attributionGap.toFixed(1)}% more orders than the store recorded as dispatched.`,
      changePercent: attributionGap,
      suggestedCheck:
        "Expected overlap between two platforms claiming the same order explains part of this. Reconcile against dispatched store orders before trusting platform ROAS.",
    });
  }

  return {
    anomalies,
    suppressed: false,
    suppressionReasons: [],
    thresholds,
  };
}
