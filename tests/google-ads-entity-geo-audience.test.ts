import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { afterEach } from "node:test";

import { GoogleAdsApiClient } from "@/lib/connectors/google-ads-api-client";

/**
 * Ad group, asset group, location and audience ingestion.
 *
 * Every assertion here defends one of three rules the storage grain depends on:
 * a conversion column is null until a conversion query answered, an asset group
 * is never presented on the same basis as an ad group, and a brand is never
 * charged a query for a level it does not run.
 */

const BASE_CONFIG = {
  developerToken: "dev-token",
  clientId: "client-id",
  clientSecret: "client-secret",
  refreshToken: "refresh-token",
  customerId: "1234500001",
  loginCustomerId: "1234500099",
  registrationConversionActionId: "900000002",
  purchaseConversionActionId: "900000001",
  // The cuts under test, and nothing else: each disabled section is one less
  // mock branch that could mask a failure in the one being tested.
  includeCampaignBreakdown: true,
  includeSearchTerms: false,
  includeImpressionShare: false,
  includeDeviceBreakdown: false,
  includeEntityBreakdown: true,
  includeGeoBreakdown: true,
  includeAudienceBreakdown: true,
};

const RANGE = { start: "2026-09-01", end: "2026-09-01" };
const REQUEST = { clientId: "satulayar-demo", accountKey: "kopi-senja-usd", range: RANGE };

const CONVERSION_ACTIONS = [
  {
    conversionAction: {
      id: "900000002",
      name: "New Registration",
      category: "SIGNUP",
      type: "WEBPAGE",
      status: "ENABLED",
      includeInConversionsMetric: true,
    },
  },
  {
    conversionAction: {
      id: "900000001",
      name: "New Order",
      category: "PURCHASE",
      type: "WEBPAGE",
      status: "ENABLED",
      includeInConversionsMetric: true,
    },
  },
];

const ACCOUNT_ROWS = [
  {
    segments: { date: "2026-09-01" },
    customer: { currencyCode: "GBP", timeZone: "Etc/GMT" },
    metrics: { impressions: "1000", clicks: "50", costMicros: "12500000" },
  },
];

interface MockOptions {
  /** Campaign rows, which decide whether ad groups or asset groups are pulled. */
  campaigns?: unknown[];
  adGroupCore?: unknown[];
  adGroupConversions?: unknown[] | "fail";
  assetGroupCore?: unknown[];
  geoCore?: unknown[];
  geoConversions?: unknown[];
  geoConstants?: unknown[] | "fail";
  audienceCore?: unknown[];
  audienceConversions?: unknown[];
  /** Rejects any query that selects the audience display name. */
  rejectAudienceDisplayName?: boolean;
}

let queries: string[] = [];
let originalFetch: typeof fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const SEARCH_CAMPAIGN = {
  segments: { date: "2026-09-01" },
  campaign: {
    id: "111",
    name: "ID | Search | Brand",
    advertisingChannelType: "SEARCH",
    status: "ENABLED",
  },
  metrics: { impressions: "600", clicks: "30", costMicros: "7500000" },
};

const PMAX_CAMPAIGN = {
  segments: { date: "2026-09-01" },
  campaign: {
    id: "222",
    name: "ID | PMax | Core",
    advertisingChannelType: "PERFORMANCE_MAX",
    status: "ENABLED",
  },
  metrics: { impressions: "400", clicks: "20", costMicros: "5000000" },
};

