import type {
  ConnectorHealth,
  ConnectorRequest,
  ConnectorResult,
  ReadOnlyAdsConnector,
} from "@/lib/connectors/types";
import { ConnectorFailure } from "@/lib/connectors/types";
import type { Currency, DailyMetric, Platform } from "@/lib/dashboard/types";

export interface MetaAdsApiConfiguration {
  accessToken?: string;
  adAccountId?: string;
  apiVersion?: string;
  /**
   * Ad account 100000000000001 is a shared umbrella account (Nusantara Group)
   * holding campaigns for several brands. Every insights row whose campaign
   * name does not contain this marker is dropped before aggregation, so one
   * brand's spend can never be attributed to another. The trailing dot is part
   * of the marker and is deliberate.
   */
  campaignNameFilter?: string;
  /**
   * Campaign-code prefixes for a brand whose campaigns carry more than one
   * code. When set, a row is kept if its name starts with any entry, matched
   * case-insensitively, and `campaignNameFilter` is not consulted.
   *
   * Prefix rather than substring on purpose: a brand's second code can be
   * a two-letter code such as `EW_`, and a substring test for that would also swallow
   * an unrelated campaign containing "brew_" or "crew_". Anchoring keeps
   * the widened filter from becoming a cross-brand leak.
   */
  campaignNamePrefixes?: readonly string[];
  /**
   * Account currency this connector will accept. Each brand reports in one currency;
   * a mismatch means the wrong account was configured, so the fetch fails
   * closed rather than reporting figures under the wrong currency.
   */
  expectedCurrency?: Currency;
  /**
   * Row key used to look the access token up in `connector_tokens`. This is the
   * client *slug* the OAuth callback stored (`kopi-senja`), never the
   * `clients.id` UUID that `ConnectorRequest.clientId` carries.
   */
  /**
   * The ad account this connector is allowed to read. `adAccountId` is resolved
   * from `META_AD_ACCOUNT_ID`, and on a developer machine that variable is
   * often already exported at the OS level for an unrelated Meta MCP server, and
   * the app would then inherit a live token for a different advertiser in a
   * different currency. When this pin is set the
   * connector refuses any other account outright, before a single insights row
   * is requested.
   */
  expectedAdAccountId?: string;
  clientSlug?: string;
  /**
   * Also emit a per-campaign breakdown for the same range. Persisted at
   * `entity_level = 'campaign'` and never mixed into the account rows.
   */
  includeCampaignBreakdown?: boolean;
}

interface MetaActionEntry {
  action_type?: string;
  value?: unknown;
}

interface MetaInsightsRow {
  campaign_id?: string;
  campaign_name?: string;
  date_start?: string;
  date_stop?: string;
  spend?: unknown;
  impressions?: unknown;
  clicks?: unknown;
  actions?: MetaActionEntry[];
  action_values?: MetaActionEntry[];
}

interface MetaInsightsResponse {
  data?: MetaInsightsRow[];
  paging?: { next?: string; cursors?: { after?: string } };
}

interface MetaAccountResponse {
  id?: string;
  name?: string;
  currency?: string;
  account_status?: number;
  timezone_name?: string;
}

interface MetaErrorBody {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
  };
}

const GRAPH_API_BASE = "https://graph.facebook.com";
const DEFAULT_API_VERSION = "v20.0";
const DEFAULT_CAMPAIGN_FILTER = "Kopi senja.";
const DEFAULT_TIMEZONE = "Asia/Jakarta";
const DEFAULT_CLIENT_SLUG = "kopi-senja";
/**
 * Platform keys this connector will accept for a stored token, in priority
 * order. `meta-ads` is the key `OAUTH_PLATFORMS` uses and therefore what the
 * OAuth callback writes; `meta` is accepted so a row seeded by hand under the
 * shorter name still resolves.
 */
const META_TOKEN_PLATFORM_KEYS = ["meta-ads", "meta"] as const;

/** Meta throttling codes. These are transient, so the caller may retry. */
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);
/** Token expired, revoked, or missing a permission. Retrying will not help. */
const AUTH_CODES = new Set([10, 102, 190, 200]);

