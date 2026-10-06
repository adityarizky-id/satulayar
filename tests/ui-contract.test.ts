import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAuctionDiagnostics,
  buildDevicePerformanceBreakdown,
} from "@/lib/ui-contract";

const RANGE = { start: "2026-08-24", end: "2026-09-14" };

test("auction diagnostics maps 80.1% rank loss and 0% budget loss to traffic lights", () => {
  const diagnostics = buildAuctionDiagnostics({
    range: RANGE,
    lostToRankRatio: 0.801,
    lostToBudgetRatio: 0,
  });

  assert.equal(diagnostics.lostToRank.percent, 80.1);
  assert.equal(diagnostics.lostToRank.displayValue, "80.1%");
  assert.equal(diagnostics.lostToRank.isExact, true);
  assert.equal(diagnostics.lostToRank.status.tone, "red");
  assert.equal(diagnostics.lostToRank.status.level, "critical");
  assert.equal(diagnostics.lostToBudget.percent, 0);
  assert.equal(diagnostics.lostToBudget.status.tone, "green");
  assert.equal(diagnostics.lostToBudget.status.label, "Low loss");
  assert.equal(diagnostics.capturedShareRatio, 0.199);
  assert.equal(diagnostics.dominantConstraint, "rank");
  assert.equal(diagnostics.reconciliation, "valid");
});

test("current live period values preserve the non-zero budget loss", () => {
  const diagnostics = buildAuctionDiagnostics({
    range: RANGE,
    lostToRankRatio: 0.801,
    lostToBudgetRatio: 0.137,
    aggregationBasis: "period_exact",
  });

  assert.equal(diagnostics.lostToBudget.percent, 13.7);
  assert.equal(diagnostics.capturedShareRatio, 0.062);
  assert.equal(diagnostics.dominantConstraint, "rank");
});

test("daily-derived auction ratios are visibly approximate", () => {
  const diagnostics = buildAuctionDiagnostics({
    range: RANGE,
    lostToRankRatio: 0.792,
    lostToBudgetRatio: 0.127,
    aggregationBasis: "daily_derived",
  });

  assert.equal(diagnostics.lostToRank.displayValue, "~79.2%");
  assert.equal(diagnostics.lostToRank.isExact, false);
  assert.equal(diagnostics.sourceStatus, "provisional");
  assert.match(diagnostics.message, /estimates/i);
});

test("auction contract rejects a human-formatted percentage passed as a ratio", () => {
  assert.throws(
    () => buildAuctionDiagnostics({
      range: RANGE,
      lostToRankRatio: 80.1,
      lostToBudgetRatio: 0,
    }),
    /between 0 and 1/,
  );
});

test("device contract preserves four-device order and exposes Connected TV spend without clicks", () => {
  const breakdown = buildDevicePerformanceBreakdown({
    range: RANGE,
    currency: "GBP",
    rows: [
      { device: "desktop", spend: 40, impressions: 1_000, clicks: 50, registrations: 2, purchases: 1, purchaseValue: 36 },
      { device: "mobile", spend: 60, impressions: 2_000, clicks: 80, registrations: 1, purchases: 0, purchaseValue: 0 },
      { device: "tablet", spend: 5, impressions: 200, clicks: 4, registrations: 0, purchases: 0, purchaseValue: 0 },
      { device: "connectedTv", spend: 2.37, impressions: 90, clicks: 0, registrations: 0, purchases: 0, purchaseValue: 0 },
    ],
  });

  assert.deepEqual(
    breakdown.rows.map((row) => row.label),
    ["Mobile", "Desktop", "Tablet", "Connected TV"],
  );
  const connectedTv = breakdown.rows[3];
  assert.equal(connectedTv.spend, 2.37);
  assert.equal(connectedTv.cpc, null);
  assert.equal(connectedTv.status.tone, "amber");
  assert.equal(connectedTv.status.label, "Spend without clicks");
  assert.equal(breakdown.anomalies[0].code, "spend_without_clicks");
  assert.equal(breakdown.totals.spend, 107.37);
});

test("missing device rows remain explicit no-data rows", () => {
  const breakdown = buildDevicePerformanceBreakdown({
    range: RANGE,
    currency: "GBP",
    rows: [],
  });

  assert.equal(breakdown.rows.length, 4);
  assert.equal(breakdown.rows.every((row) => row.status.level === "no_data"), true);
  assert.equal(breakdown.totals.purchases, 0);
});
