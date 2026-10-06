import {
  childLevel,
  GEO_LEVEL_ORDER,
  levelLabel,
  localLevelName,
  type GeoCountry,
  type GeoHierarchySource,
  type GeoLevel,
  type GeoMetrics,
  type GeoPerformanceRow,
  type GeoTarget,
} from "@/lib/dashboard/geo/contract";
import { availableLevels } from "@/lib/dashboard/geo/fixture-source";
import type { Currency, DateRange } from "@/lib/dashboard/types";

/** One stored `ad_geo_daily` row, as the reader hands it over. */
export interface StoredGeoMetricRow {
  date: string;
  countryCriterionId: string;
  regionCriterionId: string;
  countryCode: string | null;
  regionName: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  registrations: number | null;
  purchases: number | null;
  orderConversionValue: number | null;
}

const PRIMARY_COUNTRY_BY_ACCOUNT: Record<string, string> = {
  "kopi-senja": "ID",
  "batik-lestari": "ID",
  "rumah-rajut": "ID",
  "jamu-alami": "ID",
  "kriya-bali": "ID",
};

const LIVE_LEVEL_LABELS = {
  province: "Region",
  county: "County",
  municipality: "Municipality",
  city: "City",
  sublocality: "District",
} as const;

export interface GeoBreadcrumbEntry {
  id: string | null;
  name: string;
  level: GeoLevel;
  levelLabel: string;
}

export interface GeoLevelOption {
  level: GeoLevel;
  label: string;
  /** Local term for this depth, shown as a hint next to the English label. */
  localName: string | null;
}

/** A region row plus how it stood in the previous equal-length period. */
export interface GeoAnalysisRow extends GeoPerformanceRow {
  previousCostPerPurchase: number | null;
  previousSpend: number | null;
  previousPurchases: number | null;
}

export interface GeoUnattributed {
  spend: number;
  /** Share of the scope's own spend that no row accounts for. */
  shareOfScope: number;
  safeMessage: string;
}

export interface GeoAnalysis {
  sourceId: GeoHierarchySource["sourceId"];
  range: DateRange;
  /** Null when no comparison period was requested. */
  comparisonRange: DateRange | null;
  currency: Currency;
  countries: GeoCountry[];
  selectedCountry: GeoCountry;
  selectedLevel: GeoLevel;
  levelOptions: GeoLevelOption[];
  breadcrumb: GeoBreadcrumbEntry[];
  rows: GeoAnalysisRow[];
  /** Spend the scope reports that no row at this depth accounts for. */
  unattributed: GeoUnattributed | null;
  totals: {
    spend: number;
    registrations: number;
    purchases: number;
    purchaseValue: number;
  };
  /** Level a row drills into when clicked, or null at the deepest level. */
  drillLevel: GeoLevel | null;
  safeMessage: string;
}

export interface GeoAnalysisInput {
  source: GeoHierarchySource;
  accountSlug: string;
  range: DateRange;
  currency: Currency;
  countryCode?: string;
  level?: GeoLevel;
  parentId?: string | null;
  /** Previous equal-length period, for the per-region movement. */
  comparisonRange?: DateRange;
}

function buildBreadcrumb(
  source: GeoHierarchySource,
  accountSlug: string,
  range: DateRange,
  country: GeoCountry,
  parentId: string | null,
): GeoBreadcrumbEntry[] {
  const trail: GeoBreadcrumbEntry[] = [
    {
      id: null,
      name: country.name,
      level: "country",
      levelLabel: "Country",
    },
  ];

  if (parentId === null) return trail;

  // Walk up from the selected parent so the trail is built from real targets
  // rather than assumed depth.
  const chain: GeoTarget[] = [];
  let cursor: string | null = parentId;
  let guard = 0;

  while (cursor !== null && guard < 8) {
    guard += 1;
    const found: GeoTarget | undefined = (
      [
        "province",
        "county",
        "municipality",
        "city",
        "sublocality",
      ] as GeoLevel[]
    )
      .flatMap((level) =>
        source.listTargets({
          accountSlug,
          range,
          countryCode: country.code,
          level,
          parentId: null,
        }),
      )
      .find((target) => target.id === cursor);

    if (!found) break;
    chain.unshift(found);
    cursor = found.parentId;
  }

  for (const target of chain) {
    if (target.level === "country") continue;
    trail.push({
      id: target.id,
      name: target.name,
      level: target.level,
      levelLabel: levelLabel(country, target.level),
    });
  }

  return trail;
}

