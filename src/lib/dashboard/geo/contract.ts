import type { Currency, DateRange } from "@/lib/dashboard/types";

/**
 * Geo hierarchy contract.
 *
 * The shape here mirrors Google Ads `geo_target_constant` so that swapping the
 * fixture source for the live API is a source swap, not a rewrite. Google names
 * the same depth differently per country — Indonesia has provinsi, Malaysia has
 * negeri, Singapore has districts — so a country supplies its own labels
 * while the depth stays comparable across accounts.
 */
export type GeoLevel =
  | "country"
  | "province"
  | "county"
  | "municipality"
  | "city"
  | "sublocality";

export const GEO_LEVEL_ORDER: GeoLevel[] = [
  "country",
  "province",
  "county",
  "municipality",
  "city",
  "sublocality",
];

/**
 * Google's `target_type` vocabulary mapped onto the six levels above. Anything
 * not listed here is deliberately dropped rather than guessed at: postal codes,
 * airports, and universities are targeting objects, not an administrative
 * hierarchy, and mixing them in would double count a region.
 */
export const GOOGLE_TARGET_TYPE_TO_LEVEL: Record<string, GeoLevel> = {
  Country: "country",
  Region: "province",
  State: "province",
  Province: "province",
  Autonomous_Community: "province",
  Governorate: "province",
  Prefecture: "province",
  Canton: "province",
  Department: "province",
  County: "county",
  Municipality: "municipality",
  City: "city",
  Congressional_District: "county",
  District: "sublocality",
  Borough: "sublocality",
  Neighborhood: "sublocality",
  City_Region: "sublocality",
};

/** Levels Google reports but this dashboard never rolls up as geography. */
export const IGNORED_GOOGLE_TARGET_TYPES = [
  "Postal_Code",
  "Airport",
  "University",
  "TV_Region",
  "Okrug",
] as const;

export interface GeoLevelLabels {
  /** Local name of each depth, e.g. "Provinsi" for Indonesia. */
  province: string;
  county: string;
  municipality: string;
  city: string;
  sublocality: string;
}

/**
 * The interface is English, so the level filter always reads the same wherever
 * the account sells. The local name still travels on the country as context,
 * because "Županija" is what the platform and the client will say out loud.
 */
export const ENGLISH_LEVEL_LABELS: Record<GeoLevel, string> = {
  country: "Country",
  province: "Region",
  county: "County",
  municipality: "Municipality",
  city: "City",
  sublocality: "District",
};

export interface GeoCountry {
  /** ISO 3166-1 alpha-2, matching Google's `country_code`. */
  code: string;
  name: string;
  /** True for the account's home market; the rest are secondary markets. */
  isPrimary: boolean;
  labels: GeoLevelLabels;
}

export interface GeoTarget {
  /** Google `geo_target_constant.id`, or a synthetic id in fixture mode. */
  id: string;
  name: string;
  /** Google `canonical_name`, e.g. "Bandung,West Java,Indonesia". */
  canonicalName: string;
  countryCode: string;
  level: GeoLevel;
  parentId: string | null;
  /**
   * Optional real geometry. Fixture mode ships tile coordinates instead, and
   * the map renders whichever is present, so licensed boundary paths can be
   * added later without touching the component.
   */
  path?: string;
  tile?: { row: number; column: number };
}

export interface GeoMetrics {
  spend: number;
  /** `metrics.impressions` on the location view. */
  impressions: number;
  /** `metrics.clicks` on the location view. */
  clicks: number;
  registrations: number;
  purchases: number;
  purchaseValue: number;
}

export interface GeoPerformanceRow extends GeoMetrics {
  target: GeoTarget;
  ctr: number | null;
  cpc: number | null;
  costPerPurchase: number | null;
  costPerRegistration: number | null;
  returnOnAdSpend: number | null;
  /** Share of the parent scope's spend. */
  spendShare: number;
}

export interface GeoQuery {
  accountSlug: string;
  range: DateRange;
  countryCode: string;
  level: GeoLevel;
  /** Restricts to children of this target; null reads the level as a whole. */
  parentId: string | null;
}

/**
 * The single seam between the dashboard and wherever geography comes from.
 * Fixture mode implements it locally; the live implementation reads
 * `geo_target_constant` plus `user_location_view` and must not invent a level
 * that Google did not report.
 */
export interface GeoHierarchySource {
  readonly sourceId: "fixture" | "google-ads";
  listCountries(accountSlug: string): GeoCountry[];
  listTargets(query: GeoQuery): GeoTarget[];
  readPerformance(query: GeoQuery, currency: Currency): GeoPerformanceRow[];
}

/**
 * Live source, deliberately not wired. It documents the exact reads the
 * connector must make so the swap is mechanical, and fails closed until the
 * credential and parity gates are approved.
 */
export const GOOGLE_GEO_SOURCE_CONTRACT = {
  hierarchyQuery: [
    "SELECT geo_target_constant.id, geo_target_constant.name,",
    "geo_target_constant.canonical_name, geo_target_constant.country_code,",
    "geo_target_constant.target_type, geo_target_constant.parent_geo_target,",
    "geo_target_constant.status FROM geo_target_constant",
    "WHERE geo_target_constant.status = 'ENABLED'",
  ].join(" "),
  /**
   * `user_location_view` reports where the person actually was.
   * `geographic_view` also carries the targeted location, which answers a
   * different question and must not be mixed into the same table.
   */
  performanceQuery: [
    "SELECT user_location_view.country_criterion_id, segments.geo_target_region,",
    "segments.geo_target_county, segments.geo_target_city, metrics.cost_micros,",
    "metrics.all_conversions, metrics.all_conversions_value FROM user_location_view",
    "WHERE segments.date BETWEEN '{start}' AND '{end}'",
  ].join(" "),
  notes: [
    "Cost arrives in micros and must be divided by 1,000,000 before display.",
    "Conversions follow the locked All conversions basis, including view-through.",
    "A geo level missing from the response stays missing; it is never inferred from the level above.",
  ],
} as const;

export function createLiveGeoSourceUnavailable(): GeoHierarchySource {
  const fail = (): never => {
    throw new Error(
      "Live geo source is not activated. Approve the Google Ads credential and parity gate first.",
    );
  };

  return {
    sourceId: "google-ads",
    listCountries: fail,
    listTargets: fail,
    readPerformance: fail,
  };
}

export function levelLabel(_country: GeoCountry, level: GeoLevel): string {
  return ENGLISH_LEVEL_LABELS[level];
}

/** The local word for a depth, shown as a hint rather than as the label. */
export function localLevelName(
  country: GeoCountry,
  level: GeoLevel,
): string | null {
  if (level === "country") return null;
  const local = country.labels[level];
  return local === ENGLISH_LEVEL_LABELS[level] ? null : local;
}

export function childLevel(level: GeoLevel): GeoLevel | null {
  const index = GEO_LEVEL_ORDER.indexOf(level);
  return GEO_LEVEL_ORDER[index + 1] ?? null;
}

export function parentLevel(level: GeoLevel): GeoLevel | null {
  const index = GEO_LEVEL_ORDER.indexOf(level);
  return index <= 0 ? null : (GEO_LEVEL_ORDER[index - 1] as GeoLevel);
}
