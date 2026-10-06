import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";

import { ConnectorFailure } from "@/lib/connectors/types";
import { MetaAdsApiClient } from "@/lib/connectors/meta-ads-api-client";

/**
 * Kopi Senja Nusantara lives inside the shared Nusantara Group ad account, so every test
 * here exists to prove one thing: no other brand's spend can reach these rows.
 * All tokens and ids below are synthetic.
 */
const BASE_CONFIG = {
  accessToken: "synthetic-access-token",
  adAccountId: "100000000000001",
  apiVersion: "v20.0",
  campaignNameFilter: "Kopi senja.",
};

const REQUEST = {
  clientId: "pilot-client",
  accountKey: "kopi-senja-usd",
  range: { start: "2026-08-01", end: "2026-08-02" },
};

type FetchCall = { url: string; init?: RequestInit };

let calls: FetchCall[];
let originalFetch: typeof fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function accountResponse(overrides: Record<string, unknown> = {}): Response {
  return jsonResponse({
    id: "act_100000000000001",
    name: "Nusantara Group",
    currency: "USD",
    account_status: 1,
    timezone_name: "Asia/Jakarta",
    ...overrides,
  });
}

/** Routes a fetch mock on the account probe vs. the insights edge. */
function installFetchMock(handler: (call: FetchCall, url: URL) => Response) {
  originalFetch = globalThis.fetch;
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    return handler({ url, init }, new URL(url));
  }) as typeof fetch;
}

function isInsights(url: URL): boolean {
  return url.pathname.endsWith("/insights");
}

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// --------------------------------------------------------------- health check

test("health() reports unconfigured without making any network call", async () => {
  installFetchMock(() => jsonResponse({}));

  const client = new MetaAdsApiClient({});
  const health = await client.health();

  assert.equal(health.available, false);
  assert.equal(health.authenticated, false);
  assert.equal(health.readOnly, true);
  assert.equal(calls.length, 0);
});

test("health() reports authenticated when the account probe succeeds", async () => {
  installFetchMock(() => accountResponse());

  const client = new MetaAdsApiClient(BASE_CONFIG);
  const health = await client.health();

  assert.equal(health.available, true);
  assert.equal(health.authenticated, true);
  assert.equal(health.readOnly, true);
  assert.match(health.safeMessage, /Nusantara Group/);
  assert.match(health.safeMessage, /USD/);
});

test("health() sends the token as a bearer header, never in the query string", async () => {
  installFetchMock(() => accountResponse());

  const client = new MetaAdsApiClient(BASE_CONFIG);
  await client.health();

  assert.equal(calls.length, 1);
  assert.ok(!calls[0].url.includes("synthetic-access-token"));
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer synthetic-access-token");
});

test("health() reports authenticated: false, not a throw, when the token is rejected", async () => {
  installFetchMock(() =>
    jsonResponse(
      { error: { message: "Session has expired", type: "OAuthException", code: 190 } },
      401,
    ),
  );

  const client = new MetaAdsApiClient(BASE_CONFIG);
  const health = await client.health();

  assert.equal(health.available, true);
  assert.equal(health.authenticated, false);
  assert.match(health.safeMessage, /authentication failed/i);
});

// ------------------------------------------------------ campaign name filter

