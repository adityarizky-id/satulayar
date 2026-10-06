import type {
  AdCampaignRecord,
  AdEntityDailyRecord,
  AudienceDailyRecord,
  ConnectorHealth,
  ConnectorRequest,
  ConnectorResult,
  DeviceDailyRecord,
  GeoDailyRecord,
  ImpressionSharePeriodRecord,
  ReadOnlyAdsConnector,
  SearchTermDailyRecord,
} from "@/lib/connectors/types";
import {
  readStoredGoogleAdsCredentials,
  type StoredGoogleAdsCredentials,
} from "@/lib/connectors/google-ads-config";
import { exchangeGoogleRefreshToken } from "@/lib/connectors/google-oauth-token";
import { ConnectorFailure } from "@/lib/connectors/types";
import type { Currency, DailyMetric, Platform } from "@/lib/dashboard/types";

export interface GoogleAdsApiConfiguration {
  developerToken?: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  customerId?: string;
  loginCustomerId?: string;
  apiVersion?: string;
  /**
   * Conversion action IDs (numeric, not the full resource name) that this
   * account's registration and purchase events map to. Explicit mappings win.
   * When absent, the connector may resolve only an unambiguous semantic match:
   * exactly one enabled SIGNUP and exactly one enabled, primary PURCHASE. It
   * never guesses by display name or from engagement categories—the class of
   * mistake that counts an engagement action such as Time on Site as a sale.
   */
  registrationConversionActionId?: string;
  purchaseConversionActionId?: string;
  /**
   * Pins the account to one reporting currency. Left unset the client accepts
   * any supported currency, which is correct for the multi-brand rollout where
   * accounts may report in different currencies. Set it per account and a
   * mismatch fails closed instead of publishing figures under the wrong
   * currency — the 30 acquisition guardrail is evaluated in the account's own
   * currency and is meaningless if the currency is wrong.
   */
  expectedCurrency?: Currency;
  /**
   * Row key used to look the refresh token up in `connector_tokens`. This is
   * the client *slug* the OAuth callback stored (`kopi-senja`), never the
   * `clients.id` UUID that `ConnectorRequest.clientId` carries — looking up by
   * UUID silently finds nothing and the connector then reports "missing
   * credentials" for an account that is in fact connected.
   */
  clientSlug?: string;
  /**
   * Also pull a per-campaign breakdown for the same range. Persisted at
   * `entity_level = 'campaign'` and never mixed into the account rows.
   */
  includeCampaignBreakdown?: boolean;
  /**
   * Also pull `search_term_view` when the account runs a Search or Shopping
   * campaign. Needs the campaign breakdown, which is what reveals the channel
   * types. Off unless set, so a bare client never issues the extra query.
   */
  includeSearchTerms?: boolean;
  /**
   * Also pull search impression share and the share lost to budget and rank,
   * for the account and for every campaign that can serve on Search. A failure
   * is a warning: spend and conversions are complete without it.
   */
  includeImpressionShare?: boolean;
  /**
   * Also pull spend, traffic, and mapped conversions per campaign per device.
   * Stored at its own grain and never mixed into account or campaign rows.
   */
  includeDeviceBreakdown?: boolean;
  /**
   * Also pull ad groups and Performance Max asset groups. Both land in one
   * table at their own grain, carrying the parent campaign so the level can be
   * rolled up to the campaign or drilled into from it.
   */
  includeEntityBreakdown?: boolean;
  /**
   * Also pull performance by the user's physical location, at country and
   * region grain. City is deliberately not pulled: the row count grows with a
   * long tail the dashboard does not read.
   */
  includeGeoBreakdown?: boolean;
  /** Also pull audience segments at the ad group criterion grain. */
  includeAudienceBreakdown?: boolean;
}

/**
 * Most geo targets a brand touches in a period are a handful of countries and
 * their regions. A pull far above this is a targeting setup the name lookup
 * cannot answer in one bounded query, so the names are left null rather than
 * filled in for some rows and not others.
 */
const GEO_TARGET_LOOKUP_LIMIT = 500;

/** One grain of a segmented pull, after both queries have been merged. */
interface SegmentedRow<Identity> {
  date: string;
  identity: Identity;
  spend: number;
  impressions: number;
  clicks: number;
  registrations: number | null;
  purchases: number | null;
  orderConversionValue: number | null;
  registrationLeadValue: number | null;
  conversionActionFiltered: boolean;
}

interface SegmentedBucket<Identity> {
  date: string;
  identity: Identity;
  spend: number;
  impressions: number;
  clicks: number;
  registrations: number | null;
  purchases: number | null;
  orderValue: number;
  registrationValue: number;
  conversionActionFiltered: boolean;
}

/** "geoTargetConstants/20339" becomes "20339"; anything else becomes "". */
function criterionIdFromResourceName(resourceName: string): string {
  const tail = resourceName.trim().split("/").at(-1) ?? "";
  return /^\d+$/.test(tail) ? tail : "";
}

/** Channel types whose queries appear in `search_term_view`. */
const SEARCH_TERM_CHANNEL_TYPES = new Set(["SEARCH", "SHOPPING"]);

/**
 * Channel types that serve on the search network and so carry a real search
 * impression share. Google answers the same metric with 0 for a Display
 * campaign; storing that would publish "0% share" for a campaign that was
 * never eligible for a search auction, so every other type is stored as null.
 */
const SEARCH_SHARE_CHANNEL_TYPES = new Set(["SEARCH", "SHOPPING", "PERFORMANCE_MAX"]);

/** One conversion action as the account actually defines it today. */
export interface GoogleConversionAction {
  id: string;
  resourceName: string;
  name: string;
  category: string;
  type: string;
  status: string;
  includedInConversionsMetric: boolean;
}

export interface ConversionActionMappingReport {
  ok: boolean;
  customerId: string;
  registration?: GoogleConversionAction;
  purchase?: GoogleConversionAction;
  problems: string[];
  contaminatedCandidates: GoogleConversionAction[];
  allActions: GoogleConversionAction[];
}

/**
 * Categories that describe engagement, not an acquisition. An engagement action
 * such as "Time on Site - 60 Seconds" can sit in the same account and pollute
 * the conversion count, so mapping registration or purchase onto one
 * of these is rejected outright rather than merely warned about.
 */
const CONTAMINATED_CATEGORIES = new Set([
  "PAGE_VIEW",
  "ENGAGEMENT",
  "DEFAULT",
  "ADD_TO_CART",
  "BEGIN_CHECKOUT",
  "OUTBOUND_CLICK",
]);

/** Categories that legitimately represent each mapped event. */
const REGISTRATION_CATEGORIES = new Set(["SIGNUP", "SUBMIT_LEAD_FORM", "CONTACT"]);
const PURCHASE_CATEGORIES = new Set(["PURCHASE"]);

export type ConsiderationField =
  | "landingPageViews"
  | "engagedVisits"
  | "addToBaskets";

/**
 * Consideration signals Google can carry through the site tag.
 *
 * These are the same categories the acquisition mapping treats as
 * contamination, and deliberately so: counted as conversions they corrupt the
 * order count, but read on their own they are the only native measure Google
 * has of what happened between the click and the checkout.
 *
 * Each is matched on name, category and type together, never on category
 * alone. An account can have two enabled PAGE_VIEW/WEBPAGE actions — a page-load
 * count and a 60-second dwell count — which mean different things and must
 * never be summed. Requiring `WEBPAGE` additionally excludes the GOOGLE_HOSTED
 * "Local actions - Website visits" present on some accounts, which
 * counts clicks from a Business Profile listing rather than landings from an
 * ad.
 *
 * Resolution is by name rather than by configured id so that mapping a new
 * account is an ads-side task: create the action with the agreed name and the
 * metric appears, with no environment variable and no deploy.
 */
const CONSIDERATION_ACTIONS: readonly {
  field: ConsiderationField;
  name: string;
  category: string;
  type: string;
}[] = [
  {
    field: "landingPageViews",
    name: "Website – Page View (Loaded)",
    category: "PAGE_VIEW",
    type: "WEBPAGE",
  },
  {
    field: "engagedVisits",
    name: "Time on Site - 60 Seconds",
    category: "PAGE_VIEW",
    type: "WEBPAGE",
  },
  {
    field: "addToBaskets",
    name: "Add to basket",
    category: "ADD_TO_CART",
    type: "WEBPAGE",
  },
];

/**
 * Names are typed by hand in each account, so they are compared in a
 * normalised form. Case, repeated spaces and the dash character all vary in
 * practice — "–" against "-" — without changing which action is meant.
 */
function normaliseActionName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

interface ConsiderationMapping {
  byField: Map<ConsiderationField, GoogleConversionAction>;
  problems: string[];
}

/**
 * Picks the consideration action for each field, or leaves the field unmapped.
 *
 * An unmapped field is the normal state for an account that has not been set
 * up yet and produces no problem message; the metric simply reports as not
 * measured. An ambiguous field — two enabled actions matching the same name,
 * category and type — is left unmapped and reported, because summing them
 * would double count and picking one would be a guess.
 */
export function resolveConsiderationActions(
  actions: readonly GoogleConversionAction[],
): ConsiderationMapping {
  const byField = new Map<ConsiderationField, GoogleConversionAction>();
  const problems: string[] = [];

  for (const definition of CONSIDERATION_ACTIONS) {
    const wanted = normaliseActionName(definition.name);
    const matches = actions.filter(
      (action) =>
        action.status === "ENABLED" &&
        action.category === definition.category &&
        action.type === definition.type &&
        normaliseActionName(action.name) === wanted,
    );

    if (matches.length === 1 && matches[0]) {
      byField.set(definition.field, matches[0]);
      continue;
    }

    if (matches.length > 1) {
      problems.push(
        `Account has ${matches.length} enabled conversion actions named "${definition.name}" (${definition.category}/${definition.type}), so ${definition.field} is reported as not measured rather than double counted. Ids: ${matches
          .map((action) => action.id)
          .join(", ")}.`,
      );
    }
  }

  return { byField, problems };
}

interface GoogleAdsSearchRow {
  segments?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
  customer?: Record<string, unknown>;
}

interface GoogleAdsSearchResponse {
  results?: GoogleAdsSearchRow[];
  nextPageToken?: string;
}

const GOOGLE_ADS_API_BASE = "https://googleads.googleapis.com";
const SUPPORTED_CURRENCIES: readonly Currency[] = ["USD", "IDR", "SGD", "MYR", "GBP", "EUR"];
const DEFAULT_CLIENT_SLUG = "kopi-senja";
/**
 * Google sunsets Google Ads API versions on a fixed schedule and a retired
 * version stops resolving entirely. When this client was last checked,
 * v17 through v21 all answered HTTP 404 with an HTML
 * error page, and only v22 and v23 were still served. v19 — the version this
 * client used to default to — is
 * dead, so every live call returned 404. v23 is the newest served version and
 * therefore has the longest remaining life.
 *
 * Note this string is part of `sourceQueryVersion`, which is in the
 * `daily_metrics` conflict target. Changing it starts a new row lineage rather
 * than overwriting rows pulled under the previous version.
 */
const DEFAULT_API_VERSION = "v23";

