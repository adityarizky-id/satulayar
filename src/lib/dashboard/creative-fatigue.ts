import type {
  Currency,
  DateRange,
  MetaCreativeFatigueAnalysis,
  MetaCreativeHealthRow,
  MetaPlacementAnalysis,
  MetaPlacementBreakdownRow,
} from "@/lib/dashboard/types";
import { inclusiveDays } from "@/lib/dashboard/calendar";

/**
 * Builds the Creative Fatigue & Lifecycle Radar for Meta Ads.
 * Derives operational actions (kill, swap, iterate) based on the Paid Ads OS
 * Meta Decision System thresholds.
 */
export function buildMetaCreativeFatigueAnalysis(input: {
  range: DateRange;
  currency: Currency;
  metaSpend: number;
  metaImpressions: number;
  metaClicks?: number;
  metaPurchases: number;
  targetCpa?: number;
}): MetaCreativeFatigueAnalysis {
  const { metaSpend, metaImpressions, metaPurchases } = input;
  const targetCpa = input.targetCpa ?? 28;
  const periodDays = inclusiveDays(input.range);

  if (metaSpend <= 0 || metaImpressions <= 0) {
    return {
      activeAdsCount: 0,
      healthyCount: 0,
      warningCount: 0,
      criticalCount: 0,
      adCeilingRecommended: 4,
      ads: [],
      videoEngagement: {
        hookRate: 0,
        holdRate: 0,
        averageWatchTimeSec: 0,
        hookVerdict: "needs_attention",
        holdVerdict: "needs_attention",
        diagnosticNote: "No active Meta spend in the selected date range.",
      },
    };
  }

  // Recommended ad-count ceiling = (daily budget * 14) / (2 * TCPL)
  const dailySpend = metaSpend / periodDays;
  const adCeilingRecommended = Math.max(3, Math.min(10, Math.round((dailySpend * 14) / (2 * targetCpa))));

  const ads: MetaCreativeHealthRow[] = [
    {
      adId: "ad-meta-01",
      adName: "UGC Product Showcase — Drip Bag & Beans",
      format: "video_reels",
      // Demo delivery durations are bounded to the selected reporting window.
      daysActive: Math.min(18, periodDays),
      spend: Math.round(metaSpend * 0.38),
      impressions: Math.round(metaImpressions * 0.40),
      frequency: 2.1,
      ctrCurrent: 1.85,
      ctrDeltaVs7d: 4.2, // Still gaining momentum
      cpmCurrent: 14.2,
      cpmDeltaVs7d: -2.1,
      purchases: Math.round(metaPurchases * 0.42),
      costPerPurchase: metaPurchases > 0 ? Math.round((metaSpend * 0.38) / (metaPurchases * 0.42)) : null,
      roas: 3.4,
      fatigueStatus: "healthy",
      recommendedAction: "Scale budget +15%; winning creative with strong hold rate.",
    },
    {
      adId: "ad-meta-02",
      adName: "Lifestyle Carousel — Best-selling Jamu Trio",
      format: "carousel",
      daysActive: Math.min(24, periodDays),
      spend: Math.round(metaSpend * 0.28),
      impressions: Math.round(metaImpressions * 0.26),
      frequency: 2.9,
      ctrCurrent: 1.32,
      ctrDeltaVs7d: -16.4, // Fatigue warning
      cpmCurrent: 16.8,
      cpmDeltaVs7d: 22.5,
      purchases: Math.round(metaPurchases * 0.25),
      costPerPurchase: metaPurchases > 0 ? Math.round((metaSpend * 0.28) / (metaPurchases * 0.25)) : null,
      roas: 2.2,
      fatigueStatus: "warning",
      recommendedAction: "Stage 2 fresh card iterations now; frequency nearing upper threshold.",
    },
    {
      adId: "ad-meta-03",
      adName: "Static Minimalist — Starter Pack Offer & Fast Dispatch",
      format: "static",
      daysActive: Math.min(38, periodDays),
      spend: Math.round(metaSpend * 0.22),
      impressions: Math.round(metaImpressions * 0.20),
      frequency: 4.2,
      ctrCurrent: 0.74,
      ctrDeltaVs7d: -34.8, // Critical fatigue
      cpmCurrent: 19.5,
      cpmDeltaVs7d: 41.0,
      purchases: Math.round(metaPurchases * 0.18),
      costPerPurchase: metaPurchases > 0 ? Math.round((metaSpend * 0.22) / (metaPurchases * 0.18)) : null,
      roas: 1.3,
      fatigueStatus: "critical",
      recommendedAction: "Replace candidate: frequency above 4.0 and CTR down over 30%. Check its role before pausing.",
    },
    {
      adId: "ad-meta-04",
      adName: "Founder Angle — Handmade Quality & Eco-friendly Story",
      format: "video_reels",
      daysActive: Math.min(7, periodDays),
      spend: Math.round(metaSpend * 0.12),
      impressions: Math.round(metaImpressions * 0.14),
      frequency: 1.4,
      ctrCurrent: 2.10,
      ctrDeltaVs7d: 8.5,
      cpmCurrent: 12.5,
      cpmDeltaVs7d: -5.0,
      purchases: Math.round(metaPurchases * 0.15),
      costPerPurchase: metaPurchases > 0 ? Math.round((metaSpend * 0.12) / (metaPurchases * 0.15)) : null,
      roas: 3.8,
      fatigueStatus: "healthy",
      recommendedAction: "Testing phase winner; candidate to graduate into the Scaling campaign.",
    },
  ];

  const healthyCount = ads.filter((a) => a.fatigueStatus === "healthy").length;
  const warningCount = ads.filter((a) => a.fatigueStatus === "warning").length;
  const criticalCount = ads.filter((a) => a.fatigueStatus === "critical").length;

  // Video engagement benchmarks
  const hookRate = 28.6; // 3-second views / impressions
  const holdRate = 18.4; // ThruPlays / 3-second views
  const averageWatchTimeSec = 6.8;

  return {
    activeAdsCount: ads.length,
    healthyCount,
    warningCount,
    criticalCount,
    adCeilingRecommended,
    ads,
    videoEngagement: {
      hookRate,
      holdRate,
      averageWatchTimeSec,
      hookVerdict: hookRate >= 25 ? "strong" : "average",
      holdVerdict: holdRate >= 15 ? "strong" : "needs_attention",
      diagnosticNote:
        "3-second hook rate is healthy (28.6%), showing strong thumb-stopping visuals. Hold rate (18.4%) is within optimal range for Reels.",
    },
  };
}

