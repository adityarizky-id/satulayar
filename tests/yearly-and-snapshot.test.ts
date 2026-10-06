import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  DashboardSidebar,
  isNavSectionOpen,
  NAV_GROUPS,
} from "../src/components/dashboard/sidebar-nav";
import { SnapshotCard } from "../src/components/dashboard/snapshot-card";
import { evaluateAcquisitionGuardrail } from "../src/lib/dashboard/account-contract";
import { evaluateDataQuality } from "../src/lib/dashboard/data-quality";
import { aggregateMetrics } from "../src/lib/dashboard/kpi";
import { buildJourneyCards } from "../src/lib/dashboard/scorecard";
import { buildPerformanceSnapshot } from "../src/lib/dashboard/snapshot-summary";
import { buildDashboardSnapshotFromRows } from "../src/lib/dashboard/fixtures";
import {
  buildStoreAnalyticsSnapshot,
  buildYearlyPerformance,
} from "../src/lib/store/analytics";
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

function snapshotFor(
  current: Partial<DailyMetric>,
  previous: Partial<DailyMetric>,
) {
  const totals = aggregateMetrics([row("2026-07-01", "meta", current)]);
  const comparison = aggregateMetrics([row("2026-06-01", "meta", previous)]);
  const cards = buildJourneyCards(totals, comparison, "fixture-v1", "meta");
  const guardrail = evaluateAcquisitionGuardrail(totals, {
    currency: "GBP",
    costAggregationAllowed: true,
  });
  const quality = evaluateDataQuality(
    [row("2026-07-01", "meta", current)],
    { start: "2026-07-01", end: "2026-07-01" },
    "meta",
    { today: "2026-07-20" },
  );

  return buildPerformanceSnapshot(cards, guardrail, quality);
}

test("the snapshot reads positive when revenue and purchases both grow", () => {
  const summary = snapshotFor(
    { purchases: 8, actualPurchaseRevenue: 500 },
    { purchases: 5, actualPurchaseRevenue: 300 },
  );

  assert.equal(summary.tone, "positive");
  assert.match(summary.headline, /Every target met/i);
  assert.notEqual(summary.biggestImprovement, null);
});

test("a missed target outranks growth in the snapshot verdict", () => {
  const summary = snapshotFor(
    { spend: 900, purchases: 8, registrations: 8, actualPurchaseRevenue: 999 },
    { spend: 100, purchases: 5, registrations: 5, actualPurchaseRevenue: 300 },
  );

  assert.equal(summary.tone, "negative");
  assert.match(summary.headline, /Target missed on CPO and CPA/i);
});

test("the snapshot names the strongest mover and the biggest drag", () => {
  const summary = snapshotFor(
    { purchases: 10, spend: 100, clicks: 100 },
    { purchases: 5, spend: 100, clicks: 200 },
  );

  assert.equal(summary.biggestImprovement?.isFavorable, true);
  assert.equal(summary.biggestDrag?.isFavorable, false);
  assert.match(summary.supporting, /Best move: .+\. Biggest drag: .+\./);
});

test("an empty period produces a neutral snapshot instead of a false verdict", () => {
  const snapshot = buildDashboardSnapshotFromRows([], RANGE, "all", {
    mode: "mock",
    storage: "supabase",
  });

  assert.equal(snapshot.snapshotSummary.tone, "neutral");
  assert.match(snapshot.snapshotSummary.headline, /not enough stored data/i);
  assert.equal(snapshot.snapshotSummary.biggestImprovement, null);
});

test("the account snapshot omits decorative mini charts for every platform filter", () => {
  const rows = [
    row("2026-07-01", "meta"),
    row("2026-07-01", "google", {
      landingPageViews: 0,
      registrations: 12,
      purchases: 4,
    }),
  ];

  for (const platform of ["all", "meta", "google"] as const) {
    const snapshot = buildDashboardSnapshotFromRows(rows, RANGE, platform, {
      mode: "mock",
      storage: "fixture",
    });
    const markup = renderToStaticMarkup(
      createElement(SnapshotCard, {
        currency: snapshot.account.currency,
        snapshot,
      }),
    );

    assert.equal(snapshot.selectedPlatform, platform);
    assert.doesNotMatch(markup, /metric-sparkline/);
    assert.doesNotMatch(markup, /daily sparkline/i);
    assert.match(markup, /aria-label="Account snapshot"/);
  }
});

