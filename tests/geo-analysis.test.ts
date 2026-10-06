import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildGeoAnalysis,
  buildGeoAnalysisFromRows,
  type StoredGeoMetricRow,
} from "../src/lib/dashboard/geo/analysis";
import { buildDashboardSnapshotFromRows } from "../src/lib/dashboard/fixtures";
import {
  childLevel,
  createLiveGeoSourceUnavailable,
  GEO_LEVEL_ORDER,
  GOOGLE_GEO_SOURCE_CONTRACT,
  GOOGLE_TARGET_TYPE_TO_LEVEL,
  IGNORED_GOOGLE_TARGET_TYPES,
  levelLabel,
  parentLevel,
} from "../src/lib/dashboard/geo/contract";
import {
  availableLevels,
  createFixtureGeoSource,
} from "../src/lib/dashboard/geo/fixture-source";

const RANGE = { start: "2026-07-01", end: "2026-07-14" };

function storedGeoRow(
  overrides: Partial<StoredGeoMetricRow> = {},
): StoredGeoMetricRow {
  return {
    date: "2026-07-01",
    countryCriterionId: "2360",
    regionCriterionId: "21302",
    countryCode: "ID",
    regionName: "Jakarta",
    spend: 80,
    impressions: 8_000,
    clicks: 160,
    registrations: 12,
    purchases: 4,
    orderConversionValue: 320,
    ...overrides,
  };
}

function analysisFor(
  accountSlug: string,
  overrides: Partial<Parameters<typeof buildGeoAnalysis>[0]> = {},
) {
  return buildGeoAnalysis({
    source: createFixtureGeoSource(),
    accountSlug,
    range: RANGE,
    currency: "GBP",
    ...overrides,
  });
}

test("the hierarchy keeps six comparable depths", () => {
  assert.deepEqual(GEO_LEVEL_ORDER, [
    "country",
    "province",
    "county",
    "municipality",
    "city",
    "sublocality",
  ]);
  assert.equal(childLevel("city"), "sublocality");
  assert.equal(childLevel("sublocality"), null);
  assert.equal(parentLevel("province"), "country");
  assert.equal(parentLevel("country"), null);
});

test("Google target types map onto the depths, and targeting-only types are dropped", () => {
  assert.equal(GOOGLE_TARGET_TYPE_TO_LEVEL.Country, "country");
  assert.equal(GOOGLE_TARGET_TYPE_TO_LEVEL.Province, "province");
  assert.equal(GOOGLE_TARGET_TYPE_TO_LEVEL.Municipality, "municipality");
  assert.equal(GOOGLE_TARGET_TYPE_TO_LEVEL.Borough, "sublocality");

  // A postal code is a targeting object, not an administrative depth. Rolling
  // it up as geography would double count the city it sits inside.
  for (const ignored of IGNORED_GOOGLE_TARGET_TYPES) {
    assert.equal(ignored in GOOGLE_TARGET_TYPE_TO_LEVEL, false);
  }
});

test("the level filter is English everywhere, whatever the market", () => {
  const indonesia = analysisFor("batik-lestari");
  const malaysia = analysisFor("batik-lestari", { countryCode: "MY" });
  const singapore = analysisFor("kopi-senja", { countryCode: "SG" });

  // The interface never switches language on the reader.
  for (const analysis of [indonesia, malaysia, singapore]) {
    assert.deepEqual(
      analysis.levelOptions.map((option) => option.label),
      ["Region", "County", "Municipality", "City", "District"],
    );
  }
  assert.equal(levelLabel(indonesia.selectedCountry, "province"), "Region");
  assert.equal(levelLabel(singapore.selectedCountry, "country"), "Country");
});

test("the local word for a level is kept as context, not as the label", () => {
  const indonesia = analysisFor("batik-lestari");
  const malaysia = analysisFor("batik-lestari", { countryCode: "MY" });

  assert.equal(
    indonesia.levelOptions.find((option) => option.level === "province")
      ?.localName,
    "Provinsi",
  );
  assert.equal(
    malaysia.levelOptions.find((option) => option.level === "province")
      ?.localName,
    "Negeri",
  );
  // Where the local word already is the English one, no hint is shown.
  assert.equal(
    analysisFor("kopi-senja", { countryCode: "SG" }).levelOptions.find(
      (option) => option.level === "city",
    )?.localName,
    null,
  );
});

test("an account opens on its home market but keeps its secondary markets", () => {
  const kopiSenja = analysisFor("kopi-senja");
  const kriya = analysisFor("kriya-bali");

  assert.equal(kopiSenja.selectedCountry.code, "ID");
  assert.equal(kopiSenja.countries[0]?.isPrimary, true);
  assert.equal(kopiSenja.countries.length > 1, true);
  assert.equal(
    kopiSenja.countries.filter((country) => country.isPrimary).length,
    1,
  );
  assert.equal(kriya.selectedCountry.code, "ID");
  assert.deepEqual(
    kriya.countries.map((country) => country.code),
    ["ID", "SG"],
  );
});