const REGISTRATION_ACTIONS = new Set(["complete_registration", "lead"]);
const LANDING_PAGE_ACTIONS = new Set(["landing_page_view"]);
/**
 * Meta's own basket signal. Google carries the same step through an
 * ADD_TO_CART conversion action, so the two sides of the consideration stage
 * are measured the same way: a tag on the site, attributed by the platform
 * that served the click.
 */
const ADD_TO_BASKET_ACTIONS = new Set(["add_to_cart"]);
/** Reported by Meta but with no column on DailyMetric; see fetch warnings. */
const UNMAPPED_ACTIONS = new Set(["initiate_checkout"]);

/** Guards against a malformed paging cursor looping forever. */
const MAX_PAGES = 100;

function toNumber(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : 0;
}

/** Accepts act_123 or 123; always yields the bare numeric id. */
function normalizeAdAccountId(value: string | undefined): string {
  const raw = value?.trim() ?? "";
  return raw.startsWith("act_") ? raw.slice(4) : raw;
}

/**
 * Today in the account's own timezone, as an ISO date. Mirrors the helper in
 * google-ads-api-client; kept local so neither connector imports the other.
 */
function todayInTimezone(timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    // Unresolvable timezone: fail toward "not provisional" rather than marking
    // every row as today.
    return "";
  }
}

function sumActions(entries: MetaActionEntry[] | undefined, types: Set<string>): number {
  if (!Array.isArray(entries)) return 0;
  let total = 0;
  for (const entry of entries) {
    if (entry?.action_type && types.has(entry.action_type)) {
      total += toNumber(entry.value);
    }
  }
  return total;
}

function hasAnyAction(entries: MetaActionEntry[] | undefined, types: Set<string>): boolean {
  return Array.isArray(entries) && entries.some((e) => Boolean(e?.action_type) && types.has(e.action_type as string));
}

/**
 * Total for one action type, or `undefined` when Meta did not report that type
 * at all. `sumActions` cannot express the difference between "absent" and
 * "present and zero", and that difference decides which purchase alias wins.
 */
function actionTotal(
  entries: MetaActionEntry[] | undefined,
  type: string,
): number | undefined {
  if (!Array.isArray(entries)) return undefined;
  let total: number | undefined;
  for (const entry of entries) {
    if (entry?.action_type === type) {
      total = (total ?? 0) + toNumber(entry.value);
    }
  }
  return total;
}

/**
 * Meta reports one conversion under several aliases at once. `omni_purchase`
 * is the documented superset of `purchase`: it covers web plus app, offline
 * and in-store. Adding the two counts every web order twice, doubling both the
 * order count and the purchase value on every account that reports both.
 *
 * The superset wins whenever Meta reports it; `purchase` is the fallback for
 * an account that only ever reports the web alias. Never the sum.
 */
function resolvePurchaseTotal(entries: MetaActionEntry[] | undefined): number {
  return (
    actionTotal(entries, "omni_purchase") ?? actionTotal(entries, "purchase") ?? 0
  );
}

interface DailyAccumulator {
  spend: number;
  impressions: number;
  clicks: number;
  landingPageViews: number;
  addToBaskets: number;
  registrations: number;
  purchases: number;
  purchaseValue: number;
}

function emptyDay(): DailyAccumulator {
  return {
    spend: 0,
    impressions: 0,
    clicks: 0,
    landingPageViews: 0,
    addToBaskets: 0,
    registrations: 0,
    purchases: 0,
    purchaseValue: 0,
  };
}

/**
 * Maps a Graph API error onto a typed failure. Throttling is checked before
 * authentication because Meta returns several rate-limit codes under the
 * OAuthException type, which would otherwise be misread as a dead credential
 * and wrongly marked non-retryable.
 */
