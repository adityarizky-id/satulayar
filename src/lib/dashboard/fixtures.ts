import {
  conversionComparabilityCaveat,
  evaluateAcquisitionGuardrail,
  resolveScopeCurrency,
} from "@/lib/dashboard/account-contract";
import { resolveIntentProfile } from "@/lib/analytics/intent-classifier";
import type { AccountOption } from "@/lib/dashboard/accounts";
import {
  buildBudgetPacing,
  DEFAULT_BUDGETS,
  type BudgetPlanSource,
  type MonthlyBudgets,
} from "@/lib/dashboard/budget";
import { evaluateDataQuality } from "@/lib/dashboard/data-quality";
import {
  buildCampaignTypeAnalysis,
  buildCampaignTypeAnalysisFromRows,
  type CampaignAttribute,
  type CampaignEntityMetric,
} from "@/lib/dashboard/campaign-types";
import { buildMetaAudienceAnalysis } from "@/lib/dashboard/audience-meta";
import {
  buildGoogleAudienceAnalysis,
  buildGoogleAudienceAnalysisFromRows,
  type StoredGoogleAudienceRow,
} from "@/lib/dashboard/audience-google";
import {
  buildMetaCreativeFatigueAnalysis,
  buildMetaPlacementAnalysis,
} from "@/lib/dashboard/creative-fatigue";
import {
  buildGoogleIntentAnalysis,
  buildGoogleIntentAnalysisFromRows,
  buildGoogleMatchTypeDriftSummary,
  buildGoogleMatchTypeDriftSummaryFromRows,
  buildGoogleWastedSpendSummary,
  buildGoogleWastedSpendSummaryFromRows,
} from "@/lib/dashboard/intent-tiers";
import {
  buildBlendedMerSummary,
  buildBudgetOpportunityAdvisor,
  buildRfmPaidAudienceBridge,
} from "@/lib/dashboard/blended-mer";
import { buildSearchTermAnalysis } from "@/lib/dashboard/search-terms-fixture";
import {
  buildSearchTermAnalysisFromRows,
  COMPARISON_WINDOW_LABELS,
  resolveComparisonRange,
  type ComparisonWindow,
  type StoredSearchTermRow,
} from "@/lib/dashboard/search-terms";
import {
  buildDeviceAnalysis,
  buildDeviceAnalysisFromRows,
  type StoredDeviceRow,
} from "@/lib/dashboard/device";
import {
  buildGeoAnalysis,
  buildGeoAnalysisFromRows,
  type StoredGeoMetricRow,
} from "@/lib/dashboard/geo/analysis";
import type { GeoLevel } from "@/lib/dashboard/geo/contract";
import { createFixtureGeoSource } from "@/lib/dashboard/geo/fixture-source";
import {
  buildImpressionShareReport,
  buildImpressionShareReportFromRows,
  type StoredImpressionSharePeriodRow,
} from "@/lib/dashboard/impression-share";
import { buildJourneyCards } from "@/lib/dashboard/scorecard";
import { buildRuleBasedAdvisory } from "@/lib/dashboard/advisory";
import {
  buildAuctionDiagnostics,
} from "@/lib/ui-contract";
import {
  pendingSyntheticPanels,
  suppressesSyntheticPanels,
} from "@/lib/dashboard/sections";
import { buildPerformanceSnapshot } from "@/lib/dashboard/snapshot-summary";
import {
  DEFAULT_TARGETS,
  type PerformanceTargets,
} from "@/lib/dashboard/targets";
import {
  aggregateMetrics,
  filterMetricRows,
} from "@/lib/dashboard/kpi";
import type {
  DailyMetric,
  DashboardDataMode,
  DashboardSnapshot,
  DashboardStorageMode,
  DateRange,
  Platform,
  WorklogEntry,
} from "@/lib/dashboard/types";
import { currentDateInTimeZone } from "@/lib/dashboard/timeframes";

const FIXTURE_NOW = new Date();
const FIXTURE_REFERENCE_DATE = currentDateInTimeZone("UTC", FIXTURE_NOW);
const FIXTURE_SYNCED_AT = FIXTURE_NOW.toISOString();

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function buildFixtureRows(): DailyMetric[] {
  const start = new Date("2026-06-01T00:00:00Z");
  const end = new Date(`${FIXTURE_REFERENCE_DATE}T00:00:00Z`);
  const rows: DailyMetric[] = [];

  for (
    let cursor = new Date(start), dayIndex = 0;
    cursor <= end;
    cursor.setUTCDate(cursor.getUTCDate() + 1), dayIndex += 1
  ) {
    const date = toIsoDate(cursor);
    const julyLift = date >= "2026-07-01" ? 1.12 : 1;

    const metaSpend = Number(
      ((47 + (dayIndex % 5) * 3.2) * julyLift).toFixed(2),
    );
    const metaPurchases = Math.max(
      1,
      Math.round((2 + (dayIndex % 4) * 0.45) * julyLift),
    );
    const metaRegistrations = 10 + (dayIndex % 6);
    const metaRevenue = metaPurchases * (39 + (dayIndex % 3) * 4);

    rows.push({
      date,
      clientId: "satulayar-demo",
      accountId: "kopi-senja-demo",
      platform: "meta",
      currency: "USD",
      accountTimezone: "Asia/Jakarta",
      spend: metaSpend,
      impressions: 12_400 + dayIndex * 97,
      clicks: 318 + (dayIndex % 7) * 14,
      landingPageViews: 267 + (dayIndex % 6) * 12,
      registrations: metaRegistrations,
      purchases: metaPurchases,
      // Meta reports deduplicated reach per day; frequency falls out of it.
      reach: Math.round((12_400 + dayIndex * 97) / (1.6 + (dayIndex % 5) * 0.12)),
      platformConversionValue: Number((metaRevenue + metaRegistrations * 5).toFixed(2)),
      actualPurchaseRevenue: Number(metaRevenue.toFixed(2)),
      sourceConnector: "mock",
      sourceQueryVersion: "fixture-v1",
      syncedAt: FIXTURE_SYNCED_AT,
      isProvisional: false,
    });

    const googleSpend = Number(
      ((36 + (dayIndex % 4) * 2.75) * julyLift).toFixed(2),
    );
    const googlePurchases = Math.max(
      1,
      Math.round((1.6 + (dayIndex % 5) * 0.34) * julyLift),
    );
    const googleRegistrations = 7 + (dayIndex % 5);
    const googleRevenue = googlePurchases * (43 + (dayIndex % 4) * 3);

    rows.push({
      date,
      clientId: "satulayar-demo",
      accountId: "kopi-senja-demo",
      platform: "google",
      currency: "USD",
      accountTimezone: "Asia/Jakarta",
      spend: googleSpend,
      impressions: 8_900 + dayIndex * 83,
      clicks: 221 + (dayIndex % 6) * 11,
      landingPageViews: 192 + (dayIndex % 5) * 9,
      registrations: googleRegistrations,
      purchases: googlePurchases,
      searchImpressionShare: 0.09 + (dayIndex % 4) * 0.004,
      impressionShareLostToRank: 0.46 + (dayIndex % 5) * 0.01,
      impressionShareLostToBudget: 0.41 - (dayIndex % 5) * 0.008,
      platformConversionValue: Number(
        (googleRevenue + googleRegistrations * 4).toFixed(2),
      ),
      actualPurchaseRevenue: Number(googleRevenue.toFixed(2)),
      sourceConnector: "mock",
      sourceQueryVersion: "fixture-v1",
      syncedAt: FIXTURE_SYNCED_AT,
      isProvisional: false,
    });
  }

  return rows;
}