/**
 * Builds the Meta Ads Placement performance breakdown and waste identifier.
 */
export function buildMetaPlacementAnalysis(input: {
  metaSpend: number;
  metaPurchases: number;
  currency: Currency;
}): MetaPlacementAnalysis {
  const { metaSpend, metaPurchases } = input;

  if (metaSpend <= 0) {
    return {
      placements: [],
      flaggedWasteAmount: 0,
      topPerformingPlacement: "None",
      recommendation: "No active Meta placements recorded.",
    };
  }

  const placements: MetaPlacementBreakdownRow[] = [
    {
      placement: "ig_reels",
      label: "Instagram Reels",
      spend: Math.round(metaSpend * 0.42),
      spendSharePercent: 42,
      clicks: 480,
      cpc: 0.38,
      ctr: 1.95,
      purchases: Math.round(metaPurchases * 0.48),
      cpa: metaPurchases > 0 ? Math.round((metaSpend * 0.42) / (metaPurchases * 0.48)) : null,
      roas: 3.6,
      wasteStatus: "optimal",
    },
    {
      placement: "ig_feed",
      label: "Instagram Feed",
      spend: Math.round(metaSpend * 0.28),
      spendSharePercent: 28,
      clicks: 290,
      cpc: 0.42,
      ctr: 1.45,
      purchases: Math.round(metaPurchases * 0.28),
      cpa: metaPurchases > 0 ? Math.round((metaSpend * 0.28) / (metaPurchases * 0.28)) : null,
      roas: 2.8,
      wasteStatus: "optimal",
    },
    {
      placement: "fb_feed",
      label: "Facebook Feed",
      spend: Math.round(metaSpend * 0.18),
      spendSharePercent: 18,
      clicks: 160,
      cpc: 0.48,
      ctr: 1.20,
      purchases: Math.round(metaPurchases * 0.18),
      cpa: metaPurchases > 0 ? Math.round((metaSpend * 0.18) / (metaPurchases * 0.18)) : null,
      roas: 2.3,
      wasteStatus: "optimal",
    },
    {
      placement: "ig_stories",
      label: "Instagram Stories",
      spend: Math.round(metaSpend * 0.08),
      spendSharePercent: 8,
      clicks: 95,
      cpc: 0.35,
      ctr: 1.10,
      purchases: Math.round(metaPurchases * 0.06),
      cpa: metaPurchases > 0 ? Math.round((metaSpend * 0.08) / Math.max(1, metaPurchases * 0.06)) : null,
      roas: 1.9,
      wasteStatus: "underfunded",
    },
    {
      placement: "audience_network",
      label: "Audience Network",
      spend: Math.round(metaSpend * 0.04),
      spendSharePercent: 4,
      clicks: 140,
      cpc: 0.12,
      ctr: 2.85, // High CTR from accidental taps
      purchases: 0,
      cpa: null,
      roas: 0,
      wasteStatus: "high_bounce_waste",
    },
  ];

  const flaggedWaste = placements.find((p) => p.placement === "audience_network");
  const flaggedWasteAmount = flaggedWaste?.spend ?? 0;

  return {
    placements,
    flaggedWasteAmount,
    topPerformingPlacement: "Instagram Reels (42% spend, 3.6x ROAS)",
    recommendation:
      flaggedWasteAmount > 0
        ? `Audience Network spent ${flaggedWasteAmount} with 0 purchases despite 2.85% CTR (accidental taps). Recommend excluding Audience Network in Ad Set placement settings.`
        : "Placement distribution is healthy across IG Reels and Feeds.",
  };
}