export function classifyMetaError(status: number, rawBody: string): ConnectorFailure {
  let parsed: MetaErrorBody | undefined;
  try {
    parsed = JSON.parse(rawBody) as MetaErrorBody;
  } catch {
    parsed = undefined;
  }

  const code = parsed?.error?.code;
  const subcode = parsed?.error?.error_subcode;
  const message = parsed?.error?.message ?? rawBody.slice(0, 300);

  if (status === 429 || (typeof code === "number" && RATE_LIMIT_CODES.has(code))) {
    return new ConnectorFailure(
      "rate-limited",
      `Meta Graph API throttled the request (status ${status}, code ${code ?? "n/a"}, subcode ${subcode ?? "n/a"}): ${message}`,
      true,
    );
  }

  if (status === 401 || status === 403 || (typeof code === "number" && AUTH_CODES.has(code))) {
    return new ConnectorFailure(
      "unauthenticated",
      `Meta Graph API rejected the credential (status ${status}, code ${code ?? "n/a"}): ${message}`,
      false,
    );
  }

  if (status >= 500) {
    return new ConnectorFailure(
      "unavailable",
      `Meta Graph API server error (status ${status}): ${message}`,
      true,
    );
  }

  return new ConnectorFailure(
    "invalid-response",
    `Meta Graph API query failed (status ${status}): ${message}`,
    false,
  );
}

export class MetaAdsApiClient implements ReadOnlyAdsConnector {
  readonly providerId: string;
  readonly providerKind = "official-api" as const;
  readonly platform: Exclude<Platform, "all"> = "meta";
  readonly mode = "live" as const;

  /** Resolved once per instance; `undefined` means "not looked up yet". */
  private resolvedAccessToken: string | undefined;
  private tokenSource = "unresolved";
  /**
   * Expiry of the stored credential. Meta issues no refresh token, so the
   * long-lived access token simply dies about 60 days after consent.
   */
  private storedTokenExpiry: {
    state: "expiring-soon" | "expired";
    expiresAt: string;
    daysRemaining: number;
  } | null = null;

  constructor(
    private readonly config: MetaAdsApiConfiguration = {
      accessToken: process.env.META_ADS_ACCESS_TOKEN,
      adAccountId: process.env.META_AD_ACCOUNT_ID,
      apiVersion: process.env.META_GRAPH_API_VERSION ?? DEFAULT_API_VERSION,
      campaignNameFilter: process.env.META_CAMPAIGN_NAME_FILTER ?? DEFAULT_CAMPAIGN_FILTER,
      expectedCurrency: process.env.META_EXPECTED_CURRENCY as Currency | undefined,
      expectedAdAccountId: process.env.META_EXPECTED_AD_ACCOUNT_ID,
      clientSlug: process.env.META_CLIENT_SLUG,
      includeCampaignBreakdown:
        process.env.META_INCLUDE_CAMPAIGN_BREAKDOWN !== "false",
    },
  ) {
    this.providerId = "meta-ads-direct-api";
  }

  private get apiVersion(): string {
    return this.config.apiVersion?.trim() || DEFAULT_API_VERSION;
  }

  private get campaignFilter(): string {
    return this.config.campaignNameFilter?.trim() ?? DEFAULT_CAMPAIGN_FILTER;
  }

  /** Non-empty only for a brand configured with campaign-code prefixes. */
  private get campaignPrefixes(): string[] {
    return (this.config.campaignNamePrefixes ?? [])
      .map((prefix) => prefix.trim().toLowerCase())
      .filter(Boolean);
  }

  /** Human-readable description of whichever rule is in force. */
  private get campaignFilterLabel(): string {
    const prefixes = this.campaignPrefixes;
    return prefixes.length > 0
      ? `${this.config.campaignNamePrefixes?.join(" / ")} (name prefix)`
      : `"${this.campaignFilter}"`;
  }

  private get expectedCurrency(): Currency {
    return this.config.expectedCurrency ?? "USD";
  }

  /** Accepts act_123 or 123; always yields the bare numeric id. */
  private get accountId(): string {
    return normalizeAdAccountId(this.config.adAccountId);
  }

  private get expectedAdAccountId(): string {
    return normalizeAdAccountId(this.config.expectedAdAccountId);
  }

