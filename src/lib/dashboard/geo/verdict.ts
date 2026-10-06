import { volumeVerdict } from "@/lib/dashboard/confidence";
import type { GeoPerformanceRow } from "@/lib/dashboard/geo/contract";
import {
  NEAR_MISS_TOLERANCE,
  type PerformanceTargets,
} from "@/lib/dashboard/targets";

/**
 * A place is judged against the reader's own cost-per-order target, not against
 * the other places. Ranking alone always manufactures a "worst" region even
 * when every region is fine, which is exactly the wrong thing to act on.
 *
 * - `wasted`      spent more than one order should cost and returned none
 * - `breach`      orders arrive, but each one costs more than the target
 * - `near`        inside the target, but within the near-miss band of it
 * - `pass`        comfortably inside the target
 * - `insufficient` too few orders to judge the cost per order at all
 */
export type GeoVerdict =
  | "pass"
  | "near"
  | "breach"
  | "wasted"
  | "insufficient";

export interface GeoRowVerdict {
  verdict: GeoVerdict;
  /** Cost per order over target, as a fraction. Null when not comparable. */
  overTargetRatio: number | null;
  /** Spend that has produced no order yet. */
  spendAtRisk: number;
  safeMessage: string;
}

export interface GeoAttentionSummary {
  /** Regions burning budget without a single order, worst first. */
  wasted: { row: GeoPerformanceRow; verdict: GeoRowVerdict }[];
  /** Regions that do convert, but above the cost target, worst first. */
  overTarget: { row: GeoPerformanceRow; verdict: GeoRowVerdict }[];
  /** Regions comfortably inside the target, cheapest first. */
  strongest: { row: GeoPerformanceRow; verdict: GeoRowVerdict }[];
  /** Total spend sitting behind `wasted` plus the overspend on `overTarget`. */
  spendAtRisk: number;
  safeMessage: string;
}

function money(currency: string, value: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export function evaluateGeoRow(
  row: GeoPerformanceRow,
  targets: PerformanceTargets,
  currency: string,
): GeoRowVerdict {
  const target = targets.costPerOrder;

  if (row.spend <= 0) {
    return {
      verdict: "insufficient",
      overTargetRatio: null,
      spendAtRisk: 0,
      safeMessage: "No spend here in this period.",
    };
  }

  // The target itself sets the floor: once a region has spent what one order
  // is supposed to cost and produced nothing, that is a real signal rather
  // than an arbitrary threshold.
  if (row.purchases === 0) {
    return row.spend >= target
      ? {
          verdict: "wasted",
          overTargetRatio: null,
          spendAtRisk: row.spend,
          safeMessage: `${money(currency, row.spend)} spent and no order yet, which is already more than one order is meant to cost.`,
        }
      : {
          verdict: "insufficient",
          overTargetRatio: null,
          spendAtRisk: row.spend,
          safeMessage: `Only ${money(currency, row.spend)} spent so far, below the cost of a single order, so no order was expected yet.`,
        };
  }

  const costPerPurchase = row.costPerPurchase;
  if (costPerPurchase === null) {
    return {
      verdict: "insufficient",
      overTargetRatio: null,
      spendAtRisk: 0,
      safeMessage: "Cost per order cannot be read for this region.",
    };
  }

  const overTargetRatio = costPerPurchase / target - 1;
  const confidence = volumeVerdict(row.purchases).confidence;

  if (confidence === "insufficient") {
    return {
      verdict: "insufficient",
      overTargetRatio,
      spendAtRisk: 0,
      safeMessage: `${row.purchases} order${row.purchases === 1 ? "" : "s"} is too few to judge cost per order; widen the period before acting.`,
    };
  }

  if (overTargetRatio > 0) {
    return {
      verdict: "breach",
      overTargetRatio,
      // Only the part above target is at risk, not the whole spend.
      spendAtRisk:
        row.spend - row.purchases * target > 0
          ? row.spend - row.purchases * target
          : 0,
      safeMessage: `Each order costs ${money(currency, costPerPurchase)} against a ${money(currency, target)} target, ${Math.round(overTargetRatio * 100)}% over.`,
    };
  }

  if (overTargetRatio > -NEAR_MISS_TOLERANCE) {
    return {
      verdict: "near",
      overTargetRatio,
      spendAtRisk: 0,
      safeMessage: `Cost per order is ${money(currency, costPerPurchase)}, just inside the ${money(currency, target)} target.`,
    };
  }

  return {
    verdict: "pass",
    overTargetRatio,
    spendAtRisk: 0,
    safeMessage: `Cost per order is ${money(currency, costPerPurchase)}, comfortably inside the ${money(currency, target)} target.`,
  };
}

export function summariseGeoAttention(
  rows: readonly GeoPerformanceRow[],
  targets: PerformanceTargets,
  currency: string,
): GeoAttentionSummary {
  const judged = rows.map((row) => ({
    row,
    verdict: evaluateGeoRow(row, targets, currency),
  }));

  const wasted = judged
    .filter((item) => item.verdict.verdict === "wasted")
    .toSorted((left, right) => right.row.spend - left.row.spend);

  const overTarget = judged
    .filter((item) => item.verdict.verdict === "breach")
    .toSorted(
      (left, right) =>
        (right.verdict.overTargetRatio ?? 0) -
        (left.verdict.overTargetRatio ?? 0),
    );

  const strongest = judged
    .filter((item) => item.verdict.verdict === "pass")
    .toSorted(
      (left, right) =>
        (left.row.costPerPurchase ?? Infinity) -
        (right.row.costPerPurchase ?? Infinity),
    );

  const spendAtRisk =
    Math.round(
      [...wasted, ...overTarget].reduce(
        (total, item) => total + item.verdict.spendAtRisk,
        0,
      ) * 100,
    ) / 100;

  const safeMessage =
    wasted.length === 0 && overTarget.length === 0
      ? strongest.length === 0
        ? "No region has enough orders yet to be judged against the cost target."
        : "Every region with enough orders is inside the cost-per-order target."
      : `${money(currency, spendAtRisk)} is going to places that are either not converting or converting above target.`;

  return { wasted, overTarget, strongest, spendAtRisk, safeMessage };
}