test("fetchDailyMetrics() drops every campaign outside the Kopi Senja Nusantara filter", async () => {
  installFetchMock((_call, url) => {
    if (!isInsights(url)) return accountResponse();
    return jsonResponse({
      data: [
        {
          campaign_name: "Kopi senja. - Win-Back PMax",
          date_start: "2026-08-01",
          date_stop: "2026-08-01",
          spend: "100.00",
          impressions: "1000",
          clicks: "50",
        },
        {
          campaign_name: "Kopi senja. - Cold Brew Bundles",
          date_start: "2026-08-01",
          date_stop: "2026-08-01",
          spend: "50.00",
          impressions: "500",
          clicks: "25",
        },
        {
          campaign_name: "Nusantara Group - Wholesale Coffee Beans",
          date_start: "2026-08-01",
          date_stop: "2026-08-01",
          spend: "900.00",
          impressions: "9000",
          clicks: "450",
        },
        {
          campaign_name: "JMA ID - Retail",
          date_start: "2026-08-01",
          date_stop: "2026-08-01",
          spend: "700.00",
          impressions: "7000",
          clicks: "350",
        },
      ],
    });
  });

  const client = new MetaAdsApiClient(BASE_CONFIG);
  const result = await client.fetchDailyMetrics(REQUEST);

  assert.equal(result.rows.length, 1);
  const row = result.rows[0];
  assert.equal(row.date, "2026-08-01");
  // 100 + 50 only. 900 and 700 belong to other brands and must never appear.
  assert.equal(row.spend, 150);
  assert.equal(row.impressions, 1500);
  assert.equal(row.clicks, 75);
  assert.equal(row.currency, "USD");
  assert.equal(row.platform, "meta");
  assert.equal(row.sourceConnector, "meta-direct-api");
  assert.equal(row.accountTimezone, "Asia/Jakarta");
  assert.ok(result.warnings.some((w) => w.includes("2 campaign row(s) outside")));
});

test("fetchDailyMetrics() flags campaign names that match only case-insensitively", async () => {
  installFetchMock((_call, url) => {
    if (!isInsights(url)) return accountResponse();
    return jsonResponse({
      data: [
        {
          campaign_name: "KOPI SENJA. - Retargeting",
          date_start: "2026-08-01",
          spend: "10.00",
          impressions: "100",
          clicks: "5",
        },
      ],
    });
  });

  const client = new MetaAdsApiClient(BASE_CONFIG);
  const result = await client.fetchDailyMetrics(REQUEST);

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].spend, 10);
  assert.ok(result.warnings.some((w) => w.includes("case-insensitively")));
});

test("fetchDailyMetrics() returns no rows when nothing matches the filter", async () => {
  installFetchMock((_call, url) => {
    if (!isInsights(url)) return accountResponse();
    return jsonResponse({
      data: [
        {
          campaign_name: "JMA ID - Retail",
          date_start: "2026-08-01",
          spend: "700.00",
          impressions: "7000",
          clicks: "350",
        },
      ],
    });
  });

  const client = new MetaAdsApiClient(BASE_CONFIG);
  const result = await client.fetchDailyMetrics(REQUEST);

  assert.equal(result.rows.length, 0);
  assert.equal(result.coveragePercent, 0);
  assert.equal(result.attempts[0].outcome, "skipped");
});

// ------------------------------------------------------- action type mapping

test("fetchDailyMetrics() maps purchase, registration, and landing page actions", async () => {
  installFetchMock((_call, url) => {
    if (!isInsights(url)) return accountResponse();
    return jsonResponse({
      data: [
        {
          campaign_name: "Kopi senja. - Cold Brew Bundles",
          date_start: "2026-08-01",
          spend: "80.00",
          impressions: "800",
          clicks: "40",
          actions: [
            { action_type: "purchase", value: "3" },
            { action_type: "omni_purchase", value: "2" },
            { action_type: "complete_registration", value: "5" },
            { action_type: "lead", value: "1" },
            { action_type: "landing_page_view", value: "40" },
            { action_type: "add_to_cart", value: "9" },
            { action_type: "initiate_checkout", value: "4" },
          ],
          action_values: [
            { action_type: "purchase", value: "250.00" },
            { action_type: "omni_purchase", value: "100.00" },
            { action_type: "add_to_cart", value: "999.00" },
          ],
        },
      ],
    });
  });

  const client = new MetaAdsApiClient(BASE_CONFIG);
  const result = await client.fetchDailyMetrics(REQUEST);
  const row = result.rows[0];

  // omni_purchase is the superset of purchase; the two are never added.
  assert.equal(row.purchases, 2);
  assert.equal(row.registrations, 6); // complete_registration 5 + lead 1
  assert.equal(row.landingPageViews, 40);
  // add_to_cart value must not leak into revenue.
  assert.equal(row.platformConversionValue, 100);
  assert.equal(row.actualPurchaseRevenue, 100);
  assert.ok(result.warnings.some((w) => w.includes("add_to_cart")));
  assert.ok(result.warnings.some((w) => w.includes("omni_purchase is the superset")));
});

