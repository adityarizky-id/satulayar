import { NextRequest } from "next/server";

import { hasPermission } from "@/lib/auth/authorization";
import { resolveClientScope } from "@/lib/auth/client-scope";
import {
  authFailureResponse,
  isSameOriginRequest,
  privateJson,
} from "@/lib/auth/http";
import { resolveAuthContext } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/activity-log";
import { GoogleAdsApiClient } from "@/lib/connectors/google-ads-api-client";
import {
  GOOGLE_ADS_DIRECT_INPUT_SOURCE,
  GOOGLE_ADS_TOKEN_PLATFORM,
  redactSubmittedSecrets,
  resolveGoogleAdsConfig,
  validateGoogleAdsCredentialInput,
  type StoredCustomerId,
} from "@/lib/connectors/google-ads-config";
import {
  listActiveConnectorCustomerIds,
  listLatestHistoricalGoogleCustomerIds,
  upsertDirectGoogleAdsCredentials,
} from "@/lib/connectors/token-storage";
import { resolveAccount } from "@/lib/dashboard/accounts";
import { exchangeGoogleRefreshToken } from "@/lib/connectors/google-oauth-token";
import { validatePlatformCredentials } from "@/lib/connectors/types";
import { listActiveMetaAccountConfigurations, upsertConnectorToken } from "@/lib/connectors/token-storage";

export const runtime = "nodejs";

interface SaveCredentialsRequest {
  platform?: unknown;
  clientSlug?: unknown;
  customerId?: unknown;
  developerToken?: unknown;
  clientId?: unknown;
  clientSecret?: unknown;
  refreshToken?: unknown;
  loginCustomerId?: unknown;
  accessToken?: unknown;
  apiVersion?: unknown;
  tokenExpiresAt?: unknown;
  campaignNameFilter?: unknown;
  propertyId?: unknown;
}

/**
 * Verifies and stores a platform credential set entered in Data sources for
 * one explicit brand. Meta and GA4 use the direct-platform handler below;
 * the Google Ads path retains its account-history checks.
 *
 * Order matters and is deliberate:
 *
 *   1. The brand is named explicitly and validated before the session is
 *      checked, so the role check applies to the brand being written. Absence
 *      is refused rather than defaulted to the pilot: a write that silently
 *      landed on another brand's row is the failure this route exists to rule
 *      out.
 *   2. The customer id is checked against every other brand before anything is
 *      stored. Two brands on one account refuse to sync, so an unchecked save
 *      here would let one brand's editor stop another brand's reporting.
 *   3. The set is verified against its provider before it replaces anything. The
 *      save overwrites the brand's current credential; storing an unverified
 *      set would turn a typo into a broken connector with no way back to the
 *      one that worked.
 *
 * Secrets travel inbound only. The response, the audit row, and every error
 * message are built from identifiers and fixed copy, and provider text is
 * scrubbed against the submitted values before it is returned.
 */
