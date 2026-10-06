import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  getConnectorToken,
  getLatestConnectorTokenUpdatedAt,
  getManagerScopedRefreshToken,
  revokeConnectorToken,
  upsertConnectorToken,
} from "@/lib/connectors/token-storage";
import { longLivedCredentialLabel } from "@/components/dashboard/connector-console";

const STORED_TOKEN_ROW = {
  id: "3e953e80-646a-4c6f-958a-589d789b8722",
  platform: "google-ads",
  client_slug: "kopi-senja",
  mcc_id: "manager-id",
  customer_id: "customer-id",
  access_token: "access-token-test-value",
  refresh_token: "refresh-token-test-value",
  token_type: "Bearer",
  scope: "https://www.googleapis.com/auth/adwords",
  expires_at: "2026-09-08T12:00:00.000Z",
  status: "active" as const,
  metadata: { source: "unit-test" },
  created_at: "2026-09-08T10:00:00.000Z",
  updated_at: "2026-09-08T11:00:00.000Z",
};

interface EnvironmentSnapshot {
  DASHBOARD_AUTH_MODE: string | undefined;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: string | undefined;
  NEXT_PUBLIC_SUPABASE_URL: string | undefined;
  SUPABASE_SERVICE_ROLE_KEY: string | undefined;
}

function configureSupabaseEnvironment(): EnvironmentSnapshot {
  const snapshot = {
    DASHBOARD_AUTH_MODE: process.env.DASHBOARD_AUTH_MODE,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };

  process.env.DASHBOARD_AUTH_MODE = "supabase";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "publishable-test-value";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-value";

  return snapshot;
}

