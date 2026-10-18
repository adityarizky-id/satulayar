import assert from "node:assert/strict";
import test from "node:test";
import { resolveTableColumnLabels } from "@/components/dashboard/app-frame";
import { MetaCreativeRadar } from "@/components/campaigns/meta-creative-radar";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  buildMetaCreativeFatigueAnalysis,
  buildMetaPlacementAnalysis,
} from "../src/lib/dashboard/creative-fatigue";

const RANGE = { start: "2026-07-01", end: "2026-07-14" };

test("responsive metric labels retain grouped years and row-spanning campaign headers", () => {
  assert.deepEqual(resolveTableColumnLabels([
    [{ label: "Campaign", colSpan: 1, rowSpan: 2 }, { label: "Search", colSpan: 2, rowSpan: 1 }, { label: "Shopping", colSpan: 2, rowSpan: 1 }],
    [{ label: "Share", colSpan: 1, rowSpan: 1 }, { label: "Lost rank", colSpan: 1, rowSpan: 1 }, { label: "Share", colSpan: 1, rowSpan: 1 }, { label: "Lost rank", colSpan: 1, rowSpan: 1 }],
  ]), ["Campaign", "Search · Share", "Search · Lost rank", "Shopping · Share", "Shopping · Lost rank"]);
  assert.deepEqual(resolveTableColumnLabels([
    [{ label: "Month", colSpan: 1, rowSpan: 2 }, { label: "2026", colSpan: 2, rowSpan: 1 }],
    [{ label: "Revenue", colSpan: 1, rowSpan: 1 }, { label: "Orders", colSpan: 1, rowSpan: 1 }],
  ]), ["Month", "2026 · Revenue", "2026 · Orders"]);
});

test("creative rows retain format, days active and the full recommendation after column consolidation", () => {
  const fatigue = buildMetaCreativeFatigueAnalysis({ range: RANGE, currency: "USD", metaSpend: 1500, metaImpressions: 45000, metaClicks: 850, metaPurchases: 60, targetCpa: 25 });
  const html = renderToStaticMarkup(createElement(MetaCreativeRadar, { fatigue, placements: null, currency: "USD" }));
  for (const ad of fatigue.ads) {
    assert.ok(html.includes(`ID: ${ad.adId}`));
    assert.ok(html.includes(`${ad.daysActive} active days in period`));
    assert.ok(html.includes(ad.recommendedAction));
  }
  assert.match(html, /creative-radar-table__recommendation/);
  assert.match(html, /Action Status/);
  assert.doesNotMatch(html, /<th[^>]*>Format<\/th>/);
});

test("creative active days and daily-budget ceiling follow inclusive reporting dates", () => {
  for (const [range, expected] of [
    [{ start: "2026-07-14", end: "2026-07-14" }, [1, 1, 1, 1]],
    [{ start: "2026-07-08", end: "2026-07-14" }, [7, 7, 7, 7]],
    [RANGE, [14, 14, 14, 7]],
    [{ start: "2026-06-15", end: "2026-07-14" }, [18, 24, 30, 7]],
    [{ start: "2026-06-30", end: "2026-07-02" }, [3, 3, 3, 3]],
  ] as const) {
    const analysis = buildMetaCreativeFatigueAnalysis({ range, currency: "USD", metaSpend: 350, metaImpressions: 10000, metaPurchases: 10, targetCpa: 25 });
    assert.deepEqual(analysis.ads.map((ad) => ad.daysActive), expected);
    if (expected[0] === 14) assert.equal(analysis.adCeilingRecommended, 7);
    if (expected[0] === 18) assert.equal(analysis.adCeilingRecommended, 3);
  }
});

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
