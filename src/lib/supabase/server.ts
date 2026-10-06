import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import {
  requireSupabaseConfiguration,
  requireSupabaseProjectUrl,
} from "@/lib/auth/auth-config";
import { MockAdsConnector } from "@/lib/connectors/mock";
import { SyncPipeline } from "@/lib/connectors/sync-pipeline";
import type { SyncPlatformOutcome } from "@/lib/connectors/sync-pipeline";
import {
  evaluateDataQuality,
  isDisclosureOnlyIssue,
} from "@/lib/dashboard/data-quality";
import { isAccountSlug, resolveAccount } from "@/lib/dashboard/accounts";
import {
  DEFAULT_BUDGETS,
  normaliseBudgets,
  parseBudgetsCookie,
  type BudgetPlanSource,
  type MonthlyBudgets,
} from "@/lib/dashboard/budget";
import type { CampaignAttribute } from "@/lib/dashboard/campaign-types";
import { getPreviousPeriod } from "@/lib/dashboard/kpi";
import { currentDateInTimeZone } from "@/lib/dashboard/timeframes";
import type { StoredDeviceRow } from "@/lib/dashboard/device";
import type { StoredImpressionSharePeriodRow } from "@/lib/dashboard/impression-share";
import type { StoredSearchTermRow } from "@/lib/dashboard/search-terms";
import type { Ga4StoredRow } from "@/lib/store/ga4-hydration";
import type { Ga4StoreBreakdown } from "@/lib/store/ga4-contract";
import type {
  WorklogDraft,
  WorklogRecord,
} from "@/lib/dashboard/worklog";
import type {
  Currency,
  DailyMetric,
  DashboardDataMode,
  DataQualityIssue,
  DataStatus,
  DateRange,
  MetricSourceConnector,
  Platform,
  SyncJob,
  SyncJobStatus,
  TimezoneAlignment,
  WorklogPlatform,
} from "@/lib/dashboard/types";

export async function createClient() {
  const { publishableKey, supabaseUrl } = requireSupabaseConfiguration();
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot always write cookies. The request proxy
          // refreshes the session before protected code verifies it again.
        }
      },
    },
  });
}
const SUPPORTED_CURRENCIES = new Set<Currency>(["USD", "IDR", "SGD", "MYR", "GBP", "EUR"]);

/**
 * Must stay in step with the `MetricSourceConnector` union. The two direct-API
 * connectors were missing here, so every live row written by
 * `GoogleAdsApiClient` or `MetaAdsApiClient` was accepted on write and then
 * rejected on read with "Stored metric uses an unsupported connector."
 */
const METRIC_SOURCE_CONNECTORS = new Set<MetricSourceConnector>([
  "mock",
  "meta-direct-api",
  "google-direct-api",
  "meta-official-mcp",
  "meta-community-mcp",
  "meta-pipeboard",
  "google-official-mcp",
  "google-experimental-mcp",
  "google-pipeboard",
]);

interface StoredMetricRow {
  metric_date: string;
  client_id: string;
  account_id: string;
  platform: "meta" | "google";
  currency: string;
  account_timezone: string;
  spend: number | string;
  impressions: number | string;
  clicks: number | string;
  landing_page_views: number | string | null;
  engaged_visits?: number | string | null;
  add_to_baskets?: number | string | null;
  registrations: number | string | null;
  purchases: number | string | null;
  platform_conversion_value: number | string | null;
  actual_purchase_revenue: number | string | null;
  order_conversion_value: number | string | null;
  registration_lead_value: number | string | null;
  search_impression_share: number | string | null;
  search_budget_lost_impression_share: number | string | null;
  search_rank_lost_impression_share: number | string | null;
  source_connector: string;
  source_query_version: string;
  synced_at: string;
  is_provisional: boolean;
}

interface StoredCampaignMetricRow extends StoredMetricRow {
  entity_key: string;
  entity_name_snapshot: string | null;
}

export interface StoredDeviceMetricRow {
  metric_date: string;
  device: string;
  spend: number | string | null;
  impressions: number | string | null;
  clicks: number | string | null;
  registrations: number | string | null;
  purchases: number | string | null;
  order_conversion_value: number | string | null;
}

interface StoredCampaignAttributeRow {
  campaign_key: string;
  campaign_name: string;
  channel_type: string;
  channel_sub_type: string | null;
  status: string;
}

/**
 * Breakdowns `ga4_daily_metrics` is allowed to hold, mirroring the column's
 * check constraint. Declared here rather than imported so the reader keeps its
 * own guard even if the contract module is refactored.
 */
const GA4_STORE_BREAKDOWNS: readonly Ga4StoreBreakdown[] = [
  "total",
  "channel",
  "device",
  "landing_page",
  "country",
  "city",
];

interface StoredGa4Row {
  metric_date: string;
  breakdown: string;
  breakdown_value: string;
  currency: string | null;
  sessions: number | string;
  active_users: number | string;
  bounce_rate: number | string;
  average_session_duration_seconds: number | string;
  add_to_carts: number | string;
  checkouts: number | string;
  ecommerce_purchases: number | string;
  gross_purchase_revenue: number | string;
  is_provisional: boolean;
}

interface StoredImpressionSharePeriodDbRow {
  range_start: string;
  range_end: string;
  scope: string;
  campaign_key: string;
  impressions: number | string;
  search_impression_share: number | string | null;
  search_budget_lost_impression_share: number | string | null;
  search_rank_lost_impression_share: number | string | null;
}

interface StoredSyncJobRow {
  id: string;
  status: "queued" | "running" | "validating" | "succeeded" | "partial" | "failed";
  requested_start: string;
  requested_end: string;
  requested_platforms: string[];
  safe_error_message: string | null;
  created_at: string;
  updated_at: string;
}

interface PersistFixtureSyncInput {
  clientId: string;
  requestedBy: string;
  range: DateRange;
  platforms: Exclude<Platform, "all">[];
}

function toNumber(value: number | string | null): number {
  if (value === null) return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error("Stored metric contains an invalid numeric value.");
  }
  return parsed;
}

function toMetricSourceConnector(value: string): MetricSourceConnector {
  if (!METRIC_SOURCE_CONNECTORS.has(value as MetricSourceConnector)) {
    throw new Error("Stored metric uses an unsupported connector.");
  }
  return value as MetricSourceConnector;
}

function toCurrency(value: string): Currency {
  if (!SUPPORTED_CURRENCIES.has(value as Currency)) {
    throw new Error("Stored metric uses an unsupported currency.");
  }
  return value as Currency;
}

/** Keeps a stored null as null; `toNumber` would turn "not measured" into 0. */
function toNullableNumber(value: number | string | null | undefined): number | null {
  return value === null || value === undefined ? null : toNumber(value);
}

/**
 * Impression share is optional on `DailyMetric`: a stored null stays absent so
 * the impression-weighted roll-up in `aggregateMetrics` skips the row instead
 * of averaging in a false 0%.
 */
function optionalShare(
  value: number | string | null | undefined,
): number | undefined {
  const parsed = toNullableNumber(value);
  return parsed === null ? undefined : parsed;
}

function mapStoredMetric(row: StoredMetricRow): DailyMetric {
  const searchImpressionShare = optionalShare(row.search_impression_share);
  const impressionShareLostToBudget = optionalShare(
    row.search_budget_lost_impression_share,
  );
  const impressionShareLostToRank = optionalShare(
    row.search_rank_lost_impression_share,
  );

  return {
    date: row.metric_date,
    clientId: row.client_id,
    accountId: row.account_id,
    platform: row.platform,
    currency: toCurrency(row.currency),
    accountTimezone: row.account_timezone,
    spend: toNumber(row.spend),
    impressions: toNumber(row.impressions),
    clicks: toNumber(row.clicks),
    // A stored null means the source never measured it, so it must survive the
    // read. Coercing it to 0 here would resurrect the false finding the
    // connector went out of its way to avoid writing.
    landingPageViews: toNullableNumber(row.landing_page_views),
    engagedVisits: toNullableNumber(row.engaged_visits),
    addToBaskets: toNullableNumber(row.add_to_baskets),
    registrations: toNumber(row.registrations),
    purchases: toNumber(row.purchases),
    platformConversionValue: toNumber(row.platform_conversion_value),
    actualPurchaseRevenue: toNumber(row.actual_purchase_revenue),
    orderConversionValue: toNullableNumber(row.order_conversion_value),
    registrationLeadValue: toNullableNumber(row.registration_lead_value),
    ...(searchImpressionShare === undefined ? {} : { searchImpressionShare }),
    ...(impressionShareLostToBudget === undefined
      ? {}
      : { impressionShareLostToBudget }),
    ...(impressionShareLostToRank === undefined
      ? {}
      : { impressionShareLostToRank }),
    sourceConnector: toMetricSourceConnector(row.source_connector),
    sourceQueryVersion: row.source_query_version,
    syncedAt: row.synced_at,
    isProvisional: row.is_provisional,
  };
}

function mapStoredJobStatus(
  status: StoredSyncJobRow["status"],
): SyncJobStatus {
  return status === "running" ? "syncing" : status;
}

/**
 * Operator-facing wording for a job row.
 *
 * A `sync_jobs` row carries no flag for how it was produced, and the fixture
 * path and the live path share this mapper. Claiming "no advertising API was
 * called" on a row that did call Google is a false statement about provenance,
 * so the wording is kept neutral and the fixture-specific reassurance lives on
 * the `sync_job_events` written by `persistFixtureSync`, where it is true.
 */
function safeJobMessage(row: StoredSyncJobRow): string {
  if (row.status === "queued") return "Refresh queued in Supabase.";
  if (row.status === "running") return "Refresh in progress.";
  if (row.status === "validating") {
    return "Validating stored metric contracts.";
  }
  if (row.status === "succeeded") {
    return "Refresh complete.";
  }
  if (row.status === "partial") {
    return "Refresh completed with incomplete coverage.";
  }
  return row.safe_error_message ?? "Refresh failed safely.";
}

