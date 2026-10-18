"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { BarList as BarListBase } from "@/components/charts/bar-list";
import {
  ChartTooltip,
  tooltipToneForTrend,
  type TooltipState,
} from "@/components/charts/chart-tooltip";
import { DonutChart as DonutChartBase } from "@/components/charts/donut-chart";
import { LineChart } from "@/components/charts/line-chart";
import { smoothLinePath } from "@/components/charts/smooth-line";
import { StackedBarChart } from "@/components/charts/stacked-bar-chart";
import {
  AccountField,
  rememberAccount,
} from "@/components/dashboard/filter-fields";
import { AccountSyncTime } from "@/components/dashboard/clocks";
import { useUtilityBarHeight, useResponsiveTables } from "@/components/dashboard/app-frame";
import {
  ChevronIcon,
  DownloadIcon,
  LightbulbIcon,
  MenuIcon,
  RefreshIcon,
  SearchIcon,
} from "@/components/dashboard/icons";
import {
  MetricHint,
  metricHintFor,
} from "@/components/dashboard/metric-hint";
import {
  PeriodPicker,
  type PeriodSelection,
} from "@/components/dashboard/period-picker";
import { DashboardSidebar } from "@/components/dashboard/sidebar-nav";
import { ThemeToggle } from "@/components/dashboard/theme-toggle";
import { useCondensedOnScroll } from "@/components/dashboard/use-condensed-on-scroll";
import { hasPermission } from "@/lib/auth/authorization";
import type { AccountOption } from "@/lib/dashboard/accounts";
import { DATA_MODE_COOKIE } from "@/lib/dashboard/validation";
import { latestSyncTimestamp } from "@/lib/dashboard/sync-status";
import type { DashboardViewer } from "@/lib/auth/types";
import { audienceExportFilename } from "@/lib/dashboard/audience-export-request";
import {
  buildAudienceExportCsv,
  csvCell,
  toAudienceRecords,
} from "@/lib/dashboard/audience-exporter";
import { getPercentChange } from "@/lib/dashboard/kpi";
import type { ComparisonWindow } from "@/lib/dashboard/search-terms";
import type {
  Currency,
  DashboardDataMode,
  DateRange,
} from "@/lib/dashboard/types";
import {
  CATALOGUE_TOP_COUNT,
  catalogueRowsForDisplay,
  cohortHeatLevel,
} from "@/lib/store/analytics";
import type {
  BreakdownRow,
  CatalogueBreakdown,
  CatalogueLevel,
  CatalogueNode,
  CatalogueStack,
  ChannelPerformanceRow,
  CohortRow,
  CustomerRfmRow,
  FunnelStep,
  RfmAnalysis,
  RfmMetricKey,
  RfmSegmentKey,
  RfmSegmentRow,
  ShareRow,
  StoreAnalyticsPayload,
  StoreAnalyticsSnapshot,
  StoreKpi,
  StoreModeStatus,
  TimeSeries,
  YearlyComparisonSeries,
  YearlyPerformance,
} from "@/lib/store/types";
import { BrandMark } from "@/components/dashboard/brand-mark";

/** Everything the store analytics API needs to rebuild a snapshot. */
interface StoreQuery {
  range: DateRange;
  account: string;
  mode: DashboardDataMode;
  comparisonEnabled: boolean;
  comparisonWindow: ComparisonWindow;
  comparisonRange: DateRange | null;
}

interface StoreAnalyticsShellProps {
  initialSnapshot: StoreAnalyticsSnapshot;
  /**
   * Server's view of the data mode. Required, because it also seeds the toggle:
   * an optional prop would mean a silent default that the server never chose.
   */
  initialModeStatus: StoreModeStatus;
  viewer: DashboardViewer;
  accounts: AccountOption[];
  selectedAccount: string;
  referenceDates: Record<string, string>;
}

interface StoreModeBadge {
  label: string;
  className: string;
  title: string;
}

/**
 * Remembers the chosen data mode in a first-party cookie, the same way the
 * brand selector remembers the account.
 *
 * A cookie rather than localStorage, because the server resolves the mode
 * before it renders. localStorage is invisible to the server, so it could only
 * be applied by correcting the page after mount — which React reports as a
 * hydration mismatch, and which leaves a window where the badge names one
 * dataset while the snapshot on screen is the other. It holds one of two
 * public words and no reader data.
 */
function rememberDataMode(isDummy: boolean) {
  try {
    document.cookie = `${DATA_MODE_COOKIE}=${isDummy ? "mock" : "live"}; path=/; max-age=${
      60 * 60 * 24 * 180
    }; samesite=lax`;
  } catch {
    // Site data blocked. The deployment default stands on the next load.
  }
}

/**
 * What the hero badge says about the data on screen.
 *
 * Three states, not two. The live path fails soft by design — an unreachable
 * database, zero stored rows, partial day coverage or an unexpected provisional
 * day all return synthetic figures without an error, while the toggle stays on
 * Live. Driving this badge from the toggle alone would make it claim "Live
 * traffic" at precisely the moment the traffic is entirely invented, so the
 * live label is gated on `liveTrafficApplied` rather than on the mode.
 *
 * Store and customer records are fixtures in every state. The live label says
 * so out loud rather than letting "Live" be read as covering the whole page.
 */
function describeModeBadge(
  isDummyMode: boolean,
  modeStatus: StoreModeStatus | undefined,
): StoreModeBadge {
  if (isDummyMode) {
    return {
      label: "Simulated dummy data",
      className: "mode-badge mode-badge--dummy",
      title:
        "Every figure on this page is generated from store-shaped fixtures. No live store, traffic or customer data is connected.",
    };
  }

  if (modeStatus?.liveTrafficApplied) {
    return {
      label: "Live traffic · Store fixtures",
      className: "mode-badge mode-badge--live",
      title:
        "Live GA4 traffic applied; store and customer records are synthetic fixtures.",
    };
  }

  return {
    label: "Store fixtures",
    className: "mode-badge mode-badge--dummy",
    title:
      modeStatus?.reason ??
      "Live mode is selected, but no live traffic has been applied yet, so these figures are synthetic.",
  };
}

const currencyFormatters = new Map<string, Intl.NumberFormat>();

function currencyFormatterFor(currency: Currency, compact = false) {
  const key = `${compact ? "compact" : "full"}:${currency}`;
  const cached = currencyFormatters.get(key);
  if (cached) return cached;

  const formatter = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    ...(compact
      ? { notation: "compact" as const, maximumFractionDigits: 1 }
      : { maximumFractionDigits: 0 }),
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

const monthFormatter = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  year: "numeric",
});

function formatDate(value: string) {
  return dateFormatter.format(new Date(`${value}T12:00:00Z`));
}

function formatValue(
  value: number | null,
  unit: "currency" | "count" | "percent",
  currency: Currency,
  compact = false,
) {
  if (value === null) return "N/A";
  if (unit === "currency") return currencyFormatterFor(currency, compact).format(value);
  if (unit === "percent") return `${(value * 100).toFixed(1)}%`;
  return numberFormatter.format(value);
}

/**
 * The applied comparison turned into reader-facing copy once, so every panel
 * names the same baseline instead of hard-coding "previous period".
 */
interface ComparisonView {
  enabled: boolean;
  /** "Previous period", "Same period last year", or "No comparison". */
  label: string;
  /** Caption beside a delta badge, e.g. "vs same period last year". */
  caption: string;
  /** Why a time series carries no day-by-day baseline line. */
  seriesCaveat: string;
}

function describeComparison(snapshot: StoreAnalyticsSnapshot): ComparisonView {
  const basis = snapshot.comparisonBasis;

  if (!snapshot.comparisonEnabled) {
    return {
      enabled: false,
      label: "No comparison",
      caption: "compare is off",
      seriesCaveat:
        "Compare is switched off, so this period is charted on its own. Turn compare on in the reporting period to add a baseline.",
    };
  }

  return {
    enabled: true,
    label: basis.label,
    caption: `vs ${basis.label.toLowerCase()}`,
    seriesCaveat: `The ${basis.label.toLowerCase()} baseline covers ${basis.comparisonDays} days against ${basis.activeDays} in the active period, so the days cannot be paired one to one. Baseline totals elsewhere are scaled to ${basis.activeDays} days.`,
  };
}

function DeltaBadge({
  value,
  previousValue,
  favorableDirection = "higher",
}: {
  value: number | null;
  previousValue: number | null;
  favorableDirection?: "higher" | "lower" | "neutral";
}) {
  const change = getPercentChange(value, previousValue);
  const numericChange = typeof change === "number" ? change : null;
  const isFavorable =
    numericChange !== null &&
    favorableDirection !== "neutral" &&
    (favorableDirection === "higher" ? numericChange >= 0 : numericChange <= 0);
  const label =
    change === "new"
      ? "New"
      : change === "no-change"
        ? "No change"
        : numericChange === null
          ? "No comparison"
          : `${numericChange >= 0 ? "+" : ""}${numericChange.toFixed(1)}%`;

  return (
    <span
      className={`delta ${
        favorableDirection === "neutral" || numericChange === null
          ? "delta--neutral"
          : isFavorable
            ? "delta--positive"
            : "delta--negative"
      }`}
    >
      {label}
    </span>
  );
}

function KpiCard({
  kpi,
  currency,
  comparisonCaption,
  series,
}: {
  kpi: StoreKpi;
  currency: Currency;
  comparisonCaption: string;
  series?: TimeSeries;
}) {
  const hint = metricHintFor(kpi.key);

  return (
    <article className="metric-card">
      <div className="metric-card__label">
        <span className="metric-label-inline">
          {kpi.label}
          {hint && <MetricHint label={kpi.label} text={hint} />}
        </span>
      </div>
      <div className="metric-card__value">
        {formatValue(kpi.value, kpi.unit, currency)}
      </div>
      {series && <MicroSparkline label={kpi.label} series={series} />}
      <div className="metric-card__comparison">
        <DeltaBadge
          favorableDirection={kpi.favorableDirection}
          previousValue={kpi.previousValue}
          value={kpi.value}
        />
        <span>{comparisonCaption}</span>
      </div>
    </article>
  );
}

function MicroSparkline({ label, series }: { label: string; series: TimeSeries }) {
  const width = 112;
  const height = 30;
  const padding = 2;
  const values = series.points.map((point) => point.value);

  if (values.length < 2) return null;

  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = maximum - minimum;
  const step = (width - padding * 2) / Math.max(values.length - 1, 1);
  const points = values.map((value, index) => ({
    x: padding + index * step,
    y:
      range === 0
        ? height / 2
        : height - padding - ((value - minimum) / range) * (height - padding * 2),
  }));
  const lastPoint = points.at(-1);

  return (
    <svg
      aria-label={`${label} daily movement across ${values.length} days`}
      className={`metric-sparkline metric-sparkline--store-${series.key}`}
      role="img"
      viewBox={`0 0 ${width} ${height}`}
    >
      <title>{`${label} daily movement`}</title>
      <path
        className="metric-sparkline__line"
        d={smoothLinePath(points, 0)}
        fill="none"
      />
      {lastPoint && (
        <circle
          className="metric-sparkline__end"
          cx={lastPoint.x}
          cy={lastPoint.y}
          r="2.5"
        />
      )}
    </svg>
  );
}

function SeriesChart({
  series,
  currency,
  comparison,
}: {
  series: TimeSeries;
  currency: Currency;
  comparison: ComparisonView;
}) {
  // The baseline line is only drawn when the builder paired the two periods
  // day by day. Against a longer lookback it stays out and the caveat below
  // says so, rather than implying dates that were never lined up.
  const hasBaselineLine = series.points.some(
    (point) => point.comparisonValue !== null,
  );

  return (
    <>
      <LineChart
        ariaLabel={
          hasBaselineLine
            ? `${series.label}, with ${comparison.label.toLowerCase()} baseline`
            : series.label
        }
        formatValue={(value) => formatValue(value, series.unit, currency)}
        formatLabel={(label) => formatDate(label)}
        labels={series.points.map((point) => point.date)}
        series={[
          {
            key: "current",
            label: "Active period",
            variant: "meta",
            values: series.points.map((point) => point.value),
          },
          ...(hasBaselineLine
            ? [
                {
                  key: "comparison",
                  label: comparison.label,
                  variant: "google",
                  depth: "context" as const,
                  values: series.points.map((point) => point.comparisonValue),
                },
              ]
            : []),
        ]}
        footerLeft={series.points[0]?.date.slice(5) ?? "—"}
        footerRight={series.points.at(-1)?.date.slice(5) ?? "—"}
      />
      {!hasBaselineLine && (
        <details className="card-notes">
          <summary>Comparison availability</summary>
          <p>{comparison.seriesCaveat}</p>
        </details>
      )}
    </>
  );
}

function ShareBarList({
  rows,
  currency,
  unit,
  comparison,
}: {
  rows: ShareRow[];
  currency: Currency;
  unit: "currency" | "count";
  comparison: ComparisonView;
}) {
  return (
    <BarListBase
      scale="share"
      showShare
      comparisonLabel={comparison.label}
      formatChange={(value, previousValue) => {
        const change = getPercentChange(value, previousValue);
        if (change === "new") return "New";
        if (change === "no-change") return "No change";
        if (typeof change !== "number") return "No comparison";
        return `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`;
      }}
      formatValue={(value) => formatValue(value, unit, currency)}
      rows={rows}
    />
  );
}

function ShareDonut({
  rows,
  currency,
  unit,
  label,
  comparison,
}: {
  rows: ShareRow[];
  currency: Currency;
  unit: "currency" | "count";
  label: string;
  comparison: ComparisonView;
}) {
  return (
    <DonutChartBase
      ariaLabel={label}
      comparisonLabel={comparison.label}
      formatChange={(value, previousValue) => {
        const change = getPercentChange(value, previousValue);
        if (change === "new") return "New";
        if (change === "no-change") return "No change";
        if (typeof change !== "number") return "No comparison";
        return `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`;
      }}
      formatValue={(value) => formatValue(value, unit, currency)}
      slices={rows.map((row) => ({
        key: row.key,
        label: row.label,
        value: row.value,
        // A withheld baseline drops the row from the tooltip; passing zero
        // would read as a real previous period of nothing.
        previousValue: row.previousValue ?? undefined,
      }))}
    />
  );
}

