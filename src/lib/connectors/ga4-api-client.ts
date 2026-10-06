import { exchangeGoogleRefreshToken } from "@/lib/connectors/google-oauth-token";
import type { ConnectorHealth, ConnectorRequest } from "@/lib/connectors/types";
import { ConnectorFailure } from "@/lib/connectors/types";
import type { Currency } from "@/lib/dashboard/types";
import type { ReferringChannel, StoreDevice } from "@/lib/store/types";

/**
 * Read-only Google Analytics 4 connector, built on the Data API v1beta
 * `runReport` endpoint.
 *
 * It reads and nothing else: no property configuration is written, no audience
 * is created, no measurement protocol event is sent. Credentials come from the
 * stored `google-analytics` grant, never from a hard-coded id, and the property
 * id itself is configuration rather than source, because a property id is an
 * account identifier and this repository does not carry those.
 */

const GA4_DATA_API_BASE = "https://analyticsdata.googleapis.com";
const DEFAULT_API_VERSION = "v1beta";
const DEFAULT_CLIENT_SLUG = "kopi-senja";
/** GA4 caps a single report page; the client pages until the total is read. */
const PAGE_SIZE = 100_000;
const MAX_PAGES = 50;

export interface Ga4Configuration {
  /** Numeric GA4 property id, without the `properties/` prefix. */
  propertyId?: string;
  clientId?: string;
  clientSecret?: string;
  /** Device-local fallback; the stored grant is authoritative. */
  refreshToken?: string;
  /** Row key for the stored grant in `connector_tokens`. */
  clientSlug?: string;
  apiVersion?: string;
  /** Reporting currency of the store this property belongs to. */
  currency?: Currency;
}

/** Cuts this connector knows how to request. */
export type Ga4Breakdown =
  | "total"
  | "channel"
  | "device"
  | "landingPage"
  | "country"
  | "city";

export interface Ga4DailyRow {
  date: string;
  breakdown: Ga4Breakdown;
  /** `total` for the undifferentiated daily row; otherwise the dimension value. */
  breakdownValue: string;
  sessions: number;
  activeUsers: number;
  /**
   * Reported for this row's grain only. Rates and averages are not additive, so
   * summing them across rows produces a number GA4 would never agree with.
   */
  bounceRate: number;
  averageSessionDurationSeconds: number;
  addToCarts: number;
  checkouts: number;
  ecommercePurchases: number;
  grossPurchaseRevenue: number;
  currency: Currency;
  sourceQueryVersion: string;
  /** True while the day is still open in the property's own timezone. */
  isProvisional: boolean;
}

export interface Ga4FetchResult {
  rows: Ga4DailyRow[];
  propertyTimezone: string;
  currency: Currency;
  sourceQueryVersion: string;
  warnings: string[];
}

interface Ga4ReportResponse {
  dimensionHeaders?: { name?: string }[];
  metricHeaders?: { name?: string }[];
  rows?: {
    dimensionValues?: { value?: string }[];
    metricValues?: { value?: string }[];
  }[];
  rowCount?: number;
  metadata?: { currencyCode?: string; timeZone?: string };
}

/** Metrics requested for every report, in a fixed order. */
const METRICS = [
  "sessions",
  "activeUsers",
  "bounceRate",
  "averageSessionDuration",
  "addToCarts",
  "checkouts",
  "ecommercePurchases",
  "grossPurchaseRevenue",
] as const;

const BREAKDOWN_DIMENSION: Record<Exclude<Ga4Breakdown, "total">, string> = {
  channel: "sessionDefaultChannelGroup",
  device: "deviceCategory",
  landingPage: "landingPagePlusQueryString",
  country: "country",
  city: "city",
};

/**
 * GA4 default channel groups onto the store's five-value vocabulary.
 *
 * GA4 ships far more groups than the store models, so the mapping is written
 * out rather than guessed from substrings: "Organic Shopping" and "Paid
 * Shopping" differ by one word and belong in opposite buckets. Anything not
 * listed becomes `Unknown` *and* is named in a warning, so traffic is never
 * silently folded into a bucket it does not belong to.
 */
const CHANNEL_GROUP_MAP: Record<string, ReferringChannel> = {
  Direct: "Direct",
  "Paid Search": "Paid",
  "Paid Social": "Paid",
  "Paid Shopping": "Paid",
  "Paid Video": "Paid",
  "Paid Other": "Paid",
  "Display": "Paid",
  "Cross-network": "Paid",
  "Organic Search": "Organic",
  "Organic Shopping": "Organic",
  "Organic Video": "Organic",
  "Organic Social": "Social",
};