function installFetchMock(options: MockOptions) {
  originalFetch = globalThis.fetch;
  queries = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("oauth2.googleapis.com")) {
      return jsonResponse({ access_token: "fake-access-token" });
    }

    let query = "";
    if (init?.body && typeof init.body === "string") {
      query = (JSON.parse(init.body) as { query?: string }).query ?? "";
    }
    queries.push(query);

    const isConversionQuery = query.includes("segments.conversion_action");

    if (query.includes("FROM conversion_action")) {
      return jsonResponse({ results: CONVERSION_ACTIONS });
    }
    if (query.includes("FROM ad_group_audience_view")) {
      if (options.rejectAudienceDisplayName && query.includes("ad_group_criterion.display_name")) {
        return jsonResponse(
          { error: { message: "Unrecognized field: ad_group_criterion.display_name" } },
          400,
        );
      }
      return jsonResponse({
        results: isConversionQuery
          ? (options.audienceConversions ?? [])
          : (options.audienceCore ?? []),
      });
    }
    if (query.includes("FROM ad_group ")) {
      if (isConversionQuery && options.adGroupConversions === "fail") {
        return jsonResponse({ error: { message: "Conversion segmentation unavailable" } }, 400);
      }
      return jsonResponse({
        results: isConversionQuery
          ? ((options.adGroupConversions as unknown[] | undefined) ?? [])
          : (options.adGroupCore ?? []),
      });
    }
    if (query.includes("FROM asset_group ")) {
      return jsonResponse({ results: options.assetGroupCore ?? [] });
    }
    if (query.includes("FROM user_location_view")) {
      return jsonResponse({
        results: isConversionQuery ? (options.geoConversions ?? []) : (options.geoCore ?? []),
      });
    }
    if (query.includes("FROM geo_target_constant")) {
      if (options.geoConstants === "fail") {
        return jsonResponse({ error: { message: "Lookup unavailable" } }, 400);
      }
      return jsonResponse({ results: (options.geoConstants as unknown[] | undefined) ?? [] });
    }
    if (query.includes("FROM campaign")) {
      return jsonResponse({
        results: isConversionQuery ? [] : (options.campaigns ?? [SEARCH_CAMPAIGN, PMAX_CAMPAIGN]),
      });
    }
    return jsonResponse({ results: isConversionQuery ? [] : ACCOUNT_ROWS });
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Queries actually issued against one resource, conversion pulls included. */
function queriesFor(resource: string): string[] {
  return queries.filter((query) => query.includes(`FROM ${resource}`));
}

// ------------------------------------------------------------- ad groups

test("ad group rows carry the parent campaign and conversions filtered to the mapped actions", async () => {
  installFetchMock({
    campaigns: [SEARCH_CAMPAIGN],
    adGroupCore: [
      {
        segments: { date: "2026-09-01" },
        campaign: { id: "111" },
        adGroup: { id: "900", name: "Brand · exact", status: "ENABLED" },
        metrics: { impressions: "600", clicks: "30", costMicros: "7500000" },
      },
    ],
    adGroupConversions: [
      {
        segments: {
          date: "2026-09-01",
          conversionAction: "customers/1234500001/conversionActions/900000001",
        },
        campaign: { id: "111" },
        adGroup: { id: "900" },
        metrics: { allConversions: "2", allConversionsValue: "80" },
      },
      {
        segments: {
          date: "2026-09-01",
          conversionAction: "customers/1234500001/conversionActions/900000002",
        },
        campaign: { id: "111" },
        adGroup: { id: "900" },
        metrics: { allConversions: "5", allConversionsValue: "15" },
      },
    ],
  });

  const result = await new GoogleAdsApiClient(BASE_CONFIG).fetchDailyMetrics(REQUEST);
  const rows = result.entityRows ?? [];

  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.entityLevel, "ad_group");
  assert.equal(row.campaignKey, "111");
  assert.equal(row.entityKey, "900");
  assert.equal(row.entityName, "Brand · exact");
  assert.equal(row.status, "ENABLED");
  assert.equal(row.spend, 7.5);
  assert.equal(row.purchases, 2);
  assert.equal(row.registrations, 5);
  // The two mapped actions keep their own value posts; one is not the other.
  assert.equal(row.orderConversionValue, 80);
  assert.equal(row.registrationLeadValue, 15);
  assert.equal(row.conversionActionFiltered, true);
});

