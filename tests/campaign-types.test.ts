import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CampaignTypeSection } from "../src/components/campaigns/campaign-type-section";
import { buildCampaignTypeAdvisory } from "../src/lib/dashboard/campaign-advisory";
import {
  buildAdGroups,
  buildCampaignTypeAnalysis,
  buildCampaignTypeAnalysisFromRows,
  CAMPAIGN_TYPES,
  isDirectResponseRole,
  type CampaignAttribute,
  type CampaignEntityMetric,
} from "../src/lib/dashboard/campaign-types";
import { DEFAULT_TARGETS } from "../src/lib/dashboard/targets";
import type { DailyMetric } from "../src/lib/dashboard/types";

const RANGE = { start: "2026-07-01", end: "2026-07-14" };

function analysis(overrides: Partial<Parameters<typeof buildCampaignTypeAnalysis>[0]> = {}) {
  return buildCampaignTypeAnalysis({
    range: RANGE,
    currency: "GBP",
    accountSlug: "kopi-senja",
    googleSpend: 6_000,
    googleImpressions: 400_000,
    googleClicks: 9_000,
    googlePurchases: 220,
    googleRegistrations: 700,
    googlePurchaseValue: 12_000,
    ...overrides,
  });
}

test("every campaign type carries the role it plays", () => {
  const report = analysis();

  assert.equal(report.rows.length, CAMPAIGN_TYPES.length);
  for (const row of report.rows) {
    const definition = CAMPAIGN_TYPES.find((item) => item.key === row.key);
    assert.equal(row.role, definition?.role);
    assert.equal(row.judgedOnCostPerOrder, isDirectResponseRole(row.role));
  }
});

test("demand creation is never judged against the order target", () => {
  const report = analysis();
  const display = report.rows.find((row) => row.key === "display");
  const nonBrand = report.rows.find((row) => row.key === "searchNonBrand");

  assert.equal(display?.judgedOnCostPerOrder, false);
  assert.equal(nonBrand?.judgedOnCostPerOrder, true);

  const brief = buildCampaignTypeAdvisory(report, DEFAULT_TARGETS);
  const namesDisplayAsOverTarget = brief.observations.some(
    (item) => item.id === "type-over-display",
  );
  assert.equal(namesDisplayAsOverTarget, false);
});

test("no recommendation tells the reader to pause without a historical check", () => {
  const brief = buildCampaignTypeAdvisory(analysis(), DEFAULT_TARGETS);

  for (const action of brief.actions) {
    assert.equal(
      /\bpause\b/i.test(action.action) &&
        !/historical|last year|prior year/i.test(action.action),
      false,
      `"${action.action}" recommends a pause with no historical-role check`,
    );
  }

  const assisted = brief.actions.find((item) => item.id === "assisted-roles-action");
  assert.match(assisted?.action ?? "", /historical-role check/i);
});

test("shares add up and orders follow the cost index, not the spend", () => {
  const report = analysis();
  const spendShare = report.rows.reduce((total, row) => total + row.spendShare, 0);
  const purchaseShare = report.rows.reduce(
    (total, row) => total + row.purchaseShare,
    0,
  );

  assert.ok(Math.abs(spendShare - 1) < 0.001);
  assert.ok(Math.abs(purchaseShare - 1) < 0.001);

  // Brand search has the lowest cost index, so it must buy orders more
  // cheaply than non-brand even though it spends less.
  const brand = report.rows.find((row) => row.key === "searchBrand");
  const nonBrand = report.rows.find((row) => row.key === "searchNonBrand");
  assert.ok((brand?.costPerPurchase ?? 0) < (nonBrand?.costPerPurchase ?? 0));
});

