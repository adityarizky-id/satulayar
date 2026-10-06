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
}

/**
 * Stores a Google Ads credential set an operator typed into the Data sources
 * form, for one brand.
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
 *   3. The set is verified against Google before it replaces anything. The
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
  if (!hasPermission(auth.context.access.role, "sync:trigger")) {
    return privateJson(
      { error: "Your role cannot change data source credentials." },
      { status: 403 },
    );
  }

  if (body.platform !== GOOGLE_ADS_TOKEN_PLATFORM) {
    return privateJson(
      { error: "Only Google Ads credentials can be saved here." },
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
  });

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
