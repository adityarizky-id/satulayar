import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { resolveClientScope } from "@/lib/auth/client-scope";
import { PILOT_CLIENT_SLUG } from "@/lib/auth/constants";
import { resolveGa4PropertyId } from "@/lib/connectors/ga4-sync";
import {
  ACCOUNT_OPTIONS,
  accountSlugs,
  isAccountSlug,
  resolveAccount,
} from "@/lib/dashboard/accounts";

const V1_GATE_SLUGS = [
  "kopi-senja",
  "batik-lestari",
  "rumah-rajut",
  "jamu-alami",
  "kriya-bali",
];

// ------------------------------------------------------------ brand registry

test("the five v1 brand scopes are the allowlist, with their own currency and timezone", () => {
  assert.deepEqual(accountSlugs().toSorted(), V1_GATE_SLUGS.toSorted());

  // Each brand declares its own timezone and currency rather than inheriting a
  // global one: yesterday in Makassar is not always yesterday in Jakarta, and a
  // USD account read as IDR is wrong in a way no later gate can detect.
  for (const account of ACCOUNT_OPTIONS) {
    assert.match(account.timezone, /^[A-Za-z]+\/[A-Za-z_]+$/);
    assert.equal(account.currency, "USD", `${account.slug} is a USD demo account`);
  }
  assert.notEqual(
    resolveAccount("kriya-bali").timezone,
    resolveAccount("kopi-senja").timezone,
  );
});

test("platform coverage follows the brand, not a global assumption", () => {
  assert.deepEqual(resolveAccount("batik-lestari").platforms, ["google"]);
  assert.deepEqual(resolveAccount("rumah-rajut").platforms, ["google"]);
  assert.deepEqual(resolveAccount("jamu-alami").platforms, ["meta", "google"]);
  assert.deepEqual(resolveAccount("kopi-senja").platforms, ["meta", "google"]);
});

// ------------------------------------------------------------- scope parsing

test("an absent client keeps the pilot default so existing callers still work", () => {
  for (const value of [undefined, null, ""]) {
    const scope = resolveClientScope(value);
    assert.equal(scope.ok, true);
    if (!scope.ok) return;
    assert.equal(scope.clientSlug, PILOT_CLIENT_SLUG);
  }
});

test("a valid brand slug is accepted exactly as named", () => {
  for (const slug of V1_GATE_SLUGS) {
    const scope = resolveClientScope(slug);
    assert.equal(scope.ok, true, `${slug} must be accepted`);
    if (!scope.ok) continue;
    assert.equal(scope.clientSlug, slug);
  }
});

test("an unknown client is refused, never coerced to the pilot", () => {
  // Coercion is the dangerous failure: it would write one brand's consent into
  // another brand's row, or revoke the wrong credential entirely.
  for (const value of [
    "unknown-brand",
    "kopiSenja cat",
    "KOPI_SENJA-CAT",
    "../kopi-senja",
    "'; drop table clients; --",
    42,
    {},
    [],
    true,
  ]) {
    const scope = resolveClientScope(value);
    assert.equal(scope.ok, false, `${JSON.stringify(value)} must be refused`);
    if (scope.ok) continue;
    assert.match(scope.message, /Unknown client/);
  }

  // Surrounding whitespace is normalised rather than refused: it still names
  // exactly one brand, and the trimmed value is what reaches the database, so
  // the token row cannot end up keyed by a slug with a stray space. Case is a
  // different matter and stays strict, because slugs are lowercase keys.
  const padded = resolveClientScope("  batik-lestari  ");
  assert.equal(padded.ok, true);
  if (padded.ok) assert.equal(padded.clientSlug, "batik-lestari");
});

test("isAccountSlug is strict where resolveAccount is forgiving", () => {
  // resolveAccount falls back to the first brand, which is right for a stale
  // cookie and wrong for a request parameter.
  assert.equal(resolveAccount("does-not-exist").slug, "kopi-senja");
  assert.equal(isAccountSlug("does-not-exist"), false);
  assert.equal(isAccountSlug("batik-lestari"), true);
});

// --------------------------------------------------------- per-brand GA4 ids

