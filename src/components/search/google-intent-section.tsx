"use client";

import { useEffect, useRef, useState } from "react";

import {
  CheckIcon,
  LightbulbIcon,
  NoteIcon,
} from "@/components/dashboard/icons";
import {
  MetricHint,
  metricHintFor,
} from "@/components/dashboard/metric-hint";
import { formatCurrency } from "@/lib/dashboard/account-contract";
import type {
  Currency,
  GoogleIntentAnalysis,
  GoogleMatchTypeDriftSummary,
  GoogleWastedSpendSummary,
} from "@/lib/dashboard/types";

type GoogleIntentView = "intent" | "waste";
type CopyState = "idle" | "copied" | "error";

interface GoogleIntentSectionProps {
  intent: GoogleIntentAnalysis | null;
  wastedSpend: GoogleWastedSpendSummary | null;
  matchTypeDrift: GoogleMatchTypeDriftSummary | null;
  currency: Currency;
  view: GoogleIntentView;
}

const DRIFT_PRESENTATION: Record<
  GoogleMatchTypeDriftSummary["driftVerdict"],
  { label: string; tone: "positive" | "warning" | "negative" | "neutral" }
> = {
  tight: { label: "Controlled", tone: "positive" },
  moderate_drift: { label: "Review", tone: "warning" },
  high_drift: { label: "High drift", tone: "negative" },
  // Not a good result and not a bad one. Absence of data used to score as 0%
  // and render green, which reads as a verdict nobody reached.
  insufficient_data: { label: "Not enough data", tone: "neutral" },
};

