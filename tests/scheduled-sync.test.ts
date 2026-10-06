import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  isAuthorizedScheduledRequest,
  resolveManualSyncWindow,
  resolveScheduledImpressionShareWindow,
  resolveScheduledSyncWindow,
  SCHEDULED_IMPRESSION_SHARE_LOOKBACK_DAYS,
  SCHEDULED_SYNC_LOOKBACK_DAYS,
} from "@/lib/connectors/scheduled-sync";

test("a manual refresh extends a stale filter through today in the account timezone", () => {
  const requested = { start: "2026-09-01", end: "2026-09-18" };
  const instant = new Date("2026-09-19T22:30:00.000Z");

  // Jakarta has crossed midnight; London has not. The active brand—not UTC and
  // not the browser—decides which open day the API must request.
  assert.deepEqual(
    resolveManualSyncWindow(requested, "Asia/Jakarta", instant),
    { start: "2026-09-01", end: "2026-09-20" },
  );
  assert.deepEqual(
    resolveManualSyncWindow(requested, "Europe/London", instant),
    { start: "2026-09-01", end: "2026-09-19" },
  );
});

test("a manual refresh refuses a future-only period", () => {
  assert.throws(
    () =>
      resolveManualSyncWindow(
        { start: "2026-09-21", end: "2026-09-22" },
        "Asia/Jakarta",
        new Date("2026-09-20T09:00:00.000Z"),
      ),
    /cannot start after today/i,
  );
});

test("the scheduled window ends yesterday in the account timezone", () => {
  // 00:30 UTC on 12 September is still 01:30 in London, so "yesterday" is the
  // 11th for the account, not the 10th a UTC-only calculation would give.
  const window = resolveScheduledSyncWindow(
    "Europe/London",
    new Date("2026-09-12T00:30:00.000Z"),
  );

  assert.deepEqual(window, { start: "2026-09-05", end: "2026-09-11" });
  assert.equal(SCHEDULED_SYNC_LOOKBACK_DAYS, 7);
});

test("the scheduled window never includes the open day", () => {
  const today = "2026-09-12";
  const window = resolveScheduledSyncWindow(
    "Etc/GMT",
    new Date(`${today}T23:59:00.000Z`),
  );

  // An open day stores provisional rows, which would make every scheduled
  // snapshot report itself as partial.
  assert.ok(window.end < today);
  assert.equal(window.end, "2026-09-11");
});

test("the scheduled impression-share window matches the default rolling 14 days", () => {
  const window = resolveScheduledImpressionShareWindow(
    "Europe/London",
    new Date("2026-09-12T09:00:00.000Z"),
  );

  assert.deepEqual(window, { start: "2026-08-30", end: "2026-09-12" });
  assert.equal(SCHEDULED_IMPRESSION_SHARE_LOOKBACK_DAYS, 14);
});

test("a custom lookback is honoured and a nonsensical one is refused", () => {
  const window = resolveScheduledSyncWindow(
    "Europe/London",
    new Date("2026-09-12T09:00:00.000Z"),
    1,
  );

  assert.deepEqual(window, { start: "2026-09-11", end: "2026-09-11" });
  for (const invalid of [0, -3, 2.5]) {
    assert.throws(
      () => resolveScheduledSyncWindow("Europe/London", new Date(), invalid),
      /whole number of days/,
    );
  }
});

test("the scheduled trigger is closed without a configured secret", () => {
  // An unprotected deployment must expose no refresh trigger at all.
  assert.equal(isAuthorizedScheduledRequest("Bearer anything", undefined), false);
  assert.equal(isAuthorizedScheduledRequest("Bearer anything", "   "), false);
});

test("the scheduled trigger accepts only the exact secret", () => {
  const secret = "cron-secret-test-value";

  assert.equal(isAuthorizedScheduledRequest(`Bearer ${secret}`, secret), true);
  assert.equal(isAuthorizedScheduledRequest(`Bearer ${secret}x`, secret), false);
  assert.equal(
    isAuthorizedScheduledRequest(`Bearer ${secret.slice(0, -1)}X`, secret),
    false,
  );
  assert.equal(isAuthorizedScheduledRequest(secret, secret), false);
  assert.equal(isAuthorizedScheduledRequest(null, secret), false);
});

