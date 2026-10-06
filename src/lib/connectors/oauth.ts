import crypto from "crypto";
import type { NextRequest } from "next/server";

import { getAuthConfiguration } from "@/lib/auth/auth-config";

export interface PlatformOAuthConfig {
  id: string;
  name: string;
  authUrl: string;
  tokenUrl: string;
  clientId?: string;
  clientSecret?: string;
  scopes: string[];
  /**
   * True when the platform issues a refresh token and the connector cannot work
   * without one. Google requires it: its access tokens expire in an hour, so a
   * consent that returns no refresh token leaves the connector unusable. Meta
   * issues a long-lived access token and no refresh token, so requiring one
   * there would reject a perfectly good connection.
   */
  requiresRefreshToken: boolean;
  extraAuthParams?: Record<string, string>;
  envVarKeys: {
    clientId: string;
    clientSecret: string;
    extra?: string[];
  };
}

export const OAUTH_PLATFORMS: Record<string, PlatformOAuthConfig> = {
  "google-ads": {
    id: "google-ads",
    name: "Google Ads",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    clientId: process.env.GOOGLE_ADS_CLIENT_ID,
    clientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET,
    scopes: ["https://www.googleapis.com/auth/adwords"],
    requiresRefreshToken: true,
    extraAuthParams: {
      access_type: "offline",
      prompt: "consent",
      response_type: "code",
    },
    envVarKeys: {
      clientId: "GOOGLE_ADS_CLIENT_ID",
      clientSecret: "GOOGLE_ADS_CLIENT_SECRET",
      extra: ["GOOGLE_ADS_DEVELOPER_TOKEN"],
    },
  },
  "meta-ads": {
    id: "meta-ads",
    name: "Meta Ads",
    authUrl: "https://www.facebook.com/v20.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v20.0/oauth/access_token",
    clientId: process.env.META_APP_ID,
    clientSecret: process.env.META_APP_SECRET,
    scopes: ["ads_read", "read_insights"],
    // Meta returns a long-lived access token, never a refresh token.
    requiresRefreshToken: false,
    extraAuthParams: {
      response_type: "code",
    },
    envVarKeys: {
      clientId: "META_APP_ID",
      clientSecret: "META_APP_SECRET",
    },
  },
  "bing-ads": {
    id: "bing-ads",
    name: "Microsoft Advertising (Bing Ads)",
    authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    clientId: process.env.BING_ADS_CLIENT_ID,
    clientSecret: process.env.BING_ADS_CLIENT_SECRET,
    scopes: ["https://ads.microsoft.com/msads.manage", "offline_access"],
    requiresRefreshToken: true,
    extraAuthParams: {
      response_type: "code",
      response_mode: "query",
    },
    envVarKeys: {
      clientId: "BING_ADS_CLIENT_ID",
      clientSecret: "BING_ADS_CLIENT_SECRET",
    },
  },
  "tiktok-ads": {
    id: "tiktok-ads",
    name: "TikTok Ads",
    authUrl: "https://business-api.tiktok.com/portal/auth",
    tokenUrl: "https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/",
    clientId: process.env.TIKTOK_APP_ID,
    clientSecret: process.env.TIKTOK_APP_SECRET,
    scopes: ["ads_read"],
    requiresRefreshToken: false,
    extraAuthParams: {
      response_type: "code",
    },
    envVarKeys: {
      clientId: "TIKTOK_APP_ID",
      clientSecret: "TIKTOK_APP_SECRET",
    },
  },
  "google-analytics": {
    id: "google-analytics",
    name: "Google Analytics 4",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    clientId: process.env.GOOGLE_ADS_CLIENT_ID || process.env.GA4_CLIENT_ID,
    clientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET || process.env.GA4_CLIENT_SECRET,
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
    requiresRefreshToken: true,
    extraAuthParams: {
      access_type: "offline",
      prompt: "consent",
      response_type: "code",
    },
    envVarKeys: {
      clientId: "GOOGLE_ADS_CLIENT_ID",
      clientSecret: "GOOGLE_ADS_CLIENT_SECRET",
    },
  },
  "google-search-console": {
    id: "google-search-console",
    name: "Google Search Console",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    clientId: process.env.GOOGLE_ADS_CLIENT_ID || process.env.GSC_CLIENT_ID,
    clientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET || process.env.GSC_CLIENT_SECRET,
    scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
    requiresRefreshToken: true,
    extraAuthParams: {
      access_type: "offline",
      prompt: "consent",
      response_type: "code",
    },
    envVarKeys: {
      clientId: "GOOGLE_ADS_CLIENT_ID",
      clientSecret: "GOOGLE_ADS_CLIENT_SECRET",
    },
  },
};