/**
 * Extra attempts for a page Google said was worth retrying.
 *
 * A year-to-date pull issues many times the page requests a 30-day one does,
 * so a single quota blip part-way through used to discard a whole brand's
 * window. Bounded at three: past that the account is not throttled, it is
 * broken, and an operator should hear about it rather than watch the run hang.
 */
const GAQL_MAX_RETRIES = 3;
const GAQL_RETRY_BASE_MS = 1_000;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * `Retry-After` in whole seconds when the API sends one, else a widening pause.
 * The HTTP-date form is ignored rather than parsed: Google sends the numeric
 * form, and a misread date could park the run for hours.
 */
function gaqlRetryDelayMs(response: Response | null, attempt: number): number {
  const header = response?.headers.get("retry-after")?.trim();
  const seconds = header ? Number(header) : Number.NaN;
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds, 60) * 1_000;
  }
  return GAQL_RETRY_BASE_MS * 3 ** attempt;
}

/** Reads a metrics/segments value under either casing the REST API may return. */
function field(row: Record<string, unknown> | undefined, camel: string, snake: string): unknown {
  return row?.[camel] ?? row?.[snake];
}

function toNumber(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : 0;
}

interface ImpressionShareReading {
  searchImpressionShare?: number;
  impressionShareLostToBudget?: number;
  impressionShareLostToRank?: number;
}

/**
 * Reads one share ratio. Absent, non-numeric, or out-of-range values return
 * undefined — "not reported" — instead of 0. Google's masked tails (0.0999 for
 * "below 10%", 0.9001 for "above 90%") are in range and kept as returned.
 */
function readShare(
  metrics: Record<string, unknown> | undefined,
  camel: string,
  snake: string,
): number | undefined {
  const raw = field(metrics, camel, snake);
  if (raw === undefined || raw === null || raw === "") return undefined;
  const parsed = typeof raw === "string" ? Number(raw) : raw;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) return undefined;
  return parsed >= 0 && parsed <= 1 ? parsed : undefined;
}

function readImpressionShare(
  metrics: Record<string, unknown> | undefined,
): ImpressionShareReading {
  const reading: ImpressionShareReading = {};
  const share = readShare(metrics, "searchImpressionShare", "search_impression_share");
  const budget = readShare(
    metrics,
    "searchBudgetLostImpressionShare",
    "search_budget_lost_impression_share",
  );
  const rank = readShare(
    metrics,
    "searchRankLostImpressionShare",
    "search_rank_lost_impression_share",
  );
  // Only defined keys are set, so spreading a reading never writes an explicit
  // undefined over a value.
  if (share !== undefined) reading.searchImpressionShare = share;
  if (budget !== undefined) reading.impressionShareLostToBudget = budget;
  if (rank !== undefined) reading.impressionShareLostToRank = rank;
  return reading;
}

const IMPRESSION_SHARE_METRICS = [
  "metrics.search_impression_share",
  "metrics.search_budget_lost_impression_share",
  "metrics.search_rank_lost_impression_share",
].join(", ");

type SearchTermIdentity = Pick<
  SearchTermDailyRecord,
  | "date"
  | "campaignKey"
  | "adGroupKey"
  | "searchTerm"
  | "searchTermMatchType"
  | "keywordText"
  | "keywordMatchType"
>;

/** Reads the grain of one `search_term_view` row; null when any key is absent. */
function readSearchTermIdentity(row: GoogleAdsSearchRow): SearchTermIdentity | null {
  const holder = row as GoogleAdsSearchRow & {
    campaign?: Record<string, unknown>;
    adGroup?: Record<string, unknown>;
    ad_group?: Record<string, unknown>;
    searchTermView?: Record<string, unknown>;
    search_term_view?: Record<string, unknown>;
  };
  const date = String(field(row.segments, "date", "date") ?? "");
  const campaignKey = String(field(holder.campaign, "id", "id") ?? "");
  const adGroupKey = String(field(holder.adGroup ?? holder.ad_group, "id", "id") ?? "");
  const searchTerm = String(
    field(holder.searchTermView ?? holder.search_term_view, "searchTerm", "search_term") ?? "",
  ).trim();
  if (!date || !campaignKey || !adGroupKey || !searchTerm) return null;

  const keyword = field(row.segments, "keyword", "keyword") as
    | { info?: Record<string, unknown> }
    | undefined;
  return {
    date,
    campaignKey,
    adGroupKey,
    searchTerm,
    searchTermMatchType: String(
      field(row.segments, "searchTermMatchType", "search_term_match_type") ?? "UNSPECIFIED",
    ),
    keywordText: String(field(keyword?.info, "text", "text") ?? ""),
    keywordMatchType: String(field(keyword?.info, "matchType", "match_type") ?? ""),
  };
}

function searchTermKey(identity: SearchTermIdentity): string {
  return [
    identity.date,
    identity.campaignKey,
    identity.adGroupKey,
    identity.searchTerm,
    identity.searchTermMatchType,
    identity.keywordText,
    identity.keywordMatchType,
  ].join("\u0000");
}

/** "Today" in the account's own timezone, formatted as an ISO date. */
function todayInTimezone(timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    // Invalid or unresolvable timezone: fail toward "not provisional" rather
    // than silently masking every row as today.
    return "";
  }
}

export class GoogleAdsApiClient implements ReadOnlyAdsConnector {
  readonly providerId: string;
  readonly providerKind = "official-api" as const;
  readonly platform: Exclude<Platform, "all"> = "google";
  readonly mode = "live" as const;

  constructor(
    private readonly config: GoogleAdsApiConfiguration = {
      developerToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
      clientId: process.env.GOOGLE_ADS_CLIENT_ID,
      clientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET,
      refreshToken: process.env.GOOGLE_ADS_REFRESH_TOKEN,
      customerId: process.env.GOOGLE_ADS_CUSTOMER_ID,
      loginCustomerId: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
      apiVersion: process.env.GOOGLE_ADS_API_VERSION,
      registrationConversionActionId: process.env.GOOGLE_ADS_REGISTRATION_CONVERSION_ACTION_ID,
      purchaseConversionActionId: process.env.GOOGLE_ADS_PURCHASE_CONVERSION_ACTION_ID,
      expectedCurrency: process.env.GOOGLE_ADS_EXPECTED_CURRENCY as Currency | undefined,
      clientSlug: process.env.GOOGLE_ADS_CLIENT_SLUG,
      includeCampaignBreakdown:
        process.env.GOOGLE_ADS_INCLUDE_CAMPAIGN_BREAKDOWN !== "false",
      includeSearchTerms: process.env.GOOGLE_ADS_INCLUDE_SEARCH_TERMS !== "false",
      includeImpressionShare:
        process.env.GOOGLE_ADS_INCLUDE_IMPRESSION_SHARE !== "false",
      includeDeviceBreakdown:
        process.env.GOOGLE_ADS_INCLUDE_DEVICE_BREAKDOWN !== "false",
      includeEntityBreakdown:
        process.env.GOOGLE_ADS_INCLUDE_ENTITY_BREAKDOWN !== "false",
      includeGeoBreakdown:
        process.env.GOOGLE_ADS_INCLUDE_GEO_BREAKDOWN !== "false",
      includeAudienceBreakdown:
        process.env.GOOGLE_ADS_INCLUDE_AUDIENCE_BREAKDOWN !== "false",
    },
  ) {
    this.providerId = "google-ads-direct-api";
    this.app = {
      developerToken: config.developerToken,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      loginCustomerId: config.loginCustomerId,
    };
  }

  /**
   * Application credentials this client authenticates with. They start as the
   * configured values and are replaced, as one set, when the refresh token is
   * found on a stored row that carries its own set — the refresh token only
   * works with the OAuth client that minted it. `loadGoogleAdsConfig` already
   * resolves the saved set up front; this keeps a client built any other way
   * from pairing a stored grant with the wrong client.
   */
  private app: Pick<
    GoogleAdsApiConfiguration,
    "developerToken" | "clientId" | "clientSecret" | "loginCustomerId"
  >;

  private adoptStoredCredentials(stored: StoredGoogleAdsCredentials | null): void {
    if (!stored) return;
    this.app = {
      developerToken: stored.developerToken,
      clientId: stored.clientId,
      clientSecret: stored.clientSecret,
      loginCustomerId: stored.loginCustomerId ?? undefined,
    };
  }

  /**
   * Splits the two mapped values onto their own posts. An action that is not
   * mapped yields null ("not measured"), never 0, so a brand with no
   * registration action does not read as "$0 of lead value".
   */
  private valueSplit(orderValue: number, registrationValue: number): {
    orderConversionValue: number | null;
    registrationLeadValue: number | null;
  } {
    return {
      orderConversionValue: this.config.purchaseConversionActionId
        ? Number(orderValue.toFixed(2))
        : null,
      registrationLeadValue: this.config.registrationConversionActionId
        ? Number(registrationValue.toFixed(2))
        : null,
    };
  }

  private get apiVersion(): string {
    return this.config.apiVersion?.trim() || DEFAULT_API_VERSION;
  }

  private get clientSlug(): string {
    return this.config.clientSlug?.trim() || DEFAULT_CLIENT_SLUG;
  }

  /**
   * The refresh token this brand should authorise with, in priority order:
   * its own configured value, its own stored consent, then the consent held on
   * the manager account it is configured under.
   *
   * The manager step is what lets four brands run off one operator consent.
   * It shares authorisation, never data selection: `customerId` decides whose
   * account is read, is resolved per brand in `google-ads-config`, and two
   * brands claiming one customer id are already refused there. A brand with no
   * manager configured, or one whose manager holds no consent, gets an empty
   * string and fails closed at `hasCoreCredentials`.
   */
  private async resolveRefreshToken(): Promise<string> {
    if (this.config.refreshToken?.trim()) {
      return this.config.refreshToken.trim();
    }
    try {
      const { getConnectorToken, getManagerScopedCredentialRecord } = await import(
        "./token-storage"
      );
      const record = await getConnectorToken("google-ads", this.clientSlug);
      if (record?.refreshToken) {
        this.adoptStoredCredentials(readStoredGoogleAdsCredentials(record));
        return record.refreshToken;
      }

      const managerId = this.config.loginCustomerId?.trim();
      if (managerId) {
        // Same donor `getManagerScopedRefreshToken` returns, read with its
        // metadata so a saved client travels with the borrowed grant.
        const granted = await getManagerScopedCredentialRecord(
          "google-ads",
          managerId,
        );
        if (granted) {
          this.adoptStoredCredentials(readStoredGoogleAdsCredentials(granted));
          return granted.refreshToken;
        }
      }
    } catch {
      // Supabase or the storage layer is unavailable. Fall through to the empty
      // string so the caller fails closed on a missing credential instead of
      // surfacing a storage error that would read as a dead Google account.
    }
    return "";
  }

  private hasCoreCredentials(effectiveRefreshToken?: string): boolean {
    const token = effectiveRefreshToken ?? this.config.refreshToken;
    return Boolean(
      this.app.developerToken &&
        this.app.clientId &&
        this.app.clientSecret &&
        token &&
        this.config.customerId,
    );
  }

  /**
   * Short-lived access token for this connector, minted from the stored refresh
   * token. The exchange and its failure classification live in
   * `google-oauth-token` so every Google-family connector behaves identically.
   */
  private async getAccessToken(effectiveRefreshToken?: string): Promise<string> {
    const refreshToken = effectiveRefreshToken ?? (await this.resolveRefreshToken());
    return exchangeGoogleRefreshToken({
      clientId: this.app.clientId,
      clientSecret: this.app.clientSecret,
      refreshToken,
    });
  }

