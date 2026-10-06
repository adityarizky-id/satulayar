import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGoogleIntentAnalysis,
  buildGoogleIntentAnalysisFromRows,
  buildGoogleMatchTypeDriftSummary,
  buildGoogleMatchTypeDriftSummaryFromRows,
  buildGoogleWastedSpendSummary,
  buildGoogleWastedSpendSummaryFromRows,
} from "../src/lib/dashboard/intent-tiers";
import { resolveIntentProfile } from "../src/lib/analytics/intent-classifier";
import type { StoredSearchTermRow } from "../src/lib/dashboard/search-terms";

test("buildGoogleIntentAnalysis distributes non-brand search spend into 4 intent tiers", () => {
  const intent = buildGoogleIntentAnalysis({
    googleSpend: 2500,
    googleClicks: 1200,
    googlePurchases: 90,
    currency: "GBP",
  });

  assert.equal(intent.tiers.length, 4);
  const tier1 = intent.tiers.find((t) => t.tier === "high_intent_category");
  assert.ok(tier1);
  assert.ok(tier1.spendSharePercent >= 50);
  assert.ok(tier1.roas !== null && tier1.roas >= 4.0);
  assert.ok(tier1.topSampleQueries.length > 0);
  assert.ok(intent.highIntentSharePercent !== null);
  assert.ok(intent.highIntentSharePercent >= 50);
  // Brand is reported beside the ladder, never as a rung on it.
  assert.ok(!intent.tiers.some((t) => t.tier === ("competitor" as never)));
  assert.ok(intent.brandSpend > 0);
});

test("buildGoogleWastedSpendSummary formats negative keywords in exact and phrase syntax", () => {
  const wasted = buildGoogleWastedSpendSummary({
    googleSpend: 2000,
    currency: "GBP",
    daysInRange: 14,
  });

  assert.ok(wasted.totalWastedAmount > 0);
  assert.ok(wasted.wastedSpendPercent > 0);
  assert.ok(wasted.monthlyProjectedSavings > 0);
  assert.ok(wasted.recommendations.length >= 3);

  for (const rec of wasted.recommendations) {
    assert.match(rec.suggestedExact, /^\[.+\]$/);
    assert.match(rec.suggestedPhrase, /^".+"$/);
    assert.ok(rec.spendWasted > 0);
    assert.ok(rec.clicks > 0);
  }
});

test("buildGoogleMatchTypeDriftSummary monitors Exact, Phrase, and Broad balance", () => {
  const drift = buildGoogleMatchTypeDriftSummary({
    googleSpend: 2000,
  });

  assert.equal(drift.exactSharePercent + drift.phraseSharePercent + drift.broadSharePercent, 100);
  assert.equal(drift.driftVerdict, "tight");
  assert.ok(drift.driftIndexPercent !== null);
  assert.ok(drift.driftIndexPercent < 20);
});

function storedRow(
  overrides: Partial<StoredSearchTermRow> & { searchTerm: string },
): StoredSearchTermRow {
  return {
    date: "2026-09-01",
    campaignKey: "c1",
    adGroupKey: "g1",
    searchTermMatchType: "BROAD",
    keywordText: "wholesale gifts",
    keywordMatchType: "BROAD",
    currency: "EUR",
    spend: 40,
    impressions: 500,
    clicks: 20,
    registrations: 0,
    purchases: 0,
    purchaseValue: 0,
    isProvisional: false,
    ...overrides,
  };
}

test("unmeasured conversions report no coverage, never a clean bill of health", () => {
  const rows = [
    storedRow({ searchTerm: "coffee jobs vacancy", registrations: null, purchases: null, purchaseValue: null }),
    storedRow({ searchTerm: "free coffee recipes pdf", registrations: null, purchases: null, purchaseValue: null }),
  ];

  const summary = buildGoogleWastedSpendSummaryFromRows({
    rows,
    currency: "EUR",
    targetCostPerAcquisition: 30,
    daysInRange: 30,
  });

  // Zero findings, because nothing could be judged — not because nothing leaks.
  assert.equal(summary.flaggedQueryCount, 0);
  assert.equal(summary.coverage, "none");
  assert.equal(summary.measuredSpend, 0);
  assert.equal(summary.unmeasuredConversionSpend, 80);
  assert.equal(summary.spendAnalyzed, 80);
});