/**
 * The defect this pins: summing `purchase` and `omni_purchase`. Meta reports
 * the same order under both, so every figure published that way is exactly
 * double.
 */
test("fetchDailyMetrics() never adds purchase to omni_purchase", async () => {
  installFetchMock((_call, url) => {
    if (!isInsights(url)) return accountResponse();
    return jsonResponse({
      data: [
        {
          campaign_name: "Kopi senja. - Cold Brew Bundles",
          date_start: "2026-08-01",
          spend: "64.37",
          impressions: "1000",
          clicks: "50",
          // The shape a live account returns: one order set,
          // reported under both aliases with identical totals.
          actions: [
            { action_type: "purchase", value: "19" },
            { action_type: "omni_purchase", value: "19" },
          ],
          action_values: [
            { action_type: "purchase", value: "593.18" },
            { action_type: "omni_purchase", value: "593.18" },
          ],
        },
      ],
    });
  });

  const client = new MetaAdsApiClient(BASE_CONFIG);
  const row = (await client.fetchDailyMetrics(REQUEST)).rows[0];

  assert.equal(row.purchases, 19, "19 orders must not become 38");
  assert.equal(row.platformConversionValue, 593.18);
  assert.equal(row.actualPurchaseRevenue, 593.18);
});

test("fetchDailyMetrics() falls back to purchase when Meta reports no omni alias", async () => {
  installFetchMock((_call, url) => {
    if (!isInsights(url)) return accountResponse();
    return jsonResponse({
      data: [
        {
          campaign_name: "Kopi senja. - Cold Brew Bundles",
          date_start: "2026-08-01",
          spend: "40.00",
          impressions: "500",
          clicks: "25",
          actions: [{ action_type: "purchase", value: "4" }],
          action_values: [{ action_type: "purchase", value: "120.00" }],
        },
      ],
    });
  });

  const client = new MetaAdsApiClient(BASE_CONFIG);
  const row = (await client.fetchDailyMetrics(REQUEST)).rows[0];

  assert.equal(row.purchases, 4);
  assert.equal(row.platformConversionValue, 120);
});

test("fetchDailyMetrics() treats a reported omni_purchase of zero as the answer", async () => {
  // Absent and zero are different things. A day where Meta reports
  // omni_purchase = 0 alongside a stale web alias has zero omni-channel
  // orders; falling back to `purchase` there would resurrect the double count.
  installFetchMock((_call, url) => {
    if (!isInsights(url)) return accountResponse();
    return jsonResponse({
      data: [
        {
          campaign_name: "Kopi senja. - Cold Brew Bundles",
          date_start: "2026-08-01",
          spend: "10.00",
          impressions: "100",
          clicks: "5",
          actions: [
            { action_type: "omni_purchase", value: "0" },
            { action_type: "purchase", value: "3" },
          ],
          action_values: [
            { action_type: "omni_purchase", value: "0" },
            { action_type: "purchase", value: "90.00" },
          ],
        },
      ],
    });
  });

  const client = new MetaAdsApiClient(BASE_CONFIG);
  const row = (await client.fetchDailyMetrics(REQUEST)).rows[0];

  assert.equal(row.purchases, 0);
  assert.equal(row.platformConversionValue, 0);
});

