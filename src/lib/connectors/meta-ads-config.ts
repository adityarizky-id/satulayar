import { PILOT_CLIENT_SLUG } from "@/lib/auth/constants";
import type { MetaAdsApiConfiguration } from "@/lib/connectors/meta-ads-api-client";
import {
  ACCOUNT_OPTIONS,
  isAccountSlug,
  resolveAccount,
} from "@/lib/dashboard/accounts";
import type { Currency } from "@/lib/dashboard/types";

export const META_ADS_TOKEN_PLATFORMS = ["meta-ads", "meta"] as const;

type Environment = Record<string, string | undefined>;

export type MetaAdAccountIdSource =
  | "connector-token"
  | "brand-env"
  | "canonical-registry"
  | "pilot-global-env";

export type MetaAdsConfigFailureState =
  | "not-configured"
  | "invalid"
  | "collision"
  | "registry-unavailable";

export type MetaAdsConfigResolution =
  | {
      ok: true;
      clientSlug: string;
      adAccountIdSource: MetaAdAccountIdSource;
      config: MetaAdsApiConfiguration;
    }
  | {
      ok: false;
      clientSlug: string;
      state: MetaAdsConfigFailureState;
      missing: string[];
      safeMessage: string;
    };

export type MetaAdAccountIdResolution =
  | { ok: true; adAccountId: string; source: MetaAdAccountIdSource }
  | {
      ok: false;
      state: "not-configured" | "invalid";
      missing: string[];
      safeMessage: string;
    };

export interface StoredMetaAccount {
  clientSlug: string;
  customerId: string | null;
}

export interface CanonicalMetaBrandProfile {
  adAccountId: string;
  campaignFilter: string;
  currency: Currency;
  /**
   * Campaign-code prefixes for a brand that runs under more than one code.
   * When present these replace the single-substring `campaignFilter`, and a
   * campaign is kept only when its name *starts with* one of them.
   */
  campaignPrefixes?: readonly string[];
}

/**
 * Demo brand mapping for Meta Ads. Every account ID here is synthetic.
 *
 * Each brand either runs on its own ad account or a shared account with a
 * mandatory campaign name filter.
 */
export const CANONICAL_META_BRAND_MAP: Record<string, CanonicalMetaBrandProfile> = {
  "kopi-senja": {
    adAccountId: "100000000000001",
    campaignFilter: "Kopi Senja.",
    currency: "USD",
  },
  "jamu-alami": {
    adAccountId: "100000000000002",
    campaignFilter: "JMA ID",
    currency: "USD",
  },
  "kriya-bali": {
    adAccountId: "100000000000003",
    campaignFilter: "KRB",
    currency: "USD",
    /**
     * Business-line isolation:
     * Kriya Bali strictly uses the "KRB" prefix.
     * Campaigns with another prefix, such as "EW_" (for example EW_Signup,
     * EW_Purchase or EW_Remarketing), would belong to a separate store
     * with a distinct business model that shares this ad account.
     * They must NOT be merged into the retail line.
     */
    campaignPrefixes: ["KRB"],
  },
};

export function metaAdsEnvKey(base: string, clientSlug: string): string {
  return `${base}_${clientSlug.trim().toUpperCase().replace(/-/g, "_")}`;
}