  /**
   * Fails closed when the resolved account is not the pinned one. Checked
   * before the account probe so a stray credential never reaches Meta at all.
   */
  private assertPinnedAccount(): void {
    const pinned = this.expectedAdAccountId;
    if (pinned && pinned !== this.accountId) {
      throw new ConnectorFailure(
        "configuration-error",
        `Meta connector resolved ad account ${this.accountId}, but this client is pinned to ${pinned}. Check META_AD_ACCOUNT_ID, including any value exported in the operating system environment. Refusing to read a different advertiser's account.`,
        false,
      );
    }
  }

  private get clientSlug(): string {
    return this.config.clientSlug?.trim() || DEFAULT_CLIENT_SLUG;
  }

  /**
   * Access token, resolved once per call and cached for the life of this
   * instance. The stored `connector_tokens` row is authoritative when it
   * exists, because that is the credential the operator granted through the
   * dashboard; `META_ADS_ACCESS_TOKEN` stays as the device-local fallback for
   * environments with no Supabase worker secret. `getConnectorToken` filters to
   * active rows, so a disconnected connector falls back to the environment
   * only if one is deliberately configured there.
   */
  private async resolveAccessToken(): Promise<string> {
    if (this.resolvedAccessToken !== undefined) return this.resolvedAccessToken;

    try {
      const { classifyTokenLifetime, getConnectorToken } = await import("./token-storage");
      for (const platformKey of META_TOKEN_PLATFORM_KEYS) {
        const record = await getConnectorToken(platformKey, this.clientSlug);
        if (record?.accessToken?.trim()) {
          const lifetime = classifyTokenLifetime(record.expiresAt);
          if (lifetime.state === "expired") {
            // Fail closed. The operator granted this credential through the
            // dashboard, so an expired grant means re-consent — never a quiet
            // fallback to an environment token, which may belong
            // to a different advertiser.
            this.storedTokenExpiry = {
              state: "expired",
              expiresAt: lifetime.expiresAt ?? "unknown",
              daysRemaining: 0,
            };
            this.resolvedAccessToken = "";
            this.tokenSource = `connector_tokens (${platformKey}, expired)`;
            return this.resolvedAccessToken;
          }
          if (lifetime.state === "expiring-soon" && lifetime.expiresAt) {
            this.storedTokenExpiry = {
              state: "expiring-soon",
              expiresAt: lifetime.expiresAt,
              daysRemaining: lifetime.daysRemaining ?? 0,
            };
          }
          this.resolvedAccessToken = record.accessToken.trim();
          this.tokenSource = `connector_tokens (${platformKey})`;
          return this.resolvedAccessToken;
        }
      }
    } catch {
      // Supabase or the storage layer is unavailable. Fall through to the
      // environment so a device-local credential still works, and fail closed
      // on a missing token rather than surfacing a storage error that would
      // read as a dead Meta account.
    }

    const fromEnvironment = this.config.accessToken?.trim() ?? "";
    this.resolvedAccessToken = fromEnvironment;
    this.tokenSource = fromEnvironment ? "META_ADS_ACCESS_TOKEN" : "none";
    return fromEnvironment;
  }

  private async hasCredentials(): Promise<boolean> {
    const token = await this.resolveAccessToken();
    return Boolean(token && this.accountId);
  }

  /**
   * Why there is no usable credential. An expired stored grant asks for a
   * different operator action than a missing one: re-consent, not setup.
   */
  private missingCredentialMessage(): string {
    if (this.storedTokenExpiry?.state === "expired") {
      return `The stored Meta access token expired on ${this.storedTokenExpiry.expiresAt}. Meta issues no refresh token, so reconnect Meta in Data sources to grant a new long-lived token.`;
    }
    return "Meta Ads Direct API credentials not configured in the connector_tokens table or the environment.";
  }

  /** Set only while the stored credential is inside its final week. */
  private expiringSoonNotice(): string | null {
    if (this.storedTokenExpiry?.state !== "expiring-soon") return null;
    return `The stored Meta access token expires in ${this.storedTokenExpiry.daysRemaining} day(s), on ${this.storedTokenExpiry.expiresAt}. Meta issues no refresh token, so reconnect Meta before then or the next refresh fails.`;
  }

