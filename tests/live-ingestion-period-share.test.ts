import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  analyzeWastedSpend,
  type SearchQueryPerformanceInput,
} from "@/lib/analytics/wasted-spend-analyzer";
import { BACKFILL_LOOKBACKS, resolveBackfillWindow } from "@/lib/connectors/backfill";
import {
  IMPRESSION_SHARE_MASK_FLOOR,
  buildImpressionShareReportFromRows,
  resolvePeriodAuctionShare,
  type DailyShareInput,
  type StoredImpressionSharePeriodRow,
} from "@/lib/dashboard/impression-share";
import type { StoredSearchTermRow } from "@/lib/dashboard/search-terms";
import { buildAuctionDiagnostics } from "@/lib/ui-contract";

const RANGE = { start: "2026-08-24", end: "2026-09-14" };

// ------------------------------------------- 24.3 structural compatibility

/**
 * The compatibility question from handoff 24.3: can the live reader's row go
 * straight into the analytics layer, or is a second row shape needed?
 *
 * This assignment is the answer, and the compiler checks it rather than prose.
 * If either interface drifts - a field renamed, a null widened, `readonly`
 * dropped from the analyzer's parameter - this stops compiling, which is
 * exactly when someone needs to know.
 */
const COMPATIBILITY_WITNESS: readonly SearchQueryPerformanceInput[] =
  [] as readonly StoredSearchTermRow[];

function storedRow(
  overrides: Partial<StoredSearchTermRow> = {},
): StoredSearchTermRow {
  return {
    date: "2026-09-01",
    campaignKey: "1234",
    adGroupKey: "5678",
    searchTerm: "wholesale batik supplier",
    searchTermMatchType: "AI_MAX",
    keywordText: "batik wholesale",
    keywordMatchType: "BROAD",
    currency: "GBP",
    spend: 42,
    impressions: 900,
    clicks: 30,
    registrations: 0,
    purchases: 0,
    purchaseValue: null,
    isProvisional: false,
    ...overrides,
  };
}

test("a stored search-term row is accepted by the analyzer without a second row shape", () => {
  assert.deepEqual(COMPATIBILITY_WITNESS, []);

  const rows: readonly StoredSearchTermRow[] = [storedRow()];
  // No mapping step and no cast: the reader's rows are passed exactly as they
  // come out of Supabase.
  const analysis = analyzeWastedSpend(rows, {
    targetCostPerAcquisition: 30,
    minimumSpendMultiplier: 1,
    daysInRange: 22,
  });

  assert.equal(analysis.findings.length, 1);
  assert.equal(analysis.findings[0].searchTerm, "wholesale batik supplier");
  assert.equal(analysis.measuredSpend, 42);
});

test("an unmeasured conversion makes a row ineligible instead of zero", () => {
  const rows: readonly StoredSearchTermRow[] = [
    storedRow({ registrations: null, purchases: null }),
  ];
  const analysis = analyzeWastedSpend(rows, {
    targetCostPerAcquisition: 30,
    minimumSpendMultiplier: 1,
    daysInRange: 22,
  });

  // Null is "not measured", which is not a claim that nothing converted.
  assert.equal(analysis.findings.length, 0);
  assert.equal(analysis.measuredSpend, 0);
  assert.equal(analysis.unmeasuredConversionSpend, 42);
});

// --------------------------------------------- period-level impression share

function periodRow(
  overrides: Partial<StoredImpressionSharePeriodRow> = {},
): StoredImpressionSharePeriodRow {
  return {
    rangeStart: RANGE.start,
    rangeEnd: RANGE.end,
    scope: "account",
    campaignKey: "",
    impressions: 11_355,
    searchImpressionShare: 0.062,
    searchBudgetLostImpressionShare: 0.137,
    searchRankLostImpressionShare: 0.801,
    ...overrides,
  };
}

test("Google's own period answer is preferred over anything derived from days", () => {
  // The live Kopi Senja Nusantara figures for 24 Aug-14 Sep 2026.
  const resolved = resolvePeriodAuctionShare(RANGE, [periodRow()], []);

  assert.equal(resolved.aggregationBasis, "period_exact");
  assert.equal(resolved.lostToRankRatio, 0.801);
  assert.equal(resolved.lostToBudgetRatio, 0.137);

  const diagnostics = buildAuctionDiagnostics({
    range: RANGE,
    lostToRankRatio: resolved.lostToRankRatio,
    lostToBudgetRatio: resolved.lostToBudgetRatio,
    aggregationBasis: resolved.aggregationBasis,
  });

  // An exact figure is the only one allowed to render without a tilde.
  assert.equal(diagnostics.lostToRank.isExact, true);
  assert.equal(diagnostics.lostToRank.displayValue, "80.1%");
  assert.equal(diagnostics.dominantConstraint, "rank");
});