/**
 * Raised when a deployment cannot prove which origin it is. Callers turn this
 * into a fixed error code; it never carries request-supplied text.
 */
export class OAuthOriginError extends Error {
  readonly code = "site_url_not_configured";

  constructor() {
    super(
      "The OAuth callback origin is not configured. Set NEXT_PUBLIC_SITE_URL for this deployment.",
    );
    this.name = "OAuthOriginError";
  }
}

/**
 * Origin the provider will send the operator back to.
 *
 * `x-forwarded-host` and `host` are supplied by the caller on every request, so
 * a spoofed value would build a `redirect_uri` pointing at someone else's host.
 * Configuration is therefore the only source in production: `NEXT_PUBLIC_SITE_URL`,
 * or the Vercel deployment URL that `getAuthConfiguration` falls back to. The
 * provider's own redirect allowlist is a second line of defence, not the first.
 *
 * Outside production the request headers are still accepted, because local
 * tunnels and preview hosts change their origin per run.
 */
export function resolveOAuthOrigin(request: NextRequest): string {
  const { isProduction, siteUrl } = getAuthConfiguration();

  if (siteUrl) {
    try {
      return new URL(siteUrl).origin;
    } catch {
      // Fall through: a malformed configured URL is treated as unset.
    }
  }

  if (isProduction) throw new OAuthOriginError();

  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost ?? request.headers.get("host") ?? "localhost:3000";
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const protocol = forwardedProto ?? (host.includes("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}

export function resolveOAuthCallbackUrl(request: NextRequest, platformId: string): string {
  return `${resolveOAuthOrigin(request)}/api/connectors/oauth/${platformId}/callback`;
}

export function generateCSRFState(platformId: string): string {
  const randomBytes = crypto.randomBytes(24).toString("hex");
  const timestamp = Date.now();
  return `${platformId}:${timestamp}:${randomBytes}`;
}

/** Length-aware constant-time compare. Equal length is checked first because
 * `timingSafeEqual` throws on a mismatch, and a length difference is not a
 * secret worth protecting. */
function statesMatch(state: string, cookieState: string): boolean {
  const left = Buffer.from(state, "utf8");
  const right = Buffer.from(cookieState, "utf8");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function validateCSRFState(platformId: string, state: string, cookieState: string | undefined): boolean {
  if (!state || !cookieState || !statesMatch(state, cookieState)) return false;
  const parts = state.split(":");
  if (parts.length !== 3) return false;
  if (parts[0] !== platformId) return false;
  const timestamp = Number(parts[1]);
  if (!Number.isFinite(timestamp)) return false;
  // State is valid for 15 minutes (900,000 ms)
  const isFresh = Date.now() - timestamp < 900_000;
  return isFresh;
}

export interface TokenExchangeSuccess {
  ok: true;
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  scope?: string;
  tokenType?: string;
}

export interface TokenExchangeFailure {
  ok: false;
  error: string;
  status: number;
}

export type TokenExchangeResult = TokenExchangeSuccess | TokenExchangeFailure;

export async function exchangeOAuthCode(
  config: PlatformOAuthConfig,
  code: string,
  redirectUri: string,
): Promise<TokenExchangeResult> {
  if (!config.clientId || !config.clientSecret) {
    return {
      ok: false,
      error: `Missing client credentials for ${config.name}.`,
      status: 400,
    };
  }

  try {
    const bodyParams = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });

    const response = await fetch(config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: bodyParams.toString(),
    });

    const data = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      const errorMsg =
        typeof data.error_description === "string"
          ? data.error_description
          : typeof data.error === "string"
            ? data.error
            : `OAuth exchange failed with status ${response.status}`;
      return {
        ok: false,
        error: errorMsg,
        status: response.status,
      };
    }

    const accessToken = typeof data.access_token === "string" ? data.access_token : "";
    const refreshToken = typeof data.refresh_token === "string" ? data.refresh_token : undefined;
    // Some token endpoints send the lifetime as a numeric string. Dropping it
    // would store `expires_at` as null, which reads as "never expires".
    const expiresIn =
      typeof data.expires_in === "number"
        ? data.expires_in
        : typeof data.expires_in === "string" && /^\d+$/.test(data.expires_in)
          ? Number(data.expires_in)
          : undefined;
    const scope = typeof data.scope === "string" ? data.scope : undefined;
    const tokenType = typeof data.token_type === "string" ? data.token_type : "Bearer";

    if (!accessToken) {
      return {
        ok: false,
        error: "Token endpoint response did not include an access_token.",
        status: 502,
      };
    }

    return {
      ok: true,
      accessToken,
      refreshToken,
      expiresIn,
      scope,
      tokenType,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Network error during token exchange";
    return {
      ok: false,
      error: message,
      status: 502,
    };
  }
}