test("partial measurement is reported as partial, not rounded up to complete", () => {
  const rows = [
    storedRow({ searchTerm: "wholesale coffee supplies", spend: 90, purchases: 3, purchaseValue: 400 }),
    storedRow({ searchTerm: "coffee jobs vacancy", spend: 10, registrations: null, purchases: null, purchaseValue: null }),
  ];

  const summary = buildGoogleWastedSpendSummaryFromRows({
    rows,
    currency: "EUR",
    targetCostPerAcquisition: 30,
    daysInRange: 30,
  });

  assert.equal(summary.coverage, "partial");
  assert.equal(summary.unmeasuredConversionSpend, 10);
});

test("no scoreable keyword yields insufficient data, never a tight verdict", () => {
  const rows = [
    storedRow({ searchTerm: "wholesale coffee supplies", keywordText: "", keywordMatchType: "" }),
  ];

  const drift = buildGoogleMatchTypeDriftSummaryFromRows({
    rows,
    targetCostPerAcquisition: 30,
  });

  assert.equal(drift.driftIndexPercent, null);
  assert.equal(drift.driftVerdict, "insufficient_data");
  assert.match(drift.driftNote, /no drift verdict is available/);
});

test("brand queries stay out of the non-brand ladder and are reported beside it", () => {
  const rows = [
    storedRow({ searchTerm: "kopi senja drip bag", spend: 60 }),
    storedRow({ searchTerm: "wholesale coffee supplies", spend: 40 }),
  ];

  const intent = buildGoogleIntentAnalysisFromRows({
    rows,
    currency: "GBP",
    profile: resolveIntentProfile("kopi-senja"),
  });

  assert.equal(intent.brandSpend, 60);
  assert.equal(intent.brandSharePercent, 60);
  // The ladder's denominator is the non-brand spend alone.
  const tier1 = intent.tiers.find((t) => t.tier === "high_intent_category");
  assert.ok(tier1);
  assert.equal(tier1.spend, 40);
  assert.equal(tier1.spendSharePercent, 100);
  assert.equal(intent.highIntentSharePercent, 100);
});

test("an Indonesian query is classified in Indonesian, not left unclassified", () => {
  const rows = [
    storedRow({ searchTerm: "harga grosir benang rajut", spend: 50 }),
    storedRow({ searchTerm: "pola rajut gratis pdf", spend: 30 }),
  ];

  const intent = buildGoogleIntentAnalysisFromRows({
    rows,
    currency: "USD",
    profile: resolveIntentProfile("rumah-rajut"),
  });

  const tier1 = intent.tiers.find((t) => t.tier === "high_intent_category");
  const waste = intent.tiers.find((t) => t.tier === "unclassified_waste");
  assert.ok(tier1);
  assert.ok(waste);
  assert.equal(tier1.spend, 50);
  assert.equal(waste.spend, 30);
  assert.equal(intent.classifiedSharePercent, 100);
});

test("an unmatched query is reported as unclassified, not as discovery traffic", () => {
  const rows = [storedRow({ searchTerm: "zzz qqq vvv", spend: 25 })];

  const intent = buildGoogleIntentAnalysisFromRows({
    rows,
    currency: "EUR",
    profile: resolveIntentProfile("batik-lestari"),
  });

  const unclassified = intent.tiers.find((t) => t.tier === "unclassified");
  const problemAware = intent.tiers.find((t) => t.tier === "problem_aware");
  assert.ok(unclassified);
  assert.ok(problemAware);
  assert.equal(unclassified.spend, 25);
  assert.equal(problemAware.spend, 0);
  assert.equal(intent.classifiedSharePercent, 0);
  assert.match(intent.strategicNote, /Read it as a sample/);
});

test("an unmeasured tier reports null purchases and null return, never zero", () => {
  const rows = [
    storedRow({
      searchTerm: "wholesale coffee supplies",
      registrations: null,
      purchases: null,
      purchaseValue: null,
    }),
  ];

  const intent = buildGoogleIntentAnalysisFromRows({
    rows,
    currency: "EUR",
    profile: resolveIntentProfile("kopi-senja"),
  });

  const tier1 = intent.tiers.find((t) => t.tier === "high_intent_category");
  assert.ok(tier1);
  assert.equal(tier1.purchases, null);
  assert.equal(tier1.roas, null);
  assert.equal(tier1.cpa, null);
});

test("a tier with no clicks reports no CPC rather than a CPC of zero", () => {
  const rows = [storedRow({ searchTerm: "wholesale coffee supplies", clicks: 0 })];

  const intent = buildGoogleIntentAnalysisFromRows({
    rows,
    currency: "EUR",
    profile: resolveIntentProfile("kopi-senja"),
  });

  const tier1 = intent.tiers.find((t) => t.tier === "high_intent_category");
  assert.ok(tier1);
  assert.equal(tier1.cpc, null);
});
