import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";

import { ConnectorFailure } from "@/lib/connectors/types";
import { GoogleAdsApiClient } from "@/lib/connectors/google-ads-api-client";
import { resolveGoogleAdsConfig } from "@/lib/connectors/google-ads-config";

const BASE_CONFIG = {
  developerToken: "dev-token",
  clientId: "client-id",
  clientSecret: "client-secret",
  refreshToken: "refresh-token",
  customerId: "1234500001",
  loginCustomerId: "1234500099",
};

test("a brand can recover its account mapping from its latest stored live lineage", () => {
  const result = resolveGoogleAdsConfig("batik-lestari", {
    storedCustomerIds: [],
    historicalCustomerIds: [
      { clientSlug: "batik-lestari", customerId: "1234567890" },
    ],
    environment: {},
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.customerIdSource, "historical-dataset");
  assert.equal(result.config.customerId, "1234567890");
});

test("an explicit brand mapping outranks historical lineage", () => {
  const result = resolveGoogleAdsConfig("batik-lestari", {
    storedCustomerIds: [],
    historicalCustomerIds: [
      { clientSlug: "batik-lestari", customerId: "1234567890" },
    ],
    environment: {
      GOOGLE_ADS_CUSTOMER_ID_BATIK_LESTARI: "0987654321",
    },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.customerIdSource, "brand-env");
  assert.equal(result.config.customerId, "0987654321");
});

test("historical account mappings remain subject to the cross-brand collision guard", () => {
  const result = resolveGoogleAdsConfig("batik-lestari", {
    storedCustomerIds: [],
    historicalCustomerIds: [
      { clientSlug: "batik-lestari", customerId: "1234567890" },
      { clientSlug: "rumah-rajut", customerId: "1234567890" },
    ],
    environment: {},
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.state, "collision");
});

type FetchCall = { url: string; init?: RequestInit };

let calls: FetchCall[];
let originalFetch: typeof fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Routes a fetch mock based on the OAuth endpoint vs. the GAQL query body. */
function installFetchMock(
  handler: (call: FetchCall, query: string | null) => Response,
) {
  originalFetch = globalThis.fetch;
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });

    let query: string | null = null;
    if (init?.body && typeof init.body === "string") {
      try {
        query = (JSON.parse(init.body) as { query?: string }).query ?? null;
      } catch {
        query = null;
      }
    }

    return handler({ url, init }, query);
  }) as typeof fetch;
}


/**
 * A synthetic set of conversion actions shaped like a typical account's,
 * for the demo customer 1234500001. "New
 * Registration" and "New Order" are the only two the dashboard may map;
 * "Time on Site - 60 Seconds" and the GA4 purchase duplicate are the
 * contaminants that would make a conversion history unusable.
 */
const KOPI_SENJA_CONVERSION_ACTIONS = [
  {
    conversionAction: {
      id: "900000002",
      name: "New Registration",
      category: "SIGNUP",
      type: "WEBPAGE",
      status: "ENABLED",
      includeInConversionsMetric: true,
    },
  },
  {
    conversionAction: {
      id: "900000001",
      name: "New Order",
      category: "PURCHASE",
      type: "WEBPAGE",
      status: "ENABLED",
      includeInConversionsMetric: true,
    },
  },
  {
    conversionAction: {
      id: "9000000011",
      name: "Time on Site - 60 Seconds",
      category: "PAGE_VIEW",
      type: "WEBPAGE",
      status: "ENABLED",
      includeInConversionsMetric: false,
    },
  },
  {
    conversionAction: {
      id: "9000000014",
      name: "KopiSenja - GA4 (web) purchase",
      category: "PURCHASE",
      type: "GOOGLE_ANALYTICS_4_PURCHASE",
      status: "ENABLED",
      includeInConversionsMetric: false,
    },
  },
];

/** True for the bounded configuration query that lists conversion actions. */
function isConversionActionCatalogQuery(query: string | null): boolean {
  return Boolean(query?.includes("FROM conversion_action"));
}

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("health() reports authenticated when OAuth and a bounded live query both succeed", async () => {
  installFetchMock((call) => {
    if (call.url.includes("oauth2.googleapis.com")) {
      return jsonResponse({ access_token: "fake-access-token" });
    }
    return jsonResponse({
      results: [
        { customer: { id: "1234500001", descriptiveName: "KopiSenja" } },
      ],
    });
  });

  const client = new GoogleAdsApiClient(BASE_CONFIG);
  const health = await client.health();

  assert.equal(health.available, true);
  assert.equal(health.authenticated, true);
  assert.match(health.safeMessage, /KopiSenja/);
});