export function GoogleIntentSection({
  intent,
  wastedSpend,
  matchTypeDrift,
  currency,
  view,
}: GoogleIntentSectionProps) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  const handleCopyNegatives = async () => {
    if (!wastedSpend || wastedSpend.recommendations.length === 0) return;

    const formattedList = wastedSpend.recommendations
      .map((recommendation) =>
        `${recommendation.suggestedExact}\n${recommendation.suggestedPhrase}`,
      )
      .join("\n");

    try {
      await navigator.clipboard.writeText(formattedList);
      setCopyState("copied");
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopyState("idle"), 2500);
    } catch {
      setCopyState("error");
    }
  };

  if (view === "intent") {
    if (!intent) return null;

    return (
      <div className="search-analysis-view" role="region" aria-labelledby="intent-view-title">
        <div className="diagnostic-panel__header search-analysis-view__header">
          <div className="diagnostic-panel__heading">
            <span className="diagnostic-tag diagnostic-tag--google">
              Non-brand intent ladder
            </span>
            <h3 className="diagnostic-panel__title" id="intent-view-title">
              Search intent tier breakdown
            </h3>
            <p className="diagnostic-panel__desc">
              Group commercial queries from wholesale buying intent through
              early problem-aware discovery.
            </p>
          </div>

          <div className="diagnostic-kpi-card diagnostic-kpi-card--highlight search-analysis-view__kpi">
            <span className="diagnostic-kpi-card__label metric-label-inline">
              High-intent buying share
              <MetricHint
                label="High-intent buying share"
                text={metricHintFor("highIntentShare")!}
              />
            </span>
            <span className="diagnostic-kpi-card__val diagnostic-kpi-card__val--google">
              {intent.highIntentSharePercent === null
                ? "N/A"
                : `${intent.highIntentSharePercent}%`}
            </span>
            <span className="diagnostic-kpi-card__sub">
              of non-brand Search spend
            </span>
          </div>
        </div>

        <div className="diagnostic-callout">
          <LightbulbIcon className="diagnostic-callout__icon" />
          <div className="diagnostic-callout__content">
            <strong>Intent allocation:</strong> {intent.strategicNote}
          </div>
        </div>

        <p className="geo-unattributed">
          Brand queries are held out of this ladder:{" "}
          <strong>{formatCurrency(intent.brandSpend, currency)}</strong> (
          {intent.brandSharePercent}% of Search spend). Of the non-brand spend,{" "}
          <strong>{intent.classifiedSharePercent}%</strong> matched a wording rule —
          the rest is shown as Not classified rather than assigned a tier.
        </p>

        <div className="intent-tier-grid">
          {intent.tiers.map((tier) => {
            const isTier1 = tier.tier === "high_intent_category";
            const isWaste = tier.tier === "unclassified_waste";

            return (
              <article
                key={tier.tier}
                className={`intent-tier-card${
                  isTier1
                    ? " intent-tier-card--tier1"
                    : isWaste
                      ? " intent-tier-card--waste"
                      : ""
                }`}
              >
                <div>
                  <header className="intent-tier-card__header">
                    <h4>{tier.label}</h4>
                    <span className="intent-tier-card__share">
                      {tier.spendSharePercent}% spend
                    </span>
                  </header>
                  <p className="intent-tier-card__description">{tier.description}</p>

                  <dl className="intent-tier-card__metrics">
                    <div>
                      <dt>Spend</dt>
                      <dd>{formatCurrency(tier.spend, currency)}</dd>
                    </div>
                    <div>
                      <dt>Purchases</dt>
                      <dd>
                        {tier.purchases === null ? "Not measured" : tier.purchases}
                      </dd>
                    </div>
                    <div>
                      <dt>ROAS</dt>
                      {/* An unmeasured return is not a zero return: it carries
                          no tone, because there is no verdict to colour. */}
                      <dd
                        className={
                          tier.roas === null
                            ? undefined
                            : tier.roas >= 4
                              ? "intent-tier-card__value--positive"
                              : tier.roas === 0
                                ? "intent-tier-card__value--negative"
                                : undefined
                        }
                      >
                        {tier.roas !== null ? `${tier.roas.toFixed(1)}×` : "Not measured"}
                      </dd>
                    </div>
                  </dl>
                </div>

                <div className="intent-tier-card__queries">
                  <span>Sample commercial queries</span>
                  {tier.topSampleQueries.length > 0 ? (
                    <div>
                      {tier.topSampleQueries.map((query) => (
                        <code key={query}>&ldquo;{query}&rdquo;</code>
                      ))}
                    </div>
                  ) : (
                    <p>No representative query in this period.</p>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    );
  }

  if (!wastedSpend) return null;

  const hasRecommendations = wastedSpend.recommendations.length > 0;
  // Zero findings has two causes that lead to opposite decisions: nothing
  // leaked, or nothing could be read. The summary now carries which one.
  const nothingCouldBeJudged = wastedSpend.coverage === "none";
  const partiallyJudged = wastedSpend.coverage === "partial";
  const driftPresentation = matchTypeDrift
    ? DRIFT_PRESENTATION[matchTypeDrift.driftVerdict]
    : null;

  return (
    <div className="search-analysis-view" role="region" aria-labelledby="waste-view-title">
      <div className="diagnostic-panel__header search-analysis-view__header">
        <div className="diagnostic-panel__heading">
          <span className="diagnostic-tag diagnostic-tag--rose">
            Cost recovery action
          </span>
          <h3 className="diagnostic-panel__title" id="waste-view-title">
            Wasted spend impact &amp; negative keyword center
          </h3>
          <p className="diagnostic-panel__desc">
            Review budget leakage on low-intent queries before copying any
            proposed negative keywords.
          </p>
        </div>

        <div className="diagnostic-kpi-cluster">
          <div className="diagnostic-kpi-card diagnostic-kpi-card--highlight search-analysis-view__kpi">
            <span className="diagnostic-kpi-card__label metric-label-inline">
              Detected waste
              <MetricHint
                label="Detected waste"
                text={metricHintFor("detectedWaste")!}
              />
            </span>
            <span className="diagnostic-kpi-card__val diagnostic-kpi-card__val--negative">
              {formatCurrency(wastedSpend.totalWastedAmount, currency)}
            </span>
            <span className="diagnostic-kpi-card__sub">
              {wastedSpend.wastedSpendPercent}% of the{" "}
              {formatCurrency(wastedSpend.spendAnalyzed, currency)} of Search spend read
            </span>
          </div>
          <div className="diagnostic-kpi-card diagnostic-kpi-card--highlight search-analysis-view__kpi">
            <span className="diagnostic-kpi-card__label metric-label-inline">
              Projected monthly savings
              <MetricHint
                label="Projected monthly savings"
                text={metricHintFor("projectedMonthlySavings")!}
              />
            </span>
            <span className="diagnostic-kpi-card__val diagnostic-kpi-card__val--positive">
              ~{formatCurrency(wastedSpend.monthlyProjectedSavings, currency)}/mo
            </span>
            <span className="diagnostic-kpi-card__sub">
              Estimated recoverable budget
            </span>
          </div>
        </div>
      </div>

      {partiallyJudged && (
        <p className="geo-unattributed">
          <strong>{formatCurrency(wastedSpend.unmeasuredConversionSpend, currency)}</strong>{" "}
          of the {formatCurrency(wastedSpend.spendAnalyzed, currency)} read here had no
          conversion measurement, so it is neither counted as waste nor cleared. The
          findings below cover the remaining{" "}
          {formatCurrency(wastedSpend.measuredSpend, currency)}.
        </p>
      )}

      <div className={`negative-action-bar${hasRecommendations || nothingCouldBeJudged ? "" : " negative-action-bar--clear"}`}>
        <div className="negative-action-bar__summary">
          {hasRecommendations || nothingCouldBeJudged ? (
            <NoteIcon aria-hidden="true" />
          ) : (
            <CheckIcon aria-hidden="true" />
          )}
          <div>
            <strong>
              {hasRecommendations
                ? `${wastedSpend.flaggedQueryCount} ${wastedSpend.flaggedQueryCount === 1 ? "query" : "queries"} ready for review`
                : nothingCouldBeJudged
                  ? "Waste could not be judged in this period"
                  : "No negative-keyword candidates detected"}
            </strong>
            <span>
              {hasRecommendations
                ? "Copying does not apply changes to Google Ads. Review the list before use."
                : nothingCouldBeJudged
                  ? `Conversions were not measured for any of the ${formatCurrency(wastedSpend.spendAnalyzed, currency)} of Search spend read here, so no query can be called wasted or safe. This is not a clean result.`
                  : "No measured query crossed the current waste and intent rules in this period."}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void handleCopyNegatives()}
          className="rfm-action-card__btn negative-action-bar__button"
          disabled={!hasRecommendations}
        >
          {copyState === "copied" ? <CheckIcon aria-hidden="true" /> : <NoteIcon aria-hidden="true" />}
          {copyState === "copied" ? "Review list copied" : "Copy review list"}
        </button>
      </div>

      <p
        className={`negative-copy-status${copyState === "error" ? " negative-copy-status--error" : ""}`}
        aria-live="polite"
      >
        {copyState === "error"
          ? "The browser could not access the clipboard. Try again or copy the rows manually."
          : copyState === "copied"
            ? "Copied exact- and phrase-match suggestions to the clipboard."
            : ""}
      </p>

      {hasRecommendations ? (
        <div className="table-scroller negative-keyword-table">
          <table>
            <caption className="visually-hidden">
              Negative-keyword candidates with their reason, cost, and proposed match syntax
            </caption>
            <thead>
              <tr>
                <th scope="col">Flagged query</th>
                <th scope="col">Reason</th>
                <th scope="col" className="cell--number">Clicks</th>
                <th scope="col" className="cell--number">Wasted spend</th>
                <th scope="col">Exact match</th>
                <th scope="col">Phrase match</th>
              </tr>
            </thead>
            <tbody>
              {wastedSpend.recommendations.map((recommendation) => (
                <tr key={recommendation.query}>
                  <th scope="row">&ldquo;{recommendation.query}&rdquo;</th>
                  <td>{recommendation.reason}</td>
                  <td className="cell--number">{recommendation.clicks}</td>
                  <td className="cell--number cell--breach">
                    {formatCurrency(recommendation.spendWasted, currency)}
                  </td>
                  <td><code>{recommendation.suggestedExact}</code></td>
                  <td><code>{recommendation.suggestedPhrase}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {matchTypeDrift && driftPresentation && (
        <section className="match-drift-card" aria-labelledby="match-drift-title">
          <div className="match-drift-card__header">
            <div>
              <span className="diagnostic-tag diagnostic-tag--gold">Query control</span>
              <h4 id="match-drift-title">Match-type distribution &amp; query drift</h4>
            </div>
            <span className={`match-drift-card__verdict match-drift-card__verdict--${driftPresentation.tone}`}>
              {matchTypeDrift.driftIndexPercent === null
                ? driftPresentation.label
                : `${matchTypeDrift.driftIndexPercent}% · ${driftPresentation.label}`}
            </span>
          </div>

          <div
            className="match-drift-bar"
            role="img"
            aria-label={`Spend distribution: Exact ${matchTypeDrift.exactSharePercent}%, Phrase ${matchTypeDrift.phraseSharePercent}%, Broad ${matchTypeDrift.broadSharePercent}%`}
          >
            <span
              className="match-drift-bar__segment match-drift-bar__segment--exact"
              style={{ width: `${matchTypeDrift.exactSharePercent}%` }}
            />
            <span
              className="match-drift-bar__segment match-drift-bar__segment--phrase"
              style={{ width: `${matchTypeDrift.phraseSharePercent}%` }}
            />
            <span
              className="match-drift-bar__segment match-drift-bar__segment--broad"
              style={{ width: `${matchTypeDrift.broadSharePercent}%` }}
            />
          </div>

          <dl className="match-drift-card__legend">
            <div>
              <dt><i className="match-drift-dot match-drift-dot--exact" />Exact</dt>
              <dd>{matchTypeDrift.exactSharePercent}% · {formatCurrency(matchTypeDrift.exactSpend, currency)}</dd>
            </div>
            <div>
              <dt><i className="match-drift-dot match-drift-dot--phrase" />Phrase</dt>
              <dd>{matchTypeDrift.phraseSharePercent}% · {formatCurrency(matchTypeDrift.phraseSpend, currency)}</dd>
            </div>
            <div>
              <dt><i className="match-drift-dot match-drift-dot--broad" />Broad</dt>
              <dd>{matchTypeDrift.broadSharePercent}% · {formatCurrency(matchTypeDrift.broadSpend, currency)}</dd>
            </div>
          </dl>
          <p className="match-drift-card__note">{matchTypeDrift.driftNote}</p>
        </section>
      )}
    </div>
  );
}
