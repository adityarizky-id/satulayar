"use client";

import { useMemo } from "react";

import type { DeviceAnalysis } from "@/lib/dashboard/device";
import { getPercentChange } from "@/lib/dashboard/kpi";
import type { Currency, Platform } from "@/lib/dashboard/types";

/**
 * Turns the share gap into a sentence a reader can act on. "-6.6 pts" is
 * accurate and unreadable; "takes 7 points more of the budget than of the
 * orders" says the same thing without the jargon.
 */
function readBalance(
  row: {
    label: string;
    spendShare: number;
    purchaseShare: number;
    efficiencyGap: number;
    purchases: number;
    spend: number;
    costPerPurchase: number | null;
  },
  averageCostPerOrder: number | null,
): { tone: "good" | "watch" | "flat" | "unknown"; verdict: string; sentence: string } {
  if (row.spend <= 0) {
    return {
      tone: "unknown",
      verdict: "no spend",
      sentence: "Nothing was spent on this device in the period.",
    };
  }

  if (row.purchases === 0) {
    return {
      tone: "unknown",
      verdict: "no orders",
      sentence: `Took ${(row.spendShare * 100).toFixed(0)}% of the budget and returned no orders yet.`,
    };
  }

  const points = Math.abs(row.efficiencyGap * 100);
  const comparison =
    averageCostPerOrder !== null && row.costPerPurchase !== null
      ? row.costPerPurchase / averageCostPerOrder - 1
      : null;
  const versusAverage =
    comparison === null || Math.abs(comparison) < 0.05
      ? "An order here costs about the account average."
      : comparison > 0
        ? `An order here costs ${Math.round(comparison * 100)}% more than the account average.`
        : `An order here costs ${Math.round(Math.abs(comparison) * 100)}% less than the account average.`;

  if (points < 2) {
    return {
      tone: "flat",
      verdict: "in balance",
      sentence: `Its share of spend and its share of orders match. ${versusAverage}`,
    };
  }

  return row.efficiencyGap < 0
    ? {
      tone: "watch",
      verdict: "costs more than it returns",
      sentence: `Takes ${points.toFixed(1)} points more of the budget than of the orders. ${versusAverage}`,
    }
    : {
      tone: "good",
      verdict: "returns more than it costs",
      sentence: `Brings ${points.toFixed(1)} points more of the orders than of the budget. ${versusAverage}`,
    };
}