export function mapChannelGroup(value: string): {
  channel: ReferringChannel;
  mapped: boolean;
} {
  const normalized = value.trim();
  const channel = CHANNEL_GROUP_MAP[normalized];
  return channel
    ? { channel, mapped: true }
    : { channel: "Unknown", mapped: false };
}

export function mapDeviceCategory(value: string): StoreDevice {
  switch (value.trim().toLowerCase()) {
    case "desktop":
      return "Desktop";
    case "mobile":
      return "Mobile";
    case "tablet":
      return "Tablet";
    default:
      return "Other";
  }
}

function toNumber(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Today in the property's own timezone, so an open day is marked as open. */
function todayInTimezone(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    // An unresolvable timezone fails toward "not provisional" rather than
    // marking every row as today.
    return "";
  }
}

/** GA4 returns `20260912`; the rest of the system speaks ISO dates. */
export function toIsoDate(compact: string): string {
  return /^\d{8}$/.test(compact)
    ? `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`
    : compact;
}

function classifyGa4Error(status: number, rawBody: string): ConnectorFailure {
  const detail = rawBody.slice(0, 300);

  if (status === 429) {
    return new ConnectorFailure(
      "rate-limited",
      `GA4 Data API throttled the request (429): ${detail}`,
      true,
    );
  }
  if (status === 401 || status === 403) {
    return new ConnectorFailure(
      "unauthenticated",
      `GA4 Data API rejected the credential (${status}): ${detail}`,
      false,
    );
  }
  if (status >= 500) {
    return new ConnectorFailure(
      "unavailable",
      `GA4 Data API server error (${status}): ${detail}`,
      true,
    );
  }
  return new ConnectorFailure(
    "invalid-response",
    `GA4 Data API query failed (${status}): ${detail}`,
    false,
  );
}

export class Ga4ApiClient {
  readonly providerId = "ga4-direct-api";
  readonly providerKind = "official-api" as const;
  readonly mode = "live" as const;

  private resolvedRefreshToken: string | undefined;
  private tokenSource = "unresolved";

  constructor(
    private readonly config: Ga4Configuration = {
      propertyId: process.env.GA4_PROPERTY_ID,
      clientId: process.env.GOOGLE_ADS_CLIENT_ID ?? process.env.GA4_CLIENT_ID,
      clientSecret:
        process.env.GOOGLE_ADS_CLIENT_SECRET ?? process.env.GA4_CLIENT_SECRET,
      refreshToken: process.env.GA4_REFRESH_TOKEN,
      clientSlug: process.env.GA4_CLIENT_SLUG,
      apiVersion: process.env.GA4_API_VERSION ?? DEFAULT_API_VERSION,
    },
  ) {}

  get sourceQueryVersion(): string {
    return `ga4-data-api-${this.apiVersion}`;
  }

  private get apiVersion(): string {
    return this.config.apiVersion?.trim() || DEFAULT_API_VERSION;
  }

  private get clientSlug(): string {
    return this.config.clientSlug?.trim() || DEFAULT_CLIENT_SLUG;
  }

