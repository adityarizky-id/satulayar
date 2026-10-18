import type {
  DailyMetric,
  DateRange,
  Platform,
} from "@/lib/dashboard/types";

export type ConnectorProviderKind =
  | "gateway"
  | "official-api"
  | "official-mcp"
  | "community-mcp"
  | "managed-mcp"
  | "mock";

export type DirectConnectorPlatform = "google-ads" | "meta-ads" | "google-analytics";
export type PlatformCredentialValues = Record<string, string>;

/** Value-free validation shared by platform forms and the save endpoint. */
export function validatePlatformCredentials(
  platform: DirectConnectorPlatform,
  input: Record<string, unknown>,
): { field: string; message: string } | null {
  const required = platform === "meta-ads"
    ? ["customerId", "accessToken", "apiVersion", "tokenExpiresAt"]
    : platform === "google-analytics"
      ? ["propertyId", "clientId", "clientSecret", "refreshToken"]
      : ["customerId", "developerToken", "clientId", "clientSecret", "refreshToken"];
  for (const field of required) {
    if (typeof input[field] !== "string" || !input[field].trim()) {
      return { field, message: "This field is required." };
    }
  }
  for (const [field, value] of Object.entries(input)) {
    if (typeof value === "string" && value.length > 8192) {
      return { field, message: "This value is too long." };
    }
  }
  if (platform === "meta-ads") {
    if (input.campaignNameFilter !== undefined && typeof input.campaignNameFilter !== "string") {
      return { field: "campaignNameFilter", message: "Enter a text campaign filter or leave it empty." };
    }
    if (!/^(act_)?\d{10,20}$/.test(String(input.customerId).trim())) {
      return { field: "customerId", message: "Enter a numeric Meta ad account ID, optionally starting with act_." };
    }
    if (!/^v\d{1,3}\.\d$/.test(String(input.apiVersion).trim())) {
      return { field: "apiVersion", message: "Use the Graph API version shown in your Meta app, in vNN.N format." };
    }
    const expiry = Date.parse(String(input.tokenExpiresAt));
    if (!/(Z|[+-]\d{2}:\d{2})$/i.test(String(input.tokenExpiresAt).trim()) || !Number.isFinite(expiry) || expiry <= Date.now()) {
      return { field: "tokenExpiresAt", message: "Enter the token's actual future expiry, including timezone." };
    }
    if (String(input.campaignNameFilter ?? "").length > 200) {
      return { field: "campaignNameFilter", message: "Campaign filter must be 200 characters or fewer." };
    }
  }
  if (platform === "google-analytics" && !/^\d{1,20}$/.test(String(input.propertyId).trim())) {
    return { field: "propertyId", message: "Enter the numeric GA4 property ID, not the G- measurement ID." };
  }
  return null;
}

export type ConnectorFailureCode =
  | "unavailable"
  | "unauthenticated"
  | "quota-exceeded"
  | "rate-limited"
  | "timeout"
  | "invalid-response"
  | "data-parity-failed"
  | "configuration-error";

/** Campaign attributes as the platform reports them today. */
export interface AdCampaignRecord {
  platform: Exclude<Platform, "all">;
  campaignKey: string;
  campaignName: string;
  /** Google `campaign.advertising_channel_type`, e.g. SEARCH or PERFORMANCE_MAX. */
  channelType: string;
  channelSubType: string | null;
  status: string;
  sourceQueryVersion: string;
  syncedAt: string;
}

/**
 * One search query on one day under one ad group and matched keyword.
 * Conversion fields are null when the conversion pull did not run or failed,
 * so "not measured" can never be read as "zero conversions".
 */
export interface SearchTermDailyRecord {
  date: string;
  campaignKey: string;
  adGroupKey: string;
  searchTerm: string;
  searchTermMatchType: string;
  keywordText: string;
  keywordMatchType: string;
  currency: DailyMetric["currency"];
  accountTimezone: string;
  spend: number;
  impressions: number;
  clicks: number;
  registrations: number | null;
  purchases: number | null;
  purchaseValue: number | null;
  sourceQueryVersion: string;
  syncedAt: string;
  isProvisional: boolean;
}