function DeviceMetric({
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
  favorableDirection: "higher" | "lower" | "neutral";
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
          : `${Math.abs(numericChange).toFixed(1)}% ${numericChange > 0
            ? "higher"
            : numericChange < 0
              ? "lower"
              : "unchanged"
          } versus ${comparisonLabel}`;

  return (
    <span className="device-metric">
      <span className="device-metric__value">
        {value === null ? "N/A" : format(value)}
      </span>
      {comparisonEnabled && (
        <span
          aria-label={comparisonAriaLabel}
          className={`device-metric__comparison device-metric__comparison--${tone}`}
          title={comparisonAriaLabel}
        >
          {comparisonText}
        </span>
      )}
    </span>
  );
}

export function DeviceSection({
  analysis,
  comparison,
  comparisonEnabled,
  comparisonLabel,
  currency,
  selectedPlatform,
}: {
  analysis: DeviceAnalysis | null;
  comparison: DeviceAnalysis | null;
  comparisonEnabled: boolean;
  comparisonLabel: string;
  currency: Currency;
  selectedPlatform: Platform;
}) {
  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }),
    [currency],
  );
  const preciseCurrency = useMemo(
    () =>
      new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    [currency],
  );
  const numberFormatter = useMemo(
    () => new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }),
    [],
  );
  const comparisonByDevice = useMemo(
    () => new Map(comparison?.rows.map((row) => [row.device, row]) ?? []),
    [comparison],
  );

  if (!analysis) return null;

  const percent = (value: number | null) =>
    value === null ? "N/A" : `${(value * 100).toFixed(1)}%`;
  const averageCostPerOrder =
    analysis.totals.purchases === 0
      ? null
      : analysis.totals.spend / analysis.totals.purchases;

  return (
    <section className="section" id="device-analysis">
      <div className="section-heading section-heading--device">
        <div>
          <span className="eyebrow">Account diagnostic</span>
          <h2>
            Devices
            {selectedPlatform === "all" && (
              <span className="metric-tag metric-tag--google">
                Google Ads only
              </span>
            )}
          </h2>
          <p>
            Device performance from Google Ads. Meta is excluded because it
            reports placements instead. {" "}
            {comparisonEnabled
              ? `Trends compare with ${comparisonLabel.toLowerCase()}.`
              : "Period comparison is off."}
          </p>
        </div>
      </div>

      <article className="panel panel--device">
        <div className="panel__heading">
          <div>
            <span className="eyebrow">Budget efficiency by device</span>
            <h3 className="panel__title">Spend share vs order share</h3>
          </div>
          <div className="device-balance__legend" aria-label="Chart legend">
            <span className="device-balance__legend-item device-balance__legend-item--spend">
              Spend share
            </span>
            <span className="device-balance__legend-item device-balance__legend-item--orders">
              Order share
            </span>
            {comparisonEnabled && (
              <span className="device-balance__legend-item device-balance__legend-item--comparison">
                {comparison ? comparisonLabel : "Comparison unavailable"}
              </span>
            )}
          </div>
        </div>

        {/* A 100% stacked bar used to sit here. It was the wrong form and it
            lied: each row drew one device's spend share and filled the rest of
            the track with a hatch labelled "unreported", when that remainder
            was simply the other devices. Its legend also advertised two series
            and a masked state that were never drawn. The paired bars below
            answer the same question honestly. */}
        <div className="device-balance">
          <div className="device-balance__head" aria-hidden="true">
            <span>Device</span>
            <span>Takes this much spend</span>
            <span>Brings this many orders</span>
            <span>Reading</span>
          </div>
          {analysis.rows.map((row) => {
            const reading = readBalance(row, averageCostPerOrder);
            const comparisonRow = comparisonByDevice.get(row.device) ?? null;
            const spendComparison = comparisonRow?.spendShare ?? null;
            const purchaseComparison = comparisonRow?.purchaseShare ?? null;
            return (
              <div
                className={`device-balance__row device-balance__row--${reading.tone}`}
                key={row.device}
              >
                <span className="device-balance__label">{row.label}</span>

                <span className="device-balance__measure">
                  <span className="device-balance__measure-label">Spend share</span>
                  <span
                    className="device-balance__bar"
                    role="img"
                    aria-label={`${row.label} takes ${percent(row.spendShare)} of spend${comparisonEnabled
                        ? spendComparison === null
                          ? "; comparison unavailable"
                          : `; ${comparisonLabel} was ${percent(spendComparison)}`
                        : ""
                      }`}
                  >
                    {spendComparison !== null && (
                      <span
                        aria-hidden="true"
                        className="device-balance__comparison-marker"
                        style={{ left: `${spendComparison * 100}%` }}
                      />
                    )}
                    <i
                      aria-hidden="true"
                      style={{ width: `${row.spendShare * 100}%` }}
                    />
                  </span>
                  <span className="device-balance__values">
                    <strong>{percent(row.spendShare)}</strong>
                    {comparisonEnabled && (
                      <small>
                        {spendComparison === null
                          ? "No comp"
                          : `Comp ${percent(spendComparison)}`}
                      </small>
                    )}
                  </span>
                </span>

                <span className="device-balance__measure">
                  <span className="device-balance__measure-label">Order share</span>
                  <span
                    className="device-balance__bar device-balance__bar--orders"
                    role="img"
                    aria-label={`${row.label} brings ${percent(row.purchaseShare)} of orders${comparisonEnabled
                        ? purchaseComparison === null
                          ? "; comparison unavailable"
                          : `; ${comparisonLabel} was ${percent(purchaseComparison)}`
                        : ""
                      }`}
                  >
                    {purchaseComparison !== null && (
                      <span
                        aria-hidden="true"
                        className="device-balance__comparison-marker"
                        style={{ left: `${purchaseComparison * 100}%` }}
                      />
                    )}
                    <i
                      aria-hidden="true"
                      style={{ width: `${row.purchaseShare * 100}%` }}
                    />
                  </span>
                  <span className="device-balance__values">
                    <strong>{percent(row.purchaseShare)}</strong>
                    {comparisonEnabled && (
                      <small>
                        {purchaseComparison === null
                          ? "No comp"
                          : `Comp ${percent(purchaseComparison)}`}
                      </small>
                    )}
                  </span>
                </span>

                <span className="device-balance__reading">
                  <span className={`balance-chip balance-chip--${reading.tone}`}>
                    {reading.verdict}
                  </span>
                  <span className="device-balance__sentence">
                    {reading.sentence}
                  </span>
                </span>
              </div>
            );
          })}
        </div>

        <div className="device-balance__explanation">
          <p>
            <strong>How to read it</strong>
            Compare the green spend bar with the blue order bar. A longer green
            bar signals cost pressure; a longer blue bar signals efficiency.
          </p>
          <p className="device-balance__takeaway">{analysis.safeMessage}</p>
        </div>

        {/* The details table lives inside the same panel as the balance bars:
            they answer one question (how each device performs) and splitting
            them into a second bordered card read as two unrelated modules. */}
        <div className="device-detail">
          <div className="device-detail__heading">
            <div>
              <h3 className="device-detail__title">
                Device performance details
              </h3>
              <p className="device-detail__note">
                Exact delivery, cost, and return metrics for each device.
                {comparisonEnabled
                  ? ` Growth is measured against ${comparisonLabel.toLowerCase()}.`
                  : " Period comparison is off."}
              </p>
            </div>
            <span className="device-detail__tag">Google Ads</span>
          </div>

          <div className="table-scroller device-table">
        <table>
          <caption className="visually-hidden">
            Google Ads performance by device for the selected period
          </caption>
          <thead>
            <tr>
              {/* A twelve-column table is unreadable in a screen reader without
                  scope: every cell needs to name its column. */}
              <th scope="col">Device</th>
              <th scope="col">Spend</th>
              <th scope="col">Impressions</th>
              <th scope="col">Clicks</th>
              <th scope="col">CTR</th>
              <th scope="col">CPC</th>
              <th scope="col">Registrations</th>
              <th scope="col">CPA</th>
              <th scope="col">Purchases</th>
              <th scope="col">CPO</th>
              <th scope="col">Purchase value</th>
              <th scope="col">ROAS</th>
            </tr>
          </thead>
          <tbody>
            {analysis.rows.map((row) => (
              <tr key={row.device}>
                <th scope="row">{row.label}</th>
                <td data-label="Spend">
                  <DeviceMetric
                    comparisonEnabled={comparisonEnabled}
                    comparisonLabel={comparisonLabel}
                    comparisonValue={comparisonByDevice.get(row.device)?.spend ?? null}
                    favorableDirection="neutral"
                    format={(value) => currencyFormatter.format(value)}
                    value={row.spend}
                  />
                </td>
                <td data-label="Impressions">
                  <DeviceMetric
                    comparisonEnabled={comparisonEnabled}
                    comparisonLabel={comparisonLabel}
                    comparisonValue={comparisonByDevice.get(row.device)?.impressions ?? null}
                    favorableDirection="neutral"
                    format={(value) => numberFormatter.format(value)}
                    value={row.impressions}
                  />
                </td>
                <td data-label="Clicks">
                  <DeviceMetric
                    comparisonEnabled={comparisonEnabled}
                    comparisonLabel={comparisonLabel}
                    comparisonValue={comparisonByDevice.get(row.device)?.clicks ?? null}
                    favorableDirection="neutral"
                    format={(value) => numberFormatter.format(value)}
                    value={row.clicks}
                  />
                </td>
                <td data-label="CTR">
                  <DeviceMetric
                    comparisonEnabled={comparisonEnabled}
                    comparisonLabel={comparisonLabel}
                    comparisonValue={comparisonByDevice.get(row.device)?.ctr ?? null}
                    favorableDirection="higher"
                    format={percent}
                    value={row.ctr}
                  />
                </td>
                <td data-label="CPC">
                  <DeviceMetric
                    comparisonEnabled={comparisonEnabled}
                    comparisonLabel={comparisonLabel}
                    comparisonValue={comparisonByDevice.get(row.device)?.cpc ?? null}
                    favorableDirection="lower"
                    format={(value) => preciseCurrency.format(value)}
                    value={row.cpc}
                  />
                </td>
                <td data-label="Registrations">
                  <DeviceMetric
                    comparisonEnabled={comparisonEnabled}
                    comparisonLabel={comparisonLabel}
                    comparisonValue={comparisonByDevice.get(row.device)?.registrations ?? null}
                    favorableDirection="higher"
                    format={(value) => numberFormatter.format(value)}
                    value={row.registrations}
                  />
                </td>
                <td data-label="CPA">
                  <DeviceMetric
                    comparisonEnabled={comparisonEnabled}
                    comparisonLabel={comparisonLabel}
                    comparisonValue={
                      comparisonByDevice.get(row.device)?.costPerRegistration ?? null
                    }
                    favorableDirection="lower"
                    format={(value) => currencyFormatter.format(value)}
                    value={row.costPerRegistration}
                  />
                </td>
                <td data-label="Purchases">
                  <DeviceMetric
                    comparisonEnabled={comparisonEnabled}
                    comparisonLabel={comparisonLabel}
                    comparisonValue={comparisonByDevice.get(row.device)?.purchases ?? null}
                    favorableDirection="higher"
                    format={(value) => numberFormatter.format(value)}
                    value={row.purchases}
                  />
                </td>
                <td data-label="CPO">
                  <DeviceMetric
                    comparisonEnabled={comparisonEnabled}
                    comparisonLabel={comparisonLabel}
                    comparisonValue={
                      comparisonByDevice.get(row.device)?.costPerPurchase ?? null
                    }
                    favorableDirection="lower"
                    format={(value) => currencyFormatter.format(value)}
                    value={row.costPerPurchase}
                  />
                </td>
                <td data-label="Purchase value">
                  <DeviceMetric
                    comparisonEnabled={comparisonEnabled}
                    comparisonLabel={comparisonLabel}
                    comparisonValue={
                      comparisonByDevice.get(row.device)?.purchaseValue ?? null
                    }
                    favorableDirection="higher"
                    format={(value) => currencyFormatter.format(value)}
                    value={row.purchaseValue}
                  />
                </td>
                <td data-label="ROAS">
                  <DeviceMetric
                    comparisonEnabled={comparisonEnabled}
                    comparisonLabel={comparisonLabel}
                    comparisonValue={
                      comparisonByDevice.get(row.device)?.returnOnAdSpend ?? null
                    }
                    favorableDirection="higher"
                    format={(value) => `${value.toFixed(2)}×`}
                    value={row.returnOnAdSpend}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        </div>
      </article>
    </section>
  );
}
