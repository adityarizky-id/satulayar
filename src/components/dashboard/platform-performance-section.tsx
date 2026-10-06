"use client";

import { memo } from "react";

import { GoogleAdsIcon, MetaAdsIcon } from "@/components/dashboard/icons";
import { MetricHint, metricHintFor } from "@/components/dashboard/metric-hint";
import { getPercentChange } from "@/lib/dashboard/kpi";
import type {
  Currency,
  DashboardSnapshot,
  MetricCardData,
  Platform,
} from "@/lib/dashboard/types";

export interface PlatformPerformanceSectionProps {
  snapshot: DashboardSnapshot;
  onPlatformChange: (platform: Platform) => void;
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

function compactCurrencyFormatterFor(currency: Currency): Intl.NumberFormat {
  const key = `compact:${currency}`;
  const cached = currencyFormatters.get(key);
  if (cached) return cached;

  const formatter = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  });
  currencyFormatters.set(key, formatter);
  return formatter;
}

const numberFormatter = new Intl.NumberFormat("en-GB", {
  maximumFractionDigits: 0,
});

const PlatformMetric = memo(function PlatformMetric({
  value,
  comparisonValue,
  comparisonEnabled,
  comparisonLabel,
  favorableDirection,
  format,
}: {
  value: number | null;
  comparisonValue: number | null;
  comparisonEnabled: boolean;
  comparisonLabel: string;
  favorableDirection: MetricCardData["favorableDirection"];
  format: (value: number) => string;
}) {
  const change = comparisonEnabled
    ? getPercentChange(value, comparisonValue)
    : null;
  const numericChange = typeof change === "number" ? change : null;
  const isFavorable =
    numericChange !== null &&
    numericChange !== 0 &&
    favorableDirection !== "neutral" &&
    (favorableDirection === "higher"
      ? numericChange > 0
      : numericChange < 0);
  const tone =
    change === "new" && favorableDirection !== "neutral"
      ? favorableDirection === "higher"
        ? "positive"
        : "negative"
      : numericChange === null ||
          numericChange === 0 ||
          favorableDirection === "neutral"
        ? "neutral"
        : isFavorable
          ? "positive"
          : "negative";
  const comparisonText =
    change === "new"
      ? "New"
      : change === "no-change"
        ? "→ 0.0%"
        : numericChange === null
          ? "N/A"
          : `${numericChange > 0 ? "↑" : numericChange < 0 ? "↓" : "→"} ${Math.abs(
              numericChange,
            ).toFixed(1)}%`;
  const comparisonAriaLabel =
    change === "new"
      ? `New versus ${comparisonLabel}`
      : change === "no-change"
        ? `Unchanged versus ${comparisonLabel}`
        : numericChange === null
          ? `Comparison unavailable versus ${comparisonLabel}`
          : `${Math.abs(numericChange).toFixed(1)}% ${
              numericChange > 0
                ? "higher"
                : numericChange < 0
                  ? "lower"
                  : "unchanged"
            } versus ${comparisonLabel}`;

  return (
    <span className="platform-metric">
      <span className="platform-metric__value">
        {value === null ? "N/A" : format(value)}
      </span>
      {comparisonEnabled && (
        <span
          aria-label={comparisonAriaLabel}
          className={`platform-metric__comparison platform-metric__comparison--${tone}`}
        >
          {comparisonText}
        </span>
      )}
    </span>
  );
});

