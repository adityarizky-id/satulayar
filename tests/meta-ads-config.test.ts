import assert from "node:assert/strict";
import test from "node:test";

import {
  CANONICAL_META_BRAND_MAP,
  detectMetaAccountCollisions,
  normalizeMetaAdAccountId,
  resolveMetaAdAccountId,
  resolveMetaAdsConfig,
  resolveMetaCampaignFilter,
  resolveMetaCampaignPrefixes,
} from "@/lib/connectors/meta-ads-config";

test("form-saved Meta campaign scope and API version override demo defaults", () => {
  const resolved = resolveMetaAdsConfig("kopi-senja", { environment: {}, storedAccounts: [{ clientSlug: "kopi-senja", customerId: "123456789012345", campaignFilter: "", campaignPrefixes: [], apiVersion: "v23.0" }] });
  assert.ok(resolved.ok);
  assert.equal(resolved.config.adAccountId, "123456789012345");
  assert.equal(resolved.config.campaignNameFilter, "");
  assert.deepEqual(resolved.config.campaignNamePrefixes, []);
  assert.equal(resolved.config.apiVersion, "v23.0");
});

test("normalizeMetaAdAccountId handles act_ prefixes, whitespace, and validates digits", () => {
  assert.equal(normalizeMetaAdAccountId("100000000000001"), "100000000000001");
  assert.equal(normalizeMetaAdAccountId("act_100000000000001"), "100000000000001");
  assert.equal(normalizeMetaAdAccountId("  act_100000000000002  "), "100000000000002");
  assert.equal(normalizeMetaAdAccountId("invalid_123"), null);
  assert.equal(normalizeMetaAdAccountId(""), null);
  assert.equal(normalizeMetaAdAccountId(null), null);
});

test("canonical demo brand map defines expected accounts, filters, and currencies", () => {
  assert.equal(CANONICAL_META_BRAND_MAP["kopi-senja"].adAccountId, "100000000000001");
  assert.equal(CANONICAL_META_BRAND_MAP["kopi-senja"].campaignFilter, "Kopi Senja.");
  assert.equal(CANONICAL_META_BRAND_MAP["kopi-senja"].currency, "USD");

  assert.equal(CANONICAL_META_BRAND_MAP["jamu-alami"].adAccountId, "100000000000002");
  assert.equal(CANONICAL_META_BRAND_MAP["jamu-alami"].campaignFilter, "JMA ID");
  assert.equal(CANONICAL_META_BRAND_MAP["jamu-alami"].currency, "USD");

  assert.equal(CANONICAL_META_BRAND_MAP["kriya-bali"].adAccountId, "100000000000003");
  assert.equal(CANONICAL_META_BRAND_MAP["kriya-bali"].campaignFilter, "KRB");
  assert.equal(CANONICAL_META_BRAND_MAP["kriya-bali"].currency, "USD");
});

test("resolveMetaAdAccountId resolves stored, env, and canonical accounts in priority order", () => {
  // 1. Stored account takes precedence
  const stored = resolveMetaAdAccountId("jamu-alami", "999888777666555", {});
  assert.ok(stored.ok);
  assert.equal(stored.adAccountId, "999888777666555");
  assert.equal(stored.source, "connector-token");

  // 2. Brand env takes precedence over canonical
  const env = resolveMetaAdAccountId("jamu-alami", null, {
    META_AD_ACCOUNT_ID_JAMU_ALAMI: "111222333444555",
  });
  assert.ok(env.ok);
  assert.equal(env.adAccountId, "111222333444555");
  assert.equal(env.source, "brand-env");

  // 3. Falls back to canonical
  const canon = resolveMetaAdAccountId("jamu-alami", null, {});
  assert.ok(canon.ok);
  assert.equal(canon.adAccountId, "100000000000002");
  assert.equal(canon.source, "canonical-registry");
});

/**
 * A shared device can export META_AD_ACCOUNT_ID=act_100000000000002 at OS level
 * for an unrelated Meta MCP server, and that value can happen to be another
 * brand's own real ad account. Every test above passes an environment that
 * omits the brand-suffixed variables, so none of them reproduced the live
 * combination: .env.local supplies META_AD_ACCOUNT_ID_<BRAND> for all three
 * brands *and* the stray unsuffixed variable is present. In that combination
 * Jamu Alami was refused outright as "inherited from the pilot", and Jamu Alami and
 * Kriya Bali resolved with no access token at all. Both defects were invisible to
 * a green suite, so the live shape is pinned here.
 */
