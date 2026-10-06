import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";

import {
  Ga4ApiClient,
  mapChannelGroup,
  mapDeviceCategory,
  mergeGa4Rows,
  toIsoDate,
  type Ga4DailyRow,
} from "@/lib/connectors/ga4-api-client";
import { ConnectorFailure } from "@/lib/connectors/types";

/** Synthetic property and credentials; nothing here touches a real account. */
const BASE_CONFIG = {
  propertyId: "123456789",
  clientId: "client-id",
  clientSecret: "client-secret",
  refreshToken: "refresh-token",
  currency: "GBP" as const,
};

const REQUEST = {
  clientId: "pilot-client",
  accountKey: "kopi-senja-usd",
  range: { start: "2026-09-01", end: "2026-09-02" },
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

function installFetchMock(handler: (call: FetchCall) => Response) {
  originalFetch = globalThis.fetch;
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    return handler({ url, init });
  }) as typeof fetch;
}

function isTokenEndpoint(url: string): boolean {
  return url.includes("oauth2.googleapis.com/token");
}

/** One GA4 report row: dimension values first, then the eight metrics. */
function reportRow(dimensions: string[], metrics: number[]) {
  return {
    dimensionValues: dimensions.map((value) => ({ value })),
    metricValues: metrics.map((value) => ({ value: String(value) })),
  };
}

const TOTAL_METRICS = [120, 95, 0.42, 78.5, 18, 9, 4, 512.4];

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("GA4 dates and dimension vocabularies are mapped, not guessed", () => {
  assert.equal(toIsoDate("20260912"), "2026-09-12");
  assert.equal(toIsoDate("2026-09-12"), "2026-09-12");

  assert.deepEqual(mapChannelGroup("Paid Search"), { channel: "Paid", mapped: true });
  assert.deepEqual(mapChannelGroup("Organic Search"), { channel: "Organic", mapped: true });
  // One word apart and in opposite buckets: exactly why the map is explicit.
  assert.equal(mapChannelGroup("Paid Shopping").channel, "Paid");
  assert.equal(mapChannelGroup("Organic Shopping").channel, "Organic");
  assert.equal(mapChannelGroup("Organic Social").channel, "Social");
  assert.deepEqual(mapChannelGroup("Email"), { channel: "Unknown", mapped: false });

  assert.equal(mapDeviceCategory("desktop"), "Desktop");
  assert.equal(mapDeviceCategory("MOBILE"), "Mobile");
  assert.equal(mapDeviceCategory("tablet"), "Tablet");
  assert.equal(mapDeviceCategory("smart tv"), "Other");
});

test("a daily report becomes one row per day at the requested grain", async () => {
  installFetchMock((call) => {
    if (isTokenEndpoint(call.url)) return jsonResponse({ access_token: "access-token" });
    return jsonResponse({
      metadata: { timeZone: "Europe/London", currencyCode: "GBP" },
      rows: [
        reportRow(["20260901"], TOTAL_METRICS),
        reportRow(["20260902"], [100, 80, 0.5, 60, 12, 6, 3, 300]),
      ],
    });
  });

  const result = await new Ga4ApiClient(BASE_CONFIG).fetchDailyMetrics(REQUEST, ["total"]);

  assert.equal(result.rows.length, 2);
  assert.deepEqual(
    result.rows.map((row) => row.date),
    ["2026-09-01", "2026-09-02"],
  );
  const [first] = result.rows;
  assert.equal(first.breakdown, "total");
  assert.equal(first.breakdownValue, "total");
  assert.equal(first.sessions, 120);
  assert.equal(first.activeUsers, 95);
  assert.equal(first.bounceRate, 0.42);
  assert.equal(first.averageSessionDurationSeconds, 78.5);
  assert.equal(first.addToCarts, 18);
  assert.equal(first.checkouts, 9);
  assert.equal(first.ecommercePurchases, 4);
  assert.equal(first.grossPurchaseRevenue, 512.4);
  assert.equal(first.currency, "GBP");
  assert.equal(first.sourceQueryVersion, "ga4-data-api-v1beta");
  assert.equal(result.propertyTimezone, "Europe/London");
});

