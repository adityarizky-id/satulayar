import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { StoreAnalyticsShell } from "@/components/store/store-analytics-shell";
import { resolveActiveClientSlug } from "@/lib/auth/client-scope";
import { resolveAuthContext } from "@/lib/auth/session";
import {
  ACCOUNT_COOKIE,
  ACCOUNT_OPTIONS,
  resolveAccount,
  resolvePlatformForAccount,
} from "@/lib/dashboard/accounts";
import { buildDashboardSnapshot } from "@/lib/dashboard/fixtures";
import {
  buildStoreAnalyticsSnapshot,
  storeForAccount,
} from "@/lib/store/analytics";
import { applyGa4Hydration } from "@/lib/store/ga4-hydration";
import type { StoreModeStatus } from "@/lib/store/types";
import { readGa4DailyMetrics } from "@/lib/supabase/server";
import {
  DATA_MODE_COOKIE,
  getDashboardDataConfiguration,
  parseDataMode,
  type DashboardDataEnvironment,
} from "@/lib/dashboard/validation";
import {
  currentDateInTimeZone,
  resolveTimeframe,
} from "@/lib/dashboard/timeframes";
import { BrandGlyph } from "@/components/dashboard/brand-mark";

export const dynamic = "force-dynamic";

export default async function StoreAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The brand is resolved first and the session is checked against it, the
  // same order the paid-media dashboard and the data-sources page use. An
  // explicit ?account= is validated strictly; the selector cookie falls back
  // to the pilot when stale.
  const [params, cookieStore] = await Promise.all([searchParams, cookies()]);
  const scope = resolveActiveClientSlug({
    requested: params.account,
    cookie: cookieStore.get(ACCOUNT_COOKIE)?.value,
  });

  if (!scope.ok) {
    return (
      <main className="route-state">
        <span className="route-state__mark route-state__mark--error"><BrandGlyph className="route-state__glyph" /></span>
        <h1>Unknown client.</h1>
        <p>{scope.message}</p>
      </main>
    );
  }

  const account = resolveAccount(scope.clientSlug);
  const auth = await resolveAuthContext(account.slug);

  if (!auth.ok) {
    if (auth.code === "client_access_denied") {
      return (
        <main className="route-state">
          <span className="route-state__mark route-state__mark--error"><BrandGlyph className="route-state__glyph" /></span>
          <h1>Client access is not assigned.</h1>
          <p>{auth.safeMessage}</p>
        </main>
      );
    }

    redirect("/sign-in");
  }

  // An explicit ?mode= wins over the remembered choice, which in turn wins over
  // the deployment default. Resolving it here, on the server, is what lets the
  // first paint already be correct: a preference the server cannot see would
  // have to be corrected by the client after mount, which is both a hydration
  // mismatch and a window where the badge and the data disagree.
  const requestedMode =
    parseDataMode(params.mode) ??
    parseDataMode(cookieStore.get(DATA_MODE_COOKIE)?.value);
  const configuration = getDashboardDataConfiguration(
    process.env as DashboardDataEnvironment,
    requestedMode,
  );
  const now = new Date();
  const referenceDates = Object.fromEntries(
    ACCOUNT_OPTIONS.map((option) => [
      option.slug,
      currentDateInTimeZone(option.timezone, now),
    ]),
  );
  const referenceDate = referenceDates[account.slug] as string;
  const defaultRange = resolveTimeframe("14d", referenceDate);

  // Not a live-data failure: a 14-day window that will not resolve means the
  // timeframe table itself is wrong, and rendering a page around an unknown
  // period would be worse than saying so.
  if (!defaultRange) {
    throw new Error("The default reporting period could not be resolved.");
  }

  const paidSnapshot = buildDashboardSnapshot(
    defaultRange,
    resolvePlatformForAccount(account, "all"),
    account,
  );

  const syntheticSnapshot = buildStoreAnalyticsSnapshot(defaultRange, {
    store: storeForAccount(account),
    scale: account.fixtureScale,
    now,
    estimatedBlendedCac: paidSnapshot.blendedMer?.blendedCpa,
  });

  // Live GA4 is attempted only when all four conditions hold: the deployment is
  // in live mode, rows have a durable Supabase home, the session is a Supabase
  // session for RLS to scope the read to, and that session belongs to the brand
  // being rendered. Short of any one of them the page stays on fixtures rather
  // than issuing a read that cannot be tenant-filtered. Before this gate the
  // read ran unconditionally, including under a preview session with a
  // placeholder client id.
  //
  // Past the gate the path still fails soft: no rows, partial coverage, or an
  // unreachable database leaves the synthetic snapshot exactly as it was. A
  // store analytics page that will not render is worse than one that is visibly
  // still on fixtures.
  let storeSnapshot = syntheticSnapshot;
  let liveTrafficApplied = false;
  let modeReason: string | null = null;

  if (
    configuration.mode === "live" &&
    configuration.storage === "supabase" &&
    auth.context.mode === "supabase" &&
    auth.context.access.clientSlug === account.slug
  ) {
    try {
      const ga4Rows = await readGa4DailyMetrics(
        auth.context.access.clientId,
        defaultRange,
      );
      const hydration = applyGa4Hydration(syntheticSnapshot, ga4Rows);
      storeSnapshot = hydration.snapshot;
      liveTrafficApplied = hydration.summary.hydrated;
      modeReason = hydration.summary.reason;
    } catch {
      // Left on synthetic data on purpose; the page still renders.
      modeReason =
        "Stored GA4 traffic is unavailable, so traffic figures stay synthetic.";
    }
  } else {
    modeReason =
      configuration.mode === "mock"
        ? "Mock mode is selected, so no Supabase or GA4 read was attempted."
        : "Live traffic is not available to this session, so traffic figures stay synthetic.";
  }

  // Handed to the shell so the hero badge is honest on first paint. Without it
  // the badge could only tell the truth after the first refetch, and a fresh
  // page load would contradict the toggle it sits next to.
  const initialModeStatus: StoreModeStatus = {
    requested: requestedMode,
    resolved: configuration.mode,
    storage: configuration.storage,
    liveTrafficApplied,
    reason: modeReason,
  };

  return (
    <StoreAnalyticsShell
      accounts={ACCOUNT_OPTIONS}
      initialModeStatus={initialModeStatus}
      initialSnapshot={storeSnapshot}
      referenceDates={referenceDates}
      selectedAccount={account.slug}
      viewer={{
        email: auth.context.email,
        mode: auth.context.mode,
        role: auth.context.access.role,
      }}
    />
  );
}