test("fetchDailyMetrics() aggregates matching campaigns per day and keeps days separate", async () => {
  installFetchMock((_call, url) => {
    if (!isInsights(url)) return accountResponse();
    return jsonResponse({
      data: [
        {
          campaign_name: "Kopi senja. - A",
          date_start: "2026-08-02",
          spend: "20.00",
          impressions: "200",
          clicks: "10",
          actions: [{ action_type: "purchase", value: "1" }],
        },
        {
          campaign_name: "Kopi senja. - B",
          date_start: "2026-08-01",
          spend: "30.00",
          impressions: "300",
          clicks: "15",
          actions: [{ action_type: "purchase", value: "2" }],
        },
        {
          campaign_name: "Kopi senja. - C",
          date_start: "2026-08-01",
          spend: "5.00",
          impressions: "50",
          clicks: "2",
          actions: [{ action_type: "purchase", value: "1" }],
        },
      ],
    });
  });

  const client = new MetaAdsApiClient(BASE_CONFIG);
  const result = await client.fetchDailyMetrics(REQUEST);

  assert.equal(result.rows.length, 2);
  assert.deepEqual(
    result.rows.map((r) => r.date),
    ["2026-08-01", "2026-08-02"],
  );
  assert.equal(result.rows[0].spend, 35);
  assert.equal(result.rows[0].purchases, 3);
  assert.equal(result.rows[1].spend, 20);
  assert.equal(result.rows[1].purchases, 1);
});

// -------------------------------------------------- currency and pagination

test("fetchDailyMetrics() fails closed when the account currency is not the expected one", async () => {
  installFetchMock((_call, url) => {
    if (!isInsights(url)) return accountResponse({ currency: "EUR" });
    return jsonResponse({ data: [] });
  });

  const client = new MetaAdsApiClient(BASE_CONFIG);
  await assert.rejects(
    () => client.fetchDailyMetrics(REQUEST),
    (err: unknown) => {
      assert.ok(err instanceof ConnectorFailure);
      assert.equal(err.code, "configuration-error");
      assert.equal(err.retryable, false);
      return true;
    },
  );
});

test("fetchDailyMetrics() follows the paging cursor without putting the token in a URL", async () => {
  installFetchMock((_call, url) => {
    if (!isInsights(url)) return accountResponse();
    if (url.searchParams.get("after") === "cursor-page-2") {
      return jsonResponse({
        data: [
          {
            campaign_name: "Kopi senja. - Page Two",
            date_start: "2026-08-02",
            spend: "40.00",
            impressions: "400",
            clicks: "20",
          },
        ],
      });
    }
    return jsonResponse({
      data: [
        {
          campaign_name: "Kopi senja. - Page One",
          date_start: "2026-08-01",
          spend: "60.00",
          impressions: "600",
          clicks: "30",
        },
      ],
      paging: { next: "https://graph.facebook.com/next", cursors: { after: "cursor-page-2" } },
    });
  });

  const client = new MetaAdsApiClient(BASE_CONFIG);
  const result = await client.fetchDailyMetrics(REQUEST);

  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].spend, 60);
  assert.equal(result.rows[1].spend, 40);
  assert.ok(calls.every((c) => !c.url.includes("synthetic-access-token")));
});

// -------------------------------------------------- resiliency and failures

test("fetchDailyMetrics() raises a retryable rate-limited failure on a Meta throttle code", async () => {
  installFetchMock((_call, url) => {
    if (!isInsights(url)) return accountResponse();
    return jsonResponse(
      {
        error: {
          message: "User request limit reached",
          type: "OAuthException",
          code: 17,
          error_subcode: 2446079,
        },
      },
      400,
    );
  });

  const client = new MetaAdsApiClient(BASE_CONFIG);
  await assert.rejects(
    () => client.fetchDailyMetrics(REQUEST),
    (err: unknown) => {
      assert.ok(err instanceof ConnectorFailure);
      // Throttling arrives typed as OAuthException; it must not be mistaken
      // for a dead credential, which would be non-retryable.
      assert.equal(err.code, "rate-limited");
      assert.equal(err.retryable, true);
      return true;
    },
  );
});