test("ad groups split their type and vary either side of it", () => {
  const report = analysis();
  const type = report.rows.find((row) => row.key === "searchNonBrand");
  assert.ok(type);

  const groups = buildAdGroups(type, "kopi-senja", RANGE);
  const spend = groups.reduce((total, row) => total + row.spend, 0);

  assert.ok(groups.length > 1);
  // The split is a partition of the type's spend, not an invention.
  assert.ok(Math.abs(spend - type.spend) < 1);

  const costs = groups
    .map((row) => row.costPerPurchase)
    .filter((value): value is number => value !== null);
  assert.ok(
    Math.max(...costs) > Math.min(...costs),
    "ad groups inside a type should not all cost the same",
  );
});

test("an empty Google account produces no verdict at all", () => {
  const report = analysis({
    googleSpend: 0,
    googleClicks: 0,
    googleImpressions: 0,
    googlePurchases: 0,
    googleRegistrations: 0,
    googlePurchaseValue: 0,
  });

  assert.match(report.safeMessage, /No Google spend/);
  assert.equal(report.totals.spend, 0);
});

// ---------------------------------------------------------------------------
// Live path: the table built from campaign rows Google actually returned.
// ---------------------------------------------------------------------------

function campaignRow(
  date: string,
  entityKey: string,
  entityName: string,
  overrides: Partial<DailyMetric> = {},
): DailyMetric {
  return {
    date,
    clientId: "demo",
    accountId: "demo",
    platform: "google",
    currency: "GBP",
    accountTimezone: "Europe/London",
    spend: 10,
    impressions: 500,
    clicks: 20,
    landingPageViews: 0,
    registrations: 1,
    purchases: 0,
    platformConversionValue: 0,
    actualPurchaseRevenue: 0,
    sourceConnector: "google-direct-api",
    sourceQueryVersion: "google-ads-api-v23",
    syncedAt: "2026-09-15T00:00:00.000Z",
    isProvisional: false,
    entityLevel: "campaign",
    entityKey,
    entityName,
    ...overrides,
  };
}

const LIVE_RANGE = { start: "2026-08-24", end: "2026-09-14" };

// Mirrors the three campaigns the Kopi Senja Nusantara account actually runs.
const LIVE_CAMPAIGN_ROWS: DailyMetric[] = [
  campaignRow("2026-09-01", "20000000001", "KSN | SEARCH | WHOLESALE", { spend: 40 }),
  campaignRow("2026-09-02", "20000000001", "KSN | SEARCH | WHOLESALE", { spend: 36.39 }),
  campaignRow("2026-09-01", "20000000002", "KSN | Win Back", { spend: 24.9, purchases: 1, actualPurchaseRevenue: 36 }),
  campaignRow("2026-09-01", "20000000003", "* | REM | CONVERSION", { spend: 11.08 }),
];

const LIVE_ATTRIBUTES: CampaignAttribute[] = [
  { campaignKey: "20000000001", campaignName: "KSN | SEARCH | WHOLESALE", channelType: "SEARCH", channelSubType: null, status: "ENABLED" },
  { campaignKey: "20000000002", campaignName: "KSN | Win Back", channelType: "PERFORMANCE_MAX", channelSubType: null, status: "ENABLED" },
  { campaignKey: "20000000003", campaignName: "* | REM | CONVERSION", channelType: "DISPLAY", channelSubType: null, status: "PAUSED" },
];

const LIVE_ENTITY_ROWS: CampaignEntityMetric[] = [
  {
    date: "2026-09-01",
    entityLevel: "ad_group",
    campaignKey: "20000000001",
    entityKey: "search-wholesale",
    entityName: "Wholesale core",
    status: "ENABLED",
    spend: 40,
    impressions: 500,
    clicks: 20,
    registrations: 2,
    purchases: 1,
    orderConversionValue: 80,
    conversionActionFiltered: true,
  },
  {
    date: "2026-09-01",
    entityLevel: "asset_group",
    campaignKey: "20000000002",
    entityKey: "win-back-assets",
    entityName: "Win back catalogue",
    status: "ENABLED",
    spend: 24.9,
    impressions: 800,
    clicks: 14,
    registrations: 1,
    purchases: 1,
    orderConversionValue: 36,
    conversionActionFiltered: false,
  },
];