function mapStoredSyncJob(row: StoredSyncJobRow): SyncJob {
  const platforms = row.requested_platforms.filter(
    (platform): platform is "meta" | "google" =>
      platform === "meta" || platform === "google",
  );

  return {
    id: row.id,
    status: mapStoredJobStatus(row.status),
    requestedRange: {
      start: row.requested_start,
      end: row.requested_end,
    },
    platforms,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    safeMessage: safeJobMessage(row),
  };
}

export function createServiceClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!serviceRoleKey) {
    throw new Error("Supabase worker secret is not configured.");
  }

  // Server-only path: the worker secret is the credential, so this must not
  // depend on the browser auth mode. See requireSupabaseProjectUrl.
  const supabaseUrl = requireSupabaseProjectUrl();

  return createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

/**
 * Maps a client slug onto its `clients.id`.
 *
 * Server-side only: it authenticates with the worker secret because a
 * scheduled run has no browser session to carry RLS. Slug in, UUID out — no
 * caller-supplied SQL and no other column is read.
 */
export async function resolveClientIdBySlug(slug: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("clients")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw new Error("The client registry is unavailable.");

  const id = (data as { id?: unknown } | null)?.id;
  return typeof id === "string" ? id : null;
}

export async function readStoredMetrics(
  clientId: string,
  range: DateRange,
  platform: Platform,
  mode: DashboardDataMode,
  requestedComparisonRange?: DateRange,
  /**
   * A third window to fetch alongside the selected and comparison periods.
   * Budget pacing measures the 30-day reporting cycle rather than the filter,
   * so under a "last 7 days" view the cycle's earlier days are not in either
   * of the other two reads. Without them the card silently reports a fraction
   * of the cycle's spend against the full agreed budget, which reads as
   * healthy underspending when the account is in fact on plan.
   */
  extraRange?: DateRange,
): Promise<DailyMetric[]> {
  const comparisonRange = requestedComparisonRange ?? getPreviousPeriod(range);
  const supabase = await createClient();
  let query = supabase
    .from("daily_metrics")
    .select(
      "metric_date, client_id, account_id, platform, currency, account_timezone, spend, impressions, clicks, landing_page_views, engaged_visits, add_to_baskets, registrations, purchases, platform_conversion_value, actual_purchase_revenue, order_conversion_value, registration_lead_value, search_impression_share, search_budget_lost_impression_share, search_rank_lost_impression_share, source_connector, source_query_version, synced_at, is_provisional",
    )
    .eq("client_id", clientId)
    .eq("entity_level", "account")
    .or(
      [
        `and(metric_date.gte.${range.start},metric_date.lte.${range.end})`,
        `and(metric_date.gte.${comparisonRange.start},metric_date.lte.${comparisonRange.end})`,
        ...(extraRange
          ? [
              `and(metric_date.gte.${extraRange.start},metric_date.lte.${extraRange.end})`,
            ]
          : []),
      ].join(","),
    )
    .in("platform", ["meta", "google"])
    .order("metric_date", { ascending: true });

  query =
    mode === "mock"
      ? query.eq("source_connector", "mock")
      : query.neq("source_connector", "mock");

  if (platform !== "all") {
    query = query.eq("platform", platform);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error("Stored dashboard metrics are unavailable.");
  }

  return ((data ?? []) as StoredMetricRow[]).map(mapStoredMetric);
}

/**
 * Campaign-level rows for one client and period.
 *
 * Deliberately separate from `readStoredMetrics`, which is pinned to
 * `entity_level = 'account'`: KPI cards must never double-count by summing
 * campaign rows on top of the account row. This reads the other level, and its
 * callers use it only for the campaign breakdown.
 *
 * `entity_key` and `entity_name_snapshot` are selected here and nowhere else.
 * Without them the campaign rows that ingestion has been writing since the
 * first live pull could be stored but never read: rows present and unused.
 */
export async function readStoredCampaignMetrics(
  clientId: string,
  range: DateRange,
  platform: Platform,
  mode: DashboardDataMode,
): Promise<DailyMetric[]> {
  const supabase = await createClient();
  const pageSize = 1_000;
  const stored: StoredCampaignMetricRow[] = [];
  for (let offset = 0; ; offset += pageSize) {
    let query = supabase
      .from("daily_metrics")
      .select(
        "metric_date, client_id, account_id, platform, currency, account_timezone, spend, impressions, clicks, landing_page_views, engaged_visits, add_to_baskets, registrations, purchases, platform_conversion_value, actual_purchase_revenue, order_conversion_value, registration_lead_value, search_impression_share, search_budget_lost_impression_share, search_rank_lost_impression_share, source_connector, source_query_version, synced_at, is_provisional, entity_key, entity_name_snapshot",
      )
      .eq("client_id", clientId)
      .eq("entity_level", "campaign")
      .gte("metric_date", range.start)
      .lte("metric_date", range.end)
      .in("platform", ["meta", "google"])
      .order("metric_date", { ascending: true })
      .order("platform", { ascending: true })
      .order("entity_key", { ascending: true })
      .range(offset, offset + pageSize - 1);

    query =
      mode === "mock"
        ? query.eq("source_connector", "mock")
        : query.neq("source_connector", "mock");

    if (platform !== "all") {
      query = query.eq("platform", platform);
    }

    const { data, error } = await query;
    if (error) throw new Error("Stored campaign metrics are unavailable.");
    const page = (data ?? []) as StoredCampaignMetricRow[];
    stored.push(...page);
    if (page.length < pageSize) break;
  }

  return stored.map((row) => ({
    ...mapStoredMetric(row),
    entityLevel: "campaign" as const,
    entityKey: row.entity_key,
    entityName: row.entity_name_snapshot ?? undefined,
  }));
}

/**
 * Device-segmented daily rows for one client and window, from
 * `ad_device_daily`.
 *
 * Google-only by construction: `segments.device` is a Google cut, and Meta
 * reports placements and platforms instead. Passing a Meta-filtered platform
 * therefore returns nothing rather than a cut that does not exist.
 *
 * `account_id` and `provenance` are not selected, for the same reason as every
 * other client-facing reader: a platform account id must not reach the browser.
 */
export function mapStoredDeviceRow(row: StoredDeviceMetricRow): StoredDeviceRow {
  return {
    date: row.metric_date,
    device: row.device,
    spend: toNumber(row.spend),
    impressions: toNumber(row.impressions),
    clicks: toNumber(row.clicks),
    registrations: toNullableNumber(row.registrations),
    purchases: toNullableNumber(row.purchases),
    purchaseValue: toNullableNumber(row.order_conversion_value),
  };
}

export async function readStoredDeviceMetrics(
  clientId: string,
  range: DateRange,
  platform: Platform,
  mode: DashboardDataMode,
): Promise<StoredDeviceRow[]> {
  if (platform === "meta") return [];

  const supabase = await createClient();
  let query = supabase
    .from("ad_device_daily")
    .select(
      "metric_date, device, spend, impressions, clicks, registrations, purchases, order_conversion_value",
    )
    .eq("client_id", clientId)
    .eq("platform", "google")
    .gte("metric_date", range.start)
    .lte("metric_date", range.end)
    .order("metric_date", { ascending: true });

  query =
    mode === "mock"
      ? query.eq("source_connector", "mock")
      : query.neq("source_connector", "mock");

  const { data, error } = await query;
  if (error) throw new Error("Stored device metrics are unavailable.");

  return ((data ?? []) as StoredDeviceMetricRow[]).map(mapStoredDeviceRow);
}

/**
 * Channel type and status per campaign, from `ad_campaigns`.
 *
 * This is what decides which campaign-type row a campaign belongs to.
 * `daily_metrics` carries the money but not what the campaign *is*, so without
 * this the breakdown cannot be built from real data at all.
 */
export async function readStoredCampaignAttributes(
  clientId: string,
  platform: Platform,
): Promise<CampaignAttribute[]> {
  const supabase = await createClient();
  let query = supabase
    .from("ad_campaigns")
    .select("campaign_key, campaign_name, channel_type, channel_sub_type, status")
    .eq("client_id", clientId);

  if (platform !== "all") {
    query = query.eq("platform", platform);
  }

  const { data, error } = await query;
  if (error) throw new Error("Stored campaign attributes are unavailable.");

  return ((data ?? []) as StoredCampaignAttributeRow[]).map((row) => ({
    campaignKey: row.campaign_key,
    campaignName: row.campaign_name,
    channelType: row.channel_type,
    channelSubType: row.channel_sub_type,
    status: row.status,
  }));
}

interface StoredSearchTermDbRow {
  metric_date: string;
  campaign_key: string;
  ad_group_key: string;
  search_term: string;
  search_term_match_type: string;
  keyword_text: string;
  keyword_match_type: string;
  currency: string;
  spend: number | string;
  impressions: number | string;
  clicks: number | string;
  registrations: number | string | null;
  purchases: number | string | null;
  purchase_value: number | string | null;
  source_connector: string;
  is_provisional: boolean;
}

/**
 * Search query rows for one client, for the selected period and — when given —
 * the comparison window, in a single request.
 *
 * Runs under the caller's session, so RLS decides what they may see, and the
 * brand is also pinned explicitly. `account_id` and `provenance` are not
 * selected: neither is needed to build the section, and provenance carries the
 * sync job id. The mode filter mirrors the metric readers, so a mock-mode
 * dashboard never shows real queries next to generated spend.
 *
 * Rows are returned with their date; the caller splits them into the two
 * windows. Conversion nulls are preserved, because the builder must be able to
 * tell "not measured" from "nothing converted".
 */
