"use client";

import { memo, type CSSProperties } from "react";

import { CountUp } from "@/components/dashboard/count-up";
import { MetricHint, metricHintFor } from "@/components/dashboard/metric-hint";
import { getPercentChange } from "@/lib/dashboard/kpi";
import type {
  Currency,
  DashboardSnapshot,
  GuardrailStatus,
  MetricCardData,
} from "@/lib/dashboard/types";

export interface SnapshotCardProps {
  snapshot: DashboardSnapshot;
  currency: Currency;
}

interface SnapshotStat {
  key: string;
  label: string;
  value: number | null;
  previousValue: number | null;
  unit: MetricCardData["unit"];
  favorableDirection: MetricCardData["favorableDirection"];
  status?: GuardrailStatus;
  targetLabel?: string;
  targetValue?: number;
  showTargetGauge?: boolean;
  showComparison?: boolean;
  /** Shown in place of the comparison when the value is modelled, not read. */
  provenanceNote?: string;
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

const numberFormatter = new Intl.NumberFormat("en-GB", {
  maximumFractionDigits: 0,
});

function formatStatValue(
  value: number,
  unit: MetricCardData["unit"],
  currency: Currency,
): string {
  if (unit === "currency") return currencyFormatterFor(currency).format(value);
  if (unit === "ratio") return `${value.toFixed(2)}×`;
  if (unit === "percent") return `${(value * 100).toFixed(1)}%`;
  return numberFormatter.format(value);
}

function statusLabel(status: string): string {
  if (status === "pass") return "PASS";
  if (status === "near") return "NEAR";
  if (status === "breach") return "FAIL";
  return "N/A";
}

function TargetGauge({
  label,
  status,
  target,
  value,
  direction,
}: {
  label: string;
  status: GuardrailStatus;
  target: number;
  value: number;
  direction: SnapshotStat["favorableDirection"];
}) {
  const percent = target <= 0 ? 0 : Math.round((value / target) * 100);
  const style = {
    "--target-progress": `${Math.min(Math.max(percent, 0), 100)}%`,
  } as CSSProperties;

  return (
    <span
      aria-label={`${label} is ${percent}% of its ${direction === "higher" ? "minimum target" : "target limit"}.`}
      className={`snapshot-gauge snapshot-gauge--${status}`}
    >
      <span aria-hidden="true" className="snapshot-gauge__track" style={style} />
      <span className="snapshot-gauge__label">{percent}% of {direction === "higher" ? "target" : "limit"}</span>
    </span>
  );
}

export const SnapshotCard = memo(function SnapshotCard({
  snapshot,
  currency,
}: SnapshotCardProps) {
  const summary = snapshot.snapshotSummary;
  const cardFor = (key: string) =>
    snapshot.cards.find((card) => card.key === key) ?? null;
  const checkFor = (metric: string) =>
    snapshot.guardrail.checks.find((check) => check.metric === metric) ?? null;
  const costCheck = (metric: string, targetUnitLabel: string) => {
    const check = checkFor(metric);
    return check
      ? {
          status: check.status,
          targetLabel: `target ${targetUnitLabel}`,
          targetValue: check.target,
        }
      : {};
  };

  const stats: SnapshotStat[] = [
    {
      key: "spend",
      label: "Spend",
      value: cardFor("spend")?.value ?? null,
      previousValue: cardFor("spend")?.previousValue ?? null,
      unit: "currency",
      favorableDirection: "neutral",
    },
    {
      key: "actualPurchaseRevenue",
      label: "Store revenue",
      value: cardFor("actualPurchaseRevenue")?.value ?? null,
      previousValue: cardFor("actualPurchaseRevenue")?.previousValue ?? null,
      unit: "currency",
      favorableDirection: "higher",
    },
    {
      key: "blendedMer",
      label: "Blended MER",
      // Null in live mode: store net sales are still modelled, not read.
      value: snapshot.blendedMer?.blendedMer ?? null,
      previousValue: null,
      unit: "ratio",
      favorableDirection: "higher",
      showComparison: false,
      // Wherever a value appears, store net sales are modelled, so the figure
      // carries its own marker instead of reading as a measured ratio.
      provenanceNote:
        snapshot.blendedMer?.blendedMer != null ? "Simulated" : undefined,
    },
    {
      key: "actualRevenueRoas",
      label: "Store ROAS",
      value: cardFor("actualRevenueRoas")?.value ?? null,
      previousValue: cardFor("actualRevenueRoas")?.previousValue ?? null,
      unit: "ratio",
      favorableDirection: "higher",
    },
    {
      key: "costPerPurchase",
      label: "CPO",
      value: cardFor("costPerPurchase")?.value ?? null,
      previousValue: cardFor("costPerPurchase")?.previousValue ?? null,
      unit: "currency",
      favorableDirection: "lower",
      ...costCheck(
        "costPerPurchase",
        `≤ ${snapshot.guardrail.targets.costPerOrder} ${currency}`,
      ),
      showTargetGauge: true,
    },
    {
      key: "costPerRegistration",
      label: "CPA",
      value: cardFor("costPerRegistration")?.value ?? null,
      previousValue: cardFor("costPerRegistration")?.previousValue ?? null,
      unit: "currency",
      favorableDirection: "lower",
      ...costCheck(
        "costPerRegistration",
        `≤ ${snapshot.guardrail.targets.costPerAcquisition} ${currency}`,
      ),
      showTargetGauge: true,
    },
    {
      key: "allConversionRate",
      label: "Conv. rate",
      value: snapshot.totals.allConversionRate,
      previousValue: snapshot.comparisonEnabled
        ? snapshot.comparisonTotals.allConversionRate
        : null,
      unit: "percent",
      favorableDirection: "higher",
      showTargetGauge: true,
      ...costCheck(
        "conversionRate",
        `≥ ${(snapshot.guardrail.targets.conversionRate * 100).toFixed(1)}%`,
      ),
    },
    {
      key: "purchases",
      label: "Purchases",
      value: cardFor("purchases")?.value ?? null,
      previousValue: cardFor("purchases")?.previousValue ?? null,
      unit: "count",
      favorableDirection: "higher",
    },
  ];

  return (
    <section
      aria-label="Account snapshot"
      className={`snapshot snapshot--${summary.tone}`}
      id="snapshot"
    >
      <div className="snapshot__verdict">
        <h2>{summary.headline}</h2>
        <p>{summary.supporting}</p>
        <ul className="snapshot__lines">
          <li>{summary.guardrailLine}</li>
          <li>{summary.dataLine}</li>
        </ul>
      </div>
      <dl
        className="snapshot__stats"
        onPointerMove={(event) => {
          const cell = (event.target as HTMLElement).closest<HTMLElement>(
            "dl.snapshot__stats > div",
          );
          if (!cell) return;
          const box = cell.getBoundingClientRect();
          cell.style.setProperty("--spot-x", `${event.clientX - box.left}px`);
          cell.style.setProperty("--spot-y", `${event.clientY - box.top}px`);
        }}
      >
        {stats.map((stat) => {
          const change = getPercentChange(stat.value, stat.previousValue);
          const numericChange = typeof change === "number" ? change : null;
          const isFavorable =
            numericChange !== null &&
            stat.favorableDirection !== "neutral" &&
            (stat.favorableDirection === "higher"
              ? numericChange >= 0
              : numericChange <= 0);

          return (
            <div key={stat.key}>
              <dt>
                <span className="metric-label-inline">
                  {stat.label}
                  {metricHintFor(stat.key) && (
                    <MetricHint
                      label={stat.label}
                      text={metricHintFor(stat.key)!}
                    />
                  )}
                </span>
                {stat.status && (
                  <span className={`target-chip target-chip--${stat.status}`}>
                    {statusLabel(stat.status)}
                  </span>
                )}
              </dt>
              <dd>
                <strong>
                  {stat.value === null ? (
                    "N/A"
                  ) : (
                    <CountUp
                      format={(current) =>
                        formatStatValue(current, stat.unit, currency)
                      }
                      value={stat.value}
                    />
                  )}
                </strong>
                {stat.showComparison !== false && (
                  <span
                    className={
                      numericChange === null
                        ? "delta delta--neutral"
                        : `delta ${
                            stat.favorableDirection === "neutral"
                              ? "delta--neutral"
                              : isFavorable
                                ? "delta--positive"
                                : "delta--negative"
                          }`
                    }
                  >
                    {numericChange === null
                      ? "No comparison"
                      : `${numericChange >= 0 ? "+" : ""}${numericChange.toFixed(1)}%`}
                  </span>
                )}
                {stat.provenanceNote && (
                  <span className="delta delta--neutral delta--provenance">{stat.provenanceNote}</span>
                )}
              </dd>
              {stat.targetLabel && (
                <span className="snapshot__target">{stat.targetLabel}</span>
              )}
              {stat.showTargetGauge &&
                stat.status &&
                stat.targetValue !== undefined &&
                stat.value !== null && (
                  <TargetGauge
                    direction={stat.favorableDirection}
                    label={stat.label}
                    status={stat.status}
                    target={stat.targetValue}
                    value={stat.value}
                  />
                )}
            </div>
          );
        })}
      </dl>
    </section>
  );
});
