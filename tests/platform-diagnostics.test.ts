import assert from "node:assert/strict";
import test from "node:test";

import { tooltipToneForTrend } from "../src/components/charts/chart-tooltip";
import { calculateRingGeometry } from "../src/components/charts/progress-ring";
import { buildBudgetPacing, parseBudgetsCookie } from "../src/lib/dashboard/budget";
import {
  attributionCoverage,
  daysNeededForReliableRead,
  volumeVerdict,
} from "../src/lib/dashboard/confidence";
import {
  buildDashboardSnapshot,
  buildDashboardSnapshotFromRows,
} from "../src/lib/dashboard/fixtures";
import { buildImpressionShareReport } from "../src/lib/dashboard/impression-share";
import { aggregateMetrics } from "../src/lib/dashboard/kpi";
import { buildJourneyCards } from "../src/lib/dashboard/scorecard";
import type { DailyMetric, Platform } from "../src/lib/dashboard/types";

const RANGE = { start: "2026-07-01", end: "2026-07-14" };

function row(
  date: string,
  platform: Exclude<Platform, "all">,
  overrides: Partial<DailyMetric> = {},
): DailyMetric {
  return {
    date,
    clientId: "demo",
    accountId: "demo",
    platform,
    currency: "GBP",
    accountTimezone: "Europe/London",
    spend: 100,
    impressions: 10_000,
    clicks: 200,
    landingPageViews: 160,
    registrations: 20,
    purchases: 5,
    platformConversionValue: 400,
    actualPurchaseRevenue: 300,
    sourceConnector: "mock",
    sourceQueryVersion: "fixture-v1",
    syncedAt: "2026-07-15T00:00:00.000Z",
    isProvisional: false,
    ...overrides,
  };
}

test("the volume floor separates a readable count from noise", () => {
  assert.equal(volumeVerdict(45).confidence, "reliable");
  assert.equal(volumeVerdict(45).showDelta, true);
  assert.equal(volumeVerdict(22).confidence, "low-volume");
  assert.equal(volumeVerdict(22).showDelta, true);
  assert.equal(volumeVerdict(6).confidence, "insufficient");
  assert.equal(volumeVerdict(6).showDelta, false);
  assert.equal(volumeVerdict(0).showDelta, false);
});

test("the stated error band follows the count, not a fixed guess", () => {
  const thirty = volumeVerdict(30).relativeError ?? 0;
  const twelve = volumeVerdict(12).relativeError ?? 0;

  assert.equal(Math.round(thirty * 100), 18);
  assert.equal(Math.round(twelve * 100), 29);
  assert.equal(volumeVerdict(0).relativeError, null);
});

test("store orders check whether the platform claim is believable", () => {
  const over = attributionCoverage(22, 8);
  const under = attributionCoverage(4, 20);
  const aligned = attributionCoverage(19, 20);

  assert.equal(over.status, "over-claiming");
  assert.match(over.safeMessage, /double counting/i);
  assert.equal(under.status, "under-claiming");
  assert.equal(aligned.status, "aligned");
  assert.equal(attributionCoverage(5, 0).status, "unknown");
});

test("a slow store is told how long a period must be, not just to widen it", () => {
  // 21 orders over 14 days is 1.5 a day, so 30 conversions needs 20 days.
  assert.equal(daysNeededForReliableRead(21, 14), 20);
  assert.equal(daysNeededForReliableRead(0, 14), null);
});

test("an insufficient verdict answers how far to widen once it knows the period", () => {
  // Without the period length there is no rate to extrapolate from, so the
  // message stays as it was rather than guessing one.
  assert.match(volumeVerdict(6).safeMessage, /Widen the timeframe\.$/);

  // 6 conversions over 14 days is 0.43 a day, so the reliable floor of 30 is
  // about 70 days away. Telling a reader only to "widen" leaves them with no
  // way to know whether that means three days or three months.
  const withPeriod = volumeVerdict(6, 14);
  assert.equal(withPeriod.confidence, "insufficient");
  assert.equal(withPeriod.showDelta, false, "the floor itself is unchanged");
  assert.match(withPeriod.safeMessage, /about 70 days/);

  // A rate so low that no reachable window works is said outright, instead of
  // sending the reader after a year-long comparison that still will not read.
  const hopeless = volumeVerdict(1, 30);
  assert.match(hopeless.safeMessage, /longer than a year/);
  assert.match(hopeless.safeMessage, /cost per order/);

  // Zero is a different statement: there is nothing to extrapolate from.
  assert.match(
    volumeVerdict(0, 14).safeMessage,
    /nothing to compare/,
  );

  // The bands above the floor are untouched.
  assert.equal(volumeVerdict(22, 14).confidence, "low-volume");
  assert.equal(volumeVerdict(45, 14).confidence, "reliable");
});

