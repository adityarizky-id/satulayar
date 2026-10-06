import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { accountSlugs } from "@/lib/dashboard/accounts";
import {
  budgetsCookieName,
  buildBudgetPacing,
  DEFAULT_BUDGETS,
  LEGACY_BUDGETS_COOKIE,
  parseBudgetsCookie,
} from "@/lib/dashboard/budget";
import {
  REPORTING_CYCLE_DAYS,
  resolvePacingCycle,
  resolveReportingCycle,
  resolveReportingCycleForRange,
} from "@/lib/dashboard/timeframes";
import type { Currency, DailyMetric, Platform } from "@/lib/dashboard/types";

/**
 * Two failures met in the same card and are tested together here.
 *
 * The plan lived in one browser cookie shared by all five brands, so selecting
 * Kriya Bali paced euro spend against the pound figure last typed for
 * Kopi Senja Nusantara. And the card printed the prorated window share where the agreed
 * monthly budget belonged: a 25-day slice of a 150 plan reached the team as
 * "spent 125 of 125", a budget nobody had agreed.
 */

function row(
  date: string,
  platform: Exclude<Platform, "all">,
  spend: number,
  currency: Currency = "GBP",
): DailyMetric {
  return {
    date,
    clientId: "demo",
    accountId: "demo",
    platform,
    currency,
    accountTimezone: "Europe/London",
    spend,
    impressions: 1_000,
    clicks: 40,
    landingPageViews: 30,
    registrations: 4,
    purchases: 1,
    platformConversionValue: 80,
    actualPurchaseRevenue: 60,
    sourceConnector: "mock",
    sourceQueryVersion: "fixture-v1",
    syncedAt: "2026-09-19T00:00:00.000Z",
    isProvisional: false,
  };
}

