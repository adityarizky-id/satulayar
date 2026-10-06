import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateMetrics,
  getPercentChange,
  getPreviousPeriod,
  safeDivide,
} from "../src/lib/dashboard/kpi";
import { buildDashboardSnapshotFromRows } from "../src/lib/dashboard/fixtures";
import type { DailyMetric } from "../src/lib/dashboard/types";
import { getDashboardDataConfiguration } from "../src/lib/dashboard/validation";

const baseRow: DailyMetric = {
  date: "2026-07-01",
  clientId: "demo",
  accountId: "demo",
  platform: "meta",
  currency: "USD",
  accountTimezone: "Europe/London",
  spend: 100,
  impressions: 1_000,
  clicks: 100,
  landingPageViews: 80,
  registrations: 10,
  purchases: 4,
  platformConversionValue: 300,
  actualPurchaseRevenue: 240,
  sourceConnector: "mock",
  sourceQueryVersion: "fixture-v1",
  syncedAt: "2026-07-17T00:00:00.000Z",
  isProvisional: false,
};

test("safeDivide returns null for a zero denominator", () => {
  assert.equal(safeDivide(100, 0), null);
});

test("aggregateMetrics recalculates ratios from totals", () => {
  const totals = aggregateMetrics([
    baseRow,
    { ...baseRow, spend: 50, clicks: 25, purchases: 1 },
  ]);

  assert.equal(totals.spend, 150);
  assert.equal(totals.clicks, 125);
  assert.equal(totals.costPerPurchase, 30);
  assert.equal(totals.cpc, 1.2);
});

test("previous period is inclusive and equal length", () => {
  assert.deepEqual(
    getPreviousPeriod({ start: "2026-07-01", end: "2026-07-14" }),
    { start: "2026-06-17", end: "2026-06-30" },
  );
});

test("comparison against zero uses semantic labels", () => {
  assert.equal(getPercentChange(3, 0), "new");
  assert.equal(getPercentChange(0, 0), "no-change");
  assert.equal(getPercentChange(null, 0), null);
});

test("data configuration defaults to local fixture mode", () => {
  assert.deepEqual(getDashboardDataConfiguration({}), {
    mode: "mock",
    storage: "fixture",
  });
  assert.deepEqual(
    getDashboardDataConfiguration({
      DASHBOARD_DATA_MODE: "live",
      DASHBOARD_DATA_STORE: "supabase",
    }),
    {
      mode: "live",
      storage: "supabase",
    },
  );
});

test("stored dummy rows use the same deterministic snapshot contract", () => {
  const snapshot = buildDashboardSnapshotFromRows(
    [baseRow],
    { start: "2026-07-01", end: "2026-07-01" },
    "meta",
    {
      mode: "mock",
      storage: "supabase",
    },
  );

  assert.equal(snapshot.storage, "supabase");
  assert.equal(snapshot.mode, "mock");
  assert.equal(snapshot.dataStatus, "ready");
  assert.equal(snapshot.totals.spend, 100);
  assert.equal(snapshot.lastSuccessfulSync, baseRow.syncedAt);
});

test("delivery trend keeps spend and purchase value separate by platform", () => {
  const snapshot = buildDashboardSnapshotFromRows(
    [
      baseRow,
      {
        ...baseRow,
        platform: "google",
        spend: 50,
        actualPurchaseRevenue: 125,
      },
    ],
    { start: "2026-07-01", end: "2026-07-01" },
    "all",
    {
      mode: "mock",
      storage: "supabase",
    },
  );

  const point = snapshot.trend[0];
  assert.equal(point?.date, "2026-07-01");
  assert.equal(point?.metaSpend, 100);
  assert.equal(point?.googleSpend, 50);
  assert.equal(point?.metaPurchaseValue, 240);
  assert.equal(point?.googlePurchaseValue, 125);
  assert.equal(point?.clicks, 200);
  assert.equal(point?.registrations, 20);
  assert.equal(point?.purchases, 8);
  assert.equal(point?.spend, 150);
  assert.equal(point?.actualPurchaseRevenue, 365);
});

test("platform performance keeps a separate comparison baseline per platform", () => {
  const snapshot = buildDashboardSnapshotFromRows(
    [
      { ...baseRow, date: "2026-07-01", platform: "meta", spend: 100 },
      { ...baseRow, date: "2026-07-01", platform: "google", spend: 40 },
      { ...baseRow, date: "2026-07-02", platform: "meta", spend: 120 },
      { ...baseRow, date: "2026-07-02", platform: "google", spend: 80 },
    ],
    { start: "2026-07-02", end: "2026-07-02" },
    "all",
    { mode: "mock", storage: "supabase" },
  );

  const meta = snapshot.platformBreakdown.find((row) => row.platform === "meta");
  const google = snapshot.platformBreakdown.find(
    (row) => row.platform === "google",
  );

  assert.equal(meta?.totals.spend, 120);
  assert.equal(meta?.comparisonTotals.spend, 100);
  assert.equal(google?.totals.spend, 80);
  assert.equal(google?.comparisonTotals.spend, 40);
});

test("empty Supabase storage is blocked until a dummy sync runs", () => {
  const snapshot = buildDashboardSnapshotFromRows(
    [],
    { start: "2026-07-01", end: "2026-07-01" },
    "all",
    {
      mode: "mock",
      storage: "supabase",
    },
  );

  assert.equal(snapshot.dataStatus, "blocked");
  assert.equal(snapshot.dataHealth.coveragePercent, 0);
  assert.equal(snapshot.dataHealth.summaryBlocked, true);
  assert.equal(snapshot.lastSuccessfulSync, null);
});

test("P1-5: lead value is summed on its own post and never enters ROAS", () => {
  const base: DailyMetric = {
    date: "2026-09-01",
    clientId: "client-kopi-senja",
    accountId: "acct",
    platform: "google",
    currency: "GBP",
    accountTimezone: "Europe/London",
    spend: 105.78,
    impressions: 1000,
    clicks: 100,
    landingPageViews: 0,
    registrations: 6,
    purchases: 1,
    platformConversionValue: 36,
    actualPurchaseRevenue: 36,
    orderConversionValue: 36,
    registrationLeadValue: 150,
    sourceConnector: "google-direct-api",
    sourceQueryVersion: "google-ads-api-v23",
    syncedAt: "2026-09-15T01:41:16.000Z",
    isProvisional: false,
  };

  const totals = aggregateMetrics([base]);
  assert.equal(totals.orderConversionValue, 36);
  assert.equal(totals.registrationLeadValue, 150);
  assert.equal(Number(totals.actualRevenueRoas?.toFixed(2)), 0.34);
  assert.equal(Number(totals.platformRoas?.toFixed(2)), 0.34);

  // A scope where the action was never measured reads null, not £0.
  const unmeasured = aggregateMetrics([
    { ...base, orderConversionValue: undefined, registrationLeadValue: null },
  ]);
  assert.equal(unmeasured.orderConversionValue, null);
  assert.equal(unmeasured.registrationLeadValue, null);

  // A combined scope: a Meta row never reports lead value, and must not blank
  // the Google total beside it.
  const mixed = aggregateMetrics([
    base,
    { ...base, platform: "meta", orderConversionValue: undefined, registrationLeadValue: undefined },
  ]);
  assert.equal(mixed.registrationLeadValue, 150);
});
