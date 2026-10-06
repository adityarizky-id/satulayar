import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMetaCreativeFatigueAnalysis,
  buildMetaPlacementAnalysis,
} from "../src/lib/dashboard/creative-fatigue";

const RANGE = { start: "2026-07-01", end: "2026-07-14" };

test("buildMetaCreativeFatigueAnalysis flags healthy, warning, and critical fatigue correctly", () => {
  const analysis = buildMetaCreativeFatigueAnalysis({
    range: RANGE,
    currency: "GBP",
    metaSpend: 1500,
    metaImpressions: 45000,
    metaClicks: 850,
    metaPurchases: 60,
    targetCpa: 25,
  });

  assert.ok(analysis.ads.length >= 3);
  assert.equal(analysis.healthyCount + analysis.warningCount + analysis.criticalCount, analysis.activeAdsCount);

  // Critical ad check
  const criticalAd = analysis.ads.find((a) => a.fatigueStatus === "critical");
  assert.ok(criticalAd);
  assert.ok(criticalAd.frequency > 3.5 || criticalAd.ctrDeltaVs7d < -30);
  // A critical ad is named as a replacement candidate, never ordered killed:
  // the panel is simulated and a pause needs a role check first.
  assert.match(criticalAd.recommendedAction, /Replace candidate/);
  assert.doesNotMatch(criticalAd.recommendedAction, /Kill/i);

  // Warning ad check
  const warningAd = analysis.ads.find((a) => a.fatigueStatus === "warning");
  assert.ok(warningAd);
  assert.match(warningAd.recommendedAction, /Stage 2/i);

  // Video engagement
  assert.ok(analysis.videoEngagement.hookRate > 20);
  assert.ok(analysis.videoEngagement.holdRate > 10);
});

test("buildMetaPlacementAnalysis identifies Audience Network waste", () => {
  const placements = buildMetaPlacementAnalysis({
    metaSpend: 2000,
    metaPurchases: 75,
    currency: "GBP",
  });

  assert.ok(placements.placements.length >= 4);
  const audienceNetwork = placements.placements.find((p) => p.placement === "audience_network");
  assert.ok(audienceNetwork);
  assert.equal(audienceNetwork.wasteStatus, "high_bounce_waste");
  assert.equal(audienceNetwork.purchases, 0);
  assert.ok(placements.flaggedWasteAmount > 0);
  assert.match(placements.recommendation, /Audience Network/i);
});
