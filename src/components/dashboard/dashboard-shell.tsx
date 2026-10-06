"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";

import type {
  Currency,
  DashboardSnapshot,
  DateRange,
  Platform,
  SyncJob,
  TrendPoint,
} from "@/lib/dashboard/types";
import {
  GoogleAdsIcon,
  MetaAdsIcon,
  RefreshIcon,
  TrendIcon,
} from "@/components/dashboard/icons";
import { LineChart } from "@/components/charts/line-chart";
import { StackedShareBars } from "@/components/charts/stacked-share-bars";
import { DeviceSection } from "@/components/device/device-section";
import { MetaAudienceSection } from "@/components/audience/meta-audience-section";
import { GoogleAudienceSection } from "@/components/audience/google-audience-section";
import { GeoSection, type GeoSelection } from "@/components/geo/geo-section";
import { MetaCreativeRadar } from "@/components/campaigns/meta-creative-radar";
import { BlendedMerSection } from "@/components/dashboard/blended-mer-section";
import {
  AccountField,
  PlatformField,
  rememberAccount,
} from "@/components/dashboard/filter-fields";
import {
  PeriodPicker,
  type PeriodSelection,
} from "@/components/dashboard/period-picker";
import { AppFrame } from "@/components/dashboard/app-frame";
import { AccountSyncTime } from "@/components/dashboard/clocks";
import { useCondensedOnScroll } from "@/components/dashboard/use-condensed-on-scroll";
import {
  latestSyncTimestamp,
  syncCompletionTimestamp,
} from "@/lib/dashboard/sync-status";
import { dataStatusTone } from "@/lib/dashboard/data-quality";
import {
  resolveAccount,
  resolvePlatformForAccount,
  type AccountOption,
} from "@/lib/dashboard/accounts";
import {
  IMPRESSION_SHARE_TIERS,
  type ImpressionShareTierKey,
} from "@/lib/dashboard/impression-share";
import {
  budgetsCookieName,
  LEGACY_BUDGETS_COOKIE,
  serialiseBudgets,
  type MonthlyBudgets,
} from "@/lib/dashboard/budget";
import {
  isSectionVisible,
  pendingSyntheticPanels,
  type PendingPanel,
} from "@/lib/dashboard/sections";
import { CampaignTypeSection } from "@/components/campaigns/campaign-type-section";
import { SearchTermSection } from "@/components/search/search-term-section";
import type { ComparisonWindow } from "@/lib/dashboard/search-terms";
import {
  normaliseTargets,
  serialiseTargets,
  TARGETS_COOKIE,
  type PerformanceTargets,
} from "@/lib/dashboard/targets";
import { hasPermission } from "@/lib/auth/authorization";
import type { DashboardViewer } from "@/lib/auth/types";
import { BudgetPacingCard } from "@/components/dashboard/budget-pacing-card";
import { CustomerJourneyRail } from "@/components/dashboard/customer-journey-rail";
import { PlatformPerformanceSection } from "@/components/dashboard/platform-performance-section";
import { SnapshotCard } from "@/components/dashboard/snapshot-card";
import { TimezoneMismatchDisclaimer } from "@/components/dashboard/timezone-mismatch-disclaimer";
import { currentDateInTimeZone } from "@/lib/dashboard/timeframes";
import {
  JOURNEY_STAGES,
  JOURNEY_TREND_METRICS,
  type JourneyTrendMetricDefinition,
  type JourneyTrendMetricKey,
} from "@/lib/dashboard/scorecard";

interface DashboardShellProps {
  initialSnapshot: DashboardSnapshot;
  initialLastDataSyncAt: string | null;
  viewer: DashboardViewer;
  accounts: AccountOption[];
  selectedAccount: string;
  referenceDates: Record<string, string>;
  initialTargets: PerformanceTargets;
  initialBudgets: MonthlyBudgets;
}

interface Filters {
  start: string;
  end: string;
  platform: Platform;
}

type SnapshotOverrides = Partial<
  Filters & {
    account: string;
    targets: PerformanceTargets;
    budgets: MonthlyBudgets;
    geo: GeoSelection;
    comparisonEnabled: boolean;
    comparisonWindow: ComparisonWindow;
    comparisonRange: DateRange | null;
    isDummyMode: boolean;
  }
>;

// ponytail: locale stays pinned to en-GB so server and client render byte
// identical strings; only the currency code varies per account. Switch to a
// per-account locale only if a brand actually needs local number grouping.
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

const numberFormatter = new Intl.NumberFormat("en-GB", {
  maximumFractionDigits: 0,
});

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function formatDate(value: string): string {
  return dateFormatter.format(new Date(`${value}T12:00:00Z`));
}

function sentenceCase(value: string): string {
  const normalized = value.replaceAll("_", " ").trim().toLowerCase();
  return normalized ? normalized[0].toUpperCase() + normalized.slice(1) : value;
}

function worklogSummary(value: string): string {
  return value.replace(/^\[[^\]]+\]\s*/, "");
}

function TargetsBar({
  targets,
  currency,
  disabled,
  onApply,
}: {
  targets: PerformanceTargets;
  currency: Currency;
  disabled: boolean;
  onApply: (next: PerformanceTargets) => void;
}) {
  const [draft, setDraft] = useState({
    costPerOrder: String(targets.costPerOrder),
    costPerAcquisition: String(targets.costPerAcquisition),
    conversionRate: (targets.conversionRate * 100).toFixed(1),
  });

  function apply() {
    onApply(
      normaliseTargets({
        costPerOrder: Number(draft.costPerOrder),
        costPerAcquisition: Number(draft.costPerAcquisition),
        conversionRate: Number(draft.conversionRate) / 100,
      }),
    );
  }

  return (
    <form
      aria-busy={disabled}
      aria-label={`Performance targets in ${currency}`}
      className="targets-bar"
      onSubmit={(event) => {
        event.preventDefault();
        apply();
      }}
    >
      <span className="targets-bar__title">
        <span className="eyebrow">Targets</span>
      </span>
      <label className="field field--compact">
        <span className="field-label">
          CPO target
          <span aria-hidden="true" className="field-unit-chip">
            {currency}
          </span>
        </span>
        <input
          aria-label={`CPO target in ${currency}`}
          disabled={disabled}
          inputMode="decimal"
          min="0.01"
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              costPerOrder: event.target.value,
            }))
          }
          step="any"
          type="number"
          value={draft.costPerOrder}
        />
      </label>
      <label className="field field--compact">
        <span className="field-label">
          CPA target
          <span aria-hidden="true" className="field-unit-chip">
            {currency}
          </span>
        </span>
        <input
          aria-label={`CPA target in ${currency}`}
          disabled={disabled}
          inputMode="decimal"
          min="0.01"
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              costPerAcquisition: event.target.value,
            }))
          }
          step="any"
          type="number"
          value={draft.costPerAcquisition}
        />
      </label>
      <label className="field field--compact">
        <span>Conv. rate target (%)</span>
        <input
          aria-label="Conversion rate target in percent"
          disabled={disabled}
          inputMode="decimal"
          min="0.01"
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              conversionRate: event.target.value,
            }))
          }
          step="any"
          type="number"
          value={draft.conversionRate}
        />
      </label>
      <button className="button button--secondary" disabled={disabled} type="submit">
        {disabled ? "Applying…" : "Apply targets"}
      </button>
    </form>
  );
}

const MAX_DELIVERY_METRICS = 5;
const DELIVERY_SERIES_VARIANTS = [
  "series-0",
  "series-1",
  "series-2",
  "series-3",
  "series-4",
] as const;

function isJourneyMetricAvailable(
  metric: JourneyTrendMetricDefinition,
  platform: Platform,
): boolean {
  return (
    metric.platformScope === null ||
    platform === "all" ||
    metric.platformScope === platform
  );
}