test("the credential travels in the header and never in the report URL", async () => {
  installFetchMock((call) => {
    if (isTokenEndpoint(call.url)) return jsonResponse({ access_token: "access-token" });
    return jsonResponse({ metadata: { timeZone: "Europe/London" }, rows: [] });
  });

  await new Ga4ApiClient(BASE_CONFIG).fetchDailyMetrics(REQUEST, ["total"]);

  const reportCall = calls.find((call) => call.url.includes("analyticsdata.googleapis.com"));
  assert.ok(reportCall);
  assert.match(reportCall.url, /properties\/123456789:runReport$/);
  assert.doesNotMatch(reportCall.url, /access-token|refresh-token|client-secret/);
  assert.equal(
    new Headers(reportCall.init?.headers).get("authorization"),
    "Bearer access-token",
  );
});

test("two GA4 channel groups that share a bucket are summed, not duplicated", async () => {
  installFetchMock((call) => {
    if (isTokenEndpoint(call.url)) return jsonResponse({ access_token: "access-token" });
    return jsonResponse({
      metadata: { timeZone: "Europe/London" },
      rows: [
        reportRow(["20260901", "Paid Search"], [60, 50, 0.4, 80, 6, 3, 2, 200]),
        reportRow(["20260901", "Paid Social"], [40, 35, 0.6, 40, 4, 2, 1, 100]),
        reportRow(["20260901", "Email"], [10, 9, 0.3, 50, 1, 1, 0, 0]),
      ],
    });
  });

  const result = await new Ga4ApiClient(BASE_CONFIG).fetchDailyMetrics(REQUEST, ["channel"]);
  const paid = result.rows.find((row) => row.breakdownValue === "Paid");
  const unknown = result.rows.find((row) => row.breakdownValue === "Unknown");

  assert.ok(paid);
  assert.equal(paid.sessions, 100);
  assert.equal(paid.grossPurchaseRevenue, 300);
  // Session-weighted, not a mean of means: (0.4*60 + 0.6*40) / 100.
  assert.equal(Math.round(paid.bounceRate * 1000) / 1000, 0.48);

  // Email has no place in the store vocabulary, so it is bucketed and named
  // rather than dropped or folded into Organic.
  assert.ok(unknown);
  assert.equal(unknown.sessions, 10);
  assert.equal(
    result.warnings.some((warning) => /Email/.test(warning)),
    true,
  );
});

test("an open day in the property timezone is marked provisional", async () => {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  installFetchMock((call) => {
    if (isTokenEndpoint(call.url)) return jsonResponse({ access_token: "access-token" });
    return jsonResponse({
      metadata: { timeZone: "Europe/London" },
      rows: [
        reportRow(["20260101"], TOTAL_METRICS),
        reportRow([today.replace(/-/g, "")], TOTAL_METRICS),
      ],
    });
  });

  const result = await new Ga4ApiClient(BASE_CONFIG).fetchDailyMetrics(REQUEST, ["total"]);

  assert.equal(result.rows.find((row) => row.date === "2026-01-01")?.isProvisional, false);
  assert.equal(result.rows.find((row) => row.date === today)?.isProvisional, true);
});

test("a currency that disagrees with the account contract is reported, not silently stored", async () => {
  installFetchMock((call) => {
    if (isTokenEndpoint(call.url)) return jsonResponse({ access_token: "access-token" });
    return jsonResponse({
      metadata: { timeZone: "Europe/London", currencyCode: "EUR" },
      rows: [reportRow(["20260901"], TOTAL_METRICS)],
    });
  });

  const result = await new Ga4ApiClient(BASE_CONFIG).fetchDailyMetrics(REQUEST, ["total"]);

  assert.equal(
    result.warnings.some((warning) => /EUR/.test(warning) && /GBP/.test(warning)),
    true,
  );
});

