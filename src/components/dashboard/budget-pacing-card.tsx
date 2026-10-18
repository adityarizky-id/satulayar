"use client";

import { memo, useState } from "react";

import { ProgressRing } from "@/components/charts/progress-ring";

import { GoogleAdsIcon, MetaAdsIcon } from "@/components/dashboard/icons";
import {
  normaliseBudgets,
  type BudgetPlanSource,
  type MonthlyBudgets,
  type PacingStatus,
  type PlatformPacing,
} from "@/lib/dashboard/budget";
import type { Currency, DashboardSnapshot } from "@/lib/dashboard/types";

export interface BudgetPacingCardProps {
  snapshot: DashboardSnapshot;
  budgets: MonthlyBudgets;
  disabled: boolean;
  onApply: (next: MonthlyBudgets) => void;
}

const currencyFormatters = new Map<Currency, Intl.NumberFormat>();

function currencyFormatterFor(currency: Currency): Intl.NumberFormat {
  const cached = currencyFormatters.get(currency);
  if (cached) return cached;

  const formatter = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  });
  currencyFormatters.set(currency, formatter);
  return formatter;
}

function pacingToneFor(row: PlatformPacing) {
  if (row.status === "no-budget") return "unavailable";
  if (row.remainingBudget < 0) return "overspending";
  if (row.status === "underspending") return "underspending";
  if (row.status === "overspending") return "ahead-of-plan";
  return "on-track";
}

const cycleDayFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

function formatCycleDay(day: string): string {
  return cycleDayFormatter.format(new Date(`${day}T00:00:00Z`));
}

/** "24 Aug – 22 Sep", the way the team says a cycle out loud. */
function formatCycleSpan(start: string, end: string): string {
  return `${formatCycleDay(start)} – ${formatCycleDay(end)}`;
}

const STATUS_CHIP: Record<PacingStatus, string> = {
  "on-track": "pass",
  underspending: "near",
  overspending: "near",
  "no-budget": "unavailable",
};

/**
 * How the monthly figure on the card got there. A plan nobody agreed must not
 * read like an approved budget, so the placeholder says so in plain words rather
 * than appearing as a settled number.
 */
const PLAN_SOURCE_LABEL: Record<BudgetPlanSource, string> = {
  agreed: "agreed for this cycle",
  "carried-forward": "carried from last cycle",
  local: "this browser only",
  unset: "not agreed yet",
};

const PACING_STATUS_LABEL: Record<PacingStatus, string> = {
  "on-track": "on track",
  underspending: "behind pace",
  overspending: "ahead of pace",
  "no-budget": "no budget",
};

const PlatformPacingCard = memo(function PlatformPacingCard({
  row,
  currency,
  cycleDays,
  planSource,
}: {
  row: PlatformPacing;
  currency: Currency;
  cycleDays: number;
  planSource: BudgetPlanSource;
}) {
  const format = currencyFormatterFor(currency);
  const percentOfBudget =
    row.monthlyBudget > 0 ? Math.round(row.actualProgress * 1000) / 10 : null;
  const overspend =
    row.remainingBudget < 0 ? Math.abs(row.remainingBudget) : 0;
  const hasReachedBudget =
    row.monthlyBudget > 0 && row.remainingBudget === 0;

  return (
    <article
      className={`pacing-card pacing-card--${pacingToneFor(row)}${overspend > 0 ? " pacing-card--over-budget" : ""}`}
    >
      <header className="pacing-card__head">
        <span className="pacing-card__name">
          <span
            aria-hidden="true"
            className={`platform-mark platform-mark--${row.platform}`}
          >
            {row.platform === "google" ? (
              <GoogleAdsIcon width={14} height={14} />
            ) : row.platform === "meta" ? (
              <MetaAdsIcon width={14} height={14} />
            ) : null}
          </span>
          {row.platform === "meta" ? "Meta Ads" : "Google Ads"}
        </span>
        <span
          className={`target-chip target-chip--${
            overspend > 0 ? "breach" : STATUS_CHIP[row.status]
          }`}
        >
          {overspend > 0
            ? "over cycle budget"
            : hasReachedBudget
              ? "cycle budget reached"
              : PACING_STATUS_LABEL[row.status]}
        </span>
      </header>

      <div className="pacing-card__body">
        <div
          aria-label={`${row.platform === "meta" ? "Meta" : "Google"} cycle budget used`}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={percentOfBudget === null ? undefined : Math.min(100, Math.max(0, percentOfBudget))}
          aria-valuetext={percentOfBudget === null ? "No budget set" : `${percentOfBudget}% used. ${format.format(row.spentToDate)} of ${format.format(row.monthlyBudget)}; ${PLAN_SOURCE_LABEL[planSource]}. Day ${row.daysElapsed} of ${cycleDays}.${overspend > 0 ? ` ${format.format(overspend)} over budget.` : ""}`}
          className="pacing-card__ring"
          role="progressbar"
        >
          <ProgressRing
            ariaLabel={percentOfBudget === null ? "No budget set" : `${percentOfBudget}% of cycle budget`}
            centreLabel="of cycle"
            centreValue={percentOfBudget === null ? "N/A" : `${percentOfBudget}%`}
            progress={percentOfBudget === null ? 0 : row.actualProgress}
            showProgressMarker={false}
            tone={pacingToneFor(row)}
          />
          {overspend > 0 && <span className="pacing-card__overflow">{format.format(overspend)} over cycle budget</span>}
        </div>

        {/*
          One agreed figure, measured over one period. The budget is what the
          team signed for this 30-day cycle and is printed as signed; the
          spend is this cycle's, counted from its first day. There is no
          prorated middle number any more: apportioning the plan across the
          selected filter invented a target nobody agreed to and declared a
          running cycle closed while two steerable days were left.
        */}
        <dl className="pacing-facts">
          <div className="pacing-facts__plan">
            <dt>Cycle budget</dt>
            <dd>
              {format.format(row.monthlyBudget)}{" "}
              <small>{PLAN_SOURCE_LABEL[planSource]}</small>
            </dd>
          </div>
          <div><dt>Spent so far</dt><dd>{format.format(row.spentToDate)}</dd></div>
          <div>
            <dt>{overspend > 0 ? "Over budget by" : "Left in cycle"}</dt>
            <dd>
              {format.format(overspend > 0 ? overspend : row.remainingBudget)}{" "}
              <small>
                {row.daysRemaining === 0
                  ? "cycle closed"
                  : row.daysRemaining === 1
                    ? "1 day left"
                    : `${row.daysRemaining} days left`}
              </small>
            </dd>
          </div>
          <div>
            <dt>Daily now → recommended</dt>
            <dd>
              {row.currentDailySpend === null
                ? "N/A"
                : format.format(row.currentDailySpend)}{" "}
              <span aria-hidden="true">→</span>{" "}
              <strong>
                {row.recommendedDailySpend === null
                  ? "cycle closed"
                  : format.format(row.recommendedDailySpend)}
              </strong>
            </dd>
          </div>
          <div>
            <dt>Projected cycle end</dt>
            <dd>
              {row.projectedCycleEnd === null
                ? "N/A"
                : format.format(row.projectedCycleEnd)}
            </dd>
          </div>
        </dl>
      </div>

      <details className="pacing-card__note">
        <summary>Cycle pacing details</summary>
        <p>{row.safeMessage}</p>
      </details>
    </article>
  );
});