  /**
   * Read-only GET. The token travels in the Authorization header, never in a
   * query string, so it cannot leak through a URL that gets logged or recorded.
   */
  private async graphGet<T>(path: string, params: Record<string, string>): Promise<T> {
    const url = new URL(`${GRAPH_API_BASE}/${this.apiVersion}/${path}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const accessToken = await this.resolveAccessToken();

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Network error";
      throw new ConnectorFailure("unavailable", `Meta Graph API unreachable: ${message}`, true);
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw classifyMetaError(response.status, detail);
    }

    return (await response.json()) as T;
  }

  private async fetchAccount(): Promise<MetaAccountResponse> {
    return this.graphGet<MetaAccountResponse>(`act_${this.accountId}`, {
      fields: "id,name,currency,account_status,timezone_name",
    });
  }

  async health(): Promise<ConnectorHealth> {
    if (!(await this.hasCredentials())) {
      return {
        providerId: this.providerId,
        providerKind: this.providerKind,
        available: false,
        authenticated: false,
        readOnly: true,
        safeMessage: this.missingCredentialMessage(),
      };
    }

    try {
      this.assertPinnedAccount();
      const account = await this.fetchAccount();
      const label = account.name ? `${this.accountId} (${account.name})` : this.accountId;
      const expiringSoon = this.expiringSoonNotice();
      return {
        providerId: this.providerId,
        providerKind: this.providerKind,
        available: true,
        authenticated: true,
        readOnly: true,
        safeMessage: `Authenticated for ad account ${label}, currency ${account.currency ?? "unknown"}. Credential source: ${this.tokenSource}.${expiringSoon ? ` ${expiringSoon}` : ""}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown Meta authentication error.";
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

  private async fetchInsightPages(range: { start: string; end: string }): Promise<MetaInsightsRow[]> {
    const params: Record<string, string> = {
      time_range: JSON.stringify({ since: range.start, until: range.end }),
      time_increment: "1",
      level: "campaign",
      limit: "500",
      // cpc, cpm, and ctr are requested because the ingestion brief lists them,
      // but they are not persisted: DailyMetric has no such columns and the
      // dashboard derives those ratios downstream in MetricTotals.
      fields: [
        "campaign_id",
        "campaign_name",
        "date_start",
        "date_stop",
        "spend",
        "impressions",
        "clicks",
        "cpc",
        "cpm",
        "ctr",
        "actions",
        "action_values",
      ].join(","),
    };

    const rows: MetaInsightsRow[] = [];
    let after: string | undefined;
    let pages = 0;

    do {
      const page: MetaInsightsResponse = await this.graphGet<MetaInsightsResponse>(
        `act_${this.accountId}/insights`,
        after ? { ...params, after } : params,
      );
      rows.push(...(page.data ?? []));
      after = page.paging?.next ? page.paging.cursors?.after : undefined;
      pages += 1;
    } while (after && pages < MAX_PAGES);

    return rows;
  }

  async fetchDailyMetrics(request: ConnectorRequest): Promise<ConnectorResult> {
    if (!(await this.hasCredentials())) {
      throw new ConnectorFailure(
        "unauthenticated",
        `Meta Ads Direct API cannot authenticate. ${this.missingCredentialMessage()}`,
        false,
      );
    }

    this.assertPinnedAccount();

    const warnings: string[] = [];
    const sourceQueryVersion = `meta-graph-api-${this.apiVersion}`;

    const expiringSoon = this.expiringSoonNotice();
    if (expiringSoon) warnings.push(expiringSoon);

    if (!this.expectedAdAccountId) {
      warnings.push(
        "META_EXPECTED_AD_ACCOUNT_ID is not set, so the connector cannot prove it read the intended ad account. Set it to pin this client to one advertiser.",
      );
    }

    const account = await this.fetchAccount();
    const rawCurrency = String(account.currency ?? "");
    if (rawCurrency !== this.expectedCurrency) {
      throw new ConnectorFailure(
        "configuration-error",
        `Meta ad account ${this.accountId} reports currency "${rawCurrency}", but this account is configured as ${this.expectedCurrency}. Refusing to report figures under the wrong currency.`,
        false,
      );
    }
    const currency = rawCurrency as Currency;
    const accountTimezone = account.timezone_name?.trim() || DEFAULT_TIMEZONE;
    const todayIso = todayInTimezone(accountTimezone);

    const insightRows = await this.fetchInsightPages(request.range);

    const filter = this.campaignFilter;
    const filterLower = filter.toLowerCase();
    const prefixes = this.campaignPrefixes;
    const usePrefixes = prefixes.length > 0;
    const keeps = (name: string): boolean => {
      const lower = name.toLowerCase();
      return usePrefixes
        ? prefixes.some((prefix) => lower.startsWith(prefix))
        : lower.includes(filterLower);
    };
    const daily = new Map<string, DailyAccumulator>();
    // Campaign-level buckets for the same filtered rows. Keyed by date and
    // campaign id so a renamed campaign keeps one identity across the range.
    const perCampaign = new Map<
      string,
      { date: string; campaignId: string; campaignName: string; totals: DailyAccumulator }
    >();
    let dropped = 0;
    let caseDrift = 0;
    let sawUnmappedAction = false;
    let sawBothPurchaseTypes = false;

    for (const row of insightRows) {
      const campaignName = String(row.campaign_name ?? "");
      if (!keeps(campaignName)) {
        dropped += 1;
        continue;
      }
      if (!usePrefixes && !campaignName.includes(filter)) {
        // Matched only case-insensitively: the naming convention has drifted.
        caseDrift += 1;
      }

      const date = String(row.date_start ?? "");
      if (!date) continue;

      const bucket = daily.get(date) ?? emptyDay();
      bucket.spend += toNumber(row.spend);
      bucket.impressions += toNumber(row.impressions);
      bucket.clicks += toNumber(row.clicks);
      bucket.landingPageViews += sumActions(row.actions, LANDING_PAGE_ACTIONS);
      bucket.addToBaskets += sumActions(row.actions, ADD_TO_BASKET_ACTIONS);
      bucket.registrations += sumActions(row.actions, REGISTRATION_ACTIONS);
      bucket.purchases += resolvePurchaseTotal(row.actions);
      bucket.purchaseValue += resolvePurchaseTotal(row.action_values);
      daily.set(date, bucket);

      const campaignId = String(row.campaign_id ?? campaignName);
      const campaignKey = `${date}|${campaignId}`;
      const campaignBucket =
        perCampaign.get(campaignKey) ??
        { date, campaignId, campaignName, totals: emptyDay() };
      campaignBucket.totals.spend += toNumber(row.spend);
      campaignBucket.totals.impressions += toNumber(row.impressions);
      campaignBucket.totals.clicks += toNumber(row.clicks);
      campaignBucket.totals.landingPageViews += sumActions(row.actions, LANDING_PAGE_ACTIONS);
      campaignBucket.totals.addToBaskets += sumActions(row.actions, ADD_TO_BASKET_ACTIONS);
      campaignBucket.totals.registrations += sumActions(row.actions, REGISTRATION_ACTIONS);
      campaignBucket.totals.purchases += resolvePurchaseTotal(row.actions);
      campaignBucket.totals.purchaseValue += resolvePurchaseTotal(row.action_values);
      perCampaign.set(campaignKey, campaignBucket);

      if (hasAnyAction(row.actions, UNMAPPED_ACTIONS)) {
        sawUnmappedAction = true;
      }
      if (
        hasAnyAction(row.actions, new Set(["purchase"])) &&
        hasAnyAction(row.actions, new Set(["omni_purchase"]))
      ) {
        sawBothPurchaseTypes = true;
      }
    }

    if (dropped > 0) {
      warnings.push(
        `${dropped} campaign row(s) outside the ${this.campaignFilterLabel} filter were dropped before aggregation so other brands in this shared ad account cannot leak into these figures.`,
      );
    }
    if (caseDrift > 0) {
      warnings.push(
        `${caseDrift} campaign row(s) matched "${filter}" only case-insensitively. Campaign naming has drifted from the agreed convention and should be corrected in Ads Manager.`,
      );
    }
    if (sawUnmappedAction) {
      warnings.push(
        "Meta reported add_to_cart and/or initiate_checkout actions. DailyMetric has no column for either, so they are not persisted. Adding them requires a schema change beyond this connector.",
      );
    }
    if (sawBothPurchaseTypes) {
      warnings.push(
        "Meta reported both purchase and omni_purchase on the same day. omni_purchase is the superset, so it is the figure used and purchase is ignored; the two are never added. Figures published before 2026-09-14 summed them and were exactly double.",
      );
    }
    warnings.push(
      "Actual purchase revenue currently mirrors Meta's platform-reported purchase value (action_values). It is not yet reconciled against store data, so platformValueRatio is not a meaningful signal for Meta rows until that reconciliation lands.",
    );

    const syncedAt = new Date().toISOString();

    const campaignRows: DailyMetric[] = this.config.includeCampaignBreakdown
      ? [...perCampaign.values()]
          .sort((left, right) =>
            left.date === right.date
              ? left.campaignId.localeCompare(right.campaignId)
              : left.date.localeCompare(right.date),
          )
          .map((bucket): DailyMetric => {
            const purchaseValue = Number(bucket.totals.purchaseValue.toFixed(2));
            return {
              date: bucket.date,
              clientId: request.clientId,
              accountId: this.accountId,
              platform: "meta",
              currency,
              accountTimezone,
              spend: Number(bucket.totals.spend.toFixed(2)),
              impressions: bucket.totals.impressions,
              clicks: bucket.totals.clicks,
              landingPageViews: bucket.totals.landingPageViews,
              // Meta has no dwell-time signal comparable to Google's
              // time-on-site action, so this stays not measured rather than 0.
              engagedVisits: null,
              addToBaskets: bucket.totals.addToBaskets,
              registrations: bucket.totals.registrations,
              purchases: bucket.totals.purchases,
              platformConversionValue: purchaseValue,
              actualPurchaseRevenue: purchaseValue,
              sourceConnector: "meta-direct-api",
              sourceQueryVersion,
              syncedAt,
              isProvisional: todayIso !== "" && bucket.date >= todayIso,
              entityLevel: "campaign",
              entityKey: bucket.campaignId,
              entityName: bucket.campaignName,
            };
          })
      : [];

    const rows: DailyMetric[] = [...daily.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, bucket]) => {
        const purchaseValue = Number(bucket.purchaseValue.toFixed(2));
        return {
          date,
          clientId: request.clientId,
          accountId: this.accountId,
          platform: "meta",
          currency,
          accountTimezone,
          spend: Number(bucket.spend.toFixed(2)),
          impressions: bucket.impressions,
          clicks: bucket.clicks,
          landingPageViews: bucket.landingPageViews,
          // Meta has no dwell-time signal comparable to Google's time-on-site
          // action, so this stays not measured rather than 0.
          engagedVisits: null,
          addToBaskets: bucket.addToBaskets,
          registrations: bucket.registrations,
          purchases: bucket.purchases,
          platformConversionValue: purchaseValue,
          actualPurchaseRevenue: purchaseValue,
          sourceConnector: "meta-direct-api",
          sourceQueryVersion,
          syncedAt,
          isProvisional: todayIso !== "" && date >= todayIso,
          entityLevel: "account",
        };
      });

    if (rows.length === 0) {
      return {
        platform: "meta",
        rows,
        providerId: this.providerId,
        sourceQueryVersion,
        coveragePercent: 0,
        warnings: [
          `Meta Ads Direct API returned no rows matching "${filter}" for the requested range.`,
          ...warnings,
        ],
        attempts: [
          {
            providerId: this.providerId,
            outcome: "skipped",
            safeMessage: `Insights query executed for ad account ${this.accountId} between ${request.range.start} and ${request.range.end}; 0 matching day(s).`,
          },
        ],
      };
    }

    return {
      platform: "meta",
      rows,
      campaignRows,
      providerId: this.providerId,
      sourceQueryVersion,
      coveragePercent: 100,
      warnings,
      attempts: [
        {
          providerId: this.providerId,
          outcome: "succeeded",
          safeMessage: `Insights query executed for ad account ${this.accountId} between ${request.range.start} and ${request.range.end}; ${rows.length} day(s) returned.`,
        },
      ],
    };
  }
}
