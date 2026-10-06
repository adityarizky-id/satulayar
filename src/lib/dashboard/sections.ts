import type { Platform } from "@/lib/dashboard/types";

/**
 * Sections that only exist because Google reports the cut.
 *
 * - Campaign types are Google channel types: Search, Shopping, PMax, Display.
 * - Impression share is a Search auction metric; Meta has no equivalent.
 * - Devices come from `segments.device`; Meta segments by placement instead.
 * - Geography reads `geo_target_constant` plus `user_location_view`.
 *
 * They used to render in the combined view with a "Google Ads only" tag, which
 * put three Google-shaped diagnostics inside a page the reader had asked to be
 * about both platforms. Under a combined filter the page now keeps only what
 * genuinely spans both: the journey, the delivery trend, and the side-by-side
 * platform table.
 */
export const GOOGLE_ONLY_SECTIONS = [
  "campaign-types",
  "search-terms",
  // Anchors inside the search-terms section rather than sections of their own,
  // kept here so a link to either is still resolved against the platform filter.
  "intent-tiers",
  "wasted-spend",
  "impression-share",
  "geo-analysis",
  "device-analysis",
  "audience-segments",
] as const;

export type GoogleOnlySection = (typeof GOOGLE_ONLY_SECTIONS)[number];

export function isGoogleOnlySection(id: string): id is GoogleOnlySection {
  return (GOOGLE_ONLY_SECTIONS as readonly string[]).includes(id);
}

/**
 * Sections that only exist because Meta reports the cut.
 *
 * Audience is Meta's age/gender breakdown plus its Core/Custom/Lookalike
 * targeting-type split, both read straight off Meta's own breakdown table.
 * Creative Fatigue radar and Placement breakdowns are Meta-specific delivery metrics.
 */
export const META_ONLY_SECTIONS = [
  "audience",
  "creative-fatigue",
  "placement-performance",
] as const;

export type MetaOnlySection = (typeof META_ONLY_SECTIONS)[number];

export function isMetaOnlySection(id: string): id is MetaOnlySection {
  return (META_ONLY_SECTIONS as readonly string[]).includes(id);
}

/**
 * Panels whose figures are still generated from a shape constant rather than
 * read from the platform that reports the cut.
 *
 * This list is the single place that records it. Without it each panel decided
 * for itself whether to admit its provenance, and only two of them did: the
 * other eleven published invented figures beside real spend with nothing to
 * distinguish them — a hardcoded ROAS far above the account's measured one,
 * and a geography panel reporting several times the account's real spend.
 *
 * `missing` names the feed each panel is waiting on, so the placeholder can
 * say what is actually needed rather than "coming soon".
 */
export const SYNTHETIC_PANELS = [
  {
    key: "campaign-types",
    title: "Campaign types",
    missing: "campaign channel types from ad_campaigns",
  },
  // Intent tiers and Wasted spend used to be panels of their own and had a
  // pending card each. They are tabs inside Search terms now, and all three
  // wait on the same feed, so three cards announced one missing table three
  // times. The section keeps one card, naming what the whole section needs.
  {
    key: "search-terms",
    title: "Search terms, intent tiers and wasted spend",
    missing: "search query rows from ad_search_term_daily",
  },
  {
    key: "impression-share",
    title: "Impression share",
    missing: "metrics.search_*_impression_share from the Google Ads API",
  },
  {
    key: "device-analysis",
    title: "Device breakdown",
    missing: "segments.device from the Google Ads API",
  },
  {
    key: "geo-analysis",
    title: "Geography",
    missing: "user_location_view from the Google Ads API",
  },
  {
    key: "audience-segments",
    title: "Google audience segments",
    missing: "audience segment views from the Google Ads API",
  },
  {
    key: "audience",
    title: "Meta audience",
    missing: "age, gender and targeting-type breakdowns from Meta",
  },
  {
    key: "creative-fatigue",
    title: "Creative fatigue and placements",
    missing: "ad-level and placement insights from Meta",
  },
  {
    key: "blended-mer",
    title: "Blended MER and RFM audience bridge",
    missing: "realised store revenue and customer cohorts from the store",
  },
] as const;

export type SyntheticPanelKey = (typeof SYNTHETIC_PANELS)[number]["key"];

export interface PendingPanel {
  key: SyntheticPanelKey;
  title: string;
  missing: string;
}

export function isSyntheticPanel(key: string): key is SyntheticPanelKey {
  return SYNTHETIC_PANELS.some((panel) => panel.key === key);
}

/**
 * Live mode publishes only figures a platform actually reported.
 *
 * Mock mode keeps the generated panels, because that is what a preview is
 * for — they carry a synthetic-mockup notice instead. The split is on data
 * mode alone: a live refresh that happens to be read from a fixture store is
 * still claiming to be real, and a mock run against Supabase still is not.
 */
export function suppressesSyntheticPanels(mode: "mock" | "live"): boolean {
  return mode === "live";
}

/**
 * The generated panels that a given platform filter would have shown, so the
 * page can leave a placeholder where each one was rather than silently
 * dropping a section the sidebar still links to.
 */
export function pendingSyntheticPanels(platform: Platform): PendingPanel[] {
  return SYNTHETIC_PANELS.filter((panel) =>
    isSectionVisible(panel.key, platform),
  ).map((panel) => ({ ...panel }));
}

/** Whether a section belongs on the page for the platform currently filtered. */
export function isSectionVisible(id: string, platform: Platform): boolean {
  if (isGoogleOnlySection(id)) return platform === "google";
  if (isMetaOnlySection(id)) return platform === "meta";
  return true;
}

/** Reads the section id out of a nav anchor such as `/#impression-share`. */
export function anchorSectionId(href: string): string | null {
  const [, hash] = href.split("#");
  return hash ?? null;
}