function BreakdownList({
  rows,
  currency,
}: {
  rows: BreakdownRow[];
  currency: Currency;
}) {
  return (
    <dl className="health-list">
      {rows.map((row) => (
        <div className={row.isTotal ? "breakdown-row--total" : undefined} key={row.key}>
          <dt>
            <span className="metric-label-inline">
              {row.label}
              {metricHintFor(row.key) && (
                <MetricHint label={row.label} text={metricHintFor(row.key)!} />
              )}
            </span>
          </dt>
          <dd>
            {row.isDeduction && row.value > 0 ? "−" : ""}
            {formatValue(row.value, "currency", currency)}
            <DeltaBadge
              favorableDirection={row.isDeduction ? "lower" : "higher"}
              previousValue={row.previousValue}
              value={row.value}
            />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function FunnelList({
  steps,
  currency,
  showValue,
  variant,
}: {
  steps: FunnelStep[];
  currency: Currency;
  showValue: boolean;
  variant: "conversion" | "value";
}) {
  const worstDropIndex = steps.reduce((worstIndex, step, index) => {
    if (step.rateFromPreviousStep === null) return worstIndex;
    if (worstIndex === -1) return index;
    const worstRate = steps[worstIndex]?.rateFromPreviousStep ?? 1;
    return step.rateFromPreviousStep < worstRate ? index : worstIndex;
  }, -1);
  const entryStep = steps[0] ?? null;
  const completedStep = steps.at(-1) ?? null;
  const capturedValueRate =
    entryStep?.salesValue !== null &&
    entryStep?.salesValue !== undefined &&
    entryStep.salesValue > 0 &&
    completedStep?.salesValue !== null &&
    completedStep?.salesValue !== undefined
      ? completedStep.salesValue / entryStep.salesValue
      : null;

  const stageHint = (step: FunnelStep) => {
    switch (step.key) {
      case "sessions":
        return "All recorded store visits that entered this funnel during the selected period.";
      case "addedToCart":
        return "Store sessions in which at least one product was added to the basket.";
      case "reachedCheckout":
        return "Store sessions that progressed from the basket into the checkout journey.";
      case "completedCheckout":
        // Session analytics and order records are separate sources, so this
        // count is not the order count and must not claim to be.
        return "Store sessions that finished checkout in site analytics. Orders are counted from order records and can differ.";
      default:
        return `Store sessions that reached ${step.label.toLowerCase()} during the selected period.`;
    }
  };

  const stageSessionLabel = (step: FunnelStep) =>
    step.key === "sessions"
      ? "funnel-entry sessions"
      : `${step.label.toLowerCase()} sessions`;

  const stageProgressionTarget = (step: FunnelStep) => {
    switch (step.key) {
      case "addedToCart":
        return "the add-to-cart stage";
      case "reachedCheckout":
        return "checkout";
      case "completedCheckout":
        return "completed checkout";
      default:
        return `the ${step.label.toLowerCase()} stage`;
    }
  };

  const summaryMetrics = showValue
    ? [
        {
          key: "entry-value",
          label: "Entry value",
          value:
            entryStep?.salesValue === null || entryStep?.salesValue === undefined
              ? "—"
              : formatValue(entryStep.salesValue, "currency", currency, true),
          hint: "Directional value represented by all sessions entering the funnel, estimated with the active-period average order value.",
        },
        {
          key: "realised-value",
          label: "Realised",
          value:
            completedStep?.salesValue === null ||
            completedStep?.salesValue === undefined
              ? "—"
              : formatValue(
                  completedStep.salesValue,
                  "currency",
                  currency,
                  true,
                ),
          hint: "Actual store sales attached to completed checkout, not a projection from earlier funnel stages.",
        },
        {
          key: "captured-value",
          label: "Captured",
          value:
            capturedValueRate === null
              ? "—"
              : `${(capturedValueRate * 100).toFixed(1)}%`,
          hint: "Realised checkout sales divided by the directional value represented at funnel entry.",
        },
      ]
    : [
        {
          key: "entry-sessions",
          label: "Entry",
          value: numberFormatter.format(entryStep?.sessions ?? 0),
          hint: "All sessions that entered the store funnel in the selected period.",
        },
        {
          key: "completed-sessions",
          label: "Completed",
          value: numberFormatter.format(completedStep?.sessions ?? 0),
          hint: "Sessions that finished checkout in site analytics. Orders are counted from order records and can differ.",
        },
        {
          key: "overall-conversion",
          label: "Conversion",
          value: `${((completedStep?.rateFromEntry ?? 0) * 100).toFixed(1)}%`,
          hint: "Completed checkout sessions divided by all sessions that entered the funnel.",
        },
      ];

  return (
    <div className={`funnel-card-body funnel-card-body--${variant}`}>
      <dl className="funnel-summary" aria-label="Funnel summary">
        {summaryMetrics.map((metric) => (
          <div key={metric.key}>
            <dt>
              <span className="metric-label-inline">
                {metric.label}
                <MetricHint label={metric.label} text={metric.hint} />
              </span>
            </dt>
            <dd>{metric.value}</dd>
          </div>
        ))}
      </dl>

      <ol className="funnel">
        {steps.map((step, index) => {
          const nextStep = steps[index + 1] ?? null;
          const nextPassRate = nextStep?.rateFromPreviousStep ?? null;
          const isWorstDrop = nextStep !== null && index + 1 === worstDropIndex;
          const stageValueIsRealised = index === steps.length - 1;

          return (
            <li className="funnel__stage" key={step.key}>
              <div className="funnel__stage-row">
                <div className="funnel__stage-identity">
                  <span aria-hidden="true" className="funnel__stage-index">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="metric-label-inline funnel__stage-label">
                    {step.label}
                    <MetricHint label={step.label} text={stageHint(step)} />
                  </span>
                </div>

                <div className="funnel__metrics">
                  <span className="funnel__metric">
                    <small className="metric-label-inline">
                      Reached
                      <MetricHint
                        label={`${step.label} count`}
                        text={`The number of ${stageSessionLabel(step)} in the selected period.`}
                      />
                    </small>
                    <strong>{numberFormatter.format(step.sessions)}</strong>
                  </span>
                  <span className="funnel__metric">
                    <small className="metric-label-inline">
                      Of entry
                      <MetricHint
                        label={`${step.label} share of entry`}
                        text={
                          step.key === "sessions"
                            ? "All recorded sessions enter the funnel at this stage, so the share is always 100%."
                            : `The share of all funnel-entry sessions that reached ${step.label.toLowerCase()}.`
                        }
                      />
                    </small>
                    <strong>{(step.rateFromEntry * 100).toFixed(1)}%</strong>
                  </span>
                  {showValue && step.salesValue !== null && (
                    <span className="funnel__metric">
                      <small className="metric-label-inline">
                        {stageValueIsRealised ? "Sales" : "Value in play"}
                        <MetricHint
                          label={`${step.label} value`}
                          text={
                            stageValueIsRealised
                              ? "Realised store sales from completed checkout in this period."
                              : "Directional value at this stage, estimated as sessions reaching the stage multiplied by active-period average order value."
                          }
                        />
                      </small>
                      <strong>
                        {formatValue(step.salesValue, "currency", currency, true)}
                      </strong>
                    </span>
                  )}
                  <span className="funnel__metric funnel__metric--delta">
                    <small className="metric-label-inline">
                      Change
                      <MetricHint
                        label={`${step.label} comparison`}
                        text="Percent change in the stage count versus the selected comparison period. When comparison is off, no movement is claimed."
                      />
                    </small>
                    <DeltaBadge
                      previousValue={step.previousSessions}
                      value={step.sessions}
                    />
                  </span>
                </div>
              </div>

              <div
                aria-label={`${step.label}: ${(step.rateFromEntry * 100).toFixed(1)}% of funnel entry`}
                className="funnel__track"
                role="img"
              >
                <span
                  className="funnel__fill"
                  style={{ width: `${Math.max(step.rateFromEntry * 100, 2)}%` }}
                />
              </div>

              {nextPassRate !== null && nextStep && (
                <div
                  className={`funnel__transition${
                    isWorstDrop ? " funnel__transition--warning" : ""
                  }`}
                >
                  <span className="funnel__transition-line" aria-hidden="true" />
                  <span className="funnel__transition-chip funnel__transition-chip--pass">
                    Pass {(nextPassRate * 100).toFixed(1)}%
                    <MetricHint
                      label={`${step.label} pass rate`}
                      text={`The share of ${stageSessionLabel(step)} that progressed to ${stageProgressionTarget(nextStep)}.`}
                    />
                  </span>
                  <span className="funnel__transition-chip funnel__transition-chip--drop">
                    Drop {((1 - nextPassRate) * 100).toFixed(1)}%
                    <MetricHint
                      label={`${step.label} drop-off rate`}
                      text={`The share of ${stageSessionLabel(step)} that did not progress to ${stageProgressionTarget(nextStep)}.`}
                    />
                  </span>
                  {isWorstDrop && (
                    <strong>
                      Largest leak
                      <MetricHint
                        label="Largest funnel leak"
                        text="This transition has the highest drop-off rate in the current funnel and is the first place to investigate for friction."
                      />
                    </strong>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

type FulfillmentStage = "paid" | "packing" | "dispatched" | "cancelled";

function OrderFulfillmentRail({ kpis }: { kpis: StoreKpi[] }) {
  const [activeStage, setActiveStage] = useState<FulfillmentStage>("packing");
  const count = (key: StoreKpi["key"]) =>
    Math.round(kpis.find((item) => item.key === key)?.value ?? 0);
  const stages: {
    key: FulfillmentStage;
    icon: string;
    label: string;
    count: number;
    detail: string;
    tone: "neutral" | "warning" | "positive" | "negative";
  }[] = [
    {
      key: "paid",
      icon: "📦",
      label: "Paid orders",
      count: count("orders"),
      detail: "All orders placed in the selected period before fulfilment state.",
      tone: "neutral",
    },
    {
      key: "packing",
      icon: "⏳",
      label: "Packing / in warehouse",
      count: count("ordersAwaitingDispatch"),
      detail: "Paid orders currently moving through warehouse and packing states.",
      tone: "warning",
    },
    {
      key: "dispatched",
      icon: "🚚",
      label: "Dispatched",
      count: count("ordersDispatched"),
      detail: "Orders that have left the warehouse in this lifecycle snapshot.",
      tone: "positive",
    },
    {
      key: "cancelled",
      icon: "✕",
      label: "Cancelled",
      count: count("cancelledOrders"),
      detail: "Cancelled orders remain part of placed orders but carry a failed outcome.",
      tone: "negative",
    },
  ];
  const active = stages.find((stage) => stage.key === activeStage) ?? stages[0]!;

  return (
    <article aria-label="Order fulfilment lifecycle" className="order-rail">
      <div className="order-rail__heading">
        <span className="eyebrow">Fulfilment flow</span>
        <strong>{numberFormatter.format(count("orders"))} orders tracked</strong>
      </div>
      <div className="order-rail__track">
        {stages.map((stage, index) => (
          <div className="order-rail__step-wrap" key={stage.key}>
            {index > 0 && stage.key !== "cancelled" && (
              <span aria-hidden="true" className="order-rail__arrow">→</span>
            )}
            <button
              aria-pressed={activeStage === stage.key}
              className="order-rail__step"
              data-tone={stage.tone}
              onClick={() => setActiveStage(stage.key)}
              type="button"
            >
              <span aria-hidden="true" className="order-rail__icon">{stage.icon}</span>
              <span>
                <strong>{numberFormatter.format(stage.count)}</strong>
                <small>{stage.label}</small>
              </span>
            </button>
          </div>
        ))}
      </div>
      <p aria-live="polite" className="order-rail__detail">
        <strong>{active.label}:</strong> {active.detail}
      </p>
    </article>
  );
}

function UnitEconomicsCard({
  unitEconomics,
  currency,
}: {
  unitEconomics: StoreAnalyticsSnapshot["unitEconomics"];
  currency: Currency;
}) {
  return (
    <article className="unit-economics-card">
      <div className="unit-economics-card__heading">
        <span className="eyebrow">Unit economics</span>
        <MetricHint
          label="LTV to CAC ratio"
          text="Trailing-12-month average customer value from the RFM population divided by paid-ads cost per store order for the same period, taken from the Paid ads page. Both values are simulated until the store connection is live."
        />
      </div>
      <strong className="unit-economics-card__ratio">
        {unitEconomics.ltvToCacRatio === null
          ? "N/A"
          : `${unitEconomics.ltvToCacRatio.toFixed(1)}×`}
      </strong>
      <span className="unit-economics-card__formula">
        {formatValue(
          unitEconomics.averageCustomerLifetimeValue,
          "currency",
          currency,
        )}{" "}
        LTV <b>:</b>{" "}
        {formatValue(unitEconomics.estimatedBlendedCac, "currency", currency)} CAC
      </span>
      <small>12-month customer value ÷ paid-ads cost per store order · simulated</small>
    </article>
  );
}

type ChannelMetricKey =
  | "sessions"
  | "orders"
  | "conversionRate"
  | "totalSales"
  | "averageOrderValue";

const CHANNEL_METRICS: {
  key: ChannelMetricKey;
  label: string;
  unit: "currency" | "count" | "percent";
}[] = [
  { key: "totalSales", label: "Total sales", unit: "currency" },
  { key: "sessions", label: "Sessions", unit: "count" },
  { key: "orders", label: "Orders", unit: "count" },
  { key: "conversionRate", label: "Conv. rate", unit: "percent" },
  { key: "averageOrderValue", label: "AOV", unit: "currency" },
];

/**
 * One chart for referring-channel performance. All five metrics stay
 * visible per row; the sort menu only changes which one orders the
 * channels, so nothing has to be swapped out to compare the rest.
 */
function ChannelPerformancePanel({
  rows,
  currency,
}: {
  rows: ChannelPerformanceRow[];
  currency: Currency;
}) {
  const [sortKey, setSortKey] = useState<ChannelMetricKey>("totalSales");
  const sortedRows = [...rows].sort(
    (left, right) => (right[sortKey] ?? -1) - (left[sortKey] ?? -1),
  );

  return (
    <article className="panel">
      <div className="panel__heading">
        <div>
          <span className="eyebrow">Referrers</span>
          <h2>Performance by referring channel</h2>
        </div>
        <label className="field channel-performance__sort">
          <span>Sort by</span>
          <span className="select-wrap">
            <select
              onChange={(event) =>
                setSortKey(event.target.value as ChannelMetricKey)
              }
              value={sortKey}
            >
              {CHANNEL_METRICS.map((metric) => (
                <option key={metric.key} value={metric.key}>
                  {metric.label}
                </option>
              ))}
            </select>
            <ChevronIcon />
          </span>
        </label>
      </div>
      <div className="table-scroller">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Channel</th>
              {CHANNEL_METRICS.map((metric) => (
                <th
                  aria-sort={metric.key === sortKey ? "descending" : "none"}
                  className={
                    metric.key === sortKey
                      ? "data-table__sorted-column"
                      : undefined
                  }
                  key={metric.key}
                  scope="col"
                >
                  <span className="metric-label-inline">
                    {metric.label}
                    {metricHintFor(metric.key) && (
                      <MetricHint
                        label={metric.label}
                        text={metricHintFor(metric.key)!}
                      />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr key={row.channel}>
                <th scope="row">{row.channel}</th>
                {CHANNEL_METRICS.map((metric) => (
                  <td
                    className={
                      metric.key === sortKey
                        ? "data-table__sorted-column"
                        : undefined
                    }
                    key={metric.key}
                  >
                    {formatValue(row[metric.key], metric.unit, currency)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

const RFM_METRICS: {
  key: RfmMetricKey;
  unit: "currency" | "count" | "percent";
}[] = [
  { key: "customerShare", unit: "percent" },
  { key: "customerCount", unit: "count" },
  { key: "averageRecencyDays", unit: "count" },
  { key: "totalOrders", unit: "count" },
  { key: "totalSpent", unit: "currency" },
];

function formatRfmValue(
  row: Pick<RfmSegmentRow, RfmMetricKey>,
  metric: RfmMetricKey,
  currency: Currency,
) {
  if (metric === "customerShare") {
    return `${(row.customerShare * 100).toFixed(2).replace(/\.00$/, "")}%`;
  }
  if (metric === "totalSpent") {
    return currencyFormatterFor(currency).format(row.totalSpent);
  }
  if (metric === "averageRecencyDays") {
    return `${numberFormatter.format(row.averageRecencyDays)} days`;
  }
  return numberFormatter.format(row[metric]);
}



type SortDirection = "asc" | "desc";

/**
 * CSV escaping now comes from the audience exporter, which also neutralises
 * spreadsheet formula injection. Customer names, company names and category
 * labels are third-party text, and a leading = or @ runs as a formula the
 * moment the file is opened in Excel or Sheets.
 */

/**
 * Exports exactly what the reader is looking at: the same filtered segments,
 * in the same sort order, as the table on screen.
 */
function downloadRfmCsv(
  rows: RfmSegmentRow[],
  summary: ReturnType<typeof summariseRfmRows>,
  fieldLabels: RfmAnalysis["fieldLabels"],
  currency: Currency,
  asOfDate: string,
) {
  const header = [
    fieldLabels.segment,
    fieldLabels.customerShare,
    fieldLabels.customerCount,
    fieldLabels.averageRecencyDays,
    fieldLabels.totalOrders,
    fieldLabels.totalSpent,
  ];
  const rowToCells = (row: Pick<RfmSegmentRow, RfmMetricKey> & { label: string }) => [
    row.label,
    formatRfmValue(row, "customerShare", currency),
    formatRfmValue(row, "customerCount", currency),
    formatRfmValue(row, "averageRecencyDays", currency),
    formatRfmValue(row, "totalOrders", currency),
    formatRfmValue(row, "totalSpent", currency),
  ];

  const lines = [
    header,
    rowToCells({ ...summary, label: "Summary" }),
    ...rows.map((row) => rowToCells(row)),
  ]
    .map((cells) => cells.map(csvCell).join(","))
    .join("\r\n");

  const blob = new Blob([lines], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `rfm-segments-${asOfDate}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Revoking in the same tick as click() races the download start in some
  // browsers and can silently cancel it, so the URL outlives this call.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function summariseRfmRows(rows: RfmSegmentRow[]) {
  const customerCount = rows.reduce((total, row) => total + row.customerCount, 0);
  const weightedRecency = rows.reduce(
    (total, row) => total + row.averageRecencyDays * row.customerCount,
    0,
  );

  return {
    customerShare: rows.reduce((total, row) => total + row.customerShare, 0),
    customerCount,
    averageRecencyDays:
      customerCount === 0 ? 0 : Math.round(weightedRecency / customerCount),
    totalOrders: rows.reduce((total, row) => total + row.totalOrders, 0),
    totalSpent: rows.reduce((total, row) => total + row.totalSpent, 0),
  };
}

const RFM_PLAYBOOKS: Record<
  RfmSegmentKey,
  {
    title: string;
    objective: string;
    action: string;
    badgeTone: "success" | "info" | "warning" | "danger" | "purple";
  }
> = {
  champions: {
    title: "Champions (VIP)",
    objective: "Reward loyalty & maximize Lifetime Value",
    action:
      "Berikan VIP Early Access untuk peluncuran katalog baru, exclusive loyalty perks, dan ajak menjadi brand advocates.",
    badgeTone: "success",
  },
  loyal: {
    title: "Loyal Customers",
    objective: "Upsell & Increase Order Frequency",
    action:
      "Tawarkan program bundles, rekomendasi produk bernilai lebih tinggi (upsell), dan mintai review/ulasan produk.",
    badgeTone: "success",
  },
  active: {
    title: "Active Customers",
    objective: "Maintain engagement & cross-sell",
    action:
      "Kirim newsletter kurasi produk terpopuler dan rekomendasi cross-category berdasarkan departemen favorit mereka.",
    badgeTone: "info",
  },
  promising: {
    title: "Promising Buyers",
    objective: "Convert into repeat buyers",
    action:
      "Kirim penawaran voucher follow-up pembelian ke-2 atau ke-3 dalam 14 hari untuk membangun kebiasaan belanja.",
    badgeTone: "info",
  },
  new: {
    title: "New Customers",
    objective: "Welcome & onboarding engagement",
    action:
      "Kirimkan welcome onboarding sequence dengan panduan pemakaian produk, diskon order berikutnya, dan dukungan purna jual.",
    badgeTone: "purple",
  },
  needsAttention: {
    title: "Needs Attention",
    objective: "Reactivate before slipping away",
    action:
      "Kirim limited-time personalized incentive untuk produk yang relevan dengan riwayat transaksi sebelumnya.",
    badgeTone: "warning",
  },
  atRisk: {
    title: "At Risk (High Value Churn)",
    objective: "Urgent Win-Back Campaign",
    action:
      "Targetkan via Meta/Google Retargeting Ads dan Win-Back email dengan diskon khusus sebelum mereka beralih ke kompetitor.",
    badgeTone: "danger",
  },
  almostLost: {
    title: "Almost Lost",
    objective: "Aggressive Win-Back or Survey",
    action:
      "Kirimkan email survei feedback 'Kami Rindu Anda' dengan penawaran menarik atau clearance deal.",
    badgeTone: "danger",
  },
  previouslyLoyal: {
    title: "Previously Loyal (Lapsed VIP)",
    objective: "High-Priority VIP Win-Back",
    action:
      "Hubungi secara personal atau kirim penawaran eksklusif 'Welcome Back VIP' dengan produk rilisan terbaru.",
    badgeTone: "warning",
  },
  dormant: {
    title: "Dormant / Inactive",
    objective: "Low-cost re-engagement or Audience Exclusion",
    action:
      "Kirim clearance/final reactivation campaign. Jika tidak merespons, exclude dari paid ad audience untuk hemat ad spend.",
    badgeTone: "purple",
  },
};

type CustomerCsvPreset = "meta" | "google" | "full";

/** Platform presets the shared exporter owns. */
const PLATFORM_EXPORT_PRESETS = {
  meta: "meta-value-based",
  google: "google-customer-match",
} as const;

function downloadCustomerCsv(
  customers: CustomerRfmRow[],
  selectedSegments: RfmSegmentKey[],
  currency: Currency,
  asOfDate: string,
  preset: CustomerCsvPreset,
  dataMode: "live" | "dummy",
  accountSlug: string,
) {
  // The two platform files are built by `audience-exporter`, which normalises
  // identifiers, maps the ten RFM labels onto the four cohort names the upload
  // template expects, drops rows nothing can match on, and neutralises
  // spreadsheet formula injection. Keeping a second copy of that logic here is
  // how the two versions drift apart.
  if (preset === "meta" || preset === "google") {
    const result = buildAudienceExportCsv(toAudienceRecords(customers), {
      preset: PLATFORM_EXPORT_PRESETS[preset],
      currency,
    });
    downloadCsvBlob(
      result.csv,
      audienceExportFilename(
        { preset: PLATFORM_EXPORT_PRESETS[preset] },
        accountSlug,
        asOfDate,
        dataMode,
      ),
    );
    return;
  }

  const definitions: Record<
    "full",
    {
      filePrefix: string;
      header: string[];
      row: (customer: CustomerRfmRow) => (string | number)[];
    }
  > = {
    full: {
      filePrefix: "full-customer-analytics",
      header: [
        "Customer ID",
        "First Name",
        "Last Name",
        "Customer Name",
        "Company Name",
        "Email Address",
        "Phone",
        "Zip",
        "Country",
        "RFM Segment",
        "Recency Score (1-5)",
        "Frequency Score (1-5)",
        "Monetary Score (1-5)",
        "Recency (Days)",
        "Last Order Date",
        "Total Orders",
        `Order Value (${currency})`,
        `Average Order Value (${currency})`,
        "Top Department",
        "Status / Priority Tag",
      ],
      row: (customer) => [
        customer.customerId,
        customer.firstName,
        customer.lastName,
        customer.name,
        customer.company,
        customer.email,
        customer.phone,
        customer.zip,
        customer.country,
        customer.segmentLabel,
        customer.recencyScore,
        customer.frequencyScore,
        customer.monetaryScore,
        customer.recencyDays,
        customer.lastOrderDate,
        customer.frequency,
        customer.monetary.toFixed(2),
        customer.aov.toFixed(2),
        customer.topCategory,
        customer.statusTag,
      ],
    },
  };
  const definition = definitions.full;
  const lines = [
    definition.header,
    ...customers.map(definition.row),
  ]
    .map((cells) => cells.map(csvCell).join(","))
    .join("\r\n");

  const scope = selectedSegments.length === 1 ? selectedSegments[0] : "cohort";
  const syntheticPrefix = dataMode === "dummy" ? "SYNTHETIC-" : "";
  downloadCsvBlob(
    lines,
    `${syntheticPrefix}${definition.filePrefix}-${scope}-${asOfDate}.csv`,
  );
}

/**
 * Hands the file to the browser.
 *
 * The filename is the only context that survives into a downloads folder, so a
 * file built from synthetic data carries the marker there rather than only in
 * the UI that explained it.
 */
function downloadCsvBlob(contents: string, filename: string) {
  const blob = new Blob([contents], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Revoking in the same tick as click() races the download start in some
  // browsers, so the object URL is released a beat later.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface RfmTooltipData {
  segment: RfmSegmentRow;
  x: number;
  y: number;
  isRight: boolean;
  isTop: boolean;
  isBottom: boolean;
}

function RfmGrid({
  allSegments,
  selectedSegments,
  onSelectSegment,
  metric,
  currency,
}: {
  allSegments: RfmSegmentRow[];
  selectedSegments: RfmSegmentKey[];
  onSelectSegment: (key: RfmSegmentKey, isMultiSelect: boolean) => void;
  metric: RfmMetricKey;
  currency: Currency;
}) {
  const [hovered, setHovered] = useState<RfmTooltipData | null>(null);
  const isFiltered =
    selectedSegments.length > 0 &&
    selectedSegments.length < allSegments.length;
  const selectedSet = new Set(selectedSegments);

  const handleCellMouseEnter = (
    row: RfmSegmentRow,
    event: React.MouseEvent<HTMLDivElement>,
  ) => {
    const plot = event.currentTarget.closest(".rfm-grid-plot");
    if (!plot) return;
    const plotRect = plot.getBoundingClientRect();
    const cellRect = event.currentTarget.getBoundingClientRect();
    const x = cellRect.left - plotRect.left + cellRect.width / 2;
    const y = cellRect.top - plotRect.top + cellRect.height / 2;
    const isTop = cellRect.top - plotRect.top < 85;
    const isBottom = cellRect.bottom - plotRect.top > plotRect.height - 85;
    const isRight = x > plotRect.width * 0.52;
    setHovered({
      segment: row,
      x,
      y,
      isRight,
      isTop,
      isBottom,
    });
  };

  const handleCellMouseLeave = () => {
    setHovered(null);
  };

  return (
    <figure aria-labelledby="rfm-grid-title" className="rfm-grid-figure">
      <figcaption className="rfm-grid-figure__title" id="rfm-grid-title">
        <span className="rfm-grid-figure__heading">RFM group</span>
        <span className="rfm-grid-figure__hint">
          Hover for metrics · Click to deep dive · Shift+Click to multi-select
        </span>
      </figcaption>
      <div className="rfm-grid-plot" onMouseLeave={handleCellMouseLeave}>
        <span className="rfm-axis rfm-axis--y">
          Frequency + monetary value score
        </span>
        <div aria-hidden="true" className="rfm-grid-plot__y-ticks">
          {[5, 4, 3, 2, 1].map((tick) => (
            <span key={tick}>{tick}</span>
          ))}
        </div>
        <div className="rfm-grid-plot__cells">
          {allSegments.map((row) => {
            const isSelected = selectedSet.has(row.key);
            const isDimmed = isFiltered && !isSelected;
            return (
              <div
                aria-label={`${row.label}: ${formatRfmValue(
                  row,
                  metric,
                  currency,
                )}, ${formatRfmValue(
                  row,
                  "customerShare",
                  currency,
                )} of customers. Click to inspect.`}
                aria-pressed={isSelected}
                className={`rfm-segment rfm-segment--${row.key}${
                  isSelected && isFiltered ? " is-selected" : ""
                }${isDimmed ? " is-dimmed" : ""}`}
                key={row.key}
                onClick={(event) =>
                  onSelectSegment(
                    row.key,
                    event.shiftKey || event.metaKey || event.ctrlKey,
                  )
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectSegment(
                      row.key,
                      event.shiftKey || event.metaKey || event.ctrlKey,
                    );
                  }
                }}
                onMouseEnter={(e) => handleCellMouseEnter(row, e)}
                role="button"
                tabIndex={0}
              >
                <strong>{row.label}</strong>
                <span>
                  {formatRfmValue(row, metric, currency)}
                  {metric !== "customerShare" && (
                    <small>
                      ({formatRfmValue(row, "customerShare", currency)})
                    </small>
                  )}
                </span>
              </div>
            );
          })}
        </div>
        <div aria-hidden="true" className="rfm-grid-plot__x-ticks">
          {[1, 2, 3, 4, 5].map((tick) => (
            <span key={tick}>{tick}</span>
          ))}
        </div>
        <span className="rfm-axis rfm-axis--x">Recency score</span>

        {/* Floating Interactive Hover Tooltip Card */}
        {hovered && (
          <div
            aria-hidden="true"
            className={`rfm-hover-card rfm-hover-card--${hovered.segment.key}${
              hovered.isRight ? " is-right" : ""
            }${hovered.isTop ? " is-top" : ""}${
              hovered.isBottom && !hovered.isTop ? " is-bottom" : ""
            }`}
            style={{
              left: `${hovered.x}px`,
              top: `${hovered.y}px`,
            }}
          >
            <div className="rfm-hover-card__header">
              <div className="rfm-hover-card__title-wrap">
                <span
                  aria-hidden="true"
                  className={`rfm-table__dot rfm-table__dot--${hovered.segment.key}`}
                />
                <strong className="rfm-hover-card__name">
                  {hovered.segment.label}
                </strong>
              </div>
              <span
                className={`rfm-status-badge rfm-status-badge--${hovered.segment.key}`}
              >
                {hovered.segment.key === "champions"
                  ? "VIP Champion"
                  : hovered.segment.key === "atRisk"
                    ? "At Risk"
                    : hovered.segment.key === "loyal"
                      ? "High Loyalty"
                      : hovered.segment.key === "new"
                        ? "New Buyer"
                        : hovered.segment.key === "dormant"
                          ? "Dormant"
                          : hovered.segment.key === "almostLost"
                            ? "Almost Lost"
                            : hovered.segment.key === "needsAttention"
                              ? "Attention"
                              : hovered.segment.key === "previouslyLoyal"
                                ? "Lapsed VIP"
                                : hovered.segment.key === "promising"
                                  ? "Promising"
                                  : "Active"}
              </span>
            </div>

            <div className="rfm-hover-card__metrics">
              <div className="rfm-hover-card__row">
                <span className="rfm-hover-card__label">
                  Share of customers
                </span>
                <strong className="rfm-hover-card__value">
                  {formatRfmValue(hovered.segment, "customerShare", currency)}
                </strong>
              </div>
              <div className="rfm-hover-card__row">
                <span className="rfm-hover-card__label">Customer records</span>
                <strong className="rfm-hover-card__value">
                  {formatRfmValue(hovered.segment, "customerCount", currency)}
                </strong>
              </div>
              <div className="rfm-hover-card__row">
                <span className="rfm-hover-card__label">
                  Avg. days since order
                </span>
                <strong className="rfm-hover-card__value">
                  {hovered.segment.averageRecencyDays}d
                </strong>
              </div>
              <div className="rfm-hover-card__row">
                <span className="rfm-hover-card__label">
                  Total orders
                </span>
                <strong className="rfm-hover-card__value">
                  {numberFormatter.format(hovered.segment.totalOrders)}
                </strong>
              </div>
              <div className="rfm-hover-card__row rfm-hover-card__row--highlight">
                <span className="rfm-hover-card__label">
                  Total spend
                </span>
                <strong className="rfm-hover-card__value">
                  {currencyFormatterFor(currency).format(hovered.segment.totalSpent)}
                </strong>
              </div>
              <div className="rfm-hover-card__row">
                <span className="rfm-hover-card__label">
                  Average order (AOV)
                </span>
                <strong className="rfm-hover-card__value">
                  {currencyFormatterFor(currency).format(
                    hovered.segment.totalOrders > 0
                      ? hovered.segment.totalSpent /
                          hovered.segment.totalOrders
                      : 0,
                  )}
                </strong>
              </div>
            </div>

            <div className="rfm-hover-card__hint">
              <span>💡 Click to deep dive · Shift+Click to multi-select</span>
            </div>
          </div>
        )}
      </div>
    </figure>
  );
}

function RfmCustomerDeepDive({
  customers,
  selectedSegments,
  allSegments,
  onToggleSegment,
  onSelectOnly,
  onSelectAll,
  onClear,
  currency,
  asOfDate,
  canExportAudience,
  dataMode,
  accountSlug,
}: {
  customers: CustomerRfmRow[];
  selectedSegments: RfmSegmentKey[];
  allSegments: RfmSegmentRow[];
  onToggleSegment: (key: RfmSegmentKey) => void;
  onSelectOnly: (key: RfmSegmentKey) => void;
  onSelectAll: () => void;
  onClear: () => void;
  currency: Currency;
  asOfDate: string;
  /** False hides the export entirely; these files carry customer identities. */
  canExportAudience: boolean;
  dataMode: "live" | "dummy";
  accountSlug: string;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<
    | "name"
    | "company"
    | "monetary"
    | "recencyDays"
    | "frequency"
    | "aov"
    | "customerId"
  >("monetary");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);

  const selectedSet = new Set(selectedSegments);
  const segmentFiltered = customers.filter((c) =>
    selectedSet.has(c.segmentKey),
  );

  // Extract available categories
  const categories = Array.from(
    new Set(customers.map((c) => c.topCategory)),
  ).sort();

  // Search and Category filtering
  const query = searchQuery.trim().toLowerCase();
  const searchFiltered = segmentFiltered.filter((c) => {
    if (categoryFilter !== "all" && c.topCategory !== categoryFilter) {
      return false;
    }
    if (!query) return true;
    return (
      c.name.toLowerCase().includes(query) ||
      c.company.toLowerCase().includes(query) ||
      c.email.toLowerCase().includes(query) ||
      c.phone.includes(query) ||
      c.zip.toLowerCase().includes(query) ||
      c.country.toLowerCase().includes(query) ||
      c.customerId.toLowerCase().includes(query) ||
      c.segmentLabel.toLowerCase().includes(query) ||
      c.topCategory.toLowerCase().includes(query) ||
      c.statusTag.toLowerCase().includes(query)
    );
  });

  // Sorting
  const sortedCustomers = [...searchFiltered].sort((left, right) => {
    const factor = sortDirection === "asc" ? 1 : -1;
    if (
      sortField === "customerId" ||
      sortField === "name" ||
      sortField === "company"
    ) {
      return factor * left[sortField].localeCompare(right[sortField]);
    }
    return factor * (left[sortField] - right[sortField]);
  });

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(sortedCustomers.length / pageSize));
  const activePage = Math.min(Math.max(1, currentPage), totalPages);
  const paginatedCustomers = sortedCustomers.slice(
    (activePage - 1) * pageSize,
    activePage * pageSize,
  );

  // Aggregated summary metrics for selected cohort
  const cohortCustomerCount = segmentFiltered.length;
  const totalStoreCustomers = customers.length || 1;
  const shareOfTotalCustomers = (
    (cohortCustomerCount / totalStoreCustomers) *
    100
  )
    .toFixed(1)
    .replace(/\.0$/, "");
  const cohortTotalSpend = segmentFiltered.reduce(
    (acc, c) => acc + c.monetary,
    0,
  );
  const storeTotalSpend =
    customers.reduce((acc, c) => acc + c.monetary, 0) || 1;
  const shareOfTotalSpend = (
    (cohortTotalSpend / storeTotalSpend) *
    100
  )
    .toFixed(1)
    .replace(/\.0$/, "");
  const cohortTotalOrders = segmentFiltered.reduce(
    (acc, c) => acc + c.frequency,
    0,
  );
  const cohortAvgAov =
    cohortTotalOrders > 0 ? cohortTotalSpend / cohortTotalOrders : 0;
  const cohortAvgRecency =
    cohortCustomerCount > 0
      ? Math.round(
          segmentFiltered.reduce((acc, c) => acc + c.recencyDays, 0) /
            cohortCustomerCount,
        )
      : 0;

  function toggleSort(
    field:
      | "name"
      | "company"
      | "monetary"
      | "recencyDays"
      | "frequency"
      | "aov"
      | "customerId",
  ) {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection(
        field === "customerId" || field === "name" || field === "company"
          ? "asc"
          : "desc",
      );
    }
  }

  // Active Playbook recommendations
  const activePlaybooks = Array.from(selectedSet).map((key) => {
    const def = allSegments.find((s) => s.key === key);
    return {
      key,
      label: def?.label ?? key,
      ...RFM_PLAYBOOKS[key],
    };
  });

  return (
    <div className="rfm-deepdive">
      {/* Roster Header with Split Layout (Option 1) */}
      <div className="rfm-deepdive__header">
        <div className="rfm-deepdive__masthead">
          <div className="rfm-deepdive__title-wrap">
            <div className="rfm-deepdive__badge-row">
              <span className="rfm-deepdive__badge">
                Customer Roster & Accounts ({selectedSegments.length} Segments Active)
              </span>
              {selectedSegments.length < allSegments.length && (
                <span className="rfm-deepdive__filter-indicator">
                  Filtering by Matrix Selection
                </span>
              )}
            </div>
            <h4 className="rfm-deepdive__title">
              {selectedSegments.length === 1
                ? `${
                    allSegments.find((s) => s.key === selectedSegments[0])
                      ?.label ?? "Segment"
                  } Customers (${cohortCustomerCount})`
                : selectedSegments.length === allSegments.length
                  ? `All Store Accounts & Customers (${cohortCustomerCount})`
                  : `Selected Cohort Accounts (${cohortCustomerCount} Customers)`}
            </h4>
            <p className="rfm-deepdive__desc">
              Store customer accounts with company identity, order history, and RFM scores. Click any RFM cell in the matrix above or use the buttons below.
            </p>
          </div>

          <div className="rfm-deepdive__actions">
            <button
              className="rfm-action-btn"
              onClick={onSelectAll}
              type="button"
            >
              Select All
            </button>
            <button
              className="rfm-action-btn"
              onClick={onClear}
              type="button"
            >
              Clear
            </button>
            {canExportAudience && (
            <details className="rfm-export-menu">
              <summary className="button button--primary button--sm rfm-export-btn">
                <DownloadIcon className="rfm-export-btn__icon" />
                <span>Download CSV ({segmentFiltered.length})</span>
                <ChevronIcon />
              </summary>
              <div className="rfm-export-menu__options">
                {(
                  [
                    ["meta", "Meta Value-Based CSV", "email · phone · value · cohort"],
                    ["google", "Google Customer Match CSV", "identity · value · orders · segment"],
                    ["full", "Full Analytics CSV", "20 columns for Excel / Sheets"],
                  ] as const
                ).map(([preset, label, description]) => (
                  <button
                    key={preset}
                    onClick={(event) => {
                      downloadCustomerCsv(
                        segmentFiltered,
                        selectedSegments,
                        currency,
                        asOfDate,
                        preset,
                        dataMode,
                        accountSlug,
                      );
                      event.currentTarget.closest("details")?.removeAttribute("open");
                    }}
                    type="button"
                  >
                    <strong>{label}</strong>
                    <small>{description}</small>
                  </button>
                ))}
              </div>
            </details>
            )}
          </div>
        </div>

        {/* Quick Segment Filter Pill Ribbon */}
        <div className="rfm-deepdive__pills-bar">
          <div className="rfm-deepdive__pills">
            <button
              className={`rfm-pill rfm-pill--all${
                selectedSegments.length === allSegments.length
                  ? " is-selected"
                  : ""
              }`}
              onClick={onSelectAll}
              type="button"
            >
              <span>All Segments</span>
              <small>({customers.length})</small>
            </button>

            {allSegments.map((s) => {
              const isSelected = selectedSet.has(s.key);
              const isHighlighted =
                selectedSegments.length < allSegments.length && isSelected;
              return (
                <button
                  className={`rfm-pill rfm-pill--seg-${s.key}${
                    isHighlighted ? " is-selected" : ""
                  }`}
                  key={s.key}
                  onClick={() => onToggleSegment(s.key)}
                  onDoubleClick={() => onSelectOnly(s.key)}
                  title={`${s.label}: Click to toggle, Double-click to isolate`}
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    className={`rfm-table__dot rfm-table__dot--${s.key}`}
                  />
                  <span>{s.label}</span>
                  <small>({s.customerCount})</small>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Cohort Summary KPI Cards */}
      <div className="rfm-deepdive__summary-grid">
        <div className="rfm-summary-card">
          <span className="rfm-summary-card__label">Cohort Customers</span>
          <div className="rfm-summary-card__value-wrap">
            <strong className="rfm-summary-card__value">
              {numberFormatter.format(cohortCustomerCount)}
            </strong>
            <span className="rfm-summary-card__sub">
              {shareOfTotalCustomers}% of store
            </span>
          </div>
        </div>
        <div className="rfm-summary-card">
          <span className="rfm-summary-card__label">Total Order Value</span>
          <div className="rfm-summary-card__value-wrap">
            <strong className="rfm-summary-card__value rfm-summary-card__value--green">
              {currencyFormatterFor(currency).format(cohortTotalSpend)}
            </strong>
            <span className="rfm-summary-card__sub">
              {shareOfTotalSpend}% of revenue
            </span>
          </div>
        </div>
        <div className="rfm-summary-card">
          <span className="rfm-summary-card__label">Cohort Orders</span>
          <div className="rfm-summary-card__value-wrap">
            <strong className="rfm-summary-card__value">
              {numberFormatter.format(cohortTotalOrders)}
            </strong>
            <span className="rfm-summary-card__sub">Total purchases</span>
          </div>
        </div>
        <div className="rfm-summary-card">
          <span className="rfm-summary-card__label">Average Order Value</span>
          <div className="rfm-summary-card__value-wrap">
            <strong className="rfm-summary-card__value">
              {currencyFormatterFor(currency).format(cohortAvgAov)}
            </strong>
            <span className="rfm-summary-card__sub">AOV across cohort</span>
          </div>
        </div>
        <div className="rfm-summary-card">
          <span className="rfm-summary-card__label">Average Recency</span>
          <div className="rfm-summary-card__value-wrap">
            <strong className="rfm-summary-card__value">
              {cohortAvgRecency} days
            </strong>
            <span className="rfm-summary-card__sub">Since last order</span>
          </div>
        </div>
      </div>

      {/* Strategic Playbook Recommendations */}
      {activePlaybooks.length > 0 &&
        selectedSegments.length < allSegments.length && (
          <div className="rfm-playbook-panel">
            <div className="rfm-playbook__header">
              <LightbulbIcon className="rfm-playbook__icon" />
              <span className="rfm-playbook__heading">
                Marketing Strategy & Activation Playbook (
                {activePlaybooks.length} Selected Segments)
              </span>
            </div>
            <div className="rfm-playbook__cards">
              {activePlaybooks.slice(0, 3).map((playbook) => (
                <div
                  className={`rfm-playbook-item rfm-playbook-item--${playbook.badgeTone}`}
                  key={playbook.key}
                >
                  <div className="rfm-playbook-item__top">
                    <strong className="rfm-playbook-item__title">
                      {playbook.title}
                    </strong>
                    <span className="rfm-playbook-item__obj">
                      {playbook.objective}
                    </span>
                  </div>
                  <p className="rfm-playbook-item__action">
                    {playbook.action}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

      {/* Search & Filter Toolbar */}
      <div className="rfm-deepdive__toolbar">
        <div className="rfm-deepdive__search-wrap">
          <SearchIcon className="rfm-deepdive__search-icon" />
          <input
            aria-label="Search customer roster"
            className="rfm-deepdive__search-input"
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by customer name, company, email, ID, or segment..."
            type="search"
            value={searchQuery}
          />
          {searchQuery && (
            <button
              aria-label="Clear search"
              className="rfm-deepdive__search-clear"
              onClick={() => setSearchQuery("")}
              type="button"
            >
              ×
            </button>
          )}
        </div>

        <div className="rfm-deepdive__filter-controls">
          <label className="rfm-deepdive__select-label">
            <span>Category:</span>
            <div className="select-wrap rfm-deepdive__select-wrap">
              <select
                onChange={(e) => setCategoryFilter(e.target.value)}
                value={categoryFilter}
              >
                <option value="all">
                  All Departments ({categories.length})
                </option>
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
              <ChevronIcon />
            </div>
          </label>

          <label className="rfm-deepdive__select-label">
            <span>Rows:</span>
            <div className="select-wrap rfm-deepdive__select-wrap rfm-deepdive__select-wrap--sm">
              <select
                onChange={(e) => setPageSize(Number(e.target.value))}
                value={pageSize}
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
              <ChevronIcon />
            </div>
          </label>
        </div>
      </div>

      {/* Customer Data Table */}
      <div className="table-scroller rfm-customer-table-scroller">
        <table className="data-table rfm-customer-table">
          <caption className="visually-hidden">
            Individual customer records matching selected RFM groups
          </caption>
          <thead>
            <tr>
              <th scope="col">
                <button
                  className={`rfm-table__sort${
                    sortField === "name" ? " rfm-table__sort--active" : ""
                  }`}
                  onClick={() => toggleSort("name")}
                  type="button"
                >
                  Customer & Company
                  <ChevronIcon
                    className={`rfm-table__sort-icon${
                      sortField === "name" && sortDirection === "asc"
                        ? " rfm-table__sort-icon--asc"
                        : ""
                    }`}
                  />
                </button>
              </th>
              <th scope="col">RFM Segment</th>
              <th scope="col">
                <button
                  className={`rfm-table__sort${
                    sortField === "frequency" ? " rfm-table__sort--active" : ""
                  }`}
                  onClick={() => toggleSort("frequency")}
                  type="button"
                >
                  Total Orders
                  <ChevronIcon
                    className={`rfm-table__sort-icon${
                      sortField === "frequency" && sortDirection === "asc"
                        ? " rfm-table__sort-icon--asc"
                        : ""
                    }`}
                  />
                </button>
              </th>
              <th scope="col">
                <button
                  className={`rfm-table__sort${
                    sortField === "monetary" ? " rfm-table__sort--active" : ""
                  }`}
                  onClick={() => toggleSort("monetary")}
                  type="button"
                >
                  Order Value
                  <ChevronIcon
                    className={`rfm-table__sort-icon${
                      sortField === "monetary" && sortDirection === "asc"
                        ? " rfm-table__sort-icon--asc"
                        : ""
                    }`}
                  />
                </button>
              </th>
              <th scope="col">
                <button
                  className={`rfm-table__sort${
                    sortField === "aov" ? " rfm-table__sort--active" : ""
                  }`}
                  onClick={() => toggleSort("aov")}
                  type="button"
                >
                  AOV
                  <ChevronIcon
                    className={`rfm-table__sort-icon${
                      sortField === "aov" && sortDirection === "asc"
                        ? " rfm-table__sort-icon--asc"
                        : ""
                    }`}
                  />
                </button>
              </th>
              <th scope="col">
                <button
                  className={`rfm-table__sort${
                    sortField === "recencyDays"
                      ? " rfm-table__sort--active"
                      : ""
                  }`}
                  onClick={() => toggleSort("recencyDays")}
                  type="button"
                >
                  Last Order
                  <ChevronIcon
                    className={`rfm-table__sort-icon${
                      sortField === "recencyDays" && sortDirection === "asc"
                        ? " rfm-table__sort-icon--asc"
                        : ""
                    }`}
                  />
                </button>
              </th>
              <th scope="col">Top Department</th>
              <th scope="col">Status & Priority</th>
            </tr>
          </thead>
          <tbody>
            {paginatedCustomers.length > 0 ? (
              paginatedCustomers.map((c) => (
                <tr key={c.customerId}>
                  <th scope="row">
                    <div className="rfm-cust-profile">
                      <div className="rfm-cust-profile__top">
                        <span className="rfm-cust-avatar" aria-hidden="true">
                          {c.name
                            .split(" ")
                            .map((p) => p[0])
                            .join("")
                            .slice(0, 2)}
                        </span>
                        <div className="rfm-cust-profile__names">
                          <strong className="rfm-cust-name">{c.name}</strong>
                          <span className="rfm-cust-company">{c.company}</span>
                        </div>
                      </div>
                      <div className="rfm-cust-profile__sub">
                        <span className="rfm-cust-email">{c.email}</span>
                        <span className="rfm-cust-id-badge">{c.customerId}</span>
                      </div>
                    </div>
                  </th>
                  <td>
                    <span className="rfm-cust-segment">
                      <span
                        aria-hidden="true"
                        className={`rfm-table__dot rfm-table__dot--${c.segmentKey}`}
                      />
                      <span>{c.segmentLabel}</span>
                      <small className="rfm-score-tag">
                        R:{c.recencyScore} F:{c.frequencyScore} M:
                        {c.monetaryScore}
                      </small>
                    </span>
                  </td>
                  <td>
                    <span className="rfm-order-badge">{c.frequency} orders</span>
                  </td>
                  <td>
                    <strong className="rfm-value-highlight">
                      {currencyFormatterFor(currency).format(c.monetary)}
                    </strong>
                  </td>
                  <td>
                    <span>{currencyFormatterFor(currency).format(c.aov)}</span>
                  </td>
                  <td>
                    <div className="rfm-recency-cell">
                      <strong>{c.recencyDays}d ago</strong>
                      <small>{formatDate(c.lastOrderDate)}</small>
                    </div>
                  </td>
                  <td>
                    <span className="rfm-dept-chip">{c.topCategory}</span>
                  </td>
                  <td>
                    <span
                      className={`rfm-status-badge rfm-status-badge--${c.segmentKey}`}
                    >
                      {c.statusTag}
                    </span>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="rfm-empty-cell" colSpan={8}>
                  No customer records match your filter criteria.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="rfm-deepdive__pagination">
        <span className="rfm-deepdive__pagination-info">
          Showing{" "}
          {sortedCustomers.length === 0
            ? 0
            : (activePage - 1) * pageSize + 1}
          –
          {Math.min(activePage * pageSize, sortedCustomers.length)} of{" "}
          {sortedCustomers.length} customers
        </span>
        <div className="rfm-deepdive__pagination-buttons">
          <button
            className="button button--secondary button--sm"
            disabled={activePage <= 1}
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            type="button"
          >
            Previous
          </button>
          <span className="rfm-deepdive__page-badge">
            Page {activePage} of {totalPages}
          </span>
          <button
            className="button button--secondary button--sm"
            disabled={activePage >= totalPages}
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            type="button"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

function RfmAnalysisPanel({
  analysis,
  currency,
  canExportAudience,
  dataMode,
  accountSlug,
}: {
  analysis: RfmAnalysis;
  currency: Currency;
  canExportAudience: boolean;
  dataMode: "live" | "dummy";
  accountSlug: string;
}) {
  const [activeMetric, setActiveMetric] =
    useState<RfmMetricKey>("customerCount");
  const [selectedSegments, setSelectedSegments] = useState<RfmSegmentKey[]>(
    analysis.segments.map((segment) => segment.key),
  );
  const selectedSet = new Set(selectedSegments);
  const visibleRows = analysis.segments.filter((segment) =>
    selectedSet.has(segment.key),
  );
  const visibleSummary = summariseRfmRows(visibleRows);
  const allSegmentsSelected =
    selectedSegments.length === analysis.segments.length;
  const filterStatus = allSegmentsSelected
    ? `All ${analysis.segments.length} selected`
    : `${selectedSegments.length} of ${analysis.segments.length} selected`;

  function toggleSegment(key: RfmSegmentKey) {
    setSelectedSegments((current) =>
      current.includes(key)
        ? current.filter((segment) => segment !== key)
        : [...current, key],
    );
  }

  function handleSelectOnly(key: RfmSegmentKey) {
    if (selectedSegments.length === 1 && selectedSegments[0] === key) {
      setSelectedSegments(analysis.segments.map((s) => s.key));
    } else {
      setSelectedSegments([key]);
    }
  }

  function handleGridSelect(key: RfmSegmentKey, isMultiSelect: boolean) {
    if (isMultiSelect) {
      toggleSegment(key);
    } else {
      handleSelectOnly(key);
    }
  }

  return (
    <article className="panel rfm-workspace">
      <div className="panel__heading rfm-workspace__heading">
        <div>
          <span className="eyebrow">Customer value</span>
          <h2>
            <span className="metric-label-inline">
              RFM analysis
              <MetricHint label="RFM analysis" text={metricHintFor("rfmSegments")!} />
            </span>
          </h2>
          <p>
            Customer groups as of {formatDate(analysis.asOfDate)}, based on
            the trailing 12 months of order history.
          </p>
        </div>
        <div className="rfm-workspace__actions">
          <span className="panel__meta">Dummy store-shaped data</span>
          <button className="button button--secondary" disabled={visibleRows.length === 0} onClick={() => downloadRfmCsv(visibleRows, visibleSummary, analysis.fieldLabels, currency, analysis.asOfDate)} type="button">
            <DownloadIcon /> Download CSV
          </button>
        </div>
      </div>

      <dl className="rfm-overview" aria-label="Selected RFM customer summary">
        <div><dt>Customers</dt><dd>{numberFormatter.format(visibleSummary.customerCount)} customers</dd></div>
        <div><dt>Total value</dt><dd>{formatValue(visibleSummary.totalSpent, "currency", currency)}</dd></div>
        <div><dt>Total orders</dt><dd>{numberFormatter.format(visibleSummary.totalOrders)}</dd></div>
        <div><dt>Blended AOV</dt><dd>{visibleSummary.totalOrders > 0 ? formatValue(visibleSummary.totalSpent / visibleSummary.totalOrders, "currency", currency) : "N/A"}</dd></div>
        <div><dt>Mean recency</dt><dd>{visibleSummary.averageRecencyDays} days</dd></div>
      </dl>

      <div className="rfm-workspace__layout">
        <div className="rfm-workspace__report">
          {visibleRows.length > 0 ? (
            <RfmGrid
              allSegments={analysis.segments}
              currency={currency}
              metric={activeMetric}
              onSelectSegment={handleGridSelect}
              selectedSegments={selectedSegments}
            />
          ) : (
            <div className="rfm-empty" role="status">
              <strong>No RFM segments selected</strong>
              <p>Choose at least one segment in Filters to restore the grid.</p>
              <button
                className="button button--secondary"
                onClick={() =>
                  setSelectedSegments(
                    analysis.segments.map((segment) => segment.key),
                  )
                }
                type="button"
              >
                Show all segments
              </button>
            </div>
          )}
        </div>

        <aside aria-label="RFM report controls" className="rfm-controls">
          <nav aria-label="Retention view" className="rfm-controls__tabs">
            <a aria-current="page" href="#store-rfm">
              Freeform
            </a>
            <a href="#store-cohorts">Cohorts</a>
          </nav>

          <details className="rfm-control-group" open>
            <summary>Metrics</summary>
            <div className="rfm-control-group__body rfm-metric-list">
              {RFM_METRICS.map((metric) => (
                <button
                  aria-pressed={metric.key === activeMetric}
                  className={
                    metric.key === activeMetric ? "is-active" : undefined
                  }
                  key={metric.key}
                  onClick={() => setActiveMetric(metric.key)}
                  type="button"
                >
                  <span aria-hidden="true" className="rfm-control-check">
                    {metric.key === activeMetric ? "✓" : ""}
                  </span>
                  {analysis.fieldLabels[metric.key]}
                </button>
              ))}
            </div>
          </details>

          <details className="rfm-control-group" open>
            <summary>Dimensions</summary>
            <div className="rfm-control-group__body">
              <span className="rfm-dimension-chip">
                {analysis.fieldLabels.segment}
              </span>
            </div>
          </details>

          <label className="rfm-control-select">
            <span className="rfm-control-select__heading">
              <strong>Visualization</strong>
              <small>Grid view</small>
            </span>
            <span className="rfm-control-select__body">
              <span className="rfm-control-select__label">Chart type</span>
              <span className="select-wrap rfm-control-select__field">
                <select defaultValue="rfm-grid">
                  <option value="rfm-grid">RFM Grid</option>
                </select>
                <ChevronIcon />
              </span>
            </span>
          </label>

          <details className="rfm-control-group rfm-filter-group">
            <summary>
              <span>Filters</span>
              <small>
                {allSegmentsSelected
                  ? `All ${analysis.segments.length}`
                  : `${selectedSegments.length} selected`}
              </small>
            </summary>
            <div className="rfm-control-group__body rfm-filter-list">
              <div className="rfm-filter-overview">
                <span>{analysis.fieldLabels.segment}</span>
                <strong>{filterStatus}</strong>
              </div>
              <div className="rfm-filter-actions">
                <button
                  disabled={allSegmentsSelected}
                  onClick={() =>
                    setSelectedSegments(
                      analysis.segments.map((segment) => segment.key),
                    )
                  }
                  type="button"
                >
                  Select all
                </button>
                <button
                  disabled={selectedSegments.length === 0}
                  onClick={() => setSelectedSegments([])}
                  type="button"
                >
                  Clear
                </button>
              </div>
              <div
                aria-label={`${analysis.fieldLabels.segment} options`}
                className="rfm-filter-options"
                role="group"
              >
                {analysis.segments.map((segment) => (
                  <label key={segment.key}>
                    <input
                      checked={selectedSet.has(segment.key)}
                      onChange={() => toggleSegment(segment.key)}
                      type="checkbox"
                    />
                    <span>{segment.label}</span>
                  </label>
                ))}
              </div>
              {!allSegmentsSelected ? (
                <button
                  className="rfm-filter-reset"
                  onClick={() =>
                    setSelectedSegments(
                      analysis.segments.map((segment) => segment.key),
                    )
                  }
                  type="button"
                >
                  Reset filters
                </button>
              ) : null}
              <button
                className="rfm-filter-download"
                disabled={visibleRows.length === 0}
                onClick={() =>
                  downloadRfmCsv(
                    visibleRows,
                    visibleSummary,
                    analysis.fieldLabels,
                    currency,
                    analysis.asOfDate,
                  )
                }
                type="button"
              >
                <DownloadIcon />
                Download {filterStatus.toLowerCase()}
              </button>
            </div>
          </details>

          <p className="rfm-controls__note">
            Source columns will map to stable internal keys; these labels can
            be adjusted when the live store contract is verified.
          </p>
        </aside>
      </div>

      {/* Customer Deep Dive & Audience Activation */}
      <RfmCustomerDeepDive
        accountSlug={accountSlug}
        allSegments={analysis.segments}
        asOfDate={analysis.asOfDate}
        canExportAudience={canExportAudience}
        currency={currency}
        customers={analysis.customers ?? []}
        dataMode={dataMode}
        onClear={() => setSelectedSegments([])}
        onSelectAll={() =>
          setSelectedSegments(analysis.segments.map((s) => s.key))
        }
        onSelectOnly={handleSelectOnly}
        onToggleSegment={toggleSegment}
        selectedSegments={selectedSegments}
      />
    </article>
  );
}

const COHORT_HINT =
  "Month 0 is the acquisition month. Each later column is the share of that cohort that ordered again, measured against its own acquisition month, so the comparison period does not apply here. A dash marks a month the cohort has not reached yet.";

function formatCohortShare(retention: number) {
  return retention >= 1 ? "100%" : `${(retention * 100).toFixed(1)}%`;
}

function CohortMatrix({ rows, asOf }: { rows: CohortRow[]; asOf: string }) {
  const columns = Math.max(...rows.map((row) => row.retention.length), 1);
  const cohortLabel = (cohort: string) =>
    monthFormatter.format(new Date(`${cohort}-01T12:00:00Z`));
  const years = [...new Set(rows.map((row) => row.cohort.slice(0, 4)))];
  const span =
    years.length === 1
      ? years[0]
      : rows.length > 0
        ? `${cohortLabel(rows[0].cohort)} – ${cohortLabel(rows[rows.length - 1].cohort)}`
        : null;
  const title = span ? `Retention cohort matrix (${span})` : "Retention cohort matrix";

  return (
    <article className="panel cohort-matrix">
      <div className="panel__heading cohort-matrix__heading">
        <div>
          <span className="eyebrow">Retention</span>
          <h2>
            <span className="metric-label-inline">
              {title}
              <MetricHint label={title} text={COHORT_HINT} />
            </span>
          </h2>
          <p>
            Share of each acquisition cohort that ordered again, M0 through M
            {columns - 1}. Cohorts up to {asOf}.
          </p>
        </div>
        <div className="cohort-matrix__legend">
          <span>Heatmap intensity</span>
          <span className="cohort-matrix__legend-scale" aria-hidden="true">
            <span>low</span>
            <i data-level="1" />
            <i data-level="3" />
            <i data-level="5" />
            <i data-level="6" />
            <span>high</span>
          </span>
        </div>
      </div>
      <div className="cohort-matrix__scroller" role="region" aria-label="Cohort retention table" tabIndex={0}>
        <table
          aria-label={`${title}: retention share by month since acquisition`}
          className="cohort-matrix__table"
        >
          <thead>
            <tr>
              <th scope="col">Cohort</th>
              <th scope="col">Customers</th>
              {Array.from({ length: columns }, (_, index) => (
                <th key={index} scope="col">
                  M{index}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.cohort}>
                <th scope="row">{cohortLabel(row.cohort)}</th>
                <td className="cohort-matrix__customers">{row.customers}</td>
                {Array.from({ length: columns }, (_, index) => {
                  const retention = row.retention[index];
                  const level = cohortHeatLevel(retention);
                  return level === null ? (
                    <td
                      aria-label={`M${index} not reached yet`}
                      className="cohort-heat cohort-heat--empty"
                      key={index}
                    >
                      –
                    </td>
                  ) : (
                    <td className="cohort-heat" data-level={level} key={index}>
                      {formatCohortShare(retention!)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

const YEARLY_CHART_WIDTH = 960;
const YEARLY_CHART_HEIGHT = 240;
const YEARLY_CHART_LEFT = 52;
const YEARLY_CHART_RIGHT = 52;
const YEARLY_CHART_TOP = 28;
const YEARLY_CHART_BOTTOM = 38;

function YearlySalesOrdersChart({
  series,
  currency,
  visibleYears,
  onToggleYear,
}: {
  series: YearlyComparisonSeries[];
  currency: Currency;
  visibleYears: number[];
  onToggleYear: (year: number) => void;
}) {
  const [activeMonth, setActiveMonth] = useState<number | null>(null);
  const [showOrderTrend, setShowOrderTrend] = useState(false);
  const visible = series
    .map((year, seriesIndex) => ({ year, seriesIndex }))
    .filter(({ year }) => visibleYears.includes(year.year));
  const salesValues = visible.flatMap(({ year }) =>
    year.months.map((month) => month.sales),
  );
  const orderValues = visible.flatMap(({ year }) =>
    year.months.map((month) => month.orders),
  );
  const maxSales = Math.max(...salesValues, 1);
  const maxOrders = Math.max(...orderValues, 1);
  const plotWidth =
    YEARLY_CHART_WIDTH - YEARLY_CHART_LEFT - YEARLY_CHART_RIGHT;
  const plotHeight =
    YEARLY_CHART_HEIGHT - YEARLY_CHART_TOP - YEARLY_CHART_BOTTOM;
  const slotWidth = plotWidth / 12;
  const barGap = 4;
  const barWidth = Math.min(10, (slotWidth * 0.68 - barGap * (visible.length - 1)) / Math.max(visible.length, 1));

  const centreFor = (monthIndex: number) =>
    YEARLY_CHART_LEFT + slotWidth * monthIndex + slotWidth / 2;
  const salesY = (value: number) =>
    YEARLY_CHART_TOP + plotHeight - (value / maxSales) * plotHeight;
  const ordersY = (value: number) =>
    YEARLY_CHART_TOP + plotHeight - (value / maxOrders) * plotHeight;

  const activeTooltip: TooltipState | null =
    activeMonth === null
      ? null
      : {
          title: series[0]?.months[activeMonth]?.label ?? `Month ${activeMonth + 1}`,
          anchor: activeMonth / 11,
          rows: visible.flatMap(({ year, seriesIndex }) => {
            const month = year.months[activeMonth];
            if (!month) return [];
            const qualifier =
              month.isPartial && month.throughDay !== null
                ? ` · days 1–${month.throughDay}`
                : "";
            return [
              {
                label: `${year.year} sales${qualifier}`,
                value: formatValue(month.sales, "currency", currency),
                swatch: `legend-dot--year-${seriesIndex}`,
              },
              {
                label: `${year.year} orders`,
                value: numberFormatter.format(month.orders),
                swatch: `legend-line--year-${seriesIndex}`,
              },
            ];
          }),
        };

  return (
    <div className="yearly-comparison-chart">
      <div className="yearly-comparison-chart__toolbar">
        <div>
          <strong>Show years</strong>
          <span>Sales bars · order lines</span>
        </div>
        <div aria-label="Years shown in the chart" className="year-toggle" role="group">
          {series.map((year, index) => {
            const isVisible = visibleYears.includes(year.year);
            return (
              <button
                aria-pressed={isVisible}
                className={`year-toggle__button year-toggle__button--${index}`}
                key={year.year}
                onClick={() => onToggleYear(year.year)}
                type="button"
              >
                <i />
                {year.year}
              </button>
            );
          })}
          <button aria-pressed={showOrderTrend} className="year-toggle__line-label" onClick={() => setShowOrderTrend((shown) => !shown)} type="button"><i />Orders (trend)</button>
        </div>
      </div>

      <div className="yearly-comparison-chart__plot">
        <div aria-hidden="true" className="yearly-comparison-chart__scale-labels">
          <span>Sales · {currency}</span>
          <span>Orders</span>
        </div>
        <svg
          aria-label={`Monthly store sales${showOrderTrend ? " and orders" : ""} for ${visibleYears.join(", ")}. Exact sales and orders are available in the monthly table.`}
          className="yearly-comparison-chart__svg"
          onMouseLeave={() => setActiveMonth(null)}
          role="img"
          viewBox={`0 0 ${YEARLY_CHART_WIDTH} ${YEARLY_CHART_HEIGHT}`}
        >
          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
            <g key={`axis:${fraction}`} className="yearly-comparison-chart__tick">
              <text x={YEARLY_CHART_LEFT - 10} y={salesY(maxSales * fraction) + 3} textAnchor="end">{formatValue(maxSales * fraction, "currency", currency, true)}</text>
              <text x={YEARLY_CHART_WIDTH - YEARLY_CHART_RIGHT + 10} y={ordersY(maxOrders * fraction) + 3} textAnchor="start">{numberFormatter.format(Math.round(maxOrders * fraction))}</text>
            </g>
          ))}
          {[0.25, 0.5, 0.75, 1].map((fraction) => (
            <line
              className="chart-grid-line"
              key={fraction}
              x1={YEARLY_CHART_LEFT}
              x2={YEARLY_CHART_WIDTH - YEARLY_CHART_RIGHT}
              y1={YEARLY_CHART_TOP + plotHeight * fraction}
              y2={YEARLY_CHART_TOP + plotHeight * fraction}
            />
          ))}

          {visible.map(({ year, seriesIndex }, visibleIndex) => {
            const groupWidth = barWidth * visible.length + barGap * (visible.length - 1);
            return year.months.map((month, monthIndex) => {
              const height = YEARLY_CHART_TOP + plotHeight - salesY(month.sales);
              return (
                <rect
                  className={`yearly-sales-bar yearly-sales-bar--${seriesIndex}${
                    month.isPartial ? " yearly-sales-bar--partial" : ""
                  }${activeMonth === monthIndex ? " yearly-sales-bar--active" : ""}`}
                  height={Math.max(height, 0)}
                  key={`${year.year}:sales:${month.month}`}
                  rx="1.5"
                  ry="1.5"
                  width={barWidth}
                  x={
                    centreFor(monthIndex) -
                    groupWidth / 2 +
                    visibleIndex * (barWidth + barGap)
                  }
                  y={YEARLY_CHART_TOP + plotHeight - Math.max(height, 0)}
                />
              );
            });
          })}

          {showOrderTrend && visible.map(({ year, seriesIndex }) => {
            const path = smoothLinePath(
              year.months.map((month, monthIndex) => ({
                x: centreFor(monthIndex),
                y: ordersY(month.orders),
              })),
            );
            return (
              <g key={`${year.year}:orders`}>
                <path
                  className={`yearly-orders-line yearly-orders-line--${seriesIndex}`}
                  d={path}
                  fill="none"
                />
                {year.months.map((month, monthIndex) => (
                  <circle
                    className={`yearly-orders-marker yearly-orders-marker--${seriesIndex}`}
                    cx={centreFor(monthIndex)}
                    cy={ordersY(month.orders)}
                    key={`${year.year}:orders:${month.month}`}
                    r={activeMonth === monthIndex ? 3.5 : 2.4}
                  />
                ))}
              </g>
            );
          })}

          {Array.from({ length: 12 }, (_, monthIndex) => (
            <rect
              className="chart-hit"
              height={YEARLY_CHART_HEIGHT}
              key={`month-hit:${monthIndex}`}
              onClick={() => setActiveMonth(monthIndex)}
              onFocus={() => setActiveMonth(monthIndex)}
              onMouseEnter={() => setActiveMonth(monthIndex)}
              tabIndex={0}
              width={slotWidth}
              x={YEARLY_CHART_LEFT + slotWidth * monthIndex}
              y="0"
            />
          ))}
        </svg>
        <ChartTooltip state={activeTooltip} />
        <div className="yearly-comparison-chart__axis" aria-hidden="true">
          {series[0]?.months.map((month) => (
            <span key={month.label}>{month.label.slice(0, 3)}</span>
          ))}
        </div>
      </div>
      <p className="yearly-comparison-chart__note">
        Sales use the left scale; orders use an independent right scale. A faded
        bar marks a month measured only through the active period end date.
      </p>
    </div>
  );
}

function YearlyPerformanceSection({
  yearly,
  currency,
}: {
  yearly: YearlyPerformance;
  currency: Currency;
}) {
  const allYears = yearly.comparisonYears.map((series) => series.year);
  const [visibleYears, setVisibleYears] = useState<number[]>(allYears);
  const [tableOpen, setTableOpen] = useState(false);
  const visibleSeries = yearly.comparisonYears.filter((series) =>
    visibleYears.includes(series.year),
  );
  const visibleMonthCount = Math.max(
    ...visibleSeries.map((series) => series.months.length),
    0,
  );

  function toggleYear(year: number) {
    setVisibleYears((current) =>
      current.includes(year)
        ? current.length === 1
          ? current
          : current.filter((value) => value !== year)
        : allYears.filter((value) => value === year || current.includes(value)),
    );
  }

  return (
    <section className="section yearly-performance" id="store-yearly">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Yearly performance</span>
          <h2>{yearly.twoYearsAgo}–{yearly.currentYear} store performance</h2>
        </div>
        <p>{yearly.ytd.label} compared like for like</p>
      </div>

      <div className="yearly-performance__workspace">

        <div className="metrics-grid yearly-performance__metrics">
          <article className="metric-card">
            <div className="metric-card__label">
              <span className="metric-label-inline">
                Sales year to date {yearly.currentYear}
                <MetricHint
                  label={`Sales year to date ${yearly.currentYear}`}
                  text={metricHintFor("salesYtd")!}
                />
              </span>
            </div>
            <div className="metric-card__value">
              {formatValue(yearly.ytd.currentSales, "currency", currency)}
            </div>
            <div className="metric-card__comparison">
              <DeltaBadge
                previousValue={yearly.ytd.previousSales}
                value={yearly.ytd.currentSales}
              />
              <span>vs {yearly.previousYear}</span>
            </div>
          </article>
          <article className="metric-card">
            <div className="metric-card__label">
              <span className="metric-label-inline">
                Sales year to date {yearly.previousYear}
                <MetricHint
                  label={`Sales year to date ${yearly.previousYear}`}
                  text={metricHintFor("salesYtd")!}
                />
              </span>
            </div>
            <div className="metric-card__value">
              {formatValue(yearly.ytd.previousSales, "currency", currency)}
            </div>
            <div className="metric-card__comparison">
              <span>same days last year</span>
            </div>
          </article>
          <article className="metric-card">
            <div className="metric-card__label">
              <span className="metric-label-inline">
                Orders year to date {yearly.currentYear}
                <MetricHint
                  label={`Orders year to date ${yearly.currentYear}`}
                  text={metricHintFor("ordersYtd")!}
                />
              </span>
            </div>
            <div className="metric-card__value">
              {numberFormatter.format(yearly.ytd.currentOrders)}
            </div>
            <div className="metric-card__comparison">
              <DeltaBadge
                previousValue={yearly.ytd.previousOrders}
                value={yearly.ytd.currentOrders}
              />
              <span>vs {yearly.previousYear}</span>
            </div>
          </article>
          <article className="metric-card">
            <div className="metric-card__label">
              <span className="metric-label-inline">
                Strongest month last year
                <MetricHint
                  label="Strongest month last year"
                  text={metricHintFor("strongestMonth")!}
                />
              </span>
            </div>
            <div className="metric-card__value">
              {yearly.bestMonth
                ? formatValue(yearly.bestMonth.sales, "currency", currency, true)
                : "N/A"}
            </div>
            <div className="metric-card__comparison">
              <span>
                {yearly.bestMonth
                  ? `${yearly.bestMonth.label} ${yearly.previousYear}, ${numberFormatter.format(yearly.bestMonth.orders)} orders`
                  : "No completed month"}
              </span>
            </div>
          </article>
        </div>

        <div className="yearly-performance__chart-block">
          <div className="yearly-performance__block-heading">
            <div>
              <span className="eyebrow">Monthly comparison</span>
              <h3>Sales and orders, month by month</h3>
            </div>
            <span>{visibleYears.length}-year view</span>
          </div>
          <YearlySalesOrdersChart
            currency={currency}
            onToggleYear={toggleYear}
            series={yearly.comparisonYears}
            visibleYears={visibleYears}
          />

        <div className={`yearly-data-disclosure${tableOpen ? " yearly-data-disclosure--open" : ""}`}>
          <button
            aria-controls="yearly-monthly-data"
            aria-expanded={tableOpen}
            className="yearly-data-disclosure__trigger"
            onClick={() => setTableOpen((open) => !open)}
            type="button"
          >
            <span aria-hidden="true" className="yearly-data-disclosure__icon">
              <i />
              <i />
              <i />
            </span>
            <span className="yearly-data-disclosure__copy">
              <strong>Explore the monthly data</strong>
              <small>
                Sales and orders for {visibleYears.join(", ")} · follows the year toggles above
              </small>
            </span>
            <span className="yearly-data-disclosure__action">
              {tableOpen ? "Hide table" : "Open table"}
              <ChevronIcon />
            </span>
          </button>

          {tableOpen && (
            <div className="yearly-data-disclosure__content" id="yearly-monthly-data">
              <div className="table-scroller">
                <table className="yearly-data-table">
                  <caption className="visually-hidden">
                    Monthly store sales and orders for {visibleYears.join(", ")}
                  </caption>
                  <thead>
                    <tr>
                      <th rowSpan={2} scope="col">Month</th>
                      {visibleSeries.map((series) => (
                        <th colSpan={2} key={series.year} scope="colgroup">
                          {series.year}
                        </th>
                      ))}
                    </tr>
                    <tr>
                      {visibleSeries.flatMap((series) => [
                        <th key={`${series.year}:sales`} scope="col">Sales</th>,
                        <th key={`${series.year}:orders`} scope="col">Orders</th>,
                      ])}
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: visibleMonthCount }, (_, monthIndex) => {
                      const referencePoint = visibleSeries.find(
                        (series) => series.months[monthIndex],
                      )?.months[monthIndex];
                      const partialPoint = visibleSeries.find(
                        (series) => series.months[monthIndex]?.isPartial,
                      )?.months[monthIndex];

                      return (
                        <tr key={referencePoint?.month ?? monthIndex}>
                          <th scope="row">
                            <span className="yearly-data-table__month">
                              {referencePoint?.label ?? `Month ${monthIndex + 1}`}
                              {partialPoint?.throughDay && (
                                <small>days 1–{partialPoint.throughDay}</small>
                              )}
                            </span>
                          </th>
                          {visibleSeries.flatMap((series) => {
                            const point = series.months[monthIndex];
                            return [
                              <td key={`${series.year}:${monthIndex}:sales`}>
                                {point
                                  ? formatValue(point.sales, "currency", currency)
                                  : "—"}
                              </td>,
                              <td key={`${series.year}:${monthIndex}:orders`}>
                                {point ? numberFormatter.format(point.orders) : "—"}
                              </td>,
                            ];
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
        <details className="panel card-notes">
          <summary>Yearly comparison basis</summary>
          <p>
            The chart compares {yearly.currentYear} with the two prior years.
            Current-month points stop on the same calendar day; KPI cards use
            {yearly.previousYear} as the like-for-like baseline. Chart and table
            follow the selected years.
          </p>
        </details>
              <details className="card-notes">
                <summary>Monthly data coverage</summary>
                <p>{yearly.note}</p>
              </details>
            </div>
          )}
        </div>
        </div>
      </div>
    </section>
  );
}

function Panel({
  title,
  eyebrow,
  meta,
  hint: explicitHint,
  className,
  children,
}: {
  title: string;
  eyebrow: string;
  meta?: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const normalizedTitle = title.toLowerCase();
  const hintKey = normalizedTitle.includes("average order value")
    ? "averageOrderValue"
    : normalizedTitle.includes("conversion rate")
      ? "conversionRate"
      : normalizedTitle.includes("total sales")
        ? "totalSales"
        : normalizedTitle.includes("sessions")
          ? "sessions"
          : null;
  const hint = explicitHint ?? (hintKey ? metricHintFor(hintKey) : null);

  return (
    <article className={`panel${className ? ` ${className}` : ""}`}>
      <div className="panel__heading">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h2>
            <span className="metric-label-inline">
              {title}
              {hint && <MetricHint label={title} text={hint} />}
            </span>
          </h2>
        </div>
        {meta && <span className="panel__meta">{meta}</span>}
      </div>
      {children}
    </article>
  );
}

/** Depth-first order of the store's product taxonomy, top to bottom. */
const CATALOGUE_LEVELS: CatalogueLevel[] = [
  "department",
  "subDepartment",
  "family",
  "product",
];

const CATALOGUE_LEVEL_TITLE: Record<CatalogueLevel, string> = {
  department: "Total sales by department",
  subDepartment: "Total sales by sub-department",
  family: "Total sales by family",
  product: "Total sales by product",
};

function getNodeYearlyTotals(
  stackData: CatalogueStack | null,
  targetYear: number,
  nodeKey: string,
): { value: number; orders: number } {
  if (!stackData) return { value: 0, orders: 0 };
  const yearObj = stackData.years.find((y) => y.year === targetYear);
  if (!yearObj) return { value: 0, orders: 0 };
  let valSum = 0;
  let ordSum = 0;
  for (const m of yearObj.months) {
    if (m.isFuture) continue;
    valSum += m.values[nodeKey] ?? 0;
    ordSum += m.orders?.[nodeKey] ?? 0;
  }
  return { value: Math.round(valSum), orders: ordSum };
}

/**
 * One panel for the whole product taxonomy instead of four disconnected
 * bar lists. A reader drills department → sub-department → family → product,
 * the same order the store itself clusters the catalogue in, so a product is only
 * ever reached after picking the branch it belongs to — never as a flat list
 * of thousands of SKUs on its own.
 */
function CatalogueBreakdownPanel({
  breakdown,
  comparison,
  currency,
  account,
}: {
  breakdown: CatalogueBreakdown;
  comparison: ComparisonView;
  currency: Currency;
  account: string;
}) {
  const [path, setPath] = useState<CatalogueNode[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [catalogueQuery, setCatalogueQuery] = useState("");
  const [focusYear, setFocusYear] = useState<number | null>(null);
  const [stackResult, setStackResult] = useState<{
    requestKey: string;
    stack: CatalogueStack | null;
  } | null>(null);

  const depth = path.length;
  const level = CATALOGUE_LEVELS[depth] ?? "product";
  const parentKey = path.at(-1)?.key ?? null;
  const levelRows = breakdown[level].filter((row) => row.parentKey === parentKey);
  const isDepartment = level === "department";
  const isTopFifteen = level === "family" || level === "product";
  const drillRows = catalogueRowsForDisplay(levelRows, level);
  const normalizedQuery = catalogueQuery.trim().toLowerCase();
  const isSearching = normalizedQuery.length > 0;
  const searchResults = breakdown.product
    .filter(
      (row) =>
        row.label.toLowerCase().includes(normalizedQuery) ||
        row.sku?.toLowerCase().includes(normalizedQuery),
    )
    .slice(0, 20);
  const rows = isSearching ? searchResults : drillRows;
  const chartNodes = isSearching ? [] : drillRows;

  // Identifies which scope a fetched (or in-flight) stack answers. Deriving
  // loading/stack from a match against this in render, instead of a separate
  // loading flag set inside the effect, is what keeps the effect's only
  // setState call inside the fetch's own callback.
  const stackRequestKey = `${level}:${parentKey ?? ""}:${account}`;
  const stackLoading = stackResult?.requestKey !== stackRequestKey;
  const stack = stackResult?.requestKey === stackRequestKey ? stackResult.stack : null;

  // The chart's legend is whichever top rows are already on screen, so a
  // drill-down step or a data refresh always re-fetches its own scope.
  useEffect(() => {
    // Nothing to chart: the render above already falls back to chartNodes
    // directly for this case, so there is nothing to fetch.
    if (chartNodes.length === 0) return;

    const controller = new AbortController();
    const requestKey = stackRequestKey;
    const params = new URLSearchParams({
      level,
      account,
      nodes: JSON.stringify(
        chartNodes.map((node) => ({
          key: node.key,
          slug: node.slug,
          label: node.label,
        })),
      ),
    });
    if (parentKey !== null) params.set("parentKey", parentKey);

    fetch(`/api/catalogue-stack?${params}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => (response.ok ? (response.json() as Promise<CatalogueStack>) : null))
      .then((data) => setStackResult({ requestKey, stack: data }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setStackResult({ requestKey, stack: null });
      });

    return () => controller.abort();
    // chartNodes is derived fresh every render from breakdown/level/parentKey;
    // keying on those three plus account is equivalent and avoids re-running
    // on identity changes alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, parentKey, account, breakdown]);

  const isYearlyMode = focusYear !== null;

  const totalLevelYearValue =
    isYearlyMode && stack
      ? rows.reduce(
          (sum, row) =>
            sum + getNodeYearlyTotals(stack, focusYear, row.key).value,
          0,
        )
      : 0;

  const displayRows = rows
    .map((row) => {
      if (!isYearlyMode || !stack) {
        return {
          key: row.key,
          label: row.label,
          path: row.path,
          sku: row.sku,
          value: row.value,
          orders: row.orders,
          previousValue: row.previousValue,
          share: row.share,
          rawNode: row,
        };
      }
      const currentTotals = getNodeYearlyTotals(stack, focusYear, row.key);
      const priorTotals = getNodeYearlyTotals(stack, focusYear - 1, row.key);
      return {
        key: row.key,
        label: row.label,
        path: row.path,
        sku: row.sku,
        value: currentTotals.value,
        orders: currentTotals.orders,
        previousValue: priorTotals.value > 0 ? priorTotals.value : null,
        share:
          totalLevelYearValue > 0
            ? currentTotals.value / totalLevelYearValue
            : 0,
        rawNode: row,
      };
    })
    .toSorted((left, right) =>
      isYearlyMode
        ? right.value - left.value || left.label.localeCompare(right.label)
        : 0,
    );

  const active = displayRows.find((row) => row.key === activeKey) ?? null;

  const activeChange =
    active === null || active.previousValue === null
      ? null
      : getPercentChange(active.value, active.previousValue);

  const comparisonLabel = isYearlyMode
    ? `vs ${focusYear - 1}`
    : comparison.label;

  const comparisonCaption = isYearlyMode
    ? `${focusYear} ${focusYear === 2026 ? "YTD" : "full year"} vs ${focusYear - 1}`
    : comparison.caption;

  const comparisonTooltipRows =
    active === null
      ? []
      : active.previousValue === null
        ? [{ label: "Comparison", value: "Off", muted: true }]
        : [
            {
              label: comparisonLabel,
              value: formatValue(active.previousValue, "currency", currency),
              muted: true,
            },
            {
              label: "Change",
              value:
                activeChange === "new"
                  ? "New"
                  : activeChange === "no-change"
                    ? "No change"
                    : `${typeof activeChange === "number" && activeChange >= 0 ? "+" : ""}${(
                        typeof activeChange === "number" ? activeChange : 0
                      ).toFixed(1)}%`,
              tone: tooltipToneForTrend(active.value, active.previousValue),
            },
          ];
  const tooltip: TooltipState | null = active
    ? {
        title: active.label,
        anchor: 0.5,
        rows: [
          { label: "Value", value: formatValue(active.value, "currency", currency) },
          { label: "Orders", value: numberFormatter.format(active.orders) },
          ...comparisonTooltipRows,
          { label: "Share of total", value: `${(active.share * 100).toFixed(1)}%` },
        ],
      }
    : null;

  return (
    <article className="panel catalogue-panel">
      <div className="panel__heading">
        <div>
          <span className="eyebrow">Catalogue</span>
          <h2>{isSearching ? "SKU search results" : CATALOGUE_LEVEL_TITLE[level]}</h2>
        </div>
        <span className="panel__meta">
          {isSearching
            ? `${displayRows.length} match${displayRows.length === 1 ? "" : "es"} across the catalogue`
            : `${
                isTopFifteen
                  ? `Top ${CATALOGUE_TOP_COUNT} by sales value`
                  : isDepartment
                    ? "Every department"
                    : "Every sub-department"
              } · ${comparisonCaption}`}
        </span>
      </div>

      <div className="catalogue-search">
        <SearchIcon />
        <label>
          <span className="visually-hidden">
            Search catalogue by product name or SKU
          </span>
          <input
            autoComplete="off"
            onChange={(event) => setCatalogueQuery(event.target.value)}
            placeholder="Search product name or SKU…"
            type="search"
            value={catalogueQuery}
          />
        </label>
        {isSearching && (
          <button onClick={() => setCatalogueQuery("")} type="button">
            Clear
          </button>
        )}
      </div>

      <nav aria-label="Catalogue drill-down" className="catalogue-crumbs">
        <button
          className={`catalogue-crumbs__link${depth === 0 ? " catalogue-crumbs__link--current" : ""}`}
          disabled={depth === 0}
          onClick={() => {
            setPath([]);
          }}
          type="button"
        >
          All departments
        </button>
        {path.map((node, index) => (
          <span key={node.key}>
            <span aria-hidden="true" className="catalogue-crumbs__sep">
              /
            </span>
            <button
              className={`catalogue-crumbs__link${
                index === path.length - 1
                  ? " catalogue-crumbs__link--current"
                  : ""
              }`}
              disabled={index === path.length - 1}
              onClick={() => {
                setPath(path.slice(0, index + 1));
              }}
              type="button"
            >
              {node.label}
            </button>
          </span>
        ))}
      </nav>

      {!isSearching && <div className="catalogue-stack">
        <div className="catalogue-stack__heading">
          <span className="eyebrow">
            {isTopFifteen
              ? `Top ${CATALOGUE_TOP_COUNT}`
              : isDepartment
                ? "Every department"
                : "Every sub-department"}{" "}
            · monthly composition
          </span>
          <span className="panel__meta">
            {path.at(-1)?.label ?? "Store-wide"}
          </span>
        </div>
        {chartNodes.length === 0 ? (
          <div className="empty-state">No data for this date range.</div>
        ) : stackLoading ? (
          <div className="empty-state">Loading monthly composition…</div>
        ) : stack && stack.years.some((year) => year.months.length > 0) ? (
          <StackedBarChart
            ariaLabel={`Monthly ${CATALOGUE_LEVEL_TITLE[level].toLowerCase()}`}
            focusYear={focusYear}
            formatAxisValue={(value) => formatValue(value, "currency", currency, true)}
            formatValue={(value) => formatValue(value, "currency", currency)}
            onFocusYearChange={setFocusYear}
            otherLabel="Other"
            segments={stack.nodes}
            years={stack.years}
          />
        ) : (
          <div className="empty-state">No monthly data available.</div>
        )}
      </div>}

      {displayRows.length === 0 ? (
        <div className="empty-state">No data for this date range.</div>
      ) : (
        <div className="chart-plot">
          <ul
            className={`bar-list catalogue-rows${
              activeKey === null ? "" : " bar-list--hovered"
            }`}
          >
            {displayRows.map((row) => {
              const canDrillIn = !isSearching && level !== "product";
              const Row = canDrillIn ? "button" : "div";
              const seriesIndex = Math.max(0, (stack?.nodes ?? rows).findIndex((node) => node.key === row.key));

              return (
                <li
                  className={
                    activeKey === row.key ? "bar-list__row--active" : ""
                  }
                  key={row.key}
                >
                  <Row
                    className="catalogue-row"
                    onClick={
                      canDrillIn
                        ? () => {
                            setPath([...path, row.rawNode]);
                          }
                        : undefined
                    }
                    onFocus={() => setActiveKey(row.key)}
                    onMouseEnter={() => setActiveKey(row.key)}
                    onMouseLeave={() => setActiveKey(null)}
                    tabIndex={canDrillIn ? undefined : 0}
                    type={canDrillIn ? "button" : undefined}
                  >
                    <div className="bar-list__meta catalogue-row__meta">
                      <span className="catalogue-row__label">
                        <span className="bar-list__label">{row.label}</span>
                        <small className="catalogue-row__slug">
                          {row.sku && <b>{row.sku}</b>}
                          {row.path}
                        </small>
                      </span>
                      <span className="catalogue-row__stats">
                        <small className="catalogue-row__orders">
                          {numberFormatter.format(row.orders)} order
                          {row.orders === 1 ? "" : "s"}
                        </small>
                        <span className="bar-list__value">
                          <strong className="bar-list__share">{(row.share * 100).toFixed(1)}%</strong>
                          {formatValue(row.value, "currency", currency)}
                        </span>
                        {(isYearlyMode
                          ? row.previousValue !== null
                          : comparison.enabled) && (
                          <DeltaBadge
                            previousValue={row.previousValue}
                            value={row.value}
                          />
                        )}
                      </span>
                      {canDrillIn && <ChevronIcon className="catalogue-row__chevron" />}
                    </div>
                    <div className="bar-list__track">
                      <span
                        className={`bar-list__fill bar-list__fill--catalogue-${seriesIndex % 20} ${
                          activeKey === row.key ? "bar-list__fill--active" : ""
                        }`}
                        style={{
                          width: `${Math.min(100, Math.max(0, row.share * 100))}%`,
                        }}
                      />
                    </div>
                  </Row>
                </li>
              );
            })}
          </ul>
          <ChartTooltip state={tooltip} />
        </div>
      )}

      <details className="card-notes">
        <summary>Catalogue coverage</summary>
        <p>
        {isSearching
          ? "Search reads the complete product index, so a product can be found without opening each taxonomy branch."
          : `Department and sub-department remain complete. Family and product are ranked by sales value and limited to Top ${CATALOGUE_TOP_COUNT}. Each row carries its full drill slug.`}
        </p>
      </details>
    </article>
  );
}

export function StoreAnalyticsShell({
  initialSnapshot,
  initialModeStatus,
  viewer,
  accounts,
  selectedAccount,
  referenceDates,
}: StoreAnalyticsShellProps) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [modeStatus, setModeStatus] = useState(initialModeStatus);
  const [account, setAccount] = useState(selectedAccount);
  const [range, setRange] = useState(initialSnapshot.selectedRange);
  // Seeded from the server's own resolution and nothing else, so the server
  // HTML and the first client render are identical. Reading localStorage here
  // is what made them disagree: the server has no localStorage, always fell
  // through to the fixture label, and a browser holding "live" then rendered a
  // different badge, sidebar card and footer on its first pass. React reports
  // that as a hydration mismatch and throws away the server markup for the
  // subtree. The stored preference is applied after mount instead.
  const [isDummyMode, setIsDummyMode] = useState<boolean>(
    initialModeStatus.resolved === "mock",
  );
  // This page draws its own chrome, so it carries the same mobile drawer
  // control as AppFrame; without it the sidebar was unreachable at ≤760px.
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const topbarRef = useUtilityBarHeight();
  const tableLayoutRef = useResponsiveTables();
  const closeMobileNav = useCallback(() => setIsMobileNavOpen(false), []);
  const [comparisonWindow, setComparisonWindow] =
    useState<ComparisonWindow>("previous");
  /** The reader's own baseline dates. Only sent when the window is "custom". */
  const [customComparisonRange, setCustomComparisonRange] =
    useState<DateRange | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(
    initialSnapshot.lastSuccessfulSync,
  );
  const [message, setMessage] = useState(initialSnapshot.currencyNote);
  const currency = snapshot.store.currency;
  const modeBadge = describeModeBadge(isDummyMode, modeStatus);
  const comparison = describeComparison(snapshot);
  const isCondensed = useCondensedOnScroll();
  const canTriggerSync = hasPermission(viewer.role, "sync:trigger");
  // A customer-match file carries names, emails, phone numbers and postal
  // codes. Reading performance does not entitle anyone to that, so the export
  // is absent for a viewer rather than present and refused.
  const canExportAudience = hasPermission(viewer.role, "audience:export");
  const isBusy = isApplying || isRefreshing;
  const activeAccountName =
    accounts.find((option) => option.slug === account)?.name ?? snapshot.store.name;
  const kpiSeries: Partial<Record<StoreKpi["key"], TimeSeries>> = {
    totalSales: snapshot.salesOverTime,
    averageOrderValue: snapshot.averageOrderValueOverTime,
    sessions: snapshot.sessionsOverTime,
    conversionRate: snapshot.conversionRateOverTime,
  };

  /** Fills a request from the applied state so one changed filter never
   *  silently drops the others. */
  function currentQuery(overrides: Partial<StoreQuery> = {}): StoreQuery {
    return {
      range: overrides.range ?? range,
      account: overrides.account ?? account,
      mode: overrides.mode ?? (isDummyMode ? "mock" : "live"),
      comparisonEnabled:
        overrides.comparisonEnabled ?? snapshot.comparisonEnabled,
      comparisonWindow: overrides.comparisonWindow ?? comparisonWindow,
      comparisonRange:
        overrides.comparisonRange === undefined
          ? customComparisonRange
          : overrides.comparisonRange,
    };
  }

  function queryParams(query: StoreQuery): URLSearchParams {
    return new URLSearchParams({
      start: query.range.start,
      end: query.range.end,
      account: query.account,
      mode: query.mode,
      compare: query.comparisonEnabled ? query.comparisonWindow : "off",
      ...(query.comparisonEnabled &&
      query.comparisonWindow === "custom" &&
      query.comparisonRange
        ? {
            compareStart: query.comparisonRange.start,
            compareEnd: query.comparisonRange.end,
          }
        : {}),
    });
  }

  function applySnapshot(next: StoreAnalyticsPayload) {
    setSnapshot(next);
    setRange(next.selectedRange);
    setLastSyncAt((current) =>
      latestSyncTimestamp(current, next.lastSuccessfulSync),
    );
    // Absent only from a response that predates the sibling key. Keeping the
    // previous status beats resetting it, which would flip the badge back to
    // "Store fixtures" on an otherwise healthy live refetch.
    if (next.modeStatus) setModeStatus(next.modeStatus);
  }

  async function loadSnapshot(
    overrides: Partial<StoreQuery>,
    pendingMessage: string,
  ): Promise<boolean> {
    setIsApplying(true);
    setMessage(pendingMessage);

    try {
      const response = await fetch(
        `/api/store-analytics?${queryParams(currentQuery(overrides))}`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as
        | StoreAnalyticsPayload
        | { error: string };

      if (!response.ok || "error" in payload) {
        throw new Error(
          "error" in payload
            ? payload.error
            : "That timeframe was rejected. Check the dates and try again.",
        );
      }

      applySnapshot(payload);
      setMessage(payload.currencyNote);
      return true;
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Store analytics could not be loaded.",
      );
      return false;
    } finally {
      setIsApplying(false);
    }
  }

  /**
   * The picker commits the active period and its baseline together, so one
   * request carries both and no panel renders a half-applied state where the
   * dates moved but the comparison had not caught up.
   */
  async function applyPeriod(selection: PeriodSelection) {
    const applied = await loadSnapshot(
      {
        range: selection.range,
        comparisonEnabled: selection.comparisonEnabled,
        comparisonWindow: selection.comparisonWindow,
        comparisonRange: selection.comparisonRange,
      },
      "Applying reporting period…",
    );

    if (applied) {
      setComparisonWindow(selection.comparisonWindow);
      setCustomComparisonRange(selection.comparisonRange);
    }
  }

  async function handleToggleDataMode(nextDummy: boolean) {
    if (isBusy || nextDummy === isDummyMode) return;

    const previousMode = isDummyMode;
    setIsDummyMode(nextDummy);
    rememberDataMode(nextDummy);

    const applied = await loadSnapshot(
      { mode: nextDummy ? "mock" : "live" },
      nextDummy
        ? "Switching to Simulated Demo Data…"
        : "Switching to Live Data…",
    );

    if (applied) {
      setMessage(
        nextDummy
          ? "Switched to Simulated Demo Data (Mock Mode)."
          : "Switched to Live Data feed (Supabase Storage).",
      );
      return;
    }

    setIsDummyMode(previousMode);
    rememberDataMode(previousMode);
  }

  async function refreshData() {
    setIsRefreshing(true);
    setMessage(
      isDummyMode ? "Refreshing dummy store data…" : "Refreshing live store data…",
    );

    const query = currentQuery();

    try {
      const response = await fetch("/api/store-analytics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start: query.range.start,
          end: query.range.end,
          account: query.account,
          mode: query.mode,
          compare: query.comparisonEnabled ? query.comparisonWindow : "off",
          ...(query.comparisonEnabled &&
          query.comparisonWindow === "custom" &&
          query.comparisonRange
            ? {
                compareStart: query.comparisonRange.start,
                compareEnd: query.comparisonRange.end,
              }
            : {}),
        }),
      });
      const payload = (await response.json()) as
        | StoreAnalyticsPayload
        | { error: string };

      if (!response.ok || "error" in payload) {
        throw new Error(
          "error" in payload ? payload.error : "Store refresh failed.",
        );
      }

      applySnapshot(payload);
      setMessage(
        isDummyMode
          ? "Dummy store refresh completed. No live store data was requested."
          : "Live store refresh completed. Synthetic sections remain explicitly marked.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Store refresh failed.",
      );
    } finally {
      setIsRefreshing(false);
    }
  }

  return (
    <div className="app-frame app-frame--store">
      <a className="skip-link" href="#main-content">Skip to store analytics</a>

      <DashboardSidebar
        activeHref="/store-analytics"
        mobileOpen={isMobileNavOpen}
        onMobileClose={closeMobileNav}
      >
        {/* Same source as the hero badge and the footer, so the three cannot
            disagree about what the reader is looking at. */}
        <div className="preview-card">
          <span className="eyebrow">Current gate</span>
          <strong>{modeBadge.label}</strong>
          <p>{modeBadge.title}</p>
        </div>
        <Link className="text-link" href="/">Back to paid media →</Link>
      </DashboardSidebar>

      <main className="main-panel" id="main-content" ref={tableLayoutRef}>
        <header className="topbar" ref={topbarRef}>
          <button
            aria-controls="dashboard-primary-navigation"
            aria-expanded={isMobileNavOpen}
            aria-label="Open navigation"
            className="mobile-nav-toggle"
            onClick={() => setIsMobileNavOpen(true)}
            type="button"
          >
            <MenuIcon />
          </button>
          <Link className="mobile-brand" href="/" aria-label="Satulayar dashboard">
            <BrandMark />
            <strong>Satulayar</strong>
          </Link>
          <div aria-label="Active store scope" className="topbar__scope">
            <AccountField
              accounts={accounts}
              disabled={isBusy}
              onChange={(slug) => {
                void loadSnapshot({ account: slug }, "Switching account…").then(
                  (applied) => {
                    if (!applied) return;
                    setAccount(slug);
                    rememberAccount(slug);
                  },
                );
              }}
              value={account}
              variant="utility"
            />
          </div>
          <div className="topbar__operations">
          <div className="topbar__context">
            <span className="status-dot" />
            <span>Store source</span>
            <strong>{snapshot.store.source}</strong>
          </div>
          <div
            aria-label="Store Analytics Data Mode"
            className="topbar__data-mode-toggle"
            role="group"
          >
            <button
              aria-pressed={!isDummyMode}
              className={`mode-toggle-btn ${
                !isDummyMode
                  ? "mode-toggle-btn--active mode-toggle-btn--live"
                  : ""
              }`}
              disabled={isBusy}
              onClick={() => void handleToggleDataMode(false)}
              title="Live ad and store data from Supabase storage"
              type="button"
            >
              <span className="mode-toggle-dot mode-toggle-dot--live" />
              Live Data
            </button>
            <button
              aria-pressed={isDummyMode}
              className={`mode-toggle-btn ${
                isDummyMode
                  ? "mode-toggle-btn--active mode-toggle-btn--dummy"
                  : ""
              }`}
              disabled={isBusy}
              onClick={() => void handleToggleDataMode(true)}
              title="Interactive simulated demo data (Mock Mode)"
              type="button"
            >
              <span className="mode-toggle-dot mode-toggle-dot--dummy" />
              Dummy Data
            </button>
          </div>
          <div className="topbar__meta">
            <span>Reporting currency</span>
            <strong>{currency}</strong>
            <small>{snapshot.store.timezone}</small>
          </div>
          <AccountSyncTime
            label="Last store data sync"
            lastSyncAt={lastSyncAt}
            timeZone={snapshot.store.timezone}
          />
          </div>
          <div className="topbar__session" aria-label="Display and account controls">
          <ThemeToggle />
          <div className="viewer-menu">
            <span className="viewer-menu__identity">
              <small>
                {viewer.mode === "preview"
                  ? "Local preview"
                  : viewer.email ?? "Signed in"}
              </small>
              <strong>{viewer.role.replace("_", " ")}</strong>
            </span>
            <form action="/api/auth/sign-out" method="post">
              <button className="viewer-menu__signout" type="submit">
                Sign out
              </button>
            </form>
          </div>
          </div>
        </header>

        <div
          aria-busy={isBusy}
          className={`content${isBusy ? " content--loading" : ""}`}
        >
          <div className="store-reporting-header">
          <section className="hero hero--dashboard hero--store" id="store-overview">
            <div className="hero__copy">
              <h1>Store performance</h1>
              <div className="hero__kicker">
                <span className="hero__currency">
                  {activeAccountName} · {currency}
                </span>
                <span className={modeBadge.className} title={modeBadge.title}>
                  {modeBadge.label}
                </span>
              </div>
            </div>
          </section>

          {/* The picker commits its own draft, so this bar groups controls
              rather than submitting a form. */}
          <div
            aria-label="Reporting period and data refresh"
            className={`store-period-toolbar ${
              isCondensed ? "store-period-toolbar--condensed" : ""
            }`}
            role="group"
          >
            <PeriodPicker
              activeRange={snapshot.selectedRange}
              comparisonEnabled={snapshot.comparisonEnabled}
              comparisonRange={snapshot.comparisonRange}
              comparisonWindow={comparisonWindow}
              customComparisonRange={customComparisonRange}
              disabled={isBusy}
              onApply={(selection) => void applyPeriod(selection)}
              referenceDate={
                referenceDates[account] ?? initialSnapshot.selectedRange.end
              }
              quickPresets
            />
            {!isDummyMode && <div className="filter-actions">
              <button
                className="button button--primary"
                disabled={isBusy || !canTriggerSync}
                onClick={refreshData}
                type="button"
              >
                <RefreshIcon className={isRefreshing ? "spin" : ""} />
                {isRefreshing
                  ? "Refreshing…"
                  : canTriggerSync
                    ? "Refresh data"
                    : "View-only access"}
              </button>
            </div>}
            <details className="store-period-context">
              <summary>Reporting context · {formatDate(snapshot.selectedRange.start)} – {formatDate(snapshot.selectedRange.end)}</summary>
            <div
              aria-label="Applied active and comparison periods"
              className="filter-period-summary"
            >
              <span className="filter-period-summary__range filter-period-summary__range--active">
                <small>Active period</small>
                <b>
                  {formatDate(snapshot.selectedRange.start)} –{" "}
                  {formatDate(snapshot.selectedRange.end)}
                </b>
              </span>
              <span aria-hidden="true" className="filter-period-summary__link">
                {comparison.enabled ? "compared with" : "reported alone"}
              </span>
              <span className="filter-period-summary__range filter-period-summary__range--comparison">
                <small>{snapshot.comparisonBasis.label}</small>
                <b>
                  {comparison.enabled
                    ? `${formatDate(snapshot.comparisonRange.start)} – ${formatDate(
                        snapshot.comparisonRange.end,
                      )}`
                    : "Compare is off"}
                </b>
              </span>
              <span className="filter-period-summary__basis">
                {!comparison.enabled
                  ? "No period-over-period figures"
                  : snapshot.comparisonBasis.normalisedToActiveDuration
                    ? `Daily-rate normalised to ${snapshot.comparisonBasis.activeDays} days`
                    : `${snapshot.comparisonBasis.activeDays}-day like-for-like`}
              </span>
            </div>
            <p aria-live="polite" className="filter-message">
              {message}
            </p>
            </details>
          </div>
          </div>

          <YearlyPerformanceSection
            currency={currency}
            key={`${snapshot.store.id}:${snapshot.yearlyPerformance.currentYear}`}
            yearly={snapshot.yearlyPerformance}
          />

          <section className="section" id="store-rfm">
            <RfmAnalysisPanel
              accountSlug={account}
              analysis={snapshot.rfm}
              canExportAudience={canExportAudience}
              currency={currency}
              dataMode={snapshot.mode}
              key={`${snapshot.store.id}:${snapshot.rfm.asOfDate}`}
            />
          </section>

          <section className="section" id="store-cohorts">
            <CohortMatrix
              asOf={formatDate(snapshot.selectedRange.end)}
              rows={snapshot.cohorts}
            />
          </section>

          <section className="section" id="store-scorecard">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Store scorecard</span>
                <h2>
                  {formatDate(snapshot.selectedRange.start)} –{" "}
                  {formatDate(snapshot.selectedRange.end)}
                </h2>
              </div>
              <p>
                {comparison.enabled
                  ? `Compared with ${formatDate(
                      snapshot.comparisonRange.start,
                    )} – ${formatDate(snapshot.comparisonRange.end)} · ${
                      snapshot.comparisonBasis.label
                    }`
                  : "Compare is off, so this period is reported on its own."}
              </p>
            </div>
            <div className="scorecard-bridge">
              <OrderFulfillmentRail kpis={snapshot.kpis} />
              <UnitEconomicsCard
                currency={currency}
                unitEconomics={snapshot.unitEconomics}
              />
            </div>
            <div className="metrics-grid">
              {snapshot.kpis.map((item) => (
                <KpiCard
                  comparisonCaption={comparison.caption}
                  currency={currency}
                  key={item.key}
                  kpi={item}
                  series={kpiSeries[item.key]}
                />
              ))}
            </div>
          </section>

          <section className="section split-grid" id="store-sales">
            <Panel
              eyebrow="Revenue"
              meta={`${snapshot.salesOverTime.points.length} days`}
              title="Total sales over time"
            >
              <SeriesChart
                comparison={comparison}
                currency={currency}
                series={snapshot.salesOverTime}
              />
            </Panel>
            <Panel eyebrow="Revenue" title="Total sales breakdown">
              <BreakdownList currency={currency} rows={snapshot.salesBreakdown} />
            </Panel>
          </section>

          <section className="section split-grid">
            <Panel eyebrow="Revenue" title="Average order value over time">
              <SeriesChart
                comparison={comparison}
                currency={currency}
                series={snapshot.averageOrderValueOverTime}
              />
            </Panel>
            <Panel eyebrow="Revenue" title="Total sales by sales channel">
              <ShareDonut
                comparison={comparison}
                currency={currency}
                label="Total sales by sales channel"
                rows={snapshot.salesByChannel}
                unit="currency"
              />
            </Panel>
          </section>

          <section className="section split-grid" id="store-traffic">
            <Panel eyebrow="Traffic" title="Sessions over time">
              <SeriesChart
                comparison={comparison}
                currency={currency}
                series={snapshot.sessionsOverTime}
              />
            </Panel>
            <Panel eyebrow="Traffic" title="Conversion rate over time">
              <SeriesChart
                comparison={comparison}
                currency={currency}
                series={snapshot.conversionRateOverTime}
              />
            </Panel>
          </section>

          <section className="section split-grid split-grid--funnel">
            <Panel
              className="panel--funnel panel--funnel-conversion"
              eyebrow="Funnel"
              title="Conversion rate breakdown"
            >
              <FunnelList
                currency={currency}
                showValue={false}
                steps={snapshot.conversionFunnel}
                variant="conversion"
              />
            </Panel>
            <Panel
              className="panel--funnel panel--funnel-value"
              eyebrow="Funnel"
              title="Total sales by funnel stage"
            >
              <FunnelList
                currency={currency}
                showValue
                steps={snapshot.salesFunnel}
                variant="value"
              />
            </Panel>
          </section>

          <section className="section" id="store-catalogue">
            <CatalogueBreakdownPanel
              account={account}
              breakdown={snapshot.catalogue}
              comparison={comparison}
              currency={currency}
              key={`${snapshot.generatedAt}:${account}`}
            />
          </section>

          <section className="section" id="store-audience">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Audience</span>
                <h2>Who is landing on the store</h2>
              </div>
              <p>
                Device, location, and landing page for{" "}
                {formatDate(snapshot.selectedRange.start)} –{" "}
                {formatDate(snapshot.selectedRange.end)}
              </p>
            </div>
            <div className="split-grid split-grid--triple">
              <Panel eyebrow="Audience" title="Sessions by device type">
                <ShareDonut
                  comparison={comparison}
                  currency={currency}
                  label="Sessions by device type"
                  rows={snapshot.sessionsByDevice}
                  unit="count"
                />
              </Panel>
              <Panel eyebrow="Audience" title="Sessions by location">
                <ShareBarList
                  comparison={comparison}
                  currency={currency}
                  rows={snapshot.sessionsByLocation}
                  unit="count"
                />
              </Panel>
              <Panel eyebrow="Audience" title="Sessions by landing page">
                <ShareBarList
                  comparison={comparison}
                  currency={currency}
                  rows={snapshot.sessionsByLandingPage}
                  unit="count"
                />
              </Panel>
            </div>
          </section>

          <section className="section split-grid" id="store-referrers">
            <Panel eyebrow="Referrers" title="Sessions by social referrer">
              <ShareBarList
                comparison={comparison}
                currency={currency}
                rows={snapshot.sessionsBySocialReferrer}
                unit="count"
              />
            </Panel>
            <Panel eyebrow="Referrers" title="Total sales by social referrer">
              <ShareBarList
                comparison={comparison}
                currency={currency}
                rows={snapshot.salesBySocialReferrer}
                unit="currency"
              />
            </Panel>
          </section>

          <section className="section">
            <ChannelPerformancePanel
              currency={currency}
              rows={snapshot.performanceByReferringChannel}
            />
          </section>

          <footer className="footer">
            <span>Satulayar store analytics · {modeBadge.label}</span>
            <span>
              Source: {snapshot.store.source} · currency: {currency} · never
              converted
            </span>
          </footer>
        </div>
      </main>
    </div>
  );
}
