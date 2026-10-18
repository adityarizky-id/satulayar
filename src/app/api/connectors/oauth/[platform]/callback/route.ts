import { NextRequest, NextResponse } from "next/server";

import { hasPermission } from "@/lib/auth/authorization";
import { resolveClientScope } from "@/lib/auth/client-scope";
import { resolveAuthContext } from "@/lib/auth/session";
import { privateJson, authFailureResponse } from "@/lib/auth/http";
import { POST as verifyAndSaveCredentials } from "@/app/api/connectors/credentials/route";
import {
  exchangeOAuthCode,
  OAUTH_PLATFORMS,
  resolveOAuthCallbackUrl,
  validateCSRFState,
  openOAuthSession,
  sealOAuthSession,
  oauthPopupResponse,
  popupCookieOptions,
  type PopupOAuthSession,
} from "@/lib/connectors/oauth";
import { recordAuditEvent } from "@/lib/audit/activity-log";
import { resolveGoogleAdsCustomerId } from "@/lib/connectors/google-ads-config";
import { upsertConnectorToken } from "@/lib/connectors/token-storage";

export const runtime = "nodejs";

interface PopupResult {
  createdAt: number;
  state: string;
  clientSlug: string;
  userId: string;
  result: Record<string, unknown>;
}

async function readPopupResult(request: NextRequest, platform: string) {
  const scope = resolveClientScope(request.nextUrl.searchParams.get("client"));
  if (!scope.ok) return privateJson({ error: "Choose a valid brand." }, { status: 400 });
  const auth = await resolveAuthContext(scope.clientSlug);
  if (!auth.ok) return authFailureResponse(auth);
  if (!hasPermission(auth.context.access.role, "sync:trigger")) return privateJson({ error: "Editor access is required." }, { status: 403 });
  const result = openOAuthSession<PopupResult>(request.cookies.get(`oauth_result_${platform}`)?.value);
  if (!result || result.state !== request.nextUrl.searchParams.get("connection_result") || result.userId !== auth.context.userId || result.clientSlug !== scope.clientSlug) return privateJson({ pending: true }, { status: 202 });
  return privateJson(result.result);
}

async function completePopup(request: NextRequest, platform: string, pending: PopupOAuthSession) {
  const finish = (result: Record<string, unknown>) => {
    const response = oauthPopupResponse(platform, result.ok === true);
    response.cookies.set(`oauth_result_${platform}`, sealOAuthSession({ state: pending.state, clientSlug: pending.clientSlug, userId: pending.userId, createdAt: Date.now(), result }), popupCookieOptions());
    for (const name of ["state", "client", "popup"]) response.cookies.delete(`oauth_${name}_${platform}`);
    return response;
  };
  const fail = (error: string) => finish({ ok: false, error });
  const scope = resolveClientScope(pending.clientSlug);
  if (!scope.ok || pending.platform !== platform) return fail("The connection session is invalid. Start again from Data sources.");
  const auth = await resolveAuthContext(scope.clientSlug);
  if (!auth.ok || pending.userId !== auth.context.userId || !hasPermission(auth.context.access.role, "sync:trigger") || (process.env.NODE_ENV === "production" && auth.context.mode !== "supabase")) return fail("Your workspace session changed. Sign in again before connecting.");
  const state = request.nextUrl.searchParams.get("state") ?? "";
  if (state !== pending.state || !validateCSRFState(platform, state, request.cookies.get(`oauth_state_${platform}`)?.value)) return fail("The authorization session expired or did not match. Start again.");
  if (request.nextUrl.searchParams.has("error")) return fail("Google authorization was cancelled or access was not granted. You can try again.");
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return fail("Google did not return an authorization code. Try connecting again.");
  try {
    const config = { ...OAUTH_PLATFORMS[platform], clientId: pending.fields.clientId, clientSecret: pending.fields.clientSecret };
    const tokens = await exchangeOAuthCode(config, code, resolveOAuthCallbackUrl(request, platform));
    if (!tokens.ok) return fail("Google could not complete authorization. Check the OAuth app and callback URL, then try again.");
    if (!tokens.refreshToken) return fail("Ongoing reporting access was not granted. Reconnect and approve the requested reporting permission.");
    if (tokens.scope && !config.scopes.every((required) => tokens.scope!.split(" ").includes(required))) return fail("The required reporting permission was not granted. Reconnect and approve access.");
    // Reuse the same account isolation, provider probe and persistence path as
    // the manual form. A valid consent alone never paints the connector green.
    const headers = new Headers(request.headers);
    headers.set("origin", request.nextUrl.origin);
    headers.set("Content-Type", "application/json");
    const verified = await verifyAndSaveCredentials(new NextRequest(new URL("/api/connectors/credentials", request.nextUrl.origin), {
      method: "POST", headers,
      body: JSON.stringify({ platform, clientSlug: scope.clientSlug, ...pending.fields, refreshToken: tokens.refreshToken }),
    }));
    const summary = await verified.json() as Record<string, unknown>;
    if (!verified.ok || summary.ok !== true) return fail(verified.status === 409
      ? "This target account conflicts with another brand. Check the brand's account mapping before reconnecting."
      : verified.status === 422
        ? "Google authorization completed, but reporting access was not verified. Check the selected account, developer token and reporting permissions."
        : "Google authorization completed, but verification or secure storage could not be confirmed. Reopen Data sources to check the current connection before retrying.");
    // Explicit safe projection: no future change to the save route can put a
    // credential into the browser-readable result channel.
    return finish({ ok: true, platform, clientSlug: scope.clientSlug, targetAccount: summary.targetAccount, savedAt: summary.savedAt, verification: "Google reporting access verified.", auditRecorded: summary.auditRecorded === true, message: "Connected successfully." });
  } catch { return fail("Connection verification could not finish. Reopen Data sources to check the current connection before retrying."); }
}