test("health() reports authenticated: false, not a throw, when the token refresh fails", async () => {
  installFetchMock((call) => {
    if (call.url.includes("oauth2.googleapis.com")) {
      return jsonResponse({ error: "invalid_grant" }, 400);
    }
    return jsonResponse({ results: [] });
  });

  const client = new GoogleAdsApiClient(BASE_CONFIG);
  const health = await client.health();

  assert.equal(health.available, true);
  assert.equal(health.authenticated, false);
  assert.match(health.safeMessage, /authentication failed/);
});

test("fetchDailyMetrics() maps core metrics and filters conversions to the approved action IDs only", async () => {
  installFetchMock((call, query) => {
    if (call.url.includes("oauth2.googleapis.com")) {
      return jsonResponse({ access_token: "fake-access-token" });
    }
    if (isConversionActionCatalogQuery(query)) {
      return jsonResponse({ results: KOPI_SENJA_CONVERSION_ACTIONS });
    }
    if (query?.includes("segments.conversion_action")) {
      return jsonResponse({
        results: [
          {
            segments: {
              date: "2026-08-01",
              conversionAction: "customers/1234500001/conversionActions/900000002",
            },
            metrics: { allConversions: "4", allConversionsValue: "0" },
          },
          {
            segments: {
              date: "2026-08-01",
              conversionAction: "customers/1234500001/conversionActions/900000001",
            },
            metrics: { allConversions: "2", allConversionsValue: "186.5" },
          },
          {
            // A GA4-duplicate purchase action that must NOT be counted —
            // it is not in the approved id list, mirroring the real
            // KopiSenja account where it carries include_in_conversions_metric=false.
            segments: {
              date: "2026-08-01",
              conversionAction: "customers/1234500001/conversionActions/9000000014",
            },
            metrics: { allConversions: "99", allConversionsValue: "9999" },
          },
        ],
      });
    }
    return jsonResponse({
      results: [
        {
          segments: { date: "2026-08-01" },
          customer: { currencyCode: "GBP", timeZone: "Etc/GMT" },
          metrics: { impressions: "1000", clicks: "50", costMicros: "12500000" },
        },
      ],
    });
  });

  const client = new GoogleAdsApiClient({
    ...BASE_CONFIG,
    registrationConversionActionId: "900000002",
    purchaseConversionActionId: "900000001",
  });

  const result = await client.fetchDailyMetrics({
    clientId: "satulayar-demo",
    accountKey: "kopi-senja-usd",
    range: { start: "2026-08-01", end: "2026-08-01" },
  });

  assert.equal(result.rows.length, 1);
  const row = result.rows[0];
  assert.equal(row.date, "2026-08-01");
  assert.equal(row.currency, "GBP");
  assert.equal(row.accountTimezone, "Etc/GMT");
  assert.equal(row.spend, 12.5);
  assert.equal(row.impressions, 1000);
  assert.equal(row.clicks, 50);
  assert.equal(row.registrations, 4);
  assert.equal(row.purchases, 2);
  assert.equal(row.platformConversionValue, 186.5);
  assert.equal(row.actualPurchaseRevenue, 186.5);
  assert.equal(row.sourceConnector, "google-direct-api");
});

test("fetchDailyMetrics() reports zero conversions with a warning instead of guessing a mapping", async () => {
  installFetchMock((call) => {
    if (call.url.includes("oauth2.googleapis.com")) {
      return jsonResponse({ access_token: "fake-access-token" });
    }
    return jsonResponse({
      results: [
        {
          segments: { date: "2026-08-01" },
          customer: { currencyCode: "GBP", timeZone: "Etc/GMT" },
          metrics: { impressions: "10", clicks: "1", costMicros: "1000000" },
        },
      ],
    });
  });

  const client = new GoogleAdsApiClient(BASE_CONFIG); // no conversion action ids

  const result = await client.fetchDailyMetrics({
    clientId: "satulayar-demo",
    accountKey: "kopi-senja-usd",
    range: { start: "2026-08-01", end: "2026-08-01" },
  });

  assert.equal(result.rows[0].registrations, 0);
  assert.equal(result.rows[0].purchases, 0);
  assert.ok(
    result.warnings.some((warning) => warning.includes("not set")),
    "expected a warning explaining registrations/purchases were not guessed",
  );
});