function formatJourneyMetricValue(
  value: number | null,
  unit: JourneyTrendMetricDefinition["unit"],
  currency: Currency,
): string {
  if (value === null) return "N/A";
  if (unit === "currency") return currencyFormatterFor(currency).format(value);
  if (unit === "percent") return `${(value * 100).toFixed(1)}%`;
  if (unit === "ratio") return `${value.toFixed(2)}×`;
  return numberFormatter.format(value);
}

function scaleLabelFor(
  unit: JourneyTrendMetricDefinition["unit"],
  currency: Currency,
): string {
  if (unit === "currency") return `Currency (${currency})`;
  if (unit === "percent") return "Rate (%)";
  if (unit === "ratio") return "Ratio (×)";
  return "Count";
}

/** One plot whose selected metrics follow the global platform filter scope. */
function SpendTrend({
  snapshot,
  currency,
}: {
  snapshot: DashboardSnapshot;
  currency: Currency;
}) {
  const [activeMetrics, setActiveMetrics] = useState<JourneyTrendMetricKey[]>([
    "spend",
    "actualPurchaseRevenue",
  ]);
  const [focusedMetric, setFocusedMetric] =
    useState<JourneyTrendMetricKey | null>(null);
  const labels = snapshot.trend.map((point) => point.date);
  const footerLeft = snapshot.trend[0]?.date.slice(5) ?? "—";
  const footerRight = snapshot.trend.at(-1)?.date.slice(5) ?? "—";

  const [prevPlatform, setPrevPlatform] = useState(snapshot.selectedPlatform);
  if (prevPlatform !== snapshot.selectedPlatform) {
    setPrevPlatform(snapshot.selectedPlatform);
    setActiveMetrics((current) =>
      current.filter((key) => {
        const metric = JOURNEY_TREND_METRICS.find((item) => item.key === key);
        return metric
          ? isJourneyMetricAvailable(metric, snapshot.selectedPlatform)
          : false;
      }),
    );
    setFocusedMetric(null);
  }

  function toggleMetric(metric: JourneyTrendMetricKey) {
    if (activeMetrics.includes(metric) && focusedMetric === metric) {
      setFocusedMetric(null);
    }
    setActiveMetrics((current) => {
      if (current.includes(metric)) {
        return current.filter((item) => item !== metric);
      }
      if (current.length >= MAX_DELIVERY_METRICS) return current;
      return [...current, metric];
    });
  }

  const activeDefinitions = activeMetrics
    .map((metric) => JOURNEY_TREND_METRICS.find((item) => item.key === metric))
    .filter(
      (item): item is JourneyTrendMetricDefinition =>
        item !== undefined &&
        isJourneyMetricAvailable(item, snapshot.selectedPlatform),
    );
  const activeSeries = activeDefinitions.map((metric, index) => ({
    metric,
    variant: DELIVERY_SERIES_VARIANTS[index] ?? "series-0",
  }));
  const activeUnits = [...new Set(activeDefinitions.map((metric) => metric.unit))];
  const selectionSummary =
    activeDefinitions.length === 0
      ? "Choose metrics"
      : activeDefinitions.length <= 2
        ? activeDefinitions.map((metric) => metric.label).join(" + ")
        : `${activeDefinitions.length} metrics selected`;

  return (
    <div className="trend-stack">
      <div className="trend-metric-picker">
        <div className="trend-metric-picker__intro">
          <div className="trend-metric-picker__copy">
            <span className="trend-metric-picker__label">Compare metrics</span>
            <span className="trend-metric-picker__hint" id="delivery-metric-hint">
              Choose up to {MAX_DELIVERY_METRICS}. Each unit uses its own
              zero-based scale; compare direction and shape, not magnitude.
              Worklog pins mark timing, not causality.
            </span>
          </div>

          <details className="trend-metric-select">
            <summary
              aria-describedby="delivery-metric-hint"
              aria-label={`Choose Delivery Trend metrics. ${selectionSummary}.`}
            >
              <span>Metrics</span>
              <strong>{selectionSummary}</strong>
              <i aria-hidden="true" />
            </summary>
            <div className="trend-metric-select__menu">
              {JOURNEY_STAGES.map((stage) => {
                const stageMetrics = JOURNEY_TREND_METRICS.filter(
                  (metric) => metric.stage === stage.stage,
                );
                if (stageMetrics.length === 0) return null;

                return (
                  <fieldset key={stage.stage}>
                    <legend>{stage.label}</legend>
                    {stageMetrics.map((metric) => {
                      const isActive = activeMetrics.includes(metric.key);
                      const isAvailable = isJourneyMetricAvailable(
                        metric,
                        snapshot.selectedPlatform,
                      );
                      const isAtLimit =
                        activeMetrics.length >= MAX_DELIVERY_METRICS && !isActive;
                      const isDisabled = !isAvailable || isAtLimit;

                      return (
                        <label
                          className="trend-metric-select__option"
                          data-disabled={isDisabled ? "true" : undefined}
                          key={metric.key}
                        >
                          <input
                            checked={isActive}
                            disabled={isDisabled}
                            onChange={() => toggleMetric(metric.key)}
                            type="checkbox"
                          />
                          <span>{metric.label}</span>
                          <small>
                            {metric.platformScope === "meta"
                              ? "Meta only"
                              : scaleLabelFor(metric.unit, currency)}
                          </small>
                        </label>
                      );
                    })}
                  </fieldset>
                );
              })}
            </div>
          </details>
        </div>

        <div
          aria-describedby="delivery-metric-hint"
          aria-label="Selected Delivery Trend metrics"
          className="trend-metric-picker__options"
          role="list"
        >
          {activeSeries.map(({ metric, variant }) => (
            <button
              aria-label={`Remove ${metric.label} from Delivery Trend`}
              className="trend-metric-toggle"
              key={metric.key}
              onBlur={() => setFocusedMetric(null)}
              onClick={() => toggleMetric(metric.key)}
              onFocus={() => setFocusedMetric(metric.key)}
              onMouseEnter={() => setFocusedMetric(metric.key)}
              onMouseLeave={() => setFocusedMetric(null)}
              role="listitem"
              type="button"
            >
              <svg
                aria-hidden="true"
                className={`metric-line-swatch metric-line-swatch--${variant}`}
                viewBox="0 0 18 4"
              >
                <line x1="1" x2="17" y1="2" y2="2" />
              </svg>
              <span>{metric.label}</span>
              <span className="trend-metric-toggle__value">
                {formatJourneyMetricValue(
                  metric.read(snapshot.totals),
                  metric.unit,
                  currency,
                )}
              </span>
              <span aria-hidden="true" className="trend-metric-toggle__check">
                ×
              </span>
            </button>
          ))}
        </div>
      </div>

      {activeDefinitions.length > 0 && snapshot.trend.length > 0 ? (
        <LineChart
          ariaLabel="Selected delivery metrics per day"
          footerLeft={footerLeft}
          footerRight={footerRight}
          focusedSeriesKey={focusedMetric}
          formatLabel={(label) => formatDate(label)}
          formatValue={(value, seriesKey) => {
            const metric = JOURNEY_TREND_METRICS.find(
              (item) => item.key === seriesKey,
            );
            return metric
              ? formatJourneyMetricValue(value, metric.unit, currency)
              : String(value);
          }}
          fitContainer
          height={320}
          labels={labels}
          showLegend={false}
          annotations={snapshot.worklog.map((entry) => ({
            key: entry.id,
            label: currentDateInTimeZone(
              snapshot.account.timezone,
              new Date(entry.occurredAt),
            ),
            title: sentenceCase(entry.actionType),
            summary: worklogSummary(entry.actionSummary),
            variant:
              entry.platform === "google"
                ? "google"
                : entry.platform === "meta"
                  ? "meta"
                  : "cross",
          }))}
          axisLabels={
            activeUnits.length === 2 && activeUnits[0] && activeUnits[1]
              ? {
                  left: scaleLabelFor(activeUnits[0], currency),
                  right: scaleLabelFor(activeUnits[1], currency),
                }
              : undefined
          }
          series={activeSeries.map(({ metric, variant }) => ({
            key: metric.key,
            label: metric.label,
            variant,
            scaleKey: metric.unit,
            showArea: false,
            values: snapshot.trend.map((point: TrendPoint) => metric.read(point)),
          }))}
        />
      ) : (
        <p className="trend-stack__empty" role="status">
          {activeDefinitions.length === 0
            ? "Select a metric to show its daily trend."
            : "No closed-day trend data is available for this period."}
        </p>
      )}
    </div>
  );
}

