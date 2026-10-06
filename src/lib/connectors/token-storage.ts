import { createServiceClient } from "@/lib/supabase/server";
import { ACCOUNT_OPTIONS } from "@/lib/dashboard/accounts";

export interface ConnectorTokenRecord {
  id: string;
  platform: string;
  clientSlug: string;
  mccId?: string | null;
  customerId?: string | null;
  accessToken: string;
  /**
   * Null when the platform issues none. Meta grants a long-lived access token
   * with no refresh token; `expiresAt` is then the only lifetime there is.
   */
  refreshToken: string | null;
  tokenType: string;
  scope?: string | null;
  expiresAt?: string | null;
  status: "active" | "revoked" | "expired";
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertTokenInput {
  platform: string;
  clientSlug: string;
  mccId?: string;
  customerId?: string;
  accessToken: string;
  /** Omit, or pass null, when the platform issued no refresh token. */
  refreshToken?: string | null;
  tokenType?: string;
  scope?: string;
  expiresInSeconds?: number;
  metadata?: Record<string, unknown>;
}

interface StoredConnectorTokenRow {
  id: string;
  platform: string;
  client_slug: string;
  mcc_id: string | null;
  customer_id: string | null;
  access_token: string;
  refresh_token: string | null;
  token_type: string;
  scope: string | null;
  expires_at: string | null;
  status: "active" | "revoked" | "expired";
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

const CONNECTOR_TOKEN_COLUMNS = [
  "id",
  "platform",
  "client_slug",
  "mcc_id",
  "customer_id",
  "access_token",
  "refresh_token",
  "token_type",
  "scope",
  "expires_at",
  "status",
  "metadata",
  "created_at",
  "updated_at",
].join(", ");

function mapStoredConnectorToken(
  row: StoredConnectorTokenRow,
): ConnectorTokenRecord {
  return {
    id: row.id,
    platform: row.platform,
    clientSlug: row.client_slug,
    mccId: row.mcc_id,
    customerId: row.customer_id,
    accessToken: row.access_token,
    // Rows written before 0005 used an empty string for "none".
    refreshToken: row.refresh_token?.trim() ? row.refresh_token : null,
    tokenType: row.token_type,
    scope: row.scope,
    expiresAt: row.expires_at,
    status: row.status,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** A stored credential this close to expiry is reported before it breaks. */
export const TOKEN_EXPIRY_WARNING_DAYS = 7;

export interface TokenLifetime {
  /**
   * `no-expiry`: the provider stated none (or the token refreshes itself).
   * `expired`: must not be sent to the provider; the operator re-consents.
   */
  state: "no-expiry" | "valid" | "expiring-soon" | "expired";
  expiresAt: string | null;
  /** Whole days left, rounded down; null when there is no expiry. */
  daysRemaining: number | null;
}

/**
 * Judges a stored `expires_at`. Meta issues no refresh token, so its access
 * token simply stops working about 60 days after consent; this is the only
 * place that can say so before the provider does. An unparseable timestamp is
 * treated as expired, because a credential whose lifetime cannot be read must
 * not be trusted.
 */
export function classifyTokenLifetime(
  expiresAt: string | null | undefined,
  now: Date = new Date(),
): TokenLifetime {
  if (!expiresAt) {
    return { state: "no-expiry", expiresAt: null, daysRemaining: null };
  }

  const expiresAtMs = Date.parse(expiresAt);
  if (Number.isNaN(expiresAtMs) || expiresAtMs <= now.getTime()) {
    return { state: "expired", expiresAt, daysRemaining: 0 };
  }

  const daysRemaining = Math.floor((expiresAtMs - now.getTime()) / 86_400_000);
  return {
    state: daysRemaining < TOKEN_EXPIRY_WARNING_DAYS ? "expiring-soon" : "valid",
    expiresAt,
    daysRemaining,
  };
}

function resolveExpiresAt(expiresInSeconds: number | undefined): string | null {
  if (expiresInSeconds === undefined) return null;

  if (!Number.isFinite(expiresInSeconds) || expiresInSeconds < 0) {
    throw new Error("Connector token expiry must be a non-negative number.");
  }

  const expiresAt = new Date(Date.now() + expiresInSeconds * 1_000);
  if (Number.isNaN(expiresAt.getTime())) {
    throw new Error("Connector token expiry is outside the supported range.");
  }

  return expiresAt.toISOString();
}

function safeUpsertError(error: unknown): string {
  if (
    error instanceof Error &&
    (error.message === "Supabase worker secret is not configured." ||
      error.message === "Supabase project URL is not configured." ||
      error.message === "Supabase authentication is not available." ||
      error.message.startsWith("Connector token expiry"))
  ) {
    return error.message;
  }

  return "Connector token could not be stored.";
}

export async function upsertConnectorToken(
  input: UpsertTokenInput,
): Promise<
  | { ok: true; data: ConnectorTokenRecord }
  | { ok: false; error: string }
> {
  try {
    const supabase = createServiceClient();
    const updatedAt = new Date().toISOString();
    const { data, error } = await supabase
      .from("connector_tokens")
      .upsert(
        {
          platform: input.platform,
          client_slug: input.clientSlug,
          mcc_id: input.mccId ?? null,
          customer_id: input.customerId ?? null,
          access_token: input.accessToken,
          // Null, never an empty string, records "this platform issues none".
          refresh_token: input.refreshToken?.trim() ? input.refreshToken : null,
          token_type: input.tokenType ?? "Bearer",
          scope: input.scope ?? null,
          expires_at: resolveExpiresAt(input.expiresInSeconds),
          status: "active",
          metadata: input.metadata ?? {},
          updated_at: updatedAt,
        },
        { onConflict: "platform,client_slug" },
      )
      .select(CONNECTOR_TOKEN_COLUMNS)
      .single();

    if (error || !data) {
      return { ok: false, error: "Connector token could not be stored." };
    }

    return {
      ok: true,
      data: mapStoredConnectorToken(
        data as unknown as StoredConnectorTokenRow,
      ),
    };
  } catch (error) {
    return { ok: false, error: safeUpsertError(error) };
  }
}

/**
 * Returns the stored credential only while it is still active. A revoked row
 * must never be handed back: `/api/connectors/disconnect` marks the row
 * `revoked` rather than deleting it, so an unfiltered read would keep serving
 * a credential the operator believes they have disconnected.
 */
export async function getConnectorToken(
  platform: string,
  clientSlug: string,
): Promise<ConnectorTokenRecord | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("connector_tokens")
    .select(CONNECTOR_TOKEN_COLUMNS)
    .eq("platform", platform)
    .eq("client_slug", clientSlug)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    throw new Error("Connector token is unavailable.");
  }

  return data
    ? mapStoredConnectorToken(data as unknown as StoredConnectorTokenRow)
    : null;
}

/**
 * Reads only connector freshness metadata. Access and refresh tokens remain
 * outside the selected columns and can never reach Server Component props.
 */
export async function getLatestConnectorTokenUpdatedAt(
  clientSlug: string,
): Promise<string | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("connector_tokens")
    .select("updated_at")
    .eq("client_slug", clientSlug)
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error("Connector sync timestamp is unavailable.");
  }