test("fetchDailyMetrics() fails closed on an unsupported account currency instead of guessing", async () => {
  installFetchMock((call) => {
    if (call.url.includes("oauth2.googleapis.com")) {
      return jsonResponse({ access_token: "fake-access-token" });
    }
    return jsonResponse({
      results: [
        {
          segments: { date: "2026-08-01" },
          customer: { currencyCode: "JPY", timeZone: "Asia/Tokyo" },
          metrics: { impressions: "10", clicks: "1", costMicros: "1000000" },
        },
      ],
    });
  });

  const client = new GoogleAdsApiClient(BASE_CONFIG);

  await assert.rejects(
    () =>
      client.fetchDailyMetrics({
        clientId: "satulayar-demo",
        accountKey: "jamu-alami",
        range: { start: "2026-08-01", end: "2026-08-01" },
      }),
    (err: unknown) => {
      assert.ok(err instanceof ConnectorFailure);
      assert.equal(err.code, "configuration-error");
      return true;
    },
  );
});

test("fetchDailyMetrics() marks today's row provisional in the account timezone", async () => {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Etc/GMT",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  installFetchMock((call) => {
    if (call.url.includes("oauth2.googleapis.com")) {
      return jsonResponse({ access_token: "fake-access-token" });
    }
    return jsonResponse({
      results: [
        {
          segments: { date: "2026-01-01" },
          customer: { currencyCode: "GBP", timeZone: "Etc/GMT" },
          metrics: { impressions: "10", clicks: "1", costMicros: "1000000" },
        },
        {
          segments: { date: today },
          customer: { currencyCode: "GBP", timeZone: "Etc/GMT" },
          metrics: { impressions: "5", clicks: "1", costMicros: "500000" },
        },
      ],
    });
  });

  const client = new GoogleAdsApiClient(BASE_CONFIG);
  const result = await client.fetchDailyMetrics({
    clientId: "satulayar-demo",
    accountKey: "kopi-senja-usd",
    range: { start: "2026-01-01", end: today },
  });

  const historic = result.rows.find((row) => row.date === "2026-01-01");
  const provisional = result.rows.find((row) => row.date === today);
  assert.equal(historic?.isProvisional, false);
  assert.equal(provisional?.isProvisional, true);
});

test("fetchDailyMetrics() paginates through nextPageToken", async () => {
  let coreCallCount = 0;
  installFetchMock((call, query) => {
    if (call.url.includes("oauth2.googleapis.com")) {
      return jsonResponse({ access_token: "fake-access-token" });
    }
    if (
      query?.includes("segments.conversion_action") ||
      isConversionActionCatalogQuery(query)
    ) {
      return jsonResponse({ results: [] });
    }
    coreCallCount += 1;
    if (coreCallCount === 1) {
      return jsonResponse({
        results: [
          {
            segments: { date: "2026-08-01" },
            customer: { currencyCode: "GBP", timeZone: "Etc/GMT" },
            metrics: { impressions: "10", clicks: "1", costMicros: "1000000" },
          },
        ],
        nextPageToken: "page-2",
      });
    }
    return jsonResponse({
      results: [
        {
          segments: { date: "2026-08-02" },
          customer: { currencyCode: "GBP", timeZone: "Etc/GMT" },
          metrics: { impressions: "20", clicks: "2", costMicros: "2000000" },
        },
      ],
    });
  });

  const client = new GoogleAdsApiClient(BASE_CONFIG);
  const result = await client.fetchDailyMetrics({
    clientId: "satulayar-demo",
    accountKey: "kopi-senja-usd",
    range: { start: "2026-08-01", end: "2026-08-02" },
  });

  assert.equal(coreCallCount, 2);
  assert.equal(result.rows.length, 2);
});

// ------------------------------------------- conversion action mapping guard

test("verifyConversionActionMapping() confirms the real Kopi Senja Nusantara mapping", async () => {
  installFetchMock((call, query) => {
    if (call.url.includes("oauth2.googleapis.com")) {
      return jsonResponse({ access_token: "fake-access-token" });
    }
    if (isConversionActionCatalogQuery(query)) {
      return jsonResponse({ results: KOPI_SENJA_CONVERSION_ACTIONS });
    }
    return jsonResponse({ results: [] });
  });

  const client = new GoogleAdsApiClient({
    ...BASE_CONFIG,
    registrationConversionActionId: "900000002",
    purchaseConversionActionId: "900000001",
  });

  const report = await client.verifyConversionActionMapping();

  assert.equal(report.ok, true);
  assert.equal(report.registration?.name, "New Registration");
  assert.equal(report.registration?.category, "SIGNUP");
  assert.equal(report.purchase?.name, "New Order");
  assert.equal(report.purchase?.category, "PURCHASE");
  // Time on Site is enabled in this account and must be surfaced as a hazard
  // even though it is excluded from the figures.
  assert.ok(
    report.contaminatedCandidates.some((action) =>
      action.name.includes("Time on Site"),
    ),
    "expected the enabled Time on Site action to be reported as a contaminant",
  );
});