test("the live table groups real campaigns by the channel type Google reported", () => {
  const analysis = buildCampaignTypeAnalysisFromRows({
    rows: LIVE_CAMPAIGN_ROWS,
    attributes: LIVE_ATTRIBUTES,
    range: LIVE_RANGE,
    currency: "GBP",
  });

  assert.ok(analysis);
  assert.equal(analysis.dataOrigin, "platform");
  // Three channel types, not the seven of the generated shape.
  assert.equal(analysis.rows.length, 3);

  const search = analysis.rows.find((row) => row.channelType === "SEARCH");
  assert.ok(search);
  // Spend is the sum of that campaign's days, never a share of the account.
  assert.equal(search.spend, 76.39);
  assert.equal(search.campaigns, 1);
  // Brand and non-brand are not separated, so the label must not claim it.
  assert.equal(search.label, "Search");
});

test("the live table reconciles to the campaign spend it was given", () => {
  const analysis = buildCampaignTypeAnalysisFromRows({
    rows: LIVE_CAMPAIGN_ROWS,
    attributes: LIVE_ATTRIBUTES,
    range: LIVE_RANGE,
    currency: "GBP",
  });

  assert.ok(analysis);
  const expected = LIVE_CAMPAIGN_ROWS.reduce((total, row) => total + row.spend, 0);
  assert.equal(analysis.totals.spend, Number(expected.toFixed(2)));
  // Rounded before comparing: each row is already rounded to the penny, so
  // adding them back up reintroduces binary float noise, not a real gap.
  assert.equal(
    Number(analysis.rows.reduce((total, row) => total + row.spend, 0).toFixed(2)),
    Number(expected.toFixed(2)),
  );
});

test("a campaign type the map does not know keeps its spend instead of losing it", () => {
  const analysis = buildCampaignTypeAnalysisFromRows({
    rows: [...LIVE_CAMPAIGN_ROWS, campaignRow("2026-09-03", "999", "Local test", { spend: 5 })],
    attributes: [
      ...LIVE_ATTRIBUTES,
      { campaignKey: "999", campaignName: "Local test", channelType: "LOCAL_SERVICES", channelSubType: null, status: "ENABLED" },
    ],
    range: LIVE_RANGE,
    currency: "GBP",
  });

  assert.ok(analysis);
  const other = analysis.rows.find((row) => row.key === "other");
  assert.ok(other, "an unmapped channel type must still appear");
  assert.equal(other.spend, 5);
  // Unknown roles are never judged against the cost-per-order target.
  assert.equal(other.judgedOnCostPerOrder, false);
  assert.match(analysis.safeMessage, /does not map yet/);
});

test("the live drill-down carries real campaign names, never generated ones", () => {
  const analysis = buildCampaignTypeAnalysisFromRows({
    rows: LIVE_CAMPAIGN_ROWS,
    attributes: LIVE_ATTRIBUTES,
    range: LIVE_RANGE,
    currency: "GBP",
  });

  assert.ok(analysis);
  for (const row of analysis.rows) {
    assert.ok(row.campaignRows, `${row.key} must carry its real campaigns`);
    for (const campaign of row.campaignRows) {
      assert.ok(LIVE_ATTRIBUTES.some((item) => item.campaignKey === campaign.id));
      // Ad group grain is not ingested, so nothing may be invented for it.
      assert.deepEqual(campaign.adGroups, []);
    }
  }

  const display = analysis.rows.find((row) => row.channelType === "DISPLAY");
  assert.equal(display?.campaignRows?.[0]?.status, "paused");
});

