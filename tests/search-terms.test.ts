import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { GoogleIntentSection } from "../src/components/search/google-intent-section";
import { SearchTermSection } from "../src/components/search/search-term-section";
import {
  buildDashboardSnapshot,
  buildDashboardSnapshotFromRows,
} from "../src/lib/dashboard/fixtures";
import {
  buildNgramGroups,
  buildSearchTermAnalysisFromRows,
  judgeRelevance,
  judgeWaste,
  resolveComparisonRange,
  summariseMatchTypes,
  toKeywordMatchType,
  toSearchTermMatchType,
  type StoredSearchTermRow,
} from "../src/lib/dashboard/search-terms";
import type { DailyMetric } from "../src/lib/dashboard/types";
import { buildSearchTermAnalysis } from "../src/lib/dashboard/search-terms-fixture";
import { DEFAULT_TARGETS } from "../src/lib/dashboard/targets";

const RANGE = { start: "2026-07-01", end: "2026-07-14" };

function analysis(overrides = {}) {
  return buildSearchTermAnalysis({
    range: RANGE,
    currency: "GBP",
    accountSlug: "kopi-senja",
    searchSpend: 2_400,
    targets: DEFAULT_TARGETS,
    ...overrides,
  });
}

test("Search terms exposes four analysis views without stacking the diagnostic panels", () => {
  const snapshot = buildDashboardSnapshot(RANGE, "google");
  const markup = renderToStaticMarkup(
    createElement(SearchTermSection, {
      analysis: snapshot.searchTerms,
      currency: snapshot.account.currency,
      intent: snapshot.intentAnalysis,
      matchTypeDrift: snapshot.matchTypeDrift,
      selectedPlatform: snapshot.selectedPlatform,
      wastedSpend: snapshot.wastedSpendSummary,
    }),
  );

  assert.match(markup, /aria-label="Search analysis view"/);
  assert.match(markup, />Leak hunt</);
  assert.match(markup, />Keywords</);
  assert.match(markup, />Intent tiers</);
  assert.match(markup, />Waste &amp; negatives</);
  assert.equal((markup.match(/aria-pressed=/g) ?? []).length, 4);
  assert.doesNotMatch(markup, /Search intent tier breakdown/);
  assert.doesNotMatch(markup, /Wasted spend impact/);
  assert.doesNotMatch(markup, /How a leak is found/);
  assert.doesNotMatch(markup, /What these columns mean/);
});

test("Waste view keeps negative-keyword action and match drift in one panel", () => {
  const snapshot = buildDashboardSnapshot(RANGE, "google");
  const markup = renderToStaticMarkup(
    createElement(GoogleIntentSection, {
      currency: snapshot.account.currency,
      intent: snapshot.intentAnalysis,
      matchTypeDrift: snapshot.matchTypeDrift,
      view: "waste",
      wastedSpend: snapshot.wastedSpendSummary,
    }),
  );

  assert.match(markup, /Wasted spend impact &amp; negative keyword center/);
  assert.match(markup, /Match-type distribution &amp; query drift/);
  assert.match(markup, /Copy review list/);
  assert.doesNotMatch(markup, /Search intent tier breakdown/);
});

test("every comparison window resolves to a real, earlier range", () => {
  const windows = ["previous", "30d", "90d", "180d", "365d", "previous-year"] as const;

  for (const window of windows) {
    const range = resolveComparisonRange(RANGE, window);
    assert.ok(range.start < range.end, `${window} start is not before end`);
    assert.ok(range.end < RANGE.end, `${window} does not sit before the period`);
  }

  // The equal-length window is exactly as long as the period it compares with.
  const previous = resolveComparisonRange(RANGE, "previous");
  assert.equal(previous.start, "2026-06-17");
  assert.equal(previous.end, "2026-06-30");
  assert.equal(resolveComparisonRange(RANGE, "previous-year").start, "2025-07-01");
  assert.deepEqual(
    resolveComparisonRange(
      { start: "2024-02-29", end: "2024-03-01" },
      "previous-year",
    ),
    { start: "2023-02-28", end: "2023-03-01" },
  );
  // A rolling window ends the day before the period starts.
  assert.equal(resolveComparisonRange(RANGE, "30d").end, "2026-06-30");
  assert.equal(resolveComparisonRange(RANGE, "30d").start, "2026-06-01");
});

