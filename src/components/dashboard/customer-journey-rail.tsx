"use client";

import { memo, useState } from "react";

import { InsightAttachment } from "@/components/dashboard/advisory-panels";
import { MetricHint, metricHintFor } from "@/components/dashboard/metric-hint";
import { getPercentChange } from "@/lib/dashboard/kpi";
import { groupCardsByStage } from "@/lib/dashboard/scorecard";
import type {
  Currency,
  DashboardSnapshot,
  MetricCardData,
} from "@/lib/dashboard/types";

export interface CustomerJourneyRailProps {
  snapshot: DashboardSnapshot;
}

const currencyFormatters = new Map<string, Intl.NumberFormat>();

function currencyFormatterFor(currency: Currency): Intl.NumberFormat {
  const key = `full:${currency}`;
  const cached = currencyFormatters.get(key);
  if (cached) return cached;

  const formatter = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  });
  currencyFormatters.set(key, formatter);
  return formatter;
}

function preciseCurrencyFormatterFor(currency: Currency): Intl.NumberFormat {
  const key = `precise:${currency}`;
  const cached = currencyFormatters.get(key);
  if (cached) return cached;

  const formatter = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  currencyFormatters.set(key, formatter);
  return formatter;
}

const numberFormatter = new Intl.NumberFormat("en-GB", {
  maximumFractionDigits: 0,
});

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function formatDate(value: string): string {
  return dateFormatter.format(new Date(`${value}T12:00:00Z`));
}

function formatMetric(card: MetricCardData, currency: Currency): string {
  // "Not reported" and "N/A" are different claims: the first says nobody
  // measured it, the second that it could not be worked out from what was
  // measured. Collapsing them hides which one the reader is looking at.
  if (card.availability === "not-reported") return "Not reported";
  if (card.value === null) return "N/A";
  if (card.unit === "currency") {
    return card.value < 10
      ? preciseCurrencyFormatterFor(currency).format(card.value)
      : currencyFormatterFor(currency).format(card.value);
  }
  if (card.unit === "ratio") return `${card.value.toFixed(2)}×`;
  if (card.unit === "percent") return `${(card.value * 100).toFixed(1)}%`;
  return numberFormatter.format(card.value);
}

interface FunnelStep {
  key: string;
  label: string;
  /** Null when the source never measured this step in the selected scope. */
  value: number | null;
  comparable?: boolean;
}

function buildFunnelTransitions(steps: FunnelStep[]) {
  return steps.slice(0, -1).map((step, index) => {
    const next = steps[index + 1];
    // An unmeasured step breaks the chain on both sides: a pass rate into or
    // out of a number nobody collected would be arithmetic on a blank.
    const comparable = Boolean(
      next &&
        step.comparable !== false &&
        next.comparable !== false &&
        step.value !== null &&
        next.value !== null &&
        step.value > 0 &&
        next.value >= 0 &&
        next.value <= step.value,
    );
    const passRate =
      comparable && next && next.value !== null && step.value
        ? next.value / step.value
        : null;

    return {
      from: step.key,
      to: next?.key ?? step.key,
      passRate,
      dropRate: passRate === null ? null : 1 - passRate,
    };
  });
}

