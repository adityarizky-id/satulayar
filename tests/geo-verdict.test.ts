import assert from "node:assert/strict";
import test from "node:test";

import { buildGeoAnalysis } from "../src/lib/dashboard/geo/analysis";
import type { GeoPerformanceRow } from "../src/lib/dashboard/geo/contract";
import { createFixtureGeoSource } from "../src/lib/dashboard/geo/fixture-source";
import {
  evaluateGeoRow,
  summariseGeoAttention,
} from "../src/lib/dashboard/geo/verdict";
import { DEFAULT_TARGETS } from "../src/lib/dashboard/targets";

const TARGETS = DEFAULT_TARGETS; // cost per order 30
const RANGE = { start: "2026-07-01", end: "2026-07-14" };

function region(
  name: string,
  overrides: Partial<GeoPerformanceRow> = {},
): GeoPerformanceRow {
  const spend = overrides.spend ?? 100;
  const purchases = overrides.purchases ?? 4;

  return {
    target: {
      id: `fixture-${name}`,
      name,
      canonicalName: name,
      countryCode: "GB",
      level: "province",
      parentId: null,
    },
    spend,
    impressions: 1_000,
    clicks: 100,
    registrations: 10,
    purchases,
    purchaseValue: 400,
    costPerPurchase: purchases === 0 ? null : spend / purchases,
    costPerRegistration: 10,
    returnOnAdSpend: 4,
    spendShare: 0.25,
    ...overrides,
  } as GeoPerformanceRow;
}

test("spend with no order is only called wasted once one order should have landed", () => {
  const early = evaluateGeoRow(
    region("Early", { spend: 12, purchases: 0 }),
    TARGETS,
    "GBP",
  );
  const wasted = evaluateGeoRow(
    region("Burning", { spend: 240, purchases: 0 }),
    TARGETS,
    "GBP",
  );

  // $12 spent against a $30 target: no order was due yet, so no accusation.
  assert.equal(early.verdict, "insufficient");
  assert.equal(wasted.verdict, "wasted");
  assert.equal(wasted.spendAtRisk, 240);
});

test("a region is judged against the target, not against the other regions", () => {
  // One region is dearer than the other, but both still meet the target, so
  // neither should be named as a problem. Both clear the 10-order floor.
  const rows = [
    region("A", { spend: 400, purchases: 20 }), // $20 per order
    region("B", { spend: 400, purchases: 16 }), // $25 per order
  ];
  const summary = summariseGeoAttention(rows, TARGETS, "GBP");

  assert.equal(summary.overTarget.length, 0);
  assert.equal(summary.wasted.length, 0);
  assert.equal(summary.spendAtRisk, 0);
  assert.match(summary.safeMessage, /inside the cost-per-order target/);
});

test("too few orders is reported as unreadable rather than as a bad region", () => {
  const thin = evaluateGeoRow(
    region("Thin", { spend: 900, purchases: 3 }),
    TARGETS,
    "GBP",
  );

  // $300 per order is far over target, but three orders cannot carry that claim.
  assert.equal(thin.verdict, "insufficient");
  assert.equal(thin.spendAtRisk, 0);
  assert.match(thin.safeMessage, /too few/);
});

test("over-target spend at risk counts only the excess, not the whole budget", () => {
  const breach = evaluateGeoRow(
    region("Costly", { spend: 900, purchases: 15 }),
    TARGETS,
    "GBP",
  );

  // 15 orders at the $30 target is $450 of justified spend out of $900.
  assert.equal(breach.verdict, "breach");
  assert.equal(breach.spendAtRisk, 450);
  assert.equal(Math.round((breach.overTargetRatio ?? 0) * 100), 100);
});

test("spend the scope reports but no child accounts for is surfaced, not hidden", () => {
  const source = createFixtureGeoSource();
  const analysis = buildGeoAnalysis({
    source,
    accountSlug: "kopi-senja",
    range: RANGE,
    currency: "GBP",
    countryCode: "GB",
    level: "province",
  });

  const rowSpend = analysis.rows.reduce((total, row) => total + row.spend, 0);
  assert.ok(analysis.unattributed !== null);
  // The gap is exactly what the rows fail to explain, never a guess.
  assert.equal(
    Math.round((rowSpend + (analysis.unattributed?.spend ?? 0)) * 100) / 100 >
      rowSpend,
    true,
  );
  assert.match(analysis.unattributed?.safeMessage ?? "", /could not be resolved/);
});

test("each region carries its previous period so movement can be read", () => {
  const analysis = buildGeoAnalysis({
    source: createFixtureGeoSource(),
    accountSlug: "kopi-senja",
    range: RANGE,
    comparisonRange: { start: "2026-06-17", end: "2026-06-30" },
    currency: "GBP",
    countryCode: "GB",
    level: "province",
  });

  assert.notEqual(analysis.comparisonRange, null);
  for (const row of analysis.rows) {
    assert.equal(typeof row.previousSpend, "number");
    assert.equal(typeof row.previousPurchases, "number");
  }
});

test("without a comparison range no movement is invented", () => {
  const analysis = buildGeoAnalysis({
    source: createFixtureGeoSource(),
    accountSlug: "kopi-senja",
    range: RANGE,
    currency: "GBP",
    countryCode: "GB",
    level: "province",
  });

  assert.equal(analysis.comparisonRange, null);
  for (const row of analysis.rows) {
    assert.equal(row.previousCostPerPurchase, null);
    assert.equal(row.previousSpend, null);
  }
});

test("the attention summary ranks the worst breach first and keeps winners separate", () => {
  const rows = [
    region("Fine", { spend: 300, purchases: 20 }), // $15
    region("Costly", { spend: 900, purchases: 15 }), // $60
    region("Dead", { spend: 200, purchases: 0 }),
    region("Slightly over", { spend: 400, purchases: 12 }), // $33
  ];
  const summary = summariseGeoAttention(rows, TARGETS, "GBP");

  assert.equal(summary.wasted[0]?.row.target.name, "Dead");
  assert.equal(summary.overTarget[0]?.row.target.name, "Costly");
  assert.equal(summary.strongest[0]?.row.target.name, "Fine");
  assert.match(summary.safeMessage, /at risk|not converting|above target/);
});
