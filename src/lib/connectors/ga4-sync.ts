import { PILOT_CLIENT_SLUG } from "@/lib/auth/constants";
import { Ga4ApiClient, type Ga4Breakdown, type Ga4DailyRow } from "@/lib/connectors/ga4-api-client";
import { ConnectorFailure } from "@/lib/connectors/types";
import type { Currency, DateRange } from "@/lib/dashboard/types";

/**
 * Lands GA4 rows in `ga4_daily_metrics`.
 *
 * Runs alongside the advertising sync rather than inside it. The two sources
 * describe different things — GA4 the website, the platforms their own ad
 * accounts — so a GA4 outage must not fail an advertising refresh that
 * succeeded, and vice versa. Each reports its own outcome.
 */

/** Breakdowns a scheduled or backfill run stores. */
export const GA4_SYNC_BREAKDOWNS: Ga4Breakdown[] = [
  "total",
  "channel",
  "device",
  "landingPage",
  "country",
];

/** Long-format `breakdown` values, which are snake_case in the database. */
const BREAKDOWN_COLUMN: Record<Ga4Breakdown, string> = {
  total: "total",
  channel: "channel",
  device: "device",
  landingPage: "landing_page",
  country: "country",
  city: "city",
};

/**
 * GA4 property for one brand, from the environment.
 *
 * Per-brand first (`GA4_PROPERTY_ID_JAMU_ALAMI`). The unsuffixed
 * `GA4_PROPERTY_ID` is the pilot's property and is served to the pilot alone —
 * a named brand never inherits it.
 *
 * The property id decides whose website traffic comes back, exactly as a
 * Google Ads customer id decides whose account is read, and it carries the same
 * hazard: while every brand fell back to the unsuffixed variable, a backfill
 * across all brands would have pulled the pilot's property five times and
 * written it into `ga4_daily_metrics` under four other brands' client ids. RLS
 * would not have caught it, because the operator is a member of all five, so
 * the rows would simply have been mislabelled.
 *
 * A brand with no property of its own therefore resolves to "", and
 * `persistGa4Sync` skips it. Property ids are account identifiers, so they live
 * in deployment configuration and never in source.
 */
export function resolveGa4PropertyId(
  clientSlug: string | undefined,
  // A plain record rather than ProcessEnv: the function reads two keys, and a
  // caller (or a test) should be able to hand it exactly those two.
  environment: Record<string, string | undefined> = process.env,
): string {
  const fallback = environment.GA4_PROPERTY_ID?.trim() ?? "";

  // No brand named at all: the caller is asking for the default property, and
  // the unsuffixed variable is exactly that. This is not inheritance — there is
  // no brand here to mislabel rows under.
  if (!clientSlug) return fallback;

  const slug = clientSlug.trim();
  const key = `GA4_PROPERTY_ID_${slug.toUpperCase().replace(/-/g, "_")}`;
  const scoped = environment[key]?.trim();
  if (scoped) return scoped;

  return slug === PILOT_CLIENT_SLUG ? fallback : "";
}

export interface Ga4SyncInput {
  clientId: string;
  range: DateRange;
  currency: Currency;
  /** Overridable so a caller can pin a property per brand. */
  propertyId?: string;
  clientSlug?: string;
}

export type Ga4SyncOutcome = "succeeded" | "skipped" | "failed";

export interface Ga4SyncResult {
  outcome: Ga4SyncOutcome;
  rowsUpserted: number;
  propertyTimezone: string | null;
  warnings: string[];
  /** Operator-safe copy. Never a credential or a raw API body. */
  safeMessage: string;
}

/**
 * Maps one connector row onto its database shape.
 *
 * `property_id` is written but never read by the client: the same rule the ad
 * account ids follow, because a property id identifies an account.
 */
