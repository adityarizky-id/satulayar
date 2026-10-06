/**
 * Backfills a trailing window of live advertising and GA4 rows into Supabase.
 *
 * This is the same ingestion path the dashboard's own backfill button uses —
 * `persistLiveSync` for Google Ads and Meta, `persistGa4Sync` for GA4 — run
 * from a terminal instead of from a browser session. It exists because the
 * button requires an operator with a Supabase session in front of a rendered
 * page, and the first load of history has to happen before anyone can sign in
 * and look at it.
 *
 * It is safe to run twice. Every destination table upserts on a stable grain
 * key, so a repeat corrects the days it covers rather than appending a second
 * copy of them:
 *
 *   daily_metrics                (account and campaign grain, by entity level)
 *   ad_campaigns                 (campaign attributes)
 *   ad_search_term_daily         (day x campaign x query x keyword)
 *   ad_device_daily              (day x campaign x device)
 *   ad_impression_share_period   (period x scope x campaign)
 *   ga4_daily_metrics            (day x breakdown x breakdown value)
 *
 * Read-only against every platform. It issues no mutation to Google Ads, Meta,
 * or GA4, and writes only to this project's own tables.
 *
 * Usage:
 *   npm run ingest:backfill -- --client kopi-senja
 *   npm run ingest:backfill -- --client all --lookback 90d
 *   npm run ingest:backfill -- --client all --platform google --lookback ytd
 *   npm run ingest:backfill -- --client kopi-senja --platform google --dry-run
 *
 * Defaults to a 60-day window, which carries a full reporting period plus the
 * equal-length baseline every comparison panel needs.
 */

import {
  BACKFILL_LOOKBACK_OPTIONS,
  isBackfillLookback,
  resolveBackfillWindow,
  type BackfillLookback,
} from "@/lib/connectors/backfill";
import { persistGa4Sync, resolveGa4PropertyId } from "@/lib/connectors/ga4-sync";
import { resolveLiveSyncGate } from "@/lib/connectors/health";
import { accountSlugs, resolveAccount } from "@/lib/dashboard/accounts";
import { getDashboardDataConfiguration } from "@/lib/dashboard/validation";
import type { Platform } from "@/lib/dashboard/types";
import { persistLiveSync, resolveClientIdBySlug } from "@/lib/supabase/server";

interface Options {
  clients: string[];
  lookback: BackfillLookback;
  platforms: Exclude<Platform, "all">[];
  dryRun: boolean;
}

function readArgument(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  if (index >= 0 && index + 1 < argv.length) return argv[index + 1];
  const inline = argv.find((value) => value.startsWith(`--${name}=`));
  return inline?.slice(name.length + 3);
}