export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return privateJson({ error: "Request origin is not allowed." }, { status: 403 });
  }

  let body: SaveCredentialsRequest;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    body = parsed as SaveCredentialsRequest;
  } catch {
    return privateJson({ error: "Request body must be a JSON object." }, { status: 400 });
  }

  if (typeof body.clientSlug !== "string" || !body.clientSlug.trim()) {
    return privateJson(
      { error: "Choose the brand these credentials belong to before saving." },
      { status: 400 },
    );
  }

  const scope = resolveClientScope(body.clientSlug);
  if (!scope.ok) return privateJson({ error: scope.message }, { status: 400 });

  const auth = await resolveAuthContext(scope.clientSlug);
  if (!auth.ok) return authFailureResponse(auth);
  if (process.env.NODE_ENV === "production" && auth.context.mode !== "supabase") {
    return privateJson({ error: "Credential changes require a signed-in workspace session. Preview mode cannot save credentials on a deployed server." }, { status: 403 });
  }
  if (!hasPermission(auth.context.access.role, "sync:trigger")) {
    return privateJson(
      { error: "Your role cannot change data source credentials." },
      { status: 403 },
    );
  }

  if (body.platform !== GOOGLE_ADS_TOKEN_PLATFORM) {
    if (body.platform === "meta-ads" || body.platform === "google-analytics") {
      return saveDirectPlatformCredentials(body as Record<string, unknown>, auth.context, scope.clientSlug);
    }
    return privateJson(
      { error: "This platform does not support credential setup yet." },
      { status: 400 },
    );
  }

  const account = resolveAccount(scope.clientSlug);
  if (!account.platforms.includes("google")) {
    return privateJson(
      { error: `${account.name} does not run Google Ads, so there is nothing to connect.` },
      { status: 400 },
    );
  }

  const validation = validateGoogleAdsCredentialInput(body as Record<string, unknown>);
  if (!validation.ok) {
    return privateJson(
      { error: validation.safeMessage, field: validation.field },
      { status: 400 },
    );
  }
  const input = validation.value;
  const submittedSecrets = [input.developerToken, input.clientSecret, input.refreshToken];
  const scrub = (message: string) => redactSubmittedSecrets(message, submittedSecrets);

  let storedCustomerIds: StoredCustomerId[];
  let historicalCustomerIds: StoredCustomerId[];
  try {
    [storedCustomerIds, historicalCustomerIds] = await Promise.all([
      listActiveConnectorCustomerIds(GOOGLE_ADS_TOKEN_PLATFORM),
      listLatestHistoricalGoogleCustomerIds(),
    ]);
  } catch {
    return privateJson(
      {
        error:
          "The Google Ads account registry is unavailable, so this customer ID cannot be checked against the other brands. Nothing was saved; try again shortly.",
      },
      { status: 503 },
    );
  }

  // Resolve exactly as a sync would after the save: this brand's row replaced
  // by the submitted id and set, every other brand as it stands today.
  const resolution = resolveGoogleAdsConfig(scope.clientSlug, {
    storedCustomerIds: [
      ...storedCustomerIds.filter((row) => row.clientSlug !== scope.clientSlug),
      { clientSlug: scope.clientSlug, customerId: input.customerId },
    ],
    historicalCustomerIds,
    storedCredentials: {
      own: {
        developerToken: input.developerToken,
        clientId: input.clientId,
        clientSecret: input.clientSecret,
        refreshToken: input.refreshToken,
        loginCustomerId: input.loginCustomerId,
      },
    },
  });
  if (!resolution.ok) {
    return privateJson(
      {
        error: `${resolution.safeMessage} Nothing was saved.`,
        field: "customerId",
      },
      { status: resolution.state === "collision" ? 409 : 400 },
    );
  }

  const health = await new GoogleAdsApiClient(resolution.config).health();
  if (!health.authenticated) {
    return privateJson(
      {
        error: scrub(
          `Google Ads did not accept these credentials, so nothing was saved and the current connection is unchanged. ${health.safeMessage}`,
        ),
      },
      { status: 422 },
    );
  }

  const saved = await upsertDirectGoogleAdsCredentials({
    clientSlug: scope.clientSlug,
    customerId: input.customerId,
    developerToken: input.developerToken,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    refreshToken: input.refreshToken,
    loginCustomerId: input.loginCustomerId,
    configuredVia: GOOGLE_ADS_DIRECT_INPUT_SOURCE,
  });
  if (!saved.ok) {
    return privateJson(
      {
        error: `The credentials were verified but could not be stored, so this brand is not connected. ${saved.error}`,
      },
      { status: 503 },
    );
  }

  // Identifiers only. `sanitiseAuditDetail` would redact a key naming a token,
  // which is why the refresh grant is recorded as `refreshGrantSupplied`.
  const audit = await recordAuditEvent({
    clientId: auth.context.access.clientId,
    actorUserId: auth.context.userId,
    actorEmail: auth.context.email,
    actorRole: auth.context.access.role,
    action: "connector.credentials_saved",
    subject: GOOGLE_ADS_TOKEN_PLATFORM,
    detail: {
      clientSlug: scope.clientSlug,
      customerId: input.customerId,
      managerAccountConfigured: input.loginCustomerId !== null,
      refreshGrantSupplied: true,
      verifiedBeforeSave: true,
      configuredVia: GOOGLE_ADS_DIRECT_INPUT_SOURCE,
    },
  }).catch(() => ({ ok: false }));

  return privateJson({
    ok: true,
    platform: GOOGLE_ADS_TOKEN_PLATFORM,
    clientSlug: scope.clientSlug,
    targetAccount: `Customer •••• ${input.customerId.slice(-4)}`,
    savedAt: saved.data.updatedAt,
    verification: scrub(health.safeMessage),
    auditRecorded: audit.ok,
    message: "Google Ads credentials saved successfully.",
  });
}

