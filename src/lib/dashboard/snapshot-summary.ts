import { getPercentChange } from "@/lib/dashboard/kpi";
import type {
  AcquisitionGuardrailReport,
  DataQualityReport,
  MetricCardData,
} from "@/lib/dashboard/types";

export type SnapshotTone = "positive" | "watch" | "negative" | "neutral";

export interface SnapshotMover {
  key: string;
  label: string;
  changePercent: number;
  isFavorable: boolean;
}

export interface PerformanceSnapshot {
  tone: SnapshotTone;
  headline: string;
  supporting: string;
  guardrailLine: string;
  dataLine: string;
  biggestImprovement: SnapshotMover | null;
  biggestDrag: SnapshotMover | null;
}

function moverFor(card: MetricCardData): SnapshotMover | null {
  if (card.favorableDirection === "neutral") return null;

  const change = getPercentChange(card.value, card.previousValue);
  if (typeof change !== "number" || !Number.isFinite(change) || change === 0) {
    return null;
  }

  return {
    key: card.key,
    label: card.label,
    changePercent: Math.round(change * 10) / 10,
    isFavorable:
      card.favorableDirection === "higher" ? change > 0 : change < 0,
  };
}

function strongest(
  movers: readonly SnapshotMover[],
  favorable: boolean,
): SnapshotMover | null {
  return (
    movers
      .filter((mover) => mover.isFavorable === favorable)
      .toSorted(
        (left, right) =>
          Math.abs(right.changePercent) - Math.abs(left.changePercent),
      )
      .at(0) ?? null
  );
}

function describe(mover: SnapshotMover | null): string {
  if (!mover) return "no clear mover";
  const direction = mover.changePercent >= 0 ? "+" : "";
  return `${mover.label} ${direction}${mover.changePercent.toFixed(1)}%`;
}

/**
 * One glance verdict for the account: what moved, whether acquisition cost is
 * still inside the guardrail, and whether the data behind it can be trusted.
 */
export function buildPerformanceSnapshot(
  cards: readonly MetricCardData[],
  guardrail: AcquisitionGuardrailReport,
  quality: DataQualityReport,
): PerformanceSnapshot {
  const movers = cards
    .map(moverFor)
    .filter((mover): mover is SnapshotMover => mover !== null);
  const biggestImprovement = strongest(movers, true);
  const biggestDrag = strongest(movers, false);

  const revenue = cards.find((card) => card.key === "actualPurchaseRevenue");
  const purchases = cards.find((card) => card.key === "purchases");
  const revenueChange = getPercentChange(
    revenue?.value ?? null,
    revenue?.previousValue ?? null,
  );
  const purchaseChange = getPercentChange(
    purchases?.value ?? null,
    purchases?.previousValue ?? null,
  );

  const hasData = quality.status !== "blocked";
  const revenueUp = typeof revenueChange === "number" && revenueChange > 0;
  const purchasesUp = typeof purchaseChange === "number" && purchaseChange > 0;
  const missed = guardrail.checks.filter((check) => check.status === "breach");
  const near = guardrail.checks.filter((check) => check.status === "near");

  const tone: SnapshotTone = !hasData
    ? "neutral"
    : guardrail.status === "breach"
      ? "negative"
      : guardrail.status === "near"
        ? "watch"
        : revenueUp && purchasesUp
          ? "positive"
          : "watch";

  const headline = !hasData
    ? "Not enough stored data to judge this account."
    : missed.length > 0
      ? `Target missed on ${missed.map((check) => check.shortLabel).join(" and ")}.`
      : near.length > 0
        ? `Nearly there on ${near.map((check) => check.shortLabel).join(" and ")}.`
        : revenueUp && purchasesUp
          ? "Every target met, with revenue and purchases both growing."
          : revenueUp
            ? "Targets met, but purchase volume did not follow revenue."
            : purchasesUp
              ? "Targets met, but revenue lagged behind purchase volume."
              : "Targets met while revenue and purchases sat below the comparison period.";

  const supporting = hasData
    ? `Best move: ${describe(biggestImprovement)}. Biggest drag: ${describe(biggestDrag)}.`
    : "Run a refresh so the scorecard has a period to compare against.";

  return {
    tone,
    headline,
    supporting,
    guardrailLine: guardrail.safeMessage,
    dataLine:
      quality.status === "ready"
        ? `Data is complete: ${quality.coveragePercent}% coverage across ${quality.expectedDays} days.`
        : `Data status ${quality.status}: ${quality.coveragePercent}% coverage, ${quality.missingDates.length} day(s) missing.`,
    biggestImprovement,
    biggestDrag,
  };
}