test("campaign overview presents the hierarchy as a scoped rail", () => {
  const report = analysis();
  const markup = renderToStaticMarkup(
    createElement(CampaignTypeSection, {
      accountSlug: "kopi-senja",
      analysis: report,
      comparisonEnabled: true,
      comparisonLabel: "Previous period",
      currency: "GBP",
      selectedPlatform: "google",
      targets: DEFAULT_TARGETS,
    }),
  );

  assert.match(markup, /class="campaign-section-heading"/);
  assert.match(markup, /class="campaign-scope-rail"/);
  assert.match(markup, />Campaigns</);
  assert.match(markup, />Ad \/ asset groups</);
  assert.match(markup, />Previous period</);
  assert.doesNotMatch(markup, /campaign-context-strip/);
});

test("live ad groups and Performance Max asset groups attach to their real campaign", () => {
  const report = buildCampaignTypeAnalysisFromRows({
    rows: LIVE_CAMPAIGN_ROWS,
    attributes: LIVE_ATTRIBUTES,
    entityRows: LIVE_ENTITY_ROWS,
    range: LIVE_RANGE,
    currency: "GBP",
  });

  assert.ok(report);
  const search = report.rows.find((row) => row.channelType === "SEARCH");
  const performanceMax = report.rows.find(
    (row) => row.channelType === "PERFORMANCE_MAX",
  );
  assert.equal(search?.campaignRows?.[0]?.adGroups[0]?.entityLevel, "ad_group");
  assert.equal(
    performanceMax?.campaignRows?.[0]?.adGroups[0]?.entityLevel,
    "asset_group",
  );
  assert.equal(
    performanceMax?.campaignRows?.[0]?.adGroups[0]?.conversionBasis,
    "google-total",
  );
  assert.match(report.safeMessage, /1 ad group\(s\) and 1 Performance Max asset group/);
});

test("campaign, type and group comparisons use the selected baseline rows", () => {
  const previousCampaignRows = LIVE_CAMPAIGN_ROWS.map((row) => ({
    ...row,
    date: row.date.replace("2026-09", "2026-08"),
    spend: row.spend / 2,
    purchases: row.purchases / 2,
    actualPurchaseRevenue: row.actualPurchaseRevenue / 2,
  }));
  const previousEntityRows = LIVE_ENTITY_ROWS.map((row) => ({
    ...row,
    date: "2026-08-01",
    spend: row.spend / 2,
    purchases: (row.purchases ?? 0) / 2,
    orderConversionValue: (row.orderConversionValue ?? 0) / 2,
  }));
  const report = buildCampaignTypeAnalysisFromRows({
    rows: LIVE_CAMPAIGN_ROWS,
    comparisonRows: previousCampaignRows,
    attributes: LIVE_ATTRIBUTES,
    entityRows: LIVE_ENTITY_ROWS,
    comparisonEntityRows: previousEntityRows,
    range: LIVE_RANGE,
    comparisonRange: { start: "2026-08-02", end: "2026-08-23" },
    currency: "GBP",
  });

  assert.ok(report?.comparisonRange);
  const search = report.rows.find((row) => row.channelType === "SEARCH");
  assert.equal(search?.previous?.spend, 38.2);
  assert.equal(search?.campaignRows?.[0]?.previous?.spend, 38.2);
  assert.equal(search?.campaignRows?.[0]?.adGroups[0]?.previous?.spend, 20);
});

test("no campaign rows means no live table, so the placeholder stays", () => {
  assert.equal(
    buildCampaignTypeAnalysisFromRows({
      rows: [],
      attributes: LIVE_ATTRIBUTES,
      range: LIVE_RANGE,
      currency: "GBP",
    }),
    null,
  );
});

test("campaign rows without stored attributes still report their spend", () => {
  const analysis = buildCampaignTypeAnalysisFromRows({
    rows: LIVE_CAMPAIGN_ROWS,
    attributes: [],
    range: LIVE_RANGE,
    currency: "GBP",
  });

  assert.ok(analysis);
  assert.equal(analysis.rows.length, 1);
  assert.equal(analysis.rows[0]?.key, "other");
  assert.match(analysis.safeMessage, /No campaign attributes are stored yet/);
});