/** Fixed provider origins, bounded requests, and fixed errors keep secrets out of responses. */
async function saveDirectPlatformCredentials(
  body: Record<string, unknown>,
  auth: Extract<Awaited<ReturnType<typeof resolveAuthContext>>, { ok: true }>["context"],
  clientSlug: string,
) {
  const platform = body.platform as "meta-ads" | "google-analytics";
  const invalid = validatePlatformCredentials(platform, body);
  if (invalid) return privateJson({ error: invalid.message, field: invalid.field }, { status: 400 });
  const value = (key: string) => typeof body[key] === "string" ? body[key].trim() : "";
  const account = resolveAccount(clientSlug);
  if (platform === "meta-ads" && !account.platforms.includes("meta")) {
    return privateJson({ error: "This brand does not run Meta Ads." }, { status: 400 });
  }
  // Verify the persistence/registry prerequisite before transmitting credentials.
  try {
    const registry = platform === "meta-ads"
      ? await listActiveMetaAccountConfigurations()
      : await listActiveConnectorCustomerIds(platform);
    const customerId = platform === "meta-ads" ? value("customerId").replace(/^act_/, "") : value("propertyId");
    const filter = value("campaignNameFilter").toLowerCase();
    const collision = registry.some((row) => {
      if (row.clientSlug === clientSlug || row.customerId !== customerId) return false;
      if (platform === "google-analytics") return true;
      const other = "campaignFilter" in row ? String(row.campaignFilter ?? "").toLowerCase() : "";
      return !filter || !other || filter.includes(other) || other.includes(filter);
    });
    if (collision) return privateJson({ error: "This account is already mapped to another brand. Shared Meta accounts need distinct, non-overlapping campaign filters.", field: platform === "meta-ads" ? "campaignNameFilter" : "propertyId" }, { status: 409 });

    if (platform === "meta-ads") {
      const base = `https://graph.facebook.com/${value("apiVersion")}/act_${customerId}`;
      const headers = { Authorization: `Bearer ${value("accessToken")}` };
      const response = await fetch(`${base}?fields=id,currency,timezone_name`, { headers, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000) });
      if (!response.ok) return privateJson({ error: "Meta could not verify this token and ad account. Check account access, token expiry and the API version. Nothing was saved." }, { status: 422 });
      const verified = await response.json() as { id?: string; currency?: string };
      if (verified.id?.replace(/^act_/, "") !== customerId || verified.currency !== account.currency) {
        return privateJson({ error: "The account identity or native currency does not match this brand. Nothing was saved.", field: "customerId" }, { status: 422 });
      }
      const insights = await fetch(`${base}/insights?fields=spend&date_preset=yesterday&limit=1`, { headers, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000) });
      if (!insights.ok) return privateJson({ error: "Meta account access works, but reporting access was denied. Check ads_read and read_insights. Nothing was saved." }, { status: 422 });
    } else {
      const accessToken = await exchangeGoogleRefreshToken({ clientId: value("clientId"), clientSecret: value("clientSecret"), refreshToken: value("refreshToken") });
      const response = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${customerId}:runReport`, {
        method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ dateRanges: [{ startDate: "yesterday", endDate: "yesterday" }], metrics: [{ name: "sessions" }], limit: 1 }),
        cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) return privateJson({ error: "GA4 could not read this property. Check the property ID, analytics.readonly grant and enabled Data API. Nothing was saved." }, { status: 422 });
    }
    const saved = await upsertConnectorToken({
      platform, clientSlug, customerId,
      accessToken: platform === "meta-ads" ? value("accessToken") : "",
      refreshToken: platform === "google-analytics" ? value("refreshToken") : null,
      expiresInSeconds: platform === "meta-ads" ? Math.floor((Date.parse(value("tokenExpiresAt")) - Date.now()) / 1000) : undefined,
      scope: platform === "meta-ads" ? "ads_read read_insights" : "https://www.googleapis.com/auth/analytics.readonly",
      metadata: platform === "meta-ads"
        ? { configuredVia: "direct_platform_form", campaignFilter: value("campaignNameFilter"), campaignPrefixes: [], apiVersion: value("apiVersion"), expirySource: "operator" }
        : { configuredVia: "direct_platform_form", clientId: value("clientId"), clientSecret: value("clientSecret") },
    });
    if (!saved.ok) return privateJson({ error: "API access was verified, but the save could not be confirmed. Reopen Data sources before retrying; secure storage may be unavailable." }, { status: 503 });
    const audit = await recordAuditEvent({ clientId: auth.access.clientId, actorUserId: auth.userId, actorEmail: auth.email, actorRole: auth.access.role, action: "connector.credentials_saved", subject: platform, detail: { clientSlug, verifiedBeforeSave: true, configuredVia: "direct_platform_form" } }).catch(() => ({ ok: false }));
    return privateJson({ ok: true, platform, clientSlug, targetAccount: `${platform === "meta-ads" ? "Account" : "Property"} •••• ${customerId.slice(-4)}`, savedAt: saved.data.updatedAt, expiresAt: saved.data.expiresAt, verification: "Read-only reporting access verified.", auditRecorded: audit.ok, message: "Credentials verified and saved. Live reporting remains subject to runtime readiness." });
  } catch {
    return privateJson({ error: "Verification or secure storage is unavailable. The submitted credentials were not saved. Check connectivity and retry." }, { status: 503 });
  }
}
