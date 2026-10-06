import assert from "node:assert/strict";
import test from "node:test";

import {
  ACQUISITION_GUARDRAIL_AMOUNT,
  conversionComparabilityCaveat,
  evaluateAcquisitionGuardrail,
  getConversionContracts,
  PLATFORM_CONVERSION_CONTRACTS,
  resolveScopeCurrency,
} from "../src/lib/dashboard/account-contract";
import { aggregateMetrics } from "../src/lib/dashboard/kpi";
import { buildDashboardSnapshotFromRows } from "../src/lib/dashboard/fixtures";
import type { Currency, DailyMetric, Platform } from "../src/lib/dashboard/types";

const RANGE = { start: "2026-07-01", end: "2026-07-02" };

function row(
  date: string,
  platform: Exclude<Platform, "all">,
  overrides: Partial<DailyMetric> = {},
): DailyMetric {
  return {
    date,
    clientId: "demo",
    accountId: "demo-account",
    platform,
    currency: "GBP",
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
    syncedAt: "2026-07-03T05:00:00.000Z",
    isProvisional: false,
    ...overrides,
  };
}

function totalsFrom(rows: DailyMetric[]) {
  return aggregateMetrics(rows);
}

test("the guardrail is 30 in the account's own currency and is never converted", () => {
  assert.equal(ACQUISITION_GUARDRAIL_AMOUNT, 30);

  // Identical cost figures: one account reports GBP, the other EUR. Both are
  // judged against 30 of their own currency, not a converted equivalent.
  const gbp = evaluateAcquisitionGuardrail(
    totalsFrom([row("2026-07-01", "meta", { spend: 100, purchases: 4, registrations: 10 })]),
    { currency: "GBP", costAggregationAllowed: true },
  );
  const eur = evaluateAcquisitionGuardrail(
    totalsFrom([
      row("2026-07-01", "meta", {
        currency: "EUR" as Currency,
        spend: 100,
        purchases: 4,
        registrations: 10,
      }),
    ]),
    { currency: "EUR", costAggregationAllowed: true },
  );

  assert.equal(gbp.currency, "GBP");
  assert.equal(eur.currency, "EUR");
  assert.equal(gbp.threshold, eur.threshold);
  assert.equal(gbp.status, eur.status);
});

test("CPO, CPA, and the conversion-rate floor are all judged", () => {
  // spend 100, purchases 4 -> CPO 25 (pass); registrations 2 -> CPA 50 (fail)
  const report = evaluateAcquisitionGuardrail(
    totalsFrom([
      row("2026-07-01", "meta", {
        spend: 100,
        purchases: 4,
        registrations: 2,
        clicks: 100,
      }),
    ]),
    { currency: "GBP", costAggregationAllowed: true },
  );

  assert.deepEqual(
    report.checks.map((check) => [check.metric, check.value, check.status]),
    [
      ["costPerPurchase", 25, "pass"],
      ["costPerRegistration", 50, "breach"],
      ["conversionRate", 0.06, "pass"],
    ],
  );
  assert.equal(report.status, "breach");
  assert.deepEqual(
    report.checks.map((check) => check.shortLabel),
    ["CPO", "CPA", "Conv. rate"],
  );
});

test("a miss inside the tolerance band reads as near, not a straight fail", () => {
  const near = evaluateAcquisitionGuardrail(
    // CPO 31 against a target of 30 is 3.3% over: near.
    totalsFrom([
      row("2026-07-01", "meta", { spend: 124, purchases: 4, registrations: 4 }),
    ]),
    { currency: "GBP", costAggregationAllowed: true },
  );
  const failed = evaluateAcquisitionGuardrail(
    // CPO 45 is far past the band.
    totalsFrom([
      row("2026-07-01", "meta", { spend: 180, purchases: 4, registrations: 4 }),
    ]),
    { currency: "GBP", costAggregationAllowed: true },
  );

  assert.equal(
    near.checks.find((check) => check.metric === "costPerPurchase")?.status,
    "near",
  );
  assert.equal(near.status, "near");
  assert.match(near.safeMessage, /Close but not there yet/i);
  assert.equal(
    failed.checks.find((check) => check.metric === "costPerPurchase")?.status,
    "breach",
  );
});