export async function readStoredSearchTerms(
  clientId: string,
  range: DateRange,
  mode: DashboardDataMode,
  comparisonRange?: DateRange,
): Promise<StoredSearchTermRow[]> {
  const supabase = await createClient();
  const windowFilter = comparisonRange
    ? `and(metric_date.gte.${range.start},metric_date.lte.${range.end}),and(metric_date.gte.${comparisonRange.start},metric_date.lte.${comparisonRange.end})`
    : `and(metric_date.gte.${range.start},metric_date.lte.${range.end})`;

  let query = supabase
    .from("ad_search_term_daily")
    .select(
      "metric_date, campaign_key, ad_group_key, search_term, search_term_match_type, keyword_text, keyword_match_type, currency, spend, impressions, clicks, registrations, purchases, purchase_value, source_connector, is_provisional",
    )
    .eq("client_id", clientId)
    .eq("platform", "google")
    .or(windowFilter)
    .order("metric_date", { ascending: true });

  query =
    mode === "mock"
      ? query.eq("source_connector", "mock")
      : query.neq("source_connector", "mock");

  const { data, error } = await query;
  if (error) throw new Error("Stored search terms are unavailable.");

  return ((data ?? []) as StoredSearchTermDbRow[]).map((row) => ({
    date: row.metric_date,
    campaignKey: row.campaign_key,
    adGroupKey: row.ad_group_key,
    searchTerm: row.search_term,
    searchTermMatchType: row.search_term_match_type,
    keywordText: row.keyword_text,
    keywordMatchType: row.keyword_match_type,
    currency: toCurrency(row.currency),
    spend: toNumber(row.spend),
    impressions: toNumber(row.impressions),
    clicks: toNumber(row.clicks),
    registrations: toNullableNumber(row.registrations),
    purchases: toNullableNumber(row.purchases),
    purchaseValue: toNullableNumber(row.purchase_value),
    isProvisional: row.is_provisional,
  }));
}

/**
 * Refuses a breakdown that mixes currencies.
 *
 * Every row in these tables carries the account currency it was pulled under.
 * One brand reads in one currency, so more than one here means rows from two
 * accounts have reached the same panel — and a panel that sums pounds into
 * euros is wrong in a way no total on screen reveals.
 */
export function assertSingleCurrency(
  currencies: readonly string[],
  label: string,
): void {
  const distinct = [...new Set(currencies)];
  if (distinct.length > 1) {
    throw new Error(
      `Stored ${label} carry ${distinct.length} different currencies, so they cannot be read as one breakdown.`,
    );
  }
}

/** One ad group or Performance Max asset group on one day. */
export interface StoredEntityRow {
  date: string;
  entityLevel: "ad_group" | "asset_group";
  campaignKey: string;
  entityKey: string;
  entityName: string | null;
  status: string | null;
  currency: Currency;
  spend: number;
  impressions: number;
  clicks: number;
  /** Null is "not measured", never zero. */
  registrations: number | null;
  purchases: number | null;
  orderConversionValue: number | null;
  registrationLeadValue: number | null;
  /**
   * False means the conversions are Google's own mixed total, which an asset
   * group cannot report any other way. A reader that compares a false row with
   * a true one is comparing two different measurements.
   */
  conversionActionFiltered: boolean;
  isProvisional: boolean;
}

/** One country, or one region inside it, on one day for one campaign. */
export interface StoredGeoRow {
  date: string;
  campaignKey: string;
  countryCriterionId: string;
  /** Empty string when Google placed the traffic to a country but no region. */
  regionCriterionId: string;
  countryCode: string | null;
  regionName: string | null;
  currency: Currency;
  spend: number;
  impressions: number;
  clicks: number;
  registrations: number | null;
  purchases: number | null;
  orderConversionValue: number | null;
  conversionActionFiltered: boolean;
  isProvisional: boolean;
}

/** One audience segment as attached to one ad group, on one day. */
export interface StoredAudienceRow {
  date: string;
  campaignKey: string;
  adGroupKey: string;
  criterionId: string;
  criterionType: string | null;
  displayName: string | null;
  currency: Currency;
  spend: number;
  impressions: number;
  clicks: number;
  registrations: number | null;
  purchases: number | null;
  orderConversionValue: number | null;
  conversionActionFiltered: boolean;
  isProvisional: boolean;
}

interface StoredEntityMetricRow {
  metric_date: string;
  entity_level: "ad_group" | "asset_group";
  campaign_key: string;
  entity_key: string;
  entity_name_snapshot: string | null;
  status: string | null;
  currency: Currency;
  spend: number | string;
  impressions: number | string;
  clicks: number | string;
  registrations: number | string | null;
  purchases: number | string | null;
  order_conversion_value: number | string | null;
  registration_lead_value: number | string | null;
  conversion_action_filtered: boolean;
  is_provisional: boolean;
}

interface StoredGeoMetricRow {
  metric_date: string;
  campaign_key: string;
  country_criterion_id: string;
  region_criterion_id: string;
  country_code: string | null;
  region_name: string | null;
  currency: Currency;
  spend: number | string;
  impressions: number | string;
  clicks: number | string;
  registrations: number | string | null;
  purchases: number | string | null;
  order_conversion_value: number | string | null;
  conversion_action_filtered: boolean;
  is_provisional: boolean;
}

interface StoredAudienceMetricRow {
  metric_date: string;
  campaign_key: string;
  ad_group_key: string;
  criterion_id: string;
  criterion_type: string | null;
  display_name: string | null;
  currency: Currency;
  spend: number | string;
  impressions: number | string;
  clicks: number | string;
  registrations: number | string | null;
  purchases: number | string | null;
  order_conversion_value: number | string | null;
  conversion_action_filtered: boolean;
  is_provisional: boolean;
}

export function mapStoredEntityRow(row: StoredEntityMetricRow): StoredEntityRow {
  return {
    date: row.metric_date,
    entityLevel: row.entity_level,
    campaignKey: row.campaign_key,
    entityKey: row.entity_key,
    entityName: row.entity_name_snapshot,
    status: row.status,
    currency: row.currency,
    spend: toNumber(row.spend),
    impressions: toNumber(row.impressions),
    clicks: toNumber(row.clicks),
    registrations: toNullableNumber(row.registrations),
    purchases: toNullableNumber(row.purchases),
    orderConversionValue: toNullableNumber(row.order_conversion_value),
    registrationLeadValue: toNullableNumber(row.registration_lead_value),
    conversionActionFiltered: row.conversion_action_filtered,
    isProvisional: row.is_provisional,
  };
}

export function mapStoredGeoRow(row: StoredGeoMetricRow): StoredGeoRow {
  return {
    date: row.metric_date,
    campaignKey: row.campaign_key,
    countryCriterionId: row.country_criterion_id,
    regionCriterionId: row.region_criterion_id,
    countryCode: row.country_code,
    regionName: row.region_name,
    currency: row.currency,
    spend: toNumber(row.spend),
    impressions: toNumber(row.impressions),
    clicks: toNumber(row.clicks),
    registrations: toNullableNumber(row.registrations),
    purchases: toNullableNumber(row.purchases),
    orderConversionValue: toNullableNumber(row.order_conversion_value),
    conversionActionFiltered: row.conversion_action_filtered,
    isProvisional: row.is_provisional,
  };
}

export function mapStoredAudienceRow(
  row: StoredAudienceMetricRow,
): StoredAudienceRow {
  return {
    date: row.metric_date,
    campaignKey: row.campaign_key,
    adGroupKey: row.ad_group_key,
    criterionId: row.criterion_id,
    criterionType: row.criterion_type,
    displayName: row.display_name,
    currency: row.currency,
    spend: toNumber(row.spend),
    impressions: toNumber(row.impressions),
    clicks: toNumber(row.clicks),
    registrations: toNullableNumber(row.registrations),
    purchases: toNullableNumber(row.purchases),
    orderConversionValue: toNullableNumber(row.order_conversion_value),
    conversionActionFiltered: row.conversion_action_filtered,
    isProvisional: row.is_provisional,
  };
}

/**
 * Ad group and asset group rows for one client and window, from
 * `ad_entity_daily`.
 *
 * Runs under the caller's session, so RLS decides what they may see. Google
 * only by construction: neither level exists on Meta, so a Meta-filtered view
 * returns nothing rather than a cut that platform never reported.
 *
 * `account_id` and `provenance` are never selected, for the same reason as
 * every other client-facing reader: a platform account id must not reach the
 * browser.
 */
export async function readStoredEntityDaily(
  clientId: string,
  range: DateRange,
  platform: Platform,
  mode: DashboardDataMode,
): Promise<StoredEntityRow[]> {
  if (platform === "meta") return [];

  const supabase = await createClient();
  const pageSize = 1_000;
  const stored: StoredEntityMetricRow[] = [];
  for (let offset = 0; ; offset += pageSize) {
    let query = supabase
      .from("ad_entity_daily")
      .select(
        "metric_date, entity_level, campaign_key, entity_key, entity_name_snapshot, status, currency, spend, impressions, clicks, registrations, purchases, order_conversion_value, registration_lead_value, conversion_action_filtered, is_provisional",
      )
      .eq("client_id", clientId)
      .eq("platform", "google")
      .gte("metric_date", range.start)
      .lte("metric_date", range.end)
      .order("metric_date", { ascending: true })
      .order("campaign_key", { ascending: true })
      .order("entity_key", { ascending: true })
      .range(offset, offset + pageSize - 1);

    query =
      mode === "mock"
        ? query.eq("source_connector", "mock")
        : query.neq("source_connector", "mock");

    const { data, error } = await query;
    if (error) throw new Error("Stored ad group metrics are unavailable.");
    const page = (data ?? []) as StoredEntityMetricRow[];
    stored.push(...page);
    if (page.length < pageSize) break;
  }

  const rows = stored.map(mapStoredEntityRow);
  assertSingleCurrency(rows.map((row) => row.currency), "ad group rows");
  return rows;
}

/**
 * Country and region rows for one client and window, from `ad_geo_daily`.
 * Google only, and city grain is deliberately absent from the table itself.
 */
