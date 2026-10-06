/**
 * Volume floors for reading a rate or a cost-per metric.
 *
 * The relative error of a count follows roughly 1/sqrt(n): 30 conversions
 * carry about ±18% error, 12 carry ±29%. A period change smaller than that
 * band is indistinguishable from noise, so the dashboard says so instead of
 * printing a percentage that cannot be acted on.
 */
export const RELIABLE_CONVERSION_FLOOR = 30;
export const MINIMUM_CONVERSION_FLOOR = 10;

export type VolumeConfidence = "reliable" | "low-volume" | "insufficient";

export interface VolumeVerdict {
  confidence: VolumeConfidence;
  count: number;
  /** Approximate relative error of the count, as a fraction. */
  relativeError: number | null;
  showDelta: boolean;
  safeMessage: string;
}

export function volumeVerdict(
  count: number,
  /**
   * Length of the period the count was taken over, in days.
   *
   * Supplied so the insufficient verdict can answer "widen to what?" instead
   * of "widen the timeframe". Told only to widen, a reader has no way to know
   * whether the answer is three more days or three more months, and on a
   * low-volume brand it is often the latter — which is itself the finding.
   */
  periodDays?: number,
): VolumeVerdict {
  const relativeError = count > 0 ? 1 / Math.sqrt(count) : null;

  if (count >= RELIABLE_CONVERSION_FLOOR) {
    return {
      confidence: "reliable",
      count,
      relativeError,
      showDelta: true,
      safeMessage: `${count} conversions in the period: the movement can be read.`,
    };
  }

  if (count >= MINIMUM_CONVERSION_FLOOR) {
    return {
      confidence: "low-volume",
      count,
      relativeError,
      showDelta: true,
      safeMessage: `Only ${count} conversions: the period change carries about ±${Math.round(
        (relativeError ?? 0) * 100,
      )}% error, so treat it as directional.`,
    };
  }

  // "Widen the timeframe" on its own is a dead end. When the period length is
  // known the same order rate gives the answer, so the reader is told how far
  // to widen — or that no reachable window will get there.
  const daysNeeded =
    periodDays === undefined
      ? null
      : daysNeededForReliableRead(count, periodDays);

  return {
    confidence: "insufficient",
    count,
    relativeError,
    showDelta: false,
    safeMessage:
      count === 0
        ? "No conversions in this period, so there is nothing to compare."
        : daysNeeded === null
          ? `Only ${count} conversions: too few to compare periods. Widen the timeframe.`
          : daysNeeded > 365
            ? `Only ${count} conversions in ${periodDays} days. At this rate a readable comparison needs about ${daysNeeded} days, which is longer than a year: compare on spend and cost per order instead of period-over-period rates.`
            : `Only ${count} conversions: too few to compare periods. At this rate you need about ${daysNeeded} days, so widen to roughly ${daysNeeded} days.`,
  };
}

export interface AttributionCoverage {
  platformConversions: number;
  storeOrders: number;
  /** Platform claims divided by the orders the store actually recorded. */
  coverageRatio: number | null;
  status: "aligned" | "over-claiming" | "under-claiming" | "unknown";
  safeMessage: string;
}

/**
 * The business floor. The store knows how many orders the store really took, so a
 * platform count can be checked against it instead of trusted on its own.
 */
export function attributionCoverage(
  platformConversions: number,
  storeOrders: number,
): AttributionCoverage {
  if (storeOrders <= 0) {
    return {
      platformConversions,
      storeOrders,
      coverageRatio: null,
      status: "unknown",
      safeMessage:
        "No store orders are available for this period, so platform claims cannot be checked.",
    };
  }

  const coverageRatio = platformConversions / storeOrders;
  const status =
    coverageRatio > 1.25
      ? "over-claiming"
      : coverageRatio < 0.6
        ? "under-claiming"
        : "aligned";

  return {
    platformConversions,
    storeOrders,
    coverageRatio,
    status,
    safeMessage:
      status === "over-claiming"
        ? `Platforms claim ${Math.round(coverageRatio * 100)}% of the orders the store recorded. Cost per order is flattered by double counting.`
        : status === "under-claiming"
          ? `Platforms claim only ${Math.round(coverageRatio * 100)}% of store orders. Tracking is losing conversions, so cost per order reads worse than reality.`
          : `Platform claims sit at ${Math.round(coverageRatio * 100)}% of store orders, which is within the expected band.`,
  };
}

/**
 * How many days a period needs before the reliable floor is reachable at the
 * store's current order rate. Answers "widen to what?" instead of just
 * "widen the timeframe".
 */
export function daysNeededForReliableRead(
  storeOrders: number,
  days: number,
): number | null {
  if (storeOrders <= 0 || days <= 0) return null;
  const ordersPerDay = storeOrders / days;
  if (ordersPerDay <= 0) return null;
  return Math.ceil(RELIABLE_CONVERSION_FLOOR / ordersPerDay);
}