test("the full shared-device environment resolves all three Meta brands", () => {
  const environment = {
    // Stray, OS-level, belongs to no brand's configuration.
    META_AD_ACCOUNT_ID: "act_100000000000002",
    META_ADS_ACCESS_TOKEN: "shared-operator-token",
    META_AD_ACCOUNT_ID_KOPI_SENJA: "100000000000001",
    META_CAMPAIGN_NAME_FILTER_KOPI_SENJA: "Kopi Senja.",
    META_AD_ACCOUNT_ID_JAMU_ALAMI: "100000000000002",
    META_CAMPAIGN_NAME_FILTER_JAMU_ALAMI: "JMA ID",
    META_AD_ACCOUNT_ID_KRIYA_BALI: "100000000000003",
    META_CAMPAIGN_NAME_FILTER_KRIYA_BALI: "KRB",
  };

  const expected = [
    ["kopi-senja", "100000000000001", "Kopi Senja.", "USD"],
    ["jamu-alami", "100000000000002", "JMA ID", "USD"],
    ["kriya-bali", "100000000000003", "KRB", "USD"],
  ] as const;

  for (const [slug, adAccountId, filter, currency] of expected) {
    const resolution = resolveMetaAdsConfig(slug, {
      storedAccounts: [],
      environment,
    });
    assert.ok(resolution.ok, `${slug} must resolve, got: ${JSON.stringify(resolution)}`);
    assert.equal(resolution.config.adAccountId, adAccountId);
    assert.equal(resolution.config.expectedAdAccountId, adAccountId);
    assert.equal(resolution.config.campaignNameFilter, filter);
    assert.equal(resolution.config.expectedCurrency, currency);
    // A shared operator token authorises every brand; the account pin, not the
    // credential, is what keeps one brand out of another's account.
    assert.equal(resolution.config.accessToken, "shared-operator-token");
  }
});

test("a brand-suffixed access token overrides the shared one", () => {
  const resolution = resolveMetaAdsConfig("jamu-alami", {
    storedAccounts: [],
    environment: {
      META_ADS_ACCESS_TOKEN: "shared-operator-token",
      META_ADS_ACCESS_TOKEN_JAMU_ALAMI: "jamu-only-token",
      META_AD_ACCOUNT_ID_JAMU_ALAMI: "100000000000002",
    },
  });
  assert.ok(resolution.ok);
  assert.equal(resolution.config.accessToken, "jamu-only-token");
});

test("a stray unsuffixed account id never displaces a registered account", () => {
  // The pilot can inherit an OS-level META_AD_ACCOUNT_ID
  // belonging to a different advertiser. With no brand-suffixed variable set,
  // the canonical registry must still win, so the stray value is never read.
  const pilot = resolveMetaAdAccountId("kopi-senja", null, {
    META_AD_ACCOUNT_ID: "act_100000000000002",
  });
  assert.ok(pilot.ok);
  assert.equal(pilot.adAccountId, "100000000000001");
  assert.equal(pilot.source, "canonical-registry");

  // And a non-pilot brand never reads the unsuffixed variable at all.
  const kriya = resolveMetaAdAccountId("kriya-bali", null, {
    META_AD_ACCOUNT_ID: "act_100000000000002",
  });
  assert.ok(kriya.ok);
  assert.equal(kriya.adAccountId, "100000000000003");
});

test("resolveMetaCampaignFilter resolves from environment or canonical profile", () => {
  assert.equal(resolveMetaCampaignFilter("kopi-senja", {}), "Kopi Senja.");
  assert.equal(resolveMetaCampaignFilter("jamu-alami", {}), "JMA ID");
  assert.equal(
    resolveMetaCampaignFilter("jamu-alami", {
      META_CAMPAIGN_NAME_FILTER_JAMU_ALAMI: "CUSTOM FILTER",
    }),
    "CUSTOM FILTER",
  );
});

test("resolveMetaAdsConfig refuses brands that do not run Meta Ads", () => {
  const batik = resolveMetaAdsConfig("batik-lestari", { storedAccounts: [] });
  assert.equal(batik.ok, false);
  assert.equal(batik.state, "invalid");
  assert.match(batik.safeMessage, /does not run Meta Ads/);

  const rumahRajut = resolveMetaAdsConfig("rumah-rajut", { storedAccounts: [] });
  assert.equal(rumahRajut.ok, false);
  assert.equal(rumahRajut.state, "invalid");
  assert.match(rumahRajut.safeMessage, /does not run Meta Ads/);
});

test("resolveMetaAdsConfig resolves valid config for all 3 Meta brands with correct currencies", () => {
  const kopiSenja = resolveMetaAdsConfig("kopi-senja", { storedAccounts: [] });
  assert.ok(kopiSenja.ok);
  assert.equal(kopiSenja.config.expectedCurrency, "USD");
  assert.equal(kopiSenja.config.adAccountId, "100000000000001");
  assert.equal(kopiSenja.config.campaignNameFilter, "Kopi Senja.");

  const jamu = resolveMetaAdsConfig("jamu-alami", { storedAccounts: [] });
  assert.ok(jamu.ok);
  assert.equal(jamu.config.expectedCurrency, "USD");
  assert.equal(jamu.config.adAccountId, "100000000000002");
  assert.equal(jamu.config.campaignNameFilter, "JMA ID");

  const kriya = resolveMetaAdsConfig("kriya-bali", { storedAccounts: [] });
  assert.ok(kriya.ok);
  assert.equal(kriya.config.expectedCurrency, "USD");
  assert.equal(kriya.config.adAccountId, "100000000000003");
  assert.equal(kriya.config.campaignNameFilter, "KRB");
});