export async function readStoredGeoDaily(
  clientId: string,
  range: DateRange,
  mode: DashboardDataMode,
): Promise<StoredGeoRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("ad_geo_daily")
    .select(
      "metric_date, campaign_key, country_criterion_id, region_criterion_id, country_code, region_name, currency, spend, impressions, clicks, registrations, purchases, order_conversion_value, conversion_action_filtered, is_provisional",
    )
    .eq("client_id", clientId)
    .eq("platform", "google")
    .gte("metric_date", range.start)
    .lte("metric_date", range.end)
    .order("metric_date", { ascending: true });

  query =
    mode === "mock"
      ? query.eq("source_connector", "mock")
      : query.neq("source_connector", "mock");

  const { data, error } = await query;
  if (error) throw new Error("Stored location metrics are unavailable.");

  const rows = ((data ?? []) as StoredGeoMetricRow[]).map(mapStoredGeoRow);
  assertSingleCurrency(rows.map((row) => row.currency), "location rows");
  return rows;
}

/**
 * Audience segment rows for one client and window, from `ad_audience_daily`.
 *
 * The grain is the segment as attached to one ad group, exactly as stored: the
 * same list in three ad groups stays three rows here, because summing them
 * would count a user reached twice.
 */
export async function readStoredAudienceDaily(
  clientId: string,
  range: DateRange,
  mode: DashboardDataMode,
): Promise<StoredAudienceRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("ad_audience_daily")
    .select(
      "metric_date, campaign_key, ad_group_key, criterion_id, criterion_type, display_name, currency, spend, impressions, clicks, registrations, purchases, order_conversion_value, conversion_action_filtered, is_provisional",
    )
    .eq("client_id", clientId)
    .eq("platform", "google")
    .gte("metric_date", range.start)
    .lte("metric_date", range.end)
    .order("metric_date", { ascending: true });

  query =
    mode === "mock"
      ? query.eq("source_connector", "mock")
      : query.neq("source_connector", "mock");

  const { data, error } = await query;
  if (error) throw new Error("Stored audience metrics are unavailable.");

  const rows = ((data ?? []) as StoredAudienceMetricRow[]).map(
    mapStoredAudienceRow,
  );
  assertSingleCurrency(rows.map((row) => row.currency), "audience rows");
  return rows;
}

/** One brand's agreed plan for one 30-day reporting cycle. */
export interface StoredClientBudget {
  /** First day of the cycle the figures were agreed for. */
  cycleStart: string;
  budgets: MonthlyBudgets;
  currency: Currency;
  /**
   * True when no row existed for the requested cycle and the most recent
   * earlier agreement was used instead. The card says so rather than
   * presenting a carried-over figure as this cycle's decision.
   */
  isCarriedForward: boolean;
}

interface StoredClientBudgetRow {
  cycle_start: string;
  meta_monthly_budget: number | string | null;
  google_monthly_budget: number | string | null;
  currency: string;
}

/**
 * Reads the agreed plan for one brand and one reporting cycle.
 *
 * Runs under the caller's session, so RLS decides which brands they may read.
 * `client_id` is the only scope: a budget is never resolved from a cookie or
 * from the pilot default, because that is precisely how one brand's plan came
 * to pace another brand's spend.
 *
 * Falls back to the most recent earlier cycle when the requested one has no
 * row, and says so through `isCarriedForward`. The alternative — returning the
 * 1,500 built-in default — would invent a budget the team never agreed.
 *
 * Returns null when this brand has no agreement at all.
 */
export async function readClientBudget(
  clientId: string,
  cycleStart: string,
  /** The brand's own currency. A row in any other currency is refused. */
  expectedCurrency: Currency,
): Promise<StoredClientBudget | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("client_budgets")
    .select("cycle_start, meta_monthly_budget, google_monthly_budget, currency")
    .eq("client_id", clientId)
    .lte("cycle_start", cycleStart)
    .order("cycle_start", { ascending: false })
    .limit(1);

  if (error) throw new Error("The agreed budget is unavailable.");

  const row = ((data ?? []) as StoredClientBudgetRow[])[0];
  if (!row) return null;

  // Never converted, and never relabelled. A pound figure printed with a euro
  // symbol reads as a plan the team never agreed to.
  if (row.currency !== expectedCurrency) {
    throw new Error(
      `The stored budget is in ${row.currency} but this account reports in ${expectedCurrency}.`,
    );
  }

  return {
    cycleStart: row.cycle_start,
    budgets: normaliseBudgets({
      meta: toNumber(row.meta_monthly_budget),
      google: toNumber(row.google_monthly_budget),
    }),
    currency: expectedCurrency,
    isCarriedForward: row.cycle_start !== cycleStart,
  };
}

/**
 * Writes one brand's agreed plan for one cycle, replacing any earlier figure
 * for that same cycle and leaving every other cycle and every other brand
 * untouched.
 *
 * Runs under the caller's session on purpose: the insert and update policies
 * restrict this to an admin or internal editor of that brand, so a viewer who
 * calls the route is refused by the database rather than by the route alone.
 */
export async function upsertClientBudget(
  clientId: string,
  cycleStart: string,
  budgets: MonthlyBudgets,
  currency: Currency,
  updatedBy: string,
): Promise<StoredClientBudget> {
  const supabase = await createClient();
  const normalised = normaliseBudgets(budgets);
  const { data, error } = await supabase
    .from("client_budgets")
    .upsert(
      {
        client_id: clientId,
        cycle_start: cycleStart,
        meta_monthly_budget: normalised.meta,
        google_monthly_budget: normalised.google,
        currency,
        updated_by: updatedBy,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "client_id,cycle_start" },
    )
    .select("cycle_start, meta_monthly_budget, google_monthly_budget, currency")
    .single();

  if (error || !data) throw new Error("The agreed budget could not be saved.");

  const row = data as StoredClientBudgetRow;
  return {
    cycleStart: row.cycle_start,
    budgets: normaliseBudgets({
      meta: toNumber(row.meta_monthly_budget),
      google: toNumber(row.google_monthly_budget),
    }),
    currency,
    isCarriedForward: false,
  };
}

export interface ResolvedBudgets {
  budgets: MonthlyBudgets;
  source: BudgetPlanSource;
  /** The cycle the figures were agreed against, when they were agreed at all. */
  cycleStart: string | null;
}

/**
 * Resolves which monthly plan applies to one brand for one reporting cycle.
 *
 * Order: the stored agreement, then this browser's per-brand cookie, then the
 * built-in placeholder. Each step reports what it was, because "no budget has
 * been agreed" and "the budget is 1,500" are different answers and the card
 * must not print the second when the truth is the first.
 *
 * `cookieValue` must come from the per-brand cookie for THIS brand. Passing
 * the legacy global cookie would reintroduce the leak it replaced.
 */
export async function resolveBudgetsForClient(input: {
  clientId: string;
  cycleStart: string;
  currency: Currency;
  cookieValue?: string | null;
  /** False in preview and demo paths, where no stored agreement exists. */
  useStore: boolean;
}): Promise<ResolvedBudgets> {
  if (input.useStore) {
    const stored = await readClientBudget(
      input.clientId,
      input.cycleStart,
      input.currency,
    );

    if (stored) {
      return {
        budgets: stored.budgets,
        source: stored.isCarriedForward ? "carried-forward" : "agreed",
        cycleStart: stored.cycleStart,
      };
    }
  }

  if (input.cookieValue) {
    return {
      budgets: parseBudgetsCookie(input.cookieValue),
      source: "local",
      cycleStart: null,
    };
  }

  return { budgets: DEFAULT_BUDGETS, source: "unset", cycleStart: null };
}

/**
 * Reads stored GA4 rows for one client and period.
 *
 * Runs under the caller's session, so RLS decides what they may see; the
 * `property_id` column is deliberately not selected, because a property id is
 * an account identifier and the client has no use for it.
 */
export async function readGa4DailyMetrics(
  clientId: string,
  range: DateRange,
): Promise<Ga4StoredRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ga4_daily_metrics")
    .select(
      "metric_date, breakdown, breakdown_value, currency, sessions, active_users, bounce_rate, average_session_duration_seconds, add_to_carts, checkouts, ecommerce_purchases, gross_purchase_revenue, is_provisional",
    )
    .eq("client_id", clientId)
    .gte("metric_date", range.start)
    .lte("metric_date", range.end)
    .order("metric_date", { ascending: true });

  if (error) throw new Error("Stored GA4 metrics are unavailable.");

  // `breakdown` is narrowed here rather than asserted. The column is
  // constrained in the database, but a reader that trusts a text column to be a
  // union is one migration away from handing the store bridge a value it will
  // silently drop, so an unrecognised breakdown is discarded at the boundary
  // and never reaches the snapshot.
  return ((data ?? []) as StoredGa4Row[])
    .filter((row): row is StoredGa4Row & { breakdown: Ga4StoreBreakdown } =>
      GA4_STORE_BREAKDOWNS.includes(row.breakdown as Ga4StoreBreakdown),
    )
    .map((row) => ({
    date: row.metric_date,
    breakdown: row.breakdown,
    breakdownValue: row.breakdown_value,
    // Carried so the bridge can check GA4's currency against the brand's
    // instead of assuming they agree. Absent reads as unverified, not matched.
    ...(row.currency ? { currency: row.currency } : {}),
    sessions: toNumber(row.sessions),
    activeUsers: toNumber(row.active_users),
    bounceRate: toNumber(row.bounce_rate),
    averageSessionDurationSeconds: toNumber(row.average_session_duration_seconds),
    addToCarts: toNumber(row.add_to_carts),
    checkouts: toNumber(row.checkouts),
    ecommercePurchases: toNumber(row.ecommerce_purchases),
    grossPurchaseRevenue: toNumber(row.gross_purchase_revenue),
    isProvisional: row.is_provisional,
  }));
}

/**
 * Period-grain Google impression share for one client and window.
 *
 * Returns only rows Google answered for a window that overlaps the request;
 * the caller matches the exact range before treating a row as exact. Nothing
 * here averages or interpolates — a window Google was never asked about has no
 * row, and the caller falls back to derived daily values and says so.
 *
 * `account_id` and `provenance` are not selected, for the same reason as every
 * other client-facing reader: a platform account id must not reach the browser.
 */
