import type { Currency, Platform } from "@/lib/dashboard/types";

/**
 * Fictional demo brands. Only display names live here: no
 * advertising account IDs, store IDs, or credentials belong in this file.
 * Currency and timezone are demo settings and
 * must be re-checked against each live account before connectors are enabled.
 */
export interface AccountOption {
  slug: string;
  name: string;
  currency: Currency;
  timezone: string;
  platforms: Exclude<Platform, "all">[];
  storeName: string;
  /** Deterministic scale applied to fixture volume so brands look different. */
  fixtureScale: number;
}

/**
 * Product-level platform catalogue. Only Meta and Google are queryable today;
 * Microsoft Advertising is visible as planned so the utility filter has a
 * truthful expansion point without pretending a connector already exists.
 */
export const ADVERTISING_PLATFORM_CATALOG = [
  {
    id: "meta",
    label: "Meta Ads",
    shortLabel: "Meta",
    availability: "active",
  },
  {
    id: "google",
    label: "Google Ads",
    shortLabel: "Google",
    availability: "active",
  },
  {
    id: "tiktok",
    label: "TikTok Ads",
    shortLabel: "TikTok",
    availability: "planned",
  },
  {
    id: "microsoft",
    label: "Microsoft Ads (Bing)",
    shortLabel: "Microsoft",
    availability: "planned",
  },
] as const;

export const ACCOUNT_OPTIONS: AccountOption[] = [
  {
    slug: "kopi-senja",
    name: "Kopi Senja Nusantara",
    currency: "USD",
    timezone: "Asia/Jakarta",
    platforms: ["meta", "google"],
    storeName: "Kopi Senja Nusantara store",
    fixtureScale: 1,
  },
  {
    slug: "batik-lestari",
    name: "Batik Lestari",
    currency: "USD",
    timezone: "Asia/Jakarta",
    platforms: ["google"],
    storeName: "Batik Lestari store",
    fixtureScale: 0.62,
  },
  {
    slug: "rumah-rajut",
    name: "Rumah Rajut",
    currency: "USD",
    timezone: "Asia/Jakarta",
    platforms: ["google"],
    storeName: "Rumah Rajut store",
    fixtureScale: 0.78,
  },
  {
    slug: "jamu-alami",
    name: "Jamu Alami",
    currency: "USD",
    timezone: "Asia/Jakarta",
    platforms: ["meta", "google"],
    storeName: "Jamu Alami store",
    fixtureScale: 0.85,
  },
  {
    slug: "kriya-bali",
    name: "Kriya Bali",
    currency: "USD",
    timezone: "Asia/Makassar",
    platforms: ["meta", "google"],
    storeName: "Kriya Bali store",
    fixtureScale: 1.24,
  },
];

export const DEFAULT_ACCOUNT_SLUG = "kopi-senja";

/** Cookie that carries the selected brand between the two analysis pages. */
export const ACCOUNT_COOKIE = "sl_account";

/**
 * Strict membership test for a brand slug.
 *
 * `resolveAccount` falls back to the first brand, which is right for a stale
 * cookie on a dashboard page and wrong for a request parameter: silently
 * treating an unknown slug as Kopi Senja Nusantara would connect a credential, run a
 * backfill, or revoke a token against the wrong brand. Routes validate with
 * this and refuse what it rejects.
 */
export function isAccountSlug(value: unknown): value is string {
  return (
    typeof value === "string" &&
    ACCOUNT_OPTIONS.some((account) => account.slug === value.trim())
  );
}

/** Every brand slug in the v1 gate, for allowlists and error copy. */
export function accountSlugs(): string[] {
  return ACCOUNT_OPTIONS.map((account) => account.slug);
}

export function resolveAccount(slug: string | null | undefined): AccountOption {
  return (
    ACCOUNT_OPTIONS.find((account) => account.slug === slug) ??
    (ACCOUNT_OPTIONS[0] as AccountOption)
  );
}

/**
 * A brand can only be filtered by a platform it actually runs. Asking for Meta
 * on a Google-only brand returns that brand's real platform set instead of an
 * empty dashboard.
 */
export function resolvePlatformForAccount(
  account: AccountOption,
  platform: Platform,
): Platform {
  const onlyPlatform = account.platforms.length === 1 ? account.platforms[0] : null;

  if (platform === "all") return onlyPlatform ?? "all";
  return account.platforms.includes(platform) ? platform : onlyPlatform ?? "all";
}