test("platform-only metrics are hidden on the platform that cannot report them", () => {
  const totals = aggregateMetrics([
    row("2026-07-01", "meta", { reach: 5_000 }),
    row("2026-07-01", "google", {
      searchImpressionShare: 0.1,
      impressionShareLostToRank: 0.6,
      impressionShareLostToBudget: 0.3,
    }),
  ]);
  const keysFor = (platform: Platform) =>
    buildJourneyCards(totals, totals, "fixture-v1", platform).map(
      (card) => card.key,
    );

  assert.equal(keysFor("meta").includes("averageDailyReach"), true);
  assert.equal(keysFor("meta").includes("averageDailyFrequency"), true);
  assert.equal(keysFor("google").includes("averageDailyReach"), false);
  // Combined keeps the platform-only card, tagged with who reports it.
  assert.equal(keysFor("all").includes("averageDailyReach"), true);
});

test("impression share is not repeated in the journey; it has its own section", () => {
  const totals = aggregateMetrics([
    row("2026-07-01", "google", {
      searchImpressionShare: 0.1,
      impressionShareLostToRank: 0.6,
      impressionShareLostToBudget: 0.3,
    }),
  ]);

  for (const platform of ["google", "all"] as Platform[]) {
    const keys = buildJourneyCards(totals, totals, "fixture-v1", platform).map(
      (card) => card.key,
    );
    assert.equal(keys.includes("impressionShare"), false);
    assert.equal(keys.includes("impressionShareLostToBudget"), false);
    assert.equal(keys.includes("impressionShareLostToRank"), false);
  }

  // The totals still carry it, because the dedicated section reads from them.
  assert.notEqual(totals.impressionShare, null);
});

test("a combined conversion metric carries the mixed-basis warning", () => {
  const totals = aggregateMetrics([row("2026-07-01", "meta")]);
  const combined = buildJourneyCards(totals, totals, "fixture-v1", "all");
  const single = buildJourneyCards(totals, totals, "fixture-v1", "meta");
  const cpoCombined = combined.find((card) => card.key === "costPerPurchase");
  const cpoSingle = single.find((card) => card.key === "costPerPurchase");
  const clicksCombined = combined.find((card) => card.key === "clicks");

  assert.notEqual(cpoCombined?.mixedBasisWarning, null);
  assert.equal(cpoSingle?.mixedBasisWarning, null);
  // Clicks are counted the same way everywhere, so no warning belongs there.
  assert.equal(clicksCombined?.mixedBasisWarning, null);
});

test("reach is averaged per day instead of being summed across days", () => {
  const totals = aggregateMetrics([
    row("2026-07-01", "meta", { reach: 4_000, impressions: 8_000 }),
    row("2026-07-02", "meta", { reach: 6_000, impressions: 12_000 }),
  ]);

  assert.equal(totals.averageDailyReach, 5_000);
  assert.equal(totals.averageDailyFrequency, 2);
  // Google rows carry no reach, so the metric stays unavailable there.
  assert.equal(
    aggregateMetrics([row("2026-07-01", "google")]).averageDailyReach,
    null,
  );
});

test("impression share is weighted by impressions, not a flat average", () => {
  const totals = aggregateMetrics([
    row("2026-07-01", "google", {
      impressions: 9_000,
      searchImpressionShare: 0.1,
    }),
    row("2026-07-02", "google", {
      impressions: 1_000,
      searchImpressionShare: 0.5,
    }),
  ]);

  // A flat average would say 30%; weighting by impressions says 14%.
  assert.equal(Math.round((totals.impressionShare ?? 0) * 100), 14);
});

test("the impression-share report covers all three auction positions", () => {
  const report = buildImpressionShareReport(RANGE, 1_000);

  assert.equal(report.platform, "google");
  assert.equal(report.rows.length, 6);
  assert.deepEqual(
    report.tiers.map((tier) => tier.key),
    ["overall", "top", "absoluteTop"],
  );

  for (const row of report.rows) {
    for (const tier of Object.values(row.tiers)) {
      // A reported row still has to account for the whole auction.
      if (tier.share.masked || tier.share.value === null) continue;
      const total =
        tier.share.value +
        (tier.lostToRank.value ?? 0) +
        (tier.lostToBudget.value ?? 0);
      assert.equal(Math.abs(total - 1) < 0.01, true);
    }
  }
});