test("the country itself is the scope, never a row inside itself", () => {
  const analysis = analysisFor("kopi-senja");

  assert.equal(analysis.selectedLevel, "province");
  assert.equal(
    analysis.levelOptions.some((option) => option.level === "country"),
    false,
  );
  assert.equal(
    analysis.rows.every((row) => row.target.level === "province"),
    true,
  );
});

test("drilling reads only the children of the region that was opened", () => {
  const top = analysisFor("kopi-senja");
  const jakarta = top.rows.find((row) => row.target.name === "Jakarta");

  assert.notEqual(jakarta, undefined);

  const drilled = analysisFor("kopi-senja", {
    level: "county",
    parentId: jakarta?.target.id,
  });

  assert.equal(
    drilled.rows.every((row) => row.target.parentId === jakarta?.target.id),
    true,
  );
  assert.equal(
    drilled.rows.some((row) => row.target.name === "Jakarta Selatan"),
    true,
  );
  // Bandung sits under a different province, so it must not appear here.
  assert.equal(
    drilled.rows.some((row) => row.target.name === "Bandung"),
    false,
  );
});

test("the breadcrumb walks real targets back to the country", () => {
  const top = analysisFor("kopi-senja");
  const jakarta = top.rows.find((row) => row.target.name === "Jakarta");
  const counties = analysisFor("kopi-senja", {
    level: "county",
    parentId: jakarta?.target.id,
  });
  const south = counties.rows.find(
    (row) => row.target.name === "Jakarta Selatan",
  );
  const districts = analysisFor("kopi-senja", {
    level: "municipality",
    parentId: south?.target.id,
  });

  assert.deepEqual(
    districts.breadcrumb.map((entry) => entry.name),
    ["Indonesia", "Jakarta", "Jakarta Selatan"],
  );
  assert.deepEqual(
    districts.breadcrumb.map((entry) => entry.levelLabel),
    ["Country", "Region", "County"],
  );
});

test("rows carry the four business figures and derive cost per order from them", () => {
  const analysis = analysisFor("kopi-senja");

  for (const row of analysis.rows) {
    assert.equal(Number.isFinite(row.spend), true);
    assert.equal(Number.isFinite(row.registrations), true);
    assert.equal(Number.isFinite(row.purchases), true);
    assert.equal(Number.isFinite(row.purchaseValue), true);

    if (row.purchases === 0) {
      assert.equal(row.costPerPurchase, null);
      continue;
    }
    assert.equal(
      Math.abs((row.costPerPurchase ?? 0) - row.spend / row.purchases) < 0.01,
      true,
    );
  }
});

test("spend share is a share of the level being read, and totals match the rows", () => {
  const analysis = analysisFor("kopi-senja");
  const shareSum = analysis.rows.reduce((total, row) => total + row.spendShare, 0);
  const spendSum = analysis.rows.reduce((total, row) => total + row.spend, 0);

  assert.equal(Math.abs(shareSum - 1) < 0.001, true);
  assert.equal(Math.abs(analysis.totals.spend - spendSum) < 0.05, true);
});

test("the same scope reads identically twice", () => {
  assert.deepEqual(analysisFor("kopi-senja").rows, analysisFor("kopi-senja").rows);
});

test("only levels a country actually reports are offered", () => {
  const levels = availableLevels("ID");

  assert.equal(levels.includes("sublocality"), true);
  assert.equal(availableLevels("XX").length, 0);
});

test("the live geo source is defined but fails closed until it is approved", () => {
  const live = createLiveGeoSourceUnavailable();

  assert.equal(live.sourceId, "google-ads");
  assert.throws(() => live.listCountries("kopi-senja"), /not activated/i);
  assert.match(GOOGLE_GEO_SOURCE_CONTRACT.hierarchyQuery, /geo_target_constant/);
  assert.match(
    GOOGLE_GEO_SOURCE_CONTRACT.performanceQuery,
    /user_location_view/,
  );
  // Cost arrives in micros; forgetting that inflates spend a million times.
  assert.equal(
    GOOGLE_GEO_SOURCE_CONTRACT.notes.some((note) => /micros/i.test(note)),
    true,
  );
});

test("the fixture source is labelled as synthetic wherever it is shown", () => {
  const analysis = analysisFor("kopi-senja");

  assert.equal(analysis.sourceId, "fixture");
  assert.match(analysis.safeMessage, /synthetic/i);
});