test("vercel.json schedules the refresh once a day on the cron route", async () => {
  const config = JSON.parse(
    await readFile(new URL("../vercel.json", import.meta.url), "utf8"),
  ) as { crons?: { path?: string; schedule?: string }[] };

  assert.equal(config.crons?.length, 1);
  assert.equal(config.crons?.[0].path, "/api/cron/daily-sync");
  // Five fields, and a fixed hour rather than a per-minute or hourly schedule.
  const schedule = config.crons?.[0].schedule ?? "";
  assert.equal(schedule.split(" ").length, 5);
  assert.match(schedule, /^\d+ \d+ \* \* \*$/);
});

test("the cron route fails closed on authorisation, mode, and the live gate", async () => {
  const routeSource = await readFile(
    new URL("../src/app/api/cron/daily-sync/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(routeSource, /isAuthorizedScheduledRequest\(request\.headers\.get\("authorization"\)\)/);
  assert.match(routeSource, /status: 401/);
  assert.match(routeSource, /resolveLiveSyncGate\(\)/);
  assert.match(routeSource, /configuration\.mode !== "live"/);
  // A machine run must not borrow an operator identity.
  assert.match(routeSource, /requestedBy: null/);
  assert.match(routeSource, /trigger: "scheduled"/);
  assert.match(routeSource, /ACCOUNT_OPTIONS\.map/);
  assert.match(routeSource, /loadGoogleAdsConfig\(account\.slug\)/);
  assert.match(routeSource, /loadMetaAdsConfig\(account\.slug\)/);
  assert.match(routeSource, /impressionShareRange/);
  assert.doesNotMatch(routeSource, /listActiveConnectorClientSlugs/);
  // The secret is compared in one place and never read, echoed, or logged here.
  assert.doesNotMatch(routeSource, /process\.env\.CRON_SECRET/);
  assert.doesNotMatch(routeSource, /console\./);
});

test("a scheduled job is identifiable in the audit trail", async () => {
  const serverSource = await readFile(
    new URL("../src/lib/supabase/server.ts", import.meta.url),
    "utf8",
  );

  assert.match(serverSource, /trigger = input\.trigger \?\? "operator"/);
  assert.match(serverSource, /platforms: input\.platforms, trigger/);
  assert.match(serverSource, /export async function resolveClientIdBySlug/);
});

test("manual refresh persists first, reloads the confirmed range, and polls the active brand", async () => {
  const routeSource = await readFile(
    new URL("../src/app/api/sync-jobs/route.ts", import.meta.url),
    "utf8",
  );
  const pollingSource = await readFile(
    new URL("../src/app/api/sync-jobs/[id]/route.ts", import.meta.url),
    "utf8",
  );
  const shellSource = await readFile(
    new URL("../src/components/dashboard/dashboard-shell.tsx", import.meta.url),
    "utf8",
  );
  const pageSource = await readFile(
    new URL("../src/app/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(routeSource, /resolveManualSyncWindow\(/);
  assert.match(routeSource, /account\.timezone/);
  assert.match(routeSource, /await persistLiveSync\(/);
  assert.match(shellSource, /requestSnapshot\(finishedJob\.requestedRange\)/);
  assert.match(shellSource, /\.\.\.finishedJob\.requestedRange/);
  assert.match(shellSource, /\?account=\$\{encodeURIComponent\(account\)\}/);
  assert.match(pollingSource, /resolveActiveClientSlug\(/);
  assert.doesNotMatch(pollingSource, /PILOT_CLIENT_SLUG/);
  assert.match(pageSource, /initialSnapshot\.lastSuccessfulSync/);
  assert.doesNotMatch(pageSource, /getLatestConnectorTokenUpdatedAt/);
});