test("GA4 failures are classified so a retryable one is not read as a dead grant", async () => {
  for (const [status, code, retryable] of [
    [429, "rate-limited", true],
    [403, "unauthenticated", false],
    [500, "unavailable", true],
    [400, "invalid-response", false],
  ] as const) {
    installFetchMock((call) => {
      if (isTokenEndpoint(call.url)) return jsonResponse({ access_token: "access-token" });
      return new Response(`{"error":{"status":${status}}}`, { status });
    });

    await assert.rejects(
      () => new Ga4ApiClient(BASE_CONFIG).fetchDailyMetrics(REQUEST, ["total"]),
      (err: unknown) => {
        assert.ok(err instanceof ConnectorFailure);
        assert.equal(err.code, code);
        assert.equal(err.retryable, retryable);
        return true;
      },
    );
    globalThis.fetch = originalFetch;
  }
});

test("without configuration the connector fails closed and calls nothing", async () => {
  installFetchMock(() => jsonResponse({}));

  const client = new Ga4ApiClient({ ...BASE_CONFIG, propertyId: "" });
  const health = await client.health();

  assert.equal(health.authenticated, false);
  assert.equal(health.available, false);
  assert.match(health.safeMessage, /property id/i);
  await assert.rejects(
    () => client.fetchDailyMetrics(REQUEST, ["total"]),
    (err: unknown) => {
      assert.ok(err instanceof ConnectorFailure);
      assert.equal(err.code, "unauthenticated");
      return true;
    },
  );
  assert.equal(calls.length, 0, "an unconfigured connector must not reach the network");
});

test("health reports the property and the credential source without leaking either", async () => {
  installFetchMock((call) => {
    if (isTokenEndpoint(call.url)) return jsonResponse({ access_token: "access-token" });
    return jsonResponse({ metadata: { timeZone: "Europe/London" }, rows: [] });
  });

  const health = await new Ga4ApiClient(BASE_CONFIG).health();

  assert.equal(health.authenticated, true);
  assert.equal(health.readOnly, true);
  assert.match(health.safeMessage, /123456789/);
  assert.match(health.safeMessage, /Europe\/London/);
  assert.doesNotMatch(health.safeMessage, /refresh-token|client-secret|access-token/);
});

test("rate and duration metrics are re-weighted by sessions when rows merge", () => {
  const row = (
    sessions: number,
    bounceRate: number,
    duration: number,
  ): Ga4DailyRow => ({
    date: "2026-09-01",
    breakdown: "device",
    breakdownValue: "Mobile",
    sessions,
    activeUsers: sessions,
    bounceRate,
    averageSessionDurationSeconds: duration,
    addToCarts: 0,
    checkouts: 0,
    ecommercePurchases: 0,
    grossPurchaseRevenue: 0,
    currency: "GBP",
    sourceQueryVersion: "ga4-data-api-v1beta",
    isProvisional: false,
  });

  const [merged] = mergeGa4Rows([row(30, 0.2, 100), row(70, 0.7, 50)]);

  assert.equal(merged.sessions, 100);
  assert.equal(Math.round(merged.bounceRate * 100) / 100, 0.55);
  assert.equal(Math.round(merged.averageSessionDurationSeconds), 65);

  // No sessions on either side must not divide by zero.
  const [empty] = mergeGa4Rows([row(0, 0.5, 10), row(0, 0.9, 20)]);
  assert.equal(empty.bounceRate, 0);
});

test("the GA4 table is fail-closed, idempotent, and keeps the property id server-side", async () => {
  const { readFile } = await import("node:fs/promises");
  const migration = await readFile(
    new URL("../supabase/migrations/0006_ga4_daily_metrics.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /alter table public\.ga4_daily_metrics enable row level security/);
  assert.match(migration, /create policy ga4_daily_member_select/);
  // Read access is membership-scoped; there is no write policy at all, so a
  // browser session cannot write even with a valid JWT.
  assert.doesNotMatch(migration, /for (insert|update|delete)/);
  assert.match(migration, /for select to authenticated/);
  // The unique key is what makes a repeated daily pull correct a day rather
  // than append to it.
  assert.match(migration, /unique \(\s*metric_date,\s*client_id,\s*property_id,\s*breakdown,\s*breakdown_value,\s*source_query_version\s*\)/);
  assert.match(migration, /bounce_rate >= 0 and bounce_rate <= 1/);
});