/**
 * Redirect for a failed connection attempt. Carries a fixed error code and the
 * platform, and never provider-supplied text: this URL is written to browser
 * history and may be forwarded in a referrer.
 */
function failureRedirect(
  request: NextRequest,
  platform: string,
  code: string,
): URL {
  const url = new URL("/data-sources", request.nextUrl.origin);
  url.searchParams.set("oauth_error", code);
  url.searchParams.set("platform", platform);
  return url;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ platform: string }> },
) {
  const { platform } = await context.params;
  const searchParams = request.nextUrl.searchParams;
  if (searchParams.has("connection_result")) return readPopupResult(request, platform);
  const popupCookie = request.cookies.get(`oauth_popup_${platform}`)?.value;
  if (popupCookie) {
    const pending = openOAuthSession<PopupOAuthSession>(popupCookie);
    if (pending) return completePopup(request, platform, pending);
    return oauthPopupResponse(platform, false);
  }

  // The brand this consent belongs to, as recorded by the authorize step. It is
  // re-validated here: a cookie is caller-controlled, and this value decides
  // whose `connector_tokens` row the credential lands in.
  const scope = resolveClientScope(
    request.cookies.get(`oauth_client_${platform}`)?.value,
  );
  if (!scope.ok) {
    return NextResponse.redirect(
      failureRedirect(request, platform, "unknown_client"),
    );
  }

  const auth = await resolveAuthContext(scope.clientSlug);
  if (!auth.ok) {
    const signInUrl = new URL("/sign-in", request.nextUrl.origin);
    return NextResponse.redirect(signInUrl);
  }

  if (!hasPermission(auth.context.access.role, "sync:trigger")) {
    const errorUrl = new URL("/data-sources?oauth_error=unauthorized", request.nextUrl.origin);
    return NextResponse.redirect(errorUrl);
  }

  const oauthError = searchParams.get("error");
  if (oauthError) {
    return NextResponse.redirect(
      failureRedirect(request, platform, "consent_denied"),
    );
  }

  const code = searchParams.get("code");
  const state = searchParams.get("state");

  if (!code || !state) {
    return NextResponse.redirect(
      failureRedirect(request, platform, "missing_code_or_state"),
    );
  }

  const cookieState = request.cookies.get(`oauth_state_${platform}`)?.value;
  const isValidState = validateCSRFState(platform, state, cookieState);

  if (!isValidState) {
    return NextResponse.redirect(
      failureRedirect(request, platform, "invalid_state"),
    );
  }

  const config = OAUTH_PLATFORMS[platform];
  if (!config) {
    return NextResponse.redirect(
      failureRedirect(request, platform, "unsupported_platform"),
    );
  }

  // Must be the same origin the authorize step sent, and for the same reason:
  // it is taken from configuration, never from a forwarded host header.
  let redirectUri: string;
  try {
    redirectUri = resolveOAuthCallbackUrl(request, platform);
  } catch {
    return NextResponse.redirect(
      failureRedirect(request, platform, "site_url_not_configured"),
    );
  }

  const tokenResult = await exchangeOAuthCode(config, code, redirectUri);

  if (!tokenResult.ok) {
    // `detail` is deliberately not populated from the provider's own error
    // text. That text is attacker-influenceable, ends up in browser history and
    // any referrer, and tells the operator nothing they can act on that the
    // error code does not already say.
    return NextResponse.redirect(
      failureRedirect(request, platform, "token_exchange_failed"),
    );
  }

  // Google's access tokens expire in an hour, so a consent that came back
  // without a refresh token leaves the connector unusable. Reporting that as
  // "connected" is how a dashboard ends up believing it has a credential it
  // never received.
  if (config.requiresRefreshToken && !tokenResult.refreshToken) {
    return NextResponse.redirect(
      failureRedirect(request, platform, "missing_refresh_token"),
    );
  }

  // Store on every successful exchange, not only when a refresh token is
  // present. Meta never issues one, so the previous condition meant a Meta
  // connection silently stored nothing at all.
  const saveResult = await upsertConnectorToken({
    platform,
    clientSlug: scope.clientSlug,
    mccId: platform === "google-ads" ? process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID : undefined,
    // The brand's own customer id, never the unsuffixed pilot value: writing
    // that into every brand's row is what made the stored registry unsafe to
    // trust. A brand with no configured id stores none and refuses to sync.
    customerId:
      platform === "google-ads"
        ? (() => {
            const resolution = resolveGoogleAdsCustomerId(scope.clientSlug, null);
            return resolution.ok ? resolution.customerId : undefined;
          })()
        : platform === "google-analytics"
          ? process.env.GA4_PROPERTY_ID
          : undefined,
    accessToken: tokenResult.accessToken,
    // Null since migration 0005. Meta issues a long-lived access token and no
    // refresh token, so its row carries null here and relies on `expires_at`.
    refreshToken: tokenResult.refreshToken ?? null,
    tokenType: tokenResult.tokenType,
    scope: tokenResult.scope,
    expiresInSeconds: tokenResult.expiresIn,
    metadata: {
      connectedVia: "oauth_callback",
      connectedAt: new Date().toISOString(),
      hasRefreshToken: Boolean(tokenResult.refreshToken),
      // The lifetime the provider actually stated, kept so `expires_at` can be
      // audited. Null means the provider reported no expiry at all.
      expiresInSeconds: tokenResult.expiresIn ?? null,
    },
  });

  if (!saveResult.ok) {
    // The connector reads its credential from the database, so a failed write
    // means the connector is not connected however the consent screen looked.
    return NextResponse.redirect(
      failureRedirect(request, platform, "token_storage_failed"),
    );
  }

  // A new credential is a governance event: it changes what this deployment
  // can reach. The trail records the platform and whether a refresh token came
  // with it, never the token itself.
  await recordAuditEvent({
    clientId: auth.context.access.clientId,
    actorUserId: auth.context.userId,
    actorEmail: auth.context.email,
    actorRole: auth.context.access.role,
    action: "connector.connected",
    subject: platform,
    detail: {
      hasRefreshToken: Boolean(tokenResult.refreshToken),
      clientSlug: scope.clientSlug,
    },
  });

  // Connection successful
  const successRedirect = new URL("/data-sources", request.nextUrl.origin);
  successRedirect.searchParams.set("connected", platform);
  successRedirect.searchParams.set("status", "success");

  const response = NextResponse.redirect(successRedirect);

  // Clear the one-shot CSRF state and brand cookies together.
  response.cookies.delete(`oauth_state_${platform}`);
  response.cookies.delete(`oauth_client_${platform}`);

  // Set connected status cookie (stored safely per platform for UI reflection)
  response.cookies.set(`connector_${platform}_status`, "connected", {
    httpOnly: false, // Accessible to client components for immediate UI status reflection
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  return response;
}