export const BudgetPacingCard = memo(function BudgetPacingCard({
  snapshot,
  budgets,
  disabled,
  onApply,
}: BudgetPacingCardProps) {
  const pacing = snapshot.budgetPacing;
  const currency = pacing.currency;
  const [draft, setDraft] = useState({
    meta: String(budgets.meta),
    google: String(budgets.google),
  });
  // Switching brand must reload the inputs, or the form keeps showing the
  // previous brand's plan and the next submit writes it onto this one. The
  // comparison is by value, not identity, so a routine snapshot refresh does
  // not discard what the operator is part-way through typing.
  const [appliedBudgets, setAppliedBudgets] = useState(budgets);

  if (
    budgets.meta !== appliedBudgets.meta ||
    budgets.google !== appliedBudgets.google
  ) {
    setAppliedBudgets(budgets);
    setDraft({ meta: String(budgets.meta), google: String(budgets.google) });
  }

  return (
    <section
      aria-labelledby="budget-pacing-title"
      className="section section--dense section--surface"
      id="budget-pacing"
    >
      <div className="section-heading section-heading--compact">
        <div>
          <h2 id="budget-pacing-title">Budget pacing</h2>
        </div>
        <span className="section-heading__meta">
          {pacing.cycle.label} cycle ·{" "}
          {formatCycleSpan(pacing.cycle.start, pacing.cycle.end)} · Day{" "}
          {pacing.platforms[0]?.daysElapsed ?? 0}/{pacing.cycleDays}
        </span>
      </div>

      {/*
        This card measures the reporting cycle while every panel below it
        measures the selected filter. When the two differ the spend figures on
        screen legitimately disagree, and saying so is the whole reason the
        difference is safe to show: an unexplained second spend total is what
        sends the wrong number into a client meeting.
      */}
      {pacing.filterMatchesCycle ? null : (
        <p className="pacing-scope-note">
          Paced against the full {pacing.cycleDays}-day cycle, not the selected{" "}
          {pacing.filterDays}-day filter. Spend here is counted from{" "}
          {formatCycleDay(pacing.cycle.start)}, so it will not match the panels
          below.
        </p>
      )}

      <form
        aria-busy={disabled}
        aria-label={`Monthly platform budgets in ${currency}`}
        className="targets-bar targets-bar--budget"
        onSubmit={(event) => {
          event.preventDefault();
          onApply(
            normaliseBudgets({
              meta: Number(draft.meta),
              google: Number(draft.google),
            }),
          );
        }}
      >
        <strong className="targets-bar__title">
          Monthly budgets
          <small>{pacing.cycle.label} cycle</small>
        </strong>
        <label className="field field--compact">
          <span className="field-label">
            Meta budget
            <span aria-hidden="true" className="field-unit-chip">
              {currency}
            </span>
          </span>
          <input
            aria-label={`Meta budget in ${currency}`}
            disabled={disabled}
            inputMode="decimal"
            min="0"
            onChange={(event) =>
              setDraft((current) => ({ ...current, meta: event.target.value }))
            }
            step="any"
            type="number"
            value={draft.meta}
          />
        </label>
        <label className="field field--compact">
          <span className="field-label">
            Google budget
            <span aria-hidden="true" className="field-unit-chip">
              {currency}
            </span>
          </span>
          <input
            aria-label={`Google budget in ${currency}`}
            disabled={disabled}
            inputMode="decimal"
            min="0"
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                google: event.target.value,
              }))
            }
            step="any"
            type="number"
            value={draft.google}
          />
        </label>
        <button
          className="button button--secondary"
          disabled={disabled}
          type="submit"
        >
          {disabled ? "Applying…" : "Apply budgets"}
        </button>
      </form>

      <div className="pacing-grid">
        {pacing.platforms.map((row) => (
          <PlatformPacingCard
            currency={currency}
            cycleDays={pacing.cycleDays}
            key={row.platform}
            planSource={pacing.planSource}
            row={row}
          />
        ))}
      </div>
    </section>
  );
});