  if (!data) return null;
  const updatedAt = (data as { updated_at?: unknown }).updated_at;
  return typeof updatedAt === "string" ? updatedAt : null;
}

/**
 * Brand slugs that currently hold at least one active credential.
 *
 * The scheduled job uses this to decide who to sync. Asking the database rather
 * than iterating every known brand means a brand nobody has connected yet costs
 * nothing and cannot fail a run: it is simply not in the list.
 */
export async function listActiveConnectorClientSlugs(): Promise<string[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("connector_tokens")
    .select("client_slug")
    .eq("status", "active");

  if (error) throw new Error("Connected clients could not be listed.");

  const slugs = new Set<string>();
  for (const row of (data ?? []) as { client_slug?: unknown }[]) {
    if (typeof row.client_slug === "string" && row.client_slug.trim()) {
      slugs.add(row.client_slug.trim());
    }
  }

  return [...slugs].toSorted();
}

/**
 * Customer ids stored against every active credential for one platform.
 *
 * Only the slug and the id are selected; no token column leaves the database.
 * The per-brand Google Ads resolver needs every brand's id at once, because a
 * collision between two brands can only be seen by comparing them.
 */
export async function listActiveConnectorCustomerIds(
  platform: string,
): Promise<{ clientSlug: string; customerId: string | null }[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("connector_tokens")
    .select("client_slug, customer_id")
    .eq("platform", platform)
    .eq("status", "active");

  if (error) throw new Error("Connector customer ids could not be listed.");

  return ((data ?? []) as { client_slug?: unknown; customer_id?: unknown }[])
    .filter((row): row is { client_slug: string; customer_id: unknown } =>
      typeof row.client_slug === "string" && row.client_slug.trim() !== "",
    )
    .map((row) => ({
      clientSlug: row.client_slug.trim(),
      customerId:
        typeof row.customer_id === "string" && row.customer_id.trim()
          ? row.customer_id.trim()
          : null,
    }));
}