test("an ad group whose conversion pull fails reports not measured, never zero", async () => {
  installFetchMock({
    campaigns: [SEARCH_CAMPAIGN],
    adGroupCore: [
      {
        segments: { date: "2026-09-01" },
        campaign: { id: "111" },
        adGroup: { id: "900", name: "Brand · exact", status: "ENABLED" },
        metrics: { impressions: "600", clicks: "30", costMicros: "7500000" },
      },
    ],
    adGroupConversions: "fail",
  });

  const result = await new GoogleAdsApiClient(BASE_CONFIG).fetchDailyMetrics(REQUEST);
  const row = (result.entityRows ?? [])[0];

  // Spend still landed: the cut is diagnostic, so it downgrades rather than
  // discarding the row. But a zero here would read as "nothing converted".
  assert.equal(row.spend, 7.5);
  assert.equal(row.purchases, null);
  assert.equal(row.registrations, null);
  assert.equal(row.orderConversionValue, null);
  assert.equal(row.registrationLeadValue, null);
  assert.equal(row.conversionActionFiltered, false);
  assert.ok(
    result.warnings.some((warning) =>
      warning.includes("Ad group conversions could not be pulled"),
    ),
  );
});

test("asset group rows are stored on Google's unfiltered basis and say so", async () => {
  installFetchMock({
    campaigns: [PMAX_CAMPAIGN],
    assetGroupCore: [
      {
        segments: { date: "2026-09-01" },
        campaign: { id: "222" },
        assetGroup: { id: "700", name: "Core catalogue", status: "ENABLED" },
        metrics: {
          impressions: "400",
          clicks: "20",
          costMicros: "5000000",
          conversions: "3",
          conversionsValue: "120",
        },
      },
    ],
  });

  const result = await new GoogleAdsApiClient(BASE_CONFIG).fetchDailyMetrics(REQUEST);
  const row = (result.entityRows ?? [])[0];

  assert.equal(row.entityLevel, "asset_group");
  assert.equal(row.purchases, 3);
  assert.equal(row.orderConversionValue, 120);
  // Google will not segment an asset group by conversion action, so there is no
  // registration figure to report and the basis flag must stay false.
  assert.equal(row.registrations, null);
  assert.equal(row.registrationLeadValue, null);
  assert.equal(row.conversionActionFiltered, false);
  assert.equal(queriesFor("asset_group").some((q) => q.includes("segments.conversion_action")), false);
  assert.ok(
    result.warnings.some((warning) =>
      warning.includes("asset group conversions are Google's own total"),
    ),
  );
});

test("a brand pays for no query at a level it does not run", async () => {
  installFetchMock({ campaigns: [PMAX_CAMPAIGN], assetGroupCore: [] });
  await new GoogleAdsApiClient(BASE_CONFIG).fetchDailyMetrics(REQUEST);
  assert.equal(queriesFor("ad_group ").length, 0);
  assert.ok(queriesFor("asset_group ").length > 0);

  installFetchMock({ campaigns: [SEARCH_CAMPAIGN], adGroupCore: [] });
  await new GoogleAdsApiClient(BASE_CONFIG).fetchDailyMetrics(REQUEST);
  assert.equal(queriesFor("asset_group ").length, 0);
  assert.ok(queriesFor("ad_group ").length > 0);
});

// ------------------------------------------------------------- locations