test("waste is judged on orders and registrations together", () => {
  const noConversions = judgeWaste(
    { spend: 90, impressions: 900, clicks: 40, registrations: 0, purchases: 0, purchaseValue: 0 },
    null,
    DEFAULT_TARGETS,
    "GBP",
  );
  // A registration alone is enough to keep a term out of the waste bucket.
  const onlyRegistrations = judgeWaste(
    { spend: 90, impressions: 900, clicks: 40, registrations: 4, purchases: 0, purchaseValue: 0 },
    null,
    DEFAULT_TARGETS,
    "GBP",
  );
  const tooEarly = judgeWaste(
    { spend: 12, impressions: 90, clicks: 4, registrations: 0, purchases: 0, purchaseValue: 0 },
    null,
    DEFAULT_TARGETS,
    "GBP",
  );

  assert.equal(noConversions.level, "spending-nothing-back");
  assert.equal(onlyRegistrations.level, "healthy");
  assert.equal(tooEarly.level, "too-early");
});

test("a falling term is flagged as declining, not as never having worked", () => {
  const verdict = judgeWaste(
    { spend: 120, impressions: 900, clicks: 60, registrations: 2, purchases: 1, purchaseValue: 40 },
    { spend: 100, impressions: 800, clicks: 55, registrations: 8, purchases: 4, purchaseValue: 160 },
    DEFAULT_TARGETS,
    "GBP",
  );

  assert.equal(verdict.level, "declining");
  assert.ok((verdict.conversionChange ?? 0) < 0);
});

test("a relevance verdict always carries a reason and says who decided", () => {
  const metrics = {
    spend: 60,
    impressions: 500,
    clicks: 30,
    registrations: 0,
    purchases: 0,
    purchaseValue: 0,
  };

  const jobSeeker = judgeRelevance("rattan shop jobs", metrics, DEFAULT_TARGETS);
  const fine = judgeRelevance("wholesale gifts id", metrics, DEFAULT_TARGETS);

  assert.equal(jobSeeker.verdict, "irrelevant");
  assert.ok(jobSeeker.reason.length > 0);
  assert.equal(jobSeeker.source, "rule-based");
  assert.ok(jobSeeker.signals.length > 0);
  // No wording signal, but money spent with nothing back: a human decides.
  assert.equal(fine.verdict, "review");
  assert.ok(fine.reason.length > 0);
});

test("cost alone never makes a query irrelevant", () => {
  const cheapAndFine = judgeRelevance(
    "wholesale gifts id",
    { spend: 4, impressions: 90, clicks: 3, registrations: 0, purchases: 0, purchaseValue: 0 },
    DEFAULT_TARGETS,
  );

  assert.equal(cheapAndFine.verdict, "relevant");
});

test("n-grams group the queries that share a word and skip stop words", () => {
  const report = analysis();
  const tokens = report.ngrams.map((group) => group.token);

  assert.ok(report.ngrams.length > 0);
  assert.equal(tokens.includes("the"), false);
  assert.equal(tokens.includes("uk"), false);
  for (const group of report.ngrams) {
    assert.ok(group.terms >= 2, `${group.token} is not shared`);
    assert.ok(group.rows.every((row) => row.term.includes(group.token)));
  }
});

test("the match-type summary carries the share of flagged spend", () => {
  const report = analysis();
  const broad = report.matchTypes.find((row) => row.matchType === "broad");
  const exact = report.matchTypes.find((row) => row.matchType === "exact");

  assert.ok(broad);
  assert.ok(exact);
  // Broad match is what pulls the wrong intent; exact should be clean.
  assert.ok(
    (broad?.irrelevantSpendShare ?? 0) > (exact?.irrelevantSpendShare ?? 1),
    "broad match should carry more flagged spend than exact",
  );
});

test("spend Google withheld is reported rather than absorbed", () => {
  const report = analysis({ searchSpend: 3_000 });
  const shown = report.rows.reduce((total, row) => total + row.spend, 0);

  assert.ok(report.totals.belowThresholdSpend > 0);
  assert.ok(
    Math.abs(shown + report.totals.belowThresholdSpend - 3_000) < 1,
    "shown plus withheld should reconcile to search spend",
  );
});

test("keywords roll up their own terms and keep the match type", () => {
  const report = analysis();

  for (const keyword of report.keywords) {
    const members = report.rows.filter(
      (row) => row.keyword === keyword.keyword,
    );
    const spend = members.reduce((total, row) => total + row.spend, 0);
    assert.ok(Math.abs(spend - keyword.spend) < 0.5, keyword.keyword);
    assert.equal(keyword.terms, members.length);
  }

  const broadKeyword = report.keywords.find((row) => row.matchType === "broad");
  assert.ok((broadKeyword?.irrelevantSpend ?? 0) > 0);
});

test("grouping is empty rather than wrong when nothing is shared", () => {
  assert.deepEqual(buildNgramGroups([]), []);
  assert.deepEqual(summariseMatchTypes([]), []);
});

// ---------------------------------------------------------------------------
// Live search-term reader (Section 6): stored ad_search_term_daily rows.
// ---------------------------------------------------------------------------