/**
 * Last verified Google Ads account id carried by each brand's persisted rows.
 *
 * This is a recovery source, not a credential. Older environments can contain
 * valid live metrics from before `connector_tokens.customer_id` became the
 * account registry. Reading the latest account-level lineage lets those brands
 * keep refreshing without ever borrowing the pilot account id. Explicit token
 * and environment mappings still outrank this value in `google-ads-config`.
 *
 * Only one latest date is accepted per brand. If parallel lineages on that date
 * disagree, the brand is omitted and configuration fails closed.
 */
export async function listLatestHistoricalGoogleCustomerIds(): Promise<
  { clientSlug: string; customerId: string }[]
> {
  const googleSlugs = ACCOUNT_OPTIONS.filter((account) =>
    account.platforms.includes("google"),
  ).map((account) => account.slug);
  const supabase = createServiceClient();
  const { data: clients, error: clientsError } = await supabase
    .from("clients")
    .select("id, slug")
    .in("slug", googleSlugs);

  if (clientsError) {
    throw new Error("Historical Google Ads account registry is unavailable.");
  }

  const resolved = await Promise.all(
    ((clients ?? []) as { id: string; slug: string }[]).map(async (client) => {
      const { data, error } = await supabase
        .from("daily_metrics")
        .select("metric_date, provenance")
        .eq("client_id", client.id)
        .eq("platform", "google")
        .eq("entity_level", "account")
        .order("metric_date", { ascending: false })
        .order("synced_at", { ascending: false })
        .limit(20);

      if (error) {
        throw new Error("Historical Google Ads account registry is unavailable.");
      }

      const rows = (data ?? []) as {
        metric_date?: unknown;
        provenance?: { platform_account_id?: unknown } | null;
      }[];
      const latestDate = rows.find(
        (row) => typeof row.metric_date === "string",
      )?.metric_date;
      if (typeof latestDate !== "string") return null;

      const ids = new Set(
        rows
          .filter((row) => row.metric_date === latestDate)
          .map((row) => row.provenance?.platform_account_id)
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.replace(/[\s-]/g, ""))
          .filter((value) => /^\d{10}$/.test(value)),
      );

      if (ids.size !== 1) return null;
      return { clientSlug: client.slug, customerId: [...ids][0] as string };
    }),
  );

  return resolved.filter(
    (item): item is { clientSlug: string; customerId: string } => item !== null,
  );
}

/**
 * A refresh token granted on a manager account, for a brand that holds no
 * consent of its own.
 *
 * Every brand in a workspace sits under one Google Ads manager (MCC) and the operator
 * consents once, at the manager. The grant is therefore shared by
 * construction, and storing a fifth copy of the same secret under each brand
 * would not make it less shared — only harder to revoke, because a
 * disconnect would then have to find all five rows.
 *
 * What must never be shared is the customer id. That is what decides whose
 * data comes back, it is resolved per brand in `google-ads-config`, and two
 * brands resolving to the same one already refuse to sync. This function hands
 * back authorisation only; it cannot widen what a brand is allowed to read.
 *
 * The match on `mcc_id` is exact and mandatory. A row that records no manager
 * is not a donor, and a caller that cannot state its own manager id gets
 * nothing — a blank or mismatched manager fails closed rather than falling
 * back to "any active token".
 */
export async function getManagerScopedRefreshToken(
  platform: string,
  mccId: string,
): Promise<{ clientSlug: string; refreshToken: string } | null> {
  const row = await readManagerDonorRow(platform, mccId, "client_slug, refresh_token");
  return row ? { clientSlug: row.clientSlug, refreshToken: row.refreshToken } : null;
}