  private async gaqlSearch(accessToken: string, query: string): Promise<GoogleAdsSearchRow[]> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "developer-token": this.app.developerToken ?? "",
    };
    if (this.app.loginCustomerId) {
      headers["login-customer-id"] = this.app.loginCustomerId;
    }

    const rows: GoogleAdsSearchRow[] = [];
    let pageToken: string | undefined;

    do {
      const body = await this.gaqlSearchPage(headers, query, pageToken);
      rows.push(...(body.results ?? []));
      pageToken = body.nextPageToken;
    } while (pageToken);

    return rows;
  }

  /**
   * One page of a GAQL query, retrying only what Google says is worth retrying.
   *
   * 429 and 5xx are transient by definition, so they are slept off and tried
   * again. Everything else — a malformed query, a revoked credential, a
   * customer id this login cannot see — will fail identically on a second
   * attempt, so it is raised at once instead of being retried three times into
   * the same wall. Nothing here retries a write; this connector issues none.
   */
  private async gaqlSearchPage(
    headers: Record<string, string>,
    query: string,
    pageToken: string | undefined,
  ): Promise<GoogleAdsSearchResponse> {
    for (let attempt = 0; ; attempt += 1) {
      const canRetry = attempt < GAQL_MAX_RETRIES;
      let response: Response;

      try {
        response = await fetch(
          `${GOOGLE_ADS_API_BASE}/${this.apiVersion}/customers/${this.config.customerId}/googleAds:search`,
          {
            method: "POST",
            headers,
            // `pageSize` must not be sent. From v22 the API rejects it
            // outright with PAGE_SIZE_NOT_SUPPORTED and a fixed 10,000-row
            // page is used instead. `pageToken` is dropped by JSON.stringify
            // while it is undefined, so the first request carries neither.
            body: JSON.stringify({ query, pageToken }),
          },
        );
      } catch (err) {
        if (canRetry) {
          await sleep(gaqlRetryDelayMs(null, attempt));
          continue;
        }
        const message = err instanceof Error ? err.message : "Network error";
        throw new ConnectorFailure("unavailable", `Google Ads API unreachable: ${message}`, true);
      }

      if (response.ok) {
        return (await response.json()) as GoogleAdsSearchResponse;
      }

      const transient = response.status === 429 || response.status >= 500;
      if (transient && canRetry) {
        await sleep(gaqlRetryDelayMs(response, attempt));
        continue;
      }

      const detail = await response.text().catch(() => "");
      // 429 is transient and must stay retryable; the previous rule marked
      // anything under 500 non-retryable, so a quota blip looked permanent.
      if (response.status === 429) {
        throw new ConnectorFailure(
          "rate-limited",
          `Google Ads API throttled the request (429) after ${GAQL_MAX_RETRIES} retries: ${detail.slice(0, 300)}`,
          true,
        );
      }
      const unauthenticated = response.status === 401 || response.status === 403;
      throw new ConnectorFailure(
        unauthenticated ? "unauthenticated" : "invalid-response",
        `Google Ads API query failed (${response.status}): ${detail.slice(0, 300)}`,
        response.status >= 500,
      );
    }
  }

  /**
   * Health does a real, bounded, read-only call rather than trusting that
   * non-empty env vars mean the credential actually works — the prior
   * scaffold made that mistake and reported `authenticated: true` for
   * expired or malformed tokens.
   */
  async health(): Promise<ConnectorHealth> {
    const effectiveRefreshToken = await this.resolveRefreshToken();
    if (!this.hasCoreCredentials(effectiveRefreshToken)) {
      return {
        providerId: this.providerId,
        providerKind: this.providerKind,
        available: false,
        authenticated: false,
        readOnly: true,
        safeMessage: "Google Ads Direct API credentials not configured in environment or database.",
      };
    }

    try {
      const accessToken = await this.getAccessToken(effectiveRefreshToken);
      const rows = await this.gaqlSearch(
        accessToken,
        "SELECT customer.id, customer.descriptive_name FROM customer LIMIT 1",
      );
      const name = field(rows[0]?.customer, "descriptiveName", "descriptive_name");
      return {
        providerId: this.providerId,
        providerKind: this.providerKind,
        available: true,
        authenticated: true,
        readOnly: true,
        safeMessage: name
          ? `Authenticated for customer ${this.config.customerId} (${String(name)}).`
          : `Authenticated for customer ${this.config.customerId}.`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown Google Ads authentication error.";
      return {
        providerId: this.providerId,
        providerKind: this.providerKind,
        available: true,
        authenticated: false,
        readOnly: true,
        safeMessage: `Credentials present but authentication failed: ${message}`,
      };
    }
  }


  /**
   * Reads every conversion action the account defines. Read-only and bounded:
   * `conversion_action` is a configuration resource, so this costs one page and
   * never touches metrics.
   */
  async listConversionActions(accessToken?: string): Promise<GoogleConversionAction[]> {
    const token = accessToken ?? (await this.getAccessToken(await this.resolveRefreshToken()));
    const rows = await this.gaqlSearch(
      token,
      [
        "SELECT conversion_action.id, conversion_action.name,",
        "conversion_action.category, conversion_action.type,",
        "conversion_action.status, conversion_action.include_in_conversions_metric",
        "FROM conversion_action",
      ].join(" "),
    );

    return rows.map((row) => {
      const holder = row as {
        conversionAction?: Record<string, unknown>;
        conversion_action?: Record<string, unknown>;
      };
      const source = holder.conversionAction ?? holder.conversion_action ?? {};
      const id = String(field(source, "id", "id") ?? "");
      return {
        id,
        resourceName: `customers/${this.config.customerId}/conversionActions/${id}`,
        name: String(field(source, "name", "name") ?? ""),
        category: String(field(source, "category", "category") ?? ""),
        type: String(field(source, "type", "type") ?? ""),
        status: String(field(source, "status", "status") ?? ""),
        includedInConversionsMetric: Boolean(
          field(source, "includeInConversionsMetric", "include_in_conversions_metric"),
        ),
      };
    });
  }

  /**
   * Proves that the two configured IDs really are this account's registration
   * and purchase actions before any spend or revenue is published. A mapping
   * that points at an engagement action (Time on Site, Page View, Add to Cart)
   * is rejected, not warned about: that exact mistake can leave
   * an account's conversion history unusable for months.
   */
  async verifyConversionActionMapping(
    accessToken?: string,
  ): Promise<ConversionActionMappingReport> {
    const customerId = this.config.customerId ?? "";
    const problems: string[] = [];
    const allActions = await this.listConversionActions(accessToken);
    const byId = new Map(allActions.map((action) => [action.id, action]));

    // Older brand deployments did not persist per-account action IDs. Recover
    // only when Google's own semantic contract leaves exactly one candidate.
    // CONTACT/SUBMIT_LEAD_FORM are deliberately excluded from registration
    // auto-resolution: a store may use several lead forms for different goals,
    // while SIGNUP is the event this dashboard labels as Registration.
    if (!this.config.registrationConversionActionId) {
      const registrations = allActions.filter(
        (action) => action.status === "ENABLED" && action.category === "SIGNUP",
      );
      if (registrations.length === 1) {
        this.config.registrationConversionActionId = registrations[0]?.id;
        problems.push(
          "Registration mapping recovered from the account's only enabled SIGNUP action.",
        );
      }
    }
    if (!this.config.purchaseConversionActionId) {
      const purchases = allActions.filter(
        (action) =>
          action.status === "ENABLED" &&
          action.category === "PURCHASE" &&
          action.includedInConversionsMetric,
      );
      if (purchases.length === 1) {
        this.config.purchaseConversionActionId = purchases[0]?.id;
        problems.push(
          "Purchase mapping recovered from the account's only enabled primary PURCHASE action.",
        );
      }
    }

    const contaminatedCandidates = allActions.filter(
      (action) =>
        action.status === "ENABLED" && CONTAMINATED_CATEGORIES.has(action.category),
    );

    const check = (
      configuredId: string | undefined,
      label: "registration" | "purchase",
      allowed: Set<string>,
    ): GoogleConversionAction | undefined => {
      if (!configuredId) {
        problems.push(
          `No ${label} conversion action is configured. The connector reports 0 ${label}s rather than guessing one.`,
        );
        return undefined;
      }
      const action = byId.get(configuredId);
      if (!action) {
        problems.push(
          `Configured ${label} conversion action ${configuredId} does not exist in customer ${customerId}.`,
        );
        return undefined;
      }
      if (CONTAMINATED_CATEGORIES.has(action.category)) {
        problems.push(
          `Configured ${label} conversion action ${configuredId} ("${action.name}") has category ${action.category}, which measures engagement rather than an acquisition. Refusing to report it as a ${label}.`,
        );
        return action;
      }
      if (!allowed.has(action.category)) {
        problems.push(
          `Configured ${label} conversion action ${configuredId} ("${action.name}") has category ${action.category}, which is not a recognised ${label} category.`,
        );
        return action;
      }
      if (action.status !== "ENABLED") {
        problems.push(
          `Configured ${label} conversion action ${configuredId} ("${action.name}") is ${action.status}, not ENABLED. Historical rows may still exist but new days will read 0.`,
        );
      }
      return action;
    };

    const registration = check(
      this.config.registrationConversionActionId,
      "registration",
      REGISTRATION_CATEGORIES,
    );
    const purchase = check(
      this.config.purchaseConversionActionId,
      "purchase",
      PURCHASE_CATEGORIES,
    );

    const blocking = problems.some(
      (problem) => problem.includes("Refusing") || problem.includes("does not exist"),
    );

    return {
      ok: !blocking,
      customerId,
      ...(registration ? { registration } : {}),
      ...(purchase ? { purchase } : {}),
      problems,
      contaminatedCandidates,
      allActions,
    };
  }

  /**
   * Per-campaign spend, traffic, and mapped conversions for the same range.
   * Persisted at `entity_level = 'campaign'`; the account totals stay the
   * single source for KPIs so the two levels can never be summed together.
   */
  private async fetchCampaignRows(
    accessToken: string,
    request: ConnectorRequest,
    currency: Currency,
    accountTimezone: string,
    todayIso: string,
    syncedAt: string,
    warnings: string[],
  ): Promise<{ rows: DailyMetric[]; campaigns: AdCampaignRecord[] }> {
    const coreRows = await this.gaqlSearch(
      accessToken,
      [
        "SELECT segments.date, campaign.id, campaign.name,",
        "campaign.advertising_channel_type, campaign.advertising_channel_sub_type, campaign.status,",
        "metrics.impressions, metrics.clicks, metrics.cost_micros",
        "FROM campaign",
        `WHERE segments.date BETWEEN '${request.range.start}' AND '${request.range.end}'`,
      ].join(" "),
    );

    interface CampaignBucket {
      date: string;
      campaignId: string;
      campaignName: string;
      channelType: string;
      impressions: number;
      clicks: number;
      spend: number;
      registrations: number;
      purchases: number;
      purchaseValue: number;
      registrationValue: number;
      share: ImpressionShareReading;
    }

    const buckets = new Map<string, CampaignBucket>();
    const keyOf = (date: string, campaignId: string) => `${date}|${campaignId}`;
    const sourceQueryVersion = `google-ads-api-${this.apiVersion}`;
    const campaigns = new Map<string, AdCampaignRecord>();

    for (const row of coreRows) {
      const date = String(field(row.segments, "date", "date") ?? "");
      const campaign = (row as { campaign?: Record<string, unknown> }).campaign;
      const campaignId = String(field(campaign, "id", "id") ?? "");
      if (!date || !campaignId) continue;

      if (!campaigns.has(campaignId)) {
        const subType = field(campaign, "advertisingChannelSubType", "advertising_channel_sub_type");
        campaigns.set(campaignId, {
          platform: "google",
          campaignKey: campaignId,
          campaignName: String(field(campaign, "name", "name") ?? ""),
          channelType: String(
            field(campaign, "advertisingChannelType", "advertising_channel_type") ?? "UNSPECIFIED",
          ),
          channelSubType: subType ? String(subType) : null,
          status: String(field(campaign, "status", "status") ?? "UNSPECIFIED"),
          sourceQueryVersion,
          syncedAt,
        });
      }

      buckets.set(keyOf(date, campaignId), {
        date,
        campaignId,
        campaignName: String(field(campaign, "name", "name") ?? ""),
        channelType: String(
          field(campaign, "advertisingChannelType", "advertising_channel_type") ?? "",
        ),
        impressions: toNumber(field(row.metrics, "impressions", "impressions")),
        clicks: toNumber(field(row.metrics, "clicks", "clicks")),
        spend: Number(
          (toNumber(field(row.metrics, "costMicros", "cost_micros")) / 1_000_000).toFixed(2),
        ),
        registrations: 0,
        purchases: 0,
        purchaseValue: 0,
        registrationValue: 0,
        share: {},
      });
    }

    const actionResources = [
      this.config.registrationConversionActionId,
      this.config.purchaseConversionActionId,
    ]
      .filter((id): id is string => Boolean(id))
      .map((id) => `'customers/${this.config.customerId}/conversionActions/${id}'`);

    if (actionResources.length > 0 && buckets.size > 0) {
      const conversionRows = await this.gaqlSearch(
        accessToken,
        [
          "SELECT segments.date, campaign.id, segments.conversion_action,",
          "metrics.all_conversions, metrics.all_conversions_value",
          "FROM campaign",
          `WHERE segments.date BETWEEN '${request.range.start}' AND '${request.range.end}'`,
          `AND segments.conversion_action IN (${actionResources.join(", ")})`,
        ].join(" "),
      );

      for (const row of conversionRows) {
        const date = String(field(row.segments, "date", "date") ?? "");
        const campaign = (row as { campaign?: Record<string, unknown> }).campaign;
        const campaignId = String(field(campaign, "id", "id") ?? "");
        const bucket = buckets.get(keyOf(date, campaignId));
        if (!bucket) continue;

        const actionResource = String(
          field(row.segments, "conversionAction", "conversion_action") ?? "",
        );
        const allConversions = toNumber(field(row.metrics, "allConversions", "all_conversions"));
        const allConversionsValue = toNumber(
          field(row.metrics, "allConversionsValue", "all_conversions_value"),
        );

        if (
          this.config.registrationConversionActionId &&
          actionResource.endsWith(`/${this.config.registrationConversionActionId}`)
        ) {
          bucket.registrations += allConversions;
          bucket.registrationValue += allConversionsValue;
        } else if (
          this.config.purchaseConversionActionId &&
          actionResource.endsWith(`/${this.config.purchaseConversionActionId}`)
        ) {
          bucket.purchases += allConversions;
          bucket.purchaseValue += allConversionsValue;
        }
      }
    }

    // Impression share is a separate request so a rejection cannot take the
    // spend rows down with it. Only campaigns that serve on Search, and only
    // days they had impressions, keep a share; everything else stays unset.
    if (this.config.includeImpressionShare && buckets.size > 0) {
      const channelList = [...SEARCH_SHARE_CHANNEL_TYPES]
        .map((type) => `'${type}'`)
        .join(", ");
      try {
        const shareRows = await this.gaqlSearch(
          accessToken,
          [
            `SELECT segments.date, campaign.id, metrics.impressions, ${IMPRESSION_SHARE_METRICS}`,
            "FROM campaign",
            `WHERE segments.date BETWEEN '${request.range.start}' AND '${request.range.end}'`,
            `AND campaign.advertising_channel_type IN (${channelList})`,
            "AND metrics.impressions > 0",
          ].join(" "),
        );
        for (const row of shareRows) {
          const date = String(field(row.segments, "date", "date") ?? "");
          const campaign = (row as { campaign?: Record<string, unknown> }).campaign;
          const bucket = buckets.get(keyOf(date, String(field(campaign, "id", "id") ?? "")));
          if (!bucket || bucket.impressions === 0) continue;
          if (!SEARCH_SHARE_CHANNEL_TYPES.has(bucket.channelType)) continue;
          bucket.share = readImpressionShare(row.metrics);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error.";
        warnings.push(
          `Campaign impression share could not be pulled, so it is stored as not reported. Spend and conversions are unaffected. ${message}`,
        );
      }
    }

    const rows = [...buckets.values()]
      .map((bucket): DailyMetric => {
        const purchaseValue = Number(bucket.purchaseValue.toFixed(2));
        return {
          date: bucket.date,
          clientId: request.clientId,
          accountId: this.config.customerId ?? "",
          platform: "google",
          currency,
          accountTimezone,
          spend: bucket.spend,
          impressions: bucket.impressions,
          clicks: bucket.clicks,
          // Consideration actions are pulled at account level only, so the
          // campaign breakdown reports them as not measured rather than as
          // zero. These rows are stored at `entity_level = 'campaign'` and
          // never feed a KPI, so nothing downstream reads a false floor here.
          landingPageViews: null,
          engagedVisits: null,
          addToBaskets: null,
          registrations: bucket.registrations,
          purchases: bucket.purchases,
          platformConversionValue: purchaseValue,
          actualPurchaseRevenue: purchaseValue,
          ...this.valueSplit(bucket.purchaseValue, bucket.registrationValue),
          ...bucket.share,
          sourceConnector: "google-direct-api",
          sourceQueryVersion: `google-ads-api-${this.apiVersion}`,
          syncedAt,
          isProvisional: todayIso !== "" && bucket.date >= todayIso,
          entityLevel: "campaign",
          entityKey: bucket.campaignId,
          entityName: bucket.campaignName,
        };
      })
      .sort((left, right) =>
        left.date === right.date
          ? (left.entityKey ?? "").localeCompare(right.entityKey ?? "")
          : left.date.localeCompare(right.date),
      );

    return {
      rows,
      campaigns: [...campaigns.values()].toSorted((left, right) =>
        left.campaignKey.localeCompare(right.campaignKey),
      ),
    };
  }

  /**
   * Search queries for the range, from `search_term_view`, one row per day per
   * ad group per query per matched keyword.
   *
   * Two known gaps, both disclosed rather than hidden: selecting the matched
   * keyword drops Dynamic Search Ads queries from the result, and Google
   * withholds low-volume queries entirely. These rows therefore never
   * reconcile to campaign spend, and that difference is not waste.
   */
  private async fetchSearchTermRows(
    accessToken: string,
    request: ConnectorRequest,
    currency: Currency,
    accountTimezone: string,
    todayIso: string,
    syncedAt: string,
    warnings: string[],
  ): Promise<SearchTermDailyRecord[]> {
    const dimensions = [
      "segments.date",
      "campaign.id",
      "ad_group.id",
      "search_term_view.search_term",
      "segments.search_term_match_type",
      "segments.keyword.info.text",
      "segments.keyword.info.match_type",
    ].join(", ");
    const dateFilter = `WHERE segments.date BETWEEN '${request.range.start}' AND '${request.range.end}'`;
    const sourceQueryVersion = `google-ads-api-${this.apiVersion}`;

    const coreRows = await this.gaqlSearch(
      accessToken,
      `SELECT ${dimensions}, metrics.impressions, metrics.clicks, metrics.cost_micros FROM search_term_view ${dateFilter} AND metrics.impressions > 0`,
    );

    const buckets = new Map<string, SearchTermDailyRecord>();
    for (const row of coreRows) {
      const identity = readSearchTermIdentity(row);
      if (!identity) continue;

      const impressions = toNumber(field(row.metrics, "impressions", "impressions"));
      const clicks = toNumber(field(row.metrics, "clicks", "clicks"));
      const spend = toNumber(field(row.metrics, "costMicros", "cost_micros")) / 1_000_000;
      const key = searchTermKey(identity);
      const existing = buckets.get(key);

      if (existing) {
        existing.impressions += impressions;
        existing.clicks += clicks;
        existing.spend = Number((existing.spend + spend).toFixed(2));
        continue;
      }

      buckets.set(key, {
        ...identity,
        currency,
        accountTimezone,
        spend: Number(spend.toFixed(2)),
        impressions,
        clicks,
        // Null until a conversion pull fills them: "not measured" is not zero.
        registrations: null,
        purchases: null,
        purchaseValue: null,
        sourceQueryVersion,
        syncedAt,
        isProvisional: todayIso !== "" && identity.date >= todayIso,
      });
    }

    const registrationId = this.config.registrationConversionActionId;
    const purchaseId = this.config.purchaseConversionActionId;
    const actionResources = [registrationId, purchaseId]
      .filter((id): id is string => Boolean(id))
      .map((id) => `'customers/${this.config.customerId}/conversionActions/${id}'`);

    if (buckets.size > 0 && actionResources.length > 0) {
      try {
        const conversionRows = await this.gaqlSearch(
          accessToken,
          `SELECT ${dimensions}, segments.conversion_action, metrics.all_conversions, metrics.all_conversions_value FROM search_term_view ${dateFilter} AND segments.conversion_action IN (${actionResources.join(", ")})`,
        );

        for (const bucket of buckets.values()) {
          bucket.registrations = registrationId ? 0 : null;
          bucket.purchases = purchaseId ? 0 : null;
          bucket.purchaseValue = purchaseId ? 0 : null;
        }

        for (const row of conversionRows) {
          const identity = readSearchTermIdentity(row);
          const bucket = identity ? buckets.get(searchTermKey(identity)) : undefined;
          if (!bucket) continue;

          const actionResource = String(
            field(row.segments, "conversionAction", "conversion_action") ?? "",
          );
          const allConversions = toNumber(field(row.metrics, "allConversions", "all_conversions"));
          const allConversionsValue = toNumber(
            field(row.metrics, "allConversionsValue", "all_conversions_value"),
          );

          if (registrationId && actionResource.endsWith(`/${registrationId}`)) {
            bucket.registrations = (bucket.registrations ?? 0) + allConversions;
          } else if (purchaseId && actionResource.endsWith(`/${purchaseId}`)) {
            bucket.purchases = (bucket.purchases ?? 0) + allConversions;
            bucket.purchaseValue = Number(
              ((bucket.purchaseValue ?? 0) + allConversionsValue).toFixed(2),
            );
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error.";
        warnings.push(
          `Search term conversions could not be pulled, so they are stored as not measured rather than zero. ${message}`,
        );
      }
    }

    warnings.push(
      "Search term rows exclude Dynamic Search Ads queries and the queries Google withholds below its privacy threshold, so they do not add up to campaign spend.",
    );

    return [...buckets.values()].toSorted((left, right) =>
      left.date === right.date ? right.spend - left.spend : left.date.localeCompare(right.date),
    );
  }

  /**
   * Spend, traffic, and mapped conversions per campaign per device per day.
   *
   * `segments.device` is stored verbatim (CONNECTED_TV included — it is where
   * Performance Max spends without clicks). Conversions come from a second
   * request; if it fails, they are stored as not measured, never as zero.
   */
  /**
   * Asks Google for impression share over the whole period in one question.
   *
   * The daily query and this one look almost identical, and the difference is
   * the entire point: `segments.date` is deliberately absent, so Google
   * aggregates over the range with its own denominator instead of handing back
   * days that this code would have to average. Averaging is what breaks, and it
   * breaks quietly — Google masks any share under 10% as 0.0999, and a period
   * made of mostly-masked days lands a percentage point or two away from the
   * truth on rank and seventeen points away on budget.
   *
   * Two scopes are pulled, because they answer different questions: `customer`
   * is Google's own roll-up across search-eligible traffic, and `campaign` is
   * one campaign's share. The account figure is not the mean of the campaign
   * figures and must never be reconstructed from them.
   *
   * Campaign scope is restricted to channel types that can serve on Search.
   * Google answers the same metric with 0 for a Display campaign, and storing
   * that would publish "0% share" for a campaign that was never in a search
   * auction.
   */
  private async fetchPeriodImpressionShare(
    accessToken: string,
    request: ConnectorRequest,
    syncedAt: string,
    warnings: string[],
  ): Promise<ImpressionSharePeriodRecord[]> {
    const sourceQueryVersion = `google-ads-api-${this.apiVersion}`;
    const range = request.impressionShareRange ?? request.range;
    const dateFilter = `WHERE segments.date BETWEEN '${range.start}' AND '${range.end}'`;
    const records: ImpressionSharePeriodRecord[] = [];

    const toRecord = (
      scope: ImpressionSharePeriodRecord["scope"],
      campaignKey: string,
      metrics: Record<string, unknown> | undefined,
    ): ImpressionSharePeriodRecord => {
      const reading = readImpressionShare(metrics);
      return {
        rangeStart: range.start,
        rangeEnd: range.end,
        scope,
        campaignKey,
        impressions: toNumber(field(metrics, "impressions", "impressions")),
        // `?? null` and not `?? 0`: an absent share is "Google did not report
        // it", which is not the same claim as "the share was zero".
        searchImpressionShare: reading.searchImpressionShare ?? null,
        searchBudgetLostImpressionShare: reading.impressionShareLostToBudget ?? null,
        searchRankLostImpressionShare: reading.impressionShareLostToRank ?? null,
        sourceQueryVersion,
        syncedAt,
      };
    };

    try {
      const accountRows = await this.gaqlSearch(
        accessToken,
        [
          `SELECT metrics.impressions, ${IMPRESSION_SHARE_METRICS}`,
          "FROM customer",
          dateFilter,
        ].join(" "),
      );
      for (const row of accountRows) {
        records.push(toRecord("account", "", row.metrics));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      warnings.push(
        `Period-level account impression share could not be pulled, so the auction diagnostic stays on derived daily values. Spend and conversions are unaffected. ${message}`,
      );
    }

    try {
      const channelList = [...SEARCH_SHARE_CHANNEL_TYPES]
        .map((type) => `'${type}'`)
        .join(", ");
      const campaignRows = await this.gaqlSearch(
        accessToken,
        [
          `SELECT campaign.id, metrics.impressions, ${IMPRESSION_SHARE_METRICS}`,
          "FROM campaign",
          dateFilter,
          `AND campaign.advertising_channel_type IN (${channelList})`,
          "AND metrics.impressions > 0",
        ].join(" "),
      );
      for (const row of campaignRows) {
        const campaign = (row as { campaign?: Record<string, unknown> }).campaign;
        const campaignKey = String(field(campaign, "id", "id") ?? "");
        if (!campaignKey) continue;
        records.push(toRecord("campaign", campaignKey, row.metrics));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      warnings.push(
        `Period-level campaign impression share could not be pulled, so per-campaign auction diagnostics stay on derived daily values. Spend and conversions are unaffected. ${message}`,
      );
    }

    return records;
  }

  private async fetchDeviceRows(
    accessToken: string,
    request: ConnectorRequest,
    currency: Currency,
    accountTimezone: string,
    todayIso: string,
    syncedAt: string,
    warnings: string[],
  ): Promise<DeviceDailyRecord[]> {
    const dateFilter = `WHERE segments.date BETWEEN '${request.range.start}' AND '${request.range.end}'`;
    const sourceQueryVersion = `google-ads-api-${this.apiVersion}`;
    const coreRows = await this.gaqlSearch(
      accessToken,
      `SELECT segments.date, campaign.id, segments.device, metrics.impressions, metrics.clicks, metrics.cost_micros FROM campaign ${dateFilter} AND metrics.impressions > 0`,
    );

    interface DeviceBucket extends DeviceDailyRecord {
      purchaseValue: number;
      registrationValue: number;
    }
    const keyOf = (date: string, campaignKey: string, device: string) =>
      `${date}|${campaignKey}|${device}`;
    const buckets = new Map<string, DeviceBucket>();

    for (const row of coreRows) {
      const date = String(field(row.segments, "date", "date") ?? "");
      const campaign = (row as { campaign?: Record<string, unknown> }).campaign;
      const campaignKey = String(field(campaign, "id", "id") ?? "");
      const device = String(field(row.segments, "device", "device") ?? "").trim();
      if (!date || !campaignKey || !device) continue;

      const impressions = toNumber(field(row.metrics, "impressions", "impressions"));
      const clicks = toNumber(field(row.metrics, "clicks", "clicks"));
      const spend = toNumber(field(row.metrics, "costMicros", "cost_micros")) / 1_000_000;
      const key = keyOf(date, campaignKey, device);
      const existing = buckets.get(key);

      if (existing) {
        existing.impressions += impressions;
        existing.clicks += clicks;
        existing.spend += spend;
        continue;
      }

      buckets.set(key, {
        date,
        campaignKey,
        device,
        currency,
        accountTimezone,
        spend,
        impressions,
        clicks,
        registrations: null,
        purchases: null,
        orderConversionValue: null,
        registrationLeadValue: null,
        purchaseValue: 0,
        registrationValue: 0,
        sourceQueryVersion,
        syncedAt,
        isProvisional: todayIso !== "" && date >= todayIso,
      });
    }

    const registrationId = this.config.registrationConversionActionId;
    const purchaseId = this.config.purchaseConversionActionId;
    const actionResources = [registrationId, purchaseId]
      .filter((id): id is string => Boolean(id))
      .map((id) => `'customers/${this.config.customerId}/conversionActions/${id}'`);

    if (buckets.size > 0 && actionResources.length > 0) {
      try {
        const conversionRows = await this.gaqlSearch(
          accessToken,
          `SELECT segments.date, campaign.id, segments.device, segments.conversion_action, metrics.all_conversions, metrics.all_conversions_value FROM campaign ${dateFilter} AND segments.conversion_action IN (${actionResources.join(", ")})`,
        );

        for (const bucket of buckets.values()) {
          bucket.registrations = registrationId ? 0 : null;
          bucket.purchases = purchaseId ? 0 : null;
        }

        for (const row of conversionRows) {
          const date = String(field(row.segments, "date", "date") ?? "");
          const campaign = (row as { campaign?: Record<string, unknown> }).campaign;
          const bucket = buckets.get(
            keyOf(
              date,
              String(field(campaign, "id", "id") ?? ""),
              String(field(row.segments, "device", "device") ?? "").trim(),
            ),
          );
          if (!bucket) continue;

          const actionResource = String(
            field(row.segments, "conversionAction", "conversion_action") ?? "",
          );
          const allConversions = toNumber(field(row.metrics, "allConversions", "all_conversions"));
          const allConversionsValue = toNumber(
            field(row.metrics, "allConversionsValue", "all_conversions_value"),
          );

          if (registrationId && actionResource.endsWith(`/${registrationId}`)) {
            bucket.registrations = (bucket.registrations ?? 0) + allConversions;
            bucket.registrationValue += allConversionsValue;
          } else if (purchaseId && actionResource.endsWith(`/${purchaseId}`)) {
            bucket.purchases = (bucket.purchases ?? 0) + allConversions;
            bucket.purchaseValue += allConversionsValue;
          }
        }

        for (const bucket of buckets.values()) {
          Object.assign(bucket, this.valueSplit(bucket.purchaseValue, bucket.registrationValue));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error.";
        warnings.push(
          `Device conversions could not be pulled, so they are stored as not measured rather than zero. ${message}`,
        );
      }
    }

    return [...buckets.values()]
      .map(
        (bucket): DeviceDailyRecord => ({
          date: bucket.date,
          campaignKey: bucket.campaignKey,
          device: bucket.device,
          currency: bucket.currency,
          accountTimezone: bucket.accountTimezone,
          spend: Number(bucket.spend.toFixed(2)),
          impressions: bucket.impressions,
          clicks: bucket.clicks,
          registrations: bucket.registrations,
          purchases: bucket.purchases,
          orderConversionValue: bucket.orderConversionValue,
          registrationLeadValue: bucket.registrationLeadValue,
          sourceQueryVersion: bucket.sourceQueryVersion,
          syncedAt: bucket.syncedAt,
          isProvisional: bucket.isProvisional,
        }),
      )
      .toSorted((left, right) =>
        left.date === right.date
          ? `${left.campaignKey}|${left.device}`.localeCompare(
              `${right.campaignKey}|${right.device}`,
            )
          : left.date.localeCompare(right.date),
      );
  }

  /**
   * The shared shape of every segmented pull below.
   *
   * Each one asks Google the same two questions: spend and traffic at some
   * grain, then the conversions for that grain limited to the actions this
   * dashboard counts as orders and registrations. Writing it once is what makes
   * the rule that matters most hold identically for ad groups, locations and
   * audiences: a conversion column stays null until a conversion query actually
   * answered, so "not measured" can never be read as zero.
   */
  private async fetchSegmentedRows<Identity>(options: {
    accessToken: string;
    resource: string;
    /** Select list for the grain, without metrics. */
    dimensions: string;
    dateFilter: string;
    identify: (row: GoogleAdsSearchRow) => { date: string; identity: Identity } | null;
    keyOf: (date: string, identity: Identity) => string;
    /**
     * True for a resource Google will not segment by conversion action, such as
     * `asset_group`. Its conversions then come from the core query as Google's
     * own mixed total, and the row says so through `conversionActionFiltered`.
     */
    unfilteredConversions?: boolean;
    /** Sentence-leading noun for warnings, e.g. "Ad group". */
    label: string;
    warnings: string[];
  }): Promise<SegmentedRow<Identity>[]> {
    const { accessToken, resource, dimensions, dateFilter, identify, keyOf, label, warnings } =
      options;
    const unfiltered = options.unfilteredConversions === true;

    const coreMetrics = unfiltered
      ? "metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value"
      : "metrics.impressions, metrics.clicks, metrics.cost_micros";

    const coreRows = await this.gaqlSearch(
      accessToken,
      `SELECT ${dimensions}, ${coreMetrics} FROM ${resource} ${dateFilter} AND metrics.impressions > 0`,
    );

    const buckets = new Map<string, SegmentedBucket<Identity>>();
    for (const row of coreRows) {
      const found = identify(row);
      if (!found) continue;

      const impressions = toNumber(field(row.metrics, "impressions", "impressions"));
      const clicks = toNumber(field(row.metrics, "clicks", "clicks"));
      const spend = toNumber(field(row.metrics, "costMicros", "cost_micros")) / 1_000_000;
      const conversions = unfiltered
        ? toNumber(field(row.metrics, "conversions", "conversions"))
        : 0;
      const conversionsValue = unfiltered
        ? toNumber(field(row.metrics, "conversionsValue", "conversions_value"))
        : 0;

      const key = keyOf(found.date, found.identity);
      const existing = buckets.get(key);
      if (existing) {
        existing.impressions += impressions;
        existing.clicks += clicks;
        existing.spend += spend;
        existing.orderValue += conversionsValue;
        if (unfiltered) existing.purchases = (existing.purchases ?? 0) + conversions;
        continue;
      }

      buckets.set(key, {
        date: found.date,
        identity: found.identity,
        spend,
        impressions,
        clicks,
        registrations: null,
        purchases: unfiltered ? conversions : null,
        orderValue: conversionsValue,
        registrationValue: 0,
        conversionActionFiltered: false,
      });
    }

    const registrationId = this.config.registrationConversionActionId;
    const purchaseId = this.config.purchaseConversionActionId;
    const actionResources = [registrationId, purchaseId]
      .filter((id): id is string => Boolean(id))
      .map((id) => `'customers/${this.config.customerId}/conversionActions/${id}'`);

    if (!unfiltered && buckets.size > 0 && actionResources.length > 0) {
      try {
        const conversionRows = await this.gaqlSearch(
          accessToken,
          `SELECT ${dimensions}, segments.conversion_action, metrics.all_conversions, metrics.all_conversions_value FROM ${resource} ${dateFilter} AND segments.conversion_action IN (${actionResources.join(", ")})`,
        );

        for (const bucket of buckets.values()) {
          bucket.registrations = registrationId ? 0 : null;
          bucket.purchases = purchaseId ? 0 : null;
          bucket.conversionActionFiltered = true;
        }

        for (const row of conversionRows) {
          const found = identify(row);
          const bucket = found ? buckets.get(keyOf(found.date, found.identity)) : undefined;
          if (!bucket) continue;

          const actionResource = String(
            field(row.segments, "conversionAction", "conversion_action") ?? "",
          );
          const allConversions = toNumber(field(row.metrics, "allConversions", "all_conversions"));
          const allConversionsValue = toNumber(
            field(row.metrics, "allConversionsValue", "all_conversions_value"),
          );

          if (registrationId && actionResource.endsWith(`/${registrationId}`)) {
            bucket.registrations = (bucket.registrations ?? 0) + allConversions;
            bucket.registrationValue += allConversionsValue;
          } else if (purchaseId && actionResource.endsWith(`/${purchaseId}`)) {
            bucket.purchases = (bucket.purchases ?? 0) + allConversions;
            bucket.orderValue += allConversionsValue;
          }
        }
      } catch (err) {
        // Half a conversion pull is worse than none: the grains that did arrive
        // would look complete next to the ones that did not. Everything goes
        // back to "not measured".
        const message = err instanceof Error ? err.message : "Unknown error.";
        warnings.push(
          `${label} conversions could not be pulled, so they are stored as not measured rather than zero. ${message}`,
        );
        for (const bucket of buckets.values()) {
          bucket.registrations = null;
          bucket.purchases = null;
          bucket.orderValue = 0;
          bucket.registrationValue = 0;
          bucket.conversionActionFiltered = false;
        }
      }
    }

    return [...buckets.values()].map((bucket) => {
      const split = this.valueSplit(bucket.orderValue, bucket.registrationValue);
      return {
        date: bucket.date,
        identity: bucket.identity,
        spend: Number(bucket.spend.toFixed(2)),
        impressions: bucket.impressions,
        clicks: bucket.clicks,
        registrations: bucket.registrations,
        purchases: bucket.purchases,
        // An unfiltered pull carries Google's own conversion value, which is not
        // one of the two mapped actions and so is not split between them.
        orderConversionValue: unfiltered
          ? Number(bucket.orderValue.toFixed(2))
          : bucket.conversionActionFiltered
            ? split.orderConversionValue
            : null,
        registrationLeadValue:
          unfiltered || !bucket.conversionActionFiltered ? null : split.registrationLeadValue,
        conversionActionFiltered: bucket.conversionActionFiltered,
      };
    });
  }

  /**
   * Ad groups and Performance Max asset groups for the range, in one list.
   *
   * They answer the same question at the same grain — how did one slice of a
   * campaign perform on one day — but not on the same basis: `ad_group` is
   * segmented down to the mapped conversion actions and `asset_group` cannot
   * be, so every row carries the flag saying which of the two it is.
   */
  private async fetchEntityRows(
    accessToken: string,
    request: ConnectorRequest,
    currency: Currency,
    accountTimezone: string,
    todayIso: string,
    syncedAt: string,
    campaigns: AdCampaignRecord[],
    warnings: string[],
  ): Promise<AdEntityDailyRecord[]> {
    const dateFilter = `WHERE segments.date BETWEEN '${request.range.start}' AND '${request.range.end}'`;
    const sourceQueryVersion = `google-ads-api-${this.apiVersion}`;

    interface EntityIdentity {
      campaignKey: string;
      entityKey: string;
      entityName: string;
      status: string;
    }

    const identifyFrom =
      (camel: "adGroup" | "assetGroup", snake: "ad_group" | "asset_group") =>
      (row: GoogleAdsSearchRow): { date: string; identity: EntityIdentity } | null => {
        const holder = row as GoogleAdsSearchRow & Record<string, unknown>;
        const date = String(field(row.segments, "date", "date") ?? "");
        const campaignKey = String(
          field(holder.campaign as Record<string, unknown> | undefined, "id", "id") ?? "",
        );
        const entity = (holder[camel] ?? holder[snake]) as Record<string, unknown> | undefined;
        const entityKey = String(field(entity, "id", "id") ?? "");
        if (!date || !campaignKey || !entityKey) return null;

        return {
          date,
          identity: {
            campaignKey,
            entityKey,
            entityName: String(field(entity, "name", "name") ?? ""),
            status: String(field(entity, "status", "status") ?? ""),
          },
        };
      };

    // The name and status ride along for storage only. The key is the id, so a
    // rename mid-period cannot split one entity into two rows.
    const keyOf = (date: string, identity: EntityIdentity) => `${date}|${identity.entityKey}`;

    const toRecord = (
      entityLevel: "ad_group" | "asset_group",
      row: SegmentedRow<EntityIdentity>,
    ): AdEntityDailyRecord => ({
      date: row.date,
      entityLevel,
      campaignKey: row.identity.campaignKey,
      entityKey: row.identity.entityKey,
      entityName: row.identity.entityName || null,
      status: row.identity.status || null,
      currency,
      accountTimezone,
      spend: row.spend,
      impressions: row.impressions,
      clicks: row.clicks,
      registrations: row.registrations,
      purchases: row.purchases,
      orderConversionValue: row.orderConversionValue,
      registrationLeadValue: row.registrationLeadValue,
      conversionActionFiltered: row.conversionActionFiltered,
      sourceQueryVersion,
      syncedAt,
      isProvisional: todayIso !== "" && row.date >= todayIso,
    });

    // A brand with no Performance Max pays for no asset group query, and a
    // PMax-only brand pays for no ad group query. With no campaign attributes
    // to read, both run: guessing "none" would silently drop real rows.
    const hasAttributes = campaigns.length > 0;
    const runsAdGroups =
      !hasAttributes || campaigns.some((campaign) => campaign.channelType !== "PERFORMANCE_MAX");
    const runsAssetGroups =
      !hasAttributes || campaigns.some((campaign) => campaign.channelType === "PERFORMANCE_MAX");

    const rows: AdEntityDailyRecord[] = [];

    if (runsAdGroups) {
      const adGroups = await this.fetchSegmentedRows<EntityIdentity>({
        accessToken,
        resource: "ad_group",
        dimensions: "segments.date, campaign.id, ad_group.id, ad_group.name, ad_group.status",
        dateFilter,
        identify: identifyFrom("adGroup", "ad_group"),
        keyOf,
        label: "Ad group",
        warnings,
      });
      rows.push(...adGroups.map((row) => toRecord("ad_group", row)));
    }

    if (runsAssetGroups) {
      const assetGroups = await this.fetchSegmentedRows<EntityIdentity>({
        accessToken,
        resource: "asset_group",
        dimensions:
          "segments.date, campaign.id, asset_group.id, asset_group.name, asset_group.status",
        dateFilter,
        identify: identifyFrom("assetGroup", "asset_group"),
        keyOf,
        unfilteredConversions: true,
        label: "Asset group",
        warnings,
      });
      rows.push(...assetGroups.map((row) => toRecord("asset_group", row)));
      if (assetGroups.length > 0) {
        warnings.push(
          "Performance Max asset group conversions are Google's own total: the API will not segment an asset group by conversion action. They are stored with conversion_action_filtered = false and must not be compared with the filtered ad group counts.",
        );
      }
    }

    return rows.toSorted((left, right) =>
      left.date === right.date
        ? `${left.entityLevel}|${left.entityKey}`.localeCompare(
            `${right.entityLevel}|${right.entityKey}`,
          )
        : left.date.localeCompare(right.date),
    );
  }

  /**
   * Country codes and region names for the criterion ids a location pull
   * returned. Bounded and non-blocking: a failure leaves the names null, which
   * the geo table allows, rather than losing the spend rows they describe.
   */
  private async resolveGeoTargetNames(
    accessToken: string,
    criterionIds: string[],
    warnings: string[],
  ): Promise<Map<string, { countryCode: string | null; name: string | null }>> {
    const resolved = new Map<string, { countryCode: string | null; name: string | null }>();
    const unique = [...new Set(criterionIds.filter((id) => id !== ""))];
    if (unique.length === 0) return resolved;

    if (unique.length > GEO_TARGET_LOOKUP_LIMIT) {
      warnings.push(
        `Location rows cover ${unique.length} geo targets, more than the ${GEO_TARGET_LOOKUP_LIMIT} this lookup resolves at once, so country codes and region names are stored as null rather than filled in for some rows only.`,
      );
      return resolved;
    }

    try {
      const rows = await this.gaqlSearch(
        accessToken,
        `SELECT geo_target_constant.id, geo_target_constant.name, geo_target_constant.country_code FROM geo_target_constant WHERE geo_target_constant.resource_name IN (${unique
          .map((id) => `'geoTargetConstants/${id}'`)
          .join(", ")})`,
      );

      for (const row of rows) {
        const holder = row as GoogleAdsSearchRow & Record<string, unknown>;
        const constant = (holder.geoTargetConstant ?? holder.geo_target_constant) as
          | Record<string, unknown>
          | undefined;
        const id = String(field(constant, "id", "id") ?? "");
        if (!id) continue;
        const countryCode = String(field(constant, "countryCode", "country_code") ?? "");
        const name = String(field(constant, "name", "name") ?? "");
        resolved.set(id, { countryCode: countryCode || null, name: name || null });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      warnings.push(
        `Geo target names could not be resolved, so country codes and region names are stored as null. The spend rows themselves are unaffected. ${message}`,
      );
    }

    return resolved;
  }

  /**
   * Performance by where the user physically was, at country and region grain.
   *
   * `user_location_view` rather than `geographic_view`: the second mixes
   * physical location with location of interest, and for brands selling across
   * borders averaging the two describes neither population.
   */
  private async fetchGeoRows(
    accessToken: string,
    request: ConnectorRequest,
    currency: Currency,
    accountTimezone: string,
    todayIso: string,
    syncedAt: string,
    warnings: string[],
  ): Promise<GeoDailyRecord[]> {
    const dateFilter = `WHERE segments.date BETWEEN '${request.range.start}' AND '${request.range.end}'`;
    const sourceQueryVersion = `google-ads-api-${this.apiVersion}`;

    interface GeoIdentity {
      campaignKey: string;
      countryCriterionId: string;
      regionCriterionId: string;
    }

    const segmented = await this.fetchSegmentedRows<GeoIdentity>({
      accessToken,
      resource: "user_location_view",
      dimensions:
        "segments.date, campaign.id, user_location_view.country_criterion_id, segments.geo_target_region",
      dateFilter,
      identify: (row) => {
        const holder = row as GoogleAdsSearchRow & Record<string, unknown>;
        const date = String(field(row.segments, "date", "date") ?? "");
        const campaignKey = String(
          field(holder.campaign as Record<string, unknown> | undefined, "id", "id") ?? "",
        );
        const view = (holder.userLocationView ?? holder.user_location_view) as
          | Record<string, unknown>
          | undefined;
        const countryCriterionId = String(
          field(view, "countryCriterionId", "country_criterion_id") ?? "",
        );
        if (!date || !campaignKey || !countryCriterionId) return null;

        return {
          date,
          identity: {
            campaignKey,
            countryCriterionId,
            // Empty string, not null: Google placing traffic to a country but
            // not a region is a real answer, and the grain key must stay whole.
            regionCriterionId: criterionIdFromResourceName(
              String(field(row.segments, "geoTargetRegion", "geo_target_region") ?? ""),
            ),
          },
        };
      },
      keyOf: (date, identity) =>
        `${date}|${identity.campaignKey}|${identity.countryCriterionId}|${identity.regionCriterionId}`,
      label: "Location",
      warnings,
    });

    const names = await this.resolveGeoTargetNames(
      accessToken,
      segmented.flatMap((row) => [row.identity.countryCriterionId, row.identity.regionCriterionId]),
      warnings,
    );

    return segmented
      .map(
        (row): GeoDailyRecord => ({
          date: row.date,
          campaignKey: row.identity.campaignKey,
          countryCriterionId: row.identity.countryCriterionId,
          regionCriterionId: row.identity.regionCriterionId,
          countryCode: names.get(row.identity.countryCriterionId)?.countryCode ?? null,
          regionName: names.get(row.identity.regionCriterionId)?.name ?? null,
          currency,
          accountTimezone,
          spend: row.spend,
          impressions: row.impressions,
          clicks: row.clicks,
          registrations: row.registrations,
          purchases: row.purchases,
          orderConversionValue: row.orderConversionValue,
          conversionActionFiltered: row.conversionActionFiltered,
          sourceQueryVersion,
          syncedAt,
          isProvisional: todayIso !== "" && row.date >= todayIso,
        }),
      )
      .toSorted((left, right) =>
        left.date === right.date ? right.spend - left.spend : left.date.localeCompare(right.date),
      );
  }

  /**
   * Audience segments at the grain Google reports them: the segment as attached
   * to one ad group. The same list in three ad groups stays three rows, because
   * summing them would count a user reached twice.
   */
  private async fetchAudienceRows(
    accessToken: string,
    request: ConnectorRequest,
    currency: Currency,
    accountTimezone: string,
    todayIso: string,
    syncedAt: string,
    warnings: string[],
  ): Promise<AudienceDailyRecord[]> {
    const dateFilter = `WHERE segments.date BETWEEN '${request.range.start}' AND '${request.range.end}'`;
    const sourceQueryVersion = `google-ads-api-${this.apiVersion}`;

    interface AudienceIdentity {
      campaignKey: string;
      adGroupKey: string;
      criterionId: string;
      criterionType: string;
      displayName: string;
    }

    const identify = (
      row: GoogleAdsSearchRow,
    ): { date: string; identity: AudienceIdentity } | null => {
      const holder = row as GoogleAdsSearchRow & Record<string, unknown>;
      const date = String(field(row.segments, "date", "date") ?? "");
      const campaignKey = String(
        field(holder.campaign as Record<string, unknown> | undefined, "id", "id") ?? "",
      );
      const adGroup = (holder.adGroup ?? holder.ad_group) as Record<string, unknown> | undefined;
      const adGroupKey = String(field(adGroup, "id", "id") ?? "");
      const criterion = (holder.adGroupCriterion ?? holder.ad_group_criterion) as
        | Record<string, unknown>
        | undefined;
      const criterionId = String(field(criterion, "criterionId", "criterion_id") ?? "");
      if (!date || !campaignKey || !adGroupKey || !criterionId) return null;

      return {
        date,
        identity: {
          campaignKey,
          adGroupKey,
          criterionId,
          criterionType: String(field(criterion, "type", "type") ?? ""),
          displayName: String(field(criterion, "displayName", "display_name") ?? ""),
        },
      };
    };

    const keyOf = (date: string, identity: AudienceIdentity) =>
      `${date}|${identity.adGroupKey}|${identity.criterionId}`;
    const baseDimensions =
      "segments.date, campaign.id, ad_group.id, ad_group_criterion.criterion_id, ad_group_criterion.type";

    let segmented: SegmentedRow<AudienceIdentity>[];
    try {
      segmented = await this.fetchSegmentedRows<AudienceIdentity>({
        accessToken,
        resource: "ad_group_audience_view",
        dimensions: `${baseDimensions}, ad_group_criterion.display_name`,
        dateFilter,
        identify,
        keyOf,
        label: "Audience",
        warnings,
      });
    } catch (err) {
      // The segment is worth having without its label, so a rejected display
      // name costs one retry rather than the whole cut.
      const message = err instanceof Error ? err.message : "Unknown error.";
      warnings.push(
        `Audience segment names could not be selected, so segments are stored by criterion id and type only. ${message}`,
      );
      segmented = await this.fetchSegmentedRows<AudienceIdentity>({
        accessToken,
        resource: "ad_group_audience_view",
        dimensions: baseDimensions,
        dateFilter,
        identify,
        keyOf,
        label: "Audience",
        warnings,
      });
    }

    return segmented
      .map(
        (row): AudienceDailyRecord => ({
          date: row.date,
          campaignKey: row.identity.campaignKey,
          adGroupKey: row.identity.adGroupKey,
          criterionId: row.identity.criterionId,
          criterionType: row.identity.criterionType || null,
          displayName: row.identity.displayName || null,
          currency,
          accountTimezone,
          spend: row.spend,
          impressions: row.impressions,
          clicks: row.clicks,
          registrations: row.registrations,
          purchases: row.purchases,
          orderConversionValue: row.orderConversionValue,
          conversionActionFiltered: row.conversionActionFiltered,
          sourceQueryVersion,
          syncedAt,
          isProvisional: todayIso !== "" && row.date >= todayIso,
        }),
      )
      .toSorted((left, right) =>
        left.date === right.date ? right.spend - left.spend : left.date.localeCompare(right.date),
      );
  }

  async fetchDailyMetrics(request: ConnectorRequest): Promise<ConnectorResult> {
    const effectiveRefreshToken = await this.resolveRefreshToken();
    if (!this.hasCoreCredentials(effectiveRefreshToken)) {
      throw new ConnectorFailure("unauthenticated", "Google Ads Direct API is missing credentials.", false);
    }

    const warnings: string[] = [];
    const accessToken = await this.getAccessToken(effectiveRefreshToken);

    const coreRows = await this.gaqlSearch(
      accessToken,
      [
        "SELECT segments.date, customer.currency_code, customer.time_zone,",
        "metrics.impressions, metrics.clicks, metrics.cost_micros",
        "FROM customer",
        `WHERE segments.date BETWEEN '${request.range.start}' AND '${request.range.end}'`,
      ].join(" "),
    );

    if (coreRows.length === 0) {
      return {
        platform: "google",
        rows: [],
        providerId: this.providerId,
        sourceQueryVersion: `google-ads-api-${this.apiVersion}`,
        coveragePercent: 0,
        warnings: ["Google Ads Direct API returned 0 rows for the requested range."],
        attempts: [
          {
            providerId: this.providerId,
            outcome: "skipped",
            safeMessage: `Query executed for customer ${this.config.customerId} between ${request.range.start} and ${request.range.end}; 0 rows returned.`,
          },
        ],
      };
    }

    const rawCurrency = String(field(coreRows[0]?.customer, "currencyCode", "currency_code") ?? "");
    if (!SUPPORTED_CURRENCIES.includes(rawCurrency as Currency)) {
      throw new ConnectorFailure(
        "configuration-error",
        `Google Ads account ${this.config.customerId} reports currency "${rawCurrency}", which this dashboard does not yet support (GBP/EUR only). Refusing to guess a conversion.`,
        false,
      );
    }
    if (this.config.expectedCurrency && rawCurrency !== this.config.expectedCurrency) {
      throw new ConnectorFailure(
        "configuration-error",
        `Google Ads account ${this.config.customerId} reports currency "${rawCurrency}", but this account is configured as ${this.config.expectedCurrency}. Refusing to report figures under the wrong currency.`,
        false,
      );
    }
    const currency = rawCurrency as Currency;
    const accountTimezone = String(field(coreRows[0]?.customer, "timeZone", "time_zone") ?? "");
    const todayIso = todayInTimezone(accountTimezone);
    // One timestamp for every row this pull produces, so account and campaign
    // rows written in the same job carry the same provenance instant.
    const syncedAt = new Date().toISOString();

    const dailyCore = new Map<string, { impressions: number; clicks: number; spend: number }>();
    for (const row of coreRows) {
      const date = String(field(row.segments, "date", "date") ?? "");
      if (!date) continue;
      dailyCore.set(date, {
        impressions: toNumber(field(row.metrics, "impressions", "impressions")),
        clicks: toNumber(field(row.metrics, "clicks", "clicks")),
        spend: Number((toNumber(field(row.metrics, "costMicros", "cost_micros")) / 1_000_000).toFixed(2)),
      });
    }

    const dailyConversions = new Map<
      string,
      {
        registrations: number;
        purchases: number;
        purchaseValue: number;
        registrationValue: number;
      }
    >();

    /** Daily counts for whichever consideration actions this account has. */
    const considerationDaily = new Map<
      string,
      Record<ConsiderationField, number>
    >();

    // The account's action list is read either way. Consideration availability
    // is a property of the account's own tagging and does not depend on
    // whether the acquisition actions happen to be configured here.
    const mapping = await this.verifyConversionActionMapping(accessToken);
    const hasAcquisitionMapping = Boolean(
      this.config.registrationConversionActionId ||
        this.config.purchaseConversionActionId,
    );
    const consideration = resolveConsiderationActions(mapping.allActions);
    warnings.push(...consideration.problems);

    if (hasAcquisitionMapping) {
      // Confirm against the live account that the configured IDs are really
      // the registration and purchase actions before a single conversion is
      // counted. A mapping onto an engagement action fails the pull outright.
      if (!mapping.ok) {
        throw new ConnectorFailure(
          "configuration-error",
          `Google Ads conversion action mapping for customer ${this.config.customerId} is not trustworthy: ${mapping.problems.join(" ")}`,
          false,
        );
      }
      warnings.push(...mapping.problems);
      if (mapping.contaminatedCandidates.length > 0) {
        warnings.push(
          `Account ${this.config.customerId} has ${mapping.contaminatedCandidates.length} enabled engagement-style conversion action(s) (${mapping.contaminatedCandidates
            .map((action) => `${action.name} [${action.category}]`)
            .join(", ")}). None of them is counted as a registration or a purchase. Those named for a consideration step are read into that stage instead; any figure taken straight from the Google Ads UI conversion columns may still add them to the order count.`,
        );
      }
    } else {
      warnings.push(
        "GOOGLE_ADS_REGISTRATION_CONVERSION_ACTION_ID and/or GOOGLE_ADS_PURCHASE_CONVERSION_ACTION_ID are not set. Registrations and purchases are reported as 0 rather than guessed from an unverified conversion action.",
      );
    }

    const unmappedConsideration = CONSIDERATION_ACTIONS.filter(
      (definition) => !consideration.byField.has(definition.field),
    );
    if (unmappedConsideration.length > 0) {
      warnings.push(
        `Account ${this.config.customerId} has no enabled conversion action for ${unmappedConsideration
          .map((definition) => `${definition.field} ("${definition.name}")`)
          .join(", ")}. Each is reported as not measured rather than as zero. Creating the action with that exact name is all that is required; no configuration change here.`,
      );
    }

    const considerationById = new Map<string, ConsiderationField>(
      [...consideration.byField].map(([field_, action]) => [action.id, field_]),
    );

    const actionResources = [
      this.config.registrationConversionActionId,
      this.config.purchaseConversionActionId,
      ...considerationById.keys(),
    ]
      .filter((id): id is string => Boolean(id))
      .map((id) => `'customers/${this.config.customerId}/conversionActions/${id}'`);

    if (actionResources.length > 0) {
      const conversionRows = await this.gaqlSearch(
        accessToken,
        [
          "SELECT segments.date, segments.conversion_action,",
          "metrics.all_conversions, metrics.all_conversions_value",
          "FROM customer",
          `WHERE segments.date BETWEEN '${request.range.start}' AND '${request.range.end}'`,
          `AND segments.conversion_action IN (${actionResources.join(", ")})`,
        ].join(" "),
      );

      for (const row of conversionRows) {
        const date = String(field(row.segments, "date", "date") ?? "");
        if (!date) continue;
        const actionResource = String(field(row.segments, "conversionAction", "conversion_action") ?? "");
        const current = dailyConversions.get(date) ?? {
          registrations: 0,
          purchases: 0,
          purchaseValue: 0,
          registrationValue: 0,
        };
        const allConversions = toNumber(field(row.metrics, "allConversions", "all_conversions"));
        const allConversionsValue = toNumber(field(row.metrics, "allConversionsValue", "all_conversions_value"));

        if (
          this.config.registrationConversionActionId &&
          actionResource.endsWith(`/${this.config.registrationConversionActionId}`)
        ) {
          current.registrations += allConversions;
          current.registrationValue += allConversionsValue;
        } else if (
          this.config.purchaseConversionActionId &&
          actionResource.endsWith(`/${this.config.purchaseConversionActionId}`)
        ) {
          current.purchases += allConversions;
          current.purchaseValue += allConversionsValue;
        } else {
          const considerationField = [...considerationById].find(([id]) =>
            actionResource.endsWith(`/${id}`),
          )?.[1];
          if (considerationField) {
            const bucket = considerationDaily.get(date) ?? {
              landingPageViews: 0,
              engagedVisits: 0,
              addToBaskets: 0,
            };
            bucket[considerationField] += allConversions;
            considerationDaily.set(date, bucket);
          }
        }
        dailyConversions.set(date, current);
      }
    }

    /**
     * A mapped action that recorded nothing on a given day genuinely counted
     * zero; an unmapped one was never measured. The two must not collapse.
     */
    const readConsideration = (
      date: string,
      field_: ConsiderationField,
    ): number | null =>
      consideration.byField.has(field_)
        ? considerationDaily.get(date)?.[field_] ?? 0
        : null;

    warnings.push(
      "Actual purchase revenue currently mirrors Google's platform-reported purchase value (all_conversions_value on the purchase action). It is not yet reconciled against store data, so platformValueRatio is not a meaningful signal for Google rows until that reconciliation lands.",
    );
    // Account-level share is Google's own roll-up over search-eligible traffic,
    // which an average of campaign shares cannot reproduce. Separate request,
    // so a rejection leaves every spend row intact.
    const dailyShare = new Map<string, ImpressionShareReading>();
    if (this.config.includeImpressionShare) {
      try {
        const shareRows = await this.gaqlSearch(
          accessToken,
          [
            `SELECT segments.date, ${IMPRESSION_SHARE_METRICS}`,
            "FROM customer",
            `WHERE segments.date BETWEEN '${request.range.start}' AND '${request.range.end}'`,
          ].join(" "),
        );
        for (const row of shareRows) {
          const date = String(field(row.segments, "date", "date") ?? "");
          if (date) dailyShare.set(date, readImpressionShare(row.metrics));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error.";
        warnings.push(
          `Account impression share could not be pulled, so it is stored as not reported. Spend and conversions are unaffected. ${message}`,
        );
      }
    }

    const rows: DailyMetric[] = [...dailyCore.entries()].map(([date, core]) => {
      const conversions = dailyConversions.get(date) ?? {
        registrations: 0,
        purchases: 0,
        purchaseValue: 0,
        registrationValue: 0,
      };
      const purchaseValue = Number(conversions.purchaseValue.toFixed(2));

      return {
        date,
        clientId: request.clientId,
        accountId: this.config.customerId ?? "",
        platform: "google",
        currency,
        accountTimezone,
        spend: core.spend,
        impressions: core.impressions,
        clicks: core.clicks,
        landingPageViews: readConsideration(date, "landingPageViews"),
        engagedVisits: readConsideration(date, "engagedVisits"),
        addToBaskets: readConsideration(date, "addToBaskets"),
        registrations: conversions.registrations,
        purchases: conversions.purchases,
        platformConversionValue: purchaseValue,
        actualPurchaseRevenue: purchaseValue,
        ...this.valueSplit(conversions.purchaseValue, conversions.registrationValue),
        // A day with no impressions has no share to report, whatever the API
        // returns for it.
        ...(core.impressions > 0 ? dailyShare.get(date) ?? {} : {}),
        sourceConnector: "google-direct-api",
        sourceQueryVersion: `google-ads-api-${this.apiVersion}`,
        syncedAt,
        isProvisional: todayIso !== "" && date >= todayIso,
        entityLevel: "account",
      };
    });

    let campaignRows: DailyMetric[] = [];
    let campaigns: AdCampaignRecord[] = [];
    if (this.config.includeCampaignBreakdown) {
      const breakdown = await this.fetchCampaignRows(
        accessToken,
        request,
        currency,
        accountTimezone,
        todayIso,
        syncedAt,
        warnings,
      );
      campaignRows = breakdown.rows;
      campaigns = breakdown.campaigns;
    }

    // Only a brand that runs Search or Shopping has queries to read, so a
    // PMax-only brand costs no extra request. A failure here is a warning: the
    // account and campaign rows above are complete without it.
    let searchTermRows: SearchTermDailyRecord[] = [];
    const runsQueryCampaigns = campaigns.some((campaign) =>
      SEARCH_TERM_CHANNEL_TYPES.has(campaign.channelType),
    );
    if (this.config.includeSearchTerms && runsQueryCampaigns) {
      try {
        searchTermRows = await this.fetchSearchTermRows(
          accessToken,
          request,
          currency,
          accountTimezone,
          todayIso,
          syncedAt,
          warnings,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error.";
        warnings.push(
          `Search terms could not be pulled; account and campaign rows are unaffected. ${message}`,
        );
      }
    }

    let deviceRows: DeviceDailyRecord[] = [];
    if (this.config.includeDeviceBreakdown) {
      try {
        deviceRows = await this.fetchDeviceRows(
          accessToken,
          request,
          currency,
          accountTimezone,
          todayIso,
          syncedAt,
          warnings,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error.";
        warnings.push(
          `Device breakdown could not be pulled; account and campaign rows are unaffected. ${message}`,
        );
      }
    }

    // Every breakdown below is a diagnostic cut: a failure is a warning, never
    // a failed sync, because the account and campaign rows above are already
    // complete without it.
    let entityRows: AdEntityDailyRecord[] = [];
    if (this.config.includeEntityBreakdown) {
      try {
        entityRows = await this.fetchEntityRows(
          accessToken,
          request,
          currency,
          accountTimezone,
          todayIso,
          syncedAt,
          campaigns,
          warnings,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error.";
        warnings.push(
          `Ad group and asset group breakdown could not be pulled; account and campaign rows are unaffected. ${message}`,
        );
      }
    }

    let geoRows: GeoDailyRecord[] = [];
    if (this.config.includeGeoBreakdown) {
      try {
        geoRows = await this.fetchGeoRows(
          accessToken,
          request,
          currency,
          accountTimezone,
          todayIso,
          syncedAt,
          warnings,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error.";
        warnings.push(
          `Location breakdown could not be pulled; account and campaign rows are unaffected. ${message}`,
        );
      }
    }

    let audienceRows: AudienceDailyRecord[] = [];
    if (this.config.includeAudienceBreakdown) {
      try {
        audienceRows = await this.fetchAudienceRows(
          accessToken,
          request,
          currency,
          accountTimezone,
          todayIso,
          syncedAt,
          warnings,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error.";
        warnings.push(
          `Audience breakdown could not be pulled; account and campaign rows are unaffected. ${message}`,
        );
      }
    }

    // Period grain, pulled after the daily rows and never instead of them. The
    // daily shares still land on `rows`; this is the only figure the auction
    // panel is allowed to print without a `~` in front of it.
    let impressionSharePeriodRows: ImpressionSharePeriodRecord[] = [];
    if (this.config.includeImpressionShare) {
      impressionSharePeriodRows = await this.fetchPeriodImpressionShare(
        accessToken,
        request,
        syncedAt,
        warnings,
      );
    }

    return {
      platform: "google",
      rows,
      campaignRows,
      campaigns,
      searchTermRows,
      deviceRows,
      entityRows,
      geoRows,
      audienceRows,
      impressionSharePeriodRows,
      providerId: this.providerId,
      sourceQueryVersion: `google-ads-api-${this.apiVersion}`,
      coveragePercent: 100,
      warnings,
      attempts: [
        {
          providerId: this.providerId,
          outcome: "succeeded",
          safeMessage: `Direct API query executed for customer ${this.config.customerId} between ${request.range.start} and ${request.range.end}; ${rows.length} day(s) returned.`,
        },
      ],
    };
  }
}