test("navigation groups the channels and keeps unbuilt ones visible as planned", () => {
  const sections = NAV_GROUPS.flatMap((group) => group.sections);
  const built = sections.filter((section) => !section.comingSoon);
  const planned = sections.filter((section) => section.comingSoon);

  assert.deepEqual(
    built.map((section) => section.href),
    ["/", "/store-analytics", "/worklog", "/data-sources", "/account"],
  );
  assert.deepEqual(
    planned.map((section) => section.label),
    ["SEO", "Social media", "CRM"],
  );
  // A planned channel must never carry sub-items that lead nowhere.
  assert.equal(
    planned.every((section) => section.children === undefined),
    true,
  );
});

test("an active navigation section can still be collapsed and reopened", () => {
  const paidAds = NAV_GROUPS.flatMap((group) => group.sections).find(
    (section) => section.href === "/",
  );

  assert.ok(paidAds);
  assert.equal(isNavSectionOpen(paidAds, "/"), true);
  assert.equal(isNavSectionOpen(paidAds, null), false);
});

test("the desktop sidebar exposes a persistent collapse control", () => {
  const markup = renderToStaticMarkup(
    createElement(DashboardSidebar, { activeHref: "/" }),
  );

  assert.match(markup, /aria-label="Collapse sidebar"/);
  assert.match(markup, /aria-controls="dashboard-primary-navigation"/);
  assert.match(markup, /aria-expanded="true"/);
  assert.match(markup, /id="dashboard-primary-navigation"/);
});

test("every sub-item points at a section on its own page", () => {
  for (const group of NAV_GROUPS) {
    for (const section of group.sections) {
      for (const child of section.children ?? []) {
        assert.equal(
          child.href.startsWith(`${section.href}#`),
          true,
          `${child.href} does not live under ${section.href}`,
        );
      }
    }
  }
});

test("the previous year is complete and the current year stops at the reference day", () => {
  const yearly = buildYearlyPerformance("2026-07-14");

  assert.equal(yearly.currentYear, 2026);
  assert.equal(yearly.previousYear, 2025);
  assert.equal(yearly.twoYearsAgo, 2024);
  assert.equal(yearly.twoYearsAgoMonths.length, 12);
  assert.equal(yearly.previousYearMonths.length, 12);
  assert.equal(
    yearly.previousYearMonths.every((month) => !month.isPartial),
    true,
  );
  assert.equal(yearly.currentYearMonths.length, 7);
  assert.equal(yearly.currentYearMonths.at(-1)?.isPartial, true);
  assert.equal(yearly.currentYearMonths.at(-1)?.throughDay, 14);
  assert.deepEqual(
    yearly.comparisonYears.map((series) => series.year),
    [2024, 2025, 2026],
  );
});

test("a partial month is compared against the same days a year earlier", () => {
  const yearly = buildYearlyPerformance("2026-07-14");
  const july = yearly.comparison.at(-1);
  const fullJuly2025 = yearly.previousYearMonths[6];

  assert.equal(july?.isPartial, true);
  assert.match(String(july?.label), /July \(1–14\)/);
  // The like-for-like figure must be smaller than the whole month it came from.
  assert.equal(
    (july?.previousSales ?? 0) < (fullJuly2025?.sales ?? 0),
    true,
  );
  assert.equal(yearly.comparisonYears[0]?.months[6]?.throughDay, 14);
  assert.equal(yearly.comparisonYears[1]?.months[6]?.throughDay, 14);
  assert.equal(yearly.comparisonYears[2]?.months[6]?.throughDay, 14);
});

test("year-to-date totals are the sum of the like-for-like months", () => {
  const yearly = buildYearlyPerformance("2026-07-14");
  const currentSum = yearly.comparison.reduce(
    (total, month) => total + month.currentSales,
    0,
  );
  const previousOrders = yearly.comparison.reduce(
    (total, month) => total + month.previousOrders,
    0,
  );

  assert.equal(Math.abs(yearly.ytd.currentSales - currentSum) < 0.05, true);
  assert.equal(yearly.ytd.previousOrders, previousOrders);
  assert.match(yearly.ytd.label, /January – July 1–14/);
});

test("the dummy year has a Q4 peak so the yearly view is worth reading", () => {
  const yearly = buildYearlyPerformance("2026-07-14");
  const december = yearly.previousYearMonths.at(-1);

  assert.equal(yearly.bestMonth?.month, december?.month);
  assert.match(yearly.note, /Q4 peak/i);
});

test("the store snapshot carries the yearly view with the selected range end", () => {
  const snapshot = buildStoreAnalyticsSnapshot(RANGE);

  assert.equal(snapshot.yearlyPerformance.currentYear, 2026);
  assert.equal(snapshot.yearlyPerformance.comparison.length, 7);
  assert.equal(
    snapshot.yearlyPerformance.ytd.salesDeltaPercent !== null,
    true,
  );
});
