import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertSingleCurrency,
  mapStoredAudienceRow,
  mapStoredDeviceRow,
  mapStoredEntityRow,
  mapStoredGeoRow,
  readStoredEntityDaily,
} from "@/lib/supabase/server";

/**
 * The read side of the ad group, location and audience grains.
 *
 * Two rules carry the weight here. A conversion column is null whenever no
 * conversion query answered for that row, and a reader that folds null to 0
 * turns "not measured" into "nothing converted" — a claim the platform never
 * made. And one brand reads in one currency: more than one in a single
 * breakdown means rows from two accounts have reached the same panel.
 */

const ENTITY_ROW = {
  metric_date: "2026-09-01",
  entity_level: "ad_group" as const,
  campaign_key: "111",
  entity_key: "900",
  entity_name_snapshot: "Brand · exact",
  status: "ENABLED",
  currency: "GBP" as const,
  // PostgREST returns numeric columns as strings.
  spend: "7.50",
  impressions: "600",
  clicks: "30",
  registrations: "5",
  purchases: "2",
  order_conversion_value: "80",
  registration_lead_value: "15",
  conversion_action_filtered: true,
  is_provisional: false,
};

test("an unmeasured conversion survives the read as null, never as zero", () => {
  const measured = mapStoredEntityRow(ENTITY_ROW);
  assert.equal(measured.spend, 7.5);
  assert.equal(measured.purchases, 2);
  assert.equal(measured.registrations, 5);
  assert.equal(measured.orderConversionValue, 80);
  assert.equal(measured.registrationLeadValue, 15);

  const unmeasured = mapStoredEntityRow({
    ...ENTITY_ROW,
    registrations: null,
    purchases: null,
    order_conversion_value: null,
    registration_lead_value: null,
    conversion_action_filtered: false,
  });

  // Spend is always measured, so it stays a number; the conversion columns are
  // the ones a failed conversion pull leaves unanswered.
  assert.equal(unmeasured.spend, 7.5);
  assert.equal(unmeasured.purchases, null);
  assert.equal(unmeasured.registrations, null);
  assert.equal(unmeasured.orderConversionValue, null);
  assert.equal(unmeasured.registrationLeadValue, null);
});

test("the conversion basis travels with the row it describes", () => {
  const adGroup = mapStoredEntityRow(ENTITY_ROW);
  const assetGroup = mapStoredEntityRow({
    ...ENTITY_ROW,
    entity_level: "asset_group",
    entity_key: "700",
    conversion_action_filtered: false,
  });

  assert.equal(adGroup.entityLevel, "ad_group");
  assert.equal(adGroup.conversionActionFiltered, true);
  // A Performance Max asset group cannot be segmented by conversion action, so
  // its count is Google's own mixed total. Without this flag the two rows look
  // interchangeable in the same table.
  assert.equal(assetGroup.entityLevel, "asset_group");
  assert.equal(assetGroup.conversionActionFiltered, false);
  assert.equal(adGroup.campaignKey, "111");
});

test("a location with no region keeps the empty string the grain key needs", () => {
  const row = mapStoredGeoRow({
    metric_date: "2026-09-01",
    campaign_key: "111",
    country_criterion_id: "2372",
    region_criterion_id: "",
    country_code: "IE",
    region_name: null,
    currency: "EUR",
    spend: "2.50",
    impressions: "200",
    clicks: "10",
    registrations: null,
    purchases: null,
    order_conversion_value: null,
    conversion_action_filtered: false,
    is_provisional: false,
  });

  assert.equal(row.regionCriterionId, "");
  assert.equal(row.regionName, null);
  assert.equal(row.countryCode, "IE");
  assert.equal(row.purchases, null);
  assert.equal(row.spend, 2.5);
});

test("an audience segment keeps its ad group and an unnamed segment stays unnamed", () => {
  const row = mapStoredAudienceRow({
    metric_date: "2026-09-01",
    campaign_key: "111",
    ad_group_key: "900",
    criterion_id: "3001",
    criterion_type: "USER_LIST",
    display_name: null,
    currency: "GBP",
    spend: "3.00",
    impressions: "300",
    clicks: "15",
    registrations: "1",
    purchases: null,
    order_conversion_value: null,
    conversion_action_filtered: true,
    is_provisional: true,
  });

  // The grain is the segment in this ad group, not the segment: the ad group
  // key has to survive the read or two rows collapse into one.
  assert.equal(row.adGroupKey, "900");
  assert.equal(row.criterionId, "3001");
  assert.equal(row.displayName, null);
  assert.equal(row.registrations, 1);
  assert.equal(row.purchases, null);
  assert.equal(row.isProvisional, true);
});