test("missing acquisition ids recover only from unique semantic actions", async () => {
  installFetchMock((call) => {
    if (call.url.includes("oauth2.googleapis.com")) {
      return jsonResponse({ access_token: "fake-access-token" });
    }
    return jsonResponse({ results: KOPI_SENJA_CONVERSION_ACTIONS });
  });

  const report = await new GoogleAdsApiClient({
    ...BASE_CONFIG,
  }).verifyConversionActionMapping();

  assert.equal(report.ok, true);
  assert.equal(report.registration?.category, "SIGNUP");
  assert.equal(report.purchase?.category, "PURCHASE");
  assert.ok(
    report.problems.some((problem) => problem.includes("Registration mapping recovered")),
  );
  assert.ok(
    report.problems.some((problem) => problem.includes("Purchase mapping recovered")),
  );
});

test("ambiguous signup actions are never auto-selected", async () => {
  installFetchMock((call) => {
    if (call.url.includes("oauth2.googleapis.com")) {
      return jsonResponse({ access_token: "fake-access-token" });
    }
    return jsonResponse({
      results: [
        ...KOPI_SENJA_CONVERSION_ACTIONS,
        {
          conversionAction: {
            id: "111111111",
            name: "Second registration",
            category: "SIGNUP",
            type: "WEBPAGE",
            status: "ENABLED",
            includeInConversionsMetric: false,
          },
        },
      ],
    });
  });

  const report = await new GoogleAdsApiClient({
    ...BASE_CONFIG,
  }).verifyConversionActionMapping();

  assert.equal(report.registration, undefined);
  assert.equal(report.purchase?.category, "PURCHASE");
  assert.ok(
    report.problems.some((problem) => problem.includes("No registration conversion action")),
  );
});

test("fetchDailyMetrics() refuses to run when purchase is mapped onto Time on Site", async () => {
  installFetchMock((call, query) => {
    if (call.url.includes("oauth2.googleapis.com")) {
      return jsonResponse({ access_token: "fake-access-token" });
    }
    if (isConversionActionCatalogQuery(query)) {
      return jsonResponse({ results: KOPI_SENJA_CONVERSION_ACTIONS });
    }
    if (query?.includes("segments.conversion_action")) {
      return jsonResponse({ results: [] });
    }
    return jsonResponse({
      results: [
        {
          segments: { date: "2026-08-01" },
          customer: { currencyCode: "GBP", timeZone: "Etc/GMT" },
          metrics: { impressions: "10", clicks: "1", costMicros: "1000000" },
        },
      ],
    });
  });

  const client = new GoogleAdsApiClient({
    ...BASE_CONFIG,
    registrationConversionActionId: "900000002",
    // The exact mistake that poisons a conversion history: an engagement action
    // counted as an acquisition.
    purchaseConversionActionId: "9000000011",
  });

  await assert.rejects(
    () => client.fetchDailyMetrics({
      clientId: "satulayar-demo",
      accountKey: "kopi-senja-usd",
      range: { start: "2026-08-01", end: "2026-08-01" },
    }),
    (error: unknown) => {
      assert.ok(error instanceof ConnectorFailure);
      assert.equal(error.code, "configuration-error");
      assert.equal(error.retryable, false);
      assert.match(error.message, /Time on Site/);
      return true;
    },
  );
});

