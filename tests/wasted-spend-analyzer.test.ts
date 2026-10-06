import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeMatchTypeDrift,
  analyzeWastedSpend,
  type SearchQueryPerformanceInput,
} from "@/lib/analytics/wasted-spend-analyzer";

function row(overrides: Partial<SearchQueryPerformanceInput> = {}): SearchQueryPerformanceInput {
  return {
    searchTerm: "free coffee recipe pdf",
    keywordText: "wholesale beans",
    keywordMatchType: "BROAD",
    searchTermMatchType: "BROAD",
    campaignKey: "search",
    adGroupKey: "beans",
    spend: 45,
    impressions: 500,
    clicks: 30,
    registrations: 0,
    purchases: 0,
    purchaseValue: 0,
    ...overrides,
  };
}

test("waste formula requires high spend and measured zero conversions", () => {
  const report = analyzeWastedSpend(
    [
      row(),
      row({
        searchTerm: "wholesale batik supplier",
        keywordText: "wholesale batik",
        keywordMatchType: "PHRASE",
        spend: 60,
        registrations: null,
        purchases: null,
      }),
      row({ searchTerm: "coffee making jobs", spend: 15 }),
    ],
    { targetCostPerAcquisition: 30, daysInRange: 15 },
  );

  assert.equal(report.spendAnalyzed, 120);
  assert.equal(report.measuredSpend, 60);
  assert.equal(report.unmeasuredConversionSpend, 60);
  assert.equal(report.zeroConversionSpend, 60);
  assert.equal(report.totalWastedAmount, 45);
  assert.equal(report.wastedSpendPercent, 37.5);
  assert.equal(report.monthlyProjectedSavings, 90);
  assert.equal(report.flaggedQueryCount, 1);
});

test("a real conversion keeps an expensive query out of the waste bucket", () => {
  const report = analyzeWastedSpend(
    [row({ spend: 120, registrations: 1 })],
    { targetCostPerAcquisition: 30 },
  );

  assert.equal(report.flaggedQueryCount, 0);
  assert.deepEqual(report.negativeKeywordExportRows, []);
});

test("negative export defaults to exact match and requires approval", () => {
  const report = analyzeWastedSpend([row()], { targetCostPerAcquisition: 30 });
  const recommendation = report.recommendations[0];

  assert.ok(recommendation);
  assert.equal(recommendation.suggestedExact, "[free coffee recipe pdf]");
  assert.equal(recommendation.suggestedPhrase, '"free"');
  assert.equal(recommendation.basis, "query");
  assert.equal(recommendation.approvalRequired, true);
  assert.equal(recommendation.exportRow.matchType, "exact");
  assert.equal(recommendation.exportRow.adGroupKey, "beans");
});

test("small repeated leaks cross the threshold as an n-gram cluster", () => {
  const report = analyzeWastedSpend(
    [
      row({ searchTerm: "free coffee recipe", spend: 12 }),
      row({ searchTerm: "free jamu tutorial", spend: 11 }),
      row({ searchTerm: "free batik guide", spend: 10 }),
    ],
    { targetCostPerAcquisition: 30 },
  );
  const cluster = report.recommendations.find(
    (recommendation) => recommendation.basis === "ngram_cluster",
  );

  assert.equal(report.totalWastedAmount, 33);
  assert.equal(report.flaggedQueryCount, 3);
  assert.ok(cluster);
  assert.equal(cluster.suggestedPhrase, '"free"');
  assert.equal(cluster.matchedQueryCount, 3);
  assert.equal(cluster.exportRow.matchType, "phrase");
});

test("a converting query blocks a shared phrase from automatic recommendation", () => {
  const report = analyzeWastedSpend(
    [
      row({ searchTerm: "free coffee recipe", spend: 18 }),
      row({ searchTerm: "free jamu tutorial", spend: 17 }),
      row({
        searchTerm: "free shipping wholesale beans",
        spend: 5,
        registrations: 1,
      }),
    ],
    { targetCostPerAcquisition: 30 },
  );

  assert.equal(
    report.recommendations.some(
      (recommendation) => recommendation.basis === "ngram_cluster" && recommendation.query === "free",
    ),
    false,
  );
});

test("commercial zero-conversion queries are review findings, not automatic negatives", () => {
  const report = analyzeWastedSpend(
    [row({
      searchTerm: "wholesale batik supplier",
      keywordText: "wholesale batik",
      keywordMatchType: "EXACT",
      spend: 40,
    })],
    { targetCostPerAcquisition: 30 },
  );

  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0].intent.tier, "high_commercial");
  assert.equal(report.recommendations.length, 0);
});

test("drift score separates a close variant from an irrelevant broad query", () => {
  const aligned = analyzeMatchTypeDrift(row({
    searchTerm: "wholesale robusta beans",
    keywordText: "wholesale beans",
    keywordMatchType: "EXACT",
  }));
  const drifted = analyzeMatchTypeDrift(row());

  assert.ok(aligned.score !== null && aligned.score < 0.35);
  assert.equal(aligned.verdict, "aligned");
  assert.ok(drifted.score !== null && drifted.score >= 0.55);
  assert.equal(drifted.verdict, "drifted");
  assert.ok((drifted.components?.intentMismatch ?? 0) > 0);
});

test("missing target keyword produces insufficient data instead of a false drift", () => {
  const result = analyzeMatchTypeDrift(row({ keywordText: "" }));

  assert.equal(result.score, null);
  assert.equal(result.verdict, "insufficient_data");
});

test("AI Max remains explicit and carries the broadest match penalty", () => {
  const result = analyzeMatchTypeDrift(row({ searchTermMatchType: "AI_MAX" }));

  assert.equal(result.searchTermMatchType, "ai_max");
  assert.equal(result.components?.matchTypePenalty, 1);
});
