import { NextRequest, NextResponse } from "next/server";

import { hasPermission } from "@/lib/auth/authorization";
import { resolveClientScope } from "@/lib/auth/client-scope";
import { resolveAuthContext } from "@/lib/auth/session";
import {
  exchangeOAuthCode,
  OAUTH_PLATFORMS,
  resolveOAuthCallbackUrl,
  validateCSRFState,
} from "@/lib/connectors/oauth";
import { recordAuditEvent } from "@/lib/audit/activity-log";
import { resolveGoogleAdsCustomerId } from "@/lib/connectors/google-ads-config";
import { upsertConnectorToken } from "@/lib/connectors/token-storage";

export const runtime = "nodejs";

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