/** `from` plus `offset` days, as an inclusive YYYY-MM-DD day. */
function day(from: string, offset: number): string {
  return new Date(Date.parse(`${from}T00:00:00Z`) + offset * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** A minimal stand-in for the browser's cookie jar. */
function jar(entries: Record<string, string>) {
  return (name: string): string | undefined => entries[name];
}

test("each brand keeps its plan in its own cookie, and no two brands collide", () => {
  const names = accountSlugs().map(budgetsCookieName);

  assert.equal(new Set(names).size, names.length);
  // The old global name must not be reachable as any brand's cookie, or the
  // shell's own expiry of it would wipe a live plan.
  assert.ok(!names.includes(LEGACY_BUDGETS_COOKIE));
  assert.equal(budgetsCookieName("kopi-senja"), "sl_budgets_kopi-senja");
});

test("a plan typed for one brand is invisible to every other brand", () => {
  const cookies = jar({
    [budgetsCookieName("kopi-senja")]: "350,150",
  });

  assert.deepEqual(
    parseBudgetsCookie(cookies(budgetsCookieName("kopi-senja"))),
    { meta: 350, google: 150 },
  );

  // The other four brands each read their own name and find
  // nothing, so they fall back to the placeholder rather than to Kopi Senja's
  // pounds. This is the leak: before the split all four read "350,150".
  for (const slug of accountSlugs().filter((item) => item !== "kopi-senja")) {
    assert.deepEqual(
      parseBudgetsCookie(cookies(budgetsCookieName(slug))),
      DEFAULT_BUDGETS,
      `${slug} inherited another brand's plan`,
    );
  }
});

test("the legacy global cookie is never read back as a brand's plan", () => {
  const cookies = jar({ [LEGACY_BUDGETS_COOKIE]: "999,999" });

  // A global cookie cannot be attributed to one brand without guessing which
  // brand was selected when it was written. Every brand ignores it.
  for (const slug of accountSlugs()) {
    assert.deepEqual(
      parseBudgetsCookie(cookies(budgetsCookieName(slug))),
      DEFAULT_BUDGETS,
      `${slug} inherited the legacy global cookie`,
    );
  }
});

test("writing one brand's plan leaves every other brand's untouched", () => {
  const store = new Map<string, string>();
  const write = (slug: string, value: string) =>
    store.set(budgetsCookieName(slug), value);

  write("kopi-senja", "350,150");
  write("kriya-bali", "400,600");
  // Re-agreeing Kopi Senja's plan must not reach Kriya Bali's row.
  write("kopi-senja", "500,250");

  assert.deepEqual(
    parseBudgetsCookie(store.get(budgetsCookieName("kopi-senja"))),
    { meta: 500, google: 250 },
  );
  assert.deepEqual(
    parseBudgetsCookie(store.get(budgetsCookieName("kriya-bali"))),
    { meta: 400, google: 600 },
  );
  assert.deepEqual(
    parseBudgetsCookie(store.get(budgetsCookieName("jamu-alami"))),
    DEFAULT_BUDGETS,
  );
});

test("the agreed budget is paced over the whole cycle, never prorated to the filter", () => {
  // The reported case: a 150 plan for the 24 Aug cycle, 25 days in, 125 spent.
  const rows = Array.from({ length: 25 }, (_, index) =>
    row(day("2026-08-24", index), "google", 5),
  );
  const pacing = buildBudgetPacing(
    rows,
    { start: "2026-08-24", end: "2026-09-17" },
    { meta: 350, google: 150 },
    "GBP",
    "google",
    "2026-09-17",
    { source: "agreed", cycleStart: "2026-08-24" },
  );
  const google = pacing.platforms.find((item) => item.platform === "google");

  // The number the team agreed is the only budget figure there is. No
  // prorated share exists to be mistaken for it.
  assert.equal(google?.monthlyBudget, 150);
  assert.equal(google?.spentToDate, 125);
  // Five days of the cycle are still open, and they are what the card steers.
  assert.equal(google?.daysElapsed, 25);
  assert.equal(google?.daysRemaining, 5);
  assert.equal(google?.remainingBudget, 25);
  assert.equal(google?.recommendedDailySpend, 5);
  assert.equal(pacing.planSource, "agreed");
  assert.equal(pacing.planCycleStart, "2026-08-24");
  assert.match(String(google?.safeMessage), /150 GBP budget/);
  assert.doesNotMatch(String(google?.safeMessage), /window target/);
});

test("a running cycle is never reported as closed just because the filter ends today", () => {
  // Example: Google on a 300 EUR cycle plan, 293 spent by the
  // 20th on a "last 28 days" filter. The card called the window closed and
  // showed a prorated target, hiding the two days that were still steerable.
  const rows = Array.from({ length: 28 }, (_, index) =>
    row(day("2026-08-24", index), "google", index === 27 ? 23 : 10, "EUR"),
  );
  const google = buildBudgetPacing(
    rows,
    { start: "2026-08-24", end: "2026-09-20" },
    { meta: 1_500, google: 300 },
    "EUR",
    "google",
    "2026-09-20",
    { source: "agreed", cycleStart: "2026-08-24" },
  ).platforms[0];

  assert.equal(google?.monthlyBudget, 300);
  assert.equal(google?.spentToDate, 293);
  assert.equal(google?.daysRemaining, 2);
  assert.equal(google?.remainingBudget, 7);
  assert.equal(google?.recommendedDailySpend, 3.5);
  assert.doesNotMatch(String(google?.safeMessage), /closed/);
});

test("narrowing the filter changes nothing about the cycle being paced", () => {
  // Both calls are handed the cycle's rows, because that is the contract: the
  // filter selects which cycle to pace, and the caller supplies that cycle.
  const rows = Array.from({ length: 10 }, (_, index) =>
    row(`2026-09-${String(index + 1).padStart(2, "0")}`, "google", 5),
  );
  const wide = buildBudgetPacing(
    rows,
    { start: "2026-09-01", end: "2026-09-10" },
    { meta: 300, google: 150 },
    "GBP",
    "google",
    "2026-09-10",
  );
  const narrow = buildBudgetPacing(
    rows,
    { start: "2026-09-08", end: "2026-09-10" },
    { meta: 300, google: 150 },
    "GBP",
    "google",
    "2026-09-10",
  );

  assert.equal(wide.cycle.start, narrow.cycle.start);
  assert.deepEqual(wide.platforms[0], narrow.platforms[0]);
  assert.equal(wide.platforms[0]?.monthlyBudget, 150);
  assert.equal(wide.platforms[0]?.spentToDate, 50);
  // Only the reader's filter differs, and the card says so rather than letting
  // two spend totals sit on one screen unexplained.
  assert.equal(wide.filterDays, 10);
  assert.equal(narrow.filterDays, 3);
  assert.equal(wide.filterMatchesCycle, false);
});

test("an unset plan is reported as unset, not as a 1,500 agreement", () => {
  const pacing = buildBudgetPacing(
    [],
    { start: "2026-09-01", end: "2026-09-14" },
    DEFAULT_BUDGETS,
    "EUR",
    "all",
  );

  // The placeholder reaches the card labelled as a placeholder. Printing it
  // as an agreed figure invents a budget the team never signed.
  assert.equal(pacing.planSource, "unset");
  assert.equal(pacing.planCycleStart, null);
});

test("the report echoes the plan it was built from, so a brand switch adopts the new one", () => {
  const kopiSenja = buildBudgetPacing(
    [],
    { start: "2026-09-01", end: "2026-09-14" },
    { meta: 350, google: 150 },
    "GBP",
  );
  const kriya = buildBudgetPacing(
    [],
    { start: "2026-09-01", end: "2026-09-14" },
    { meta: 400, google: 600 },
    "EUR",
  );

  // The client adopts `monthlyBudgets` from whichever brand was actually read.
  // Keeping its own state instead is what carried Kopi Senja's pounds into the next
  // request after the selector moved.
  assert.deepEqual(kopiSenja.monthlyBudgets, { meta: 350, google: 150 });
  assert.deepEqual(kriya.monthlyBudgets, { meta: 400, google: 600 });
  assert.equal(kopiSenja.currency, "GBP");
  assert.equal(kriya.currency, "EUR");
});

test("pacing counts days of the 30-day cycle, not days of the calendar month", () => {
  const plan = { meta: 300, google: 300 };
  // The same 28-day filter, once ending in February and once in July. Both
  // land four days into their own cycle, so both must read identically. A
  // calendar-month denominator would have apportioned 28/28 in one and 28/31
  // in the other, pacing one agreed plan against two different targets.
  const february = buildBudgetPacing(
    [],
    { start: "2026-02-01", end: "2026-02-28" },
    plan,
    "GBP",
    "google",
  );
  const july = buildBudgetPacing(
    [],
    { start: "2026-07-01", end: "2026-07-28" },
    plan,
    "GBP",
    "google",
  );

  assert.equal(february.cycleDays, REPORTING_CYCLE_DAYS);
  assert.equal(february.cycle.start, "2026-02-25");
  assert.equal(july.cycle.start, "2026-07-25");
  // The agreed figure is never cut down to the filter's length.
  assert.equal(february.platforms[0]?.monthlyBudget, 300);
  assert.equal(july.platforms[0]?.monthlyBudget, 300);
  assert.equal(february.platforms[0]?.daysElapsed, 4);
  assert.equal(july.platforms[0]?.daysElapsed, 4);
  assert.equal(february.platforms[0]?.daysRemaining, 26);
  assert.equal(july.platforms[0]?.daysRemaining, 26);
});

test("a closed cycle stays closed, whatever day the reader opens it on", () => {
  // Looking back at August from late September. The reference day is today,
  // well past the cycle's end, and must not be read as "day 56 of 30".
  const august = buildBudgetPacing(
    Array.from({ length: 30 }, (_, index) =>
      row(day("2026-07-25", index), "google", 10),
    ),
    { start: "2026-07-25", end: "2026-08-23" },
    { meta: 300, google: 300 },
    "GBP",
    "google",
    "2026-09-20",
  );

  assert.equal(august.cycle.end, "2026-08-23");
  assert.equal(august.referenceDate, "2026-08-23");
  assert.equal(august.platforms[0]?.daysElapsed, REPORTING_CYCLE_DAYS);
  assert.equal(august.platforms[0]?.daysRemaining, 0);
  assert.equal(august.platforms[0]?.spentToDate, 300);
  assert.equal(august.platforms[0]?.recommendedDailySpend, null);
  assert.equal(august.filterMatchesCycle, true);
  assert.match(String(august.platforms[0]?.safeMessage), /is closed/);
});

test("the ratified 30-day cycles resolve exactly as the team agreed them", () => {
  // The cycle chain is a product invariant, recorded in the repository's own
  // AGENTS.md; this list includes the
  // October cycle. Each cycle is named after the month it closes in, which is
  // how the team refers to it.
  const expected: [string, string, string][] = [
    ["2026-04-10", "2026-03-27", "2026-04-25"],
    ["2026-05-01", "2026-04-26", "2026-05-25"],
    ["2026-06-01", "2026-05-26", "2026-06-24"],
    ["2026-07-01", "2026-06-25", "2026-07-24"],
    ["2026-08-01", "2026-07-25", "2026-08-23"],
    ["2026-09-19", "2026-08-24", "2026-09-22"],
    ["2026-10-05", "2026-09-23", "2026-10-22"],
  ];

  for (const [day, start, end] of expected) {
    const cycle = resolveReportingCycle(day);
    assert.equal(cycle.start, start, `${day} resolved to the wrong cycle`);
    assert.equal(cycle.end, end, `${day} resolved to the wrong cycle`);
  }

  assert.equal(resolveReportingCycle("2026-09-19").label, "September 2026");
  assert.equal(resolveReportingCycle("2026-08-23").label, "August 2026");
  // Boundaries belong to exactly one cycle. 23 August closes August; the 24th
  // opens September.
  assert.equal(resolveReportingCycle("2026-08-24").label, "September 2026");
  // The chain extends past the ratified list without a gap or an overlap.
  assert.equal(resolveReportingCycle("2026-10-01").start, "2026-09-23");
  assert.equal(resolveReportingCycle("2026-10-22").label, "October 2026");
  assert.equal(resolveReportingCycle("2026-10-23").start, "2026-10-23");
  assert.equal(resolveReportingCycle("2026-03-26").end, "2026-03-26");
});

test("a filter is paced against the cycle it closes in, clamped to today", () => {
  // A 90-day filter reaches back across three cycles. The one it ends in is
  // the one the reader is currently spending against.
  assert.equal(
    resolveReportingCycleForRange({ start: "2026-06-22", end: "2026-09-19" })
      .start,
    "2026-08-24",
  );
  // A filter reaching past today paces the live cycle instead of one that has
  // not begun, so the budget being edited is always the one being paced.
  assert.equal(
    resolvePacingCycle(
      { start: "2026-09-01", end: "2026-10-31" },
      "2026-09-20",
    ).start,
    "2026-08-24",
  );
});

test("the budget reader and writer are brand-scoped, RLS-bound, and leak no identifier", async () => {
  const source = await readFile(
    new URL("../src/lib/supabase/server.ts", import.meta.url),
    "utf8",
  );

  const reader = source.slice(
    source.indexOf("export async function readClientBudget("),
    source.indexOf("export async function upsertClientBudget("),
  );
  assert.notEqual(reader.length, 0, "readClientBudget is missing");
  assert.ok(reader.includes('.from("client_budgets")'));
  // Under the caller's session, so RLS decides which brands they may read.
  // The service role would return every brand to anyone who asked.
  assert.ok(reader.includes("await createClient()"), "the reader bypasses RLS");
  assert.ok(
    reader.includes('.eq("client_id", clientId)'),
    "the reader is not brand-scoped",
  );
  // The plan is resolved for the cycle asked about or the most recent earlier
  // one, never a later agreement leaking backwards into a closed period.
  assert.ok(reader.includes('.lte("cycle_start", cycleStart)'));
  assert.ok(reader.includes("expectedCurrency"), "the reader skips the currency guard");
  assert.ok(!reader.includes("account_id"), "the reader selects account_id");

  const writerStart = source.indexOf(
    "export async function upsertClientBudget(",
  );
  const writer = source.slice(
    writerStart,
    source.indexOf("\n}", writerStart),
  );
  assert.ok(writer.includes("await createClient()"), "the writer bypasses RLS");
  assert.ok(!writer.includes("createServiceClient()"), "the writer bypasses RLS");
  // The conflict target is the composite key, so re-agreeing one brand's
  // budget for one cycle cannot overwrite another brand's row.
  assert.ok(writer.includes('onConflict: "client_id,cycle_start"'));
});

test("the budgets route validates the brand and gates the write on a role", async () => {
  const route = await readFile(
    new URL("../src/app/api/budgets/route.ts", import.meta.url),
    "utf8",
  );

  // An unknown slug is refused, never coerced to the pilot: coercion would
  // write one brand's agreement onto another brand's row.
  assert.ok(route.includes("resolveClientScope"));
  // The session is checked against the brand actually named.
  assert.ok(route.includes("resolveAuthContext(scope.clientSlug)"));
  assert.ok(route.includes('hasPermission(auth.context.access.role, "budget:write")'));
  assert.ok(route.includes("isSameOriginRequest"));
  // The caller sends the window it is looking at; the cycle boundary is
  // derived here, so no row can land off-phase and become unreadable.
  assert.ok(route.includes("resolveReportingCycle("));
});

test("the budgets table is RLS-gated, editor-writable, and never deletable by the app", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/0014_client_budgets.sql", import.meta.url),
    "utf8",
  );

  assert.ok(migration.includes("alter table public.client_budgets enable row level security"));
  assert.ok(migration.includes("revoke all on table public.client_budgets from anon, authenticated"));
  assert.ok(migration.includes("grant select, insert, update on table public.client_budgets to authenticated"));
  // No delete grant and no delete policy: an agreement that was acted on is
  // superseded by the next cycle's row, not erased.
  assert.ok(!/grant[^;]*delete[^;]*client_budgets/.test(migration));
  assert.ok(!migration.includes("client_budgets for delete"));
  assert.ok(migration.includes("public.can_access_client(client_id)"));
  assert.ok(migration.includes("'admin', 'internal_editor'"));
  // One agreement per brand per cycle, and the cycle must sit on the ratified
  // 30-day phase so a reader can always resolve to it.
  assert.ok(migration.includes("unique (client_id, cycle_start)"));
  assert.ok(migration.includes("((cycle_start - date '2026-03-27') % 30) = 0"));
});

test("no server path reads the legacy global budget cookie", async () => {
  for (const file of [
    "../src/app/page.tsx",
    "../src/app/api/dashboard/route.ts",
  ]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.ok(
      source.includes("budgetsCookieName("),
      `${file} does not scope the budget cookie to a brand`,
    );
    assert.ok(
      !source.includes("LEGACY_BUDGETS_COOKIE"),
      `${file} still reads the global budget cookie`,
    );
  }
});