test("stored Google rows aggregate by real country and region without inventing deeper levels", () => {
  const analysis = buildGeoAnalysisFromRows({
    accountSlug: "kopi-senja",
    range: RANGE,
    comparisonRange: { start: "2026-06-17", end: "2026-06-30" },
    currency: "GBP",
    rows: [
      storedGeoRow(),
      storedGeoRow({
        regionCriterionId: "21303",
        regionName: "West Java",
        spend: 20,
        purchases: 1,
        orderConversionValue: 70,
      }),
      storedGeoRow({
        regionCriterionId: "",
        regionName: null,
        spend: 10,
        impressions: 500,
        clicks: 10,
        registrations: 0,
        purchases: 0,
        orderConversionValue: 0,
      }),
      storedGeoRow({
        countryCriterionId: "2458",
        countryCode: "MY",
        regionCriterionId: "21280",
        regionName: "Selangor",
        spend: 5,
      }),
    ],
    comparisonRows: [
      storedGeoRow({
        date: "2026-06-20",
        spend: 40,
        purchases: 4,
      }),
    ],
  });

  assert.ok(analysis);
  assert.equal(analysis.sourceId, "google-ads");
  assert.equal(analysis.selectedCountry.code, "ID");
  assert.deepEqual(analysis.levelOptions.map((item) => item.level), ["province"]);
  assert.equal(analysis.drillLevel, null);
  assert.equal(analysis.rows.length, 2);
  assert.equal(analysis.totals.spend, 100);
  assert.equal(analysis.unattributed?.spend, 10);
  assert.equal(
    analysis.rows.find((row) => row.target.name === "Jakarta")
      ?.previousCostPerPurchase,
    10,
  );
});

test("live geography stays pending until every conversion column is measured", () => {
  const metric = {
    date: "2026-07-01",
    clientId: "demo",
    accountId: "demo",
    platform: "google" as const,
    currency: "GBP" as const,
    accountTimezone: "Europe/London",
    spend: 100,
    impressions: 10_000,
    clicks: 200,
    landingPageViews: 160,
    registrations: 20,
    purchases: 5,
    platformConversionValue: 400,
    actualPurchaseRevenue: 300,
    sourceConnector: "google-direct-api" as const,
    sourceQueryVersion: "v1",
    syncedAt: "2026-07-02T00:00:00.000Z",
    isProvisional: false,
  };

  const withheld = buildDashboardSnapshotFromRows(
    [metric],
    RANGE,
    "google",
    {
      mode: "live",
      storage: "supabase",
      geoRows: [storedGeoRow({ purchases: null })],
      geo: { accountSlug: "kopi-senja" },
    },
  );
  assert.equal(withheld.geo, null);
  assert.ok(
    withheld.pendingPanels.some((panel) => panel.key === "geo-analysis"),
  );

  const hydrated = buildDashboardSnapshotFromRows(
    [metric],
    RANGE,
    "google",
    {
      mode: "live",
      storage: "supabase",
      geoRows: [storedGeoRow()],
      geo: { accountSlug: "kopi-senja" },
    },
  );
  assert.equal(hydrated.geo?.sourceId, "google-ads");
  assert.ok(
    !hydrated.pendingPanels.some((panel) => panel.key === "geo-analysis"),
  );
});

test("the Geography section is map-first and uses the full-width shading toolbar", async () => {
  const [component, css] = await Promise.all([
    readFile(
      new URL("../src/components/geo/geo-section.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../src/app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(component, /className="geo-shade-toggle"/);
  assert.match(component, /className="panel panel--geo-map"/);
  for (const removed of [
    "geo-attention",
    "geo-cards",
    "geo-table-heading",
    "geo-filter-chips",
    "Sort by",
    "Needs attention",
    "Working well",
  ]) {
    assert.equal(component.includes(removed), false, `${removed} must stay removed`);
  }
  assert.match(
    css,
    /\.geo-diagnostic,\s*\.panel--geo-map\s*\{[\s\S]*?width:\s*100%/,
  );
  assert.match(css, /\.geo-shade-toggle\s*\{[\s\S]*?width:\s*100%/);
});

test("the region shade ramp keeps readable contrast in dark mode", async () => {
  const [component, css] = await Promise.all([
    readFile(
      new URL("../src/components/geo/region-map.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../src/app/globals.css", import.meta.url), "utf8"),
  ]);

  // The shade travels as a custom property so the theme may transform it;
  // an inline `background` or SVG `fill` would override the dark-mode ramp.
  assert.match(component, /"--region-map-shade": shade\(item\)/);
  assert.doesNotMatch(component, /\{ background: shade\(item\) \}/);
  assert.doesNotMatch(component, /fill=\{item\.id === activeId/);
  assert.match(
    css,
    /html\[data-theme="dark"\] \.region-map__cell:not\(\.region-map__cell--active\)[\s\S]*?color:\s*var\(--text-primary\)[\s\S]*?color-mix/,
  );
  assert.match(
    css,
    /html\[data-theme="dark"\] \.region-map__cell--active\s*\{[\s\S]*?color:\s*#051e10[\s\S]*?background:\s*#35e27d/,
  );
});