const LIVE_RANGE = { start: "2026-08-24", end: "2026-09-06" };
const LIVE_COMPARISON = { start: "2026-08-10", end: "2026-08-23" };

function storedRow(overrides: Partial<StoredSearchTermRow> = {}): StoredSearchTermRow {
  return {
    date: "2026-08-25",
    campaignKey: "111",
    adGroupKey: "900",
    searchTerm: "wholesale batik id",
    searchTermMatchType: "NEAR_PHRASE",
    keywordText: "wholesale batik",
    keywordMatchType: "PHRASE",
    currency: "GBP",
    spend: 1.5,
    impressions: 20,
    clicks: 2,
    registrations: 0,
    purchases: 0,
    purchaseValue: 0,
    isProvisional: false,
    ...overrides,
  };
}

function liveAnalysis(
  rows: StoredSearchTermRow[],
  extra: Partial<Parameters<typeof buildSearchTermAnalysisFromRows>[0]> = {},
) {
  return buildSearchTermAnalysisFromRows({
    rows,
    range: LIVE_RANGE,
    comparisonRange: LIVE_COMPARISON,
    comparisonWindow: "previous",
    currency: "GBP",
    targets: DEFAULT_TARGETS,
    campaignChannelTypes: new Map([["111", "SEARCH"]]),
    queryCampaignSpend: 10,
    ...extra,
  });
}

test("an empty leak hunt confirms live keywords exist and links to their view", () => {
  const report = liveAnalysis([storedRow({ spend: 1 })]);
  assert.ok(report);

  const markup = renderToStaticMarkup(
    createElement(SearchTermSection, {
      analysis: report,
      currency: "GBP",
      intent: null,
      matchTypeDrift: null,
      selectedPlatform: "google",
      wastedSpend: null,
    }),
  );

  assert.match(markup, /No repeated leak pattern found/);
  assert.match(markup, /Live data is available: 1 keyword across 1 query and keyword pair/);
  assert.match(markup, />View 1 keyword</);
  assert.doesNotMatch(markup, /How a leak is found/);
  assert.doesNotMatch(markup, /What these columns mean/);
});

test("no stored query rows returns null so the section stays pending", () => {
  assert.equal(liveAnalysis([]), null);
});

test("stored rows aggregate across days into one row per query and keyword", () => {
  const report = liveAnalysis([
    storedRow({ date: "2026-08-25", spend: 1.5, clicks: 2, impressions: 20 }),
    storedRow({ date: "2026-08-26", spend: 2.25, clicks: 1, impressions: 15, adGroupKey: "901" }),
  ]);

  assert.ok(report);
  assert.equal(report.dataOrigin, "platform");
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].spend, 3.75);
  assert.equal(report.rows[0].clicks, 3);
  assert.equal(report.rows[0].impressions, 35);
  assert.equal(report.rows[0].campaignType, "Search");
  assert.equal(report.totals.spend, 3.75);
  // The gap is real Search campaign spend minus the visible queries.
  assert.equal(report.totals.belowThresholdSpend, 6.25);
});

test("platform match types keep their identity, AI Max included", () => {
  assert.equal(toSearchTermMatchType("AI_MAX"), "ai-max");
  assert.equal(toSearchTermMatchType("NEAR_EXACT"), "near-exact");
  assert.equal(toSearchTermMatchType("NEAR_PHRASE"), "near-phrase");
  assert.equal(toSearchTermMatchType("SOMETHING_NEW"), "unknown");
  assert.equal(toKeywordMatchType("BROAD"), "broad");
  assert.equal(toKeywordMatchType(""), "unknown");

  const report = liveAnalysis([
    storedRow({ searchTerm: "a", searchTermMatchType: "AI_MAX" }),
    storedRow({ searchTerm: "a", searchTermMatchType: "NEAR_PHRASE" }),
  ]);
  assert.ok(report);
  // The same query matched two different ways is two rows, never merged.
  assert.deepEqual(
    report.rows.map((row) => row.termMatchType).toSorted(),
    ["ai-max", "near-phrase"],
  );
});

test("a keyword match type Google did not report still carries its spend", () => {
  const report = liveAnalysis([
    storedRow({ keywordText: "", keywordMatchType: "", spend: 4 }),
    storedRow({ searchTerm: "other", spend: 1 }),
  ]);
  assert.ok(report);
  const summed = report.matchTypes.reduce((total, item) => total + item.spend, 0);
  assert.equal(summed, report.totals.spend);
  assert.ok(report.matchTypes.some((item) => item.matchType === "unknown"));
  assert.equal(
    report.rows.find((row) => row.keywordMatchType === "unknown")?.keyword,
    "(no keyword reported)",
  );
});