test("a breakdown that mixes currencies is refused rather than summed", () => {
  assert.doesNotThrow(() => assertSingleCurrency([], "location rows"));
  assert.doesNotThrow(() => assertSingleCurrency(["EUR", "EUR"], "location rows"));
  assert.throws(
    () => assertSingleCurrency(["GBP", "EUR"], "location rows"),
    /location rows carry 2 different currencies/,
  );
});

test("a Meta-filtered view asks Google-only tables for nothing at all", async () => {
  // No Supabase client is constructed: the reader returns before it would need
  // one, so this asserts the early exit rather than a stubbed database.
  const rows = await readStoredEntityDaily(
    "client-id",
    { start: "2026-09-01", end: "2026-09-14" },
    "meta",
    "live",
  );
  assert.deepEqual(rows, []);
});

test("the diagnostic readers scope every query and leak no account identifier", async () => {
  const source = await readFile(
    new URL("../src/lib/supabase/server.ts", import.meta.url),
    "utf8",
  );

  for (const [reader, table] of [
    ["readStoredEntityDaily", "ad_entity_daily"],
    ["readStoredGeoDaily", "ad_geo_daily"],
    ["readStoredAudienceDaily", "ad_audience_daily"],
  ]) {
    const start = source.indexOf(`export async function ${reader}(`);
    assert.notEqual(start, -1, `${reader} is missing`);
    const body = source.slice(start, source.indexOf("\n}", start));

    assert.ok(body.includes(`.from("${table}")`), `${reader} reads the wrong table`);
    // RLS decides what the caller may see, so the read runs under their session
    // rather than the service role.
    assert.ok(body.includes("await createClient()"), `${reader} bypasses RLS`);
    assert.ok(body.includes('.eq("client_id", clientId)'), `${reader} is not brand-scoped`);
    assert.ok(body.includes('.eq("platform", "google")'), `${reader} is not platform-scoped`);
    assert.ok(body.includes('.gte("metric_date", range.start)'), `${reader} ignores the window`);
    assert.ok(body.includes('.lte("metric_date", range.end)'), `${reader} ignores the window`);
    // Mock and live rows share the tables; a reader that mixed them would show
    // fixture spend beside real spend with no way to tell them apart.
    assert.ok(body.includes('mode === "mock"'), `${reader} ignores the data mode`);
    // A platform account id must never reach the browser, and provenance holds
    // exactly that.
    assert.ok(!body.includes("account_id"), `${reader} selects account_id`);
    assert.ok(!body.includes("provenance"), `${reader} selects provenance`);
    assert.ok(body.includes("assertSingleCurrency"), `${reader} skips the currency guard`);
  }
});

test("the dashboard route serves the three grains beside the snapshot", async () => {
  const route = await readFile(
    new URL("../src/app/api/dashboard/route.ts", import.meta.url),
    "utf8",
  );

  for (const reader of [
    "readStoredEntityDaily",
    "readStoredGeoDaily",
    "readStoredAudienceDaily",
  ]) {
    assert.ok(route.includes(`${reader}(`), `${reader} is never called by the route`);
  }

  assert.match(route, /diagnostics: \{ entityRows, geoRows, audienceRows \}/);
  // Location and audience are Google cuts; under a Meta filter the route skips
  // the read rather than returning an empty section that looks like zero spend.
  assert.match(
    route,
    /platform === "meta"[\s\S]*?Promise\.all\([\s\S]*?enumerateDates\(range\.value\)[\s\S]*?readStoredGeoDaily/,
  );
  // The live table can exceed Supabase's default 1,000-row response cap for a
  // 14-day brand window, so the route must partition the read by date.
  assert.match(route, /\{ start: date, end: date \}/);
  assert.match(
    route,
    /platform === "meta"[\s\S]*?Promise\.all\([\s\S]*?enumerateDates\(range\.value\)[\s\S]*?readStoredAudienceDaily/,
  );
});

test("stored device row maps unmeasured conversions as null, never zero", () => {
  const measured = mapStoredDeviceRow({
    metric_date: "2026-09-01",
    device: "MOBILE",
    spend: "10.50",
    impressions: "500",
    clicks: "25",
    registrations: "3",
    purchases: "1",
    order_conversion_value: "45.00",
  });
  assert.equal(measured.spend, 10.5);
  assert.equal(measured.purchases, 1);
  assert.equal(measured.registrations, 3);
  assert.equal(measured.purchaseValue, 45);

  const unmeasured = mapStoredDeviceRow({
    metric_date: "2026-09-01",
    device: "DESKTOP",
    spend: "20.00",
    impressions: "800",
    clicks: "40",
    registrations: null,
    purchases: null,
    order_conversion_value: null,
  });
  assert.equal(unmeasured.spend, 20);
  assert.equal(unmeasured.purchases, null);
  assert.equal(unmeasured.registrations, null);
  assert.equal(unmeasured.purchaseValue, null);
});