export async function readPeriodImpressionShare(
  clientId: string,
  range: DateRange,
  mode: DashboardDataMode,
): Promise<StoredImpressionSharePeriodRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("ad_impression_share_period")
    .select(
      "range_start, range_end, scope, campaign_key, impressions, search_impression_share, search_budget_lost_impression_share, search_rank_lost_impression_share",
    )
    .eq("client_id", clientId)
    .eq("platform", "google")
    .lte("range_start", range.end)
    .gte("range_end", range.start)
    .order("range_start", { ascending: true });

  query =
    mode === "mock"
      ? query.eq("source_connector", "mock")
      : query.neq("source_connector", "mock");

  const { data, error } = await query;
  if (error) throw new Error("Stored impression share is unavailable.");

  return ((data ?? []) as StoredImpressionSharePeriodDbRow[])
    .filter((row) => row.scope === "account" || row.scope === "campaign")
    .map((row) => ({
      rangeStart: row.range_start,
      rangeEnd: row.range_end,
      scope: row.scope as StoredImpressionSharePeriodRow["scope"],
      campaignKey: row.campaign_key,
      impressions: toNumber(row.impressions),
      searchImpressionShare: toNullableNumber(row.search_impression_share),
      searchBudgetLostImpressionShare: toNullableNumber(
        row.search_budget_lost_impression_share,
      ),
      searchRankLostImpressionShare: toNullableNumber(
        row.search_rank_lost_impression_share,
      ),
    }));
}

export async function readStoredSyncJob(
  clientId: string,
  jobId: string,
): Promise<SyncJob | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sync_jobs")
    .select(
      "id, status, requested_start, requested_end, requested_platforms, safe_error_message, created_at, updated_at",
    )
    .eq("id", jobId)
    .eq("client_id", clientId)
    .maybeSingle();

  if (error) {
    throw new Error("Stored sync job is unavailable.");
  }

  return data ? mapStoredSyncJob(data as StoredSyncJobRow) : null;
}

interface StoredWorklogRow {
  id: string;
  occurred_at: string;
  platform: WorklogPlatform | null;
  scope_level: string;
  scope_entity_key: string | null;
  action_type: string;
  action_summary: string;
  reason_or_hypothesis: string | null;
  review_status: "draft" | "needs_review" | "approved" | "rejected";
  created_at: string;
}

function mapStoredWorklog(
  row: StoredWorklogRow,
  accountSlug: string,
): WorklogRecord {
  return {
    id: row.id,
    accountSlug,
    occurredOn: row.occurred_at.slice(0, 10),
    platform: row.platform ?? "all",
    scope: (row.scope_level as WorklogRecord["scope"]) ?? "account",
    entityName: row.scope_entity_key ?? "",
    actionType: row.action_type as WorklogRecord["actionType"],
    actionSummary: row.action_summary,
    reasonOrHypothesis: row.reason_or_hypothesis ?? "",
    // The database uses an underscore in its enum; the app uses a hyphen.
    status: row.review_status === "needs_review" ? "needs-review" : "approved",
    createdBy: "",
    createdAt: row.created_at,
  };
}

/** Reads worklog entries a member is allowed to see, under client RLS. */
export async function readStoredWorklog(
  clientId: string,
  accountSlug: string,
): Promise<WorklogRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("worklog_entries")
    .select(
      "id, occurred_at, platform, scope_level, scope_entity_key, action_type, action_summary, reason_or_hypothesis, review_status, created_at",
    )
    .eq("client_id", clientId)
    .order("occurred_at", { ascending: false });

  if (error) throw new Error("Stored worklog entries are unavailable.");

  return ((data ?? []) as StoredWorklogRow[]).map((row) =>
    mapStoredWorklog(row, accountSlug),
  );
}

export async function persistWorklogEntry(
  clientId: string,
  draft: WorklogDraft,
): Promise<WorklogRecord> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("worklog_entries")
    .insert({
      client_id: clientId,
      occurred_at: `${draft.occurredOn}T09:00:00Z`,
      platform:
        draft.platform === "all"
          ? null
          : ["meta", "google", "ga4", "other"].includes(draft.platform)
            ? draft.platform
            : "other",
      scope_level: draft.scope,
      scope_entity_key: draft.entityName,
      action_type: draft.actionType,
      action_summary: draft.actionSummary,
      reason_or_hypothesis: draft.reasonOrHypothesis,
      review_status: "needs_review",
    })
    .select(
      "id, occurred_at, platform, scope_level, scope_entity_key, action_type, action_summary, reason_or_hypothesis, review_status, created_at",
    )
    .single();

  if (error || !data) throw new Error("The worklog entry could not be stored.");

  return mapStoredWorklog(data as StoredWorklogRow, draft.accountSlug);
}