function read(
  environment: Environment,
  ...keys: (string | null | undefined)[]
): string | undefined {
  for (const key of keys) {
    if (!key) continue;
    const value = environment[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

/** Accepts act_123 or 123; always yields the bare numeric digits. */
export function normalizeMetaAdAccountId(
  value: string | null | undefined,
): string | null {
  const raw = (value ?? "").trim();
  const stripped = raw.startsWith("act_") ? raw.slice(4).trim() : raw;
  return /^\d{10,20}$/.test(stripped) ? stripped : null;
}

/**
 * Resolves one brand's Meta Ad Account ID.
 */
export function resolveMetaAdAccountId(
  clientSlug: string,
  storedAccountId: string | null | undefined,
  environment: Environment = process.env,
): MetaAdAccountIdResolution {
  const slug = clientSlug.trim();
  const isPilot = slug === PILOT_CLIENT_SLUG;
  const brandKey = metaAdsEnvKey("META_AD_ACCOUNT_ID", slug);
  const unsuffixedGlobal = normalizeMetaAdAccountId(environment.META_AD_ACCOUNT_ID);

  const candidates: {
    raw: string | undefined;
    source: MetaAdAccountIdSource;
    label: string;
  }[] = [
    {
      raw: storedAccountId?.trim() || undefined,
      source: "connector-token",
      label: "The Meta ad account stored for this brand",
    },
    {
      raw: read(environment, brandKey),
      source: "brand-env",
      label: brandKey,
    },
  ];

  for (const candidate of candidates) {
    if (!candidate.raw) continue;
    const accountId = normalizeMetaAdAccountId(candidate.raw);
    if (!accountId) {
      return {
        ok: false,
        state: "invalid",
        missing: [],
        safeMessage: `${candidate.label} is not a valid numeric Meta Ad Account ID.`,
      };
    }
    // A stored token row or a brand-suffixed variable is deliberate, brand-scoped
    // configuration, so it is not second-guessed against the unsuffixed
    // META_AD_ACCOUNT_ID. On an operator machine that variable is routinely
    // exported at OS level for an unrelated Meta MCP server, and on a shared
    // device it can hold another brand's own real account. Reading that coincidence as "inherited from the pilot" refused a
    // correctly configured brand outright. Inheritance is closed off at the
    // source instead: only the pilot ever reads the unsuffixed variable, and only
    // after the check below proves it agrees with the pilot's canonical account.
    return { ok: true, adAccountId: accountId, source: candidate.source };
  }

  // Check canonical mapping for known demo brands
  const canonical = CANONICAL_META_BRAND_MAP[slug];
  if (canonical?.adAccountId) {
    return {
      ok: true,
      adAccountId: canonical.adAccountId,
      source: "canonical-registry",
    };
  }

  if (isPilot && unsuffixedGlobal) {
    // The unsuffixed variable is the weakest source there is, because anything
    // on the machine can export it. It is accepted only when no canonical
    // account is registered for the pilot, and it may never contradict one.
    const pilotCanonical = CANONICAL_META_BRAND_MAP[slug]?.adAccountId;
    if (pilotCanonical && pilotCanonical !== unsuffixedGlobal) {
      return {
        ok: false,
        state: "invalid",
        missing: [],
        safeMessage: `META_AD_ACCOUNT_ID resolves to ${unsuffixedGlobal}, but this brand's registered Meta account is ${pilotCanonical}. That variable is often exported at the operating-system level for an unrelated tool, so it was inherited rather than configured. Set ${brandKey} explicitly.`,
      };
    }
    return {
      ok: true,
      adAccountId: unsuffixedGlobal,
      source: "pilot-global-env",
    };
  }

  return {
    ok: false,
    state: "not-configured",
    missing: [brandKey],
    safeMessage: `No Meta Ad Account ID is configured for this brand. Set ${brandKey} or add it to the connector registry.`,
  };
}

export function resolveMetaCampaignFilter(
  clientSlug: string,
  environment: Environment = process.env,
): string {
  const slug = clientSlug.trim();
  const isPilot = slug === PILOT_CLIENT_SLUG;
  const brandKey = metaAdsEnvKey("META_CAMPAIGN_NAME_FILTER", slug);

  const envValue = read(
    environment,
    brandKey,
    isPilot ? "META_CAMPAIGN_NAME_FILTER" : null,
  );
  if (envValue) return envValue;

  const canonical = CANONICAL_META_BRAND_MAP[slug];
  if (canonical?.campaignFilter) return canonical.campaignFilter;

  return "";
}

/**
 * Campaign-code prefixes for one brand, or an empty list when the brand uses
 * the single-substring filter.
 *
 * Precedence is deliberate. `META_CAMPAIGN_NAME_PREFIXES_<BRAND>` (comma
 * separated) lets an operator pin the rule per device; otherwise the ratified
 * canonical registry decides. When this returns a non-empty list it **outranks**
 * `META_CAMPAIGN_NAME_FILTER_<BRAND>`: a device may still export an old
 * substring filter, and honouring it would silently undo the prefix rule the
 * registry defines. Set the prefixes variable, not the filter variable, to
 * narrow such a brand again.
 */
export function resolveMetaCampaignPrefixes(
  clientSlug: string,
  environment: Environment = process.env,
): readonly string[] {
  const slug = clientSlug.trim();
  const envValue = read(
    environment,
    metaAdsEnvKey("META_CAMPAIGN_NAME_PREFIXES", slug),
  );
  if (envValue) {
    return envValue
      .split(",")
      .map((prefix) => prefix.trim())
      .filter(Boolean);
  }

  return CANONICAL_META_BRAND_MAP[slug]?.campaignPrefixes ?? [];
}

/**
 * Detects whether two brands point at the exact same account and filter,
 * which would lead to duplicate or contaminated reporting.
 */
export function detectMetaAccountCollisions(
  resolved: readonly {
    clientSlug: string;
    adAccountId: string;
    filter: string;
  }[],
): Map<string, string[]> {
  const byFingerprint = new Map<string, Set<string>>();
  for (const item of resolved) {
    // If accounts are identical AND filters are identical (or empty), it's a collision.
    const key = `${item.adAccountId}::${item.filter.toLowerCase().trim()}`;
    const slugs = byFingerprint.get(key) ?? new Set<string>();
    slugs.add(item.clientSlug);
    byFingerprint.set(key, slugs);
  }
  return new Map(
    [...byFingerprint.entries()]
      .filter(([, slugs]) => slugs.size > 1)
      .map(([key, slugs]) => [key, [...slugs].toSorted()]),
  );
}

export function resolveMetaAdsConfig(
  clientSlug: string,
  options: {
    storedAccounts: readonly StoredMetaAccount[];
    environment?: Environment;
  },
): MetaAdsConfigResolution {
  const environment = options.environment ?? process.env;
  const slug = clientSlug.trim();

  if (!isAccountSlug(slug)) {
    return {
      ok: false,
      clientSlug: slug,
      state: "invalid",
      missing: [],
      safeMessage: "Meta Ads is not available for an unknown brand.",
    };
  }

  const account = resolveAccount(slug);
  if (!account.platforms.includes("meta")) {
    return {
      ok: false,
      clientSlug: slug,
      state: "invalid",
      missing: [],
      safeMessage: `${account.name} does not run Meta Ads, so there is nothing to pull.`,
    };
  }

  const storedFor = (target: string) =>
    options.storedAccounts.find((row) => row.clientSlug === target)?.customerId ??
    null;

  const own = resolveMetaAdAccountId(slug, storedFor(slug), environment);
  if (!own.ok) {
    return { clientSlug: slug, ...own };
  }

  const ownFilter = resolveMetaCampaignFilter(slug, environment);
  const ownPrefixes = resolveMetaCampaignPrefixes(slug, environment);

  /**
   * The rule actually in force for a brand, as one comparable string. Two
   * brands on the same account only collide when they would keep the same
   * rows, so the fingerprint has to follow whichever rule wins — a brand on
   * prefixes is not colliding with a brand on the substring of the same name.
   */
  const effectiveRule = (
    filter: string,
    prefixes: readonly string[],
  ): string =>
    prefixes.length > 0
      ? `prefix:${prefixes.map((p) => p.toLowerCase().trim()).toSorted().join("|")}`
      : `contains:${filter.toLowerCase().trim()}`;

  // Check collisions across all brands running Meta
  const otherSlugs = new Set<string>([
    ...ACCOUNT_OPTIONS.filter((opt) => opt.platforms.includes("meta")).map(
      (opt) => opt.slug,
    ),
    ...options.storedAccounts.map((row) => row.clientSlug),
  ]);
  otherSlugs.delete(slug);

  const claims: {
    clientSlug: string;
    adAccountId: string;
    filter: string;
  }[] = [
    {
      clientSlug: slug,
      adAccountId: own.adAccountId,
      filter: effectiveRule(ownFilter, ownPrefixes),
    },
  ];
  for (const other of otherSlugs) {
    const res = resolveMetaAdAccountId(other, storedFor(other), environment);
    if (res.ok) {
      claims.push({
        clientSlug: other,
        adAccountId: res.adAccountId,
        filter: effectiveRule(
          resolveMetaCampaignFilter(other, environment),
          resolveMetaCampaignPrefixes(other, environment),
        ),
      });
    }
  }

  const fingerprint = `${own.adAccountId}::${effectiveRule(ownFilter, ownPrefixes)
    .toLowerCase()
    .trim()}`;
  const collision = detectMetaAccountCollisions(claims).get(fingerprint);
  if (collision) {
    return {
      ok: false,
      clientSlug: slug,
      state: "collision",
      missing: [],
      safeMessage: `The Meta Ad Account and campaign filter for this brand collide with ${collision
        .filter((item) => item !== slug)
        .join(
          ", ",
        )}. Two brands cannot share an account without distinct campaign filters.`,
    };
  }

  /**
   * One Meta user or system-user token normally grants read access to every ad
   * account the operator administers, so a single `META_ADS_ACCESS_TOKEN` is the
   * ordinary case and a per-brand token the exception. Restricting the shared
   * variable to the pilot left the other brands with no credential at all and
   * no stored `connector_tokens` row to fall back to, so both failed closed on
   * every live sync.
   *
   * Widening this does not widen what a brand can read. Which advertiser is
   * touched is decided by `expectedAdAccountId` (the connector refuses any other
   * account before its first insights call), by `expectedCurrency`, and by
   * `campaignNameFilter` — all three resolved per brand above. The token only
   * decides whether the call is authorised at all.
   */
  const accessToken =
    read(environment, metaAdsEnvKey("META_ADS_ACCESS_TOKEN", slug)) ??
    read(environment, "META_ADS_ACCESS_TOKEN");

  return {
    ok: true,
    clientSlug: slug,
    adAccountIdSource: own.source,
    config: {
      accessToken,
      adAccountId: own.adAccountId,
      apiVersion: read(environment, "META_GRAPH_API_VERSION"),
      campaignNameFilter: ownFilter,
      campaignNamePrefixes: ownPrefixes,
      expectedCurrency: account.currency,
      expectedAdAccountId: own.adAccountId,
      clientSlug: slug,
      includeCampaignBreakdown:
        environment.META_INCLUDE_CAMPAIGN_BREAKDOWN !== "false",
    },
  };
}

/**
 * Resolves a brand's Meta configuration against the stored credential registry.
 */
export async function loadMetaAdsConfig(
  clientSlug: string,
  environment: Environment = process.env,
  listStoredCustomerIds?: (platform: string) => Promise<StoredMetaAccount[]>,
): Promise<MetaAdsConfigResolution> {
  let storedAccounts: StoredMetaAccount[];
  try {
    const list =
      listStoredCustomerIds ??
      (await import("./token-storage")).listActiveConnectorCustomerIds;
    storedAccounts = await list("meta-ads");
  } catch {
    return {
      ok: false,
      clientSlug: clientSlug.trim(),
      state: "registry-unavailable",
      missing: [],
      safeMessage:
        "The stored Meta Ads account registry is unavailable, so this brand's account cannot be verified. Sync refused.",
    };
  }

  return resolveMetaAdsConfig(clientSlug, { storedAccounts, environment });
}