test("a period Google was never asked about falls back to days and says so", () => {
  const daily: DailyShareInput[] = [
    {
      impressions: 500,
      searchRankLostImpressionShare: 0.79,
      searchBudgetLostImpressionShare: 0.12,
    },
    {
      impressions: 500,
      searchRankLostImpressionShare: 0.81,
      searchBudgetLostImpressionShare: 0.14,
    },
  ];
  const resolved = resolvePeriodAuctionShare(RANGE, [], daily);

  assert.equal(resolved.aggregationBasis, "daily_derived");
  assert.equal(resolved.consideredDays, 2);

  const diagnostics = buildAuctionDiagnostics({
    range: RANGE,
    lostToRankRatio: resolved.lostToRankRatio,
    lostToBudgetRatio: resolved.lostToBudgetRatio,
    aggregationBasis: resolved.aggregationBasis,
  });

  assert.equal(diagnostics.lostToRank.isExact, false);
  assert.ok(diagnostics.lostToRank.displayValue.startsWith("~"));
  assert.equal(diagnostics.sourceStatus, "provisional");
});

test("a stored row for a different window is not treated as this period's answer", () => {
  const otherWindow = periodRow({
    rangeStart: "2026-07-25",
    rangeEnd: "2026-08-23",
    searchRankLostImpressionShare: 0.42,
  });

  const resolved = resolvePeriodAuctionShare(RANGE, [otherWindow], []);

  // Overlapping is not the same as answering. Nothing is borrowed across
  // windows, because impression-share denominators do not add up that way.
  assert.equal(resolved.aggregationBasis, "unavailable");
  assert.equal(resolved.lostToRankRatio, null);
});

test("a campaign-scope row never stands in for the account roll-up", () => {
  const campaignOnly = periodRow({ scope: "campaign", campaignKey: "1234" });
  const resolved = resolvePeriodAuctionShare(RANGE, [campaignOnly], []);

  assert.equal(resolved.aggregationBasis, "unavailable");
});

test("Google's masked tail is carried as a mask rather than read as a measurement", () => {
  const masked = periodRow({
    searchRankLostImpressionShare: IMPRESSION_SHARE_MASK_FLOOR,
    searchBudgetLostImpressionShare: 0.33,
  });
  const resolved = resolvePeriodAuctionShare(RANGE, [masked], []);

  assert.equal(resolved.rankIsMasked, true);
  assert.equal(resolved.budgetIsMasked, false);
});

test("the masked-day count travels with a derived figure", () => {
  const daily: DailyShareInput[] = [
    {
      impressions: 400,
      searchRankLostImpressionShare: IMPRESSION_SHARE_MASK_FLOOR,
      searchBudgetLostImpressionShare: IMPRESSION_SHARE_MASK_FLOOR,
    },
    {
      impressions: 600,
      searchRankLostImpressionShare: 0.8,
      searchBudgetLostImpressionShare: 0.3,
    },
  ];
  const resolved = resolvePeriodAuctionShare(RANGE, [], daily);

  // This is the number that justifies the whole grain: most Search days
  // can be masked on a small account, and a caller has to be able to see that
  // before deciding whether the estimate is worth showing at all.
  assert.equal(resolved.maskedDays, 1);
  assert.equal(resolved.consideredDays, 2);
});

test("days with no reported share produce no figure at all", () => {
  const daily: DailyShareInput[] = [
    {
      impressions: 900,
      searchRankLostImpressionShare: null,
      searchBudgetLostImpressionShare: null,
    },
  ];
  const resolved = resolvePeriodAuctionShare(RANGE, [], daily);

  assert.equal(resolved.aggregationBasis, "unavailable");
  assert.equal(resolved.lostToRankRatio, null);
  assert.equal(resolved.lostToBudgetRatio, null);
});

// -------------------------------------------------------------- 60-day window

test("the backfill offers a sixty-day window ending yesterday", () => {
  assert.equal(BACKFILL_LOOKBACKS["60d"], 60);

  const window = resolveBackfillWindow(
    "60d",
    "Europe/London",
    new Date("2026-09-16T00:30:00.000Z"),
  );

  assert.equal(window.end, "2026-09-15");
  assert.equal(window.start, "2026-07-18");

  const days =
    (Date.parse(window.end + "T00:00:00Z") - Date.parse(window.start + "T00:00:00Z")) /
      86_400_000 +
    1;
  assert.equal(days, 60);
});

// ------------------------------------------------- store analytics live read