test("a GA4 property is resolved per brand and never inherited by another", () => {
  const environment = {
    // The unsuffixed variable is the pilot's own property.
    GA4_PROPERTY_ID: "111111111",
    GA4_PROPERTY_ID_JAMU_ALAMI: "222222222",
  };

  assert.equal(resolveGa4PropertyId("jamu-alami", environment), "222222222");
  assert.equal(resolveGa4PropertyId("kopi-senja", environment), "111111111");

  // A brand with no property of its own resolves to nothing, and the GA4 sync
  // skips it. Inheriting here would pull the pilot's website traffic and store
  // it under this brand's client id — mislabelled rows that RLS cannot catch,
  // because the operator is a member of every brand.
  assert.equal(resolveGa4PropertyId("batik-lestari", environment), "");
  assert.equal(resolveGa4PropertyId("rumah-rajut", environment), "");
  assert.equal(resolveGa4PropertyId("kriya-bali", environment), "");

  // No brand named at all is a request for the default property, not an
  // inheritance: there is no brand here to mislabel rows under.
  assert.equal(resolveGa4PropertyId(undefined, environment), "111111111");
  assert.equal(resolveGa4PropertyId("jamu-alami", {}), "");
  assert.equal(resolveGa4PropertyId("kopi-senja", {}), "");
});

// ------------------------------------------------------- routes and schedule