test("a masked share is never stored as a number and never averaged", () => {
  const report = buildImpressionShareReport(RANGE, 1_000);
  const masked = report.rows.find(
    (row) => row.tiers.overall.share.masked,
  );
  const overall = report.tiers.find((tier) => tier.key === "overall");

  assert.notEqual(masked, undefined);
  // Google prints "< 10%": storing 0.1 would invent a measurement.
  assert.equal(masked?.tiers.overall.share.value, null);
  // The masked campaign's budget remainder is unknowable, so it stays masked.
  assert.equal(masked?.tiers.overall.lostToBudget.masked, true);
  assert.equal(
    (overall?.reportedCampaigns ?? 0) + (overall?.maskedCampaigns ?? 0),
    report.rows.length,
  );
  assert.equal((overall?.maskedCampaigns ?? 0) > 0, true);
  assert.match(report.safeMessage, /excluded from every average/i);
});

test("the report names the lever: rank or budget", () => {
  const report = buildImpressionShareReport(RANGE, 1_000);

  assert.equal(["rank", "budget", "mixed"].includes(report.dominantLoss), true);
  assert.match(report.dominantLossMessage, /rank|budget/i);
});

test("absolute top share is never above overall share for a reported row", () => {
  const report = buildImpressionShareReport(RANGE, 1_000);

  for (const row of report.rows) {
    const overall = row.tiers.overall.share.value;
    const absoluteTop = row.tiers.absoluteTop.share.value;
    if (overall === null || absoluteTop === null) continue;
    assert.equal(absoluteTop <= overall, true);
  }
});

test("the impression-share panel disappears when Google is filtered out", () => {
  const google = buildDashboardSnapshot(RANGE, "google");
  const meta = buildDashboardSnapshot(RANGE, "meta");
  const both = buildDashboardSnapshot(RANGE, "all");

  assert.notEqual(google.impressionShare, null);
  assert.equal(meta.impressionShare, null);
  assert.notEqual(both.impressionShare, null);
});

test("budget pacing is measured over the reporting cycle, not the active filter", () => {
  const rows = [
    ...Array.from({ length: 14 }, (_, index) =>
      row(`2026-07-${String(index + 1).padStart(2, "0")}`, "meta", { spend: 50 }),
    ),
    ...Array.from({ length: 14 }, (_, index) =>
      row(`2026-07-${String(index + 1).padStart(2, "0")}`, "google", { spend: 10 }),
    ),
  ];
  const pacing = buildBudgetPacing(
    rows,
    { start: "2026-07-01", end: "2026-07-14" },
    { meta: 1_000, google: 1_000 },
    "GBP",
  );
  const meta = pacing.platforms.find((item) => item.platform === "meta");
  const google = pacing.platforms.find((item) => item.platform === "google");

  // The filter is 14 days of July, but the cycle it closes in runs 25 Jun to
  // 24 Jul. The plan is judged against that cycle: the team never agreed a
  // July-shaped budget, nor a 14-day one.
  assert.equal(pacing.filterDays, 14);
  assert.equal(pacing.cycleDays, 30);
  assert.equal(pacing.cycle.start, "2026-06-25");
  assert.equal(pacing.cycle.end, "2026-07-24");
  assert.equal(pacing.filterMatchesCycle, false);
  // The agreed figure is printed as agreed. There is no prorated variant of it.
  assert.equal(meta?.monthlyBudget, 1_000);
  assert.deepEqual(pacing.monthlyBudgets, { meta: 1_000, google: 1_000 });
  assert.equal(meta?.spentToDate, 700);
  assert.equal(meta?.daysElapsed, 20);
  assert.equal(meta?.daysRemaining, 10);
  assert.equal(meta?.projectedCycleEnd, 1_050);
  // Ten days of the cycle are still open, so there is a daily figure to steer
  // by. The old card printed "window closed" here and offered nothing.
  assert.equal(meta?.recommendedDailySpend, 30);
  assert.equal(google?.spentToDate, 140);
  assert.equal(google?.status, "underspending");
});