/**
 * Business-line isolation:
 * Kriya Bali strictly matches the "KRB" prefix.
 * Campaigns with another prefix such as "EW_" would belong to a separate
 * store with a distinct business model sharing the same ad account.
 * Merging EW_ into the retail line would be cross-business-model data contamination.
 */
test("Kriya Bali matches its KRB campaign code, and only as a prefix", () => {
  const prefixes = resolveMetaCampaignPrefixes("kriya-bali", {});
  assert.deepEqual([...prefixes], ["KRB"]);

  const matches = (name: string) =>
    prefixes.some((prefix) =>
      name.toLowerCase().startsWith(prefix.toLowerCase()),
    );

  // KRB codes are captured.
  for (const kept of [
    "KRB_BOFU_New Order",
    "KRB_TOFU_New Registration",
    "krb_bofu_promo", // case-insensitive
  ]) {
    assert.ok(matches(kept), `${kept} must be kept`);
  }

  // Other codes (including EW_, JMA_, BTK_) must stay out.
  for (const dropped of [
    "EW_Signup_Campaign",
    "EW_Purchase_All",
    "EW_Remarketing",
    "JMA_FBBoost_Video",
    "BTK_Signup_Campaign",
    "RJT_IGBoost",
    "KSN_PurchaseAll",
  ]) {
    assert.equal(matches(dropped), false, `${dropped} must be dropped`);
  }

  // Prefix, not substring: "EW_" is two letters and would otherwise swallow
  // any campaign that merely contains it.
  for (const dropped of [
    "Fresh BREW_Bundle",
    "CREW_Rollout",
    "JMA ID - EW_lookalike",
  ]) {
    assert.equal(
      matches(dropped),
      false,
      `${dropped} must not match on a substring`,
    );
  }
});

test("the other two Meta brands keep the substring rule untouched", () => {
  assert.deepEqual([...resolveMetaCampaignPrefixes("kopi-senja", {})], []);
  assert.deepEqual([...resolveMetaCampaignPrefixes("jamu-alami", {})], []);

  // Kopi Senja Nusantara campaigns are "Kopi senja. | ..." — a prefix rule would
  // still work, but the substring rule is what tolerates the case drift the
  // account actually has, so it must not be swapped out by this change.
  const kopiSenja = resolveMetaAdsConfig("kopi-senja", { storedAccounts: [] });
  assert.ok(kopiSenja.ok);
  assert.equal(kopiSenja.config.campaignNameFilter, "Kopi Senja.");
  assert.deepEqual([...(kopiSenja.config.campaignNamePrefixes ?? [])], []);
});

test("prefixes outrank a stale META_CAMPAIGN_NAME_FILTER but an explicit prefix env wins", () => {
  // A device can still export an old substring filter. Honouring it would
  // silently undo the prefix rule, so the canonical prefixes take precedence.
  const stale = resolveMetaAdsConfig("kriya-bali", {
    storedAccounts: [],
    environment: {
      META_AD_ACCOUNT_ID_KRIYA_BALI: "100000000000003",
      META_CAMPAIGN_NAME_FILTER_KRIYA_BALI: "KRB",
    },
  });
  assert.ok(stale.ok);
  assert.deepEqual([...(stale.config.campaignNamePrefixes ?? [])], ["KRB"]);

  // An operator can still pin the rule, but only through the prefixes key.
  const pinned = resolveMetaCampaignPrefixes("kriya-bali", {
    META_CAMPAIGN_NAME_PREFIXES_KRIYA_BALI: "KRB",
  });
  assert.deepEqual([...pinned], ["KRB"]);
});

test("detectMetaAccountCollisions flags collision only when account and filter are both identical", () => {
  // Different accounts -> no collision
  const noCollision = detectMetaAccountCollisions([
    { clientSlug: "kopi-senja", adAccountId: "100", filter: "Filter A" },
    { clientSlug: "jamu-alami", adAccountId: "200", filter: "Filter B" },
  ]);
  assert.equal(noCollision.size, 0);

  // Same account but distinct filters -> no collision (shared umbrella account pattern)
  const sharedAccountDistinctFilters = detectMetaAccountCollisions([
    { clientSlug: "kopi-senja", adAccountId: "100", filter: "Kopi Senja." },
    { clientSlug: "other-brand", adAccountId: "100", filter: "Other Brand." },
  ]);
  assert.equal(sharedAccountDistinctFilters.size, 0);

  // Same account and identical filter -> collision
  const collision = detectMetaAccountCollisions([
    { clientSlug: "kopi-senja", adAccountId: "100", filter: "Same Filter" },
    { clientSlug: "copycat", adAccountId: "100", filter: "same filter" },
  ]);
  assert.equal(collision.size, 1);
});
