import {
  describePlanBudget,
  type BudgetPacingReport,
} from "@/lib/dashboard/budget";
import type { ImpressionShareReport } from "@/lib/dashboard/impression-share";
import { getPercentChange } from "@/lib/dashboard/kpi";
import { isSectionVisible } from "@/lib/dashboard/sections";
import type {
  AcquisitionGuardrailReport,
  Currency,
  DataQualityReport,
  MetricCardData,
  Platform,
} from "@/lib/dashboard/types";
import { WORKLOG_EXPECTED_METRICS } from "@/lib/dashboard/worklog";

/**
 * Who wrote the brief. `rule-based` is what this build produces: fixed
 * thresholds over numbers already on the page, so it can be checked by hand.
 * `agent` is reserved for a model-written brief and is never assumed here.
 */
export type AdvisorySource = "rule-based" | "agent";

export type AdvisoryStatus = "draft" | "needs-review" | "approved";

export type AdvisorySeverity = "good" | "watch" | "act";

export interface AdvisoryObservation {
  id: string;
  severity: AdvisorySeverity;
  headline: string;
  detail: string;
  /** Which section of the dashboard a reader can check this against. */
  evidence: string;
}

export interface AdvisoryAction {
  id: string;
  action: string;
  because: string;
  /** Same vocabulary as the worklog, so an action can become a logged entry. */
  expectedMetric: (typeof WORKLOG_EXPECTED_METRICS)[number];
  expectedDirection: "up" | "down";
  effort: "quick" | "standard" | "project";
}

export interface AdvisoryBrief {
  source: AdvisorySource;
  status: AdvisoryStatus;
  /** Null until a model has actually produced the brief. */
  generatedAt: string | null;
  model: string | null;
  observations: AdvisoryObservation[];
  actions: AdvisoryAction[];
  /** Stated in the UI so a rule-based brief is never read as model output. */
  provenanceNote: string;
}

const RULE_PROVENANCE =
  "Written by fixed rules over the numbers on this page, not by a model. Every line can be checked against the section it names.";

export interface AdvisoryInput {
  cards: readonly MetricCardData[];
  guardrail: AcquisitionGuardrailReport;
  pacing: BudgetPacingReport;
  impressionShare: ImpressionShareReport | null;
  quality: DataQualityReport;
  currency: Currency;
  /** The filter in force, so the brief never cites a hidden section. */
  platform: Platform;
}