test("fetchDailyMetrics() returns campaign rows separately from account rows", async () => {
  installFetchMock((call, query) => {
    if (call.url.includes("oauth2.googleapis.com")) {
      return jsonResponse({ access_token: "fake-access-token" });
    }
    if (isConversionActionCatalogQuery(query)) {
      return jsonResponse({ results: KOPI_SENJA_CONVERSION_ACTIONS });
    }
    if (query?.includes("FROM campaign") && query.includes("segments.conversion_action")) {
      return jsonResponse({
        results: [
          {
            segments: {
              date: "2026-08-01",
              conversionAction: "customers/1234500001/conversionActions/900000001",
            },
            campaign: { id: "111" },
            metrics: { allConversions: "2", allConversionsValue: "80" },
          },
        ],
      });
    }
    if (query?.includes("FROM campaign")) {
      return jsonResponse({
        results: [
          {
            segments: { date: "2026-08-01" },
            campaign: { id: "111", name: "BOFU | Search | Brand" },
            metrics: { impressions: "600", clicks: "30", costMicros: "7500000" },
          },
          {
            segments: { date: "2026-08-01" },
            campaign: { id: "222", name: "MOFU | PMax" },
            metrics: { impressions: "400", clicks: "20", costMicros: "5000000" },
          },
        ],
      });
    }
    if (query?.includes("segments.conversion_action")) {
      return jsonResponse({
        results: [
          {
            segments: {
              date: "2026-08-01",
              conversionAction: "customers/1234500001/conversionActions/900000001",
            },
            metrics: { allConversions: "2", allConversionsValue: "80" },
          },
        ],
      });
    }
    return jsonResponse({
      results: [
        {
          segments: { date: "2026-08-01" },
          customer: { currencyCode: "GBP", timeZone: "Etc/GMT" },
          metrics: { impressions: "1000", clicks: "50", costMicros: "12500000" },
        },
      ],
    });
  });

  const client = new GoogleAdsApiClient({
    ...BASE_CONFIG,
    registrationConversionActionId: "900000002",
    purchaseConversionActionId: "900000001",
    includeCampaignBreakdown: true,
  });

  const result = await client.fetchDailyMetrics({
    clientId: "satulayar-demo",
    accountKey: "kopi-senja-usd",
    range: { start: "2026-08-01", end: "2026-08-01" },
  });

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].entityLevel, "account");
  assert.equal(result.campaignRows?.length, 2);
  assert.equal(result.campaignRows?.[0].entityLevel, "campaign");
  assert.equal(result.campaignRows?.[0].entityKey, "111");
  assert.equal(result.campaignRows?.[0].entityName, "BOFU | Search | Brand");
  assert.equal(result.campaignRows?.[0].purchases, 2);
  // The two campaign rows must reconcile against the account row, otherwise the
  // breakdown and the KPI headline would tell different stories.
  const campaignSpend = (result.campaignRows ?? []).reduce(
    (total, row) => total + row.spend,
    0,
  );
  assert.equal(campaignSpend, result.rows[0].spend);
});

// ------------------------------------------------------ served API version