function restoreSupabaseEnvironment(snapshot: EnvironmentSnapshot): void {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

test("connector token migration is service-role only and fail-closed", async () => {
  const migration = await readFile(
    new URL(
      "../supabase/migrations/0004_connector_tokens.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(migration, /alter table public\.connector_tokens enable row level security/);
  assert.match(
    migration,
    /revoke all on table public\.connector_tokens from anon, authenticated/,
  );
  assert.match(migration, /create policy connector_tokens_deny_anon/);
  assert.match(migration, /create policy connector_tokens_deny_auth/);
  assert.match(migration, /as restrictive/g);
  assert.match(migration, /using \(false\)/g);
  assert.match(migration, /with check \(false\)/g);
  assert.match(
    migration,
    /grant all on table public\.connector_tokens to service_role/,
  );
});

test("upsertConnectorToken writes snake-case fields and returns a typed record", async () => {
  const snapshot = configureSupabaseEnvironment();
  const originalFetch = globalThis.fetch;
  const capturedRequests: Request[] = [];

  globalThis.fetch = async (input, init) => {
    capturedRequests.push(new Request(input, init));
    return new Response(JSON.stringify(STORED_TOKEN_ROW), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const result = await upsertConnectorToken({
      platform: "google-ads",
      clientSlug: "kopi-senja",
      mccId: "manager-id",
      customerId: "customer-id",
      accessToken: "access-token-test-value",
      refreshToken: "refresh-token-test-value",
      scope: "https://www.googleapis.com/auth/adwords",
      metadata: { source: "unit-test" },
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.data.clientSlug, "kopi-senja");
    assert.equal(result.data.customerId, "customer-id");
    assert.equal(result.data.status, "active");
    assert.deepEqual(result.data.metadata, { source: "unit-test" });

    const capturedRequest = capturedRequests[0];
    assert.ok(capturedRequest);
    assert.equal(capturedRequest.method, "POST");
    assert.equal(
      capturedRequest.headers.get("authorization"),
      "Bearer service-role-test-value",
    );
    const requestBody = JSON.parse(await capturedRequest.clone().text()) as Record<
      string,
      unknown
    >;
    assert.equal(requestBody.client_slug, "kopi-senja");
    assert.equal(requestBody.token_type, "Bearer");
    assert.equal(requestBody.status, "active");
    assert.equal(requestBody.expires_at, null);
    assert.equal("clientSlug" in requestBody, false);
  } finally {
    globalThis.fetch = originalFetch;
    restoreSupabaseEnvironment(snapshot);
  }
});

test("getConnectorToken retrieves by platform and client slug", async () => {
  const snapshot = configureSupabaseEnvironment();
  const originalFetch = globalThis.fetch;
  const capturedRequests: Request[] = [];

  globalThis.fetch = async (input, init) => {
    capturedRequests.push(new Request(input, init));
    return new Response(JSON.stringify(STORED_TOKEN_ROW), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const token = await getConnectorToken("google-ads", "kopi-senja");

    assert.ok(token);
    assert.equal(token.platform, "google-ads");
    assert.equal(token.clientSlug, "kopi-senja");
    assert.equal(token.refreshToken, "refresh-token-test-value");

    const latestUpdate = await getLatestConnectorTokenUpdatedAt("kopi-senja");
    assert.equal(latestUpdate, STORED_TOKEN_ROW.updated_at);

    const capturedRequest = capturedRequests[0];
    assert.ok(capturedRequest);
    assert.equal(capturedRequest.method, "GET");
    assert.match(capturedRequest.url, /platform=eq\.google-ads/);
    assert.match(capturedRequest.url, /client_slug=eq\.kopi-senja/);
    const freshnessRequest = capturedRequests[1];
    assert.ok(freshnessRequest);
    assert.match(freshnessRequest.url, /select=updated_at/);
    assert.match(freshnessRequest.url, /client_slug=eq\.kopi-senja/);
    assert.match(freshnessRequest.url, /status=eq\.active/);
    assert.doesNotMatch(freshnessRequest.url, /access_token|refresh_token/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreSupabaseEnvironment(snapshot);
  }
});

test("revokeConnectorToken marks the scoped token revoked", async () => {
  const snapshot = configureSupabaseEnvironment();
  const originalFetch = globalThis.fetch;
  const capturedRequests: Request[] = [];

  globalThis.fetch = async (input, init) => {
    capturedRequests.push(new Request(input, init));
    return new Response(JSON.stringify({ id: STORED_TOKEN_ROW.id }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const revoked = await revokeConnectorToken("google-ads", "kopi-senja");

    assert.equal(revoked, true);
    const capturedRequest = capturedRequests[0];
    assert.ok(capturedRequest);
    assert.equal(capturedRequest.method, "PATCH");
    assert.match(capturedRequest.url, /platform=eq\.google-ads/);
    assert.match(capturedRequest.url, /client_slug=eq\.kopi-senja/);
    const requestBody = JSON.parse(await capturedRequest.clone().text()) as Record<
      string,
      unknown
    >;
    assert.equal(requestBody.status, "revoked");
    assert.equal(typeof requestBody.updated_at, "string");
  } finally {
    globalThis.fetch = originalFetch;
    restoreSupabaseEnvironment(snapshot);
  }
});

test("upsertConnectorToken fails closed when the service-role key is missing", async () => {
  const snapshot = configureSupabaseEnvironment();
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  globalThis.fetch = async () => {
    requestCount += 1;
    throw new Error("Network must not be called without the worker secret.");
  };

  try {
    const result = await upsertConnectorToken({
      platform: "google-ads",
      clientSlug: "kopi-senja",
      accessToken: "access-token-test-value",
      refreshToken: "refresh-token-test-value",
    });

    assert.deepEqual(result, {
      ok: false,
      error: "Supabase worker secret is not configured.",
    });
    assert.equal(requestCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
    restoreSupabaseEnvironment(snapshot);
  }
});

test("getConnectorToken never returns a revoked credential", async () => {
  const snapshot = configureSupabaseEnvironment();
  const originalFetch = globalThis.fetch;
  const capturedRequests: Request[] = [];

  globalThis.fetch = async (input, init) => {
    capturedRequests.push(new Request(input, init));
    // PostgREST answers the filtered query with no row once status is revoked.
    return new Response("null", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const token = await getConnectorToken("google-ads", "kopi-senja");

    assert.equal(token, null);
    const capturedRequest = capturedRequests[0];
    assert.ok(capturedRequest);
    // The filter, not the caller, is what keeps a disconnected connector from
    // continuing to authenticate.
    assert.match(capturedRequest.url, /status=eq\.active/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreSupabaseEnvironment(snapshot);
  }
});

test("the disconnect route revokes the stored credential, not only the cookie", async () => {
  const routeSource = await readFile(
    new URL("../src/app/api/connectors/disconnect/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(routeSource, /revokeConnectorToken\(/);
  const revokeIndex = routeSource.indexOf("revokeConnectorToken(");
  const cookieIndex = routeSource.indexOf("cookies.delete(");
  assert.ok(
    revokeIndex > -1 && cookieIndex > revokeIndex,
    "the credential must be revoked before the UI is told it is disconnected",
  );
  assert.match(routeSource, /status: 503/);
});

test("the service client works under preview auth mode, using only the worker secret", async () => {
  const snapshot = configureSupabaseEnvironment();
  const originalFetch = globalThis.fetch;
  let reachedSupabase = false;

  // A device configured for preview browser auth must still be able to store a
  // connector token. Coupling the two is what left connector_tokens empty after
  // a successful Google consent.
  process.env.DASHBOARD_AUTH_MODE = "preview";

  globalThis.fetch = async (input, init) => {
    reachedSupabase = true;
    void new Request(input, init);
    return new Response(JSON.stringify(STORED_TOKEN_ROW), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const result = await upsertConnectorToken({
      platform: "google-ads",
      clientSlug: "kopi-senja",
      accessToken: "access-token-test-value",
      refreshToken: "refresh-token-test-value",
    });

    assert.equal(result.ok, true);
    assert.equal(reachedSupabase, true);
  } finally {
    globalThis.fetch = originalFetch;
    restoreSupabaseEnvironment(snapshot);
  }
});

test("the service client still fails closed without a project URL", async () => {
  const snapshot = configureSupabaseEnvironment();
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  globalThis.fetch = async () => {
    requestCount += 1;
    throw new Error("Network must not be called without a project URL.");
  };

  try {
    const result = await upsertConnectorToken({
      platform: "google-ads",
      clientSlug: "kopi-senja",
      accessToken: "access-token-test-value",
      refreshToken: "refresh-token-test-value",
    });

    assert.deepEqual(result, {
      ok: false,
      error: "Supabase project URL is not configured.",
    });
    assert.equal(requestCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
    restoreSupabaseEnvironment(snapshot);
  }
});

test("the OAuth callback never reports success without storing a credential", async () => {
  const routeSource = await readFile(
    new URL(
      "../src/app/api/connectors/oauth/[platform]/callback/route.ts",
      import.meta.url,
    ),
    "utf8",
  );

  // A Google consent that returns no refresh token leaves the connector
  // unusable, so it must not be drawn as connected.
  assert.match(routeSource, /config\.requiresRefreshToken && !tokenResult\.refreshToken/);
  assert.match(routeSource, /missing_refresh_token/);

  // The storage write must be unconditional on a successful exchange. Guarding
  // it behind a refresh token meant Meta, which never issues one, stored
  // nothing at all.
  const storageIndex = routeSource.indexOf("await upsertConnectorToken(");
  const successIndex = routeSource.indexOf('successRedirect.searchParams.set("status", "success")');
  assert.ok(storageIndex > -1 && successIndex > storageIndex);
  assert.doesNotMatch(routeSource, /if \(tokenResult\.refreshToken\) \{/);

  // A failed write is a failed connection, whatever the consent screen showed.
  assert.match(routeSource, /token_storage_failed/);
});

test("the OAuth callback keeps provider-supplied text out of the redirect URL", async () => {
  const routeSource = await readFile(
    new URL(
      "../src/app/api/connectors/oauth/[platform]/callback/route.ts",
      import.meta.url,
    ),
    "utf8",
  );

  // The redirect lands in browser history and may travel in a referrer, so it
  // carries fixed codes only.
  assert.doesNotMatch(routeSource, /searchParams\.set\("detail"/);
  assert.doesNotMatch(routeSource, /error_description/);
  assert.match(routeSource, /function failureRedirect\(/);
});

test("only platforms that issue a refresh token are required to return one", async () => {
  const { OAUTH_PLATFORMS } = await import("@/lib/connectors/oauth");

  assert.equal(OAUTH_PLATFORMS["google-ads"].requiresRefreshToken, true);
  assert.equal(OAUTH_PLATFORMS["google-analytics"].requiresRefreshToken, true);
  assert.equal(OAUTH_PLATFORMS["bing-ads"].requiresRefreshToken, true);
  // Meta and TikTok issue a long-lived access token instead.
  assert.equal(OAUTH_PLATFORMS["meta-ads"].requiresRefreshToken, false);
  assert.equal(OAUTH_PLATFORMS["tiktok-ads"].requiresRefreshToken, false);
});

test("migration 0005 makes refresh_token nullable without loosening Google", async () => {
  const migration = await readFile(
    new URL(
      "../supabase/migrations/0005_connector_tokens_nullable_refresh_token.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(migration, /alter column refresh_token drop not null/);
  // Rows stored under the old empty-string convention are normalised.
  assert.match(migration, /set refresh_token = null\s+where refresh_token = ''/);
  // Platforms whose access token dies within the hour still need one.
  assert.match(migration, /connector_tokens_refresh_token_required_check/);
  assert.match(migration, /'google-ads'/);
  assert.match(migration, /nullif\(refresh_token, ''\) is not null/);
  // RLS and grants are not touched by this migration.
  assert.doesNotMatch(migration, /grant |policy|disable row level security/i);
});

test("a Meta token with no refresh token is stored as null, with its real expiry", async () => {
  const snapshot = configureSupabaseEnvironment();
  const originalFetch = globalThis.fetch;
  const capturedRequests: Request[] = [];
  const before = Date.now();

  globalThis.fetch = async (input, init) => {
    capturedRequests.push(new Request(input, init));
    return new Response(
      JSON.stringify({
        ...STORED_TOKEN_ROW,
        platform: "meta-ads",
        refresh_token: null,
        metadata: { hasRefreshToken: false },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const result = await upsertConnectorToken({
      platform: "meta-ads",
      clientSlug: "kopi-senja",
      accessToken: "meta-long-lived-test-value",
      refreshToken: null,
      expiresInSeconds: 5_183_999,
      metadata: { hasRefreshToken: false },
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.refreshToken, null);

    const body = JSON.parse(await capturedRequests[0].clone().text()) as Record<
      string,
      unknown
    >;
    assert.equal(body.refresh_token, null);
    assert.deepEqual(body.metadata, { hasRefreshToken: false });

    // expires_at is the provider-stated lifetime from now: about 60 days.
    const expiresAt = Date.parse(String(body.expires_at));
    const lifetimeSeconds = (expiresAt - before) / 1_000;
    assert.ok(
      lifetimeSeconds >= 5_183_998 && lifetimeSeconds <= 5_184_010,
      `expected ~5183999s, got ${lifetimeSeconds}`,
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreSupabaseEnvironment(snapshot);
  }
});

test("an empty refresh token is never written, and a legacy empty value reads as absent", async () => {
  const snapshot = configureSupabaseEnvironment();
  const originalFetch = globalThis.fetch;
  const capturedRequests: Request[] = [];

  globalThis.fetch = async (input, init) => {
    capturedRequests.push(new Request(input, init));
    // A row stored before migration 0005 carried '' for "no refresh token".
    return new Response(
      JSON.stringify({ ...STORED_TOKEN_ROW, platform: "meta-ads", refresh_token: "" }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const result = await upsertConnectorToken({
      platform: "meta-ads",
      clientSlug: "kopi-senja",
      accessToken: "meta-long-lived-test-value",
      refreshToken: "   ",
    });
    const body = JSON.parse(await capturedRequests[0].clone().text()) as Record<
      string,
      unknown
    >;
    assert.equal(body.refresh_token, null);
    assert.equal(result.ok && result.data.refreshToken, null);

    const read = await getConnectorToken("meta-ads", "kopi-senja");
    assert.equal(read?.refreshToken, null);
  } finally {
    globalThis.fetch = originalFetch;
    restoreSupabaseEnvironment(snapshot);
  }
});

test("the OAuth callback records null, hasRefreshToken, and the stated lifetime", async () => {
  const routeSource = await readFile(
    new URL(
      "../src/app/api/connectors/oauth/[platform]/callback/route.ts",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(routeSource, /refreshToken: tokenResult\.refreshToken \?\? null/);
  assert.doesNotMatch(routeSource, /tokenResult\.refreshToken \?\? ""/);
  assert.match(routeSource, /hasRefreshToken: Boolean\(tokenResult\.refreshToken\)/);
  assert.match(routeSource, /expiresInSeconds: tokenResult\.expiresIn,/);
  assert.match(routeSource, /expiresInSeconds: tokenResult\.expiresIn \?\? null/);
});

test("a Meta code exchange yields no refresh token and keeps the stated expiry", async () => {
  const { exchangeOAuthCode } = await import("@/lib/connectors/oauth");
  const originalFetch = globalThis.fetch;
  const config = {
    id: "meta-ads",
    name: "Meta Ads",
    authUrl: "https://example.test/dialog",
    tokenUrl: "https://example.test/token",
    clientId: "app-id",
    clientSecret: "app-secret",
    scopes: ["ads_read"],
    requiresRefreshToken: false,
    envVarKeys: { clientId: "META_APP_ID", clientSecret: "META_APP_SECRET" },
  };

  try {
    for (const expiresIn of [5_183_999, "5183999"]) {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            access_token: "meta-long-lived-test-value",
            token_type: "bearer",
            expires_in: expiresIn,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );

      const result = await exchangeOAuthCode(config, "code", "https://example.test/cb");
      assert.equal(result.ok, true);
      if (!result.ok) continue;
      assert.equal(result.refreshToken, undefined);
      // A numeric-string lifetime used to be dropped, storing expires_at as
      // null — which reads as a credential that never expires.
      assert.equal(result.expiresIn, 5_183_999);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Meta long-lived token UX reports remaining days and an explicit recovery state", async () => {
  assert.equal(
    longLivedCredentialLabel({
      kind: "long-lived-access-token",
      state: "active",
      daysRemaining: 42,
      expiresAt: "2026-10-23T00:00:00.000Z",
    }),
    "Long-lived access token active · expires in 42 days",
  );
  assert.match(
    longLivedCredentialLabel({
      kind: "long-lived-access-token",
      state: "expired",
      daysRemaining: 0,
      expiresAt: "2026-09-10T00:00:00.000Z",
    }),
    /expired · re-authenticate to resume reporting/,
  );

  const pageSource = await readFile(
    new URL("../src/app/data-sources/page.tsx", import.meta.url),
    "utf8",
  );
  const shellSource = await readFile(
    new URL("../src/components/dashboard/data-sources-shell.tsx", import.meta.url),
    "utf8",
  );
  const consoleSource = await readFile(
    new URL("../src/components/dashboard/connector-console.tsx", import.meta.url),
    "utf8",
  );

  assert.match(pageSource, /expires_at/);
  assert.match(pageSource, /Math\.ceil\(\(expiresAt - now\) \/ DAY_IN_MILLISECONDS\)/);
  assert.match(consoleSource, /"Re-authenticate"/);
  // Handled as its own case, not folded into generic re-authorize advice.
  assert.match(shellSource, /missing_refresh_token: "refresh-token"/);
  assert.match(shellSource, /existing dashboard data is unchanged/);
});

test("the OAuth state cookie is httpOnly and short lived", async () => {
  const authorizeSource = await readFile(
    new URL(
      "../src/app/api/connectors/oauth/[platform]/authorize/route.ts",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(authorizeSource, /httpOnly: true/);
  assert.match(authorizeSource, /sameSite: "lax"/);
  assert.match(authorizeSource, /maxAge: 900/);
  assert.match(authorizeSource, /secure: process\.env\.NODE_ENV === "production"/);
});

test("classifyTokenLifetime marks expiry, the final week, and no-expiry apart", async () => {
  const { classifyTokenLifetime, TOKEN_EXPIRY_WARNING_DAYS } = await import(
    "@/lib/connectors/token-storage"
  );
  const now = new Date("2026-09-12T00:00:00.000Z");
  const inDays = (days: number) =>
    new Date(now.getTime() + days * 86_400_000).toISOString();

  assert.equal(TOKEN_EXPIRY_WARNING_DAYS, 7);
  assert.deepEqual(classifyTokenLifetime(null, now), {
    state: "no-expiry",
    expiresAt: null,
    daysRemaining: null,
  });
  assert.equal(classifyTokenLifetime(inDays(60), now).state, "valid");
  assert.equal(classifyTokenLifetime(inDays(60), now).daysRemaining, 60);
  assert.equal(classifyTokenLifetime(inDays(3), now).state, "expiring-soon");
  assert.equal(classifyTokenLifetime(inDays(-1), now).state, "expired");
  // A lifetime that cannot be read is not a licence to keep using the token.
  assert.equal(classifyTokenLifetime("not-a-timestamp", now).state, "expired");
  // The boundary itself counts as expired, not as its last second of validity.
  assert.equal(classifyTokenLifetime(now.toISOString(), now).state, "expired");
});

// --------------------------------------------- OAuth origin and CSRF compare

interface SiteUrlSnapshot {
  NEXT_PUBLIC_SITE_URL: string | undefined;
  NEXT_PUBLIC_VERCEL_URL: string | undefined;
  VERCEL_ENV: string | undefined;
  VERCEL_PROJECT_PRODUCTION_URL: string | undefined;
  VERCEL_URL: string | undefined;
}

function snapshotSiteUrlEnvironment(): SiteUrlSnapshot {
  return {
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_VERCEL_URL: process.env.NEXT_PUBLIC_VERCEL_URL,
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    VERCEL_URL: process.env.VERCEL_URL,
  };
}

function restoreSiteUrlEnvironment(snapshot: SiteUrlSnapshot): void {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

/** Minimal stand-in carrying only what the origin resolver reads. */
function spoofedRequest(): Parameters<
  typeof import("@/lib/connectors/oauth").resolveOAuthCallbackUrl
>[0] {
  const headers = new Headers({
    "x-forwarded-host": "attacker.example",
    "x-forwarded-proto": "https",
    host: "attacker.example",
  });
  return { headers } as unknown as Parameters<
    typeof import("@/lib/connectors/oauth").resolveOAuthCallbackUrl
  >[0];
}

test("the OAuth redirect_uri comes from configuration, not a forwarded host", async () => {
  const { resolveOAuthCallbackUrl } = await import("@/lib/connectors/oauth");
  const snapshot = snapshotSiteUrlEnvironment();

  try {
    process.env.NEXT_PUBLIC_SITE_URL = "https://dashboard.example";
    const redirectUri = resolveOAuthCallbackUrl(spoofedRequest(), "meta-ads");

    // A spoofed x-forwarded-host would otherwise build a redirect_uri aimed at
    // someone else's server, with the authorization code attached.
    assert.equal(
      redirectUri,
      "https://dashboard.example/api/connectors/oauth/meta-ads/callback",
    );
    assert.doesNotMatch(redirectUri, /attacker\.example/);
  } finally {
    restoreSiteUrlEnvironment(snapshot);
  }
});

test("a production deployment with no configured origin fails closed", async () => {
  const { OAuthOriginError, resolveOAuthCallbackUrl } = await import(
    "@/lib/connectors/oauth"
  );
  const snapshot = snapshotSiteUrlEnvironment();

  try {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.NEXT_PUBLIC_VERCEL_URL;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    delete process.env.VERCEL_URL;
    process.env.VERCEL_ENV = "production";

    assert.throws(
      () => resolveOAuthCallbackUrl(spoofedRequest(), "meta-ads"),
      (err: unknown) => {
        assert.ok(err instanceof OAuthOriginError);
        assert.equal(err.code, "site_url_not_configured");
        return true;
      },
    );
  } finally {
    restoreSiteUrlEnvironment(snapshot);
  }
});

test("both OAuth routes turn a missing origin into a fixed error code", async () => {
  const [authorizeSource, callbackSource] = await Promise.all([
    readFile(
      new URL(
        "../src/app/api/connectors/oauth/[platform]/authorize/route.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../src/app/api/connectors/oauth/[platform]/callback/route.ts",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  for (const source of [authorizeSource, callbackSource]) {
    assert.match(source, /site_url_not_configured/);
    assert.match(source, /try \{\s*\n\s*redirectUri = resolveOAuthCallbackUrl/);
  }
});

test("CSRF state is compared in constant time and still rejects a mismatch", async () => {
  const { generateCSRFState, validateCSRFState } = await import(
    "@/lib/connectors/oauth"
  );
  const oauthSource = await readFile(
    new URL("../src/lib/connectors/oauth.ts", import.meta.url),
    "utf8",
  );

  const state = generateCSRFState("meta-ads");

  assert.equal(validateCSRFState("meta-ads", state, state), true);
  assert.equal(validateCSRFState("google-ads", state, state), false);
  assert.equal(validateCSRFState("meta-ads", state, undefined), false);
  // Same length, one character different: the case a naive compare leaks.
  const tampered = `${state.slice(0, -1)}${state.endsWith("a") ? "b" : "a"}`;
  assert.equal(validateCSRFState("meta-ads", state, tampered), false);
  // Different length must not throw, which timingSafeEqual does on its own.
  assert.equal(validateCSRFState("meta-ads", state, `${state}extra`), false);
  assert.match(oauthSource, /crypto\.timingSafeEqual/);
});

test("Google Analytics 4 is active; planned connectors include GSC, Shopify, and WooCommerce", async () => {
  const pageSource = await readFile(
    new URL("../src/app/data-sources/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    pageSource,
    /PLANNED_SOURCE_IDS = new Set\(\[/,
  );
  assert.match(pageSource, /"google-search-console"/);
  assert.match(pageSource, /"shopify"/);
  assert.match(pageSource, /"woocommerce"/);
  assert.match(
    pageSource,
    /readConnectorTelemetry\("google-analytics"\)/,
  );
  assert.doesNotMatch(pageSource, /index >= 2/);
});

test("OAuth failures name their own recovery and never echo the query string", async () => {
  const shellSource = await readFile(
    new URL("../src/components/dashboard/data-sources-shell.tsx", import.meta.url),
    "utf8",
  );

  // Every code the authorize and callback routes can send is classified, so
  // none falls through to generic advice.
  for (const code of [
    "consent_denied",
    "invalid_state",
    "missing_code_or_state",
    "missing_credentials",
    "site_url_not_configured",
    "unknown_client",
    "unsupported_platform",
    "missing_refresh_token",
    "unauthorized",
    "token_exchange_failed",
  ]) {
    assert.match(shellSource, new RegExp(`^\\s*${code}: "`, "m"), `${code} must be classified`);
  }

  // A misconfigured deployment must not be answered with "re-authorize".
  assert.match(shellSource, /Re-authorizing will not help/);
  // Anyone can craft a link to this page; a query parameter is never shown.
  assert.doesNotMatch(shellSource, /searchParams\.get\("detail"\)/);
  assert.doesNotMatch(shellSource, /errorDetail/);
});

test("the connector list no longer repeats the deployment mode on every row", async () => {
  const consoleSource = await readFile(
    new URL("../src/components/dashboard/connector-console.tsx", import.meta.url),
    "utf8",
  );
  const styles = await readFile(new URL("../src/app/globals.css", import.meta.url), "utf8");

  assert.doesNotMatch(consoleSource, /connector-mode/);
  assert.doesNotMatch(consoleSource, /<span>Mode<\/span>/);
  // The primary connect action says where it goes before it leaves the page.
  assert.match(consoleSource, /aria-describedby=\{`connector-oauth-hint-\$\{source\.id\}`\}/);
  // Per-cell labels stay available to assistive technology on desktop.
  const labelRule =
    styles.match(/\.connector-row__mobile-label \{[^}]*\}/)?.[0] ?? "";
  assert.doesNotMatch(labelRule, /display: none/);
  assert.match(labelRule, /clip: rect\(0 0 0 0\)/);

  // Only the connect hint sits right-aligned under its button. The connector
  // subtitle and the status note stay left-aligned with what they describe.
  const noteRule =
    styles.match(/\.connector-row__name small,[^{]*\{[^}]*\}/)?.[0] ?? "";
  assert.match(noteRule, /\.connector-row__status-note/);
  assert.doesNotMatch(noteRule, /text-align: right/);
  assert.doesNotMatch(noteRule, /connector-row__oauth-hint/);
  assert.match(styles, /\.integration-console \+ \.connector-runtime \{\s*margin-top: 18px;/);
});

// -------------------------------------------- manager-scoped authorisation

test("a manager-scoped refresh token is matched on mcc_id and nothing else", async () => {
  const snapshot = configureSupabaseEnvironment();
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];

  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    requested.push(request.url);
    return new Response(
      JSON.stringify([
        {
          client_slug: "kopi-senja",
          refresh_token: "refresh-token-test-value",
        },
      ]),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const granted = await getManagerScopedRefreshToken(
      "google-ads",
      " 1234500099 ",
    );

    assert.deepEqual(granted, {
      clientSlug: "kopi-senja",
      refreshToken: "refresh-token-test-value",
    });

    const url = requested[0] ?? "";
    // The manager id is the whole filter, alongside platform and liveness. A
    // query that fell back to "any active row" would hand one brand's consent
    // to a brand under a different manager.
    assert.match(url, /mcc_id=eq\.1234500099/);
    assert.match(url, /platform=eq\.google-ads/);
    assert.match(url, /status=eq\.active/);
    // Only the two columns needed leave the database; no access token is read.
    assert.match(url, /select=client_slug%2Crefresh_token|select=client_slug,refresh_token/);
    assert.equal(url.includes("access_token"), false);
  } finally {
    globalThis.fetch = originalFetch;
    restoreSupabaseEnvironment(snapshot);
  }
});

test("manager-scoped authorisation fails closed on a blank manager or an empty result", async () => {
  const snapshot = configureSupabaseEnvironment();
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    // A caller that cannot state its manager must not reach the database at
    // all: an unfiltered read is exactly the cross-brand leak this guards.
    assert.equal(await getManagerScopedRefreshToken("google-ads", "   "), null);
    assert.equal(calls, 0);

    // A manager nobody has consented on yields nothing rather than a fallback.
    assert.equal(
      await getManagerScopedRefreshToken("google-ads", "9999999999"),
      null,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    restoreSupabaseEnvironment(snapshot);
  }
});

test("a row with no usable refresh token is not a donor", async () => {
  const snapshot = configureSupabaseEnvironment();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify([{ client_slug: "kopi-senja", refresh_token: "  " }]),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  try {
    assert.equal(
      await getManagerScopedRefreshToken("google-ads", "1234500099"),
      null,
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreSupabaseEnvironment(snapshot);
  }
});

test("the Google connector shares authorisation by manager but never the customer id", async () => {
  const clientSource = await readFile(
    new URL("../src/lib/connectors/google-ads-api-client.ts", import.meta.url),
    "utf8",
  );
  const configSource = await readFile(
    new URL("../src/lib/connectors/google-ads-config.ts", import.meta.url),
    "utf8",
  );

  // Own consent first, the manager's only as a fallback, and only when this
  // brand actually has a manager configured.
  assert.match(clientSource, /getConnectorToken\("google-ads", this\.clientSlug\)/);
  assert.match(clientSource, /this\.config\.loginCustomerId\?\.trim\(\)/);
  assert.match(
    clientSource,
    /getManagerScopedCredentialRecord\(|getManagerScopedRefreshToken\(/,
  );

  // The customer id is what selects whose data returns, so it stays per brand:
  // no unsuffixed inheritance off the pilot, and two brands claiming one
  // account still refuse to sync.
  assert.match(configSource, /inheritedFromPilot/);
  assert.match(configSource, /detectCustomerIdCollisions/);
  assert.match(configSource, /state: "collision"/);
  assert.match(configSource, /historical-dataset/);

  const storageSource = await readFile(
    new URL("../src/lib/connectors/token-storage.ts", import.meta.url),
    "utf8",
  );
  assert.match(storageSource, /listLatestHistoricalGoogleCustomerIds/);
  assert.match(storageSource, /\.eq\("entity_level", "account"\)/);
  assert.match(storageSource, /ids\.size !== 1/);
});