export async function approveStoredWorklogEntry(
  clientId: string,
  entryId: string,
  reviewerId: string,
): Promise<boolean> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("worklog_entries")
    .update({
      review_status: "approved",
      reviewed_by: reviewerId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", entryId)
    .eq("client_id", clientId);

  return !error;
}

export async function persistFixtureSync(
  input: PersistFixtureSyncInput,
): Promise<SyncJob> {
  const supabase = createServiceClient();
  const startedAt = new Date().toISOString();
  const { data: createdJob, error: createJobError } = await supabase
    .from("sync_jobs")
    .insert({
      client_id: input.clientId,
      requested_by: input.requestedBy,
      requested_start: input.range.start,
      requested_end: input.range.end,
      requested_platforms: input.platforms,
      status: "running",
      attempt_count: 1,
      started_at: startedAt,
      updated_at: startedAt,
    })
    .select(
      "id, status, requested_start, requested_end, requested_platforms, safe_error_message, created_at, updated_at",
    )
    .single();

  if (createJobError || !createdJob) {
    throw new Error("Dummy sync job could not be created.");
  }

  const jobId = createdJob.id as string;

  try {
    const { error: startEventError } = await supabase
      .from("sync_job_events")
      .insert({
        sync_job_id: jobId,
        event_type: "dummy_sync_started",
        safe_message:
          "Authorized dummy sync started. No advertising API was called.",
        event_metadata: {
          source: "fixture-v1",
        },
      });

    if (startEventError) {
      throw new Error("Dummy sync start event could not be stored.");
    }

    const rowsToPersist: Record<string, unknown>[] = [];

    for (const platform of input.platforms) {
      const { data: account, error: accountError } = await supabase
        .from("ad_accounts")
        .upsert(
          {
            client_id: input.clientId,
            platform,
            account_key: "fixture-v1",
            display_name: `Kopi Senja Nusantara ${platform} dummy account`,
            currency: "USD",
            account_timezone: "Asia/Jakarta",
            attribution_setting_snapshot: {
              status: "dummy-only",
            },
            is_active: true,
            updated_at: startedAt,
          },
          {
            onConflict: "client_id,platform,account_key",
          },
        )
        .select("id")
        .single();

      if (accountError || !account) {
        throw new Error("Dummy account mapping could not be prepared.");
      }

      const accountId = account.id as string;
      const connector = new MockAdsConnector(platform);
      const result = await connector.fetchDailyMetrics({
        clientId: input.clientId,
        accountKey: "fixture-v1",
        range: input.range,
      });

      const { error: connectorConfigError } = await supabase
        .from("connector_configs")
        .upsert(
          {
            account_id: accountId,
            connector_type: `${platform}-mock`,
            mode: "mock",
            health_status: "ready",
            last_checked_at: startedAt,
            safe_message:
              "Synthetic connector ready. No advertising credential loaded.",
            updated_at: startedAt,
          },
          {
            onConflict: "account_id,connector_type",
          },
        );

      if (connectorConfigError) {
        throw new Error("Dummy connector status could not be stored.");
      }

      for (const row of result.rows) {
        rowsToPersist.push({
          metric_date: row.date,
          client_id: input.clientId,
          account_id: accountId,
          platform: row.platform,
          entity_level: "account",
          entity_key: "fixture-account",
          entity_name_snapshot: "Kopi Senja Nusantara dummy account",
          currency: row.currency,
          account_timezone: row.accountTimezone,
          spend: row.spend,
          impressions: row.impressions,
          clicks: row.clicks,
          landing_page_views: row.landingPageViews,
          engaged_visits: row.engagedVisits ?? null,
          add_to_baskets: row.addToBaskets ?? null,
          registrations: row.registrations,
          purchases: row.purchases,
          platform_conversion_value: row.platformConversionValue,
          actual_purchase_revenue: row.actualPurchaseRevenue,
          source_connector: "mock",
          source_query_version: row.sourceQueryVersion,
          synced_at: startedAt,
          is_provisional: false,
          provenance: {
            kind: "synthetic-fixture",
            schema_version: 1,
          },
          updated_at: startedAt,
        });
      }
    }

    if (rowsToPersist.length === 0) {
      throw new Error("No dummy rows overlap the requested range.");
    }

    const { error: metricError } = await supabase
      .from("daily_metrics")
      .upsert(rowsToPersist, {
        onConflict:
          "metric_date,platform,account_id,entity_level,entity_key,source_query_version",
      });

    if (metricError) {
      throw new Error("Dummy metrics could not be stored.");
    }

    const validatingAt = new Date().toISOString();
    const { error: validatingError } = await supabase
      .from("sync_jobs")
      .update({
        status: "validating",
        rows_received: rowsToPersist.length,
        rows_upserted: rowsToPersist.length,
        updated_at: validatingAt,
      })
      .eq("id", jobId);

    if (validatingError) {
      throw new Error("Dummy sync validation state could not be stored.");
    }

    const completedAt = new Date().toISOString();
    const { data: completedJob, error: completedJobError } = await supabase
      .from("sync_jobs")
      .update({
        status: "succeeded",
        completed_at: completedAt,
        updated_at: completedAt,
      })
      .eq("id", jobId)
      .select(
        "id, status, requested_start, requested_end, requested_platforms, safe_error_message, created_at, updated_at",
      )
      .single();

    if (completedJobError || !completedJob) {
      throw new Error("Dummy sync completion could not be stored.");
    }

    await supabase.from("sync_job_events").insert({
      sync_job_id: jobId,
      event_type: "dummy_sync_succeeded",
      safe_message:
        "Synthetic metrics stored successfully. No advertising API was called.",
      event_metadata: {
        rows_upserted: rowsToPersist.length,
        source: "fixture-v1",
      },
    });

    return mapStoredSyncJob(completedJob as StoredSyncJobRow);
  } catch {
    const failedAt = new Date().toISOString();
    await supabase
      .from("sync_jobs")
      .update({
        status: "failed",
        safe_error_code: "dummy_sync_failed",
        safe_error_message:
          "Dummy sync failed safely. Check server logs and Supabase setup.",
        completed_at: failedAt,
        updated_at: failedAt,
      })
      .eq("id", jobId);
    await supabase.from("sync_job_events").insert({
      sync_job_id: jobId,
      event_type: "dummy_sync_failed",
      safe_message:
        "Dummy sync failed safely. No advertising API was called.",
    });
    throw new Error("Dummy sync failed safely.");
  }
}

export interface PersistLiveSyncInput {
  clientId: string;
  /**
   * The brand `clientId` belongs to. Connectors are built from this brand's own
   * account mapping, and the pair is checked against `clients` before any pull.
   */
  clientSlug: string;
  /** Null for an unattended run; no operator identity is borrowed for it. */
  requestedBy: string | null;
  range: DateRange;
  /** Optional Google period snapshot distinct from the daily-fact window. */
  impressionShareRange?: DateRange;
  platforms: Exclude<Platform, "all">[];
  /** Recorded on the job's audit events so a scheduled run is identifiable. */
  trigger?: "operator" | "scheduled";
}

export interface PersistLiveSyncResult {
  job: SyncJob;
  dataStatus: DataStatus;
  accountRowsUpserted: number;
  campaignRowsUpserted: number;
  /** Campaign attribute rows (channel type, status) written to `ad_campaigns`. */
  campaignAttributesUpserted: number;
  /** Search query rows written to `ad_search_term_daily`. */
  searchTermRowsUpserted: number;
  /** Per-device rows written to `ad_device_daily`. */
  deviceRowsUpserted: number;
  /** Period-grain share rows written to `ad_impression_share_period`. */
  impressionSharePeriodRowsUpserted: number;
  /** Ad group and asset group rows written to `ad_entity_daily`. */
  entityRowsUpserted: number;
  /** Country and region rows written to `ad_geo_daily`. */
  geoRowsUpserted: number;
  /** Audience segment rows written to `ad_audience_daily`. */
  audienceRowsUpserted: number;
  /** Operator-safe copy only. Never carries a credential or a raw API body. */
  warnings: string[];
  errors: string[];
  qualityIssues: DataQualityIssue[];
  /** Zone names and offset days only; safe to return to an operator. */
  timezoneAlignment: TimezoneAlignment;
}

/**
 * Stable, opaque mapping key for a live account. The raw Google customer id and
 * Meta ad account id stay out of `ad_accounts.account_key` on purpose — that
 * column is readable by every client member, and the schema comment requires
 * platform identifiers never to reach the client. The real identifier is kept
 * in the server-side `provenance` payload on `daily_metrics`, which no client
 * query selects.
 */
function liveAccountKey(platform: Exclude<Platform, "all">): string {
  return `${platform}-live-v1`;
}

/** Keeps one upsert request well under PostgREST's payload limits. */
const SEARCH_TERM_UPSERT_BATCH = 500;
const SEARCH_TERM_CONFLICT_TARGET =
  "metric_date,account_id,campaign_key,ad_group_key,search_term,search_term_match_type,keyword_text,keyword_match_type,source_query_version";
const DEVICE_CONFLICT_TARGET =
  "metric_date,account_id,campaign_key,device,source_query_version";
const IMPRESSION_SHARE_PERIOD_CONFLICT_TARGET =
  "account_id,range_start,range_end,scope,campaign_key,source_query_version";
const ENTITY_CONFLICT_TARGET =
  "metric_date,account_id,entity_level,entity_key,source_query_version";
const GEO_CONFLICT_TARGET =
  "metric_date,account_id,campaign_key,country_criterion_id,region_criterion_id,source_query_version";
const AUDIENCE_CONFLICT_TARGET =
  "metric_date,account_id,ad_group_key,criterion_id,source_query_version";

function connectorTypeFor(platform: Exclude<Platform, "all">): string {
  return `${platform}-direct-api`;
}

/**
 * Health wording for `connector_configs`, derived from what the pull actually
 * did rather than from whether a credential variable is non-empty.
 */
function healthStatusFor(outcome: SyncPlatformOutcome | undefined): string {
  if (!outcome) return "unverified";
  if (outcome.outcome === "failed") return "blocked";
  if (outcome.outcome === "skipped" || outcome.rowCount === 0) return "stale";
  return "ready";
}

/**
 * Runs a live connector sync and lands the result in Supabase.
 *
 * Fail-closed in three places, all deliberate:
 *   1. Credentials are resolved by the connectors themselves; an unauthenticated
 *      platform raises an error and never falls back to synthetic rows in live
 *      mode, so mock data can never be published as real spend.
 *   2. If the data-quality gate returns a blocking issue, no metric row is
 *      written at all. A partially wrong day published to the dashboard is worse
 *      than a visibly failed refresh.
 *   3. Every failure path still closes the `sync_jobs` row and writes an event,
 *      so a crashed pull cannot leave a job stuck in `running`.
 */
export async function persistLiveSync(
  input: PersistLiveSyncInput,
): Promise<PersistLiveSyncResult> {
  // The brand decides which account is read; the client id decides where rows
  // land. Refusing a mismatched pair up front is what keeps one brand's pull
  // from ever being written under another brand.
  if (!isAccountSlug(input.clientSlug)) {
    throw new Error("Live sync was requested for an unknown brand.");
  }
  if ((await resolveClientIdBySlug(input.clientSlug)) !== input.clientId) {
    throw new Error("Live sync brand and client do not match. Sync refused.");
  }
  const accountContract = resolveAccount(input.clientSlug);
  const brandName = accountContract.name;

  const supabase = createServiceClient();
  const startedAt = new Date().toISOString();

  const { data: createdJob, error: createJobError } = await supabase
    .from("sync_jobs")
    .insert({
      client_id: input.clientId,
      requested_by: input.requestedBy,
      requested_start: input.range.start,
      requested_end: input.range.end,
      requested_platforms: input.platforms,
      status: "running",
      attempt_count: 1,
      started_at: startedAt,
      updated_at: startedAt,
    })
    .select(
      "id, status, requested_start, requested_end, requested_platforms, safe_error_message, created_at, updated_at",
    )
    .single();

  if (createJobError || !createdJob) {
    throw new Error("Live sync job could not be created.");
  }

  const jobId = createdJob.id as string;

  const recordEvent = async (
    eventType: string,
    safeMessage: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> => {
    await supabase.from("sync_job_events").insert({
      sync_job_id: jobId,
      event_type: eventType,
      safe_message: safeMessage,
      event_metadata: metadata,
    });
  };

  const failJob = async (
    safeErrorCode: string,
    safeErrorMessage: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> => {
    const failedAt = new Date().toISOString();
    await supabase
      .from("sync_jobs")
      .update({
        status: "failed",
        safe_error_code: safeErrorCode,
        safe_error_message: safeErrorMessage,
        completed_at: failedAt,
        updated_at: failedAt,
      })
      .eq("id", jobId);
    await recordEvent("live_sync_failed", safeErrorMessage, metadata);
  };

  try {
    const trigger = input.trigger ?? "operator";
    await recordEvent(
      "live_sync_started",
      `Live sync started for ${input.platforms.join(", ")} between ${input.range.start} and ${input.range.end} (${trigger}).`,
      { mode: "live", platforms: input.platforms, trigger },
    );

    const execution = await new SyncPipeline().runSync({
      clientId: input.clientId,
      clientSlug: input.clientSlug,
      accountKey: liveAccountKey(input.platforms[0] ?? "google"),
      range: input.range,
      impressionShareRange: input.impressionShareRange,
      platforms: input.platforms,
      mode: "live",
    });

    const scope: Platform = input.platforms.length === 1
      ? input.platforms[0]
      : "all";

    // Re-run the gate here rather than trusting the pipeline's own verdict, so
    // nothing reaches `daily_metrics` that this function has not scored itself.
    const quality = evaluateDataQuality(execution.rows, input.range, scope, {
      mode: "live",
      today: currentDateInTimeZone(accountContract.timezone),
    });
    const blockingIssues = quality.issues.filter(
      (issue) => issue.severity === "blocking",
    );

    if (blockingIssues.length > 0) {
      await failJob(
        "live_sync_quality_gate_failed",
        "Live refresh was rejected by the data quality gate. No metric row was published.",
        {
          issues: blockingIssues.map((issue) => issue.code),
          connector_errors: execution.errors.length,
        },
      );

      return {
        job: mapStoredSyncJob({
          ...(createdJob as StoredSyncJobRow),
          status: "failed",
          safe_error_message:
            "Live refresh was rejected by the data quality gate. No metric row was published.",
        }),
        dataStatus: "blocked",
        accountRowsUpserted: 0,
        campaignRowsUpserted: 0,
        campaignAttributesUpserted: 0,
        searchTermRowsUpserted: 0,
        deviceRowsUpserted: 0,
        impressionSharePeriodRowsUpserted: 0,
        entityRowsUpserted: 0,
        geoRowsUpserted: 0,
        audienceRowsUpserted: 0,
        warnings: execution.warnings,
        errors: [
          ...execution.errors,
          ...blockingIssues.map((issue) => issue.safeMessage),
        ],
        qualityIssues: quality.issues,
        timezoneAlignment: quality.timezoneAlignment,
      };
    }

    // Map each platform onto its ad_accounts row before any metric is written,
    // because daily_metrics.account_id is a foreign key.
    const accountIdByPlatform = new Map<Exclude<Platform, "all">, string>();
    for (const platform of input.platforms) {
      const sample =
        execution.rows.find((row) => row.platform === platform) ??
        execution.campaignRows.find((row) => row.platform === platform);
      if (!sample) continue;

      const { data: account, error: accountError } = await supabase
        .from("ad_accounts")
        .upsert(
          {
            client_id: input.clientId,
            platform,
            account_key: liveAccountKey(platform),
            display_name: `${brandName} ${platform} live account`,
            currency: sample.currency,
            account_timezone: sample.accountTimezone,
            attribution_setting_snapshot: {
              status: "live-direct-api",
              source_query_version: sample.sourceQueryVersion,
            },
            is_active: true,
            updated_at: startedAt,
          },
          { onConflict: "client_id,platform,account_key" },
        )
        .select("id")
        .single();

      if (accountError || !account) {
        throw new Error("Live account mapping could not be prepared.");
      }

      accountIdByPlatform.set(platform, account.id as string);

      const outcome = execution.platformOutcomes.find(
        (item) => item.platform === platform,
      );
      const { error: connectorConfigError } = await supabase
        .from("connector_configs")
        .upsert(
          {
            account_id: account.id as string,
            connector_type: connectorTypeFor(platform),
            mode: "live",
            health_status: healthStatusFor(outcome),
            last_checked_at: startedAt,
            safe_message:
              outcome?.safeMessage ??
              "Live connector ran with no reported outcome.",
            updated_at: startedAt,
          },
          { onConflict: "account_id,connector_type" },
        );

      if (connectorConfigError) {
        throw new Error("Live connector status could not be stored.");
      }
    }

    const toMetricRow = (
      row: DailyMetric,
      entityLevel: "account" | "campaign",
    ): Record<string, unknown> | null => {
      const accountId = accountIdByPlatform.get(row.platform);
      if (!accountId) return null;

      return {
        metric_date: row.date,
        client_id: input.clientId,
        account_id: accountId,
        platform: row.platform,
        entity_level: entityLevel,
        entity_key: entityLevel === "account" ? "account" : row.entityKey ?? "unknown",
        entity_name_snapshot:
          entityLevel === "account"
            ? `${brandName} ${row.platform} account`
            : row.entityName ?? "Unnamed campaign",
        currency: row.currency,
        account_timezone: row.accountTimezone,
        spend: row.spend,
        impressions: row.impressions,
        clicks: row.clicks,
        landing_page_views: row.landingPageViews,
        engaged_visits: row.engagedVisits ?? null,
        add_to_baskets: row.addToBaskets ?? null,
        registrations: row.registrations,
        purchases: row.purchases,
        platform_conversion_value: row.platformConversionValue,
        actual_purchase_revenue: row.actualPurchaseRevenue,
        // Undefined (a source that never reports these) lands as null, which
        // the column defines as "not measured".
        order_conversion_value: row.orderConversionValue ?? null,
        registration_lead_value: row.registrationLeadValue ?? null,
        search_impression_share: row.searchImpressionShare ?? null,
        search_budget_lost_impression_share:
          row.impressionShareLostToBudget ?? null,
        search_rank_lost_impression_share: row.impressionShareLostToRank ?? null,
        source_connector: row.sourceConnector,
        source_query_version: row.sourceQueryVersion,
        synced_at: row.syncedAt,
        is_provisional: row.isProvisional,
        provenance: {
          kind: "live-direct-api",
          schema_version: 1,
          sync_job_id: jobId,
          entity_level: entityLevel,
          // Server-side audit only. `readStoredMetrics` never selects this
          // column, so the raw platform identifier stays off the client.
          platform_account_id: row.accountId,
          source_query_version: row.sourceQueryVersion,
          is_provisional: row.isProvisional,
        },
        updated_at: startedAt,
      };
    };

    const accountRows = execution.rows
      .map((row) => toMetricRow(row, "account"))
      .filter((row): row is Record<string, unknown> => row !== null);
    const campaignRows = execution.campaignRows
      .map((row) => toMetricRow(row, "campaign"))
      .filter((row): row is Record<string, unknown> => row !== null);

    const conflictTarget =
      "metric_date,platform,account_id,entity_level,entity_key,source_query_version";

    if (accountRows.length > 0) {
      const { error } = await supabase
        .from("daily_metrics")
        .upsert(accountRows, { onConflict: conflictTarget });
      if (error) throw new Error("Live account metrics could not be stored.");
    }

    if (campaignRows.length > 0) {
      const { error } = await supabase
        .from("daily_metrics")
        .upsert(campaignRows, { onConflict: conflictTarget });
      if (error) throw new Error("Live campaign metrics could not be stored.");
    }

    // Campaign attributes and search terms land after the metric rows and never
    // decide the job's outcome: account and campaign metrics are complete
    // without them. If migration 0009 is not applied yet these writes fail, the
    // job still completes, and the warning says exactly what is missing.
    const storageWarnings: string[] = [];

    /**
     * Writes one diagnostic grain in batches. Every one of them follows the
     * same rule as search terms and devices: the spend rows are already
     * committed, so a failure here is a warning and a partial count, never a
     * failed job. The count returned is what actually landed.
     */
    const upsertDiagnosticRows = async (
      table: string,
      rows: Record<string, unknown>[],
      conflictTarget: string,
      partialWarning: (stored: number, total: number) => string,
    ): Promise<number> => {
      let stored = 0;
      for (let index = 0; index < rows.length; index += SEARCH_TERM_UPSERT_BATCH) {
        const batch = rows.slice(index, index + SEARCH_TERM_UPSERT_BATCH);
        const { error } = await supabase
          .from(table)
          .upsert(batch, { onConflict: conflictTarget });
        if (error) {
          storageWarnings.push(partialWarning(stored, rows.length));
          break;
        }
        stored += batch.length;
      }
      return stored;
    };

    const campaignAttributeRows = execution.campaigns.flatMap((record) => {
      const accountId = accountIdByPlatform.get(record.platform);
      if (!accountId) return [];
      return [
        {
          client_id: input.clientId,
          account_id: accountId,
          platform: record.platform,
          campaign_key: record.campaignKey,
          campaign_name: record.campaignName,
          channel_type: record.channelType,
          channel_sub_type: record.channelSubType,
          status: record.status,
          source_query_version: record.sourceQueryVersion,
          last_seen_at: record.syncedAt,
          provenance: { kind: "live-direct-api", schema_version: 1, sync_job_id: jobId },
          updated_at: startedAt,
        },
      ];
    });

    let campaignAttributesUpserted = 0;
    if (campaignAttributeRows.length > 0) {
      const { error } = await supabase
        .from("ad_campaigns")
        .upsert(campaignAttributeRows, { onConflict: "account_id,platform,campaign_key" });
      if (error) {
        storageWarnings.push(
          "Campaign attributes could not be stored, so campaign types cannot be read from real data yet. Account and campaign metrics were saved. Check that migration 0009 is applied.",
        );
      } else {
        campaignAttributesUpserted = campaignAttributeRows.length;
      }
    }

    const googleAccountId = accountIdByPlatform.get("google");
    const searchTermPayload = googleAccountId
      ? execution.searchTermRows.map((row) => ({
          metric_date: row.date,
          client_id: input.clientId,
          account_id: googleAccountId,
          platform: "google",
          campaign_key: row.campaignKey,
          ad_group_key: row.adGroupKey,
          search_term: row.searchTerm,
          search_term_match_type: row.searchTermMatchType,
          keyword_text: row.keywordText,
          keyword_match_type: row.keywordMatchType,
          currency: row.currency,
          account_timezone: row.accountTimezone,
          spend: row.spend,
          impressions: row.impressions,
          clicks: row.clicks,
          registrations: row.registrations,
          purchases: row.purchases,
          purchase_value: row.purchaseValue,
          source_connector: "google-direct-api",
          source_query_version: row.sourceQueryVersion,
          synced_at: row.syncedAt,
          is_provisional: row.isProvisional,
          provenance: { kind: "live-direct-api", schema_version: 1, sync_job_id: jobId },
          updated_at: startedAt,
        }))
      : [];

    let searchTermRowsUpserted = 0;
    for (let index = 0; index < searchTermPayload.length; index += SEARCH_TERM_UPSERT_BATCH) {
      const batch = searchTermPayload.slice(index, index + SEARCH_TERM_UPSERT_BATCH);
      const { error } = await supabase
        .from("ad_search_term_daily")
        .upsert(batch, { onConflict: SEARCH_TERM_CONFLICT_TARGET });
      if (error) {
        storageWarnings.push(
          `Search terms were stored only partially (${searchTermRowsUpserted} of ${searchTermPayload.length} row(s)). Check that migration 0009 is applied.`,
        );
        break;
      }
      searchTermRowsUpserted += batch.length;
    }

    const devicePayload = googleAccountId
      ? execution.deviceRows.map((row) => ({
          metric_date: row.date,
          client_id: input.clientId,
          account_id: googleAccountId,
          platform: "google",
          campaign_key: row.campaignKey,
          device: row.device,
          currency: row.currency,
          account_timezone: row.accountTimezone,
          spend: row.spend,
          impressions: row.impressions,
          clicks: row.clicks,
          registrations: row.registrations,
          purchases: row.purchases,
          order_conversion_value: row.orderConversionValue,
          registration_lead_value: row.registrationLeadValue,
          source_connector: "google-direct-api",
          source_query_version: row.sourceQueryVersion,
          synced_at: row.syncedAt,
          is_provisional: row.isProvisional,
          provenance: { kind: "live-direct-api", schema_version: 1, sync_job_id: jobId },
          updated_at: startedAt,
        }))
      : [];

    // Same rule as search terms: device rows never decide the job's outcome.
    let deviceRowsUpserted = 0;
    for (let index = 0; index < devicePayload.length; index += SEARCH_TERM_UPSERT_BATCH) {
      const batch = devicePayload.slice(index, index + SEARCH_TERM_UPSERT_BATCH);
      const { error } = await supabase
        .from("ad_device_daily")
        .upsert(batch, { onConflict: DEVICE_CONFLICT_TARGET });
      if (error) {
        storageWarnings.push(
          `Device rows were stored only partially (${deviceRowsUpserted} of ${devicePayload.length} row(s)). Check that migration 0010 is applied.`,
        );
        break;
      }
      deviceRowsUpserted += batch.length;
    }

    const impressionSharePeriodPayload = googleAccountId
      ? execution.impressionSharePeriodRows.map((row) => ({
          client_id: input.clientId,
          account_id: googleAccountId,
          platform: "google",
          range_start: row.rangeStart,
          range_end: row.rangeEnd,
          scope: row.scope,
          campaign_key: row.campaignKey,
          impressions: row.impressions,
          search_impression_share: row.searchImpressionShare,
          search_budget_lost_impression_share: row.searchBudgetLostImpressionShare,
          search_rank_lost_impression_share: row.searchRankLostImpressionShare,
          source_connector: "google-direct-api",
          source_query_version: row.sourceQueryVersion,
          synced_at: row.syncedAt,
          provenance: { kind: "live-direct-api", schema_version: 1, sync_job_id: jobId },
          updated_at: startedAt,
        }))
      : [];

    // Same rule as search terms and devices: a diagnostic grain never decides
    // the job's outcome. Spend rows are already committed by this point.
    let impressionSharePeriodRowsUpserted = 0;
    for (
      let index = 0;
      index < impressionSharePeriodPayload.length;
      index += SEARCH_TERM_UPSERT_BATCH
    ) {
      const batch = impressionSharePeriodPayload.slice(
        index,
        index + SEARCH_TERM_UPSERT_BATCH,
      );
      const { error } = await supabase
        .from("ad_impression_share_period")
        .upsert(batch, { onConflict: IMPRESSION_SHARE_PERIOD_CONFLICT_TARGET });
      if (error) {
        storageWarnings.push(
          `Period impression share was stored only partially (${impressionSharePeriodRowsUpserted} of ${impressionSharePeriodPayload.length} row(s)), so the auction panel stays on derived daily values. Check that migration 0011 is applied.`,
        );
        break;
      }
      impressionSharePeriodRowsUpserted += batch.length;
    }

    // Provenance for every diagnostic grain below. Written server-side only:
    // no client query selects it.
    const diagnosticProvenance = {
      kind: "live-direct-api",
      schema_version: 1,
      sync_job_id: jobId,
    };

    const entityPayload = googleAccountId
      ? execution.entityRows.map((row) => ({
          metric_date: row.date,
          client_id: input.clientId,
          account_id: googleAccountId,
          platform: "google",
          entity_level: row.entityLevel,
          campaign_key: row.campaignKey,
          entity_key: row.entityKey,
          entity_name_snapshot: row.entityName,
          status: row.status,
          currency: row.currency,
          account_timezone: row.accountTimezone,
          spend: row.spend,
          impressions: row.impressions,
          clicks: row.clicks,
          registrations: row.registrations,
          purchases: row.purchases,
          order_conversion_value: row.orderConversionValue,
          registration_lead_value: row.registrationLeadValue,
          // Carried, never defaulted: it is the only thing that says whether
          // this row's conversions are on the same basis as the next one's.
          conversion_action_filtered: row.conversionActionFiltered,
          source_connector: "google-direct-api",
          source_query_version: row.sourceQueryVersion,
          synced_at: row.syncedAt,
          is_provisional: row.isProvisional,
          provenance: diagnosticProvenance,
          updated_at: startedAt,
        }))
      : [];

    const entityRowsUpserted = await upsertDiagnosticRows(
      "ad_entity_daily",
      entityPayload,
      ENTITY_CONFLICT_TARGET,
      (stored, total) =>
        `Ad group and asset group rows were stored only partially (${stored} of ${total} row(s)). Check that migration 0012 is applied.`,
    );

    const geoPayload = googleAccountId
      ? execution.geoRows.map((row) => ({
          metric_date: row.date,
          client_id: input.clientId,
          account_id: googleAccountId,
          platform: "google",
          campaign_key: row.campaignKey,
          country_criterion_id: row.countryCriterionId,
          region_criterion_id: row.regionCriterionId,
          country_code: row.countryCode,
          region_name: row.regionName,
          currency: row.currency,
          account_timezone: row.accountTimezone,
          spend: row.spend,
          impressions: row.impressions,
          clicks: row.clicks,
          registrations: row.registrations,
          purchases: row.purchases,
          order_conversion_value: row.orderConversionValue,
          conversion_action_filtered: row.conversionActionFiltered,
          source_connector: "google-direct-api",
          source_query_version: row.sourceQueryVersion,
          synced_at: row.syncedAt,
          is_provisional: row.isProvisional,
          provenance: diagnosticProvenance,
          updated_at: startedAt,
        }))
      : [];

    const geoRowsUpserted = await upsertDiagnosticRows(
      "ad_geo_daily",
      geoPayload,
      GEO_CONFLICT_TARGET,
      (stored, total) =>
        `Location rows were stored only partially (${stored} of ${total} row(s)). Check that migration 0013 is applied.`,
    );

    const audiencePayload = googleAccountId
      ? execution.audienceRows.map((row) => ({
          metric_date: row.date,
          client_id: input.clientId,
          account_id: googleAccountId,
          platform: "google",
          campaign_key: row.campaignKey,
          ad_group_key: row.adGroupKey,
          criterion_id: row.criterionId,
          criterion_type: row.criterionType,
          display_name: row.displayName,
          currency: row.currency,
          account_timezone: row.accountTimezone,
          spend: row.spend,
          impressions: row.impressions,
          clicks: row.clicks,
          registrations: row.registrations,
          purchases: row.purchases,
          order_conversion_value: row.orderConversionValue,
          conversion_action_filtered: row.conversionActionFiltered,
          source_connector: "google-direct-api",
          source_query_version: row.sourceQueryVersion,
          synced_at: row.syncedAt,
          is_provisional: row.isProvisional,
          provenance: diagnosticProvenance,
          updated_at: startedAt,
        }))
      : [];

    const audienceRowsUpserted = await upsertDiagnosticRows(
      "ad_audience_daily",
      audiencePayload,
      AUDIENCE_CONFLICT_TARGET,
      (stored, total) =>
        `Audience segment rows were stored only partially (${stored} of ${total} row(s)). Check that migration 0013 is applied.`,
    );

    const validatingAt = new Date().toISOString();
    const { error: validatingError } = await supabase
      .from("sync_jobs")
      .update({
        status: "validating",
        rows_received: execution.rows.length + execution.campaignRows.length,
        rows_upserted: accountRows.length + campaignRows.length,
        updated_at: validatingAt,
      })
      .eq("id", jobId);

    if (validatingError) {
      throw new Error("Live sync validation state could not be stored.");
    }

    await recordEvent(
      "live_sync_validated",
      `Data quality gate returned ${quality.status} with ${quality.issues.length} issue(s).`,
      {
        data_status: quality.status,
        issue_codes: quality.issues.map((issue) => issue.code),
        timezone_alignment: quality.timezoneAlignment.status,
        timezone_offset_days: quality.timezoneAlignment.offsetDates.length,
        account_rows: accountRows.length,
        campaign_rows: campaignRows.length,
      },
    );

    // `partial` is the honest status whenever a platform failed or the gate
    // raised a warning: the rows that did land are real and worth publishing,
    // but the period is not complete. A disclosure-only warning (the UK GMT/BST
    // offset) is the exception — every row arrived, so "incomplete coverage"
    // would be a false statement. The caveat travels in `qualityIssues`.
    const finalStatus: StoredSyncJobRow["status"] =
      execution.errors.length > 0 ||
      quality.issues.some((issue) => !isDisclosureOnlyIssue(issue))
        ? "partial"
        : "succeeded";

    const completedAt = new Date().toISOString();
    const { data: completedJob, error: completedJobError } = await supabase
      .from("sync_jobs")
      .update({
        status: finalStatus,
        completed_at: completedAt,
        updated_at: completedAt,
        ...(execution.errors.length > 0
          ? {
              safe_error_code: "live_sync_partial",
              safe_error_message:
                "One or more platforms did not return a complete period. Stored rows are real; coverage is incomplete.",
            }
          : {}),
      })
      .eq("id", jobId)
      .select(
        "id, status, requested_start, requested_end, requested_platforms, safe_error_message, created_at, updated_at",
      )
      .single();

    if (completedJobError || !completedJob) {
      throw new Error("Live sync completion could not be stored.");
    }

    await recordEvent(
      finalStatus === "succeeded" ? "live_sync_succeeded" : "live_sync_partial",
      `Live sync stored ${accountRows.length} account row(s) and ${campaignRows.length} campaign row(s).`,
      {
        account_rows: accountRows.length,
        campaign_rows: campaignRows.length,
        campaign_attribute_rows: campaignAttributesUpserted,
        search_term_rows: searchTermRowsUpserted,
        device_rows: deviceRowsUpserted,
        impression_share_period_rows: impressionSharePeriodRowsUpserted,
        entity_rows: entityRowsUpserted,
        geo_rows: geoRowsUpserted,
        audience_rows: audienceRowsUpserted,
        platforms: execution.platformOutcomes.map((item) => ({
          platform: item.platform,
          provider_id: item.providerId,
          outcome: item.outcome,
          row_count: item.rowCount,
        })),
      },
    );

    return {
      job: mapStoredSyncJob(completedJob as StoredSyncJobRow),
      dataStatus: quality.status,
      accountRowsUpserted: accountRows.length,
      campaignRowsUpserted: campaignRows.length,
      campaignAttributesUpserted,
      searchTermRowsUpserted,
      deviceRowsUpserted,
      impressionSharePeriodRowsUpserted,
      entityRowsUpserted,
      geoRowsUpserted,
      audienceRowsUpserted,
      warnings: [...execution.warnings, ...storageWarnings],
      errors: execution.errors,
      qualityIssues: quality.issues,
      timezoneAlignment: quality.timezoneAlignment,
    };
  } catch (error) {
    // The message is generated by this codebase or by a ConnectorFailure, both
    // of which are written to stay free of credentials and raw API bodies.
    const safeMessage =
      error instanceof Error
        ? error.message
        : "Live sync failed for an unrecognised reason.";
    await failJob("live_sync_failed", safeMessage);
    throw new Error(safeMessage);
  }
}