/**
 * Google spend, traffic, and mapped conversions for one campaign on one day on
 * one device. `device` is `segments.device` verbatim. Conversion fields are
 * null when the conversion pull did not run or failed.
 */
export interface DeviceDailyRecord {
  date: string;
  campaignKey: string;
  device: string;
  currency: DailyMetric["currency"];
  accountTimezone: string;
  spend: number;
  impressions: number;
  clicks: number;
  registrations: number | null;
  purchases: number | null;
  orderConversionValue: number | null;
  registrationLeadValue: number | null;
  sourceQueryVersion: string;
  syncedAt: string;
  isProvisional: boolean;
}

/**
 * Google search impression share for a whole reporting period, asked of Google
 * as one question instead of being rolled up from days.
 *
 * This grain exists because the daily rows cannot answer it. Google masks any
 * share below 10% as 0.0999 and above 90% as 0.9001, and on a small account most
 * Search and PMax days can be masked. Averaging masked days can give a
 * lost-to-rank or lost-to-budget figure that sits near, but not on, what
 * Google's own period query returns. A derived number that close to the truth
 * is more dangerous than an absent one, because nothing about it looks wrong.
 *
 * `scope` separates Google's account roll-up over search-eligible traffic from
 * one campaign's own share; the two are different questions and the account
 * figure is not the average of the campaign figures. Every share is null when
 * Google did not report it, never 0.
 */
export interface ImpressionSharePeriodRecord {
  rangeStart: string;
  rangeEnd: string;
  scope: "account" | "campaign";
  /** Empty string at account scope, so the storage grain stays non-null. */
  campaignKey: string;
  /** Impressions Google counted over the period, for weighting and coverage. */
  impressions: number;
  searchImpressionShare: number | null;
  searchBudgetLostImpressionShare: number | null;
  searchRankLostImpressionShare: number | null;
  sourceQueryVersion: string;
  syncedAt: string;
}

/**
 * Google performance for one ad group, or one Performance Max asset group, on
 * one day. The parent campaign travels with the row so the level can be rolled
 * up to the campaign table or drilled into from it.
 *
 * `conversionActionFiltered` is the row's own honesty flag. An ad group
 * supports per-conversion-action segmentation, so its conversions can be cut
 * down to the actions this dashboard counts as orders; an asset group does not,
 * so its figures are Google's own mixed total. Comparing a filtered count with
 * an unfiltered one is exactly the mistake the flag exists to prevent.
 */
export interface AdEntityDailyRecord {
  date: string;
  entityLevel: "ad_group" | "asset_group";
  campaignKey: string;
  entityKey: string;
  entityName: string | null;
  status: string | null;
  currency: DailyMetric["currency"];
  accountTimezone: string;
  spend: number;
  impressions: number;
  clicks: number;
  registrations: number | null;
  purchases: number | null;
  orderConversionValue: number | null;
  registrationLeadValue: number | null;
  conversionActionFiltered: boolean;
  sourceQueryVersion: string;
  syncedAt: string;
  isProvisional: boolean;
}

/**
 * Google performance by where the user physically was, at country and region
 * grain. Read from `user_location_view`, never `geographic_view`: the second
 * mixes physical location with location of interest, and for brands selling
 * across borders those are different populations.
 */
export interface GeoDailyRecord {
  date: string;
  campaignKey: string;
  countryCriterionId: string;
  /** Empty string when Google placed the traffic to a country but no region. */
  regionCriterionId: string;
  /** Null until the geo target lookup resolves it; never guessed. */
  countryCode: string | null;
  regionName: string | null;
  currency: DailyMetric["currency"];
  accountTimezone: string;
  spend: number;
  impressions: number;
  clicks: number;
  registrations: number | null;
  purchases: number | null;
  orderConversionValue: number | null;
  conversionActionFiltered: boolean;
  sourceQueryVersion: string;
  syncedAt: string;
  isProvisional: boolean;
}