test("narrowing the filter does not shrink the budget the cycle is paced against", () => {
  const rows = Array.from({ length: 14 }, (_, index) =>
    row(`2026-07-${String(index + 1).padStart(2, "0")}`, "meta", { spend: 50 }),
  );
  // The reader narrows to the last three days, where the platform table
  // reports 150. The card keeps reporting the cycle, because that is the
  // period the 1,000 was agreed for — and it flags that it is doing so, rather
  // than leaving two unexplained spend totals on one screen.
  const narrowed = buildBudgetPacing(
    rows,
    { start: "2026-07-12", end: "2026-07-14" },
    { meta: 1_000, google: 1_000 },
    "GBP",
  );
  const meta = narrowed.platforms.find((item) => item.platform === "meta");

  assert.equal(narrowed.filterDays, 3);
  assert.equal(narrowed.filterMatchesCycle, false);
  assert.equal(narrowed.cycle.start, "2026-06-25");
  assert.equal(meta?.monthlyBudget, 1_000);
  // Cycle-to-date spend, not the three days on screen.
  assert.equal(meta?.spentToDate, 700);
  assert.equal(meta?.daysElapsed, 20);
});

test("the budget ring maps 100 percent to one complete 360 degree turn", () => {
  const underBudget = calculateRingGeometry(0.64);
  const quarterBudget = calculateRingGeometry(0.25);
  const atBudget = calculateRingGeometry(1);
  const overBudget = calculateRingGeometry(1.38);
  const beyondSecondLap = calculateRingGeometry(2.38);

  assert.equal(underBudget.sweepDegrees, 230.4);
  assert.equal(underBudget.isComplete, false);
  assert.equal(underBudget.isOverBudget, false);
  assert.equal(underBudget.overflowSweepDegrees, 0);
  assert.equal(underBudget.progressMarkerDegrees, 230.4);
  assert.equal(quarterBudget.progressMarkerDegrees, 90);

  assert.equal(atBudget.sweepDegrees, 360);
  assert.equal(atBudget.isComplete, true);
  assert.equal(atBudget.isOverBudget, false);
  assert.equal(atBudget.overflowSweepDegrees, 0);
  assert.equal(atBudget.progressMarkerDegrees, 360);

  assert.equal(overBudget.sweepDegrees, 360);
  assert.equal(overBudget.isComplete, true);
  assert.equal(overBudget.isOverBudget, true);
  assert.equal(Math.round(overBudget.overflowSweepDegrees * 10) / 10, 136.8);
  assert.equal(Math.round(overBudget.progressMarkerDegrees * 10) / 10, 136.8);

  assert.equal(beyondSecondLap.overflowRatio, 1.38);
  assert.equal(beyondSecondLap.overflowSweepDegrees, 360);
  assert.equal(beyondSecondLap.isOverflowComplete, true);
});

test("tooltip trends use green, yellow, and red traffic-light states", () => {
  assert.equal(tooltipToneForTrend(131.7, 100), "positive");
  assert.equal(tooltipToneForTrend(100, 100), "warning");
  assert.equal(tooltipToneForTrend(68.3, 100), "negative");
  assert.equal(tooltipToneForTrend(Number.NaN, 100), "warning");
});

test("an open cycle only counts the days that have happened", () => {
  const rows = Array.from({ length: 31 }, (_, index) =>
    row(`2026-07-${String(index + 1).padStart(2, "0")}`, "meta", { spend: 10 }),
  );
  const pacing = buildBudgetPacing(
    rows,
    { start: "2026-07-01", end: "2026-07-31" },
    { meta: 300, google: 300 },
    "GBP",
    "all",
    "2026-07-10",
  );
  const meta = pacing.platforms.find((item) => item.platform === "meta");

  // The filter runs to 31 July but today is the 10th, so the live cycle is the
  // one the 10th falls in — 25 Jun to 24 Jul — not the one the filter's last
  // day would have selected, which has not started yet.
  assert.equal(pacing.cycle.start, "2026-06-25");
  assert.equal(meta?.spentToDate, 100);
  assert.equal(meta?.daysElapsed, 16);
  assert.equal(meta?.daysRemaining, 14);
  assert.equal(meta?.monthlyBudget, 300);
  // 200 left across the 14 cycle days that have not happened yet.
  assert.equal(meta?.recommendedDailySpend, 14.29);
});

test("a stored budget cookie survives a bad value", () => {
  assert.deepEqual(parseBudgetsCookie("2000,800"), {
    meta: 2_000,
    google: 800,
  });
  assert.deepEqual(parseBudgetsCookie("nonsense,-5"), {
    meta: 1_500,
    google: 1_500,
  });
  assert.deepEqual(parseBudgetsCookie(null), { meta: 1_500, google: 1_500 });
});