test("the client targets a Google Ads API version that is still served", async () => {
  installFetchMock((call) => {
    if (call.url.includes("oauth2.googleapis.com")) {
      return jsonResponse({ access_token: "fake-access-token" });
    }
    return jsonResponse({
      results: [{ customer: { id: "1234500001", descriptiveName: "KopiSenja" } }],
    });
  });

  // v19 is retired: v17-v21 all answer HTTP 404 with an
  // HTML page, so a default of v19 made every live call fail.
  const client = new GoogleAdsApiClient({ ...BASE_CONFIG, apiVersion: undefined });
  await client.health();

  const apiCall = calls.find((call) => call.url.includes("googleads.googleapis.com"));
  assert.ok(apiCall);
  assert.match(apiCall.url, /\/v2[23]\//, "expected a currently served API version");
  assert.doesNotMatch(apiCall.url, /\/v(1[0-9]|2[01])\//);
});

test("no request sets pageSize, which the API rejects from v22 onward", async () => {
  installFetchMock((call, query) => {
    if (call.url.includes("oauth2.googleapis.com")) {
      return jsonResponse({ access_token: "fake-access-token" });
    }
    if (isConversionActionCatalogQuery(query)) {
      return jsonResponse({ results: KOPI_SENJA_CONVERSION_ACTIONS });
    }
    if (query?.includes("segments.conversion_action")) {
      return jsonResponse({ results: [] });
    }
    return jsonResponse({
      results: [
        {
          segments: { date: "2026-08-01" },
          customer: { currencyCode: "GBP", timeZone: "Etc/GMT" },
          metrics: { impressions: "10", clicks: "1", costMicros: "1000000" },
        },
      ],
    });
  });

  const client = new GoogleAdsApiClient({
    ...BASE_CONFIG,
    registrationConversionActionId: "900000002",
    purchaseConversionActionId: "900000001",
  });
  await client.fetchDailyMetrics({
    clientId: "satulayar-demo",
    accountKey: "kopi-senja-usd",
    range: { start: "2026-08-01", end: "2026-08-01" },
  });

  const apiCalls = calls.filter((call) => call.url.includes("googleads.googleapis.com"));
  assert.ok(apiCalls.length >= 2);
  for (const call of apiCalls) {
    const body = JSON.parse(String(call.init?.body ?? "{}")) as Record<string, unknown>;
    assert.equal(
      "pageSize" in body,
      false,
      "pageSize triggers PAGE_SIZE_NOT_SUPPORTED and fails the whole query",
    );
    assert.ok(typeof body.query === "string" && body.query.length > 0);
  }
});

// ------------------------------------- P1-5 value split, P2-7 share & device

const REGISTRATION = "customers/1234500001/conversionActions/900000002";
const ORDER = "customers/1234500001/conversionActions/900000001";

/**
 * A synthetic account with the shape that exposes each defect: registrations
 * carry assigned lead value alongside one order, the Search campaign loses most
 * of its share to rank with its own share masked at 0.0999, and PMax serves
 * Connected TV impressions with no click.
 */
function installKopiSenjaSplitMock(
  options: {
    failShare?: boolean;
    conversionActions?: typeof KOPI_SENJA_CONVERSION_ACTIONS;
  } = {},
) {
  installFetchMock((call, query) => {
    if (call.url.includes("oauth2.googleapis.com")) {
      return jsonResponse({ access_token: "fake-access-token" });
    }
    if (isConversionActionCatalogQuery(query)) {
      return jsonResponse({
        results: options.conversionActions ?? KOPI_SENJA_CONVERSION_ACTIONS,
      });
    }
    if (query?.includes("search_impression_share")) {
      if (options.failShare) return jsonResponse({ error: "rejected" }, 400);
      if (query.includes("FROM customer")) {
        return jsonResponse({
          results: [
            {
              segments: { date: "2026-09-01" },
              metrics: {
                searchImpressionShare: 0.0999,
                searchBudgetLostImpressionShare: 0.2,
                searchRankLostImpressionShare: 0.7,
              },
            },
          ],
        });
      }
      return jsonResponse({
        results: [
          {
            segments: { date: "2026-09-01" },
            campaign: { id: "111" },
            metrics: {
              impressions: "846",
              searchImpressionShare: 0.0999,
              searchBudgetLostImpressionShare: 0.1368458589640724,
              searchRankLostImpressionShare: 0.8011946153160382,
            },
          },
          // Google answers 0 for a Display campaign. It must not be stored.
          {
            segments: { date: "2026-09-01" },
            campaign: { id: "333" },
            metrics: {
              impressions: "5760",
              searchImpressionShare: 0,
              searchBudgetLostImpressionShare: 0,
              searchRankLostImpressionShare: 0,
            },
          },
        ],
      });
    }
    if (query?.includes("segments.device") && query.includes("segments.conversion_action")) {
      return jsonResponse({
        results: [
          {
            segments: { date: "2026-09-01", device: "MOBILE", conversionAction: REGISTRATION },
            campaign: { id: "111" },
            metrics: { allConversions: "6", allConversionsValue: "150" },
          },
          {
            segments: { date: "2026-09-01", device: "DESKTOP", conversionAction: ORDER },
            campaign: { id: "111" },
            metrics: { allConversions: "1", allConversionsValue: "36" },
          },
        ],
      });
    }
    if (query?.includes("segments.device")) {
      return jsonResponse({
        results: [
          {
            segments: { date: "2026-09-01", device: "MOBILE" },
            campaign: { id: "111" },
            metrics: { impressions: "465", clicks: "56", costMicros: "42843774" },
          },
          {
            segments: { date: "2026-09-01", device: "DESKTOP" },
            campaign: { id: "111" },
            metrics: { impressions: "381", clicks: "42", costMicros: "33548850" },
          },
          {
            segments: { date: "2026-09-01", device: "CONNECTED_TV" },
            campaign: { id: "222" },
            metrics: { impressions: "515", clicks: "0", costMicros: "2369789" },
          },
        ],
      });
    }
    if (query?.includes("FROM campaign") && query.includes("segments.conversion_action")) {
      return jsonResponse({
        results: [
          {
            segments: { date: "2026-09-01", conversionAction: REGISTRATION },
            campaign: { id: "111" },
            metrics: { allConversions: "6", allConversionsValue: "150" },
          },
          {
            segments: { date: "2026-09-01", conversionAction: ORDER },
            campaign: { id: "111" },
            metrics: { allConversions: "1", allConversionsValue: "36" },
          },
        ],
      });
    }
    if (query?.includes("FROM campaign")) {
      return jsonResponse({
        results: [
          {
            segments: { date: "2026-09-01" },
            campaign: { id: "111", name: "KSN | SEARCH", advertisingChannelType: "SEARCH", status: "ENABLED" },
            metrics: { impressions: "846", clicks: "98", costMicros: "76392624" },
          },
          {
            segments: { date: "2026-09-01" },
            campaign: { id: "222", name: "KSN | Win Back", advertisingChannelType: "PERFORMANCE_MAX", status: "ENABLED" },
            metrics: { impressions: "515", clicks: "0", costMicros: "2369789" },
          },
          {
            segments: { date: "2026-09-01" },
            campaign: { id: "333", name: "* | REM", advertisingChannelType: "DISPLAY", status: "ENABLED" },
            metrics: { impressions: "5760", clicks: "80", costMicros: "11082911" },
          },
        ],
      });
    }
    if (query?.includes("segments.conversion_action")) {
      return jsonResponse({
        results: [
          {
            segments: { date: "2026-09-01", conversionAction: REGISTRATION },
            metrics: { allConversions: "6", allConversionsValue: "150" },
          },
          {
            segments: { date: "2026-09-01", conversionAction: ORDER },
            metrics: { allConversions: "1", allConversionsValue: "36" },
          },
        ],
      });
    }
    return jsonResponse({
      results: [
        {
          segments: { date: "2026-09-01" },
          customer: { currencyCode: "GBP", timeZone: "Europe/London" },
          metrics: { impressions: "7121", clicks: "178", costMicros: "89845324" },
        },
      ],
    });
  });
}

const SPLIT_REQUEST = {
  clientId: "satulayar-demo",
  accountKey: "kopi-senja-usd",
  range: { start: "2026-09-01", end: "2026-09-01" },
};

test("P1-5: order value and registration lead value land on separate posts", async () => {
  installKopiSenjaSplitMock();
  const client = new GoogleAdsApiClient({
    ...BASE_CONFIG,
    registrationConversionActionId: "900000002",
    purchaseConversionActionId: "900000001",
    includeCampaignBreakdown: true,
  });

  const result = await client.fetchDailyMetrics(SPLIT_REQUEST);
  const account = result.rows[0];

  assert.equal(account.orderConversionValue, 36);
  assert.equal(account.registrationLeadValue, 150);
  // ROAS inputs are unchanged: the lead value must never reach them.
  assert.equal(account.platformConversionValue, 36);
  assert.equal(account.actualPurchaseRevenue, 36);

  const search = result.campaignRows?.find((row) => row.entityKey === "111");
  assert.equal(search?.orderConversionValue, 36);
  assert.equal(search?.registrationLeadValue, 150);
  assert.equal(search?.platformConversionValue, 36);
});

test("P1-5: an unmapped action yields null lead value, never £0", async () => {
  installKopiSenjaSplitMock({
    conversionActions: [
      ...KOPI_SENJA_CONVERSION_ACTIONS,
      {
        conversionAction: {
          id: "111111111",
          name: "Second registration",
          category: "SIGNUP",
          type: "WEBPAGE",
          status: "ENABLED",
          includeInConversionsMetric: false,
        },
      },
    ],
  });
  const client = new GoogleAdsApiClient({
    ...BASE_CONFIG,
    purchaseConversionActionId: "900000001",
  });

  const result = await client.fetchDailyMetrics(SPLIT_REQUEST);
  assert.equal(result.rows[0].orderConversionValue, 36);
  assert.equal(result.rows[0].registrationLeadValue, null);
});

test("P2-7: impression share is stored for Search-serving campaigns only", async () => {
  installKopiSenjaSplitMock();
  const client = new GoogleAdsApiClient({
    ...BASE_CONFIG,
    registrationConversionActionId: "900000002",
    purchaseConversionActionId: "900000001",
    includeCampaignBreakdown: true,
    includeImpressionShare: true,
  });

  const result = await client.fetchDailyMetrics(SPLIT_REQUEST);
  const byKey = new Map((result.campaignRows ?? []).map((row) => [row.entityKey, row]));

  const search = byKey.get("111");
  assert.equal(search?.searchImpressionShare, 0.0999);
  assert.equal(search?.impressionShareLostToRank, 0.8011946153160382);
  assert.equal(search?.impressionShareLostToBudget, 0.1368458589640724);

  // Display was answered with 0 by the API: stored as not reported, not 0%.
  const display = byKey.get("333");
  assert.equal(display?.searchImpressionShare, undefined);
  assert.equal(display?.impressionShareLostToRank, undefined);

  assert.equal(result.rows[0].searchImpressionShare, 0.0999);
  assert.equal(result.rows[0].impressionShareLostToRank, 0.7);

  // 4 queries: 2 daily (customer + campaign) and 2 period-level (customer + campaign)
  const shareQueries = calls
    .map((call) => (call.init?.body ? String(call.init.body) : ""))
    .filter((body) => body.includes("search_impression_share"));
  assert.equal(shareQueries.length, 4);
});

test("P2-7: a dedicated period window does not widen the daily fact pull", async () => {
  installKopiSenjaSplitMock();
  const client = new GoogleAdsApiClient({
    ...BASE_CONFIG,
    registrationConversionActionId: "900000002",
    purchaseConversionActionId: "900000001",
    includeCampaignBreakdown: true,
    includeImpressionShare: true,
  });
  const impressionShareRange = {
    start: "2026-08-30",
    end: "2026-09-12",
  };

  const result = await client.fetchDailyMetrics({
    ...SPLIT_REQUEST,
    impressionShareRange,
  });

  assert.ok((result.impressionSharePeriodRows ?? []).length > 0);
  assert.ok(
    (result.impressionSharePeriodRows ?? []).every(
      (row) =>
        row.rangeStart === impressionShareRange.start &&
        row.rangeEnd === impressionShareRange.end,
    ),
  );

  const bodies = calls.map((call) =>
    call.init?.body ? String(call.init.body) : "",
  );
  const periodShareQueries = bodies.filter(
    (body) =>
      body.includes("search_impression_share") &&
      !body.includes("SELECT segments.date"),
  );
  assert.equal(periodShareQueries.length, 2);
  assert.ok(
    periodShareQueries.every(
      (body) =>
        body.includes(impressionShareRange.start) &&
        body.includes(impressionShareRange.end),
    ),
  );

  const dailyQueries = bodies.filter((body) =>
    body.includes("SELECT segments.date, customer.currency_code"),
  );
  assert.ok(dailyQueries.every((body) => body.includes(SPLIT_REQUEST.range.start)));
  assert.ok(dailyQueries.every((body) => body.includes(SPLIT_REQUEST.range.end)));
});

test("P2-7: a rejected share query is a warning, spend rows stay intact", async () => {
  installKopiSenjaSplitMock({ failShare: true });
  const client = new GoogleAdsApiClient({
    ...BASE_CONFIG,
    registrationConversionActionId: "900000002",
    purchaseConversionActionId: "900000001",
    includeCampaignBreakdown: true,
    includeImpressionShare: true,
  });

  const result = await client.fetchDailyMetrics(SPLIT_REQUEST);
  assert.equal(result.rows[0].spend, 89.85);
  assert.equal(result.rows[0].searchImpressionShare, undefined);
  assert.equal(result.campaignRows?.length, 3);
  assert.ok(result.warnings.some((warning) => warning.includes("Account impression share could not be pulled")));
  assert.ok(result.warnings.some((warning) => warning.includes("Campaign impression share could not be pulled")));
});

test("P2-7: device rows keep the platform enum, Connected TV included", async () => {
  installKopiSenjaSplitMock();
  const client = new GoogleAdsApiClient({
    ...BASE_CONFIG,
    registrationConversionActionId: "900000002",
    purchaseConversionActionId: "900000001",
    includeDeviceBreakdown: true,
  });

  const result = await client.fetchDailyMetrics(SPLIT_REQUEST);
  const devices = result.deviceRows ?? [];
  assert.equal(devices.length, 3);

  const tv = devices.find((row) => row.device === "CONNECTED_TV");
  assert.equal(tv?.campaignKey, "222");
  assert.equal(tv?.clicks, 0);
  assert.equal(tv?.spend, 2.37);
  // Mapped actions with no conversion on this device are a measured zero.
  assert.equal(tv?.registrations, 0);
  assert.equal(tv?.purchases, 0);

  const mobile = devices.find((row) => row.device === "MOBILE");
  assert.equal(mobile?.registrations, 6);
  assert.equal(mobile?.registrationLeadValue, 150);
  assert.equal(mobile?.orderConversionValue, 0);

  const desktop = devices.find((row) => row.device === "DESKTOP");
  assert.equal(desktop?.orderConversionValue, 36);
});

test("P2-7: the share and device queries are off unless configured", async () => {
  installKopiSenjaSplitMock();
  const client = new GoogleAdsApiClient({
    ...BASE_CONFIG,
    purchaseConversionActionId: "900000001",
  });

  const result = await client.fetchDailyMetrics(SPLIT_REQUEST);
  assert.deepEqual(result.deviceRows, []);
  const bodies = calls.map((call) => (call.init?.body ? String(call.init.body) : ""));
  assert.ok(!bodies.some((body) => body.includes("search_impression_share")));
  assert.ok(!bodies.some((body) => body.includes("segments.device")));
});