test("location rows keep an absent region as an empty string and resolve their names", async () => {
  installFetchMock({
    campaigns: [SEARCH_CAMPAIGN],
    geoCore: [
      {
        segments: { date: "2026-09-01", geoTargetRegion: "geoTargetConstants/20339" },
        campaign: { id: "111" },
        userLocationView: { countryCriterionId: "2826" },
        metrics: { impressions: "400", clicks: "20", costMicros: "5000000" },
      },
      {
        segments: { date: "2026-09-01" },
        campaign: { id: "111" },
        userLocationView: { countryCriterionId: "2372" },
        metrics: { impressions: "200", clicks: "10", costMicros: "2500000" },
      },
    ],
    geoConstants: [
      { geoTargetConstant: { id: "2826", name: "United Kingdom", countryCode: "GB" } },
      { geoTargetConstant: { id: "20339", name: "England", countryCode: "GB" } },
      { geoTargetConstant: { id: "2372", name: "Ireland", countryCode: "IE" } },
    ],
  });

  const result = await new GoogleAdsApiClient(BASE_CONFIG).fetchDailyMetrics(REQUEST);
  const rows = result.geoRows ?? [];
  assert.equal(rows.length, 2);

  const withRegion = rows.find((row) => row.countryCriterionId === "2826");
  assert.ok(withRegion);
  assert.equal(withRegion.regionCriterionId, "20339");
  assert.equal(withRegion.countryCode, "GB");
  assert.equal(withRegion.regionName, "England");

  const countryOnly = rows.find((row) => row.countryCriterionId === "2372");
  assert.ok(countryOnly);
  // "No region" is a real answer, and the storage grain has no null to put it
  // in: the unique key would stop deduplicating if it did.
  assert.equal(countryOnly.regionCriterionId, "");
  assert.equal(countryOnly.regionName, null);
  assert.equal(countryOnly.countryCode, "IE");
});

test("a failed geo name lookup leaves names null and keeps the spend rows", async () => {
  installFetchMock({
    campaigns: [SEARCH_CAMPAIGN],
    geoCore: [
      {
        segments: { date: "2026-09-01" },
        campaign: { id: "111" },
        userLocationView: { countryCriterionId: "2826" },
        metrics: { impressions: "400", clicks: "20", costMicros: "5000000" },
      },
    ],
    geoConstants: "fail",
  });

  const result = await new GoogleAdsApiClient(BASE_CONFIG).fetchDailyMetrics(REQUEST);
  const row = (result.geoRows ?? [])[0];

  assert.equal(row.spend, 5);
  assert.equal(row.countryCode, null);
  assert.equal(row.regionName, null);
  assert.ok(
    result.warnings.some((warning) => warning.includes("Geo target names could not be resolved")),
  );
});

// ------------------------------------------------------------- audiences

test("the same segment in two ad groups stays two rows", async () => {
  const criterion = { criterionId: "3001", type: "USER_LIST", displayName: "Past buyers · 30d" };
  installFetchMock({
    campaigns: [SEARCH_CAMPAIGN],
    audienceCore: [
      {
        segments: { date: "2026-09-01" },
        campaign: { id: "111" },
        adGroup: { id: "900" },
        adGroupCriterion: criterion,
        metrics: { impressions: "300", clicks: "15", costMicros: "3000000" },
      },
      {
        segments: { date: "2026-09-01" },
        campaign: { id: "111" },
        adGroup: { id: "901" },
        adGroupCriterion: criterion,
        metrics: { impressions: "100", clicks: "5", costMicros: "1000000" },
      },
    ],
  });

  const result = await new GoogleAdsApiClient(BASE_CONFIG).fetchDailyMetrics(REQUEST);
  const rows = result.audienceRows ?? [];

  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => row.adGroupKey).toSorted(),
    ["900", "901"],
  );
  assert.equal(rows[0].criterionId, "3001");
  assert.equal(rows[0].criterionType, "USER_LIST");
  assert.equal(rows[0].displayName, "Past buyers · 30d");
});

test("a rejected audience display name costs the label, not the segment", async () => {
  installFetchMock({
    campaigns: [SEARCH_CAMPAIGN],
    rejectAudienceDisplayName: true,
    audienceCore: [
      {
        segments: { date: "2026-09-01" },
        campaign: { id: "111" },
        adGroup: { id: "900" },
        adGroupCriterion: { criterionId: "3001", type: "IN_MARKET" },
        metrics: { impressions: "300", clicks: "15", costMicros: "3000000" },
      },
    ],
  });

  const result = await new GoogleAdsApiClient(BASE_CONFIG).fetchDailyMetrics(REQUEST);
  const rows = result.audienceRows ?? [];

  assert.equal(rows.length, 1);
  assert.equal(rows[0].displayName, null);
  assert.equal(rows[0].criterionType, "IN_MARKET");
  assert.ok(
    result.warnings.some((warning) =>
      warning.includes("Audience segment names could not be selected"),
    ),
  );
});