  private get propertyId(): string {
    return (this.config.propertyId ?? "").trim().replace(/^properties\//, "");
  }

  /**
   * The grant stored through the dashboard is authoritative; `GA4_REFRESH_TOKEN`
   * stays as a device-local fallback for machines with no Supabase worker
   * secret. A revoked row is filtered out by `getConnectorToken`, so a
   * disconnected connector falls back only to a credential someone deliberately
   * configured on that device.
   */
  private async resolveRefreshToken(): Promise<string> {
    if (this.resolvedRefreshToken !== undefined) return this.resolvedRefreshToken;

    try {
      const { classifyTokenLifetime, getConnectorToken } = await import(
        "./token-storage"
      );
      const record = await getConnectorToken("google-analytics", this.clientSlug);
      if (record?.refreshToken) {
        // A refresh token has no expiry of its own; `expires_at` describes the
        // access token that came with it, so an expired value is not a reason
        // to refuse the refresh.
        void classifyTokenLifetime(record.expiresAt);
        this.resolvedRefreshToken = record.refreshToken;
        this.tokenSource = "connector_tokens (google-analytics)";
        return this.resolvedRefreshToken;
      }
    } catch {
      // Supabase unavailable on this device: fall through to the environment
      // rather than reporting a storage error as a dead analytics property.
    }

    const fromEnvironment = this.config.refreshToken?.trim() ?? "";
    this.resolvedRefreshToken = fromEnvironment;
    this.tokenSource = fromEnvironment ? "GA4_REFRESH_TOKEN" : "none";
    return fromEnvironment;
  }

  private async hasCredentials(): Promise<boolean> {
    const refreshToken = await this.resolveRefreshToken();
    return Boolean(
      this.propertyId && this.config.clientId && this.config.clientSecret && refreshToken,
    );
  }

  async health(): Promise<ConnectorHealth> {
    if (!(await this.hasCredentials())) {
      return {
        providerId: this.providerId,
        providerKind: this.providerKind,
        available: false,
        authenticated: false,
        readOnly: true,
        safeMessage:
          "GA4 is not configured. A property id, Google OAuth client, and a stored google-analytics grant are all required.",
      };
    }

    try {
      // One-day, metric-only probe: the cheapest call that proves the grant
      // opens this property.
      const report = await this.runReport({
        dateRanges: [{ startDate: "yesterday", endDate: "yesterday" }],
        metrics: [{ name: "sessions" }],
      });
      return {
        providerId: this.providerId,
        providerKind: this.providerKind,
        available: true,
        authenticated: true,
        readOnly: true,
        safeMessage: `Authenticated for GA4 property ${this.propertyId}, timezone ${report.metadata?.timeZone ?? "unknown"}. Credential source: ${this.tokenSource}.`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown GA4 error.";
      return {
        providerId: this.providerId,
        providerKind: this.providerKind,
        available: true,
        authenticated: false,
        readOnly: true,
        safeMessage: `Credentials present but the GA4 property could not be read: ${message}`,
      };
    }
  }

  private async runReport(body: Record<string, unknown>): Promise<Ga4ReportResponse> {
    const refreshToken = await this.resolveRefreshToken();
    if (!refreshToken) {
      throw new ConnectorFailure(
        "unauthenticated",
        "GA4 has no stored google-analytics grant and no device-local refresh token.",
        false,
      );
    }

    const accessToken = await exchangeGoogleRefreshToken({
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
      refreshToken,
    });

    let response: Response;
    try {
      response = await fetch(
        `${GA4_DATA_API_BASE}/${this.apiVersion}/properties/${this.propertyId}:runReport`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // The credential travels in the header, never in the URL, so it
            // cannot leak through a logged or recorded request line.
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(body),
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Network error";
      throw new ConnectorFailure("unavailable", `GA4 Data API unreachable: ${message}`, true);
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw classifyGa4Error(response.status, detail);
    }

    return (await response.json()) as Ga4ReportResponse;
  }

  /**
   * Pulls one breakdown for a date range.
   *
   * Every report carries `date` as its first dimension, so each returned row is
   * one day at one grain. That is what makes the daily upsert idempotent: the
   * same pull repeated corrects a day instead of appending to it.
   */
  async fetchDailyMetrics(
    request: ConnectorRequest,
    breakdowns: Ga4Breakdown[] = ["total", "channel", "device"],
  ): Promise<Ga4FetchResult> {
    if (!(await this.hasCredentials())) {
      throw new ConnectorFailure(
        "unauthenticated",
        "GA4 Data API is missing credentials.",
        false,
      );
    }

    const warnings: string[] = [];
    const rows: Ga4DailyRow[] = [];
    const unmappedChannels = new Set<string>();
    let propertyTimezone = "";
    let reportedCurrency: string | undefined;

    for (const breakdown of breakdowns) {
      const dimensions =
        breakdown === "total"
          ? [{ name: "date" }]
          : [{ name: "date" }, { name: BREAKDOWN_DIMENSION[breakdown] }];

      let offset = 0;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const report = await this.runReport({
          dateRanges: [{ startDate: request.range.start, endDate: request.range.end }],
          dimensions,
          metrics: METRICS.map((name) => ({ name })),
          limit: PAGE_SIZE,
          offset,
          // Property-level quota keeps a scheduled pull from starving the UI.
          returnPropertyQuota: false,
        });

        propertyTimezone = report.metadata?.timeZone ?? propertyTimezone;
        reportedCurrency = report.metadata?.currencyCode ?? reportedCurrency;

        const pageRows = report.rows ?? [];
        for (const row of pageRows) {
          const dimensionValues = row.dimensionValues ?? [];
          const metricValues = row.metricValues ?? [];
          const date = toIsoDate(dimensionValues[0]?.value ?? "");
          if (!date) continue;

          let breakdownValue = "total";
          if (breakdown === "channel") {
            const raw = dimensionValues[1]?.value ?? "";
            const mapping = mapChannelGroup(raw);
            if (!mapping.mapped && raw) unmappedChannels.add(raw);
            breakdownValue = mapping.channel;
          } else if (breakdown === "device") {
            breakdownValue = mapDeviceCategory(dimensionValues[1]?.value ?? "");
          } else if (breakdown !== "total") {
            breakdownValue = dimensionValues[1]?.value?.trim() || "(not set)";
          }

          rows.push({
            date,
            breakdown,
            breakdownValue,
            sessions: toNumber(metricValues[0]?.value),
            activeUsers: toNumber(metricValues[1]?.value),
            bounceRate: toNumber(metricValues[2]?.value),
            averageSessionDurationSeconds: toNumber(metricValues[3]?.value),
            addToCarts: toNumber(metricValues[4]?.value),
            checkouts: toNumber(metricValues[5]?.value),
            ecommercePurchases: toNumber(metricValues[6]?.value),
            grossPurchaseRevenue: toNumber(metricValues[7]?.value),
            currency: this.config.currency ?? "USD",
            sourceQueryVersion: this.sourceQueryVersion,
            isProvisional: false,
          });
        }

        offset += pageRows.length;
        if (pageRows.length < PAGE_SIZE) break;
      }
    }

    // Channel and device rows are folded onto a five- and four-value
    // vocabulary, so two GA4 groups can land on one bucket. They are summed
    // here rather than written as duplicate keys, and the rate metrics are
    // recomputed as session-weighted averages, because a mean of means is wrong.
    const merged = mergeGa4Rows(rows);

    const today = propertyTimezone ? todayInTimezone(propertyTimezone) : "";
    const finalRows = merged.map((row) => ({
      ...row,
      isProvisional: Boolean(today) && row.date >= today,
    }));

    if (unmappedChannels.size > 0) {
      warnings.push(
        `GA4 returned channel group(s) with no place in the store vocabulary: ${[...unmappedChannels].toSorted().join(", ")}. Their sessions are counted under Unknown rather than being dropped or guessed.`,
      );
    }
    if (reportedCurrency && this.config.currency && reportedCurrency !== this.config.currency) {
      warnings.push(
        `GA4 reports ${reportedCurrency} for this property while the account contract is ${this.config.currency}. Revenue figures are stored under the account currency and must be reconciled before they are trusted.`,
      );
    }

    return {
      rows: finalRows,
      propertyTimezone,
      currency: this.config.currency ?? "USD",
      sourceQueryVersion: this.sourceQueryVersion,
      warnings,
    };
  }
}

/**
 * Sums rows that collapsed onto the same key, keeping rates honest.
 *
 * Bounce rate and average session duration are per-session averages, so they
 * are re-weighted by sessions instead of averaged. With no sessions on either
 * side the value stays at zero rather than dividing by nothing.
 */
export function mergeGa4Rows(rows: readonly Ga4DailyRow[]): Ga4DailyRow[] {
  const merged = new Map<string, Ga4DailyRow>();

  for (const row of rows) {
    const key = `${row.date}|${row.breakdown}|${row.breakdownValue}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...row });
      continue;
    }

    const totalSessions = existing.sessions + row.sessions;
    const weighted = (left: number, right: number): number =>
      totalSessions === 0
        ? 0
        : (left * existing.sessions + right * row.sessions) / totalSessions;

    merged.set(key, {
      ...existing,
      bounceRate: weighted(existing.bounceRate, row.bounceRate),
      averageSessionDurationSeconds: weighted(
        existing.averageSessionDurationSeconds,
        row.averageSessionDurationSeconds,
      ),
      sessions: totalSessions,
      activeUsers: existing.activeUsers + row.activeUsers,
      addToCarts: existing.addToCarts + row.addToCarts,
      checkouts: existing.checkouts + row.checkouts,
      ecommercePurchases: existing.ecommercePurchases + row.ecommercePurchases,
      grossPurchaseRevenue: existing.grossPurchaseRevenue + row.grossPurchaseRevenue,
    });
  }

  return [...merged.values()].toSorted((left, right) =>
    left.date !== right.date
      ? left.date < right.date
        ? -1
        : 1
      : left.breakdown !== right.breakdown
        ? left.breakdown < right.breakdown
          ? -1
          : 1
        : left.breakdownValue < right.breakdownValue
          ? -1
          : left.breakdownValue > right.breakdownValue
            ? 1
            : 0,
  );
}