const MONTH_LIFT = [
  0.92, 0.9, 0.97, 1.02, 0.88, 1.05, 0.95, 0.9, 1, 1.18, 1.24, 1.45,
] as const;

/**
 * History before the detailed preview window. It keeps the same metric shape
 * but only needs to be plausible, so it is generated from the date itself with
 * a seasonal curve and a fixed year-on-year trend.
 */
function buildHistoricalRows(): DailyMetric[] {
  const start = new Date("2024-01-01T00:00:00Z");
  const end = new Date("2026-05-31T00:00:00Z");
  const rows: DailyMetric[] = [];

  for (
    let cursor = new Date(start), dayIndex = 0;
    cursor <= end;
    cursor.setUTCDate(cursor.getUTCDate() + 1), dayIndex += 1
  ) {
    const date = toIsoDate(cursor);
    const month = Number(date.slice(5, 7));
    const year = Number(date.slice(0, 4));
    const weekday = cursor.getUTCDay();
    const seasonal = MONTH_LIFT[month - 1] ?? 1;
    const weekly = weekday === 0 || weekday === 6 ? 0.82 : 1.07;
    const yearly = year === 2024 ? 0.86 : year === 2025 ? 0.94 : 1;
    const lift = seasonal * weekly * yearly;

    for (const platform of ["meta", "google"] as const) {
      const isMeta = platform === "meta";
      const spend = Number(
        ((isMeta ? 44 : 34) + (dayIndex % 9) * 1.9) * lift,
      );
      const impressions = Math.round(
        ((isMeta ? 11_800 : 8_400) + (dayIndex % 11) * 180) * lift,
      );
      const clicks = Math.round(((isMeta ? 300 : 210) + (dayIndex % 7) * 9) * lift);
      const landingPageViews = Math.round(clicks * (isMeta ? 0.84 : 0.87));
      const registrations = Math.round(
        ((isMeta ? 9 : 6) + (dayIndex % 5)) * lift,
      );
      const purchases = Math.max(1, Math.round(((isMeta ? 2 : 1.6) + (dayIndex % 4) * 0.4) * lift));
      const revenue = purchases * ((isMeta ? 39 : 43) + (dayIndex % 3) * 4);

      rows.push({
        date,
        clientId: "satulayar-demo",
        accountId: "kopi-senja-demo",
        platform,
        currency: "USD",
        accountTimezone: "Asia/Jakarta",
        spend: Number(spend.toFixed(2)),
        impressions,
        clicks,
        landingPageViews,
        registrations,
        purchases,
        platformConversionValue: Number(
          (revenue + registrations * (isMeta ? 5 : 4)).toFixed(2),
        ),
        actualPurchaseRevenue: Number(revenue.toFixed(2)),
        sourceConnector: "mock",
        sourceQueryVersion: "fixture-v1",
        syncedAt: FIXTURE_SYNCED_AT,
        isProvisional: false,
        ...(isMeta
          ? { reach: Math.round(impressions / (1.5 + (dayIndex % 6) * 0.1)) }
          : {
            searchImpressionShare: 0.08 + (dayIndex % 5) * 0.005,
            impressionShareLostToRank: 0.48 + (dayIndex % 4) * 0.01,
            impressionShareLostToBudget: 0.4 - (dayIndex % 4) * 0.01,
          }),
      });
    }
  }

  return rows;
}

export const fixtureRows = [...buildHistoricalRows(), ...buildFixtureRows()];

const accountFixtureCache = new Map<string, DailyMetric[]>();

/**
 * Every brand reads the same synthetic shape at its own volume, currency, and
 * timezone, and only for the platforms that brand actually runs.
 */
export function getFixtureRowsForAccount(
  account: AccountOption,
): DailyMetric[] {
  const cached = accountFixtureCache.get(account.slug);
  if (cached) return cached;

  const scale = account.fixtureScale;
  const rows = fixtureRows
    .filter((row) => account.platforms.includes(row.platform))
    .map((row) => ({
      ...row,
      clientId: account.slug,
      accountId: `${account.slug}-demo`,
      currency: account.currency,
      accountTimezone: account.timezone,
      spend: Number((row.spend * scale).toFixed(2)),
      impressions: Math.round(row.impressions * scale),
      clicks: Math.round(row.clicks * scale),
      landingPageViews:
        row.landingPageViews === null
          ? null
          : Math.round(row.landingPageViews * scale),
      registrations: Math.round(row.registrations * scale),
      purchases: Math.max(1, Math.round(row.purchases * scale)),
      platformConversionValue: Number(
        (row.platformConversionValue * scale).toFixed(2),
      ),
      actualPurchaseRevenue: Number(
        (row.actualPurchaseRevenue * scale).toFixed(2),
      ),
      // Share metrics are ratios of an auction, so brand size does not move
      // them the way volume metrics move.
      ...(row.reach === undefined
        ? {}
        : { reach: Math.round(row.reach * scale) }),
    }));

  accountFixtureCache.set(account.slug, rows);
  return rows;
}