test("fetchDailyMetrics() treats HTTP 429 as retryable rate limiting", async () => {
  installFetchMock((_call, url) => {
    if (!isInsights(url)) return accountResponse();
    return jsonResponse({ error: { message: "Too many calls" } }, 429);
  });

  const client = new MetaAdsApiClient(BASE_CONFIG);
  await assert.rejects(
    () => client.fetchDailyMetrics(REQUEST),
    (err: unknown) => {
      assert.ok(err instanceof ConnectorFailure);
      assert.equal(err.code, "rate-limited");
      assert.equal(err.retryable, true);
      return true;
    },
  );
});

test("fetchDailyMetrics() raises a non-retryable unauthenticated failure on an OAuth error", async () => {
  installFetchMock((_call, url) => {
    if (!isInsights(url)) return accountResponse();
    return jsonResponse(
      { error: { message: "Invalid OAuth access token", type: "OAuthException", code: 190 } },
      401,
    );
  });

  const client = new MetaAdsApiClient(BASE_CONFIG);
  await assert.rejects(
    () => client.fetchDailyMetrics(REQUEST),
    (err: unknown) => {
      assert.ok(err instanceof ConnectorFailure);
      assert.equal(err.code, "unauthenticated");
      assert.equal(err.retryable, false);
      return true;
    },
  );
});

test("fetchDailyMetrics() raises a retryable unavailable failure on a Meta server error", async () => {
  installFetchMock((_call, url) => {
    if (!isInsights(url)) return accountResponse();
    return jsonResponse({ error: { message: "Internal error" } }, 500);
  });

  const client = new MetaAdsApiClient(BASE_CONFIG);
  await assert.rejects(
    () => client.fetchDailyMetrics(REQUEST),
    (err: unknown) => {
      assert.ok(err instanceof ConnectorFailure);
      assert.equal(err.code, "unavailable");
      assert.equal(err.retryable, true);
      return true;
    },
  );
});

test("fetchDailyMetrics() refuses to call the API at all without credentials", async () => {
  installFetchMock(() => accountResponse());

  const client = new MetaAdsApiClient({});
  await assert.rejects(
    () => client.fetchDailyMetrics(REQUEST),
    (err: unknown) => {
      assert.ok(err instanceof ConnectorFailure);
      assert.equal(err.code, "unauthenticated");
      return true;
    },
  );
  assert.equal(calls.length, 0);
});

// ------------------------------------------------- database-backed credential

interface SupabaseEnvironmentSnapshot {
  DASHBOARD_AUTH_MODE: string | undefined;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: string | undefined;
  NEXT_PUBLIC_SUPABASE_URL: string | undefined;
  SUPABASE_SERVICE_ROLE_KEY: string | undefined;
}

