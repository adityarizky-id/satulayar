import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGoogleAudienceAnalysis,
  buildGoogleAudienceAnalysisFromRows,
  SEGMENT_TYPE_LABELS,
  type StoredGoogleAudienceRow,
} from "../src/lib/dashboard/audience-google";
import {
  buildDashboardSnapshot,
  buildDashboardSnapshotFromRows,
} from "../src/lib/dashboard/fixtures";

const RANGE = { start: "2026-07-01", end: "2026-07-14" };

function analysis(
  overrides: Partial<Parameters<typeof buildGoogleAudienceAnalysis>[0]> = {},
) {
  return buildGoogleAudienceAnalysis({
    range: RANGE,
    currency: "GBP",
    googleSpend: 1_000,
    googleImpressions: 100_000,
    googleClicks: 4_000,
    googlePurchases: 100,
    googleRegistrations: 400,
    googlePurchaseValue: 5_000,
    ...overrides,
  });
}

test("age, gender, and segment shares each sum to one and preserve spend", () => {
  const report = analysis();

  for (const rows of [report.ageRows, report.genderRows, report.segments]) {
    const shareSum = rows.reduce((total, row) => total + row.spendShare, 0);
    const spendSum = rows.reduce((total, row) => total + row.spend, 0);
    assert.equal(Math.abs(shareSum - 1) < 0.001, true);
    assert.equal(Math.abs(spendSum - 1_000) < 1, true);
  }
  assert.equal(report.segments.length, Object.keys(SEGMENT_TYPE_LABELS).length);
});

test("age and gender are reported as two separate lists, not one crossed grid", () => {
  const report = analysis();

  assert.equal(report.ageRows.length, 7);
  assert.equal(report.genderRows.length, 3);
});

test("unknown age and gender carry real spend and are never silently dropped", () => {
  const report = analysis();
  const unknownAge = report.ageRows.find((row) => row.isUnknown);
  const unknownGender = report.genderRows.find((row) => row.isUnknown);

  assert.ok(unknownAge);
  assert.ok(unknownGender);
  assert.ok(unknownAge!.spend > 0);
  assert.ok(unknownGender!.spend > 0);
  assert.equal(report.unknownAgeShare, unknownAge!.spendShare);
  assert.equal(report.unknownGenderShare, unknownGender!.spendShare);
  assert.match(report.safeMessage, /not a tracking gap/i);
});

test("a scope with no orders reports no revenue and no cost per order anywhere", () => {
  const report = analysis({
    googlePurchases: 0,
    googleRegistrations: 0,
    googlePurchaseValue: 0,
  });

  for (const row of [...report.ageRows, ...report.genderRows, ...report.segments]) {
    assert.equal(row.purchaseValue, 0);
    assert.equal(row.costPerPurchase, null);
  }
  assert.match(report.safeMessage, /no google purchases/i);
});

test("remarketing runs cheaper per order than affinity, matching the shape", () => {
  const report = analysis();
  const affinity = report.segments.find((row) => row.key === "affinity");
  const remarketing = report.segments.find((row) => row.key === "remarketing");

  assert.equal(
    (remarketing?.costPerPurchase ?? Infinity) < (affinity?.costPerPurchase ?? 0),
    true,
  );
});

test("the audience segment cut disappears when Meta is filtered alone", () => {
  assert.equal(buildDashboardSnapshot(RANGE, "meta").audienceSegments, null);
  assert.notEqual(buildDashboardSnapshot(RANGE, "google").audienceSegments, null);
  assert.notEqual(buildDashboardSnapshot(RANGE, "all").audienceSegments, null);
});

const LIVE_ROW: StoredGoogleAudienceRow = {
  date: "2026-07-01",
  campaignKey: "campaign-1",
  adGroupKey: "ad-group-1",
  criterionId: "criterion-1",
  criterionType: "USER_LIST",
  displayName: "Past purchasers",
  currency: "GBP",
  spend: 20,
  impressions: 1_000,
  clicks: 50,
  registrations: 4,
  purchases: 2,
  orderConversionValue: 100,
  conversionActionFiltered: true,
  isProvisional: false,
};

test("live audience rows aggregate the same criterion without inventing demographics", () => {
  const report = buildGoogleAudienceAnalysisFromRows({
    rows: [
      LIVE_ROW,
      {
        ...LIVE_ROW,
        adGroupKey: "ad-group-2",
        spend: 10,
        impressions: 500,
        clicks: 25,
        registrations: 2,
        purchases: 1,
        orderConversionValue: 50,
      },
    ],
    range: RANGE,
    currency: "GBP",
  });

  assert.ok(report);
  assert.equal(report.source, "measured");
  assert.deepEqual(report.ageRows, []);
  assert.deepEqual(report.genderRows, []);
  assert.equal(report.segments.length, 1);
  assert.equal(report.segments[0].label, "Past purchasers");
  assert.equal(report.segments[0].spend, 30);
  assert.equal(report.segments[0].purchases, 3);
  assert.match(report.safeMessage, /do not add them to account totals/i);
});

test("an incomplete or unfiltered conversion pull leaves audience pending", () => {
  assert.equal(
    buildGoogleAudienceAnalysisFromRows({
      rows: [{ ...LIVE_ROW, purchases: null }],
      range: RANGE,
      currency: "GBP",
    }),
    null,
  );
  assert.equal(
    buildGoogleAudienceAnalysisFromRows({
      rows: [{ ...LIVE_ROW, conversionActionFiltered: false }],
      range: RANGE,
      currency: "GBP",
    }),
    null,
  );
});

test("measured audience rows clear pending only for Google-capable views", () => {
  const google = buildDashboardSnapshotFromRows([], RANGE, "google", {
    account: {
      id: "kopi-senja",
      name: "Kopi Senja Nusantara",
      currency: "GBP",
      timezone: "Europe/London",
    },
    mode: "live",
    storage: "supabase",
    audienceRows: [LIVE_ROW],
  });
  const meta = buildDashboardSnapshotFromRows([], RANGE, "meta", {
    account: google.account,
    mode: "live",
    storage: "supabase",
    audienceRows: [LIVE_ROW],
  });

  assert.equal(google.audienceSegments?.source, "measured");
  assert.equal(
    google.pendingPanels.some((panel) => panel.key === "audience-segments"),
    false,
  );
  assert.equal(meta.audienceSegments, null);
});