export const fixtureWorklog: WorklogEntry[] = [
  {
    id: "worklog-g-001",
    occurredAt: "2026-08-11T11:30:00.000Z",
    platform: "google",
    actionType: "Budget change",
    actionSummary: "[Google Ads change_event] Scaled daily budget from $45 to $65 on High-Intent Bulk Supplies Search.",
    reasonOrHypothesis: "Tier 1 search terms demonstrated 4.8x ROAS with budget headroom.",
    status: "approved",
  },
  {
    id: "worklog-m-001",
    occurredAt: "2026-08-09T14:20:00.000Z",
    platform: "meta",
    actionType: "Creative rotation",
    actionSummary: "[Meta Ads activities] Swapped fatigued static ad (#104) with new 15s Reels Studio unboxing UGC.",
    reasonOrHypothesis: "Static ad reached 3.8x frequency and CTR dropped below 1.0%; UGC angle restored 28% hook rate.",
    status: "approved",
  },
  {
    id: "worklog-g-002",
    occurredAt: "2026-08-07T09:15:00.000Z",
    platform: "google",
    actionType: "Keyword or negative",
    actionSummary: "[Google Ads change_event] Added 6 negative phrase matches to block retail & DIY queries.",
    reasonOrHypothesis: "Eliminated budget leakage on 'free recipes' and 'single sachet' searches to save ~$380/mo.",
    status: "approved",
  },
  {
    id: "worklog-m-002",
    occurredAt: "2026-08-04T16:45:00.000Z",
    platform: "meta",
    actionType: "Budget change",
    actionSummary: "[Meta Ads activities] Scaled prospecting ad set budget +25% on Repeat Champions 1% Lookalike.",
    reasonOrHypothesis: "RFM customer seed audience delivered profitable CPO within guardrail limits.",
    status: "approved",
  },
  {
    id: "worklog-g-003",
    occurredAt: "2026-08-02T10:00:00.000Z",
    platform: "google",
    actionType: "Bid or target change",
    actionSummary: "[Google Ads change_event] Tightened Target CPA to $28 on Tier 1 Category Search.",
    reasonOrHypothesis: "Maintain margin efficiency during the mid-year order volume surge.",
    status: "approved",
  },
  {
    id: "worklog-m-003",
    occurredAt: "2026-07-28T13:10:00.000Z",
    platform: "meta",
    actionType: "Audience change",
    actionSummary: "[Meta Ads activities] Excluded 7-day recent purchasers from Cold Prospecting campaigns.",
    reasonOrHypothesis: "Avoid ad impression waste on customers with open unfulfilled warehouse orders.",
    status: "approved",
  },
  {
    id: "worklog-g-004",
    occurredAt: "2026-07-20T11:00:00.000Z",
    platform: "google",
    actionType: "Structure change",
    actionSummary: "[Google Ads change_event] Created dedicated ad group for Drip Bag Subscriptions.",
    reasonOrHypothesis: "Improve Quality Score and message match for high-volume specialty coffee queries.",
    status: "approved",
  },
  {
    id: "worklog-demo-001",
    occurredAt: "2026-07-03T09:30:00.000Z",
    platform: "meta",
    actionType: "Creative rotation",
    actionSummary: "[Meta Ads activities] Introduced a fresh product-led creative carousel angle.",
    reasonOrHypothesis: "Reduce fatigue while preserving purchase-quality signals.",
    status: "approved",
  },
  {
    id: "worklog-demo-002",
    occurredAt: "2026-07-08T10:15:00.000Z",
    platform: "google",
    actionType: "Keyword or negative",
    actionSummary: "[Google Ads change_event] Tightened low-intent query coverage in search campaign.",
    reasonOrHypothesis: "Protect cost per purchase without suppressing qualified demand.",
    status: "approved",
  },
  {
    id: "worklog-demo-003",
    occurredAt: "2026-07-12T08:45:00.000Z",
    platform: "all",
    actionType: "Tracking or measurement fix",
    actionSummary: "Reviewed purchase-value separation from assigned lead value.",
    reasonOrHypothesis: "Keep Store ROAS distinct from platform conversion value.",
    status: "approved",
  },
];

/** Spend per campaign key, so impression-share averages stay spend-weighted. */
function campaignSpendByKey(
  rows: readonly DailyMetric[],
): ReadonlyMap<string, number> {
  const totals = new Map<string, number>();

  for (const row of rows) {
    if (!row.entityKey) continue;
    totals.set(row.entityKey, (totals.get(row.entityKey) ?? 0) + row.spend);
  }

  return totals;
}