test("unmeasured conversions are marked, never judged as waste", () => {
  const report = liveAnalysis([
    storedRow({ spend: 90, registrations: null, purchases: null, purchaseValue: null }),
  ]);
  assert.ok(report);
  const row = report.rows[0];
  assert.equal(row.conversionsMeasured, false);
  assert.equal(row.waste.level, "not-measured");
  assert.notEqual(row.relevance.verdict, "review");
  assert.equal(row.costPerPurchase, null);
  assert.equal(row.returnOnAdSpend, null);
  assert.match(report.safeMessage, /no measured conversions/);
});

test("one unmeasured day makes the whole group unmeasured", () => {
  const report = liveAnalysis([
    storedRow({ date: "2026-08-25", spend: 50 }),
    storedRow({ date: "2026-08-26", spend: 50, registrations: null, purchases: null }),
  ]);
  assert.ok(report);
  assert.equal(report.rows[0].conversionsMeasured, false);
});

test("measured zero conversions above one order's cost still reads as waste", () => {
  const report = liveAnalysis([storedRow({ spend: DEFAULT_TARGETS.costPerOrder + 5 })]);
  assert.ok(report);
  assert.equal(report.rows[0].waste.level, "spending-nothing-back");
});

test("a missing comparison window is no change, not a fall to zero", () => {
  const withoutWindow = liveAnalysis([storedRow()]);
  assert.ok(withoutWindow);
  assert.equal(withoutWindow.rows[0].previous, null);

  const withWindow = liveAnalysis([storedRow()], {
    comparisonRows: [storedRow({ date: "2026-08-12", searchTerm: "different" })],
  });
  assert.ok(withWindow);
  // The window was read and this query did not serve in it: a real zero.
  assert.equal(withWindow.rows[0].previous?.spend, 0);
});

test("without campaign spend the withheld-query gap is unavailable, not zero-claimed", () => {
  const report = liveAnalysis([storedRow()], { queryCampaignSpend: null });
  assert.ok(report);
  assert.equal(report.totals.belowThresholdSpend, 0);
  assert.match(report.safeMessage, /withheld-query gap is not reported/);
});

test("live snapshot: stored query rows lift Section 6 off the pending list", () => {
  const accountRow: DailyMetric = {
    date: "2026-08-25",
    clientId: "client-kopi-senja",
    accountId: "acct",
    platform: "google",
    currency: "GBP",
    accountTimezone: "Europe/London",
    spend: 12,
    impressions: 300,
    clicks: 10,
    landingPageViews: 0,
    registrations: 0,
    purchases: 0,
    platformConversionValue: 0,
    actualPurchaseRevenue: 0,
    sourceConnector: "google-direct-api",
    sourceQueryVersion: "google-ads-api-v23",
    syncedAt: "2026-09-15T01:41:16.000Z",
    isProvisional: false,
    entityLevel: "account",
  };
  const campaignRow: DailyMetric = {
    ...accountRow,
    entityLevel: "campaign",
    entityKey: "111",
    entityName: "KSN | SEARCH",
    spend: 8,
  };
  const options = {
    mode: "live" as const,
    storage: "supabase" as const,
    account: {
      id: "kopi-senja",
      name: "Kopi Senja Nusantara",
      currency: "GBP" as const,
      timezone: "Europe/London",
    },
    campaigns: {
      rows: [campaignRow],
      attributes: [
        {
          campaignKey: "111",
          campaignName: "KSN | SEARCH",
          channelType: "SEARCH",
          channelSubType: null,
          status: "ENABLED",
        },
      ],
    },
  };

  const pending = buildDashboardSnapshotFromRows([accountRow], LIVE_RANGE, "google", options);
  assert.equal(pending.searchTerms, null);
  assert.ok(pending.pendingPanels.some((panel) => panel.key === "search-terms"));

  const live = buildDashboardSnapshotFromRows([accountRow], LIVE_RANGE, "google", {
    ...options,
    searchTerms: {
      rows: [
        storedRow({ spend: 3 }),
        // Outside both windows: must be ignored.
        storedRow({ date: "2026-06-01", spend: 99 }),
      ],
    },
  });
  assert.ok(live.searchTerms);
  assert.equal(live.searchTerms.dataOrigin, "platform");
  assert.equal(live.searchTerms.totals.spend, 3);
  assert.equal(live.searchTerms.totals.belowThresholdSpend, 5);
  assert.ok(!live.pendingPanels.some((panel) => panel.key === "search-terms"));

  // The Meta filter never shows Google queries.
  const meta = buildDashboardSnapshotFromRows([accountRow], LIVE_RANGE, "meta", {
    ...options,
    searchTerms: { rows: [storedRow()] },
  });
  assert.equal(meta.searchTerms, null);
});