function configureSupabaseEnvironment(): SupabaseEnvironmentSnapshot {
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

function restoreSupabaseEnvironment(snapshot: SupabaseEnvironmentSnapshot): void {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

test("the stored connector token outranks META_ADS_ACCESS_TOKEN", async () => {
  const snapshot = configureSupabaseEnvironment();
  installFetchMock((call, url) => {
    if (call.url.includes("project.supabase.co")) {
      return jsonResponse({
        id: "9f2b0a30-2a1e-4f61-9a67-2b6a1c0a5d11",
        platform: "meta-ads",
        client_slug: "kopi-senja",
        mcc_id: null,
        customer_id: null,
        access_token: "token-from-database",
        refresh_token: "refresh-from-database",
        token_type: "Bearer",
        scope: "ads_read",
        expires_at: null,
        status: "active",
        metadata: {},
        created_at: "2026-09-08T10:00:00.000Z",
        updated_at: "2026-09-08T10:00:00.000Z",
      });
    }
    if (isInsights(url)) return jsonResponse({ data: [] });
    return accountResponse();
  });

  try {
    const client = new MetaAdsApiClient({
      ...BASE_CONFIG,
      accessToken: "token-from-environment",
    });
    const health = await client.health();

    assert.equal(health.authenticated, true);
    assert.match(health.safeMessage, /connector_tokens \(meta-ads\)/);

    const graphCall = calls.find((call) => call.url.includes("graph.facebook.com"));
    assert.ok(graphCall);
    const headers = new Headers(graphCall.init?.headers);
    assert.equal(headers.get("authorization"), "Bearer token-from-database");
    // The credential must never reach a URL, whichever source it came from.
    assert.doesNotMatch(graphCall.url, /token-from-database|token-from-environment/);
  } finally {
    restoreSupabaseEnvironment(snapshot);
  }
});

test("the stored-token lookup is filtered to active rows and falls back safely", async () => {
  const snapshot = configureSupabaseEnvironment();
  installFetchMock((call, url) => {
    if (call.url.includes("project.supabase.co")) {
      // A revoked row is filtered out server-side, so PostgREST returns null.
      return jsonResponse(null);
    }
    if (isInsights(url)) return jsonResponse({ data: [] });
    return accountResponse();
  });

  try {
    const client = new MetaAdsApiClient({
      ...BASE_CONFIG,
      accessToken: "token-from-environment",
    });
    const health = await client.health();

    const supabaseCalls = calls.filter((call) =>
      call.url.includes("project.supabase.co"),
    );
    assert.ok(supabaseCalls.length > 0);
    assert.ok(
      supabaseCalls.every((call) => call.url.includes("status=eq.active")),
      "every stored-token lookup must exclude revoked rows",
    );

    // With no active stored row the device-local fallback still works, so a
    // machine without a Supabase worker secret is not stranded.
    assert.equal(health.authenticated, true);
    assert.match(health.safeMessage, /META_ADS_ACCESS_TOKEN/);
  } finally {
    restoreSupabaseEnvironment(snapshot);
  }
});

// --------------------------------------------------- pinned advertiser guard

test("a pinned client refuses an ad account it inherited from the environment", async () => {
  installFetchMock(() => {
    throw new Error("The pin must be checked before any network call.");
  });

  const client = new MetaAdsApiClient({
    ...BASE_CONFIG,
    // What an ambient OS-level META_AD_ACCOUNT_ID can do.
    adAccountId: "act_100000000000002",
    expectedAdAccountId: "act_100000000000001",
  });

  await assert.rejects(
    () => client.fetchDailyMetrics(REQUEST),
    (error: unknown) => {
      assert.ok(error instanceof ConnectorFailure);
      assert.equal(error.code, "configuration-error");
      assert.equal(error.retryable, false);
      assert.match(error.message, /pinned to 100000000000001/);
      return true;
    },
  );

  assert.equal(calls.length, 0, "no request may reach Meta once the pin fails");
});

test("health() reports the pin mismatch instead of claiming authentication", async () => {
  installFetchMock(() => accountResponse());

  const client = new MetaAdsApiClient({
    ...BASE_CONFIG,
    adAccountId: "act_100000000000002",
    expectedAdAccountId: "act_100000000000001",
  });

  const health = await client.health();

  assert.equal(health.authenticated, false);
  assert.match(health.safeMessage, /pinned to 100000000000001/);
});

test("the pin accepts the configured account in either act_ or bare form", async () => {
  installFetchMock((call, url) => {
    if (isInsights(url)) return jsonResponse({ data: [] });
    return accountResponse();
  });

  const client = new MetaAdsApiClient({
    ...BASE_CONFIG,
    adAccountId: "act_100000000000001",
    expectedAdAccountId: "100000000000001",
  });

  const health = await client.health();

  assert.equal(health.authenticated, true);
});

// ------------------------------------------------ stored credential lifetime

/** A stored Meta row whose access token expires at the given instant. */
function storedMetaTokenRow(expiresAt: string | null): Response {
  return jsonResponse({
    id: "9f2b0a30-2a1e-4f61-9a67-2b6a1c0a5d11",
    platform: "meta-ads",
    client_slug: "kopi-senja",
    mcc_id: null,
    customer_id: null,
    access_token: "token-from-database",
    // Meta issues none; the column is nullable since migration 0005.
    refresh_token: null,
    token_type: "Bearer",
    scope: "ads_read",
    expires_at: expiresAt,
    status: "active",
    metadata: { hasRefreshToken: false },
    created_at: "2026-07-14T10:00:00.000Z",
    updated_at: "2026-07-14T10:00:00.000Z",
  });
}

test("an expired stored token fails closed and never falls back to the environment", async () => {
  const snapshot = configureSupabaseEnvironment();
  installFetchMock((call, url) => {
    if (call.url.includes("project.supabase.co")) {
      return storedMetaTokenRow("2026-01-01T00:00:00.000Z");
    }
    if (isInsights(url)) return jsonResponse({ data: [] });
    return accountResponse();
  });

  try {
    const client = new MetaAdsApiClient({
      ...BASE_CONFIG,
      accessToken: "token-from-environment",
    });
    const health = await client.health();

    assert.equal(health.authenticated, false);
    assert.match(health.safeMessage, /expired on 2026-01-01/);
    assert.match(health.safeMessage, /reconnect Meta/i);
    // Falling back to the environment here is exactly how a stale credential
    // for a different advertiser could get used.
    assert.equal(
      calls.some((call) => call.url.includes("graph.facebook.com")),
      false,
      "an expired grant must not reach Meta at all",
    );

    await assert.rejects(
      () => client.fetchDailyMetrics(REQUEST),
      (err: unknown) => {
        assert.ok(err instanceof ConnectorFailure);
        assert.equal(err.code, "unauthenticated");
        assert.match(err.message, /expired on 2026-01-01/);
        assert.equal(err.retryable, false);
        return true;
      },
    );
  } finally {
    restoreSupabaseEnvironment(snapshot);
  }
});

test("a token inside its last week still works but says how long is left", async () => {
  const snapshot = configureSupabaseEnvironment();
  // An hour of slack: whole days are floored, so an exact 3-day offset
  // becomes "2 day(s)" by the time the connector reads it.
  const inThreeDays = new Date(Date.now() + 3 * 86_400_000 + 3_600_000).toISOString();
  installFetchMock((call, url) => {
    if (call.url.includes("project.supabase.co")) return storedMetaTokenRow(inThreeDays);
    if (isInsights(url)) return jsonResponse({ data: [] });
    return accountResponse();
  });

  try {
    const client = new MetaAdsApiClient(BASE_CONFIG);
    const health = await client.health();

    assert.equal(health.authenticated, true);
    assert.match(health.safeMessage, /expires in 3 day\(s\)/);

    const result = await client.fetchDailyMetrics(REQUEST);
    assert.equal(
      result.warnings.some((warning) => /expires in 3 day\(s\)/.test(warning)),
      true,
      "the refresh must warn while there is still time to reconnect",
    );
  } finally {
    restoreSupabaseEnvironment(snapshot);
  }
});

test("a token with plenty of life left adds no expiry noise", async () => {
  const snapshot = configureSupabaseEnvironment();
  const inFiftyDays = new Date(Date.now() + 50 * 86_400_000).toISOString();
  installFetchMock((call, url) => {
    if (call.url.includes("project.supabase.co")) return storedMetaTokenRow(inFiftyDays);
    if (isInsights(url)) return jsonResponse({ data: [] });
    return accountResponse();
  });

  try {
    const client = new MetaAdsApiClient(BASE_CONFIG);
    const health = await client.health();

    assert.equal(health.authenticated, true);
    assert.doesNotMatch(health.safeMessage, /expires in/);
  } finally {
    restoreSupabaseEnvironment(snapshot);
  }
});