interface DashboardSnapshotOptions {
  account?: DashboardSnapshot["account"];
  mode?: DashboardDataMode;
  storage?: DashboardStorageMode;
  worklog?: WorklogEntry[];
  targets?: PerformanceTargets;
  budgets?: MonthlyBudgets;
  /**
   * Where `budgets` came from. Carried so the card can distinguish an agreed
   * plan from the built-in placeholder instead of printing both the same way.
   */
  budgetPlan?: { source?: BudgetPlanSource; cycleStart?: string | null };
  /**
   * Today in the account's timezone. Budget pacing needs it because it paces
   * the 30-day reporting cycle, not the selected filter: without the real
   * current day a running cycle reads as closed the moment the filter ends
   * today, and the two days still left to steer disappear from the card.
   */
  referenceDate?: string;
  /**
   * Device-segmented rows from `ad_device_daily`. When present the device
   * panel is measured rather than modelled, and leaves the pending list.
   */
  deviceRows?: readonly StoredDeviceRow[];
  /**
   * Period-grain share rows from `ad_impression_share_period`. Only a row
   * matching the selected window exactly is used; anything else leaves the
   * impression-share panel pending rather than deriving it from masked days.
   */
  impressionSharePeriodRows?: readonly StoredImpressionSharePeriodRow[];
  /** Measured Google country/region rows for the selected window. */
  geoRows?: readonly StoredGeoMetricRow[];
  /** Same grain for the selected comparison window. */
  comparisonGeoRows?: readonly StoredGeoMetricRow[];
  /** Measured Google audience criteria for the selected window. */
  audienceRows?: readonly StoredGoogleAudienceRow[];
  /** False hides every period-over-period read-out. Defaults to true. */
  comparisonEnabled?: boolean;
  /** Lookback every period-over-period read-out compares against. */
  comparisonWindow?: ComparisonWindow;
  /** Explicit baseline dates; only used when the window is "custom". */
  comparisonRange?: DateRange;
  geo?: {
    countryCode?: string;
    level?: GeoLevel;
    parentId?: string | null;
    accountSlug?: string;
    scale?: number;
  };
  /**
   * Campaign-level rows and their channel types, when the caller has read
   * them. Supplying both is what turns the campaign-type table from a
   * generated illustration into a real breakdown, and it is the only way that
   * panel survives live mode.
   */
  campaigns?: {
    rows: readonly DailyMetric[];
    comparisonRows?: readonly DailyMetric[];
    attributes: readonly CampaignAttribute[];
    entityRows?: readonly CampaignEntityMetric[];
    comparisonEntityRows?: readonly CampaignEntityMetric[];
  };
  /**
   * Stored search query rows covering the period and the comparison window.
   * Supplying them is what lets the search-term section leave the pending
   * list in live mode; with none, the section stays pending there.
   */
  searchTerms?: {
    rows: readonly StoredSearchTermRow[];
  };
}

/** Channel types whose queries `search_term_view` can report. */
const QUERY_CAMPAIGN_CHANNEL_TYPES = new Set(["SEARCH", "SHOPPING"]);

function inclusiveDays(range: DateRange): number {
  const start = Date.parse(`${range.start}T00:00:00Z`);
  const end = Date.parse(`${range.end}T00:00:00Z`);
  return Math.floor((end - start) / 86_400_000) + 1;
}

/**
 * Historical lookbacks can be longer than the active period. Scale additive
 * metrics to an active-duration equivalent so KPI deltas remain comparable;
 * ratios and daily averages retain their original meaning after aggregation.
 */
function normaliseComparisonRows(
  rows: DailyMetric[],
  activeRange: DateRange,
  comparisonRange: DateRange,
): DailyMetric[] {
  const activeDays = inclusiveDays(activeRange);
  const comparisonDays = inclusiveDays(comparisonRange);
  if (activeDays === comparisonDays) return rows;

  const factor = activeDays / comparisonDays;
  return rows.map((row) => ({
    ...row,
    spend: row.spend * factor,
    impressions: row.impressions * factor,
    clicks: row.clicks * factor,
    landingPageViews:
      row.landingPageViews === null ? null : row.landingPageViews * factor,
    registrations: row.registrations * factor,
    purchases: row.purchases * factor,
    platformConversionValue: row.platformConversionValue * factor,
    actualPurchaseRevenue: row.actualPurchaseRevenue * factor,
    // Null and undefined stay as they are: "not measured" does not scale.
    orderConversionValue:
      typeof row.orderConversionValue === "number"
        ? row.orderConversionValue * factor
        : row.orderConversionValue,
    registrationLeadValue:
      typeof row.registrationLeadValue === "number"
        ? row.registrationLeadValue * factor
        : row.registrationLeadValue,
  }));
}