/**
 * The same donor row as `getManagerScopedRefreshToken`, with its metadata.
 *
 * A donor saved through the Data sources form carries its own OAuth client in
 * metadata, and its refresh token only works with that client. The Google Ads
 * config loader needs both to borrow the grant without breaking it. Server
 * only: the metadata of such a row holds application secrets.
 */
export async function getManagerScopedCredentialRecord(
  platform: string,
  mccId: string,
): Promise<{
  clientSlug: string;
  refreshToken: string;
  mccId: string;
  metadata: Record<string, unknown>;
} | null> {
  const row = await readManagerDonorRow(
    platform,
    mccId,
    "client_slug, refresh_token, mcc_id, metadata",
  );
  if (!row) return null;
  return {
    clientSlug: row.clientSlug,
    refreshToken: row.refreshToken,
    mccId: mccId.trim(),
    metadata: row.metadata,
  };
}

async function readManagerDonorRow(
  platform: string,
  mccId: string,
  columns: string,
): Promise<{
  clientSlug: string;
  refreshToken: string;
  metadata: Record<string, unknown>;
} | null> {
  const manager = mccId.trim();
  if (!manager) return null;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("connector_tokens")
    .select(columns)
    .eq("platform", platform)
    .eq("mcc_id", manager)
    .eq("status", "active")
    // Several brands may eventually hold their own consent on the same
    // manager. Any of them authorises the manager equally, so the most
    // recently refreshed one is taken: it is the least likely to have been
    // revoked upstream since it was written.
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error("Connector token is unavailable.");
  }

  const row = ((data ?? []) as unknown[])[0] as
    | { client_slug?: unknown; refresh_token?: unknown; metadata?: unknown }
    | undefined;
  const refreshToken =
    typeof row?.refresh_token === "string" && row.refresh_token.trim()
      ? row.refresh_token
      : null;
  const clientSlug =
    typeof row?.client_slug === "string" ? row.client_slug.trim() : "";

  if (!refreshToken || !clientSlug) return null;

  const metadata =
    row?.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {};

  return { clientSlug, refreshToken, metadata };
}

export interface DirectGoogleAdsCredentialInput {
  clientSlug: string;
  /** Normalised 10-digit id. */
  customerId: string;
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** Normalised 10-digit manager id, or null for direct account access. */
  loginCustomerId: string | null;
  /** `GOOGLE_ADS_DIRECT_INPUT_SOURCE`; passed in to keep this module config-free. */
  configuredVia: string;
}

/**
 * Stores a credential set an operator typed into the Data sources form.
 *
 * The refresh token keeps its own column, as every other grant does; the
 * application credentials that must travel with it go into `metadata`, which
 * shares the table's service-role-only boundary (0004). No access token is
 * stored: the connector mints a fresh one from the refresh token on every run,
 * so keeping one would only be one more secret at rest. The column is NOT NULL,
 * so the empty string records "none", exactly as it did for refresh tokens
 * before 0005.
 *
 * Returns the stored record's non-secret identity only. The full record holds
 * every secret just written, and nothing a route returns should be able to
 * carry it by accident.
 */
export async function upsertDirectGoogleAdsCredentials(
  input: DirectGoogleAdsCredentialInput,
): Promise<
  | { ok: true; data: { clientSlug: string; customerId: string | null; updatedAt: string } }
  | { ok: false; error: string }
> {
  const updatedAt = new Date().toISOString();
  const result = await upsertConnectorToken({
    platform: "google-ads",
    clientSlug: input.clientSlug,
    mccId: input.loginCustomerId ?? undefined,
    customerId: input.customerId,
    accessToken: "",
    refreshToken: input.refreshToken,
    scope: "https://www.googleapis.com/auth/adwords",
    metadata: {
      developerToken: input.developerToken,
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      loginCustomerId: input.loginCustomerId,
      configuredVia: input.configuredVia,
      updatedAt,
    },
  });

  if (!result.ok) return result;

  return {
    ok: true,
    data: {
      clientSlug: result.data.clientSlug,
      customerId: result.data.customerId ?? null,
      updatedAt: result.data.updatedAt,
    },
  };
}

export async function revokeConnectorToken(
  platform: string,
  clientSlug: string,
): Promise<boolean> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("connector_tokens")
    .update({
      status: "revoked",
      updated_at: new Date().toISOString(),
    })
    .eq("platform", platform)
    .eq("client_slug", clientSlug)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error("Connector token could not be revoked.");
  }

  return data !== null;
}
