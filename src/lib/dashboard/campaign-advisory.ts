import type {
  AdvisoryAction,
  AdvisoryBrief,
  AdvisoryObservation,
} from "@/lib/dashboard/advisory";
import type {
  CampaignTypeAnalysis,
  CampaignTypeRow,
} from "@/lib/dashboard/campaign-types";
import { volumeVerdict } from "@/lib/dashboard/confidence";
import type { PerformanceTargets } from "@/lib/dashboard/targets";
import type { Currency } from "@/lib/dashboard/types";

const PROVENANCE =
  "Written by fixed rules over the campaign-type table, not by a model. Roles follow each campaign's job in the funnel, and no pause is ever recommended without a historical-role check first.";

function money(currency: Currency, value: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

const EVIDENCE = "Campaign types";

/**
 * Rules for the campaign-type card.
 *
 * Two constraints are hard-coded here because getting
 * them wrong destroys winning campaigns:
 *
 * 1. A demand-creation type is never judged against the order target. Its
 *    contribution is assisted, so cost per order overstates its cost.
 * 2. No recommendation says "pause". A pause first needs a historical-role
 *    check against the prior year first, so the action is to run that check.
 */
export function buildCampaignTypeAdvisory(
  analysis: CampaignTypeAnalysis,
  targets: PerformanceTargets,
): AdvisoryBrief {
  const observations: AdvisoryObservation[] = [];
  const actions: AdvisoryAction[] = [];
  const currency = analysis.currency;
  const target = targets.costPerOrder;

  const direct = analysis.rows.filter((row) => row.judgedOnCostPerOrder);
  const assisted = analysis.rows.filter((row) => !row.judgedOnCostPerOrder);

  const judgeable = direct.filter(
    (row) =>
      row.costPerPurchase !== null &&
      volumeVerdict(row.purchases).confidence !== "insufficient",
  );

  const overTarget = judgeable
    .filter((row) => (row.costPerPurchase ?? 0) > target)
    .toSorted(
      (left, right) => (right.costPerPurchase ?? 0) - (left.costPerPurchase ?? 0),
    );

  for (const row of overTarget.slice(0, 2)) {
    const over = Math.round(((row.costPerPurchase ?? 0) / target - 1) * 100);
    observations.push({
      id: `type-over-${row.key}`,
      severity: over > 40 ? "act" : "watch",
      headline: `${row.label} orders cost ${money(currency, row.costPerPurchase ?? 0)} against a ${money(currency, target)} target.`,
      detail: `${over}% over target on ${money(currency, row.spend)} of spend, at ${row.roleLabel.toLowerCase()} where a direct order is the job.`,
      evidence: EVIDENCE,
    });
    actions.push({
      id: `type-over-${row.key}-action`,
      action: `Open ${row.label} by ad group and check whether the cost sits in every group or in one or two.`,
      because:
        "A type-level average hides the split; the fix is different if one ad group carries the cost.",
      expectedMetric: "costPerPurchase",
      expectedDirection: "down",
      effort: "standard",
    });
  }

  const best = judgeable
    .filter((row) => (row.costPerPurchase ?? Infinity) <= target)
    .toSorted(
      (left, right) =>
        (left.costPerPurchase ?? Infinity) - (right.costPerPurchase ?? Infinity),
    )
    .at(0);

  if (best) {
    observations.push({
      id: `type-best-${best.key}`,
      severity: "good",
      headline: `${best.label} is the cheapest way to an order at ${money(currency, best.costPerPurchase ?? 0)}.`,
      detail: `It takes ${Math.round(best.spendShare * 100)}% of Google spend and returns ${Math.round(best.purchaseShare * 100)}% of the orders.`,
      evidence: EVIDENCE,
    });
  }

  const assistedSpend = assisted.reduce((total, row) => total + row.spend, 0);
  if (assistedSpend > 0) {
    const share =
      analysis.totals.spend === 0
        ? 0
        : Math.round((assistedSpend / analysis.totals.spend) * 100);
    observations.push({
      id: "assisted-roles",
      severity: "watch",
      headline: `${money(currency, assistedSpend)} (${share}% of Google spend) sits in demand creation.`,
      detail: `${assisted.map((row) => row.label).join(", ")} are not held to the order target here: their contribution is assisted, so their cost per order reads worse than it is.`,
      evidence: EVIDENCE,
    });
    actions.push({
      id: "assisted-roles-action",
      action:
        "Before changing any demand-creation budget, run the historical-role check: what did these campaigns contribute in the same window last year?",
      because:
        "Judging upper-funnel campaigns on last-click cost is how restructures cut the campaigns that were feeding later orders.",
      expectedMetric: "revenue",
      expectedDirection: "up",
      effort: "standard",
    });
  }

  const thin = direct.filter(
    (row) =>
      row.spend > target &&
      volumeVerdict(row.purchases).confidence === "insufficient",
  );
  if (thin.length > 0) {
    observations.push({
      id: "thin-types",
      severity: "watch",
      headline: `${thin.map((row) => row.label).join(" and ")} have too few orders to judge.`,
      detail:
        "Below ten orders the cost per order swings on a single conversion. Widen the period before drawing a conclusion.",
      evidence: EVIDENCE,
    });
  }

  if (observations.length === 0) {
    observations.push({
      id: "types-all-clear",
      severity: "good",
      headline: "Every direct-response type is inside the order target.",
      detail:
        "No campaign type is spending above the cost target with enough volume to be sure of it.",
      evidence: EVIDENCE,
    });
  }

  return {
    source: "rule-based",
    status: "draft",
    generatedAt: null,
    model: null,
    observations,
    actions,
    provenanceNote: PROVENANCE,
  };
}

/** Ranks ad groups inside one type so the drill-down opens on what matters. */
export function rankAdGroupConcerns(
  rows: readonly {
    id: string;
    name: string;
    spend: number;
    purchases: number;
    costPerPurchase: number | null;
  }[],
  target: number,
): { worst: string | null; best: string | null } {
  const judgeable = rows.filter(
    (row) =>
      row.costPerPurchase !== null &&
      volumeVerdict(row.purchases).confidence !== "insufficient",
  );

  const sorted = judgeable.toSorted(
    (left, right) => (right.costPerPurchase ?? 0) - (left.costPerPurchase ?? 0),
  );

  return {
    worst:
      sorted.at(0) && (sorted[0].costPerPurchase ?? 0) > target
        ? sorted[0].name
        : null,
    best: sorted.at(-1)?.name ?? null,
  };
}

export function isCampaignTypeRowJudgeable(row: CampaignTypeRow): boolean {
  return (
    row.judgedOnCostPerOrder &&
    row.costPerPurchase !== null &&
    volumeVerdict(row.purchases).confidence !== "insufficient"
  );
}