test("the store analytics route reads GA4 live and still fails soft", async () => {
  const source = await readFile(
    new URL("../src/app/api/store-analytics/route.ts", import.meta.url),
    "utf8",
  );

  // The live read exists at all, which is what the page had and the refresh
  // endpoint did not.
  assert.match(source, /readGa4DailyMetrics\(/);
  assert.match(source, /applyGa4Hydration\(/);
  // Both gates, not one: storage says rows have a durable home, and a Supabase
  // session is what RLS scopes the read to.
  assert.match(source, /configuration\.storage !== "supabase"/);
  assert.match(source, /auth\.mode !== "supabase"/);
  // A database that cannot be reached returns fixtures, never a broken page.
  // Every synthetic answer now goes through one helper so each one carries the
  // reason it is synthetic; the fallback itself is unchanged.
  assert.match(source, /const synthetic = \(reason: string\) =>/);
  assert.match(source, /privateJson\(\{ \.\.\.syntheticSnapshot, modeStatus:/);
  assert.match(source, /catch \{\s*return synthetic\(/);
});

test("the backfill script writes only to this project's own tables", async () => {
  const source = await readFile(
    new URL("../scripts/ingestion/backfill-live-window.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /persistLiveSync\(/);
  assert.match(source, /persistGa4Sync\(/);
  // An unattended run must not borrow an operator's identity on the audit trail.
  assert.match(source, /requestedBy: null/);
  // The same fixed allowlist the API route enforces.
  assert.match(source, /isBackfillLookback\(/);
});

// --------------------------------------- measured impression share from rows

function campaignPeriodRow(
  overrides: Partial<StoredImpressionSharePeriodRow> = {},
): StoredImpressionSharePeriodRow {
  return {
    rangeStart: RANGE.start,
    rangeEnd: RANGE.end,
    scope: "campaign",
    campaignKey: "111",
    impressions: 1_000,
    searchImpressionShare: 0.42,
    searchBudgetLostImpressionShare: 0.31,
    searchRankLostImpressionShare: 0.27,
    ...overrides,
  };
}

test("a period-exact row builds a measured impression share report", () => {
  const report = buildImpressionShareReportFromRows({
    range: RANGE,
    periodRows: [
      campaignPeriodRow({ scope: "account", campaignKey: "" }),
      campaignPeriodRow({ campaignKey: "111" }),
      campaignPeriodRow({
        campaignKey: "222",
        searchImpressionShare: 0.2,
        searchBudgetLostImpressionShare: 0.6,
        searchRankLostImpressionShare: 0.2,
      }),
    ],
    campaignNames: new Map([
      ["111", "KSN | Search | Brand"],
      ["222", "KSN | PMax | Winning Families"],
    ]),
    campaignSpend: new Map([["111", 80], ["222", 20]]),
  });

  assert.ok(report, "an exact window must produce a report");
  assert.equal(report?.basis, "measured");
  // Campaign names come from ad_campaigns, not from the share row.
  assert.deepEqual(
    report?.rows.map((row) => row.campaign),
    ["KSN | Search | Brand", "KSN | PMax | Winning Families"],
  );

  // Budget dominates here, and that is the lever the read-out must name: the
  // auction is winnable and the cap is the constraint.
  assert.equal(report?.dominantLoss, "budget");
  assert.match(report?.dominantLossMessage ?? "", /cap is the constraint/);
});

test("tiers nobody asked Google about are not reported as masked", () => {
  const report = buildImpressionShareReportFromRows({
    range: RANGE,
    periodRows: [campaignPeriodRow({ scope: "account", campaignKey: "" }), campaignPeriodRow()],
  });

  const row = report?.rows[0];
  assert.equal(row?.tiers.overall.ingested, true);
  assert.equal(row?.tiers.top.ingested, false);
  assert.equal(row?.tiers.absoluteTop.ingested, false);
  // Masked means Google answered and withheld the number. Not ingested means
  // nobody asked. Conflating them would claim Google hid something it was
  // never asked for, and would inflate the masked-campaign count.
  assert.equal(row?.tiers.top.share.masked, false);

  const top = report?.tiers.find((tier) => tier.key === "top");
  assert.equal(top?.reportedCampaigns, 0);
  assert.equal(top?.maskedCampaigns, 0);
  assert.equal(top?.averageShare, null);
});

test("a window Google was never asked about yields no measured report", () => {
  // The reader picked a period with no stored answer. Falling back is the
  // caller's job; deriving one from masked daily rows is what this avoids.
  assert.equal(
    buildImpressionShareReportFromRows({
      range: { start: "2026-01-01", end: "2026-01-31" },
      periodRows: [campaignPeriodRow()],
    }),
    null,
  );

  // An account row on its own is not enough: the panel is a per-campaign table.
  assert.equal(
    buildImpressionShareReportFromRows({
      range: RANGE,
      periodRows: [campaignPeriodRow({ scope: "account", campaignKey: "" })],
    }),
    null,
  );
});