/**
 * The metrics the current scope reports for itself: the parent target when one
 * is selected, otherwise the country. Returns null when the source cannot
 * report that level, in which case no reconciliation claim is made.
 */
function readScopeTotals(
  input: GeoAnalysisInput,
  country: GeoCountry,
  parentId: string | null,
): GeoMetrics | null {
  const level: GeoLevel = "country";
  const countryRows = input.source.readPerformance(
    {
      accountSlug: input.accountSlug,
      range: input.range,
      countryCode: country.code,
      level,
      parentId: null,
    },
    input.currency,
  );

  if (parentId === null) return countryRows[0] ?? null;

  // Walk every level looking for the parent's own row.
  for (const candidate of GEO_LEVEL_ORDER) {
    const found = input.source
      .readPerformance(
        {
          accountSlug: input.accountSlug,
          range: input.range,
          countryCode: country.code,
          level: candidate,
          parentId: null,
        },
        input.currency,
      )
      .find((row) => row.target.id === parentId);
    if (found) return found;
  }

  return null;
}

/**
 * Reads one level of one country for the selected period. Every lookup goes
 * through the source interface, so the live Google implementation drops in
 * without the analysis layer changing.
 */
export function buildGeoAnalysis(input: GeoAnalysisInput): GeoAnalysis {
  const countries = input.source.listCountries(input.accountSlug);
  const selectedCountry =
    countries.find((country) => country.code === input.countryCode) ??
    (countries[0] as GeoCountry);
  // The country itself is the scope, never a row inside it.
  const levels: GeoLevel[] = availableLevels(selectedCountry.code).filter(
    (level): level is GeoLevel => level !== "country",
  );
  const selectedLevel =
    input.level !== undefined && levels.includes(input.level)
      ? input.level
      : (levels[0] as GeoLevel);
  const parentId = input.parentId ?? null;

  const rows = input.source.readPerformance(
    {
      accountSlug: input.accountSlug,
      range: input.range,
      countryCode: selectedCountry.code,
      level: selectedLevel,
      parentId,
    },
    input.currency,
  );

  const totals = rows.reduce(
    (accumulated, row) => ({
      spend: accumulated.spend + row.spend,
      registrations: accumulated.registrations + row.registrations,
      purchases: accumulated.purchases + row.purchases,
      purchaseValue: accumulated.purchaseValue + row.purchaseValue,
    }),
    { spend: 0, registrations: 0, purchases: 0, purchaseValue: 0 },
  );

  // Same query over the previous equal-length period, so a region can say
  // whether it is getting better or worse rather than only where it stands.
  const comparisonRange = input.comparisonRange ?? null;
  const comparisonById = new Map<string, GeoPerformanceRow>();
  if (comparisonRange) {
    for (const row of input.source.readPerformance(
      {
        accountSlug: input.accountSlug,
        range: comparisonRange,
        countryCode: selectedCountry.code,
        level: selectedLevel,
        parentId,
      },
      input.currency,
    )) {
      comparisonById.set(row.target.id, row);
    }
  }

  // What the scope reports for itself, minus what its parts add up to. In
  // Google this gap is real — a click whose location cannot be resolved to
  // this depth — and hiding it makes the children look like the whole.
  const scopeTotals = readScopeTotals(input, selectedCountry, parentId);
  const unattributedSpend =
    scopeTotals === null
      ? null
      : Math.round((scopeTotals.spend - totals.spend) * 100) / 100;

  return {
    sourceId: input.source.sourceId,
    range: input.range,
    currency: input.currency,
    countries,
    selectedCountry,
    selectedLevel,
    levelOptions: levels.map((level) => ({
      level,
      label: levelLabel(selectedCountry, level),
      localName: localLevelName(selectedCountry, level),
    })),
    breadcrumb: buildBreadcrumb(
      input.source,
      input.accountSlug,
      input.range,
      selectedCountry,
      parentId,
    ),
    rows: rows.map((row) => {
      const previous = comparisonById.get(row.target.id) ?? null;
      return {
        ...row,
        spend: Math.round(row.spend * 100) / 100,
        purchaseValue: Math.round(row.purchaseValue * 100) / 100,
        previousCostPerPurchase: previous?.costPerPurchase ?? null,
        previousSpend:
          previous === null ? null : Math.round(previous.spend * 100) / 100,
        previousPurchases: previous?.purchases ?? null,
      };
    }),
    comparisonRange,
    unattributed:
      unattributedSpend === null || unattributedSpend <= 0.5
        ? null
        : {
            spend: unattributedSpend,
            shareOfScope:
              scopeTotals && scopeTotals.spend > 0
                ? unattributedSpend / scopeTotals.spend
                : 0,
            safeMessage: `${unattributedSpend.toFixed(2)} of spend in this scope could not be resolved to a single ${levelLabel(selectedCountry, selectedLevel).toLowerCase()}, so the rows below do not add up to the scope total.`,
          },
    totals: {
      spend: Math.round(totals.spend * 100) / 100,
      registrations: totals.registrations,
      purchases: totals.purchases,
      purchaseValue: Math.round(totals.purchaseValue * 100) / 100,
    },
    drillLevel: childLevel(selectedLevel),
    safeMessage:
      input.source.sourceId === "fixture"
        ? "Synthetic geography: place names are real, every metric is generated."
        : "Live geography read from Google geo target constants.",
  };
}