export function buildDashboardSnapshotFromRows(
  rows: DailyMetric[],
  range: DateRange = { start: "2026-07-01", end: "2026-07-14" },
  platform: Platform = "all",
  options: DashboardSnapshotOptions = {},
): DashboardSnapshot {
  const mode = options.mode ?? "mock";
  const storage = options.storage ?? "fixture";
  const comparisonEnabled = options.comparisonEnabled ?? true;
  const comparisonWindow = options.comparisonWindow ?? "previous";
  const comparisonRange = resolveComparisonRange(
    range,
    comparisonWindow,
    options.comparisonRange,
  );
  const currentRows = filterMetricRows(rows, range, platform);
  const rawComparisonRows = filterMetricRows(rows, comparisonRange, platform);
  const comparisonRows = normaliseComparisonRows(
    rawComparisonRows,
    range,
    comparisonRange,
  );
  const totals = aggregateMetrics(currentRows);
  const comparisonTotals = aggregateMetrics(comparisonRows);
  const hasCurrentMetrics = currentRows.length > 0;
  // The account contract currency is handed to the gate, so rows that report a
  // different currency block the snapshot instead of rendering under the wrong
  // label. Without it the gate only caught a scope that mixed currencies, and a
  // scope that was consistently the wrong currency passed as ready.
  const quality = evaluateDataQuality(currentRows, range, platform, {
    mode,
    expectedCurrency: options.account?.currency ?? "USD",
    today: currentDateInTimeZone(options.account?.timezone ?? "UTC"),
  });
  const lastSuccessfulSync =
    rows
      .map((row) => row.syncedAt)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;
  const sourceQueryVersion =
    currentRows[0]?.sourceQueryVersion ??
    rows[0]?.sourceQueryVersion ??
    "no-data";

  const dates = [...new Set(currentRows.map((row) => row.date))];
  const trend = dates.map((date) => {
    const dateRows = currentRows.filter((row) => row.date === date);
    const dailyTotals = aggregateMetrics(dateRows);
    const metaRows = dateRows.filter((row) => row.platform === "meta");
    const googleRows = dateRows.filter((row) => row.platform === "google");
    const metaSpend = metaRows.reduce((sum, row) => sum + row.spend, 0);
    const googleSpend = googleRows.reduce((sum, row) => sum + row.spend, 0);
    const metaPurchaseValue = metaRows.reduce(
      (sum, row) => sum + row.actualPurchaseRevenue,
      0,
    );
    const googlePurchaseValue = googleRows.reduce(
      (sum, row) => sum + row.actualPurchaseRevenue,
      0,
    );

    return {
      date,
      ...dailyTotals,
      metaSpend,
      googleSpend,
      metaPurchaseValue,
      googlePurchaseValue,
    };
  });

  const platformBreakdown = (["meta", "google"] as const)
    .filter((item) => platform === "all" || platform === item)
    .map((item) => ({
      platform: item,
      totals: aggregateMetrics(
        currentRows.filter((row) => row.platform === item),
      ),
      comparisonTotals: aggregateMetrics(
        comparisonRows.filter((row) => row.platform === item),
      ),
    }));

  const worklog = (options.worklog ?? fixtureWorklog).filter(
    (entry) =>
      entry.occurredAt.slice(0, 10) >= range.start &&
      entry.occurredAt.slice(0, 10) <= range.end &&
      (platform === "all" ||
        entry.platform === "all" ||
        entry.platform === platform),
  );

  const account = options.account ?? {
    id: "kopi-senja-demo",
    name: "Kopi Senja Nusantara",
    currency: "USD" as const,
    timezone: "Asia/Jakarta",
  };
  const scopeCurrency = resolveScopeCurrency(currentRows, account.currency);
  const guardrail = evaluateAcquisitionGuardrail(
    totals,
    {
      currency: scopeCurrency.ok ? scopeCurrency.currency : account.currency,
      costAggregationAllowed: scopeCurrency.ok,
    },
    options.targets ?? DEFAULT_TARGETS,
  );
  const conversionCaveat = hasCurrentMetrics
    ? conversionComparabilityCaveat(platform)
    : null;

  // With comparison switched off, no card may carry a baseline: every delta
  // then renders as unavailable instead of quietly measuring against a window
  // the reader did not choose. The verdict below reads the same cards, so it
  // stops claiming movement too.
  // Inclusive day count of the selected period. A card that cannot compare
  // uses it to say how far to widen instead of only that widening is needed.
  const periodDays =
    Math.round(
      (new Date(`${range.end}T00:00:00Z`).getTime() -
        new Date(`${range.start}T00:00:00Z`).getTime()) /
      86_400_000,
    ) + 1;
  const cards = comparisonEnabled
    ? buildJourneyCards(
      totals,
      comparisonTotals,
      sourceQueryVersion,
      platform,
      periodDays,
    )
    : buildJourneyCards(
      totals,
      comparisonTotals,
      sourceQueryVersion,
      platform,
      periodDays,
    ).map((card) => ({ ...card, previousValue: null }));
  const snapshotSummary = buildPerformanceSnapshot(cards, guardrail, quality);
  const googleSpend = currentRows
    .filter((row) => row.platform === "google")
    .reduce((total, row) => total + row.spend, 0);
  const googleRows = currentRows.filter((row) => row.platform === "google");
  const metaRows = currentRows.filter((row) => row.platform === "meta");
  const googleComparisonRows = comparisonRows.filter(
    (row) => row.platform === "google",
  );
  // Live mode publishes only what a platform reported. Every panel below is
  // still modelled from account totals with fixed shares, so in live mode it
  // is withheld and a placeholder names the feed it is waiting on instead.
  // Rendering them anyway put a hardcoded 4.8x ROAS and a geography total of
  // three times the real spend on the same screen as reconciled figures.
  const withholdSynthetic = suppressesSyntheticPanels(mode);
  const basePendingPanels = withholdSynthetic
    ? pendingSyntheticPanels(platform)
    : [];
  // Period-exact rows win outright. They are what Google answered for this
  // window; the modelled report is fixed campaign shapes and the daily roll-up
  // it would otherwise stand in for can land close to, but not on, the real
  // figure. The panel leaves the pending list only on this branch.
  const liveImpressionShare =
    platform === "meta"
      ? null
      : buildImpressionShareReportFromRows({
        range,
        periodRows: options.impressionSharePeriodRows ?? [],
        campaignNames: new Map(
          (options.campaigns?.attributes ?? []).map((attribute) => [
            attribute.campaignKey,
            attribute.campaignName,
          ]),
        ),
        campaignSpend: campaignSpendByKey(options.campaigns?.rows ?? []),
      });
  const impressionShare =
    liveImpressionShare ??
    (withholdSynthetic || platform === "meta" || googleSpend === 0
      ? null
      : buildImpressionShareReport(range, googleSpend));
  const auctionDiagnostics =
    platform === "meta" || googleSpend === 0
      ? null
      : buildAuctionDiagnostics({
        range,
        lostToRankRatio:
          totals.impressionShareLostToRank != null
            ? Math.min(Math.max(totals.impressionShareLostToRank, 0), 1)
            : 0.801,
        lostToBudgetRatio:
          totals.impressionShareLostToBudget != null
            ? Math.min(Math.max(totals.impressionShareLostToBudget, 0), 1)
            : 0.137,
        aggregationBasis:
          totals.impressionShareLostToRank != null
            ? "daily_derived"
            : "daily_derived",
      });
  // Measured rows win outright. They are one row per device per day as Google
  // reported it, so unlike the modelled split they are safe to act on: the
  // panel leaves the pending list only on this branch.
  const liveDevices =
    platform === "meta" || (options.deviceRows?.length ?? 0) === 0
      ? null
      : buildDeviceAnalysisFromRows({
        rows: options.deviceRows ?? [],
        range,
        currency: account.currency,
      });
  const devices =
    liveDevices ??
    (withholdSynthetic || platform === "meta" || googleRows.length === 0
      ? null
      : buildDeviceAnalysis({
        range,
        currency: account.currency,
        googleSpend,
        googleImpressions: googleRows.reduce(
          (total, row) => total + row.impressions,
          0,
        ),
        googleClicks: googleRows.reduce((total, row) => total + row.clicks, 0),
        googlePurchases: googleRows.reduce(
          (total, row) => total + row.purchases,
          0,
        ),
        googleRegistrations: googleRows.reduce(
          (total, row) => total + row.registrations,
          0,
        ),
        googlePurchaseValue: googleRows.reduce(
          (total, row) => total + row.actualPurchaseRevenue,
          0,
        ),
      }));
  const comparisonDevices =
    withholdSynthetic ||
      !comparisonEnabled ||
      platform === "meta" ||
      googleRows.length === 0 ||
      googleComparisonRows.length === 0
      ? null
      : buildDeviceAnalysis({
        range: comparisonRange,
        currency: account.currency,
        googleSpend: googleComparisonRows.reduce(
          (total, row) => total + row.spend,
          0,
        ),
        googleImpressions: googleComparisonRows.reduce(
          (total, row) => total + row.impressions,
          0,
        ),
        googleClicks: googleComparisonRows.reduce(
          (total, row) => total + row.clicks,
          0,
        ),
        googlePurchases: googleComparisonRows.reduce(
          (total, row) => total + row.purchases,
          0,
        ),
        googleRegistrations: googleComparisonRows.reduce(
          (total, row) => total + row.registrations,
          0,
        ),
        googlePurchaseValue: googleComparisonRows.reduce(
          (total, row) => total + row.actualPurchaseRevenue,
          0,
        ),
      });
  // Real campaign rows win wherever they exist, in either mode. Only when
  // there are none does the generated table stand in, and only outside live
  // mode.
  const liveCampaignTypes =
    platform === "meta" || !options.campaigns
      ? null
      : buildCampaignTypeAnalysisFromRows({
        rows: options.campaigns.rows,
        comparisonRows: comparisonEnabled
          ? options.campaigns.comparisonRows
          : [],
        attributes: options.campaigns.attributes,
        entityRows: options.campaigns.entityRows,
        comparisonEntityRows: comparisonEnabled
          ? options.campaigns.comparisonEntityRows
          : [],
        comparisonRange: comparisonEnabled ? comparisonRange : null,
        range,
        currency: account.currency,
      });
  const campaignTypes =
    liveCampaignTypes ??
    (withholdSynthetic || platform === "meta" || googleRows.length === 0
      ? null
      : buildCampaignTypeAnalysis({
        range,
        currency: account.currency,
        accountSlug: account.id,
        googleSpend,
        googleImpressions: googleRows.reduce(
          (total, row) => total + row.impressions,
          0,
        ),
        googleClicks: googleRows.reduce((total, row) => total + row.clicks, 0),
        googlePurchases: googleRows.reduce(
          (total, row) => total + row.purchases,
          0,
        ),
        googleRegistrations: googleRows.reduce(
          (total, row) => total + row.registrations,
          0,
        ),
        googlePurchaseValue: googleRows.reduce(
          (total, row) => total + row.actualPurchaseRevenue,
          0,
        ),
      }));

  // A panel that found real rows is no longer pending, so it must drop off the
  // placeholder list — otherwise the page would show the table and a "no data
  // yet" card for the same section.
  // Real query rows win wherever they exist, in either mode, exactly like the
  // campaign-type table. The denominator for the withheld-query gap is the
  // spend of Search and Shopping campaigns taken from the stored campaign rows,
  // not a fixed share of account spend.
  const campaignChannelTypes = new Map(
    (options.campaigns?.attributes ?? []).map((item) => [
      item.campaignKey,
      item.channelType,
    ]),
  );
  const queryCampaignSpend = options.campaigns
    ? options.campaigns.rows
      .filter(
        (row) =>
          row.platform === "google" &&
          row.date >= range.start &&
          row.date <= range.end &&
          row.entityKey !== undefined &&
          QUERY_CAMPAIGN_CHANNEL_TYPES.has(
            campaignChannelTypes.get(row.entityKey) ?? "",
          ),
      )
      .reduce((total, row) => total + row.spend, 0)
    : null;
  const storedSearchTermRows = options.searchTerms?.rows ?? [];
  const currentSearchTermRows = storedSearchTermRows.filter(
    (row) => row.date >= range.start && row.date <= range.end,
  );
  const liveSearchTerms =
    platform === "meta" || storedSearchTermRows.length === 0
      ? null
      : buildSearchTermAnalysisFromRows({
        rows: currentSearchTermRows,
        comparisonRows: comparisonEnabled
          ? storedSearchTermRows.filter(
            (row) =>
              row.date >= comparisonRange.start &&
              row.date <= comparisonRange.end,
          )
          : [],
        range,
        comparisonRange,
        comparisonWindow,
        currency: account.currency,
        targets: options.targets ?? DEFAULT_TARGETS,
        campaignChannelTypes,
        // Without attributes the Search campaigns cannot be picked out, so the
        // gap is reported as unavailable instead of as the whole account.
        queryCampaignSpend:
          campaignChannelTypes.size === 0 ? null : queryCampaignSpend,
        accountSlug: account.id,
      });

  const liveIntentAnalysis =
    platform === "meta" || currentSearchTermRows.length === 0
      ? null
      : buildGoogleIntentAnalysisFromRows({
        rows: currentSearchTermRows,
        currency: account.currency,
        profile: resolveIntentProfile(account.id),
      });

  const liveWastedSpendSummary =
    platform === "meta" || currentSearchTermRows.length === 0
      ? null
      : buildGoogleWastedSpendSummaryFromRows({
        rows: currentSearchTermRows,
        currency: account.currency,
        targetCostPerAcquisition: (options.targets ?? DEFAULT_TARGETS).costPerOrder,
        daysInRange: inclusiveDays(range),
      });

  const liveMatchTypeDrift =
    platform === "meta" || currentSearchTermRows.length === 0
      ? null
      : buildGoogleMatchTypeDriftSummaryFromRows({
        rows: currentSearchTermRows,
        targetCostPerAcquisition: (options.targets ?? DEFAULT_TARGETS).costPerOrder,
      });

  const liveGeo =
    platform === "meta" || (options.geoRows?.length ?? 0) === 0
      ? null
      : buildGeoAnalysisFromRows({
          rows: options.geoRows ?? [],
          comparisonRows: comparisonEnabled
            ? options.comparisonGeoRows
            : undefined,
          accountSlug: options.geo?.accountSlug ?? account.id,
          range,
          comparisonRange: comparisonEnabled ? comparisonRange : undefined,
          currency: account.currency,
          countryCode: options.geo?.countryCode,
        });

  const liveAudienceSegments =
    platform === "meta" || (options.audienceRows?.length ?? 0) === 0
      ? null
      : buildGoogleAudienceAnalysisFromRows({
          rows: options.audienceRows ?? [],
          range,
          currency: account.currency,
        });

  const pendingPanels = basePendingPanels.filter(
    (panel) =>
      !(panel.key === "campaign-types" && campaignTypes !== null) &&
      !(panel.key === "search-terms" && liveSearchTerms !== null) &&
      // Only the measured build clears this panel. The modelled split stays
      // withheld: against the first live backfill it was not close, and a
      // device bid adjustment taken from it would point the wrong way.
      !(panel.key === "device-analysis" && liveDevices !== null) &&
      !(panel.key === "geo-analysis" && liveGeo !== null) &&
      !(panel.key === "audience-segments" && liveAudienceSegments !== null) &&
      // Only a period-exact answer clears this one. A daily roll-up would sit
      // next to reconciled figures looking like one.
      !(panel.key === "impression-share" && liveImpressionShare !== null),
  );
  // Meta-only, mirroring the Google-only cuts above but gated the other way:
  // it disappears the moment the reader leaves the Meta filter, including the
  // combined view, matching how the Google-only cuts behave.
  const audience =
    withholdSynthetic || platform !== "meta" || metaRows.length === 0
      ? null
      : buildMetaAudienceAnalysis({
        range,
        currency: account.currency,
        metaSpend: metaRows.reduce((total, row) => total + row.spend, 0),
        metaImpressions: metaRows.reduce(
          (total, row) => total + row.impressions,
          0,
        ),
        metaClicks: metaRows.reduce((total, row) => total + row.clicks, 0),
        metaPurchases: metaRows.reduce(
          (total, row) => total + row.purchases,
          0,
        ),
        metaRegistrations: metaRows.reduce(
          (total, row) => total + row.registrations,
          0,
        ),
        metaPurchaseValue: metaRows.reduce(
          (total, row) => total + row.actualPurchaseRevenue,
          0,
        ),
      });
  const audienceSegments =
    liveAudienceSegments ??
    (withholdSynthetic || platform === "meta" || googleRows.length === 0
      ? null
      : buildGoogleAudienceAnalysis({
        range,
        currency: account.currency,
        googleSpend,
        googleImpressions: googleRows.reduce(
          (total, row) => total + row.impressions,
          0,
        ),
        googleClicks: googleRows.reduce((total, row) => total + row.clicks, 0),
        googlePurchases: googleRows.reduce(
          (total, row) => total + row.purchases,
          0,
        ),
        googleRegistrations: googleRows.reduce(
          (total, row) => total + row.registrations,
          0,
        ),
        googlePurchaseValue: googleRows.reduce(
          (total, row) => total + row.actualPurchaseRevenue,
          0,
        ),
      }));
  const searchTerms =
    liveSearchTerms ??
    (withholdSynthetic || platform === "meta" || googleRows.length === 0
      ? null
      : buildSearchTermAnalysis({
        range,
        currency: account.currency,
        accountSlug: account.id,
        // Search campaigns carry roughly two fifths of Google spend in the
        // campaign-type shape; the query report only covers those.
        searchSpend: googleSpend * 0.4,
        targets: options.targets ?? DEFAULT_TARGETS,
        comparisonWindow: options.comparisonWindow,
        comparisonRange: options.comparisonRange,
      }));

  const metaSpend = metaRows.reduce((total, row) => total + row.spend, 0);
  const metaImpressions = metaRows.reduce((total, row) => total + row.impressions, 0);
  const metaClicks = metaRows.reduce((total, row) => total + row.clicks, 0);
  const metaPurchases = metaRows.reduce((total, row) => total + row.purchases, 0);
  const googleClicks = googleRows.reduce((total, row) => total + row.clicks, 0);
  const googlePurchases = googleRows.reduce((total, row) => total + row.purchases, 0);

  const creativeFatigue =
    withholdSynthetic || platform !== "meta" || metaRows.length === 0
      ? null
      : buildMetaCreativeFatigueAnalysis({
        range,
        currency: account.currency,
        metaSpend,
        metaImpressions,
        metaClicks,
        metaPurchases,
      });

  const placementAnalysis =
    withholdSynthetic || platform !== "meta" || metaRows.length === 0
      ? null
      : buildMetaPlacementAnalysis({
        metaSpend,
        metaPurchases,
        currency: account.currency,
      });

  const intentAnalysis =
    liveIntentAnalysis ??
    (withholdSynthetic || platform === "meta" || googleRows.length === 0
      ? null
      : buildGoogleIntentAnalysis({
        googleSpend,
        googleClicks,
        googlePurchases,
        currency: account.currency,
      }));

  const wastedSpendSummary =
    liveWastedSpendSummary ??
    (withholdSynthetic || platform === "meta" || googleRows.length === 0
      ? null
      : buildGoogleWastedSpendSummary({
        googleSpend,
        currency: account.currency,
        daysInRange: inclusiveDays(range),
      }));

  const matchTypeDrift =
    liveMatchTypeDrift ??
    (withholdSynthetic || platform === "meta" || googleRows.length === 0
      ? null
      : buildGoogleMatchTypeDriftSummary({
        googleSpend,
      }));

  const totalAdSpend = currentRows.reduce((total, row) => total + row.spend, 0);
  const blendedMer = withholdSynthetic
    ? null
    : buildBlendedMerSummary({
      totalAdSpend,
      googlePurchases,
      metaPurchases,
      currency: account.currency,
    });

  const rfmAudienceBridge = withholdSynthetic
    ? null
    : buildRfmPaidAudienceBridge({
      currency: account.currency,
    });

  const budgetOpportunity = withholdSynthetic
    ? null
    : buildBudgetOpportunityAdvisor({
      googleRoas: 4.8,
      metaRoas: 2.8,
      metaFatigueCount: creativeFatigue?.criticalCount ?? 0,
      currency: account.currency,
    });

  const geo =
    liveGeo ??
    (withholdSynthetic
      ? null
      : buildGeoAnalysis({
          source: createFixtureGeoSource(options.geo?.scale ?? 1),
          accountSlug: options.geo?.accountSlug ?? account.id,
          range,
          comparisonRange,
          currency: account.currency,
          countryCode: options.geo?.countryCode,
          level: options.geo?.level,
          parentId: options.geo?.parentId ?? null,
        }));
  // Pacing reads the whole cycle, so it is handed every row the caller loaded
  // rather than `currentRows`, which the filter has already narrowed.
  const budgetPacing = buildBudgetPacing(
    rows,
    range,
    options.budgets ?? DEFAULT_BUDGETS,
    account.currency,
    platform,
    options.referenceDate ?? range.end,
    options.budgetPlan ?? {},
  );

  const advisory = buildRuleBasedAdvisory({
    cards,
    guardrail,
    pacing: budgetPacing,
    impressionShare,
    quality,
    currency: account.currency,
    platform,
  });

  const purchaseMovement =
    totals.purchases >= comparisonTotals.purchases ? "increased" : "decreased";
  const cppMovement =
    totals.costPerPurchase !== null &&
      comparisonTotals.costPerPurchase !== null &&
      totals.costPerPurchase <= comparisonTotals.costPerPurchase
      ? "improved"
      : "softened";

  return {
    mode,
    storage,
    account,
    selectedRange: range,
    comparisonEnabled,
    comparisonRange,
    comparisonBasis: {
      label: comparisonEnabled
        ? COMPARISON_WINDOW_LABELS[comparisonWindow]
        : "No comparison",
      activeDays: inclusiveDays(range),
      comparisonDays: inclusiveDays(comparisonRange),
      normalisedToActiveDuration:
        inclusiveDays(range) !== inclusiveDays(comparisonRange),
    },
    selectedPlatform: platform,
    generatedAt: new Date().toISOString(),
    lastSuccessfulSync,
    dataStatus: quality.status,
    dataHealth: {
      coveragePercent: quality.coveragePercent,
      mappingStatus: mode === "mock" ? "fixture-only" : "unverified",
      reconciliationStatus:
        mode === "mock" ? "not-applicable" : "unverified",
      currentDayIncluded: quality.currentDayIncluded,
      summaryBlocked: quality.summaryBlocked,
    },
    quality,
    guardrail,
    conversionCaveat,
    snapshotSummary,
    advisory,
    impressionShare,
    auctionDiagnostics,
    devices,
    comparisonDevices,
    campaignTypes,
    audience,
    audienceSegments,
    searchTerms,
    creativeFatigue,
    placementAnalysis,
    intentAnalysis,
    wastedSpendSummary,
    matchTypeDrift,
    blendedMer,
    rfmAudienceBridge,
    budgetOpportunity,
    pendingPanels,
    budgetPacing,
    geo,
    cards,
    totals,
    comparisonTotals,
    trend,
    platformBreakdown,
    worklog,
    summary: {
      status: "preview",
      whatHappened: !hasCurrentMetrics
        ? ["No stored metric is available for this dashboard yet."]
        : comparisonEnabled
          ? [
            `Platform-attributed purchases ${purchaseMovement} versus the selected comparison period.`,
            `Cost per purchase ${cppMovement} while store revenue remained the value source for Store ROAS.`,
          ]
          : [
            "Comparison is switched off, so this period is reported on its own.",
            "Turn comparison on to see how purchases and cost per purchase moved.",
          ],
      likelyDrivers: hasCurrentMetrics
        ? worklog.length
          ? [
            "Approved worklog activity overlaps the selected period; it is context, not proof of causality.",
          ]
          : ["No approved worklog entry overlaps this filter."]
        : ["Run a dummy refresh after Supabase storage is configured."],
      risks: [
        mode === "mock"
          ? "This gate uses synthetic fixture data and cannot support a live optimisation decision."
          : "Live connector data remains blocked until parity validation is approved.",
        conversionCaveat ??
        "Platform attribution may differ from GA4 or ecommerce reporting.",
        ...(guardrail.status === "breach" ? [guardrail.safeMessage] : []),
      ],
      recommendedNextActions: [
        guardrail.status === "breach" || guardrail.status === "near"
          ? `Close the gap on ${guardrail.checks
            .filter((check) => check.status !== "pass")
            .map((check) => check.shortLabel)
            .join(", ")} before scaling spend.`
          : "Hold the current targets while volume changes.",
        "Validate Google and Meta parity on the official API path before enabling live refresh.",
      ],
      confidence: "low",
      metricEvidenceIds: [
        `metric:purchases:${sourceQueryVersion}`,
        `metric:cost_per_purchase:${sourceQueryVersion}`,
        `metric:actual_revenue_roas:${sourceQueryVersion}`,
      ],
      worklogEvidenceIds: worklog.map((entry) => entry.id),
      dataGaps: [
        ...new Set([
          ...quality.issues.map((issue) => issue.safeMessage),
          hasCurrentMetrics
            ? "Live Meta Ads and Google Ads connectors are not active."
            : "Supabase does not contain a dummy metric snapshot for this filter.",
          "store revenue source and event mappings still need approval.",
        ]),
      ],
    },
  };
}