test("targets are editable and judged against the value supplied", () => {
  const totals = totalsFrom([
    row("2026-07-01", "meta", {
      spend: 100,
      purchases: 4,
      registrations: 10,
      clicks: 100,
    }),
  ]);
  const strict = evaluateAcquisitionGuardrail(
    totals,
    { currency: "GBP", costAggregationAllowed: true },
    { costPerOrder: 20, costPerAcquisition: 5, conversionRate: 0.2 },
  );
  const relaxed = evaluateAcquisitionGuardrail(
    totals,
    { currency: "GBP", costAggregationAllowed: true },
    { costPerOrder: 40, costPerAcquisition: 20, conversionRate: 0.05 },
  );

  assert.equal(strict.status, "breach");
  assert.equal(strict.targets.costPerOrder, 20);
  assert.equal(relaxed.status, "pass");
  assert.equal(relaxed.threshold, 40);
});

test("exactly on target still counts as met", () => {
  const atTarget = evaluateAcquisitionGuardrail(
    totalsFrom([
      row("2026-07-01", "meta", {
        spend: 120,
        purchases: 4,
        registrations: 4,
        clicks: 100,
      }),
    ]),
    { currency: "GBP", costAggregationAllowed: true },
  );

  assert.equal(
    atTarget.checks.find((check) => check.metric === "costPerPurchase")?.status,
    "pass",
  );
});

test("zero conversions make the targets unavailable instead of a false pass", () => {
  const report = evaluateAcquisitionGuardrail(
    totalsFrom([
      row("2026-07-01", "meta", {
        spend: 100,
        purchases: 0,
        registrations: 0,
        clicks: 100,
      }),
    ]),
    { currency: "GBP", costAggregationAllowed: true },
  );

  assert.equal(report.status, "breach");
  assert.equal(
    report.checks
      .filter((check) => check.metric !== "conversionRate")
      .every((check) => check.status === "unavailable"),
    true,
  );
});

test("a mixed-currency scope forbids cost aggregation entirely", () => {
  const report = evaluateAcquisitionGuardrail(
    totalsFrom([
      row("2026-07-01", "meta"),
      row("2026-07-01", "google", { currency: "EUR" as Currency }),
    ]),
    { currency: "GBP", costAggregationAllowed: false },
  );

  assert.equal(report.costAggregationAllowed, false);
  assert.equal(
    report.checks
      .filter((check) => check.unit === "currency")
      .every((check) => check.value === null && check.status === "unavailable"),
    true,
  );
  assert.match(report.safeMessage, /mixes reporting currencies/i);
});

test("scope currency resolves one currency, falls back when empty, and flags a mix", () => {
  assert.deepEqual(resolveScopeCurrency([], "EUR"), {
    ok: true,
    currency: "EUR",
  });
  assert.deepEqual(
    resolveScopeCurrency(
      [row("2026-07-01", "meta", { currency: "EUR" as Currency })],
      "GBP",
    ),
    { ok: true, currency: "EUR" },
  );
  assert.deepEqual(
    resolveScopeCurrency(
      [
        row("2026-07-01", "meta"),
        row("2026-07-01", "google", { currency: "EUR" as Currency }),
      ],
      "GBP",
    ),
    { ok: false, currencies: ["EUR", "GBP"] },
  );
});

test("conversion contracts record each platform's own counting basis", () => {
  assert.equal(
    PLATFORM_CONVERSION_CONTRACTS.google.purchaseSource,
    "All conversions",
  );
  assert.equal(
    PLATFORM_CONVERSION_CONTRACTS.google.viewThroughBasis,
    "included",
  );
  assert.equal(
    PLATFORM_CONVERSION_CONTRACTS.meta.viewThroughBasis,
    "account-attribution-setting",
  );
  assert.deepEqual(
    getConversionContracts("meta").map((contract) => contract.platform),
    ["meta"],
  );
  assert.deepEqual(
    getConversionContracts("all").map((contract) => contract.platform),
    ["meta", "google"],
  );
});

