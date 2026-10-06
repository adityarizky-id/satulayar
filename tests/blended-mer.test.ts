import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBlendedMerSummary,
  buildBudgetOpportunityAdvisor,
  buildRfmPaidAudienceBridge,
} from "../src/lib/dashboard/blended-mer";

test("buildBlendedMerSummary calculates real store MER and attribution overlap accurately", () => {
  const summary = buildBlendedMerSummary({
    totalAdSpend: 4000,
    googlePurchases: 70,
    metaPurchases: 50,
    currency: "GBP",
    storeNetSales: 15200,
    storeRealOrders: 100,
  });

  assert.equal(summary.blendedMer, 3.8);
  assert.equal(summary.claimedPlatformOrders, 120);
  assert.equal(summary.realStoreOrders, 100);
  assert.equal(summary.overlapOrdersCount, 20);
  assert.equal(summary.attributionOverlapPercent, 20);
  assert.equal(summary.merStatus, "scaling_ready");
  assert.match(summary.reconciliationNote, /attribution overlap/i);
});

test("buildRfmPaidAudienceBridge prepares Lookalike, Winback, and Exclusion cards", () => {
  const bridge = buildRfmPaidAudienceBridge({
    currency: "GBP",
    championsCount: 50,
    loyalCount: 60,
    atRiskCount: 40,
    dormantCount: 30,
    recentBuyersCount: 25,
  });

  assert.equal(bridge.cards.length, 3);
  assert.equal(bridge.totalActionableAccounts, 205);

  const lookalike = bridge.cards.find((c) => c.targetPlatform === "meta_lookalike");
  assert.ok(lookalike);
  assert.equal(lookalike.customerCount, 110);
  assert.match(lookalike.exportFileName, /\.csv$/);

  const winback = bridge.cards.find((c) => c.targetPlatform === "meta_custom_audience");
  assert.ok(winback);
  assert.equal(winback.customerCount, 70);

  const exclusion = bridge.cards.find((c) => c.targetPlatform === "negative_exclusion");
  assert.ok(exclusion);
  assert.equal(exclusion.customerCount, 25);
});

test("buildBudgetOpportunityAdvisor detects headroom when Google ROAS is high and Meta is fatigued", () => {
  const opportunity = buildBudgetOpportunityAdvisor({
    googleRoas: 4.8,
    metaRoas: 2.8,
    metaFatigueCount: 1,
    currency: "GBP",
  });

  assert.equal(opportunity.status, "opportunity_found");
  assert.equal(opportunity.recommendedShiftPercent, 15);
  assert.ok(opportunity.estimatedWeeklyRevenueUplift > 0);
  assert.match(opportunity.fromChannel, /Meta/i);
  assert.match(opportunity.toChannel, /Google/i);
});