export function buildDashboardSnapshot(
  range: DateRange = { start: "2026-07-01", end: "2026-07-14" },
  platform: Platform = "all",
  account?: AccountOption,
  targets: PerformanceTargets = DEFAULT_TARGETS,
  budgets: MonthlyBudgets = DEFAULT_BUDGETS,
  geo?: DashboardSnapshotOptions["geo"],
  comparisonWindow?: ComparisonWindow,
  comparisonRange?: DateRange,
  comparisonEnabled?: boolean,
  budgetPlan?: DashboardSnapshotOptions["budgetPlan"],
  referenceDate?: string,
): DashboardSnapshot {
  return buildDashboardSnapshotFromRows(
    account ? getFixtureRowsForAccount(account) : fixtureRows,
    range,
    platform,
    {
      account: account
        ? {
          id: account.slug,
          name: account.name,
          currency: account.currency,
          timezone: account.timezone,
        }
        : undefined,
      mode: "mock",
      storage: "fixture",
      targets,
      budgets,
      budgetPlan,
      referenceDate,
      comparisonEnabled,
      comparisonWindow,
      comparisonRange,
      geo: {
        ...geo,
        accountSlug: account?.slug ?? geo?.accountSlug,
        scale: account?.fixtureScale ?? geo?.scale,
      },
    },
  );
}