/**
 * Google audience segment performance at the grain Google reports it: the
 * segment as attached to one ad group. The same remarketing list in three ad
 * groups is three rows, because the unit of decision is the list in this ad
 * group, and summing them would double count a user reached twice.
 */
export interface AudienceDailyRecord {
  date: string;
  campaignKey: string;
  adGroupKey: string;
  criterionId: string;
  criterionType: string | null;
  displayName: string | null;
  currency: DailyMetric["currency"];
  accountTimezone: string;
  spend: number;
  impressions: number;
  clicks: number;
  registrations: number | null;
  purchases: number | null;
  orderConversionValue: number | null;
  conversionActionFiltered: boolean;
  sourceQueryVersion: string;
  syncedAt: string;
  isProvisional: boolean;
}

export interface ConnectorRequest {
  clientId: string;
  accountKey: string;
  range: DateRange;
  /**
   * Optional Google-only period window for search impression share.
   *
   * Scheduled daily metrics deliberately stop at yesterday, while the
   * dashboard's rolling presets end on the account-local current day. Keeping
   * this window separate lets the scheduler refresh the exact auction snapshot
   * the UI asks for without publishing an open day into daily KPI facts.
   */
  impressionShareRange?: DateRange;
}

export interface ConnectorAttempt {
  providerId: string;
  outcome: "skipped" | "failed" | "succeeded";
  failureCode?: ConnectorFailureCode;
  safeMessage: string;
}

export interface ConnectorResult {
  platform: Exclude<Platform, "all">;
  rows: DailyMetric[];
  /**
   * Campaign-level rows for the same range. Kept out of `rows` on purpose:
   * data-quality scoring, KPI maths, and the dashboard all assume one row per
   * platform per day, and mixing levels there would double count spend.
   */
  campaignRows?: DailyMetric[];
  /**
   * One attribute record per campaign seen in the range. The channel type is
   * what lets the dashboard group real campaigns by type instead of splitting
   * account spend with fixed shares.
   */
  campaigns?: AdCampaignRecord[];
  /** Google search query rows for the same range. Never aggregated into KPIs. */
  searchTermRows?: SearchTermDailyRecord[];
  /** Google ad group and Performance Max asset group rows for the range. */
  entityRows?: AdEntityDailyRecord[];
  /** Google country and region rows for the range. */
  geoRows?: GeoDailyRecord[];
  /** Google audience segment rows for the range. */
  audienceRows?: AudienceDailyRecord[];
  /** Google per-device rows for the same range. Never aggregated into KPIs. */
  deviceRows?: DeviceDailyRecord[];
  /**
   * Google impression share asked at period grain. Separate from the daily
   * shares on `rows` because a masked daily share cannot be averaged back into
   * the period figure Google reports.
   */
  impressionSharePeriodRows?: ImpressionSharePeriodRecord[];
  providerId: string;
  sourceQueryVersion: string;
  coveragePercent: number;
  warnings: string[];
  attempts: ConnectorAttempt[];
}

export interface ConnectorHealth {
  providerId: string;
  providerKind: ConnectorProviderKind;
  available: boolean;
  authenticated: boolean;
  readOnly: boolean;
  safeMessage: string;
}

export interface ReadOnlyAdsConnector {
  readonly providerId: string;
  readonly providerKind: ConnectorProviderKind;
  readonly platform: Exclude<Platform, "all">;
  readonly mode: "mock" | "live";
  health(): Promise<ConnectorHealth>;
  fetchDailyMetrics(request: ConnectorRequest): Promise<ConnectorResult>;
}

export class ConnectorFailure extends Error {
  constructor(
    readonly code: ConnectorFailureCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ConnectorFailure";
  }
}