test("no connector route still hardcodes the pilot brand", async () => {
  const sources = await Promise.all(
    [
      "../src/app/api/connectors/oauth/[platform]/authorize/route.ts",
      "../src/app/api/connectors/oauth/[platform]/callback/route.ts",
      "../src/app/api/connectors/backfill/route.ts",
      "../src/app/api/connectors/disconnect/route.ts",
      "../src/app/api/cron/daily-sync/route.ts",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
  );

  for (const source of sources) {
    assert.doesNotMatch(source, /PILOT_CLIENT_SLUG/);
  }
});

test("each connector route validates the brand before it acts on a credential", async () => {
  const [authorize, callback, backfill, disconnect] = await Promise.all(
    [
      "../src/app/api/connectors/oauth/[platform]/authorize/route.ts",
      "../src/app/api/connectors/oauth/[platform]/callback/route.ts",
      "../src/app/api/connectors/backfill/route.ts",
      "../src/app/api/connectors/disconnect/route.ts",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
  );

  for (const source of [authorize, callback, backfill, disconnect]) {
    assert.match(source, /resolveClientScope\(/);
    assert.match(source, /resolveAuthContext\(scope\.clientSlug\)/);
  }

  // The brand has to survive the round trip to the provider, and the provider
  // echoes only `state` back.
  assert.match(authorize, /oauth_client_\$\{platform\}/);
  assert.match(callback, /oauth_client_\$\{platform\}/);
  // The callback re-validates the cookie it just read rather than trusting it.
  assert.match(callback, /resolveClientScope\(\s*\n?\s*request\.cookies\.get/);
  assert.match(callback, /clientSlug: scope\.clientSlug/);

  // Destructive and write paths resolve the brand before authorising, so the
  // permission check applies to the brand actually being acted on.
  for (const source of [backfill, disconnect]) {
    assert.ok(
      source.indexOf("resolveClientScope(") < source.indexOf("resolveAuthContext("),
      "the brand must be resolved before the session is checked against it",
    );
  }
  assert.match(disconnect, /revokeConnectorToken\(platform, scope\.clientSlug\)/);
});

test("the dashboard reads and labels the brand that was selected, not the pilot", async () => {
  const [page, route] = await Promise.all(
    ["../src/app/page.tsx", "../src/app/api/dashboard/route.ts"].map((path) =>
      readFile(new URL(path, import.meta.url), "utf8"),
    ),
  );

  // Authorising the pilot and reading its rows is what put the pilot's
  // figures under every other brand name.
  for (const source of [page, route]) {
    assert.doesNotMatch(source, /PILOT_CLIENT_SLUG/);
  }

  assert.match(page, /resolveAuthContext\(account\.slug\)/);
  assert.ok(
    page.indexOf("resolveAccount(") < page.indexOf("resolveAuthContext("),
    "the brand must be known before the session is checked against it",
  );

  // The refetch validates strictly: a bad slug is refused, never read as pilot.
  assert.match(route, /resolveClientScope\(request\.nextUrl\.searchParams\.get\("account"\)\)/);
  assert.match(route, /resolveAuthContext\(scope\.clientSlug\)/);
  assert.ok(route.indexOf("resolveClientScope(") < route.indexOf("resolveAuthContext("));
  assert.match(route, /status: 400/);
  // The hero badge follows the brand contract, never a literal.
  assert.match(route, /currency: account\.currency/);
  assert.doesNotMatch(route, /currency: "GBP"/);
});

test("store analytics reads GA4 for the selected brand, not the pilot", async () => {
  const [page, route] = await Promise.all(
    [
      "../src/app/store-analytics/page.tsx",
      "../src/app/api/store-analytics/route.ts",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
  );

  // This route reads `ga4_daily_metrics` by the session's client id while the
  // store, currency and timezone came from the `account` parameter. Pinning the
  // session to the pilot therefore rendered Kopi Senja Nusantara sessions, purchases and
  // revenue under whichever brand the reader had selected.
  for (const source of [page, route]) {
    assert.doesNotMatch(source, /PILOT_CLIENT_SLUG/);
  }

  assert.match(page, /resolveActiveClientSlug\(/);
  assert.match(page, /ACCOUNT_COOKIE/);
  assert.match(page, /resolveAuthContext\(account\.slug\)/);
  assert.ok(
    page.indexOf("resolveActiveClientSlug(") < page.indexOf("resolveAuthContext("),
    "the brand must be known before the session is checked against it",
  );

  // The refetch validates strictly: a bad slug is refused, never read as pilot.
  assert.match(route, /resolveClientScope\(params\.get\("account"\)\)/);
  assert.match(route, /resolveClientScope\(body\.account\)/);
  assert.match(route, /resolveAuthContext\(scope\.clientSlug\)/);
  assert.ok(
    route.indexOf("resolveClientScope(") < route.indexOf("resolveAuthContext("),
    "the brand must be resolved before the session is checked against it",
  );

  // The snapshot is built from the slug the session was checked against, so the
  // brand that is read and the brand that is labelled cannot drift apart.
  assert.match(route, /const account = resolveAccount\(clientSlug\)/);
  assert.match(route, /auth\.access\.clientSlug !== account\.slug/);
});

test("a mock store request never reaches Supabase", async () => {
  const route = await readFile(
    new URL("../src/app/api/store-analytics/route.ts", import.meta.url),
    "utf8",
  );

  // Fail-closed: mock is its own gate, ahead of the storage check and ahead of
  // every read. Deriving the bypass from `configuration.storage` alone would
  // make it depend on a coupling inside validation.ts that could be relaxed.
  const mockGate = route.indexOf('configuration.mode === "mock"');
  const storageGate = route.indexOf('configuration.storage !== "supabase"');
  const read = route.indexOf("readGa4DailyMetrics(");

  assert.ok(mockGate > -1, "mock must be checked explicitly");
  assert.ok(mockGate < storageGate, "mock is checked before storage");
  assert.ok(mockGate < read, "mock is checked before any GA4 read");

  // The requested mode is forwarded to the shared resolver rather than being
  // re-implemented, and only the two contract values survive parsing.
  assert.match(route, /getDashboardDataConfiguration\(\s*\n?\s*process\.env as DashboardDataEnvironment,\s*\n?\s*requestedMode,/);
  assert.match(route, /parseDataMode\(/);
  const validation = await readFile(
    new URL("../src/lib/dashboard/validation.ts", import.meta.url),
    "utf8",
  );
  assert.match(validation, /value === "mock" \|\| value === "live"/);

  // The synthetic answer stays labelled `mode: "dummy"`. Live GA4 replaces
  // traffic only, so relabelling the snapshot would strip the SYNTHETIC- prefix
  // from customer-match exports whose rows are still invented.
  assert.doesNotMatch(route, /mode: "live"/);

  const page = await readFile(
    new URL("../src/app/store-analytics/page.tsx", import.meta.url),
    "utf8",
  );

  // SSR applies the same gate before its own read, and keeps the soft fallback.
  assert.match(page, /configuration\.mode === "live"/);
  assert.match(page, /configuration\.storage === "supabase"/);
  assert.match(page, /auth\.context\.mode === "supabase"/);
  assert.ok(
    page.indexOf('configuration.mode === "live"') <
      page.indexOf("readGa4DailyMetrics("),
    "the mode gate must sit before the read",
  );
  assert.match(page, /storeSnapshot = syntheticSnapshot/);
});

// Decided after the store-analytics security audit.
//
// `StoreAnalyticsSnapshot.mode` is provenance for the STORE data, not for the
// data-mode toggle. It stays "dummy" until a store connector is connected, because the GA4
// bridge replaces traffic aggregates only — `rfm.customers` is still generated
// by `src/lib/store/fixtures.ts`. That field is what drives the SYNTHETIC-
// prefix on the customer-match export, and `acknowledgeSyntheticData` is parsed
// but enforced nowhere, so the prefix is the only guard left. Labelling the
// snapshot "live" would hand an operator a CSV of invented names, emails,
// phone numbers and postcodes named like a genuine customer list.
//
// Live traffic status travels in the `modeStatus` sibling key instead.
test("the store snapshot stays labelled dummy, so synthetic exports stay marked", async () => {
  const { buildStoreAnalyticsSnapshot } = await import("@/lib/store/analytics");
  const { audienceExportFilename } = await import(
    "@/lib/dashboard/audience-export-request"
  );

  const snapshot = buildStoreAnalyticsSnapshot({
    start: "2026-09-01",
    end: "2026-09-14",
  });

  assert.equal(
    snapshot.mode,
    "dummy",
    "the default provenance label must be dummy",
  );
  assert.match(
    audienceExportFilename(
      { preset: "meta-value-based" },
      "kopi-senja",
      "2026-09-14",
      snapshot.mode,
    ),
    /^SYNTHETIC-/,
    "a snapshot built from fixtures must export under the SYNTHETIC- prefix",
  );

  // No caller may opt into the "live" label while order and customer rows are
  // still fixtures. The option exists for when a store connector lands; nothing uses it yet.
  for (const file of [
    "../src/app/api/store-analytics/route.ts",
    "../src/app/store-analytics/page.tsx",
    "../src/components/store/store-analytics-shell.tsx",
  ]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(
      source,
      /mode: "live"/,
      `${file} must not label a fixture-backed snapshot as live`,
    );
  }
});

test("a missing membership never borrows the pilot client for another brand", async () => {
  const session = await readFile(
    new URL("../src/lib/auth/session.ts", import.meta.url),
    "utf8",
  );

  // Access comes only from a membership row: there is no allowlist fallback
  // that hands out a fixed client id.
  assert.doesNotMatch(session, /isAllowedLoginEmail/);
  assert.match(session, /client_access_denied/);
});

test("the scheduled run resolves every allowlisted brand and isolates failures", async () => {
  const source = await readFile(
    new URL("../src/app/api/cron/daily-sync/route.ts", import.meta.url),
    "utf8",
  );

  // The allowlist drives discovery. Google brands can share the MCC grant,
  // while each platform's loader still has to resolve this exact brand.
  assert.match(source, /ACCOUNT_OPTIONS\.map/);
  assert.match(source, /loadGoogleAdsConfig\(account\.slug\)/);
  assert.match(source, /loadMetaAdsConfig\(account\.slug\)/);
  assert.match(source, /for \(const connected of connectedClients\)/);
  // Per-brand window and only the platforms that resolved for that brand.
  assert.match(source, /resolveScheduledSyncWindow\(account\.timezone\)/);
  assert.match(source, /platforms,/);
  // The try sits inside the loop: one brand failing must not end the run.
  const loopIndex = source.indexOf("for (const connected of connectedClients)");
  const tryIndex = source.indexOf("try {", loopIndex);
  const closingIndex = source.indexOf("outcome: \"failed\"", loopIndex);
  assert.ok(loopIndex > -1 && tryIndex > loopIndex && closingIndex > tryIndex);
  assert.match(source, /other clients were unaffected/);
});

test("nothing connected is reported as a state, not an error", async () => {
  const source = await readFile(
    new URL("../src/app/api/cron/daily-sync/route.ts", import.meta.url),
    "utf8",
  );

  // A deployment where no brand is connected yet must not page anyone daily.
  assert.match(source, /connectedClients\.length === 0/);
  assert.match(source, /nothing to pull/);
  assert.match(source, /clients: \[\],\s*\n\s*lookbackDays/);
});

test("the seed migration provisions every brand without leaking an account id", async () => {
  const migration = await readFile(
    new URL(
      "../supabase/migrations/0008_seed_remaining_brand_clients.sql",
      import.meta.url,
    ),
    "utf8",
  );

  for (const slug of V1_GATE_SLUGS.filter((item) => item !== "kopi-senja")) {
    assert.match(migration, new RegExp(`'${slug}'`));
  }
  // Re-running the migration must change nothing.
  assert.match(migration, /on conflict \(slug\) do nothing/);
  assert.match(migration, /on conflict \(user_id, client_id\) do nothing/);
  assert.match(migration, /on conflict \(client_id, platform, account_key\) do nothing/);
  // Memberships are resolved by email, so the migration survives a fresh
  // project where the user ids differ.
  assert.match(migration, /from public\.app_users u/);
  // The opaque key is used, and no raw platform identifier appears anywhere.
  assert.match(migration, /seed\.platform \|\| '-live-v1'/);
  assert.doesNotMatch(migration, /\b\d{9,}\b/);
});

// ------------------------------------------------- active brand on data sources

test("an explicit brand wins over the selector cookie and is validated strictly", async () => {
  const { resolveActiveClientSlug } = await import("@/lib/auth/client-scope");

  const explicit = resolveActiveClientSlug({ requested: "batik-lestari", cookie: "jamu-alami" });
  assert.ok(explicit.ok && explicit.clientSlug === "batik-lestari");

  // A deliberate but unknown value is refused, never swapped for the cookie or
  // the pilot: that swap would read one brand's connectors under another's name.
  const unknown = resolveActiveClientSlug({ requested: "not-a-brand", cookie: "jamu-alami" });
  assert.equal(unknown.ok, false);
});

test("without an explicit brand the selector cookie decides, and a stale cookie keeps the pilot", async () => {
  const { resolveActiveClientSlug } = await import("@/lib/auth/client-scope");

  for (const slug of V1_GATE_SLUGS) {
    const scope = resolveActiveClientSlug({ requested: null, cookie: slug });
    assert.ok(scope.ok && scope.clientSlug === slug, `${slug} from cookie`);
  }

  for (const cookie of [undefined, null, "", "renamed-brand"]) {
    const scope = resolveActiveClientSlug({ requested: undefined, cookie });
    assert.ok(scope.ok && scope.clientSlug === PILOT_CLIENT_SLUG);
  }
});

test("the data sources page and its routes act on the active brand, not the pilot constant", async () => {
  for (const file of [
    "../src/app/data-sources/page.tsx",
    "../src/app/api/connector-health/route.ts",
    "../src/app/api/connectors/test/route.ts",
    "../src/app/api/sync-jobs/route.ts",
    "../src/app/api/sync-jobs/[id]/route.ts",
  ]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /PILOT_CLIENT_SLUG/, `${file} must not pin the pilot`);
    assert.match(source, /resolveActiveClientSlug\(/, `${file} must resolve the active brand`);
    assert.match(source, /ACCOUNT_COOKIE/, `${file} must read the brand selector`);
  }

  const page = await readFile(new URL("../src/app/data-sources/page.tsx", import.meta.url), "utf8");
  assert.match(page, /resolveAuthContext\(clientSlug\)/);
  assert.match(page, /getLatestConnectorTokenUpdatedAt\(clientSlug\)/);
  assert.match(page, /\.eq\("client_slug", clientSlug\)/);
  assert.match(page, /resolveAccount\(clientSlug\)\.timezone/);
});