test("a cross-platform scope carries an attribution caveat, a single platform does not", () => {
  const caveat = conversionComparabilityCaveat("all");

  assert.notEqual(caveat, null);
  assert.match(String(caveat), /never deduplicated customers/i);
  assert.equal(conversionComparabilityCaveat("meta"), null);
  assert.equal(conversionComparabilityCaveat("google"), null);
});

test("the snapshot exposes the guardrail and the caveat for the selected scope", () => {
  const rows = [
    row("2026-07-01", "meta"),
    row("2026-07-01", "google"),
    row("2026-07-02", "meta"),
    row("2026-07-02", "google"),
  ];
  const snapshot = buildDashboardSnapshotFromRows(rows, RANGE, "all", {
    mode: "mock",
    storage: "supabase",
  });

  assert.equal(snapshot.guardrail.currency, "GBP");
  assert.equal(snapshot.guardrail.costAggregationAllowed, true);
  assert.equal(snapshot.guardrail.status, "pass");
  assert.notEqual(snapshot.conversionCaveat, null);
});

test("a EUR account snapshot is judged in EUR without conversion", () => {
  const rows = [
    row("2026-07-01", "meta", { currency: "EUR" as Currency }),
    row("2026-07-02", "meta", { currency: "EUR" as Currency }),
  ];
  const snapshot = buildDashboardSnapshotFromRows(rows, RANGE, "meta", {
    mode: "mock",
    storage: "supabase",
    account: {
      id: "demo-eur",
      name: "Demo EUR account",
      currency: "EUR",
      timezone: "Europe/Madrid",
    },
  });

  assert.equal(snapshot.guardrail.currency, "EUR");
  assert.equal(snapshot.guardrail.threshold, 30);
  assert.equal(snapshot.conversionCaveat, null);
  assert.equal(snapshot.dataStatus, "ready");
});

test("rows in another currency block instead of rendering under the brand label", () => {
  // A hero badge could show GBP on a brand because GBP
  // rows were read for a EUR brand. Relabelling alone would be worse:
  // pounds shown as euros. The gate has to refuse the pair.
  const rows = [row("2026-07-01", "meta"), row("2026-07-02", "meta")];
  const snapshot = buildDashboardSnapshotFromRows(rows, RANGE, "meta", {
    mode: "mock",
    storage: "supabase",
    account: {
      id: "kriya-bali",
      name: "Kriya Bali",
      currency: "EUR",
      timezone: "Europe/Madrid",
    },
  });

  assert.equal(snapshot.account.currency, "EUR");
  assert.equal(snapshot.dataStatus, "blocked");
});

test("an empty scope still labels the account currency and stays unavailable", () => {
  const snapshot = buildDashboardSnapshotFromRows([], RANGE, "all", {
    mode: "mock",
    storage: "supabase",
    account: {
      id: "demo-eur",
      name: "Demo EUR account",
      currency: "EUR",
      timezone: "Europe/Madrid",
    },
  });

  assert.equal(snapshot.guardrail.currency, "EUR");
  assert.equal(snapshot.guardrail.status, "unavailable");
  assert.equal(snapshot.conversionCaveat, null);
});

test("a breached guardrail reaches the summary as a risk and a next action", () => {
  const rows = [
    row("2026-07-01", "meta", { spend: 400, purchases: 1, registrations: 1 }),
    row("2026-07-02", "meta", { spend: 400, purchases: 1, registrations: 1 }),
  ];
  const snapshot = buildDashboardSnapshotFromRows(rows, RANGE, "meta", {
    mode: "mock",
    storage: "supabase",
  });

  assert.equal(snapshot.guardrail.status, "breach");
  assert.equal(
    snapshot.summary.risks.some((risk) => /Missing target/i.test(risk)),
    true,
  );
  assert.equal(
    snapshot.summary.recommendedNextActions.some((action) =>
      /before scaling spend/i.test(action),
    ),
    true,
  );
});