function toStoredRow(
  row: Ga4DailyRow,
  input: Ga4SyncInput,
  propertyId: string,
  syncedAt: string,
): Record<string, unknown> {
  return {
    metric_date: row.date,
    client_id: input.clientId,
    property_id: propertyId,
    breakdown: BREAKDOWN_COLUMN[row.breakdown],
    breakdown_value: row.breakdownValue,
    currency: input.currency,
    sessions: Math.round(row.sessions),
    active_users: Math.round(row.activeUsers),
    // The column is constrained to 0..1; GA4 occasionally returns a hair over
    // 1 on a rounded rate, and a rejected batch would lose the whole day.
    bounce_rate: Math.min(Math.max(row.bounceRate, 0), 1),
    average_session_duration_seconds: Math.max(row.averageSessionDurationSeconds, 0),
    add_to_carts: Math.round(row.addToCarts),
    checkouts: Math.round(row.checkouts),
    ecommerce_purchases: Math.round(row.ecommercePurchases),
    gross_purchase_revenue: Math.max(row.grossPurchaseRevenue, 0),
    source_connector: "ga4-direct-api",
    source_query_version: row.sourceQueryVersion,
    synced_at: syncedAt,
    is_provisional: row.isProvisional,
    provenance: {
      kind: "live-ga4",
      schema_version: 1,
      // Server-side audit only; no client query selects this column.
      property_id: propertyId,
      breakdown: row.breakdown,
    },
    updated_at: syncedAt,
  };
}

/**
 * Pulls and stores one window.
 *
 * Skips rather than fails when GA4 is not configured: until the operator's device
 * grants consent and sets a property id there is nothing to read, and that is a
 * known state, not an incident. Everything else fails closed and says why.
 */
export async function persistGa4Sync(input: Ga4SyncInput): Promise<Ga4SyncResult> {
  const propertyId = (
    input.propertyId ?? resolveGa4PropertyId(input.clientSlug)
  ).trim();
  if (!propertyId) {
    return {
      outcome: "skipped",
      rowsUpserted: 0,
      propertyTimezone: null,
      warnings: [],
      safeMessage:
        "GA4 is not configured for this client, so no analytics rows were pulled. Connect Google Analytics and set the property id to enable it.",
    };
  }

  const client = new Ga4ApiClient({
    propertyId,
    clientId: process.env.GOOGLE_ADS_CLIENT_ID ?? process.env.GA4_CLIENT_ID,
    clientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET ?? process.env.GA4_CLIENT_SECRET,
    refreshToken: process.env.GA4_REFRESH_TOKEN,
    clientSlug: input.clientSlug,
    currency: input.currency,
  });

  const health = await client.health();
  if (!health.authenticated) {
    return {
      outcome: "skipped",
      rowsUpserted: 0,
      propertyTimezone: null,
      warnings: [],
      safeMessage: `GA4 was not read: ${health.safeMessage}`,
    };
  }

  try {
    const result = await client.fetchDailyMetrics(
      { clientId: input.clientId, accountKey: propertyId, range: input.range },
      GA4_SYNC_BREAKDOWNS,
    );

    if (result.rows.length === 0) {
      return {
        outcome: "succeeded",
        rowsUpserted: 0,
        propertyTimezone: result.propertyTimezone || null,
        warnings: result.warnings,
        safeMessage: "GA4 returned no rows for this period.",
      };
    }

    const { createServiceClient } = await import("@/lib/supabase/server");
    const supabase = createServiceClient();
    const syncedAt = new Date().toISOString();
    const rows = result.rows.map((row) => toStoredRow(row, input, propertyId, syncedAt));

    const { error } = await supabase.from("ga4_daily_metrics").upsert(rows, {
      // The table's unique key. Re-running a window corrects each day instead
      // of appending a second copy of it.
      onConflict:
        "metric_date,client_id,property_id,breakdown,breakdown_value,source_query_version",
    });

    if (error) {
      return {
        outcome: "failed",
        rowsUpserted: 0,
        propertyTimezone: result.propertyTimezone || null,
        warnings: result.warnings,
        safeMessage: "GA4 rows could not be stored, so none were published.",
      };
    }

    return {
      outcome: "succeeded",
      rowsUpserted: rows.length,
      propertyTimezone: result.propertyTimezone || null,
      warnings: result.warnings,
      safeMessage: `GA4 stored ${rows.length} row(s) across ${GA4_SYNC_BREAKDOWNS.length} breakdown(s).`,
    };
  } catch (error) {
    // ConnectorFailure messages are written by this codebase to stay free of
    // credentials and raw provider bodies.
    const safeMessage =
      error instanceof ConnectorFailure
        ? `GA4 pull failed: ${error.message}`
        : "GA4 pull failed for an unrecognised reason.";

    return {
      outcome: "failed",
      rowsUpserted: 0,
      propertyTimezone: null,
      warnings: [],
      safeMessage,
    };
  }
}