function money(currency: Currency, value: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function platformName(platform: "meta" | "google"): string {
  return platform === "meta" ? "Meta" : "Google";
}

/** The card that moved worst against its own favourable direction. */
function biggestDrag(cards: readonly MetricCardData[]): {
  card: MetricCardData;
  changePercent: number;
} | null {
  return (
    cards
      .filter((card) => card.favorableDirection !== "neutral")
      .map((card) => {
        const change = getPercentChange(card.value, card.previousValue);
        return typeof change === "number" && Number.isFinite(change)
          ? { card, changePercent: change }
          : null;
      })
      .filter(
        (item): item is { card: MetricCardData; changePercent: number } =>
          item !== null,
      )
      .filter((item) =>
        item.card.favorableDirection === "higher"
          ? item.changePercent < 0
          : item.changePercent > 0,
      )
      .toSorted(
        (left, right) =>
          Math.abs(right.changePercent) - Math.abs(left.changePercent),
      )
      .at(0) ?? null
  );
}

/**
 * A deterministic first draft of the insight and recommendation panels. It
 * exists so the panel is useful before any model is connected, and so a future
 * agent has a worked example of the shape it must return.
 */
export function buildRuleBasedAdvisory(input: AdvisoryInput): AdvisoryBrief {
  const observations: AdvisoryObservation[] = [];
  const actions: AdvisoryAction[] = [];
  const { currency } = input;

  if (input.quality.status === "blocked") {
    observations.push({
      id: "data-blocked",
      severity: "act",
      headline: "The period is not complete enough to read.",
      detail: `Coverage is ${input.quality.coveragePercent}% with ${input.quality.missingDates.length} day(s) missing, so every rate below is drawn from a partial period.`,
      evidence: "Data health",
    });
  }

  for (const check of input.guardrail.checks) {
    if (check.status !== "breach" && check.status !== "near") continue;
    const isCost = check.unit === "currency";
    const valueText =
      check.value === null
        ? "no value"
        : isCost
          ? money(currency, check.value)
          : `${(check.value * 100).toFixed(1)}%`;
    const targetText = isCost
      ? money(currency, check.target)
      : `${(check.target * 100).toFixed(1)}%`;

    observations.push({
      id: `guardrail-${check.metric}`,
      severity: check.status === "breach" ? "act" : "watch",
      headline: `${check.shortLabel} is ${valueText} against a target of ${targetText}.`,
      detail: check.safeMessage,
      evidence: "Account snapshot",
    });
  }

  // Only a stored agreement is called "agreed"; drafts and placeholders say so.
  const planWord = describePlanBudget(input.pacing.planSource);

  for (const row of input.pacing.platforms) {
    if (row.status === "overspending") {
      observations.push({
        id: `pacing-${row.platform}`,
        // Ahead of pace is a watch while spend is still inside the budget. Red
        // is kept for the budget actually being reached or exceeded.
        severity: row.actualProgress >= 1 ? "act" : "watch",
        headline: `${platformName(row.platform)} has spent ${money(currency, row.spentToDate)} of its ${planWord} ${money(currency, row.monthlyBudget)} cycle budget with ${row.daysRemaining} days left.`,
        detail: row.safeMessage,
        evidence: "Budget pacing",
      });
      actions.push({
        id: `pacing-${row.platform}-action`,
        action:
          row.recommendedDailySpend === null || row.recommendedDailySpend === 0
            ? `Pause ${platformName(row.platform)} spend for the rest of this cycle, or agree a higher budget.`
            : `Hold ${platformName(row.platform)} at ${money(currency, row.recommendedDailySpend)} a day for the remaining ${row.daysRemaining} days.`,
        because: `Current pace projects ${money(currency, row.projectedCycleEnd ?? 0)} by the cycle's last day against a ${planWord} ${money(currency, row.monthlyBudget)} budget.`,
        expectedMetric: "spend",
        expectedDirection: "down",
        effort: "quick",
      });
    }

    if (row.status === "underspending") {
      observations.push({
        id: `pacing-${row.platform}`,
        severity: "watch",
        headline: `${platformName(row.platform)} is behind plan at ${money(currency, row.spentToDate)} of its ${planWord} ${money(currency, row.monthlyBudget)} cycle budget.`,
        detail: row.safeMessage,
        evidence: "Budget pacing",
      });
      actions.push({
        id: `pacing-${row.platform}-action`,
        action:
          row.recommendedDailySpend === null
            ? `Review why ${platformName(row.platform)} cannot spend its budget.`
            : `Lift ${platformName(row.platform)} to ${money(currency, row.recommendedDailySpend)} a day to use the ${planWord} budget.`,
        because:
          "Budget left unspent cannot be recovered once the month closes.",
        expectedMetric: "spend",
        expectedDirection: "up",
        effort: "quick",
      });
    }
  }

  // Only cite impression share when its section is actually on the page for
  // this filter; a brief that points at a section the reader cannot open is
  // worse than one that stays quiet.
  const overall = isSectionVisible("impression-share", input.platform)
    ? (input.impressionShare?.tiers.find((tier) => tier.key === "overall") ??
      null)
    : null;
  const lostToBudget = overall?.averageLostToBudget ?? null;
  if (lostToBudget !== null && lostToBudget > 0.2) {
    observations.push({
      id: "is-lost-budget",
      severity: "watch",
      headline: `Google loses ${Math.round(lostToBudget * 100)}% of impression share to budget.`,
      detail:
        "Auctions were entered and then dropped for budget reasons, so demand exists above the current cap.",
      evidence: "Impression share",
    });
    actions.push({
      id: "is-lost-budget-action",
      action:
        "Move budget to the Google campaigns losing the most share to budget, before widening targeting.",
      because:
        "Share lost to budget is demand already qualified by the auction; new targeting is not.",
      expectedMetric: "impressions",
      expectedDirection: "up",
      effort: "standard",
    });
  }

  const drag = biggestDrag(input.cards);
  if (drag) {
    observations.push({
      id: "journey-drag",
      severity: "watch",
      headline: `${drag.card.label} moved ${drag.changePercent > 0 ? "+" : ""}${drag.changePercent.toFixed(1)}% against the comparison period.`,
      detail:
        drag.card.confidenceMessage ??
        "This is the largest unfavourable move in the journey for this period.",
      evidence: "Customer journey metrics",
    });
  }

  const thin = input.cards.filter((card) => card.confidence === "insufficient");
  if (thin.length > 0) {
    observations.push({
      id: "volume-floor",
      severity: "watch",
      headline: `${thin.length} metric(s) sit below the volume floor.`,
      detail:
        "Fewer than 10 conversions behind a rate means the swing is noise, not a result. Widen the period before acting on those cards.",
      evidence: "Customer journey metrics",
    });
  }

  if (observations.length === 0) {
    observations.push({
      id: "all-clear",
      severity: "good",
      headline: "Nothing crossed a threshold this period.",
      detail:
        "Targets are met, pacing is inside tolerance, and no metric fell below the volume floor.",
      evidence: "Account snapshot",
    });
  }

  return {
    source: "rule-based",
    status: "draft",
    generatedAt: null,
    model: null,
    observations,
    actions,
    provenanceNote: RULE_PROVENANCE,
  };
}