function shareCell(share: { value: number | null; masked: boolean }): string {
  if (share.masked || share.value === null) return "< 10%";
  return `${Math.round(share.value * 100)}%`;
}

/**
 * Stands in for a panel whose figures are withheld in live mode.
 *
 * It keeps the section's own anchor id so the sidebar link still lands
 * somewhere, and names the feed the panel is waiting on. An empty gap would
 * read as a broken page; "coming soon" would not say what is missing.
 */
function PendingPanelSection({ panel }: { panel: PendingPanel }) {
  return (
    <section className="section" id={panel.key}>
      <div className="section-heading">
        <div>
          <span className="eyebrow">Pending ingestion</span>
          <h2>{panel.title}</h2>
          <p className="section-heading__sub">
            No data yet. This panel needs {panel.missing}. Nothing is shown
            here until that feed lands, because the only figures available are
            modelled from account totals and would not be safe to act on.
          </p>
        </div>
      </div>
    </section>
  );
}

/**
 * Mock mode keeps the generated panels, so it says so once, above them, rather
 * than leaving the reader to guess which figures a platform actually reported.
 */
function SyntheticMockupNotice({ platform }: { platform: Platform }) {
  // Named from the same registry that decides which panels render, so the
  // notice never lists a panel the current filter does not show.
  const titles = pendingSyntheticPanels(platform).map((panel) => panel.title);
  const list =
    titles.length <= 1
      ? (titles[0] ?? "")
      : `${titles.slice(0, -1).join(", ")} and ${titles[titles.length - 1]}`;

  if (!list) return null;

  return (
    <div
      className="console-notice console-notice--warning"
      role="note"
      data-origin="synthetic-illustration"
    >
      <div>
        <strong>Simulated panels · demo data</strong>
        <p>
          {list} below are modelled from account totals with fixed shares. They
          are not read from Google Ads, Meta or a store. Do not use them for
          budget, bid, or pause decisions.
        </p>
      </div>
    </div>
  );
}

