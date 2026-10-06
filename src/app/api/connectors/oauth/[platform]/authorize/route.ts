import { NextRequest, NextResponse } from "next/server";

import { hasPermission } from "@/lib/auth/authorization";
import { resolveClientScope } from "@/lib/auth/client-scope";
import { resolveAuthContext } from "@/lib/auth/session";
import {
  generateCSRFState,
  OAUTH_PLATFORMS,
  resolveOAuthCallbackUrl,
} from "@/lib/connectors/oauth";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ platform: string }> },
) {
  const { platform } = await context.params;

  // Which brand is being connected. Validated against the brand allowlist, so
  // an unknown slug is refused rather than quietly treated as the pilot.
  const scope = resolveClientScope(request.nextUrl.searchParams.get("client"));
  if (!scope.ok) {
    return NextResponse.redirect(
      new URL(
        `/data-sources?oauth_error=unknown_client&platform=${encodeURIComponent(platform)}`,
        request.nextUrl.origin,
      ),
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

  const config = OAUTH_PLATFORMS[platform];
  if (!config) {
    const errorUrl = new URL(
      `/data-sources?oauth_error=unsupported_platform&platform=${encodeURIComponent(platform)}`,
      request.nextUrl.origin,
    );
    return NextResponse.redirect(errorUrl);
  }

  const searchParams = request.nextUrl.searchParams;
  const effectiveClientId = searchParams.get("client_id") || searchParams.get("app_id") || config.clientId;

  // If OAuth Client credentials are not configured yet, redirect back to data-sources with explicit guidance.
  if (!effectiveClientId) {
    const missingUrl = new URL(
      `/data-sources?oauth_error=missing_credentials&platform=${encodeURIComponent(platform)}`,
      request.nextUrl.origin,
    );
    return NextResponse.redirect(missingUrl);
  }

  const state = generateCSRFState(platform);

  let redirectUri: string;
  try {
    redirectUri = resolveOAuthCallbackUrl(request, platform);
  } catch {
    // A production deployment that cannot prove its own origin must not send
    // the operator to a provider with a request-derived redirect_uri.
    const misconfiguredUrl = new URL(
      `/data-sources?oauth_error=site_url_not_configured&platform=${encodeURIComponent(platform)}`,
      request.nextUrl.origin,
    );
    return NextResponse.redirect(misconfiguredUrl);
  }

  const authUrl = new URL(config.authUrl);
  if (platform === "tiktok-ads") {
    authUrl.searchParams.set("app_id", effectiveClientId);
  } else {
    authUrl.searchParams.set("client_id", effectiveClientId);
  }
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", config.scopes.join(" "));
  authUrl.searchParams.set("state", state);

  if (config.extraAuthParams) {
    for (const [key, val] of Object.entries(config.extraAuthParams)) {
      authUrl.searchParams.set(key, val);
    }
  }

  const response = NextResponse.redirect(authUrl.toString());

  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 900,
  };

  // Store CSRF state in secure cookie valid for 15 minutes
  response.cookies.set(`oauth_state_${platform}`, state, cookieOptions);

  // The brand has to survive the round trip to the provider, and it cannot ride
  // in the redirect URL: the provider echoes only `state` back. An httpOnly
  // cookie beside the state keeps it out of browser history and out of reach of
  // page scripts, and the callback re-validates it against the allowlist rather
  // than trusting the cookie it just read.
  response.cookies.set(
    `oauth_client_${platform}`,
    scope.clientSlug,
    cookieOptions,
  );

  return response;
}