test("platform value against actual revenue exposes attribution inflation", () => {
  const totals = aggregateMetrics([
    row("2026-07-01", "meta", {
      platformConversionValue: 600,
      actualPurchaseRevenue: 300,
    }),
  ]);

  assert.equal(totals.platformValueRatio, 2);
});

// ---------------------------------------------------------------------------
// Live mode must not publish generated figures.
//
// The suite could stay fully green while the dashboard rendered a hardcoded
// ROAS far above the account's measured one, and a geography panel reporting
// several times the account's real spend. Every test asserted that the generating
// functions returned the right shape; none asserted they should not have been
// called. These do.
// ---------------------------------------------------------------------------

const LIVE_ROWS: DailyMetric[] = [
  row("2026-07-01", "google", { spend: 40, impressions: 3_000, clicks: 90 }),
  row("2026-07-02", "google", { spend: 45, impressions: 3_200, clicks: 96 }),
  row("2026-07-01", "meta", { spend: 30, impressions: 2_000, clicks: 70 }),
  row("2026-07-02", "meta", { spend: 32, impressions: 2_100, clicks: 74 }),
];

function liveSnapshot(platform: Platform = "google") {
  return buildDashboardSnapshotFromRows(LIVE_ROWS, RANGE, platform, {
    mode: "live",
    storage: "supabase",
    account: {
      id: "kopi-senja",
      name: "Kopi Senja Nusantara",
      currency: "GBP",
      timezone: "Europe/London",
    },
  });
}

test("live mode withholds every panel whose figures are generated", () => {
  const snapshot = liveSnapshot();

  for (const panel of [
    "campaignTypes",
    "searchTerms",
    "intentAnalysis",
    "wastedSpendSummary",
    "matchTypeDrift",
    "impressionShare",
    "devices",
    "comparisonDevices",
    "geo",
    "audienceSegments",
    "blendedMer",
    "rfmAudienceBridge",
    "budgetOpportunity",
  ] as const) {
    assert.equal(
      snapshot[panel],
      null,
      `${panel} must be withheld in live mode until it reads a real feed`,
    );
  }
});

test("live mode still reports the figures a platform actually returned", () => {
  const snapshot = liveSnapshot();

  // Suppression is about provenance, not about hiding the account. Real spend,
  // clicks and impressions must survive it untouched.
  assert.equal(snapshot.totals.spend, 85);
  assert.equal(snapshot.totals.clicks, 186);
  assert.equal(snapshot.totals.impressions, 6_200);
  assert.equal(snapshot.platformBreakdown[0]?.totals.spend, 85);
  assert.ok(snapshot.budgetPacing.platforms.length > 0);
  assert.ok(snapshot.cards.length > 0);
});

test("a withheld panel leaves a placeholder naming the feed it needs", () => {
  const snapshot = liveSnapshot();
  const keys = snapshot.pendingPanels.map((panel) => panel.key);

  // The sidebar links to these anchors, so each one must still be accounted
  // for rather than silently vanishing from the page.
  assert.ok(keys.includes("impression-share"));
  assert.ok(keys.includes("device-analysis"));
  assert.ok(keys.includes("geo-analysis"));
  assert.ok(keys.includes("campaign-types"));

  for (const panel of snapshot.pendingPanels) {
    assert.ok(panel.title.length > 0, `${panel.key} needs a title`);
    assert.ok(
      panel.missing.length > 0,
      `${panel.key} must say which feed it is waiting on`,
    );
  }
});

test("the placeholder list follows the platform filter", () => {
  const google = liveSnapshot("google").pendingPanels.map((item) => item.key);
  const meta = liveSnapshot("meta").pendingPanels.map((item) => item.key);

  assert.ok(google.includes("impression-share"));
  assert.ok(!google.includes("audience"));
  assert.ok(meta.includes("audience"));
  assert.ok(!meta.includes("impression-share"));
});

test("mock mode keeps the generated panels for the preview", () => {
  const preview = buildDashboardSnapshotFromRows(LIVE_ROWS, RANGE, "google", {
    mode: "mock",
    storage: "fixture",
    account: {
      id: "kopi-senja",
      name: "Kopi Senja Nusantara",
      currency: "GBP",
      timezone: "Europe/London",
    },
  });

  assert.notEqual(preview.campaignTypes, null);
  assert.notEqual(preview.geo, null);
  assert.notEqual(preview.blendedMer, null);
  assert.deepEqual(preview.pendingPanels, []);
});