export const PlatformPerformanceSection = memo(
  function PlatformPerformanceSection({
    snapshot,
    onPlatformChange,
  }: PlatformPerformanceSectionProps) {
    const currency = snapshot.account.currency;

    return (
      <section
        aria-labelledby="platform-title"
        className="section section--dense"
        id="platform-performance"
      >
        <div className="section-heading section-heading--compact">
          <div>
            <h2 id="platform-title">Platform performance</h2>
          </div>
          <span className="section-heading__meta">
            {snapshot.comparisonEnabled
              ? `vs ${snapshot.comparisonBasis.label.toLowerCase()}`
              : "Comparison off"}
            {" · "}Store metrics from the store
          </span>
        </div>
        <p
          className="visually-hidden"
          id="platform-switcher-instruction"
        >
          Select a platform row to focus the dashboard. Select it again to reset.
        </p>
        <div className="table-scroller">
          <table
            aria-describedby="platform-switcher-instruction"
            className="platform-performance-table"
          >
            <caption className="visually-hidden">
              Platform metrics for the active period
              {snapshot.comparisonEnabled
                ? ` with percentage change versus ${snapshot.comparisonBasis.label.toLowerCase()}`
                : " without a comparison period"}
            </caption>
            <thead>
              <tr>
                <th scope="col">Platform</th>
                <th scope="col">
                  <span className="metric-label-inline">
                    Spend
                    <MetricHint label="Spend" text={metricHintFor("spend")!} />
                  </span>
                </th>
                <th scope="col">
                  <span className="metric-label-inline">
                    Purchases
                    <MetricHint
                      label="Purchases"
                      text={metricHintFor("purchases")!}
                    />
                  </span>
                </th>
                <th scope="col">
                  <span className="metric-label-inline">
                    CPO
                    <MetricHint
                      label="CPO"
                      text={metricHintFor("costPerPurchase")!}
                    />
                  </span>
                </th>
                <th scope="col">
                  <span className="metric-label-inline">
                    Registrations
                    <MetricHint
                      label="Registrations"
                      text={metricHintFor("registrations")!}
                    />
                  </span>
                </th>
                <th scope="col">
                  <span className="metric-label-inline">
                    CPA
                    <MetricHint
                      label="CPA"
                      text={metricHintFor("costPerRegistration")!}
                    />
                  </span>
                </th>
                <th scope="col">
                  <span className="metric-label-inline">
                    Platform ROAS
                    <MetricHint
                      label="Platform ROAS"
                      text={metricHintFor("platformRoas")!}
                    />
                  </span>
                </th>
                <th scope="col">
                  <span className="metric-label-inline">
                    Platform value
                    <MetricHint
                      label="Platform value"
                      text={metricHintFor("platformValue")!}
                    />
                  </span>
                </th>
                <th className="platform-performance-table__store-col" scope="col">
                  <span className="platform-performance-table__source-heading">
                    <span className="metric-label-inline">
                      Store revenue
                      <MetricHint
                        label="Store revenue"
                        text={metricHintFor("actualPurchaseRevenue")!}
                      />
                    </span>
                    <small>Store</small>
                  </span>
                </th>
                <th className="platform-performance-table__store-col" scope="col">
                  <span className="platform-performance-table__source-heading">
                    <span className="metric-label-inline">
                      Store ROAS
                      <MetricHint
                        label="Store ROAS"
                        text={metricHintFor("actualRevenueRoas")!}
                      />
                    </span>
                    <small>Store</small>
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {snapshot.platformBreakdown.map(
                ({ platform, totals, comparisonTotals }) => {
                  const isFiltered = snapshot.selectedPlatform === platform;
                  const nextPlatform: Platform = isFiltered ? "all" : platform;
                  const platformLabel =
                    platform === "meta" ? "Meta Ads" : "Google Ads";

                  return (
                    <tr
                      className={`platform-row${
                        isFiltered ? " platform-row--active" : ""
                      }`}
                      key={platform}
                      onClick={() => onPlatformChange(nextPlatform)}
                      title={
                        isFiltered
                          ? `Filtered to ${platformLabel}. Click to reset to all platforms (Meta + Google).`
                          : `Click to filter dashboard to ${platformLabel}`
                      }
                    >
                      <th scope="row">
                        <button
                          aria-label={
                            isFiltered
                              ? `Active filter: ${platformLabel}. Click to reset to all platforms.`
                              : `Filter dashboard to ${platformLabel}`
                          }
                          aria-pressed={isFiltered}
                          className="platform-row__action"
                          onClick={(event) => {
                            event.stopPropagation();
                            onPlatformChange(nextPlatform);
                          }}
                          type="button"
                        >
                          <span
                            aria-hidden="true"
                            className={`platform-mark platform-mark--${platform}`}
                          >
                            {platform === "google" ? (
                              <GoogleAdsIcon width={14} height={14} />
                            ) : platform === "meta" ? (
                              <MetaAdsIcon width={14} height={14} />
                            ) : null}
                          </span>
                          <span className="platform-row__name">
                            {platformLabel}
                          </span>
                          {isFiltered && (
                            <span className="platform-row__chip">
                              Active filter
                            </span>
                          )}
                        </button>
                      </th>
                      <td>
                        <PlatformMetric
                          comparisonEnabled={snapshot.comparisonEnabled}
                          comparisonLabel={snapshot.comparisonBasis.label}
                          comparisonValue={comparisonTotals.spend}
                          favorableDirection="neutral"
                          format={(value) =>
                            currencyFormatterFor(currency).format(value)
                          }
                          value={totals.spend}
                        />
                      </td>
                      <td>
                        <PlatformMetric
                          comparisonEnabled={snapshot.comparisonEnabled}
                          comparisonLabel={snapshot.comparisonBasis.label}
                          comparisonValue={comparisonTotals.purchases}
                          favorableDirection="higher"
                          format={(value) => numberFormatter.format(value)}
                          value={totals.purchases}
                        />
                      </td>
                      <td>
                        <PlatformMetric
                          comparisonEnabled={snapshot.comparisonEnabled}
                          comparisonLabel={snapshot.comparisonBasis.label}
                          comparisonValue={comparisonTotals.costPerPurchase}
                          favorableDirection="lower"
                          format={(value) =>
                            currencyFormatterFor(currency).format(value)
                          }
                          value={totals.costPerPurchase}
                        />
                      </td>
                      <td>
                        <PlatformMetric
                          comparisonEnabled={snapshot.comparisonEnabled}
                          comparisonLabel={snapshot.comparisonBasis.label}
                          comparisonValue={comparisonTotals.registrations}
                          favorableDirection="higher"
                          format={(value) => numberFormatter.format(value)}
                          value={totals.registrations}
                        />
                      </td>
                      <td>
                        <PlatformMetric
                          comparisonEnabled={snapshot.comparisonEnabled}
                          comparisonLabel={snapshot.comparisonBasis.label}
                          comparisonValue={comparisonTotals.costPerRegistration}
                          favorableDirection="lower"
                          format={(value) =>
                            currencyFormatterFor(currency).format(value)
                          }
                          value={totals.costPerRegistration}
                        />
                      </td>
                      <td>
                        <PlatformMetric
                          comparisonEnabled={snapshot.comparisonEnabled}
                          comparisonLabel={snapshot.comparisonBasis.label}
                          comparisonValue={comparisonTotals.platformRoas}
                          favorableDirection="higher"
                          format={(value) => `${value.toFixed(2)}×`}
                          value={totals.platformRoas}
                        />
                      </td>
                      <td>
                        <PlatformMetric
                          comparisonEnabled={snapshot.comparisonEnabled}
                          comparisonLabel={snapshot.comparisonBasis.label}
                          comparisonValue={
                            comparisonTotals.platformConversionValue
                          }
                          favorableDirection="higher"
                          format={(value) =>
                            compactCurrencyFormatterFor(currency).format(value)
                          }
                          value={totals.platformConversionValue}
                        />
                      </td>
                      <td className="platform-performance-table__store-col">
                        <PlatformMetric
                          comparisonEnabled={snapshot.comparisonEnabled}
                          comparisonLabel={snapshot.comparisonBasis.label}
                          comparisonValue={
                            comparisonTotals.actualPurchaseRevenue
                          }
                          favorableDirection="higher"
                          format={(value) =>
                            compactCurrencyFormatterFor(currency).format(value)
                          }
                          value={totals.actualPurchaseRevenue}
                        />
                      </td>
                      <td className="platform-performance-table__store-col">
                        <PlatformMetric
                          comparisonEnabled={snapshot.comparisonEnabled}
                          comparisonLabel={snapshot.comparisonBasis.label}
                          comparisonValue={comparisonTotals.actualRevenueRoas}
                          favorableDirection="higher"
                          format={(value) => `${value.toFixed(2)}×`}
                          value={totals.actualRevenueRoas}
                        />
                      </td>
                    </tr>
                  );
                },
              )}
            </tbody>
          </table>
        </div>
      </section>
    );
  },
);