function ImpressionShareSection({
  snapshot,
}: {
  snapshot: DashboardSnapshot;
}) {
  const report = snapshot.impressionShare;
  const [tierKey, setTierKey] = useState<ImpressionShareTierKey>("overall");

  if (!report) return null;

  const currency = snapshot.account.currency;
  const tier =
    IMPRESSION_SHARE_TIERS.find((item) => item.key === tierKey) ??
    IMPRESSION_SHARE_TIERS[0];
  const summary = report.tiers.find((item) => item.key === tierKey);

  return (
    <section className="section" id="impression-share">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Account diagnostic</span>
          <h2>
            Impression share
            {snapshot.selectedPlatform === "all" && (
              <span className="metric-tag metric-tag--google">
                Google Ads only
              </span>
            )}
          </h2>
        </div>
        <p>Meta has no equivalent auction metric, so this panel is Google data.</p>
      </div>

      <article className="panel">
        <div className="panel__heading">
          <div>
            <span className="eyebrow">Auction position</span>
            <h3 className="panel__title">{tier?.question}</h3>
          </div>
          <div className="tier-toggle" role="group" aria-label="Auction position">
            {IMPRESSION_SHARE_TIERS.map((item) => (
              <button
                aria-pressed={item.key === tierKey}
                className={
                  item.key === tierKey
                    ? "tier-toggle__button tier-toggle__button--active"
                    : "tier-toggle__button"
                }
                key={item.key}
                onClick={() => setTierKey(item.key)}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {summary && (
          <dl className="tier-summary">
            <div>
              <dt>Served share</dt>
              <dd>
                {summary.averageShare === null
                  ? "Masked"
                  : `${Math.round(summary.averageShare * 100)}%`}
              </dd>
            </div>
            <div>
              <dt>Lost to rank</dt>
              <dd>
                {summary.averageLostToRank === null
                  ? "Masked"
                  : `${Math.round(summary.averageLostToRank * 100)}%`}
              </dd>
            </div>
            <div>
              <dt>Lost to budget</dt>
              <dd>
                {summary.averageLostToBudget === null
                  ? "Masked"
                  : `${Math.round(summary.averageLostToBudget * 100)}%`}
              </dd>
            </div>
            <div>
              <dt>Campaigns reported</dt>
              <dd>
                {summary.reportedCampaigns} of{" "}
                {summary.reportedCampaigns + summary.maskedCampaigns}
              </dd>
            </div>
          </dl>
        )}

        <StackedShareBars
          formatShare={(value) => `${Math.round(value * 100)}%`}
          legend={["Served", "Lost — rank", "Lost — budget"]}
          maskedLabel="< 10% masked"
          rows={report.rows.map((row) => {
            const cell = row.tiers[tierKey];
            return {
              key: row.campaign,
              label: row.campaign,
              note: row.status === "active" ? "active" : "paused",
              segments: [
                {
                  key: "served",
                  label: "Served",
                  value: cell.share.value,
                  masked: cell.share.masked,
                },
                {
                  key: "rank",
                  label: "Lost — rank",
                  value: cell.lostToRank.value,
                  masked: cell.lostToRank.masked,
                },
                {
                  key: "budget",
                  label: "Lost — budget",
                  value: cell.lostToBudget.value,
                  masked: cell.lostToBudget.masked,
                },
              ],
              extraRows: [
                {
                  label: "Spend",
                  value: currencyFormatterFor(currency).format(row.spend),
                  muted: true,
                },
              ],
            };
          })}
        />
        <div className="impression-notes">
          <p className="semantic-note">{report.dominantLossMessage}</p>
          <p className="semantic-note">{report.safeMessage}</p>
        </div>
      </article>

      <div className="table-scroller">
        <table>
          <thead>
            <tr>
              <th rowSpan={2}>Campaign</th>
              <th rowSpan={2}>Status</th>
              <th rowSpan={2}>Spend</th>
              {IMPRESSION_SHARE_TIERS.map((item) => (
                <th className="tier-group" colSpan={3} key={item.key}>
                  {item.label}
                </th>
              ))}
            </tr>
            <tr>
              {IMPRESSION_SHARE_TIERS.map((item) => (
                <Fragment key={item.key}>
                  <th className="tier-group">IS</th>
                  <th>Lost rank</th>
                  <th>Lost budget</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => (
              <tr key={row.campaign}>
                <th>{row.campaign}</th>
                <td>{row.status}</td>
                <td>{currencyFormatterFor(currency).format(row.spend)}</td>
                {IMPRESSION_SHARE_TIERS.map((item) => {
                  const cell = row.tiers[item.key];
                  return (
                    <Fragment key={item.key}>
                      <td
                        className={`tier-group ${cell.share.masked ? "cell--masked" : ""
                          }`}
                      >
                        {shareCell(cell.share)}
                      </td>
                      <td
                        className={
                          cell.lostToRank.masked ? "cell--masked" : undefined
                        }
                      >
                        {shareCell(cell.lostToRank)}
                      </td>
                      <td
                        className={
                          cell.lostToBudget.masked ? "cell--masked" : undefined
                        }
                      >
                        {shareCell(cell.lostToBudget)}
                      </td>
                    </Fragment>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function resolveSignalDetail(
  label: string,
  value: string,
  snapshot: DashboardSnapshot,
): {
  eyebrow: string;
  badge: string;
  tone: "blocked" | "warning" | "passing" | "info";
  title: string;
  description: string;
  impact: string;
  action: string;
} {
  const isReady = snapshot.dataStatus === "ready";
  const expectedDays = snapshot.quality.expectedDays;
  const missingCount = snapshot.quality.missingDates.length;
  const coveredCount = Math.max(0, expectedDays - missingCount);

  switch (label) {
    case "Summary gate":
      return {
        eyebrow: "OPERATIONAL GATE",
        badge: value,
        tone: "blocked",
        title: "Summary Gate: Withheld for Accuracy",
        description:
          "Automated executive summaries and AI insights are withheld when quality issues exceed the confidence threshold. This prevents reporting skewed figures to leadership.",
        impact:
          "High-level executive takeaways remain locked until missing days or reconciliation gaps are resolved.",
        action:
          "Inspect missing dates or unverified event mappings in the audit log below.",
      };
    case "Coverage":
      return {
        eyebrow: "CYCLE COVERAGE",
        badge: value,
        tone: isReady ? "passing" : "warning",
        title: `Coverage: ${value} (${coveredCount} of ${expectedDays} days)`,
        description: `Reflects the ratio of stored calendar dates to expected dates in the current reporting cycle. Here, ${coveredCount} of ${expectedDays} expected days have stored metrics in Supabase (${((coveredCount / expectedDays) * 100).toFixed(1)}%, rounded to ${Math.round((coveredCount / expectedDays) * 100)}% in the topbar).`,
        impact:
          "Trends and total aggregates represent the covered days only. Missing days are not imputed as zero.",
        action:
          "Trigger a sync or backfill for missing dates via the sync API.",
      };
    case "Missing days":
      return {
        eyebrow: "DATA CONTINUITY",
        badge: value,
        tone: "warning",
        title: `Missing Dates: ${missingCount} day(s)`,
        description: `There are ${missingCount} date(s) without stored performance records (${snapshot.quality.missingDates.join(", ") || "none"}).`,
        impact:
          "Aggregate spend, clicks, and conversions will omit these days.",
        action:
          "Verify the connector sync job for the missing dates in the Worklog or Ingestion panel.",
      };
    case "Provisional":
      return {
        eyebrow: "ATTRIBUTION WINDOW",
        badge: `${value} day(s)`,
        tone: "warning",
        title: "Provisional Attribution Days",
        description:
          "Recent dates are within the ad platform conversion lag window. Ad networks may restate conversion figures over the next 24-72 hours.",
        impact:
          "Figures for provisional days may increase as late conversions are attributed.",
        action:
          "Treat the most recent 1-2 days as indicative rather than final.",
      };
    case "Event mapping":
      return {
        eyebrow: "SCHEMA CONFORMANCE",
        badge: value,
        tone: value.toLowerCase() === "approved" ? "passing" : "warning",
        title: "Conversion Event Taxonomy",
        description: `Platform conversion actions are currently ${value}. When unverified, custom platform events may not map 1:1 to standard purchase or lead metrics.`,
        impact:
          "Cross-platform CPA or ROAS comparisons could compare mismatched conversion definitions.",
        action:
          "Review event taxonomy mappings in Account Settings.",
      };
    case "Reconciliation":
      return {
        eyebrow: "FINANCIAL RECONCILIATION",
        badge: value,
        tone: value.toLowerCase() === "verified" ? "passing" : "warning",
        title: "Platform vs Store Audit",
        description: `Reconciliation between reported ad revenue and e-commerce store receipts is currently ${value}.`,
        impact:
          "Reported ROAS is platform-attributed and pending bank/store reconciliation.",
        action:
          "Check Store Analytics reconciliation once invoice feeds land.",
      };
    case "Open day":
      return {
        eyebrow: "IN-PROGRESS WINDOW",
        badge: value,
        tone: "info",
        title: "Current Calendar Day Included",
        description:
          "Today is included in the reporting window. Platform APIs return partial-day statistics as campaigns are actively spending.",
        impact:
          "Today's pacing and conversion rates will fluctuate throughout the day.",
        action:
          "For closed-day analysis, select a date range ending yesterday.",
      };
    default:
      return {
        eyebrow: "AUDIT SIGNAL",
        badge: value,
        tone: "info",
        title: `${label}: ${value}`,
        description: `Operational health signal monitored by the data quality engine. Current status: ${value}.`,
        impact: "Monitored to maintain reporting parity and data trust.",
        action: "No immediate action required unless gate is blocked.",
      };
  }
}

export function DashboardShell({
  initialSnapshot,
  initialLastDataSyncAt,
  viewer,
  accounts,
  selectedAccount,
  referenceDates,
  initialTargets,
  initialBudgets,
}: DashboardShellProps) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [account, setAccount] = useState(selectedAccount);
  const [targets, setTargets] = useState(initialTargets);
  const [budgets, setBudgets] = useState(initialBudgets);
  const [comparisonEnabled, setComparisonEnabled] = useState(
    initialSnapshot.comparisonEnabled,
  );
  const [comparisonWindow, setComparisonWindow] =
    useState<ComparisonWindow>("previous");
  /** The reader's own baseline dates. Only sent when the window is "custom". */
  const [customComparisonRange, setCustomComparisonRange] =
    useState<DateRange | null>(null);
  // Geography is withheld in live mode, so the selection starts empty rather
  // than reading a country off a panel that was never built.
  const [geoSelection, setGeoSelection] = useState<GeoSelection>({
    countryCode: initialSnapshot.geo?.selectedCountry.code ?? "",
    level: initialSnapshot.geo?.selectedLevel ?? "country",
    parentId: null,
  });
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(
    initialLastDataSyncAt ?? initialSnapshot.lastSuccessfulSync,
  );
  const [filters, setFilters] = useState<Filters>({
    start: initialSnapshot.selectedRange.start,
    end: initialSnapshot.selectedRange.end,
    platform: initialSnapshot.selectedPlatform,
  });
  const [isDummyMode, setIsDummyMode] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("dashboard_data_mode");
      if (saved === "dummy") return true;
      if (saved === "live") return false;
    }
    return initialSnapshot.mode === "mock";
  });
  const [job, setJob] = useState<SyncJob | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [isRefreshPending, setIsRefreshPending] = useState(false);
  const [message, setMessage] = useState("");
  const canTriggerSync = hasPermission(viewer.role, "sync:trigger");
  const isCondensed = useCondensedOnScroll();

  const [isDataHealthOverviewOpen, setIsDataHealthOverviewOpen] = useState(false);
  const [activeSignalLabel, setActiveSignalLabel] = useState<string | null>(null);
  const dataHealthTopRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isDataHealthOverviewOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsDataHealthOverviewOpen(false);
    }
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (
        dataHealthTopRef.current &&
        !dataHealthTopRef.current.contains(event.target as Node) &&
        !target?.closest(".data-health-bar__lead")
      ) {
        setIsDataHealthOverviewOpen(false);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isDataHealthOverviewOpen]);

  useEffect(() => {
    if (!activeSignalLabel) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setActiveSignalLabel(null);
    }
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (!target?.closest(".data-health-bar__signal-wrap")) {
        setActiveSignalLabel(null);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [activeSignalLabel]);

  const requestSnapshot = useCallback(async (
    overrides: SnapshotOverrides = {},
  ): Promise<DashboardSnapshot> => {
    const activeTargets = overrides.targets ?? targets;
    const activeBudgets = overrides.budgets ?? budgets;
    const activeGeo = overrides.geo ?? geoSelection;
    const activeCompareOn =
      overrides.comparisonEnabled ?? comparisonEnabled;
    const activeWindow = overrides.comparisonWindow ?? comparisonWindow;
    const activeComparisonRange =
      overrides.comparisonRange === undefined
        ? customComparisonRange
        : overrides.comparisonRange;
    const activeIsDummy =
      overrides.isDummyMode !== undefined ? overrides.isDummyMode : isDummyMode;
    const params = new URLSearchParams({
      start: overrides.start ?? filters.start,
      end: overrides.end ?? filters.end,
      platform: overrides.platform ?? filters.platform,
      account: overrides.account ?? account,
      mode: activeIsDummy ? "mock" : "live",
      cpo: String(activeTargets.costPerOrder),
      cpa: String(activeTargets.costPerAcquisition),
      cvr: String(activeTargets.conversionRate),
      budgetMeta: String(activeBudgets.meta),
      budgetGoogle: String(activeBudgets.google),
      geoCountry: activeGeo.countryCode,
      geoLevel: activeGeo.level,
      compare: activeCompareOn ? activeWindow : "off",
      ...(activeGeo.parentId ? { geoParent: activeGeo.parentId } : {}),
      ...(activeCompareOn && activeWindow === "custom" && activeComparisonRange
        ? {
          compareStart: activeComparisonRange.start,
          compareEnd: activeComparisonRange.end,
        }
        : {}),
    });
    const response = await fetch(`/api/dashboard?${params}`, {
      cache: "no-store",
    });
    const payload = (await response.json()) as
      | DashboardSnapshot
      | { error: string };

    if (!response.ok || "error" in payload) {
      throw new Error(
        "error" in payload ? payload.error : "Unable to load dashboard data.",
      );
    }

    return payload;
  }, [
    account,
    budgets,
    comparisonEnabled,
    comparisonWindow,
    customComparisonRange,
    filters,
    geoSelection,
    isDummyMode,
    targets,
  ]);

  const handleToggleDataMode = async (nextDummy: boolean) => {
    if (isApplying || isRefreshPending) return;
    setIsDummyMode(nextDummy);
    if (typeof window !== "undefined") {
      localStorage.setItem("dashboard_data_mode", nextDummy ? "dummy" : "live");
    }
    setIsApplying(true);
    setMessage(
      nextDummy
        ? "Switching to Simulated Demo Data…"
        : "Switching to Live Data…",
    );
    try {
      const nextSnapshot = await requestSnapshot({ isDummyMode: nextDummy });
      setSnapshot(nextSnapshot);
      setMessage(
        nextDummy
          ? "Switched to Simulated Demo Data (Mock Mode)."
          : "Switched to Live Data feed (Supabase Storage).",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Failed to switch data mode.",
      );
    } finally {
      setIsApplying(false);
    }
  };

  const loadSnapshot = useCallback(async (
    overrides: SnapshotOverrides,
    pendingMessage: string,
  ) => {
    setIsApplying(true);
    setMessage(pendingMessage);

    try {
      const payload = await requestSnapshot(overrides);
      setSnapshot(payload);
      // The served plan belongs to the brand that was actually read. Keeping
      // local state instead would carry the previous brand's figures into the
      // next request and pace one brand's spend against another's budget.
      setBudgets(payload.budgetPacing.monthlyBudgets);
      setFilters((current) => ({
        ...current,
        platform: payload.selectedPlatform,
      }));
      setLastSyncAt((current) =>
        latestSyncTimestamp(current, payload.lastSuccessfulSync),
      );
      setMessage("Filters applied.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to apply filters.",
      );
    } finally {
      setIsApplying(false);
    }
  }, [requestSnapshot]);

  /**
   * The picker commits the active period and its baseline together, so one
   * request carries both and the dashboard never renders a half-applied state
   * where the dates moved but the comparison had not caught up.
   */
  async function applyPeriod(selection: PeriodSelection) {
    setFilters((current) => ({ ...current, ...selection.range }));
    setComparisonEnabled(selection.comparisonEnabled);
    setComparisonWindow(selection.comparisonWindow);
    setCustomComparisonRange(selection.comparisonRange);
    await loadSnapshot(
      {
        ...selection.range,
        comparisonEnabled: selection.comparisonEnabled,
        comparisonWindow: selection.comparisonWindow,
        comparisonRange: selection.comparisonRange,
      },
      "Applying reporting period…",
    );
  }

  async function loadAccount(slug: string) {
    // Markets differ per brand, so the drill path cannot survive the switch.
    const reset: GeoSelection = {
      countryCode: "",
      level: "province",
      parentId: null,
    };
    const nextAccount = accounts.find((item) => item.slug === slug) ?? resolveAccount(slug);
    const nextPlatform = resolvePlatformForAccount(
      nextAccount,
      filters.platform,
    );
    setGeoSelection(reset);
    setFilters((current) => ({ ...current, platform: nextPlatform }));
    await loadSnapshot(
      { account: slug, geo: reset, platform: nextPlatform },
      "Switching account…",
    );
  }

  const loadPlatform = useCallback(async (platform: Platform) => {
    setFilters((current) => ({ ...current, platform }));
    await loadSnapshot({ platform }, "Switching platform…");
  }, [loadSnapshot]);

  async function applyGeoSelection(next: GeoSelection) {
    setGeoSelection(next);
    await loadSnapshot({ geo: next }, "Reading geography…");
  }

  const applyBudgets = useCallback(async (next: MonthlyBudgets) => {
    setBudgets(next);
    // One cookie per brand. The old global name is expired here so a browser
    // that still carries it cannot feed one brand's plan back into another.
    document.cookie = `${LEGACY_BUDGETS_COOKIE}=; path=/; max-age=0; samesite=lax`;
    document.cookie = `${budgetsCookieName(account)}=${serialiseBudgets(next)}; path=/; max-age=${60 * 60 * 24 * 180
      }; samesite=lax`;

    // The agreement is stored server-side against this brand and reporting
    // cycle. A failure is reported, not swallowed: the cookie alone would look
    // saved on one laptop while the team saw the old figure.
    let storeMessage = "";

    try {
      const response = await fetch("/api/budgets", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          account,
          meta: next.meta,
          google: next.google,
          windowEnd: filters.end,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        storeMessage =
          payload?.error ?? "The agreed budget was not saved for the team.";
      }
    } catch {
      storeMessage = "The agreed budget was not saved for the team.";
    }

    await loadSnapshot({ budgets: next }, "Applying budgets…");
    if (storeMessage) setMessage(storeMessage);
  }, [account, filters.end, loadSnapshot]);

  async function applyTargets(next: PerformanceTargets) {
    setTargets(next);
    document.cookie = `${TARGETS_COOKIE}=${serialiseTargets(next)}; path=/; max-age=${60 * 60 * 24 * 180
      }; samesite=lax`;
    await loadSnapshot({ targets: next }, "Applying targets…");
  }

  async function completeRefresh(finishedJob: SyncJob) {
    const refreshed = await requestSnapshot(finishedJob.requestedRange);
    setSnapshot(refreshed);
    setFilters((current) => ({
      ...current,
      ...finishedJob.requestedRange,
      platform: refreshed.selectedPlatform,
    }));
    setLastSyncAt((current) =>
      latestSyncTimestamp(
        current,
        refreshed.lastSuccessfulSync,
        syncCompletionTimestamp(finishedJob),
      ),
    );
    setMessage("Data refreshed.");
  }

  async function refreshData() {
    if (isDummyMode) {
      setIsRefreshPending(true);
      setMessage("Reloading simulated demo data…");
      try {
        const nextSnapshot = await requestSnapshot({ isDummyMode: true });
        setSnapshot(nextSnapshot);
        setMessage("Demo data reloaded.");
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : "Failed to reload demo data.",
        );
      } finally {
        setIsRefreshPending(false);
      }
      return;
    }

    setIsRefreshPending(true);
    setMessage("Starting refresh…");

    try {
      const response = await fetch("/api/sync-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...filters, account }),
      });
      const created = (await response.json()) as SyncJob | { error: string };

      if (!response.ok || "error" in created) {
        throw new Error(
          "error" in created ? created.error : "Unable to create refresh job.",
        );
      }

      setJob(created);
      setMessage("Refresh queued.");

      if (created.status === "succeeded") {
        await completeRefresh(created);
        return;
      }

      for (let attempt = 0; attempt < 8; attempt += 1) {
        await wait(700);
        const statusResponse = await fetch(
          `/api/sync-jobs/${created.id}?account=${encodeURIComponent(account)}`,
          { cache: "no-store" },
        );
        const updated = (await statusResponse.json()) as
          | SyncJob
          | { error: string };

        if (!statusResponse.ok || "error" in updated) {
          throw new Error(
            "error" in updated ? updated.error : "Unable to read job status.",
          );
        }

        setJob(updated);
        setMessage(
          updated.status === "validating"
            ? "Validating data…"
            : "Refreshing data…",
        );

        if (updated.status === "succeeded") {
          await completeRefresh(updated);
          return;
        }
      }

      throw new Error("Refresh timed out. Try again.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Refresh failed.",
      );
      setJob(null);
    } finally {
      setIsRefreshPending(false);
    }
  }

  const isRefreshing =
    isRefreshPending ||
    (job !== null &&
      ["queued", "syncing", "validating"].includes(job.status));
  const activeAccount = resolveAccount(account);
  // Demo numbers can be complete, but never verified: every status claim in
  // the utility bar reads from this before it says anything about trust.
  const isDemoData = isDummyMode || snapshot.mode !== "live";
  const storedDays = Math.max(
    0,
    snapshot.quality.expectedDays - snapshot.quality.missingDates.length,
  );

  const dataHealthSignals = [
    snapshot.dataHealth.summaryBlocked
      ? { label: "Summary gate", value: "Blocked", tone: "negative" }
      : null,
    snapshot.dataHealth.coveragePercent < 100
      ? {
          label: "Coverage",
          value: `${snapshot.dataHealth.coveragePercent}%`,
          tone: "warning",
        }
      : null,
    snapshot.quality.missingDates.length > 0
      ? {
          label: "Missing days",
          value: `${snapshot.quality.missingDates.length}/${snapshot.quality.expectedDays}`,
          tone: "warning",
        }
      : null,
    snapshot.quality.provisionalDates.length > 0
      ? {
          label: "Provisional",
          value: String(snapshot.quality.provisionalDates.length),
          tone: "warning",
        }
      : null,
    snapshot.dataHealth.mappingStatus !== "approved"
      ? {
          label: "Event mapping",
          value: sentenceCase(snapshot.dataHealth.mappingStatus),
          tone: "warning",
        }
      : null,
    !["verified", "not-applicable"].includes(
      snapshot.dataHealth.reconciliationStatus,
    )
      ? {
          label: "Reconciliation",
          value: sentenceCase(snapshot.dataHealth.reconciliationStatus),
          tone: "warning",
        }
      : null,
    snapshot.dataHealth.currentDayIncluded
      ? { label: "Open day", value: "Included", tone: "info" }
      : null,
  ].filter(
    (signal): signal is { label: string; value: string; tone: string } =>
      signal !== null,
  );

  const dataHealthFooter = (
    <aside aria-label="Data health" className="data-health-bar" id="data-health">
      <button
        type="button"
        aria-expanded={isDataHealthOverviewOpen}
        aria-haspopup="dialog"
        aria-label={`Data health: ${sentenceCase(snapshot.dataStatus)}. Click to toggle full audit overview.`}
        className="data-health-bar__lead data-health-bar__lead--button"
        onClick={() => setIsDataHealthOverviewOpen((prev) => !prev)}
        title="Click to view comprehensive data health status"
      >
        <span className="status-dot" />
        <span>Data health</span>
        <strong>{sentenceCase(snapshot.dataStatus)}</strong>
      </button>

      <div aria-label="Statuses requiring attention" className="data-health-bar__signals">
        {dataHealthSignals.length > 0 ? (
          dataHealthSignals.map((signal, index) => {
            const isRightAligned = index >= Math.floor(dataHealthSignals.length / 2);
            const isSignalOpen = activeSignalLabel === signal.label;
            const detail = resolveSignalDetail(signal.label, signal.value, snapshot);
            return (
              <div className="data-health-bar__signal-wrap" key={signal.label}>
                <button
                  type="button"
                  aria-expanded={isSignalOpen}
                  aria-haspopup="dialog"
                  aria-label={`${signal.label}: ${signal.value}. Click to view details.`}
                  className="data-health-bar__signal data-health-bar__signal--button"
                  data-tone={signal.tone}
                  onClick={() =>
                    setActiveSignalLabel(isSignalOpen ? null : signal.label)
                  }
                >
                  {signal.label} <strong>{signal.value}</strong>
                </button>
                {isSignalOpen && (
                  <div
                    aria-label={`${signal.label} details`}
                    className={`data-health-bar__signal-popover ${
                      isRightAligned ? "data-health-bar__signal-popover--right" : ""
                    }`}
                    role="dialog"
                  >
                    <div className="data-health-popover__header">
                      <span className="data-health-popover__eyebrow">{detail.eyebrow}</span>
                      <span
                        className={`data-health-popover__badge data-health-popover__badge--${
                          detail.tone === "blocked" ? "negative" : detail.tone
                        }`}
                      >
                        {detail.badge}
                      </span>
                    </div>
                    <strong className="data-health-popover__title">{detail.title}</strong>
                    <p className="data-health-popover__desc">{detail.description}</p>
                    <div className="data-health-popover__impact">
                      <strong>Impact:</strong> {detail.impact}
                    </div>
                    <div className="data-health-popover__footer">
                      <span className="data-health-popover__action-hint">{detail.action}</span>
                      <button
                        type="button"
                        className="data-health-popover__close"
                        onClick={() => setActiveSignalLabel(null)}
                      >
                        Close
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <span className="data-health-bar__signal" data-tone="positive">
            No open data issues
          </span>
        )}
      </div>

      {snapshot.summary.dataGaps.length > 0 && (
        <details className="data-health-bar__issues">
          <summary>{snapshot.summary.dataGaps.length} gate{snapshot.summary.dataGaps.length === 1 ? "" : "s"}</summary>
          <ul>
            {snapshot.summary.dataGaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        </details>
      )}
    </aside>
  );

  return (
    <AppFrame
      activeHref="/"
      brandHref="#overview"
      gateLabel="Read-only reporting"
      gateNote="Access follows the assigned account role."
      footerBar={dataHealthFooter}
      loading={isApplying}
      platform={snapshot.selectedPlatform}
      sidebarExtra={
        <a className="text-link" href="#account-setup">View readiness →</a>
      }
      skipLinkLabel="Skip to dashboard"
      topbar={
        <>
          <div aria-label="Active dashboard scope" className="topbar__group topbar__scope">
            <AccountField
              accounts={accounts}
              disabled={isApplying || isRefreshing}
              onChange={(slug) => {
                setAccount(slug);
                rememberAccount(slug);
                void loadAccount(slug);
              }}
              value={account}
              variant="utility"
            />
            <PlatformField
              activePlatforms={activeAccount.platforms}
              disabled={isApplying || isRefreshing}
              onChange={(platform) => void loadPlatform(platform)}
              value={filters.platform}
              variant="utility"
            />
          </div>

          <div aria-label="Live data operations" className="topbar__operations">
            <div aria-label="Operational telemetry" className="topbar__group topbar__telemetry">
              <div className="topbar__data-health-container" ref={dataHealthTopRef}>
              <button
                type="button"
                aria-expanded={isDataHealthOverviewOpen}
                aria-haspopup="dialog"
                aria-label={
                  isDemoData
                    ? `Demo data. ${storedDays} of ${snapshot.quality.expectedDays} days present. Open data status.`
                    : `Data ${snapshot.dataStatus}. ${snapshot.dataHealth.coveragePercent.toFixed(0)}% coverage. Open data status.`
                }
                className={`topbar__context topbar__context--interactive topbar__context--${dataStatusTone(
                  snapshot.dataStatus,
                )}`}
                onClick={() => setIsDataHealthOverviewOpen((prev) => !prev)}
                title="Click to view data health and coverage audit"
              >
                <span
                  className={`status-dot status-dot--${dataStatusTone(
                    snapshot.dataStatus,
                  )}`}
                />
                {isDemoData ? (
                  <>
                    <strong>Demo data</strong>
                    <small>
                      {storedDays}/{snapshot.quality.expectedDays} days
                    </small>
                  </>
                ) : (
                  <>
                    <strong>Data {snapshot.dataStatus}</strong>
                    <small>{snapshot.dataHealth.coveragePercent.toFixed(0)}%</small>
                  </>
                )}
              </button>

              {isDataHealthOverviewOpen && (
                <div
                  aria-labelledby="data-health-popover-title"
                  className="topbar__data-health-popover"
                  role="dialog"
                >
                  <div className="data-health-popover__header">
                    <span className="data-health-popover__eyebrow">Data Quality Engine</span>
                    <span
                      className={`data-health-popover__badge data-health-popover__badge--${dataStatusTone(
                        snapshot.dataStatus,
                      )}`}
                    >
                      {snapshot.dataStatus}
                    </span>
                  </div>

                  <strong id="data-health-popover-title" className="data-health-popover__title">
                    {snapshot.dataStatus === "ready"
                      ? isDemoData
                        ? "Demo data complete"
                        : "Reporting data complete"
                      : snapshot.dataStatus === "partial"
                        ? "Partial Coverage Stored"
                        : "Data Gates Blocked"}
                  </strong>

                  <p className="data-health-popover__desc">
                    {snapshot.dataStatus === "ready"
                      ? isDemoData
                        ? `Every day in this ${snapshot.quality.expectedDays}-day period has simulated metrics. Live connectors are not active, so none of these figures come from an ad platform.`
                        : `All ${snapshot.quality.expectedDays} days in this period have stored ad metrics and no blocking gaps.`
                      : `This period has ${isDemoData ? "simulated" : "stored"} metrics for ${storedDays} of ${snapshot.quality.expectedDays} expected days (${snapshot.dataHealth.coveragePercent.toFixed(1)}%).`}
                  </p>

                  <div className="data-health-progress">
                    <div className="data-health-progress__bar-wrap">
                      <div
                        className="data-health-progress__bar"
                        style={{
                          width: `${Math.min(100, Math.max(0, snapshot.dataHealth.coveragePercent))}%`,
                          backgroundColor:
                            snapshot.dataHealth.coveragePercent >= 95
                              ? "var(--status-positive-fg, #10b981)"
                              : snapshot.dataHealth.coveragePercent >= 75
                                ? "var(--status-warning-fg, #f59e0b)"
                                : "var(--status-negative-fg, #ef4444)",
                        }}
                      />
                    </div>
                    <div className="data-health-progress__legend">
                      <span>Coverage progress</span>
                      <strong>{snapshot.dataHealth.coveragePercent.toFixed(1)}% ({Math.max(0, snapshot.quality.expectedDays - snapshot.quality.missingDates.length)}/{snapshot.quality.expectedDays} days)</strong>
                    </div>
                  </div>

                  <div className="data-health-popover__section-title">Active Health Signals</div>
                  <div className="data-health-status-list">
                    {dataHealthSignals.map((signal) => {
                      const itemDetail = resolveSignalDetail(signal.label, signal.value, snapshot);
                      return (
                        <div className="data-health-status-item" key={signal.label}>
                          <div className="data-health-status-item-header">
                            <span className="data-health-status-item-name">
                              <span className={`status-dot status-dot--${signal.tone === "blocked" ? "negative" : signal.tone}`} />
                              <strong>{signal.label}</strong>
                            </span>
                            <span className={`data-health-status-item-badge data-health-status-item-badge--${itemDetail.tone === "blocked" ? "negative" : itemDetail.tone}`}>
                              {signal.value}
                            </span>
                          </div>
                          <p className="data-health-status-item-desc">{itemDetail.description}</p>
                        </div>
                      );
                    })}
                  </div>

                  {snapshot.summary.dataGaps.length > 0 && (
                    <div className="data-health-popover__gaps">
                      <div className="data-health-popover__gaps-title">Blocking Gaps ({snapshot.summary.dataGaps.length})</div>
                      <ul>
                        {snapshot.summary.dataGaps.map((gap) => (
                          <li key={gap}>{gap}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="data-health-popover__footer">
                    <div className="data-health-popover__actions">
                      <a href="#data-health" className="data-health-popover__link" onClick={() => setIsDataHealthOverviewOpen(false)}>
                        View footer audit ↓
                      </a>
                      <a href="#account-setup" className="data-health-popover__link" onClick={() => setIsDataHealthOverviewOpen(false)}>
                        Readiness →
                      </a>
                    </div>
                    <button
                      type="button"
                      className="data-health-popover__close"
                      onClick={() => setIsDataHealthOverviewOpen(false)}
                    >
                      Close
                    </button>
                  </div>
                </div>
              )}
              </div>

              <TimezoneMismatchDisclaimer
                account={snapshot.account}
                issues={snapshot.quality.issues}
                platform={filters.platform}
              />
            </div>

            <span className="topbar__divider" aria-hidden="true" />

            <div aria-label="Environment and freshness" className="topbar__group topbar__env">
              <div className="topbar__data-mode-toggle" role="group" aria-label="Dashboard Data Mode">
              <button
                type="button"
                className={`mode-toggle-btn ${!isDummyMode ? "mode-toggle-btn--active mode-toggle-btn--live" : ""}`}
                disabled={isApplying || isRefreshing}
                onClick={() => void handleToggleDataMode(false)}
                title="Live ad and store data from Supabase storage"
              >
                <span className="mode-toggle-dot mode-toggle-dot--live" />
                Live Data
              </button>
              <button
                type="button"
                className={`mode-toggle-btn ${isDummyMode ? "mode-toggle-btn--active mode-toggle-btn--dummy" : ""}`}
                disabled={isApplying || isRefreshing}
                onClick={() => void handleToggleDataMode(true)}
                title="Interactive simulated demo data (Mock Mode)"
              >
                <span className="mode-toggle-dot mode-toggle-dot--dummy" />
                Dummy Data
              </button>
              </div>
              <AccountSyncTime
                label="Synced"
                lastSyncAt={lastSyncAt}
                timeZone={snapshot.account.timezone}
              />
            </div>
          </div>
        </>
      }
      viewer={viewer}
    >
          <section className="hero hero--dashboard" id="overview">
            <div className="hero__copy">
              <h1>Paid media performance</h1>
              <div aria-label="Reporting context" className="hero__kicker">
                <span className={`mode-badge ${isDummyMode ? "mode-badge--dummy" : "mode-badge--live"}`}>
                  {isDummyMode
                    ? "Simulated dummy data"
                    : snapshot.mode === "live"
                      ? "Live data"
                      : "Preview data"}
                </span>
                <span className="hero__currency">{snapshot.account.currency}</span>
              </div>
            </div>
          </section>

          {/* The picker commits its own draft, so this bar groups controls
              rather than submitting a form. */}
          <div
            aria-label="Reporting period and data refresh"
            className={`filter-bar filter-bar--paid ${
              isCondensed ? "filter-bar--condensed" : ""
            }`}
            role="group"
          >
            <PeriodPicker
              activeRange={snapshot.selectedRange}
              comparisonEnabled={snapshot.comparisonEnabled}
              comparisonRange={snapshot.comparisonRange}
              comparisonWindow={comparisonWindow}
              customComparisonRange={customComparisonRange}
              disabled={isApplying || isRefreshing}
              onApply={(selection) => void applyPeriod(selection)}
              quickPresets
              referenceDate={
                referenceDates[account] ?? initialSnapshot.selectedRange.end
              }
            />
            <div className="filter-actions">
              <button
                aria-busy={isRefreshing}
                aria-label={
                  isRefreshing
                    ? "Refreshing dashboard data"
                    : isDummyMode
                      ? "Reload simulated demo data"
                      : canTriggerSync
                        ? "Refresh dashboard data"
                        : "Refresh unavailable with view-only access"
                }
                className={`button button--primary button--refresh${
                  isRefreshing ? " is-loading" : ""
                }`}
                disabled={isRefreshing || (!isDummyMode && !canTriggerSync)}
                onClick={refreshData}
                type="button"
              >
                <RefreshIcon className={isRefreshing ? "spin" : ""} />
                {isRefreshing
                  ? "Refreshing…"
                  : isDummyMode
                    ? "Reload Demo"
                    : canTriggerSync
                      ? "Refresh data"
                      : "View-only access"}
              </button>
            </div>
            <div className="filter-bar__details">
              <div
                aria-atomic="true"
                aria-label="Applied active and comparison periods"
                aria-live="polite"
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
                  {snapshot.comparisonEnabled ? "compared with" : "reported alone"}
                </span>
                <span
                  className={`filter-period-summary__range filter-period-summary__range--comparison${
                    snapshot.comparisonEnabled ? "" : " is-off"
                  }`}
                >
                  <small>{snapshot.comparisonBasis.label}</small>
                  <b>
                    {snapshot.comparisonEnabled
                      ? `${formatDate(snapshot.comparisonRange.start)} – ${formatDate(
                        snapshot.comparisonRange.end,
                      )}`
                      : "Compare is off"}
                  </b>
                </span>
                <span className="filter-period-summary__basis">
                  {!snapshot.comparisonEnabled
                    ? "Single period"
                    : snapshot.comparisonBasis.normalisedToActiveDuration
                      ? `${snapshot.comparisonBasis.activeDays}D daily-rate`
                      : `${snapshot.comparisonBasis.activeDays}D like-for-like`}
                </span>
              </div>
              <p
                aria-atomic="true"
                aria-live="polite"
                className="filter-message"
                role="status"
              >
                {job && (
                  <span
                    aria-label={`Refresh job status: ${sentenceCase(job.status)}`}
                    className={`job-pill job-pill--${job.status}`}
                  >
                    {sentenceCase(job.status)}
                  </span>
                )}
                {message}
              </p>
            </div>
          </div>

          <SnapshotCard
            currency={snapshot.account.currency}
            snapshot={snapshot}
          />

          <TargetsBar
            currency={snapshot.account.currency}
            disabled={isApplying}
            onApply={(next) => void applyTargets(next)}
            targets={targets}
          />

          <BudgetPacingCard
            budgets={budgets}
            disabled={isApplying}
            onApply={applyBudgets}
            snapshot={snapshot}
          />

          <PlatformPerformanceSection
            onPlatformChange={loadPlatform}
            snapshot={snapshot}
          />

          <section className="section" id="performance">
            <article className="panel panel--chart panel--trend">
              <div className="panel__heading">
                <div>
                  <span className="panel__context">Delivery trend</span>
                  <h2>What we spent, and what came back</h2>
                </div>
                <span className="panel__meta">
                  {snapshot.trend.length} closed days
                </span>
              </div>
              <SpendTrend currency={snapshot.account.currency} snapshot={snapshot} />
            </article>
          </section>

          <CustomerJourneyRail snapshot={snapshot} />

          {snapshot.mode === "mock" && (
            <SyntheticMockupNotice platform={snapshot.selectedPlatform} />
          )}

          {/* Unified Cross-Channel Cash Economics & RFM Bridge */}
          {snapshot.blendedMer &&
            snapshot.rfmAudienceBridge && (
              <BlendedMerSection
                blendedMer={snapshot.blendedMer}
                rfmBridge={snapshot.rfmAudienceBridge}
                currency={snapshot.account.currency}
                selectedPlatform={snapshot.selectedPlatform}
              />
            )}

          {/* Meta-shaped diagnostic. Gated the same way as the Google-only
              block below: it disappears under the combined filter too, not
              only under Google, so a reader must narrow to the platform that
              actually reports the cut. */}
          {isSectionVisible("audience", snapshot.selectedPlatform) && (
            <MetaAudienceSection
              analysis={snapshot.audience}
              currency={snapshot.account.currency}
            />
          )}

          {isSectionVisible("creative-fatigue", snapshot.selectedPlatform) &&
            snapshot.creativeFatigue && (
              <MetaCreativeRadar
                fatigue={snapshot.creativeFatigue}
                placements={snapshot.placementAnalysis}
                currency={snapshot.account.currency}
              />
            )}

          {/* Google-shaped diagnostics. Under a combined filter the page stays
              on what actually spans both platforms; these return the moment
              the reader narrows to Google. */}
          {isSectionVisible("campaign-types", snapshot.selectedPlatform) && (
            <CampaignTypeSection
              accountSlug={snapshot.account.id}
              analysis={snapshot.campaignTypes}
              comparisonEnabled={snapshot.comparisonEnabled}
              comparisonLabel={snapshot.comparisonBasis.label}
              currency={snapshot.account.currency}
              selectedPlatform={snapshot.selectedPlatform}
              targets={targets}
            />
          )}

          {isSectionVisible("search-terms", snapshot.selectedPlatform) && (
            <SearchTermSection
              analysis={snapshot.searchTerms}
              currency={snapshot.account.currency}
              intent={snapshot.intentAnalysis}
              matchTypeDrift={snapshot.matchTypeDrift}
              selectedPlatform={snapshot.selectedPlatform}
              wastedSpend={snapshot.wastedSpendSummary}
            />
          )}

          {isSectionVisible("impression-share", snapshot.selectedPlatform) && (
            <ImpressionShareSection snapshot={snapshot} />
          )}

          {isSectionVisible("geo-analysis", snapshot.selectedPlatform) &&
            snapshot.geo && (
            <GeoSection
              analysis={snapshot.geo}
              currency={snapshot.account.currency}
              disabled={isApplying}
              onSelect={(next) => void applyGeoSelection(next)}
              targets={targets}
            />
          )}

          {isSectionVisible("device-analysis", snapshot.selectedPlatform) && (
            <DeviceSection
              analysis={snapshot.devices}
              comparison={snapshot.comparisonDevices}
              comparisonEnabled={snapshot.comparisonEnabled}
              comparisonLabel={snapshot.comparisonBasis.label}
              currency={snapshot.account.currency}
              selectedPlatform={snapshot.selectedPlatform}
            />
          )}

          {isSectionVisible("audience-segments", snapshot.selectedPlatform) && (
            <GoogleAudienceSection
              analysis={snapshot.audienceSegments}
              currency={snapshot.account.currency}
            />
          )}


          {snapshot.pendingPanels.map((panel) => (
            <PendingPanelSection key={panel.key} panel={panel} />
          ))}

          <section className="section">
            <article className="panel worklog-panel--full" id="worklog">
              <div className="panel__heading">
                <div>
                  <span className="eyebrow">Approved activity</span>
                  <h2>Actions during this period</h2>
                </div>
                <a className="text-link" href="/worklog">
                  Add worklog →
                </a>
              </div>
              <div className="timeline">
                {snapshot.worklog.length ? (
                  snapshot.worklog.map((entry) => {
                    const isGoogle = entry.platform === "google";
                    const isMeta = entry.platform === "meta";

                    return (
                      <article className="timeline__item" key={entry.id}>
                        <div className="timeline__date">
                          {dateFormatter.format(new Date(entry.occurredAt))}
                        </div>
                        <div>
                          <div className="timeline__meta">
                            <span className="timeline__action-type">
                              {sentenceCase(entry.actionType)}
                            </span>
                            <span
                              className={`timeline__platform-badge ${
                                isGoogle
                                  ? "timeline__platform-badge--google"
                                  : isMeta
                                    ? "timeline__platform-badge--meta"
                                    : "timeline__platform-badge--cross"
                              }`}
                            >
                              {isGoogle ? (
                                <GoogleAdsIcon />
                              ) : isMeta ? (
                                <MetaAdsIcon />
                              ) : (
                                <TrendIcon />
                              )}
                              {isGoogle
                                ? "Google Ads"
                                : isMeta
                                  ? "Meta Ads"
                                  : "Cross-platform"}
                            </span>
                          </div>
                          <h3>{worklogSummary(entry.actionSummary)}</h3>
                          <p>{entry.reasonOrHypothesis}</p>
                        </div>
                      </article>
                    );
                  })
                ) : (
                  <div className="empty-state">
                    No approved worklog overlaps this timeframe.
                  </div>
                )}
              </div>
            </article>
          </section>

    </AppFrame>
  );
}
