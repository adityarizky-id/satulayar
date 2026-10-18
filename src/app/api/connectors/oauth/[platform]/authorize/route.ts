import { NextRequest, NextResponse } from "next/server";

import { hasPermission } from "@/lib/auth/authorization";
import { resolveClientScope } from "@/lib/auth/client-scope";
import { resolveAuthContext } from "@/lib/auth/session";
import { authFailureResponse, isSameOriginRequest, privateJson } from "@/lib/auth/http";
import { getConnectorToken, listActiveConnectorCustomerIds } from "@/lib/connectors/token-storage";
import {
  generateCSRFState,
  OAUTH_PLATFORMS,
  resolveOAuthCallbackUrl,
  sealOAuthSession,
  popupCookieOptions,
  type PopupOAuthSession,
} from "@/lib/connectors/oauth";

export const runtime = "nodejs";

/** JSON bootstrap keeps app secrets out of URLs and opens the official Google consent window. */
export async function POST(request: NextRequest, context: { params: Promise<{ platform: string }> }) {
  if (!isSameOriginRequest(request)) return privateJson({ error: "Request origin is not allowed." }, { status: 403 });
  const { platform } = await context.params;
  if (platform !== "google-ads" && platform !== "google-analytics") return privateJson({ error: "This connector does not support Google consent." }, { status: 400 });
  let input: Record<string, unknown>;
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    input = body;
  } catch { return privateJson({ error: "Enter the connection setup details." }, { status: 400 }); }
  if (typeof input.clientSlug !== "string" || !input.clientSlug) return privateJson({ error: "Choose a brand before connecting." }, { status: 400 });
  const scope = resolveClientScope(input.clientSlug);
  if (!scope.ok) return privateJson({ error: scope.message }, { status: 400 });
  const auth = await resolveAuthContext(scope.clientSlug);
  if (!auth.ok) return authFailureResponse(auth);
  if (!hasPermission(auth.context.access.role, "sync:trigger") || (process.env.NODE_ENV === "production" && auth.context.mode !== "supabase")) return privateJson({ error: "A signed-in workspace editor must connect this platform." }, { status: 403 });
  // Check storage before asking Google for access. No draft row replaces a working connection.
  let stored: Awaited<ReturnType<typeof getConnectorToken>>;
  try {
    await listActiveConnectorCustomerIds(platform);
    stored = await getConnectorToken(platform, scope.clientSlug);
  }
  catch { return privateJson({ error: "Secure workspace storage is unavailable. Ask your workspace administrator to finish installation before connecting." }, { status: 503 }); }
  const config = OAUTH_PLATFORMS[platform];
  const metadata = stored?.metadata ?? {};
  const useStored = metadata.configuredVia === (platform === "google-ads" ? "direct_modal_input" : "direct_platform_form");
  const useGa4App = platform === "google-analytics" && Boolean(process.env.GA4_CLIENT_ID && process.env.GA4_CLIENT_SECRET);
  const envId = useGa4App ? process.env.GA4_CLIENT_ID : process.env.GOOGLE_ADS_CLIENT_ID;
  const envSecret = useGa4App ? process.env.GA4_CLIENT_SECRET : process.env.GOOGLE_ADS_CLIENT_SECRET;
  const value = (key: string) => typeof input[key] === "string" ? input[key].trim() : "";
  // A submitted OAuth client must include its own secret; never mix client pairs.
  const ownClient = Boolean(value("clientId") || value("clientSecret"));
  const fields: Record<string, string> = {
    clientId: ownClient ? value("clientId") : useStored ? String(metadata.clientId ?? "") : envId ?? "",
    clientSecret: ownClient ? value("clientSecret") : useStored ? String(metadata.clientSecret ?? "") : envSecret ?? "",
    ...(platform === "google-ads" ? {
      customerId: value("customerId") || stored?.customerId || "",
      developerToken: value("developerToken") || (useStored ? String(metadata.developerToken ?? "") : process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? ""),
      loginCustomerId: value("loginCustomerId") || stored?.mccId || "",
    } : { propertyId: value("propertyId") || stored?.customerId || "" }),
  };
  for (const key of platform === "google-ads" ? ["customerId", "developerToken", "clientId", "clientSecret"] : ["propertyId", "clientId", "clientSecret"]) {
    if (!fields[key]) return privateJson({ error: "Complete this field before continuing to Google.", field: key }, { status: 400 });
  }
  if (Object.values(fields).some((entry) => entry.length > 1024)) return privateJson({ error: "A setup value is too long." }, { status: 400 });
  if (platform === "google-ads") {
    if (!/^\d{10}$/.test(fields.customerId.replace(/[\s-]/g, ""))) return privateJson({ error: "Enter a 10-digit Google Ads Customer ID.", field: "customerId" }, { status: 400 });
    if (fields.loginCustomerId && !/^\d{10}$/.test(fields.loginCustomerId.replace(/[\s-]/g, ""))) return privateJson({ error: "Enter a 10-digit manager ID, or leave it empty.", field: "loginCustomerId" }, { status: 400 });
  } else if (!/^\d{1,20}$/.test(fields.propertyId)) return privateJson({ error: "Enter the numeric GA4 property ID, not a G- measurement ID.", field: "propertyId" }, { status: 400 });
  let redirectUri: string;
  try { redirectUri = resolveOAuthCallbackUrl(request, platform); }
  catch { return privateJson({ error: "The workspace callback URL is not configured. Ask the workspace administrator to configure the site origin." }, { status: 503 }); }
  const state = generateCSRFState(platform);
  const pending: PopupOAuthSession = { state, platform, clientSlug: scope.clientSlug, userId: auth.context.userId, createdAt: Date.now(), fields };
  const sealed = sealOAuthSession(pending);
  if (sealed.length > 3600) return privateJson({ error: "The setup is too large for a secure authorization session." }, { status: 400 });
  const url = new URL(config.authUrl);
  for (const [key, entry] of Object.entries(config.extraAuthParams ?? {})) url.searchParams.set(key, entry);
  url.searchParams.set("prompt", "select_account consent");
  url.searchParams.set("client_id", fields.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", config.scopes.join(" "));
  url.searchParams.set("state", state);
  const response = privateJson({ ok: true, authorizationUrl: url.toString(), attempt: state });
  response.cookies.set(`oauth_popup_${platform}`, sealed, popupCookieOptions());
  response.cookies.set(`oauth_state_${platform}`, state, popupCookieOptions());
  response.cookies.set(`oauth_client_${platform}`, scope.clientSlug, popupCookieOptions());
  response.cookies.delete(`oauth_result_${platform}`);
  return response;
}

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

  const effectiveClientId = config.clientId;

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