function safeDivide(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function countryName(code: string): string {
  return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
}

interface LiveGeoTotals {
  spend: number;
  impressions: number;
  clicks: number;
  registrations: number;
  purchases: number;
  purchaseValue: number;
}

function aggregateLiveRows(rows: readonly StoredGeoMetricRow[]): LiveGeoTotals {
  return rows.reduce<LiveGeoTotals>(
    (total, row) => ({
      spend: total.spend + row.spend,
      impressions: total.impressions + row.impressions,
      clicks: total.clicks + row.clicks,
      registrations: total.registrations + (row.registrations ?? 0),
      purchases: total.purchases + (row.purchases ?? 0),
      purchaseValue:
        total.purchaseValue + (row.orderConversionValue ?? 0),
    }),
    {
      spend: 0,
      impressions: 0,
      clicks: 0,
      registrations: 0,
      purchases: 0,
      purchaseValue: 0,
    },
  );
}

/**
 * Builds the live country/region view from `user_location_view` rows stored in
 * `ad_geo_daily`. The storage grain currently carries country plus region, so
 * the live UI offers that measured depth only and never invents counties or
 * cities from a parent region.
 *
 * A null return is deliberate: if the provider did not resolve a country or
 * did not answer the mapped conversion columns, the panel stays pending rather
 * than turning "not measured" into zero.
 */
export function buildGeoAnalysisFromRows(input: {
  rows: readonly StoredGeoMetricRow[];
  comparisonRows?: readonly StoredGeoMetricRow[];
  accountSlug: string;
  range: DateRange;
  comparisonRange?: DateRange;
  currency: Currency;
  countryCode?: string;
}): GeoAnalysis | null {
  const currentRows = input.rows.filter(
    (row) => row.date >= input.range.start && row.date <= input.range.end,
  );
  if (
    currentRows.length === 0 ||
    currentRows.some(
      (row) =>
        row.countryCode === null ||
        row.registrations === null ||
        row.purchases === null ||
        row.orderConversionValue === null,
    )
  ) {
    return null;
  }

  const rowsByCountry = new Map<string, StoredGeoMetricRow[]>();
  for (const row of currentRows) {
    const code = row.countryCode as string;
    const grouped = rowsByCountry.get(code) ?? [];
    grouped.push(row);
    rowsByCountry.set(code, grouped);
  }

  const primaryCode = PRIMARY_COUNTRY_BY_ACCOUNT[input.accountSlug];
  const countries = [...rowsByCountry.entries()]
    .map(([code, rows]) => ({
      code,
      name: countryName(code),
      isPrimary: code === primaryCode,
      labels: LIVE_LEVEL_LABELS,
      spend: aggregateLiveRows(rows).spend,
    }))
    .sort(
      (left, right) =>
        Number(right.isPrimary) - Number(left.isPrimary) ||
        right.spend - left.spend ||
        left.name.localeCompare(right.name),
    );
  const selectedCountry =
    countries.find((country) => country.code === input.countryCode) ??
    countries.find((country) => country.isPrimary) ??
    countries[0];
  if (!selectedCountry) return null;
  const selectedCountryView: GeoCountry = {
    code: selectedCountry.code,
    name: selectedCountry.name,
    isPrimary: selectedCountry.isPrimary,
    labels: selectedCountry.labels,
  };

  const countryRows = rowsByCountry.get(selectedCountry.code) ?? [];
  const regionGroups = new Map<string, StoredGeoMetricRow[]>();
  for (const row of countryRows) {
    if (!row.regionCriterionId) continue;
    const grouped = regionGroups.get(row.regionCriterionId) ?? [];
    grouped.push(row);
    regionGroups.set(row.regionCriterionId, grouped);
  }
  if (regionGroups.size === 0) return null;

  const regionSpend = [...regionGroups.values()].reduce(
    (sum, rows) => sum + aggregateLiveRows(rows).spend,
    0,
  );
  const comparisonRows = (input.comparisonRows ?? []).filter(
    (row) =>
      (input.comparisonRange === undefined ||
        (row.date >= input.comparisonRange.start &&
          row.date <= input.comparisonRange.end)) &&
      row.countryCode === selectedCountry.code &&
      row.regionCriterionId.length > 0 &&
      row.registrations !== null &&
      row.purchases !== null &&
      row.orderConversionValue !== null,
  );
  const comparisonByRegion = new Map<string, StoredGeoMetricRow[]>();
  for (const row of comparisonRows) {
    const grouped = comparisonByRegion.get(row.regionCriterionId) ?? [];
    grouped.push(row);
    comparisonByRegion.set(row.regionCriterionId, grouped);
  }

  const rows = [...regionGroups.entries()]
    .map<GeoAnalysisRow>(([regionCriterionId, sourceRows]) => {
      const totals = aggregateLiveRows(sourceRows);
      const previousSource = comparisonByRegion.get(regionCriterionId) ?? [];
      const previous =
        previousSource.length > 0 ? aggregateLiveRows(previousSource) : null;
      const regionName =
        sourceRows.find((row) => row.regionName)?.regionName ??
        "Unresolved region";

      return {
        target: {
          id: regionCriterionId,
          name: regionName,
          canonicalName: `${regionName},${selectedCountry.name}`,
          countryCode: selectedCountry.code,
          level: "province",
          parentId: sourceRows[0]?.countryCriterionId ?? null,
        },
        spend: roundMoney(totals.spend),
        impressions: totals.impressions,
        clicks: totals.clicks,
        registrations: totals.registrations,
        purchases: totals.purchases,
        purchaseValue: roundMoney(totals.purchaseValue),
        ctr: safeDivide(totals.clicks, totals.impressions),
        cpc: safeDivide(totals.spend, totals.clicks),
        costPerPurchase: safeDivide(totals.spend, totals.purchases),
        costPerRegistration: safeDivide(
          totals.spend,
          totals.registrations,
        ),
        returnOnAdSpend: safeDivide(totals.purchaseValue, totals.spend),
        spendShare: safeDivide(totals.spend, regionSpend) ?? 0,
        previousCostPerPurchase:
          previous === null
            ? null
            : safeDivide(previous.spend, previous.purchases),
        previousSpend:
          previous === null ? null : roundMoney(previous.spend),
        previousPurchases: previous?.purchases ?? null,
      };
    })
    .sort((left, right) => right.spend - left.spend);

  const totals = rows.reduce(
    (total, row) => ({
      spend: total.spend + row.spend,
      registrations: total.registrations + row.registrations,
      purchases: total.purchases + row.purchases,
      purchaseValue: total.purchaseValue + row.purchaseValue,
    }),
    { spend: 0, registrations: 0, purchases: 0, purchaseValue: 0 },
  );
  const countryTotals = aggregateLiveRows(countryRows);
  const unattributedSpend = roundMoney(countryTotals.spend - totals.spend);

  return {
    sourceId: "google-ads",
    range: input.range,
    comparisonRange: input.comparisonRange ?? null,
    currency: input.currency,
    countries: countries.map((country) => ({
      code: country.code,
      name: country.name,
      isPrimary: country.isPrimary,
      labels: country.labels,
    })),
    selectedCountry: selectedCountryView,
    selectedLevel: "province",
    levelOptions: [
      { level: "province", label: "Region", localName: null },
    ],
    breadcrumb: [
      {
        id: null,
        name: selectedCountry.name,
        level: "country",
        levelLabel: "Country",
      },
    ],
    rows,
    unattributed:
      unattributedSpend <= 0.5
        ? null
        : {
            spend: unattributedSpend,
            shareOfScope: safeDivide(unattributedSpend, countryTotals.spend) ?? 0,
            safeMessage: `${unattributedSpend.toFixed(2)} of spend was reported at country level without a region.`,
          },
    totals: {
      spend: roundMoney(totals.spend),
      registrations: totals.registrations,
      purchases: totals.purchases,
      purchaseValue: roundMoney(totals.purchaseValue),
    },
    drillLevel: null,
    safeMessage:
      "Live geography from Google Ads user location data. Country-only traffic is shown as unattributed.",
  };
}