function parseOptions(argv: readonly string[]): Options {
  const requestedClient = readArgument(argv, "client") ?? "";
  const requestedLookback = readArgument(argv, "lookback") ?? "60d";
  const requestedPlatform = readArgument(argv, "platform") ?? "all";

  if (!requestedClient) {
    throw new Error(
      `--client is required. Use one of: ${accountSlugs().join(", ")}, or "all".`,
    );
  }

  const clients =
    requestedClient === "all" ? accountSlugs() : requestedClient.split(",");
  for (const slug of clients) {
    if (!accountSlugs().includes(slug)) {
      throw new Error(
        `Unknown brand "${slug}". Use one of: ${accountSlugs().join(", ")}, or "all".`,
      );
    }
  }

  // The same fixed allowlist the API route enforces. A free-form day count is
  // how someone accidentally asks a platform for two years of data and
  // rate-limits the connector for every other brand. `ytd` is the one
  // variable-length member: it is bounded by the calendar, not by a number the
  // caller typed.
  if (!isBackfillLookback(requestedLookback)) {
    throw new Error(
      `--lookback must be one of: ${BACKFILL_LOOKBACK_OPTIONS.join(", ")}.`,
    );
  }

  const platforms: Exclude<Platform, "all">[] =
    requestedPlatform === "google" || requestedPlatform === "meta"
      ? [requestedPlatform]
      : ["meta", "google"];

  return {
    clients,
    lookback: requestedLookback,
    platforms,
    dryRun: argv.includes("--dry-run"),
  };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));

  // Fail closed before touching a platform, and say which switch is wrong. A
  // run that silently wrote synthetic rows into the live tables would be far
  // harder to notice than one that refuses to start.
  //
  // A dry run reports the gate instead of refusing on it. It pulls nothing and
  // writes nothing, so its whole purpose is to tell an operator what is still
  // missing before they go and set it.
  const configuration = getDashboardDataConfiguration();
  const gate = resolveLiveSyncGate();
  const modeReady =
    configuration.mode === "live" && configuration.storage === "supabase";

  if (options.dryRun) {
    process.stdout.write(
      `mode ${configuration.mode} / storage ${configuration.storage}` +
        `${modeReady ? "" : " — set DASHBOARD_DATA_MODE=live and DASHBOARD_DATA_STORE=supabase before a real run"}
` +
        `live sync gate: ${gate.unlocked ? "unlocked" : `locked — ${gate.reason}`}
`,
    );
  } else {
    if (!modeReady) {
      throw new Error(
        "A backfill only runs with DASHBOARD_DATA_MODE=live and DASHBOARD_DATA_STORE=supabase. Nothing was pulled.",
      );
    }
    if (!gate.unlocked) {
      throw new Error(`Live connector sync is locked. ${gate.reason}`);
    }
  }

  for (const clientSlug of options.clients) {
    const account = resolveAccount(clientSlug);
    const range = resolveBackfillWindow(options.lookback, account.timezone);

    process.stdout.write(
      `\n${account.name} (${clientSlug})\n  window ${range.start} to ${range.end} (${options.lookback}, ${account.timezone})\n  platforms ${options.platforms.join(", ")}\n`,
    );

    if (options.dryRun) {
      const ga4Configured = Boolean(resolveGa4PropertyId(clientSlug));
      process.stdout.write(
        `  dry run: nothing pulled or written. GA4 property ${ga4Configured ? "is" : "is not"} configured for this brand.\n`,
      );
      continue;
    }

    const clientId = await resolveClientIdBySlug(clientSlug);
    if (!clientId) {
      process.stdout.write(
        "  skipped: this brand has no client row in Supabase yet.\n",
      );
      continue;
    }

    // `requestedBy: null` on purpose. This is an unattended run and it must not
    // borrow an operator's identity on the audit trail.
    const result = await persistLiveSync({
      clientId,
      clientSlug,
      requestedBy: null,
      range,
      platforms: options.platforms,
      trigger: "scheduled",
    });

    process.stdout.write(
      `  ads: ${result.job.status} / ${result.dataStatus}` +
        ` — account ${result.accountRowsUpserted}` +
        `, campaign ${result.campaignRowsUpserted}` +
        `, attributes ${result.campaignAttributesUpserted}` +
        `, search terms ${result.searchTermRowsUpserted}` +
        `, device ${result.deviceRowsUpserted}` +
        `, period share ${result.impressionSharePeriodRowsUpserted}` +
        `, entity ${result.entityRowsUpserted}` +
        `, geo ${result.geoRowsUpserted}` +
        `, audience ${result.audienceRowsUpserted}\n`,
    );

    // GA4 is a separate source describing a different thing, so it reports its
    // own outcome and a GA4 outage never fails an advertising pull that worked.
    const ga4 = await persistGa4Sync({
      clientId,
      clientSlug,
      range,
      currency: account.currency,
    });
    process.stdout.write(
      `  ga4: ${ga4.outcome} — ${ga4.rowsUpserted} row(s). ${ga4.safeMessage}\n`,
    );

    // Warnings and errors are written by this codebase and are free of
    // credentials and raw provider bodies, so they are safe to print.
    for (const warning of [...result.warnings, ...ga4.warnings]) {
      process.stdout.write(`  warning: ${warning}\n`);
    }
    for (const error of result.errors) {
      process.stdout.write(`  error: ${error}\n`);
    }
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "The backfill failed for an unrecognised reason."}\n`,
  );
  process.exitCode = 1;
});