// ------------------------------------------- storage grain and migrations

test("each upsert conflict target matches the grain key its migration declares", async () => {
  const serverSource = await readFile(
    new URL("../src/lib/supabase/server.ts", import.meta.url),
    "utf8",
  );
  const entityMigration = await readFile(
    new URL("../supabase/migrations/0012_ad_group_and_asset_group_daily.sql", import.meta.url),
    "utf8",
  );
  const geoMigration = await readFile(
    new URL("../supabase/migrations/0013_geo_and_audience_daily.sql", import.meta.url),
    "utf8",
  );

  /** The columns of one named unique constraint, in declaration order. */
  const grainKey = (sql: string, constraint: string): string[] => {
    const start = sql.indexOf(`constraint ${constraint} unique (`);
    assert.notEqual(start, -1, `${constraint} is missing`);
    const open = sql.indexOf("(", start);
    const close = sql.indexOf(")", open);
    return sql
      .slice(open + 1, close)
      .split(",")
      .map((column) => column.trim())
      .filter(Boolean);
  };

  /** The conflict target string a named constant carries in server.ts. */
  const conflictTarget = (name: string): string[] => {
    const match = serverSource.match(new RegExp(`${name} =\\s*\\n?\\s*"([^"]+)"`));
    assert.ok(match, `${name} is missing`);
    return match[1].split(",");
  };

  // An upsert whose conflict target is not the table's unique key does not
  // correct a re-pulled day: it appends a second row nobody notices.
  assert.deepEqual(
    conflictTarget("ENTITY_CONFLICT_TARGET"),
    grainKey(entityMigration, "ad_entity_daily_grain_key"),
  );
  assert.deepEqual(
    conflictTarget("GEO_CONFLICT_TARGET"),
    grainKey(geoMigration, "ad_geo_daily_grain_key"),
  );
  assert.deepEqual(
    conflictTarget("AUDIENCE_CONFLICT_TARGET"),
    grainKey(geoMigration, "ad_audience_daily_grain_key"),
  );
});

test("the three new tables are member-read only, behind RLS and a tenant-composite key", async () => {
  for (const file of [
    "0012_ad_group_and_asset_group_daily.sql",
    "0013_geo_and_audience_daily.sql",
  ]) {
    const sql = await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8");
    const tables = [...sql.matchAll(/create table public\.(\w+)/g)].map((match) => match[1]);
    assert.ok(tables.length > 0, `${file} creates no table`);

    for (const table of tables) {
      assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
      assert.match(sql, new RegExp(`revoke all on table public\\.${table} from anon, authenticated`));
      assert.match(sql, new RegExp(`grant select on table public\\.${table} to authenticated`));
      assert.match(sql, new RegExp(`on public\\.${table} for select`));
      // RLS decides who may read; the composite key is what stops a row being
      // written under a brand that does not own its ad account at all.
      assert.match(
        sql,
        new RegExp(
          `foreign key \\(account_id, client_id\\)\\s*\\n\\s*references public\\.ad_accounts \\(id, client_id\\)`,
        ),
      );
    }
  }
});

test("the ingestion writes every new grain it pulls", async () => {
  const serverSource = await readFile(
    new URL("../src/lib/supabase/server.ts", import.meta.url),
    "utf8",
  );

  for (const [rows, table] of [
    ["execution.entityRows", "ad_entity_daily"],
    ["execution.geoRows", "ad_geo_daily"],
    ["execution.audienceRows", "ad_audience_daily"],
  ]) {
    assert.ok(serverSource.includes(rows), `${rows} is never read`);
    assert.ok(serverSource.includes(`"${table}"`), `${table} is never written`);
  }

  // The basis flag has to be carried, not defaulted: without it an asset group
  // count and an ad group count look interchangeable in the same table.
  assert.match(serverSource, /conversion_action_filtered: row\.conversionActionFiltered/);
});