const JourneyDropOff = memo(function JourneyDropOff({
  snapshot,
}: {
  snapshot: DashboardSnapshot;
}) {
  const steps: FunnelStep[] = [
    {
      key: "impressions",
      label: "Impressions",
      value: snapshot.totals.impressions,
    },
    { key: "clicks", label: "Clicks", value: snapshot.totals.clicks },
    {
      key: "landingPageViews",
      // Availability is a property of the account's tracking, not of the
      // platform: a Google account with a page-view conversion action mapped
      // reports this, and one without it does not. Reading the total rather
      // than the platform keeps the label honest either way.
      label:
        snapshot.totals.landingPageViews === null
          ? "Page views · not tracked"
          : "Page views",
      value: snapshot.totals.landingPageViews,
    },
    {
      key: "registrations",
      label: "Registrations",
      value: snapshot.totals.registrations,
    },
    {
      key: "purchases",
      label:
        snapshot.selectedPlatform === "all"
          ? "Attributed purchases"
          : "Purchases",
      value: snapshot.totals.purchases,
    },
  ];
  const transitions = buildFunnelTransitions(steps);
  const steepestIndex = transitions.reduce((current, transition, index) => {
    if (transition.dropRate === null) return current;
    if (current === -1) return index;
    const currentDrop = transitions[current]?.dropRate ?? -1;
    return transition.dropRate > currentDrop ? index : current;
  }, -1);

  return (
    <div className="journey-flow" role="group" aria-label="Customer journey drop-off">
      <ol className="journey-flow__steps">
        {steps.map((step, index) => {
          const transition = transitions[index];
          const isSharpestStage = index > 0 && index - 1 === steepestIndex;

          return (
            <li className="journey-flow__item" key={step.key}>
              <div
                className={`journey-flow__stage${
                  isSharpestStage ? " journey-flow__stage--warning" : ""
                }`}
              >
                <span>{step.label}</span>
                <strong>
                  {step.value === null
                    ? "Not reported"
                    : numberFormatter.format(step.value)}
                </strong>
                {isSharpestStage && (
                  <small>Steepest drop</small>
                )}
              </div>
              {transition && (
                <div
                  aria-label={
                    transition.passRate === null
                      ? `${step.label} to ${steps[index + 1]?.label}: not comparable`
                      : `${(transition.passRate * 100).toFixed(1)}% passed and ${(
                          (transition.dropRate ?? 0) * 100
                        ).toFixed(1)}% dropped`
                  }
                  className={`journey-flow__transition${
                    index === steepestIndex
                      ? " journey-flow__transition--warning"
                      : ""
                  }`}
                >
                  {transition.passRate === null ? (
                    <span>Not comparable</span>
                  ) : (
                    <>
                      <strong>{(transition.passRate * 100).toFixed(1)}% pass</strong>
                      <span>{((transition.dropRate ?? 0) * 100).toFixed(1)}% drop</span>
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
});

const JourneyMetric = memo(function JourneyMetric({
  card,
  costAggregationAllowed,
  currency,
}: {
  card: MetricCardData;
  costAggregationAllowed: boolean;
  currency: Currency;
}) {
  const isBlockedByCurrency =
    card.unit === "currency" && !costAggregationAllowed;
  const change = getPercentChange(card.value, card.previousValue);
  const numericChange = typeof change === "number" ? change : null;
  const isFavorable =
    numericChange !== null &&
    card.favorableDirection !== "neutral" &&
    (card.favorableDirection === "higher"
      ? numericChange >= 0
      : numericChange <= 0);
  const changeLabel =
    change === "new"
      ? "New"
      : change === "no-change"
        ? "0%"
        : numericChange === null
          ? "—"
          : `${numericChange >= 0 ? "+" : ""}${numericChange.toFixed(1)}%`;
  const hideDelta = card.confidence === "insufficient";
  const title = [
    metricHintFor(card.key),
    card.confidenceMessage,
    card.mixedBasisWarning,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <li className="journey-metric">
      <span className="journey-metric__label">
        <span className="journey-metric__label-text">{card.label}</span>
        {(card.platformScope || card.mixedBasisWarning || title) && (
          <span className="journey-metric__label-meta">
            {card.platformScope && (
              <span className={`metric-tag metric-tag--${card.platformScope}`}>
                {card.platformScope === "meta" ? "Meta" : "Google"}
              </span>
            )}
            {card.mixedBasisWarning && (
              <span className="metric-tag metric-tag--mixed">mixed basis</span>
            )}
            {title && <MetricHint label={card.label} text={title} />}
          </span>
        )}
      </span>
      <span className="journey-metric__value">
        {isBlockedByCurrency ? "Mixed" : formatMetric(card, currency)}
      </span>
      <span className="journey-metric__footer">
        {hideDelta || isBlockedByCurrency ? (
          <span className="delta delta--neutral">
            {isBlockedByCurrency ? "n/a" : "too few to compare"}
          </span>
        ) : (
          <span
            className={`delta ${
              card.favorableDirection === "neutral"
                ? "delta--neutral"
                : isFavorable
                  ? "delta--positive"
                  : "delta--negative"
            }`}
          >
            {changeLabel}
          </span>
        )}
        {card.confidence === "low-volume" && (
          <span className="metric-tag metric-tag--low">low volume</span>
        )}
      </span>
    </li>
  );
});

const JOURNEY_COLUMN_VISIBLE_LIMIT = 4;

const JourneyColumnCards = memo(function JourneyColumnCards({
  cards,
  costAggregationAllowed,
  currency,
}: {
  cards: MetricCardData[];
  costAggregationAllowed: boolean;
  currency: Currency;
}) {
  const [expanded, setExpanded] = useState(false);
  const hiddenCount = cards.length - JOURNEY_COLUMN_VISIBLE_LIMIT;
  const visibleCards =
    expanded || hiddenCount <= 0
      ? cards
      : cards.slice(0, JOURNEY_COLUMN_VISIBLE_LIMIT);

  return (
    <>
      <ul className="journey-column__metrics">
        {visibleCards.map((card) => (
          <JourneyMetric
            card={card}
            costAggregationAllowed={costAggregationAllowed}
            currency={currency}
            key={card.key}
          />
        ))}
      </ul>
      {hiddenCount > 0 && (
        <button
          aria-expanded={expanded}
          className="journey-column__more"
          onClick={() => setExpanded((value) => !value)}
          type="button"
        >
          {expanded
            ? "Show fewer metrics"
            : `Show ${hiddenCount} more metric${hiddenCount === 1 ? "" : "s"}`}
        </button>
      )}
    </>
  );
});

export const CustomerJourneyRail = memo(function CustomerJourneyRail({
  snapshot,
}: CustomerJourneyRailProps) {
  return (
    <section
      aria-labelledby="scorecard-title"
      className="section"
      id="journey-metrics"
    >
      <div className="section-heading">
        <div>
          <span className="eyebrow">Customer journey metrics</span>
          <h2 id="scorecard-title">
            {formatDate(snapshot.selectedRange.start)} –{" "}
            {formatDate(snapshot.selectedRange.end)}
          </h2>
        </div>
        <p>
          {snapshot.comparisonEnabled ? (
            <>
              Compared with {formatDate(snapshot.comparisonRange.start)} –{" "}
              {formatDate(snapshot.comparisonRange.end)}
              {snapshot.comparisonBasis.normalisedToActiveDuration
                ? ` · ${snapshot.comparisonBasis.comparisonDays}-day baseline normalised to ${snapshot.comparisonBasis.activeDays} days`
                : " · like-for-like"}
            </>
          ) : (
            "Compare is off, so each metric is shown for this period only and every change reads as unavailable."
          )}
        </p>
      </div>
      <InsightAttachment
        brief={snapshot.advisory}
        scope="Customer journey metrics"
      />
      <JourneyDropOff snapshot={snapshot} />
      <div className="journey-rail">
        {groupCardsByStage(snapshot.cards).map((group) => (
          <article className="journey-column" key={group.definition.stage}>
            <header className="journey-column__heading">
              <span className="journey-column__label">
                {group.definition.label}
              </span>
              <span className="journey-column__question">
                {group.definition.question}
              </span>
            </header>
            <JourneyColumnCards
              cards={group.cards}
              costAggregationAllowed={
                snapshot.guardrail.costAggregationAllowed
              }
              currency={snapshot.account.currency}
            />
          </article>
        ))}
      </div>
      {snapshot.conversionCaveat && (
        <p className="semantic-note">{snapshot.conversionCaveat}</p>
      )}
    </section>
  );
});
