import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMetaAudienceAnalysis,
  AUDIENCE_TYPE_LABELS,
} from "../src/lib/dashboard/audience-meta";
import { buildDashboardSnapshot } from "../src/lib/dashboard/fixtures";

const RANGE = { start: "2026-07-01", end: "2026-07-14" };

function analysis(
  overrides: Partial<Parameters<typeof buildMetaAudienceAnalysis>[0]> = {},
) {
  return buildMetaAudienceAnalysis({
    range: RANGE,
    currency: "GBP",
    metaSpend: 1_000,
    metaImpressions: 100_000,
    metaClicks: 4_000,
    metaPurchases: 100,
    metaRegistrations: 400,
    metaPurchaseValue: 5_000,
    ...overrides,
  });
}

test("demographic and audience-type shares each sum to one and preserve spend", () => {
  const report = analysis();

  const demographicShareSum = report.demographics.reduce(
    (total, row) => total + row.spendShare,
    0,
  );
  const demographicSpendSum = report.demographics.reduce(
    (total, row) => total + row.spend,
    0,
  );
  assert.equal(Math.abs(demographicShareSum - 1) < 0.001, true);
  assert.equal(Math.abs(demographicSpendSum - 1_000) < 1, true);

  const typeShareSum = report.audienceTypes.reduce(
    (total, row) => total + row.spendShare,
    0,
  );
  const typeSpendSum = report.audienceTypes.reduce(
    (total, row) => total + row.spend,
    0,
  );
  assert.equal(Math.abs(typeShareSum - 1) < 0.001, true);
  assert.equal(Math.abs(typeSpendSum - 1_000) < 1, true);
  assert.equal(report.audienceTypes.length, Object.keys(AUDIENCE_TYPE_LABELS).length);
});

test("age and gender combine into one grid, twelve rows, no separate unknown row", () => {
  const report = analysis();

  assert.equal(report.demographics.length, 12);
  assert.equal(
    report.demographics.every((row) => row.gender === "female" || row.gender === "male"),
    true,
  );
});

test("a segment with no orders reports no revenue and no cost per order", () => {
  const report = analysis({ metaPurchases: 0, metaRegistrations: 0, metaPurchaseValue: 0 });

  for (const row of report.demographics) {
    assert.equal(row.purchaseValue, 0);
    assert.equal(row.costPerPurchase, null);
  }
  for (const row of report.audienceTypes) {
    assert.equal(row.purchaseValue, 0);
    assert.equal(row.costPerPurchase, null);
  }
  assert.equal(report.topDemographic, null);
  assert.match(report.safeMessage, /no meta purchases/i);
});

test("custom audiences run cheaper per order than core, matching the shape", () => {
  const report = analysis();
  const core = report.audienceTypes.find((row) => row.key === "core");
  const custom = report.audienceTypes.find((row) => row.key === "custom");

  assert.equal(
    (custom?.costPerPurchase ?? Infinity) < (core?.costPerPurchase ?? 0),
    true,
  );
});

test("the audience cut only exists on the Meta filter, not combined or Google", () => {
  assert.notEqual(buildDashboardSnapshot(RANGE, "meta").audience, null);
  assert.equal(buildDashboardSnapshot(RANGE, "google").audience, null);
  assert.equal(buildDashboardSnapshot(RANGE, "all").audience, null);
});
